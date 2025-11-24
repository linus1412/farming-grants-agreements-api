import { ProxyAgent } from 'undici'

import { config } from '~/src/config/index.js'

/**
 * Make fetch requests with timeout support
 * @param {string} url - The URL to fetch
 * @param {object} options - The fetch options
 * @param {string} options.method - The HTTP method (GET, POST, etc.)
 * @param {object} options.headers - The request headers
 * @param {object} options.body - The request body
 * @returns {Promise<Response>} The fetch response
 */
export const fetchWithTimeout = async (url, options) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(new Error('Network timed out while fetching data')),
    config.get('fetchTimeout')
  )

  try {
    const input = url instanceof URL ? url.toString() : url
    return await fetch(input, {
      ...options,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Make fetch requests with proxy support
 * @param {string} url - The URL to fetch
 * @param {object} options - The fetch options
 * @param {string} options.method - The HTTP method (GET, POST, etc.)
 * @param {object} options.headers - The request headers
 * @param {object} options.body - The request body
 * @returns {Promise<Response>} The fetch response
 */
export const proxyFetch = async (url, options) => {
  const proxyUrlConfig = config.get('httpProxy') // bound to HTTP_PROXY

  if (!proxyUrlConfig) {
    return fetchWithTimeout(url, options)
  }

  return fetchWithTimeout(url, {
    ...options,
    dispatcher: new ProxyAgent({
      uri: proxyUrlConfig,
      keepAliveTimeout: 10,
      keepAliveMaxTimeout: 10
    })
  })
}
