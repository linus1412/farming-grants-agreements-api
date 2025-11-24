import { config } from '~/src/config/index.js'
import { fetchWithTimeout } from '~/src/api/common/helpers/fetch.js'

export const toLandGrantsPayload = (actions = []) => {
  if (!Array.isArray(actions)) {
    throw new TypeError('actions must be an array')
  }

  const grouped = new Map()

  const parseQuantity = (raw) => {
    if (raw == null) {
      return null
    }
    const value = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  }

  for (const action of actions) {
    if (!action?.sheetId || !action?.parcelId || !action?.code) {
      continue
    }

    const key = `${action.sheetId}|${action.parcelId}`
    const existing = grouped.get(key) ?? {
      sheetId: action.sheetId,
      parcelId: action.parcelId,
      actions: []
    }

    const quantity = parseQuantity(action.appliedFor?.quantity)
    if (quantity == null) {
      grouped.set(key, existing)
      continue
    }

    existing.actions.push({ code: action.code, quantity })
    grouped.set(key, existing)
  }

  return { parcel: Array.from(grouped.values()) }
}

const buildAuthHeader = () => {
  const token = config.get('landGrants.token')
  return { Authorization: `Bearer ${token}` }
}

export const postPaymentCalculation = async (body, options = {}) => {
  const { headers: extraHeaders = {}, fetchFn = fetchWithTimeout } = options

  const landGrantsBaseUrl = config.get('landGrants.uri')
  const url = new URL('/payments/calculate', landGrantsBaseUrl)

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Land Grants Payment calculate request failed: ${res.status} ${res.statusText} ${text}`
    )
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return res.json()
  }

  return res.text()
}

const calculatePaymentsBasedOnActions = async (actions, logger) => {
  const { parcel } = toLandGrantsPayload(actions)

  const payload = { parcel }

  if (logger) {
    logger.info(
      `Sending Land Grants payment calculation request ${JSON.stringify(payload, null, 2)}`
    )
  }

  const response = await postPaymentCalculation(payload, {
    headers: buildAuthHeader()
  })

  if (logger) {
    logger.info(
      `Successfully called Land Grants payment calculation, response received is
      ${JSON.stringify(response, null, 2)}`
    )
  }

  const payment = response?.payment
  if (!payment) {
    throw new Error('Land Grants response missing "payment" field')
  }

  const {
    agreementStartDate,
    agreementEndDate,
    frequency,
    agreementTotalPence,
    annualTotalPence,
    parcelItems,
    agreementLevelItems,
    payments
  } = payment

  return {
    agreementStartDate,
    agreementEndDate,
    frequency,
    agreementTotalPence,
    annualTotalPence,
    parcelItems,
    agreementLevelItems,
    payments
  }
}

export { calculatePaymentsBasedOnActions }
