import mongoose, { isValidObjectId, type QueryFilter, type Types } from 'mongoose'
import {
  MY_EVENTS_PAGE_SIZE,
  ONGOING_EDITABLE_FIELDS,
  eventActions,
  eventDisplayStatus,
  eventDraftSchema,
  eventEditPhase,
  eventOngoingSchema,
  eventPublishSchema,
  type EventEditPhase,
  type MyEventTab,
} from '@parche/shared'
import {
  BusinessNotApprovedError,
  ConflictError,
  EventNotCancellableError,
  EventNotDeletableError,
  EventNotEditableError,
  NotFoundError,
  ValidationError,
} from '../../utils/app-error'
import { formatZodIssues } from '../../utils/zod-issues'
import { Business } from '../businesses/business.model'
import { Venue } from '../venues/venue.model'
import { businessSnapshot, venueFields } from './event-sync.service'
import { Event, type EventDoc } from './event.model'
import type {
  CancelEventInput,
  CreateEventDraftInput,
  ListMyEventsQuery,
  UpdateEventInput,
} from './event.schemas'

type EventDocument = InstanceType<typeof Event>

const EVENT_NOT_FOUND_MESSAGE = 'Evento no encontrado'

async function myBusiness(ownerId: string) {
  const business = await Business.findOne({ owner: ownerId })
  if (!business) throw new NotFoundError('No tienes un negocio registrado')
  return business
}

async function findMyEvent(businessId: Types.ObjectId, eventId: string) {
  const event = isValidObjectId(eventId)
    ? await Event.findOne({ _id: eventId, business: businessId })
    : null
  if (!event) throw new NotFoundError(EVENT_NOT_FOUND_MESSAGE)
  return event
}

// RN-12. Un lugar ajeno, inexistente o inactivo responde igual, sin revelar cuál es el caso.
async function findMyActiveVenue(businessId: Types.ObjectId, venueId: string) {
  const venue = await Venue.findOne({ _id: venueId, business: businessId, isActive: true })
  if (!venue) {
    throw new ValidationError('Datos inválidos', [
      { path: 'venueId', message: 'El lugar no existe, no es de tu negocio o está inactivo' },
    ])
  }
  return venue
}

// RN-07: el borrador solo exige el título.
export async function createMyEventDraft(ownerId: string, input: CreateEventDraftInput) {
  const business = await myBusiness(ownerId)
  const { venueId, ...fields } = input
  const venue = venueId ? await findMyActiveVenue(business._id, venueId) : undefined

  const event = new Event({
    ...fields,
    ...(venue && venueFields(venue)),
    business: business._id,
    businessSnapshot: businessSnapshot(business),
    status: 'draft',
  })
  await event.save()
  return event
}

// Lo guardado, con la forma que esperan los esquemas de shared.
function toCandidate(event: EventDocument) {
  const { venue, startAt, endAt, price, ...fields } = event.toObject()
  return {
    title: fields.title,
    description: fields.description ?? undefined,
    category: fields.category ?? undefined,
    tags: fields.tags,
    externalUrl: fields.externalUrl ?? undefined,
    isAdultOnly: fields.isAdultOnly ?? undefined,
    coverImage: fields.coverImage ?? undefined,
    venueId: venue ? String(venue) : undefined,
    startAt: startAt?.toISOString(),
    endAt: endAt?.toISOString(),
    price: price?.type ? price : undefined,
  }
}

// Idempotente: publicar un evento ya publicado lo devuelve sin cambios (el slug no se toca, RN-13).
export async function publishMyEvent(ownerId: string, eventId: string) {
  const business = await myBusiness(ownerId)
  // RN-09
  if (business.verificationStatus !== 'approved') throw new BusinessNotApprovedError()

  const event = await findMyEvent(business._id, eventId)
  if (event.status === 'published') return event
  if (event.status !== 'draft') {
    throw new ConflictError('Solo se pueden publicar eventos en borrador')
  }

  // RN-08, RN-10, RN-11 y RN-14
  const result = eventPublishSchema.safeParse(toCandidate(event))
  if (!result.success) {
    throw new ValidationError(
      'El evento no está completo para publicarse',
      formatZodIssues(result.error),
    )
  }

  // El lugar pudo desactivarse desde que se guardó el borrador; las copias se refrescan al publicar.
  const venue = await findMyActiveVenue(business._id, result.data.venueId)
  event.set({
    ...venueFields(venue),
    businessSnapshot: businessSnapshot(business),
    status: 'published',
  })
  await event.save()
  return event
}

