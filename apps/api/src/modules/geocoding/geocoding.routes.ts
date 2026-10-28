import { Router } from 'express'
import { requireAuth, requireRole } from '../../middlewares/auth'
import { geocodingRateLimiter } from '../../middlewares/rate-limit'
import { validate } from '../../middlewares/validate'
import { reverseQuerySchema, searchQuerySchema } from './geocoding.schemas'
import * as geocodingController from './geocoding.controller'

// El frontend nunca llama a Nominatim directamente: pasa por aquí para respetar su política de uso.
export const geocodingRoutes = Router()

geocodingRoutes.use(requireAuth, requireRole('manager'), geocodingRateLimiter)

geocodingRoutes.get('/search', validate({ query: searchQuerySchema }), geocodingController.search)
geocodingRoutes.get(
  '/reverse',
  validate({ query: reverseQuerySchema }),
  geocodingController.reverse,
)
