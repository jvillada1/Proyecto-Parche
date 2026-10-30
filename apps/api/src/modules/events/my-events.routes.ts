import { Router } from 'express'
import { requireAuth, requireRole } from '../../middlewares/auth'
import { validate } from '../../middlewares/validate'
import {
  cancelEventSchema,
  createEventDraftSchema,
  listMyEventsQuerySchema,
  updateEventSchema,
} from './event.schemas'
import * as eventController from './event.controller'

export const myEventsRoutes = Router()

myEventsRoutes.use(requireAuth, requireRole('manager'))

myEventsRoutes.get('/', validate({ query: listMyEventsQuerySchema }), eventController.listMyEvents)
myEventsRoutes.get('/summary', eventController.getMyEventsSummary)
myEventsRoutes.post(
  '/',
  validate({ body: createEventDraftSchema }),
  eventController.createMyEventDraft,
)
myEventsRoutes.patch('/:id', validate({ body: updateEventSchema }), eventController.updateMyEvent)
myEventsRoutes.delete('/:id', eventController.deleteMyEvent)
myEventsRoutes.post('/:id/publish', eventController.publishMyEvent)
myEventsRoutes.post('/:id/duplicate', eventController.duplicateMyEvent)
myEventsRoutes.post(
  '/:id/cancel',
  validate({ body: cancelEventSchema }),
  eventController.cancelMyEvent,
)