const ONGOING_EDITABLE: readonly string[] = ONGOING_EDITABLE_FIELDS

// RN-16
function assertOngoingEditable(input: UpdateEventInput) {
  const blocked = Object.keys(input).filter((field) => !ONGOING_EDITABLE.includes(field))
  if (blocked.length === 0) return
  throw new EventNotEditableError(
    'El evento está en curso: solo puedes editar descripción, precio, enlace externo y fecha de fin',
    blocked.map((path) => ({ path, message: 'No se puede editar mientras el evento está en curso' })),
  )
}

// Las reglas que cruzan campos se revisan sobre el evento ya combinado con los cambios:
// un borrador sigue siendo borrador (RN-07), un publicado sin empezar debe seguir siendo
// publicable (RN-08, RN-10, RN-11) y uno en curso solo puede mover su cierre (RN-16).
function assertValidAfterUpdate(event: EventDocument, phase: EventEditPhase) {
  const schema =
    event.status === 'draft'
      ? eventDraftSchema
      : phase === 'ongoing'
        ? eventOngoingSchema
        : eventPublishSchema
  const result = schema.safeParse(toCandidate(event))
  if (!result.success) throw new ValidationError('Datos inválidos', formatZodIssues(result.error))
}

// RN-15, RN-16 y RN-17. Al cambiar de lugar se refrescan la ubicación y la copia del lugar,
// así el mapa refleja el cambio de inmediato. El slug de un publicado no cambia (RN-13).
export async function updateMyEvent(ownerId: string, eventId: string, input: UpdateEventInput) {
  const business = await myBusiness(ownerId)
  const event = await findMyEvent(business._id, eventId)

  const phase = eventEditPhase(event)
  if (phase === 'locked') throw new EventNotEditableError()
  if (phase === 'ongoing') assertOngoingEditable(input)

  const { venueId, price, ...fields } = input
  event.set(fields)
  // El precio se reemplaza completo: un max anterior no sobrevive al pasar a gratis.
  if (price) event.set('price', price)
  if (venueId) event.set(venueFields(await findMyActiveVenue(business._id, venueId)))

  assertValidAfterUpdate(event, phase)
  await event.save()
  return event
}

// RN-20: copia todo menos fechas, slug y estado (y lo que depende de ellos: publicación,
// cancelación, retiro y estadísticas). Vale para cualquier estado, también los de solo lectura (RN-17).
// El lugar solo se copia si sigue activo (RN-12); si no, el gestor elige otro en el borrador.
export async function duplicateMyEvent(ownerId: string, eventId: string) {
  const business = await myBusiness(ownerId)
  const source = await findMyEvent(business._id, eventId)
  const venue = source.venue
    ? await Venue.findOne({ _id: source.venue, business: business._id, isActive: true })
    : null

  const { title, description, category, tags, price, coverImage, externalUrl, isAdultOnly } =
    source.toObject()
  const event = new Event({
    title,
    description,
    category,
    tags,
    price: price?.type ? price : undefined,
    coverImage,
    externalUrl,
    isAdultOnly,
    ...(venue && venueFields(venue)),
    business: business._id,
    businessSnapshot: businessSnapshot(business),
    status: 'draft',
  })
  await event.save()
  return event
}

