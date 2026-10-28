import { Router } from 'express'
import { requireAuth, requireRole } from '../../middlewares/auth'
import { validate } from '../../middlewares/validate'
import { listBusinessesQuerySchema, rejectBusinessSchema } from './business.schemas'
import * as adminBusinessController from './admin-business.controller'

export const adminBusinessRoutes = Router()

adminBusinessRoutes.use(requireAuth, requireRole('admin'))

adminBusinessRoutes.get(
  '/',
  validate({ query: listBusinessesQuerySchema }),
  adminBusinessController.listBusinesses,
)
adminBusinessRoutes.get('/:id', adminBusinessController.getBusiness)
adminBusinessRoutes.post('/:id/approve', adminBusinessController.approveBusiness)
adminBusinessRoutes.post(
  '/:id/reject',
  validate({ body: rejectBusinessSchema }),
  adminBusinessController.rejectBusiness,
)
