import { isValidObjectId, type Types } from 'mongoose'
import { MANAGER_LIMITS, isInServiceArea } from '@parche/shared'
import {
  LimitReachedError,
  NotFoundError,
  OutOfServiceAreaError,
  VenueHasUpcomingEventsError,
} from '../../utils/app-error'
import { Business } from '../businesses/business.model'
import { countUpcomingPublishedAt, syncVenueCopies } from '../events/event-sync.service'
import { Venue } from './venue.model'
import type {
  CreateVenueInput,
  ListVenuesQuery,
  LocationInput,
  UpdateVenueInput,
} from './venue.schemas'

const VENUE_NOT_FOUND_MESSAGE = 'Lugar no encontrado'
const VENUE_LIMIT_MESSAGE = `Alcanzaste el máximo de ${MANAGER_LIMITS.maxActiveVenues} lugares activos. Desactiva uno para agregar otro.`

async function myBusinessId(ownerId: string) {
  const business = await Business.findOne({ owner: ownerId }).select('_id')
  if (!business) throw new NotFoundError('No tienes un negocio registrado')
  return business._id
}

// RN-23
function toPoint({ lat, lng }: LocationInput) {
  if (!isInServiceArea(lat, lng)) throw new OutOfServiceAreaError()
  return { type: 'Point' as const, coordinates: [lng, lat] }
}

function countActiveVenues(businessId: Types.ObjectId) {
  return Venue.countDocuments({ business: businessId, isActive: true })
}

// RN-30. Se verifica antes de escribir y otra vez después: si dos peticiones simultáneas
// superan el límite, `rollback` deshace la escritura y nunca se queda por encima.
async function withinActiveVenueLimit(
  businessId: Types.ObjectId,
  write: () => Promise<void>,
  rollback: () => Promise<unknown>,
) {
  if ((await countActiveVenues(businessId)) >= MANAGER_LIMITS.maxActiveVenues) {
    throw new LimitReachedError(VENUE_LIMIT_MESSAGE)
  }

  await write()

  if ((await countActiveVenues(businessId)) > MANAGER_LIMITS.maxActiveVenues) {
    await rollback()
    throw new LimitReachedError(VENUE_LIMIT_MESSAGE)
  }
}

// `active: true` es la lista que se ofrece al crear eventos: los lugares inactivos no aparecen.
export async function listMyVenues(ownerId: string, { active }: ListVenuesQuery = {}) {
  const businessId = await myBusinessId(ownerId)
  const filter = active === undefined ? {} : { isActive: active }
  return Venue.find({ business: businessId, ...filter }).sort({ isActive: -1, createdAt: -1 })
}

// Un id ajeno o mal formado responde 404, sin revelar si el lugar existe.
async function findMyVenue(businessId: Types.ObjectId, venueId: string) {
  const venue = isValidObjectId(venueId)
    ? await Venue.findOne({ _id: venueId, business: businessId })
    : null
  if (!venue) throw new NotFoundError(VENUE_NOT_FOUND_MESSAGE)
  return venue
}

export async function getMyVenue(ownerId: string, venueId: string) {
  return findMyVenue(await myBusinessId(ownerId), venueId)
}

export async function createMyVenue(ownerId: string, input: CreateVenueInput) {
  const businessId = await myBusinessId(ownerId)
  const venue = new Venue({ ...input, business: businessId, location: toPoint(input.location) })

  await withinActiveVenueLimit(
    businessId,
    async () => {
      await venue.save()
    },
    () => Venue.deleteOne({ _id: venue._id }),
  )
  return venue
}

// RN-25: campos que los eventos copian en location y venueSnapshot.
const COPIED_FIELDS = ['name', 'address', 'neighborhood', 'comuna', 'location'] as const

// RN-24
async function assertNoUpcomingEvents(venueId: Types.ObjectId) {
  const count = await countUpcomingPublishedAt(venueId)
  if (count > 0) throw new VenueHasUpcomingEventsError(count)
}

export async function updateMyVenue(ownerId: string, venueId: string, input: UpdateVenueInput) {
  const businessId = await myBusinessId(ownerId)
  const venue = await findMyVenue(businessId, venueId)

  const { location, referenceNotes, ...fields } = input
  venue.set(fields)
  if (location) venue.set('location', toPoint(location))
  if (referenceNotes !== undefined) venue.set('referenceNotes', referenceNotes ?? undefined)

  const reactivating = venue.isModified('isActive') && venue.isActive
  const deactivating = venue.isModified('isActive') && !venue.isActive
  const copiesChanged = COPIED_FIELDS.some((field) => venue.isModified(field))

  if (deactivating) await assertNoUpcomingEvents(venue._id)

  if (reactivating) {
    await withinActiveVenueLimit(
      businessId,
      async () => {
        await venue.save()
      },
      () => Venue.updateOne({ _id: venue._id }, { isActive: false }),
    )
  } else {
    await venue.save()
  }

  if (copiesChanged) await syncVenueCopies(venue)
  return venue
}

// Idempotente: desactivar un lugar ya inactivo responde igual.
export async function deactivateMyVenue(ownerId: string, venueId: string) {
  const venue = await findMyVenue(await myBusinessId(ownerId), venueId)
  if (!venue.isActive) return venue
  await assertNoUpcomingEvents(venue._id)
  venue.isActive = false
  await venue.save()
  return venue
}
