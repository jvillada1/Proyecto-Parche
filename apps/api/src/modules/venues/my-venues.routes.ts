import { Router } from 'express'
import { requireAuth, requireRole } from '../../middlewares/auth'
import { validate } from '../../middlewares/validate'
import { createVenueSchema, updateVenueSchema } from './venue.schemas'
import * as venueController from './venue.controller'

export const myVenuesRoutes = Router()

myVenuesRoutes.use(requireAuth, requireRole('manager'))

myVenuesRoutes.get('/', venueController.listMyVenues)
myVenuesRoutes.post('/', validate({ body: createVenueSchema }), venueController.createMyVenue)
myVenuesRoutes.get('/:id', venueController.getMyVenue)
myVenuesRoutes.patch('/:id', validate({ body: updateVenueSchema }), venueController.updateMyVenue)
