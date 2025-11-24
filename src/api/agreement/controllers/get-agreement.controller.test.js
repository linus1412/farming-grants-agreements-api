import Boom from '@hapi/boom'

import { createServer } from '~/src/api/index.js'
import { statusCodes } from '~/src/api/common/constants/status-codes.js'
import * as agreementDataHelper from '~/src/api/agreement/helpers/get-agreement-data.js'
import * as jwtAuth from '~/src/api/common/helpers/jwt-auth.js'
import { calculatePaymentsBasedOnActions } from '~/src/api/adapter/land-grants-adapter.js'

// Mock the modules
jest.mock('~/src/api/common/helpers/sqs-client.js')
jest.mock('~/src/api/agreement/helpers/get-agreement-data.js', () => ({
  __esModule: true,
  ...jest.requireActual('~/src/api/agreement/helpers/get-agreement-data.js'),
  getAgreementDataById: jest.fn(),
  getAgreementDataBySbi: jest.fn()
}))
jest.mock('~/src/api/common/helpers/jwt-auth.js')
jest.mock('~/src/api/adapter/land-grants-adapter.js', () => ({
  calculatePaymentsBasedOnActions: jest.fn()
}))

describe('getAgreementController', () => {
  /** @type {import('@hapi/hapi').Server} */
  let server

  beforeAll(async () => {
    server = await createServer({ disableSQS: true })
    await server.initialize()
  })

  afterAll(async () => {
    if (server) {
      await server.stop({ timeout: 0 })
    }
  })

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks()
    calculatePaymentsBasedOnActions.mockResolvedValue({
      agreementStartDate: '2024-01-01',
      agreementEndDate: '2025-12-31',
      frequency: 'Annual',
      agreementTotalPence: 1000,
      annualTotalPence: 1000,
      parcelItems: [],
      agreementLevelItems: [],
      payments: []
    })

    // Setup default mock implementations
    jest.spyOn(agreementDataHelper, 'getAgreementDataById')
    jest.spyOn(agreementDataHelper, 'getAgreementDataBySbi')
  })

  describe('GET / (by SBI)', () => {
    const doGet = () =>
      server.inject({
        method: 'GET',
        url: '/',
        headers: { 'x-encrypted-auth': 'valid-jwt-token' }
      })

    describe('Farmer', () => {
      beforeEach(() => {
        jest.spyOn(jwtAuth, 'validateJwtAuthentication').mockReturnValue({
          valid: true,
          source: 'defra',
          sbi: '106284736'
        })
      })

      describe('not yet accepted', () => {
        const agreementId = 'SFI123456789'
        let mockAgreementData

        beforeEach(() => {
          mockAgreementData = {
            agreementNumber: agreementId,
            status: 'offered',
            sbi: '106284736',
            actionApplications: [{ code: 'A1' }],
            payment: {
              agreementStartDate: '2025-12-05',
              annualTotalPence: 0,
              parcelItems: {},
              agreementLevelItems: {}
            }
          }

          jest
            .spyOn(agreementDataHelper, 'getAgreementDataBySbi')
            .mockResolvedValue(mockAgreementData)
        })

        test('should return offered data', async () => {
          const { statusCode, result } = await doGet()
          expect(statusCode).toBe(statusCodes.ok)
          expect(result.agreementData.status).toContain('offered')
        })

        test('should handle agreement not found', async () => {
          jest
            .spyOn(agreementDataHelper, 'getAgreementDataBySbi')
            .mockRejectedValue(Boom.notFound('Agreement not found'))

          const { statusCode, result } = await doGet()
          expect(statusCode).toBe(404)
          expect(result.errorMessage).toContain('Agreement not found')
        })

        test('should handle database errors', async () => {
          const errorMessage = 'Database connection failed'
          jest
            .spyOn(agreementDataHelper, 'getAgreementDataBySbi')
            .mockRejectedValue(new Error(errorMessage))

          const { statusCode, result } = await doGet()
          expect(statusCode).toBe(statusCodes.internalServerError)
          expect(result.errorMessage).toContain('Database connection failed')
        })

        test('should fetch updated payments when status is offered', async () => {
          const { result } = await doGet()

          expect(calculatePaymentsBasedOnActions).toHaveBeenCalledWith(
            mockAgreementData.actionApplications,
            expect.objectContaining({
              info: expect.any(Function)
            })
          )
          expect(result.agreementData.payment).toEqual(
            expect.objectContaining({
              agreementStartDate: '2024-01-01',
              agreementEndDate: '2025-12-31'
            })
          )
        })
      })

      describe('already accepted', () => {
        /** @type {Agreement} */
        let mockAgreementData

        beforeEach(() => {
          mockAgreementData = {
            agreementNumber: 'SFI123456789',
            status: 'accepted',
            sbi: '106284736',
            actionApplications: [{ code: 'A1' }],
            payment: {
              agreementStartDate: '2025-12-05',
              annualTotalPence: 0,
              parcelItems: {},
              agreementLevelItems: {}
            }
          }

          jest
            .spyOn(agreementDataHelper, 'getAgreementDataBySbi')
            .mockResolvedValue(mockAgreementData)
        })

        test('should return accepted data', async () => {
          const { statusCode, result } = await doGet()
          expect(statusCode).toBe(statusCodes.ok)
          expect(result.agreementData.status).toContain('accepted')
        })

        test('should not recalculate payments when already accepted', async () => {
          await doGet()
          expect(calculatePaymentsBasedOnActions).not.toHaveBeenCalled()
        })
      })
    })

    describe('Case worker', () => {
      beforeEach(() => {
        jest.spyOn(jwtAuth, 'validateJwtAuthentication').mockReturnValue({
          valid: true,
          source: 'entra'
        })

        const mockAgreementData = {
          agreementNumber: 'SFI123456789',
          status: 'offered',
          sbi: '106284736',
          payment: {
            agreementStartDate: '2025-12-05',
            annualTotalPence: 0,
            parcelItems: {},
            agreementLevelItems: {}
          }
        }

        jest
          .spyOn(agreementDataHelper, 'getAgreementDataBySbi')
          .mockResolvedValue(mockAgreementData)
      })

      test('should be forbidden', async () => {
        const { statusCode, result } = await doGet()
        expect(statusCode).toBe(401)
        expect(result.errorMessage).toContain(
          'Not allowed to view the agreement. Source: entra'
        )
      })
    })
  })

  describe('GET /{agreementId}', () => {
    const doGet = (agreementId = 'SFI123456789', headers = {}) =>
      server.inject({
        method: 'GET',
        url: `/${agreementId}`,
        headers: { 'x-encrypted-auth': 'valid-jwt-token', ...headers }
      })

    describe('Farmer', () => {
      const agreementId = 'SFI123456789'

      beforeEach(() => {
        jest.spyOn(jwtAuth, 'validateJwtAuthentication').mockReturnValue({
          valid: true,
          source: 'defra',
          sbi: '106284736'
        })
      })

      describe('not yet accepted', () => {
        beforeEach(() => {
          const mockAgreementData = {
            agreementNumber: agreementId,
            status: 'offered',
            sbi: '106284736',
            payment: {
              agreementStartDate: '2025-12-05',
              annualTotalPence: 0,
              parcelItems: {},
              agreementLevelItems: {}
            }
          }

          jest
            .spyOn(agreementDataHelper, 'getAgreementDataById')
            .mockResolvedValue(mockAgreementData)
        })

        test('should return offered data', async () => {
          const { statusCode, result } = await doGet(agreementId)
          expect(statusCode).toBe(statusCodes.ok)
          expect(result.agreementData.status).toContain('offered')
        })

        test('should handle agreement not found', async () => {
          jest
            .spyOn(agreementDataHelper, 'getAgreementDataById')
            .mockRejectedValue(Boom.notFound('Agreement not found'))

          const { statusCode, result } = await doGet('INVALID123')
          expect(statusCode).toBe(404)
          expect(result.errorMessage).toContain('Agreement not found')
        })

        test('should handle database errors', async () => {
          const errorMessage = 'Database connection failed'
          jest
            .spyOn(agreementDataHelper, 'getAgreementDataById')
            .mockRejectedValue(new Error(errorMessage))

          const { statusCode, result } = await doGet(agreementId)
          expect(statusCode).toBe(statusCodes.internalServerError)
          expect(result.errorMessage).toContain('Database connection failed')
        })
      })

      describe('already accepted', () => {
        beforeEach(() => {
          const mockAgreementData = {
            agreementNumber: agreementId,
            status: 'accepted',
            sbi: '106284736',
            payment: {
              agreementStartDate: '2025-12-05',
              annualTotalPence: 0,
              parcelItems: {},
              agreementLevelItems: {}
            }
          }

          jest
            .spyOn(agreementDataHelper, 'getAgreementDataById')
            .mockResolvedValue(mockAgreementData)
        })

        test('should return accepted data', async () => {
          const { statusCode, result } = await doGet(agreementId)
          expect(statusCode).toBe(statusCodes.ok)
          expect(result.agreementData.status).toContain('accepted')
        })

        test('should return accepted agreement data with base URL when already accepted', async () => {
          const { statusCode, result } = await doGet(agreementId, {
            'x-base-url': '/agreement'
          })
          expect(statusCode).toBe(statusCodes.ok)
          expect(result.agreementData.status).toContain('accepted')
        })
      })
    })

    describe('Case worker', () => {
      beforeEach(() => {
        jest.spyOn(jwtAuth, 'validateJwtAuthentication').mockReturnValue({
          valid: true,
          source: 'entra'
        })

        const mockAgreementData = {
          agreementNumber: 'SFI123456789',
          status: 'offered',
          sbi: '106284736',
          payment: {
            agreementStartDate: '2025-12-05',
            annualTotalPence: 0,
            parcelItems: {},
            agreementLevelItems: {}
          }
        }

        jest
          .spyOn(agreementDataHelper, 'getAgreementDataById')
          .mockResolvedValue(mockAgreementData)
      })

      test('should return agreement data', async () => {
        const { statusCode, result } = await doGet('SFI123456789')
        expect(statusCode).toBe(statusCodes.ok)
        expect(result.agreementData.status).toContain('offered')
      })
    })
  })
})

/**
 * @typedef {import('~/src/api/common/types/agreement.d.js').Agreement} Agreement
 */
