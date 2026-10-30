import { Types } from 'mongoose'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { RefreshToken } from '../modules/auth/refresh-token.model'
import { Business } from '../modules/businesses/business.model'
import { Event } from '../modules/events/event.model'
import { User } from '../modules/users/user.model'
import { Venue } from '../modules/venues/venue.model'

const API = '/api/v1'
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const LAURELES = [-75.5906, 6.2447]
const PROVENZA = { lat: 6.2087, lng: -75.5659 }

// La carpeta y la nube coinciden con las variables de entorno de tests/setup.ts.
const COVER = {
  url: 'https://res.cloudinary.com/parche-test/image/upload/v1/parche-test/evento.jpg',
  publicId: 'parche-test/evento',
  width: 1920,
  height: 1080,
}
const LOGO = {
  url: 'https://res.cloudinary.com/parche-test/image/upload/v1/parche-test/logo.png',
  publicId: 'parche-test/logo',
}

const app = createApp()

beforeAll(async () => {
  await Event.init()
})

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Business.deleteMany({}),
    RefreshToken.deleteMany({}),
    Venue.deleteMany({}),
    Event.deleteMany({}),
  ])
})

const inFuture = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

async function approvedManager() {
  const response = await request(app)
    .post(`${API}/auth/register/manager`)
    .send({
      name: 'Ana Pérez',
      email: 'ana@correo.co',
      password: 'clave1234',
      business: { name: 'Café Laureles', type: 'cafe' },
    })
    .expect(201)
  const businessId = response.body.data.business.id as string
  await Business.updateOne({ _id: businessId }, { verificationStatus: 'approved' })
  return { auth: `Bearer ${response.body.data.accessToken}`, businessId }
}

async function createVenue(businessId: string, overrides: Record<string, unknown> = {}) {
  const venue = await Venue.create({
    business: businessId,
    name: 'Sede Laureles',
    address: 'Cra. 70 #44-35',
    neighborhood: 'Laureles',
    comuna: '11',
    location: { type: 'Point', coordinates: LAURELES },
    ...overrides,
  })
  return String(venue._id)
}

async function publishedEvent(auth: string, venueId: string) {
  const created = await request(app)
    .post(`${API}/me/events`)
    .set('Authorization', auth)
    .send({
      title: 'Noche de jazz en Laureles',
      description: 'Trío de jazz en vivo con repertorio de standards y bossa nova.',
      category: 'musica-en-vivo',
      venueId,
      startAt: inFuture(2 * DAY),
      endAt: inFuture(2 * DAY + 3 * HOUR),
      price: { type: 'free', min: 0 },
      coverImage: COVER,
    })
    .expect(201)
  const id = created.body.data.event.id as string
  await request(app).post(`${API}/me/events/${id}/publish`).set('Authorization', auth).expect(200)
  return id
}

async function draft(auth: string, venueId: string) {
  const created = await request(app)
    .post(`${API}/me/events`)
    .set('Authorization', auth)
    .send({ title: 'Borrador en Laureles', venueId })
    .expect(201)
  return created.body.data.event.id as string
}

// Un evento que ya terminó, con las copias como estaban cuando ocurrió.
async function finishedEvent(businessId: string, venueId: string) {
  const { insertedId } = await Event.collection.insertOne({
    business: new Types.ObjectId(businessId),
    venue: new Types.ObjectId(venueId),
    title: 'Evento de la semana pasada',
    slug: `evento-pasado-${new Types.ObjectId()}`,
    status: 'published',
    startAt: new Date(Date.now() - 7 * DAY),
    endAt: new Date(Date.now() - 7 * DAY + HOUR),
    location: { type: 'Point', coordinates: LAURELES },
    venueSnapshot: {
      name: 'Sede Laureles',
      address: 'Cra. 70 #44-35',
      neighborhood: 'Laureles',
      comuna: '11',
    },
    businessSnapshot: { name: 'Café Laureles' },
  })
  return String(insertedId)
}

// Corre o termina el evento sin pasar por la API.
async function moveDates(id: string, startOffset: number, endOffset: number) {
  await Event.updateOne(
    { _id: id },
    { startAt: new Date(Date.now() + startOffset), endAt: new Date(Date.now() + endOffset) },
  )
}

function updateVenue(auth: string, id: string, body: Record<string, unknown>) {
  return request(app).patch(`${API}/me/venues/${id}`).set('Authorization', auth).send(body)
}

function deactivateVenue(auth: string, id: string) {
  return request(app).post(`${API}/me/venues/${id}/deactivate`).set('Authorization', auth)
}

function updateBusiness(auth: string, body: Record<string, unknown>) {
  return request(app).patch(`${API}/me/business`).set('Authorization', auth).send(body)
}

describe('copias al publicar', () => {
  it('el evento guarda la ubicación y los datos del lugar y del negocio', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)

    const id = await publishedEvent(auth, venueId)

    const event = (await Event.findById(id))!.toObject()
    expect(event.location).toEqual({ type: 'Point', coordinates: LAURELES })
    expect(event.venueSnapshot).toEqual({
      name: 'Sede Laureles',
      address: 'Cra. 70 #44-35',
      neighborhood: 'Laureles',
      comuna: '11',
    })
    expect(event.businessSnapshot).toMatchObject({ name: 'Café Laureles' })
  })
})

