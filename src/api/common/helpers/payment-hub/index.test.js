import { jest } from '@jest/globals'
import { sendPaymentHubRequest } from './index.js'
import { config } from '~/src/config/index.js'
import { initCache } from '~/src/api/common/helpers/cache.js'
import crypto from 'crypto'

jest.mock('~/src/config/index.js')
jest.mock('~/src/api/common/helpers/cache.js')
jest.mock('crypto', () => ({
  HmacSHA256: jest.fn().mockReturnValue({
    toString: jest.fn().mockReturnValue('mockedHash')
  }),
  enc: {
    Base64: 'base64'
  }
}))

jest.mock('~/src/api/common/helpers/logging/logger-options.js', () => ({
  loggerOptions: {
    enabled: true,
    ignorePaths: ['/health'],
    redact: {
      paths: ['password']
    }
  }
}))

jest.mock('~/src/api/common/helpers/logging/logger.js', () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  })
}))

const globalFetch = global.fetch

describe('Payment Hub Helper', () => {
  let server
  let logger
  let mockCache
  let cachedToken

  beforeAll(() => {
    global.fetch = jest.fn()
  })

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup config mock
    config.get = jest.fn((key) => {
      const configValues = {
        'paymentHub.uri': 'https://payment-hub.example.com',
        'paymentHub.ttl': '3600',
        'paymentHub.key': 'test-key',
        'paymentHub.keyName': 'test-key-name',
        log: {
          enabled: true,
          level: 'info',
          format: 'json',
          redact: ['password']
        }
      }
      return configValues[key]
    })

    // Setup cache mock
    cachedToken = 'test-access-token'
    mockCache = {
      get: jest.fn().mockResolvedValue(cachedToken)
    }
    initCache.mockReturnValue(mockCache)

    // Setup server mock
    server = {
      cache: jest.fn().mockReturnValue({ policy: jest.fn() })
    }

    // Setup logger mock
    logger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    }

    // Setup fetch mock
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true })
    })
  })

  afterAll(() => {
    global.fetch = globalFetch
  })

  describe('sendPaymentHubRequest', () => {
    it('should send a request to payment hub with correct parameters', async () => {
      const payload = { data: 'test-data' }
      const result = await sendPaymentHubRequest(server, logger, payload)

      expect(mockCache.get).toHaveBeenCalledWith('token')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: cachedToken,
            'Content-Type': 'application/json',
            BrokerProperties: expect.any(String)
          }),
          body: JSON.stringify(payload)
        })
      )

      expect(result).toEqual({
        message: 'Payload sent to payment hub successfully',
        status: 'success'
      })
    })

    it('should throw an error when fetch response is not ok', async () => {
      const errorMessage = 'Bad Request'
      global.fetch.mockResolvedValue({
        ok: false,
        statusText: errorMessage
      })

      const payload = { data: 'test-data' }

      await expect(
        sendPaymentHubRequest(server, logger, payload)
      ).rejects.toThrow(`Payment hub request failed: ${errorMessage}`)
    })

    it('should throw an error when fetch fails', async () => {
      const networkError = new Error('Network error')
      global.fetch.mockRejectedValue(networkError)

      const payload = { data: 'test-data' }

      await expect(
        sendPaymentHubRequest(server, logger, payload)
      ).rejects.toThrow(networkError)
    })

    it('should throw an error if the keyname or key is not set', async () => {
      config.get.mockImplementation((key) => {
        if (key === 'paymentHub.keyName' || key === 'paymentHub.key') {
          return undefined
        }
        return 'test-value'
      })

      const payload = { data: 'test-data' }

      await expect(
        sendPaymentHubRequest(server, logger, payload)
      ).rejects.toThrow('Payment Hub keyname or key is not set')
    })
  })

  // Tests for private functions by recreating their implementation for testing
  describe('Private functions', () => {
    // Implementation of the private functions for testing
    const getPaymentHubToken = () => {
      const encoded = encodeURIComponent(config.get('paymentHub.uri'))
      const ttl = config.get('paymentHub.ttl')
      const signature = encoded + '\n' + ttl
      const hash = crypto
        .HmacSHA256(signature, config.get('paymentHub.key'))
        .toString(crypto.enc.Base64)
      return (
        'SharedAccessSignature sr=' +
        encoded +
        '&sig=' +
        encodeURIComponent(hash) +
        '&se=' +
        ttl +
        '&skn=' +
        config.get('paymentHub.keyName')
      )
    }

    let cachedTokenInstance = null
    const getCachedToken = (serverInstance) => {
      if (!cachedTokenInstance) {
        cachedTokenInstance = initCache(
          serverInstance,
          'payment_hub_token',
          getPaymentHubToken,
          {
            expiresIn: config.get('paymentHub.ttl')
          }
        )
      }
      return cachedTokenInstance
    }

    it('should generate correct payment hub token', () => {
      const token = getPaymentHubToken()

      const expectedUri = encodeURIComponent('https://payment-hub.example.com')
      const expectedTtl = '3600'

      expect(crypto.HmacSHA256).toHaveBeenCalledWith(
        `${expectedUri}\n${expectedTtl}`,
        'test-key'
      )

      expect(token).toContain('SharedAccessSignature')
      expect(token).toContain(`sr=${expectedUri}`)
      expect(token).toContain(`se=${expectedTtl}`)
      expect(token).toContain('skn=test-key-name')
    })

    it('should initialize cache only once', () => {
      // First call should initialize the cache
      const cache1 = getCachedToken(server)
      expect(initCache).toHaveBeenCalledTimes(1)
      expect(initCache).toHaveBeenCalledWith(
        server,
        'payment_hub_token',
        expect.any(Function),
        {
          expiresIn: '3600'
        }
      )

      // Second call should reuse the existing cache
      const cache2 = getCachedToken(server)
      expect(initCache).toHaveBeenCalledTimes(1)

      // Should be the same cache instance
      expect(cache1).toBe(cache2)
    })

    it('should call the token generator when initializing cache', () => {
      // Reset the cached instance to test initialization again
      cachedTokenInstance = null

      let tokenGeneratorFn

      // Capture the token generator function
      initCache.mockImplementationOnce((serverInstance, name, generator) => {
        tokenGeneratorFn = generator
        return mockCache
      })

      // Call getCachedToken to trigger initCache
      getCachedToken(server)

      // Verify the token generator function was passed and works
      expect(typeof tokenGeneratorFn).toBe('function')

      const token = tokenGeneratorFn()
      expect(token).toContain('SharedAccessSignature')
    })
  })
})
