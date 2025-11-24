import {
  calculatePaymentsBasedOnActions,
  toLandGrantsPayload
} from './land-grants-adapter.js'
import { config } from '~/src/config/index.js'

jest.mock('~/src/config/index.js', () => ({
  config: {
    get: jest.fn()
  }
}))

const mockConfig = config

describe('toLandGrantsPayload', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('throws when actions is not an array', () => {
    expect(() => toLandGrantsPayload('not-an-array')).toThrow(TypeError)
  })

  test('groups valid actions by sheet and parcel while discarding invalid entries', () => {
    const result = toLandGrantsPayload([
      {
        sheetId: 'sheet-1',
        parcelId: 'parcel-1',
        code: 'A1',
        appliedFor: { quantity: '10.5' }
      },
      {
        sheetId: 'sheet-1',
        parcelId: 'parcel-1',
        code: 'A2',
        appliedFor: { quantity: 5 }
      },
      {
        sheetId: 'sheet-2',
        parcelId: 'parcel-9',
        code: 'B1',
        appliedFor: { quantity: '1' }
      },
      {
        sheetId: 'sheet-2',
        parcelId: 'parcel-9',
        code: 'B2',
        appliedFor: { quantity: 'banana' }
      },
      {
        sheetId: 'sheet-2',
        parcelId: 'parcel-9',
        appliedFor: { quantity: 3 }
      },
      {
        sheetId: 'sheet-1',
        parcelId: 'parcel-1',
        code: 'A3',
        appliedFor: { quantity: 0 }
      }
    ])

    expect(result).toEqual({
      parcel: [
        {
          sheetId: 'sheet-1',
          parcelId: 'parcel-1',
          actions: [
            { code: 'A1', quantity: 10.5 },
            { code: 'A2', quantity: 5 }
          ]
        },
        {
          sheetId: 'sheet-2',
          parcelId: 'parcel-9',
          actions: [{ code: 'B1', quantity: 1 }]
        }
      ]
    })
  })
})

describe('calculatePaymentsBasedOnActions', () => {
  const actions = [
    {
      code: 'FG1',
      sheetId: 'brn-01',
      parcelId: 'parcel-123',
      appliedFor: { quantity: 3 }
    }
  ]

  const globalFetch = global.fetch

  const buildFetchResponse = (overrides = {}) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: () => 'application/json'
    },
    json: jest.fn().mockResolvedValue({}),
    text: jest.fn().mockResolvedValue(''),
    ...overrides
  })

  const mockLogger = {
    error: jest.fn(),
    info: jest.fn()
  }

  beforeAll(() => {
    global.fetch = jest.fn()
  })

  afterAll(() => {
    global.fetch = globalFetch
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockConfig.get.mockImplementation((key) => {
      if (key === 'landGrants.uri') {
        return 'https://land-grants.example'
      }
      if (key === 'landGrants.token') {
        return 'config-token'
      }

      if (key === 'fetchTimeout') {
        return 30000
      }
      throw new Error(`Unexpected config key ${key}`)
    })
  })

  test('sends grouped payload and returns the payment fields', async () => {
    const payment = {
      agreementStartDate: '2024-01-01',
      agreementEndDate: '2025-01-01',
      frequency: 'Quarterly',
      agreementTotalPence: 12300,
      annualTotalPence: 4100,
      parcelItems: [{ id: 'parcel' }],
      agreementLevelItems: [{ id: 'agreement-level' }],
      payments: [{ dueDate: '2024-03-01', amount: 1025 }],
      extraneous: 'ignore-me'
    }

    const fetchResponse = buildFetchResponse({
      json: jest.fn().mockResolvedValue({ payment })
    })
    global.fetch.mockResolvedValue(fetchResponse)

    const result = await calculatePaymentsBasedOnActions(actions, mockLogger)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, request] = global.fetch.mock.calls[0]
    expect(url.toString()).toBe(
      'https://land-grants.example/payments/calculate'
    )
    expect(request.headers.Authorization).toBe('Bearer config-token')
    expect(request.headers['Content-Type']).toBe('application/json')
    expect(request.body).toEqual(
      JSON.stringify({
        parcel: [
          {
            sheetId: 'brn-01',
            parcelId: 'parcel-123',
            actions: [{ code: 'FG1', quantity: 3 }]
          }
        ]
      })
    )

    expect(result).toEqual({
      agreementStartDate: payment.agreementStartDate,
      agreementEndDate: payment.agreementEndDate,
      frequency: payment.frequency,
      agreementTotalPence: payment.agreementTotalPence,
      annualTotalPence: payment.annualTotalPence,
      parcelItems: payment.parcelItems,
      agreementLevelItems: payment.agreementLevelItems,
      payments: payment.payments
    })

    expect(mockLogger.info).toHaveBeenCalledTimes(2)
  })

  test('sends grouped payload and returns the payment fields without logs', async () => {
    const payment = {
      agreementStartDate: '2024-01-01',
      agreementEndDate: '2025-01-01',
      frequency: 'Quarterly',
      agreementTotalPence: 12300,
      annualTotalPence: 4100,
      parcelItems: [{ id: 'parcel' }],
      agreementLevelItems: [{ id: 'agreement-level' }],
      payments: [{ dueDate: '2024-03-01', amount: 1025 }],
      extraneous: 'ignore-me'
    }

    const fetchResponse = buildFetchResponse({
      json: jest.fn().mockResolvedValue({ payment })
    })
    global.fetch.mockResolvedValue(fetchResponse)

    const result = await calculatePaymentsBasedOnActions(actions, null)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, request] = global.fetch.mock.calls[0]
    expect(url.toString()).toBe(
      'https://land-grants.example/payments/calculate'
    )
    expect(request.headers.Authorization).toBe('Bearer config-token')
    expect(request.headers['Content-Type']).toBe('application/json')
    expect(request.body).toEqual(
      JSON.stringify({
        parcel: [
          {
            sheetId: 'brn-01',
            parcelId: 'parcel-123',
            actions: [{ code: 'FG1', quantity: 3 }]
          }
        ]
      })
    )

    expect(result).toEqual({
      agreementStartDate: payment.agreementStartDate,
      agreementEndDate: payment.agreementEndDate,
      frequency: payment.frequency,
      agreementTotalPence: payment.agreementTotalPence,
      annualTotalPence: payment.annualTotalPence,
      parcelItems: payment.parcelItems,
      agreementLevelItems: payment.agreementLevelItems,
      payments: payment.payments
    })

    expect(mockLogger.info).toHaveBeenCalledTimes(0)
  })

  test('throws when Land Grants request does not include payment', async () => {
    const fetchResponse = buildFetchResponse({
      json: jest.fn().mockResolvedValue({})
    })
    global.fetch.mockResolvedValue(fetchResponse)

    await expect(
      calculatePaymentsBasedOnActions(actions, mockLogger)
    ).rejects.toThrow('Land Grants response missing "payment" field')

    expect(mockLogger.info).toHaveBeenCalledTimes(2)
  })

  test('throws when Land Grants request fails', async () => {
    const fetchResponse = {
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: jest.fn().mockResolvedValue('gateway down')
    }
    global.fetch.mockResolvedValue(fetchResponse)

    await expect(
      calculatePaymentsBasedOnActions(actions, mockLogger)
    ).rejects.toThrow(
      'Land Grants Payment calculate request failed: 502 Bad Gateway gateway down'
    )

    expect(mockLogger.info).toHaveBeenCalledTimes(1)
  })
})