describe('RN-25: cambios del lugar', () => {
  it('mover el lugar actualiza la ubicación de sus eventos no finalizados', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const upcoming = await publishedEvent(auth, venueId)
    const draftId = await draft(auth, venueId)
    const finished = await finishedEvent(businessId, venueId)

    await updateVenue(auth, venueId, {
      location: PROVENZA,
      address: 'Cl. 10 #35-20',
      neighborhood: 'El Poblado',
      comuna: '14',
    }).expect(200)

    for (const id of [upcoming, draftId]) {
      const event = (await Event.findById(id))!.toObject()
      expect(event.location!.coordinates).toEqual([PROVENZA.lng, PROVENZA.lat])
      expect(event.venueSnapshot).toMatchObject({
        address: 'Cl. 10 #35-20',
        neighborhood: 'El Poblado',
        comuna: '14',
      })
    }
    const past = (await Event.findById(finished))!.toObject()
    expect(past.location!.coordinates).toEqual(LAURELES)
    expect(past.venueSnapshot!.neighborhood).toBe('Laureles')
  })

  it('renombrar el lugar actualiza venueSnapshot, también en eventos en curso', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const ongoing = await publishedEvent(auth, venueId)
    await moveDates(ongoing, -HOUR, HOUR)

    await updateVenue(auth, venueId, { name: 'Sede Laureles Renovada' }).expect(200)

    expect((await Event.findById(ongoing))!.venueSnapshot!.name).toBe('Sede Laureles Renovada')
  })

  it('no toca eventos de otros lugares', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const otherVenueId = await createVenue(businessId, { name: 'Sede Centro' })
    const other = await publishedEvent(auth, otherVenueId)

    await updateVenue(auth, venueId, { name: 'Sede Laureles Renovada' }).expect(200)

    expect((await Event.findById(other))!.venueSnapshot!.name).toBe('Sede Centro')
  })

  it('un cambio que no afecta las copias no reescribe los eventos', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const id = await publishedEvent(auth, venueId)
    const before = (await Event.findById(id))!.updatedAt

    await updateVenue(auth, venueId, { referenceNotes: 'Frente al parque' }).expect(200)

    expect((await Event.findById(id))!.updatedAt).toEqual(before)
  })
})

describe('RN-26: cambios del negocio', () => {
  it('cambiar el nombre o el logo actualiza businessSnapshot en sus eventos no finalizados', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const upcoming = await publishedEvent(auth, venueId)
    const draftId = await draft(auth, venueId)
    const finished = await finishedEvent(businessId, venueId)

    await updateBusiness(auth, { name: 'Café Laureles 70', logo: LOGO }).expect(200)

    for (const id of [upcoming, draftId]) {
      expect((await Event.findById(id))!.toObject().businessSnapshot).toMatchObject({
        name: 'Café Laureles 70',
        logoUrl: LOGO.url,
      })
    }
    expect((await Event.findById(finished))!.businessSnapshot!.name).toBe('Café Laureles')
  })

  it('quitar el logo lo quita de las copias', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    await updateBusiness(auth, { logo: LOGO }).expect(200)
    const id = await publishedEvent(auth, venueId)

    await updateBusiness(auth, { logo: null }).expect(200)

    expect((await Event.findById(id))!.toObject().businessSnapshot).not.toHaveProperty('logoUrl')
  })

  it('un cambio que no afecta las copias no reescribe los eventos', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const id = await publishedEvent(auth, venueId)
    const before = (await Event.findById(id))!.updatedAt

    await updateBusiness(auth, { description: 'Café de especialidad en Laureles' }).expect(200)

    expect((await Event.findById(id))!.updatedAt).toEqual(before)
  })
})

describe('RN-24: desactivar un lugar con eventos publicados futuros', () => {
  it.each([
    ['POST /deactivate', (auth: string, id: string) => deactivateVenue(auth, id)],
    ['PATCH isActive=false', (auth: string, id: string) => updateVenue(auth, id, { isActive: false })],
  ])('%s responde 409 VENUE_HAS_UPCOMING_EVENTS', async (_case, deactivate) => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    await publishedEvent(auth, venueId)

    const response = await deactivate(auth, venueId)

    expect(response.status).toBe(409)
    expect(response.body.error).toMatchObject({
      code: 'VENUE_HAS_UPCOMING_EVENTS',
      message:
        'Este lugar tiene 1 evento publicado que aún no termina. Cancélalos o muévelos a otro lugar antes de desactivarlo.',
    })
    expect((await Venue.findById(venueId))!.isActive).toBe(true)
  })

  it('un evento en curso también lo impide', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const id = await publishedEvent(auth, venueId)
    await moveDates(id, -HOUR, HOUR)

    expect((await deactivateVenue(auth, venueId)).status).toBe(409)
  })

  it('se puede desactivar tras cancelar el evento', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const id = await publishedEvent(auth, venueId)
    await request(app)
      .post(`${API}/me/events/${id}/cancel`)
      .set('Authorization', auth)
      .send({ reason: 'Se cancela por lluvia fuerte' })
      .expect(200)

    expect((await deactivateVenue(auth, venueId)).status).toBe(200)
  })

  it('se puede desactivar tras mover el evento a otro lugar', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const otherVenueId = await createVenue(businessId, { name: 'Sede Centro' })
    const id = await publishedEvent(auth, venueId)
    await request(app)
      .patch(`${API}/me/events/${id}`)
      .set('Authorization', auth)
      .send({ venueId: otherVenueId })
      .expect(200)

    expect((await deactivateVenue(auth, venueId)).status).toBe(200)
  })

  it('los borradores y los eventos finalizados no lo impiden', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    await draft(auth, venueId)
    await finishedEvent(businessId, venueId)

    const response = await deactivateVenue(auth, venueId)

    expect(response.status).toBe(200)
    expect(response.body.data.venue.isActive).toBe(false)
  })

  it('desactivar un lugar ya inactivo sigue siendo idempotente', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId, { isActive: false })

    expect((await deactivateVenue(auth, venueId)).status).toBe(200)
  })
})
