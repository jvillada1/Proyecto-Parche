import {
  eventCancelSchema,
  eventDraftSchema,
  eventUpdateSchema,
  myEventsQuerySchema,
  type EventCancelInput,
  type EventDraftInput,
  type EventUpdateInput,
  type MyEventsQuery,
} from '@parche/shared'
import { cloudinary } from '../uploads/cloudinary'

// Además de lo que valida shared, la portada tiene que venir de nuestra cuenta de Cloudinary.
const isOwnCover = (event: Pick<EventDraftInput, 'coverImage'>) =>
  !event.coverImage || cloudinary.isOwnImage(event.coverImage)
const notOwnCover = () => ({
  message: 'La imagen debe subirse a través de Parche',
  path: ['coverImage', 'url'],
})

export const createEventDraftSchema = eventDraftSchema.refine(isOwnCover, notOwnCover())
export const updateEventSchema = eventUpdateSchema.refine(isOwnCover, notOwnCover())

export const cancelEventSchema = eventCancelSchema
export const listMyEventsQuerySchema = myEventsQuerySchema

export type CancelEventInput = EventCancelInput
export type ListMyEventsQuery = MyEventsQuery
export type CreateEventDraftInput = EventDraftInput
export type UpdateEventInput = EventUpdateInput
