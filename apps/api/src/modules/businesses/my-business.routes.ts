import { Router } from 'express'
import { requireAuth, requireRole } from '../../middlewares/auth'
import { validate } from '../../middlewares/validate'
import { updateMyBusinessSchema } from './business.schemas'
import * as businessController from './business.controller'

export const myBusinessRoutes = Router()

myBusinessRoutes.use(requireAuth, requireRole('manager'))

myBusinessRoutes.get('/', businessController.getMyBusiness)
myBusinessRoutes.patch(
  '/',
  validate({ body: updateMyBusinessSchema }),
  businessController.updateMyBusiness,
)
myBusinessRoutes.post('/review-request', businessController.requestReview)
