import { statusCodes } from '~/src/api/common/constants/status-codes.js'
import { calculatePaymentsBasedOnActions } from '~/src/api/adapter/land-grants-adapter.js'
import Boom from '@hapi/boom'

/**
 * Controller to serve the get agreement
 * Returns JSON data with agreement information
 * @satisfies {Partial<ServerRoute>}
 */
const getAgreementController =
  ({ allowEntra } = {}) =>
  async (request, h) => {
    const { agreementData, source } = request.auth.credentials
    if (!allowEntra && source === 'entra') {
      throw Boom.unauthorized(
        `Not allowed to view the agreement. Source: ${source}`
      )
    }

    if (agreementData.status === 'offered') {
      agreementData.payment = await calculatePaymentsBasedOnActions(
        agreementData.actionApplications,
        request.logger
      )
      request.logger.info(
        'Successfully called Land Grants service for payments calculation.'
      )
    }

    // Return JSON response with agreement data
    return h.response({ agreementData }).code(statusCodes.ok)
  }

export { getAgreementController }

/**
 * @import { ServerRoute } from '@hapi/hapi'
 */
