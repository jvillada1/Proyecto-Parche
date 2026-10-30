import mongoose, { type QueryFilter, type Types } from 'mongoose'
import type { Business } from '../businesses/business.model'
import type { Venue } from '../venues/venue.model'
import { Event, type EventDoc } from './event.model'

type BusinessDocument = InstanceType<typeof Business>
type VenueDocument = InstanceType<typeof Venue>

// Sección 8.6: el evento guarda copias del lugar y del negocio para que el mapa y las tarjetas
// no necesiten $lookup y puedan usar el índice geoespacial. Este módulo es el único que las
// escribe; los demás servicios lo llaman, nunca los controladores.

export function businessSnapshot(business: BusinessDocument) {
  return { name: business.name, slug: business.slug ?? undefined, logoUrl: business.logo?.url }
}

export function venueSnapshot(venue: VenueDocument) {
  return {
    name: venue.name,
    address: venue.address,
    neighborhood: venue.neighborhood,
    comuna: venue.comuna,
  }
}

// Copias del lugar para pintar tarjetas y buscar por cercanía sin consultar venues.
export function venueFields(venue: VenueDocument) {
  return {
    venue: venue._id,
    location: { type: 'Point', coordinates: [...venue.location.coordinates] },
    venueSnapshot: venueSnapshot(venue),
  }
}

// Los borradores nunca finalizan; el resto, hasta que pasa su endAt. Los operadores van en
// mongoose.trusted porque sanitizeFilter está activo (config/mongoose).
function notFinished(now: Date): QueryFilter<EventDoc> {
  return { $or: [{ status: 'draft' }, { endAt: mongoose.trusted({ $gt: now }) }] }
}

// RN-25. Los eventos finalizados conservan el lugar tal como era cuando ocurrieron.
export async function syncVenueCopies(venue: VenueDocument) {
  const { venue: _id, ...copies } = venueFields(venue)
  await Event.updateMany({ venue: venue._id, ...notFinished(new Date()) }, { $set: copies })
}

// RN-26
export async function syncBusinessSnapshot(business: BusinessDocument) {
  await Event.updateMany(
    { business: business._id, ...notFinished(new Date()) },
    { $set: { businessSnapshot: businessSnapshot(business) } },
  )
}

// RN-24: publicados que aún no terminan, incluidos los que están en curso.
export function countUpcomingPublishedAt(venueId: Types.ObjectId) {
  return Event.countDocuments({
    venue: venueId,
    status: 'published',
    endAt: mongoose.trusted({ $gt: new Date() }),
  })
}