// RN-18: solo un publicado que no ha terminado (puede estar en curso). Sale del mapa porque los
// listados públicos solo muestran publicados. Idempotente: cancelar dos veces conserva el primer motivo.
export async function cancelMyEvent(ownerId: string, eventId: string, input: CancelEventInput) {
  const business = await myBusiness(ownerId)
  const event = await findMyEvent(business._id, eventId)

  if (event.status === 'cancelled') return event
  if (event.status === 'draft') {
    throw new EventNotCancellableError('Un borrador no se cancela: elimínalo')
  }
  if (event.status !== 'published') {
    throw new EventNotCancellableError('Un evento retirado no se puede cancelar')
  }
  if (eventEditPhase(event) === 'locked') {
    throw new EventNotCancellableError('El evento ya finalizó: no se puede cancelar')
  }

  event.set({ status: 'cancelled', cancellationReason: input.reason, cancelledAt: new Date() })
  await event.save()
  return event
}

// RN-19: un publicado nunca se borra, para conservar el historial y no romper enlaces.
export async function deleteMyEvent(ownerId: string, eventId: string) {
  const business = await myBusiness(ownerId)
  const event = await findMyEvent(business._id, eventId)
  if (event.status !== 'draft') throw new EventNotDeletableError()
  // El filtro por estado evita borrar un borrador que se publicó entre la lectura y el borrado.
  const { deletedCount } = await Event.deleteOne({ _id: event._id, status: 'draft' })
  if (deletedCount === 0) throw new EventNotDeletableError()
}

// RF-GES-11. Próximos incluye los que están en curso: terminan después de ahora.
// Los operadores van en mongoose.trusted porque sanitizeFilter está activo (config/mongoose).
function tabFilter(tab: MyEventTab, now: Date): QueryFilter<EventDoc> {
  switch (tab) {
    case 'upcoming':
      return { status: 'published', endAt: mongoose.trusted({ $gt: now }) }
    case 'drafts':
      return { status: 'draft' }
    case 'past':
      return { status: 'published', endAt: mongoose.trusted({ $lte: now }) }
    case 'cancelled':
      return { status: mongoose.trusted({ $in: ['cancelled', 'removed'] }) }
  }
}

// Próximos, del más cercano al más lejano; pasados y cancelados, del más reciente al más antiguo.
// Los borradores pueden no tener fecha: van por la última edición. El _id desempata para que
// la paginación sea estable.
const TAB_SORT = {
  upcoming: { startAt: 1, _id: 1 },
  drafts: { updatedAt: -1, _id: -1 },
  past: { startAt: -1, _id: -1 },
  cancelled: { startAt: -1, _id: -1 },
} as const

const ROW_FIELDS =
  'title slug status startAt endAt coverImage venueSnapshot cancellationReason removalReason updatedAt'

export async function listMyEvents(ownerId: string, { tab, page }: ListMyEventsQuery) {
  const business = await myBusiness(ownerId)
  const now = new Date()
  const filter = { business: business._id, ...tabFilter(tab, now) }

  const [events, total] = await Promise.all([
    Event.find(filter)
      .select<EventDoc>(ROW_FIELDS)
      .sort(TAB_SORT[tab])
      .skip((page - 1) * MY_EVENTS_PAGE_SIZE)
      .limit(MY_EVENTS_PAGE_SIZE),
    Event.countDocuments(filter),
  ])

  const rows = events.map((event) => ({
    ...event.toJSON(),
    displayStatus: eventDisplayStatus(event, now),
    actions: eventActions(event, now),
  }))
  return { events: rows, pagination: { page, limit: MY_EVENTS_PAGE_SIZE, total } }
}

// Contadores del inicio del panel: uno por pestaña y, aparte, cuántos de los próximos están en curso.
export async function getMyEventsSummary(ownerId: string) {
  const business = await myBusiness(ownerId)
  const now = new Date()
  const count = (filter: QueryFilter<EventDoc>) => Event.countDocuments({ business: business._id, ...filter })

  const [upcoming, ongoing, drafts, past, cancelled] = await Promise.all([
    count(tabFilter('upcoming', now)),
    count({
      status: 'published',
      startAt: mongoose.trusted({ $lte: now }),
      endAt: mongoose.trusted({ $gt: now }),
    }),
    count(tabFilter('drafts', now)),
    count(tabFilter('past', now)),
    count(tabFilter('cancelled', now)),
  ])
  return { upcoming, ongoing, drafts, past, cancelled }
}
