import type { Server } from 'node:http'
import bcrypt from 'bcrypt'
import mongoose, { Types } from 'mongoose'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MANAGER_LIMITS } from '@parche/shared'
import { createApp } from '../app'
import { RefreshToken } from '../modules/auth/refresh-token.model'
import { Business } from '../modules/businesses/business.model'
import { User } from '../modules/users/user.model'
import { Venue } from '../modules/venues/venue.model'

const API = '/api/v1'
const VENUES = `${API}/me/venues`
const LAURELES = { lat: 6.2447, lng: -75.5906 }
const PROVENZA = { lat: 6.2087, lng: -75.5664 }
const BOGOTA = { lat: 4.711, lng: -74.0721 }

const validVenue = {
  name: 'Sede Laureles',
  address: 'Cra. 70 #44-35',
  neighborhood: 'Laureles',
  comuna: '11',
  location: LAURELES,
  referenceNotes: 'Frente al parque, segundo piso',
}

let server: Server
let baseUrl: string

beforeAll(async () => {
  await Promise.all([
    User.syncIndexes(),
    RefreshToken.syncIndexes(),
    Business.syncIndexes(),
    Venue.syncIndexes(),
  ])
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Business.deleteMany({}),
    RefreshToken.deleteMany({}),
    Venue.deleteMany({}),
  ])
})

async function registerManager(email = 'ana@correo.co') {
  const response = await request(baseUrl)
    .post(`${API}/auth/register/manager`)
    .send({
      name: 'Ana Pérez',
      email,
      password: 'clave1234',
      business: { name: `Negocio de ${email}`, type: 'cafe' },
    })
    .expect(201)
  return {
    auth: `Bearer ${response.body.data.accessToken}`,
    businessId: response.body.data.business.id as string,
  }
}

async function loginAs(role: 'user' | 'admin') {
  const email = `${role}@correo.co`
  await User.create({ name: 'Otra', email, passwordHash: await bcrypt.hash('clave1234', 4), role })
  const response = await request(baseUrl)
    .post(`${API}/auth/login`)
    .send({ email, password: 'clave1234' })
  return `Bearer ${response.body.data.accessToken}`
}

function createVenue(auth: string, body: Record<string, unknown> = validVenue) {
  return request(baseUrl).post(VENUES).set('Authorization', auth).send(body)
}

function patchVenue(auth: string, id: string, body: Record<string, unknown>) {
  return request(baseUrl).patch(`${VENUES}/${id}`).set('Authorization', auth).send(body)
}

function deactivateVenue(auth: string, id: string) {
  return request(baseUrl).post(`${VENUES}/${id}/deactivate`).set('Authorization', auth)
}

function seedVenues(businessId: string, count: number, isActive = true) {
  return Venue.insertMany(
    Array.from({ length: count }, (_, index) => ({
      business: businessId,
      name: `Sede ${index + 1}`,
      address: 'Calle 10 #40-20',
      neighborhood: 'El Poblado',
      comuna: '14',
      location: { type: 'Point', coordinates: [LAURELES.lng, LAURELES.lat] },
      isActive,
    })),
  )
}

describe('acceso a /me/venues', () => {
  it.each([
    ['GET', VENUES],
    ['POST', VENUES],
    ['GET', `${VENUES}/${new Types.ObjectId()}`],
    ['PATCH', `${VENUES}/${new Types.ObjectId()}`],
    ['POST', `${VENUES}/${new Types.ObjectId()}/deactivate`],
  ])('%s %s responde 401 sin token', async (method, path) => {
    const response = await request(baseUrl)[method.toLowerCase() as 'get' | 'post' | 'patch'](path)

    expect(response.status).toBe(401)
  })

  it.each(['user', 'admin'] as const)('responde 403 con rol %s', async (role) => {
    const auth = await loginAs(role)

    const [list, create] = await Promise.all([
      request(baseUrl).get(VENUES).set('Authorization', auth),
      createVenue(auth),
    ])

    expect(list.status).toBe(403)
    expect(create.status).toBe(403)
    expect(await Venue.countDocuments()).toBe(0)
  })
})

describe('POST /api/v1/me/venues', () => {
  it('crea el lugar y guarda la ubicación como GeoJSON [lng, lat]', async () => {
    const { auth, businessId } = await registerManager()

    const response = await createVenue(auth)

    expect(response.status).toBe(201)
    expect(response.body.data.venue).toMatchObject({
      name: 'Sede Laureles',
      business: businessId,
      municipality: 'medellin',
      isActive: true,
      location: { type: 'Point', coordinates: [LAURELES.lng, LAURELES.lat] },
    })
    const raw = await mongoose.connection.collection('venues').findOne()
    expect(raw?.location).toEqual({ type: 'Point', coordinates: [-75.5906, 6.2447] })
  })

  it('el negocio lo toma del token, no del body', async () => {
    const { auth, businessId } = await registerManager()

    const response = await createVenue(auth, {
      ...validVenue,
      business: new Types.ObjectId().toString(),
      isActive: false,
    })

    expect(response.body.data.venue).toMatchObject({ business: businessId, isActive: true })
  })

  it.each([
    ['en Bogotá', BOGOTA],
    ['con lat y lng invertidas', { lat: LAURELES.lng, lng: LAURELES.lat }],
    ['justo fuera del borde norte', { lat: 6.5001, lng: -75.5 }],
  ])('responde 422 OUT_OF_SERVICE_AREA %s', async (_case, location) => {
    const { auth } = await registerManager()

    const response = await createVenue(auth, { ...validVenue, location })

    expect(response.status).toBe(422)
    expect(response.body.error).toEqual({
      code: 'OUT_OF_SERVICE_AREA',
      message: 'La ubicación está fuera del área de servicio',
    })
    expect(await Venue.countDocuments()).toBe(0)
  })

  it('acepta una ubicación en el borde del área de servicio', async () => {
    const { auth } = await registerManager()

    await createVenue(auth, { ...validVenue, location: { lat: 6.5, lng: -75.3 } }).expect(201)
  })

  it.each([
    [
      'sin campos obligatorios',
      {},
      ['body.name', 'body.address', 'body.neighborhood', 'body.comuna', 'body.location'],
    ],
    ['con comuna inválida', { ...validVenue, comuna: '17' }, ['body.comuna']],
    [
      'con municipio no disponible',
      { ...validVenue, municipality: 'bogota' },
      ['body.municipality'],
    ],
    [
      'con coordenadas como texto',
      { ...validVenue, location: { lat: '6.24', lng: '-75.59' } },
      ['body.location.lat', 'body.location.lng'],
    ],
    [
      'con GeoJSON en vez de { lat, lng }',
      { ...validVenue, location: { type: 'Point', coordinates: [-75.59, 6.24] } },
      ['body.location.lat', 'body.location.lng'],
    ],
    [
      'con indicaciones de más de 200 caracteres',
      { ...validVenue, referenceNotes: 'x'.repeat(201) },
      ['body.referenceNotes'],
    ],
  ])('responde 400 %s', async (_case, body, paths) => {
    const { auth } = await registerManager()

    const response = await createVenue(auth, body)

    expect(response.status).toBe(400)
    const received = response.body.error.details.map((detail: { path: string }) => detail.path)
    expect(received).toEqual(expect.arrayContaining(paths))
  })
})

describe('RN-30: máximo de lugares activos por gestor', () => {
  it(`permite hasta ${MANAGER_LIMITS.maxActiveVenues} y responde 409 LIMIT_REACHED al superar`, async () => {
    const { auth, businessId } = await registerManager()
    await seedVenues(businessId, MANAGER_LIMITS.maxActiveVenues - 1)

    await createVenue(auth).expect(201)
    const response = await createVenue(auth)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('LIMIT_REACHED')
    expect(await Venue.countDocuments({ isActive: true })).toBe(MANAGER_LIMITS.maxActiveVenues)
  })

  it('los lugares inactivos no cuentan para el límite', async () => {
    const { auth, businessId } = await registerManager()
    await seedVenues(businessId, MANAGER_LIMITS.maxActiveVenues - 1)
    await seedVenues(businessId, 5, false)

    await createVenue(auth).expect(201)
  })

  it('el límite es por gestor: los lugares de otro gestor no cuentan', async () => {
    const other = await registerManager('luis@correo.co')
    await seedVenues(other.businessId, MANAGER_LIMITS.maxActiveVenues)
    const { auth } = await registerManager()

    await createVenue(auth).expect(201)
  })

  it('reactivar un lugar con el límite alcanzado responde 409 y lo deja inactivo', async () => {
    const { auth, businessId } = await registerManager()
    await seedVenues(businessId, MANAGER_LIMITS.maxActiveVenues)
    const [inactive] = await seedVenues(businessId, 1, false)

    const response = await patchVenue(auth, String(inactive!._id), { isActive: true })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('LIMIT_REACHED')
    expect(await Venue.findById(inactive!._id)).toMatchObject({ isActive: false })
  })

  it('con el límite alcanzado se puede desactivar uno y crear otro', async () => {
    const { auth, businessId } = await registerManager()
    const [first] = await seedVenues(businessId, MANAGER_LIMITS.maxActiveVenues)

    await patchVenue(auth, String(first!._id), { isActive: false }).expect(200)

    await createVenue(auth).expect(201)
  })

  it('con el límite alcanzado se pueden editar los lugares activos', async () => {
    const { auth, businessId } = await registerManager()
    const [first] = await seedVenues(businessId, MANAGER_LIMITS.maxActiveVenues)

    await patchVenue(auth, String(first!._id), { name: 'Sede Renombrada', isActive: true }).expect(
      200,
    )
  })

  it('creaciones simultáneas nunca superan el límite', async () => {
    const { auth, businessId } = await registerManager()
    await seedVenues(businessId, MANAGER_LIMITS.maxActiveVenues - 2)

    const responses = await Promise.all(Array.from({ length: 6 }, () => createVenue(auth)))

    const statuses = responses.map((response) => response.status)
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true)
    expect(await Venue.countDocuments({ isActive: true })).toBeLessThanOrEqual(
      MANAGER_LIMITS.maxActiveVenues,
    )
  })
})

describe('GET /api/v1/me/venues', () => {
  it('lista solo los lugares del gestor, activos primero', async () => {
    const managerA = await registerManager()
    const managerB = await registerManager('luis@correo.co')
    await createVenue(managerA.auth).expect(201)
    const inactive = await createVenue(managerA.auth, { ...validVenue, name: 'Sede Vieja' })
    await patchVenue(managerA.auth, inactive.body.data.venue.id, { isActive: false })
    await createVenue(managerB.auth, { ...validVenue, name: 'Sede de B' }).expect(201)

    const response = await request(baseUrl).get(VENUES).set('Authorization', managerA.auth)

    expect(response.status).toBe(200)
    expect(response.body.data.venues.map((venue: { name: string }) => venue.name)).toEqual([
      'Sede Laureles',
      'Sede Vieja',
    ])
  })

  it('devuelve una lista vacía si el gestor no tiene lugares', async () => {
    const { auth } = await registerManager()

    const response = await request(baseUrl).get(VENUES).set('Authorization', auth)

    expect(response.body.data.venues).toEqual([])
  })

  it('devuelve el detalle de un lugar propio', async () => {
    const { auth } = await registerManager()
    const created = await createVenue(auth)

    const response = await request(baseUrl)
      .get(`${VENUES}/${created.body.data.venue.id}`)
      .set('Authorization', auth)

    expect(response.status).toBe(200)
    expect(response.body.data.venue.name).toBe('Sede Laureles')
  })
})

describe('aislamiento entre gestores', () => {
  async function venueOfManagerB() {
    const managerB = await registerManager('luis@correo.co')
    const created = await createVenue(managerB.auth, { ...validVenue, name: 'Sede de B' })
    return created.body.data.venue.id as string
  }

  it('el gestor A recibe 404 al pedir un lugar del gestor B', async () => {
    const { auth } = await registerManager()
    const venueOfB = await venueOfManagerB()

    const response = await request(baseUrl).get(`${VENUES}/${venueOfB}`).set('Authorization', auth)

    expect(response.status).toBe(404)
    expect(response.body.error).toEqual({ code: 'NOT_FOUND', message: 'Lugar no encontrado' })
  })

  it('el gestor A recibe 404 al editar un lugar del gestor B y no cambia nada', async () => {
    const { auth } = await registerManager()
    const venueOfB = await venueOfManagerB()

    await patchVenue(auth, venueOfB, { name: 'Hackeado', isActive: false }).expect(404)

    expect(await Venue.findById(venueOfB)).toMatchObject({ name: 'Sede de B', isActive: true })
  })

  it('un id inexistente y uno mal formado responden igual (404)', async () => {
    const { auth } = await registerManager()

    const missing = await request(baseUrl)
      .get(`${VENUES}/${new Types.ObjectId()}`)
      .set('Authorization', auth)
    const malformed = await request(baseUrl).get(`${VENUES}/no-es-un-id`).set('Authorization', auth)

    expect(missing.status).toBe(404)
    expect(malformed.status).toBe(404)
    expect(malformed.body).toEqual(missing.body)
  })
})

describe('PATCH /api/v1/me/venues/:id', () => {
  it('actualiza parcialmente sin tocar los demás campos', async () => {
    const { auth } = await registerManager()
    const created = await createVenue(auth)

    const response = await patchVenue(auth, created.body.data.venue.id, {
      name: 'Sede Laureles 70',
    })

    expect(response.status).toBe(200)
    expect(response.body.data.venue).toMatchObject({
      name: 'Sede Laureles 70',
      address: 'Cra. 70 #44-35',
      location: { type: 'Point', coordinates: [LAURELES.lng, LAURELES.lat] },
    })
  })

  it('cambia la ubicación y la guarda como [lng, lat]', async () => {
    const { auth } = await registerManager()
    const created = await createVenue(auth)

    const response = await patchVenue(auth, created.body.data.venue.id, { location: PROVENZA })

    expect(response.body.data.venue.location.coordinates).toEqual([PROVENZA.lng, PROVENZA.lat])
  })

  it('responde 422 OUT_OF_SERVICE_AREA y no cambia la ubicación', async () => {
    const { auth } = await registerManager()
    const created = await createVenue(auth)

    const response = await patchVenue(auth, created.body.data.venue.id, {
      name: 'Sede Bogotá',
      location: BOGOTA,
    })

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('OUT_OF_SERVICE_AREA')
    expect(await Venue.findById(created.body.data.venue.id)).toMatchObject({
      name: 'Sede Laureles',
      location: { coordinates: [LAURELES.lng, LAURELES.lat] },
    })
  })

  it('null borra las indicaciones', async () => {
    const { auth } = await registerManager()
    const created = await createVenue(auth)

    const response = await patchVenue(auth, created.body.data.venue.id, { referenceNotes: null })

    expect(response.status).toBe(200)
    expect(response.body.data.venue).not.toHaveProperty('referenceNotes')
  })

  it('no permite cambiar el negocio dueño', async () => {
    const { auth, businessId } = await registerManager()
    const created = await createVenue(auth)

    await patchVenue(auth, created.body.data.venue.id, {
      name: 'Sede Nueva',
      business: new Types.ObjectId().toString(),
    }).expect(200)

    expect(String((await Venue.findById(created.body.data.venue.id))?.business)).toBe(businessId)
  })

  it('responde 400 con body vacío o datos inválidos', async () => {
    const { auth } = await registerManager()
    const created = await createVenue(auth)
    const id = created.body.data.venue.id

    await patchVenue(auth, id, {}).expect(400)
    await patchVenue(auth, id, { isActive: 'no' }).expect(400)
    await patchVenue(auth, id, { address: 'Cra' }).expect(400)
  })
})

describe('POST /api/v1/me/venues/:id/deactivate', () => {
  it('marca isActive = false y devuelve el lugar', async () => {
    const { auth } = await registerManager()
    const created = await createVenue(auth)

    const response = await deactivateVenue(auth, created.body.data.venue.id)

    expect(response.status).toBe(200)
    expect(response.body.data.venue).toMatchObject({ name: 'Sede Laureles', isActive: false })
    expect(await Venue.findById(created.body.data.venue.id)).toMatchObject({ isActive: false })
  })

  it('es idempotente: desactivar un lugar ya inactivo responde 200', async () => {
    const { auth, businessId } = await registerManager()
    const [inactive] = await seedVenues(businessId, 1, false)

    const response = await deactivateVenue(auth, String(inactive!._id))

    expect(response.status).toBe(200)
    expect(response.body.data.venue.isActive).toBe(false)
  })

  it('libera un cupo cuando el límite de lugares activos está alcanzado', async () => {
    const { auth, businessId } = await registerManager()
    const [first] = await seedVenues(businessId, MANAGER_LIMITS.maxActiveVenues)

    await deactivateVenue(auth, String(first!._id)).expect(200)

    await createVenue(auth).expect(201)
  })

  it('responde 403 con rol user', async () => {
    const auth = await loginAs('user')

    const response = await deactivateVenue(auth, String(new Types.ObjectId()))

    expect(response.status).toBe(403)
  })

  it('el gestor A recibe 404 al desactivar un lugar del gestor B y no cambia nada', async () => {
    const { auth } = await registerManager()
    const managerB = await registerManager('luis@correo.co')
    const created = await createVenue(managerB.auth, { ...validVenue, name: 'Sede de B' })

    const response = await deactivateVenue(auth, created.body.data.venue.id)

    expect(response.status).toBe(404)
    expect(response.body.error).toEqual({ code: 'NOT_FOUND', message: 'Lugar no encontrado' })
    expect(await Venue.findById(created.body.data.venue.id)).toMatchObject({ isActive: true })
  })

  it('responde 404 con un id mal formado', async () => {
    const { auth } = await registerManager()

    await deactivateVenue(auth, 'no-es-un-id').expect(404)
  })
})

describe('lugares disponibles para crear eventos (GET /me/venues?active=true)', () => {
  it('los lugares inactivos no se ofrecen', async () => {
    const { auth } = await registerManager()
    await createVenue(auth).expect(201)
    const old = await createVenue(auth, { ...validVenue, name: 'Sede Vieja' })
    await deactivateVenue(auth, old.body.data.venue.id).expect(200)

    const response = await request(baseUrl).get(`${VENUES}?active=true`).set('Authorization', auth)

    expect(response.status).toBe(200)
    expect(response.body.data.venues.map((venue: { name: string }) => venue.name)).toEqual([
      'Sede Laureles',
    ])
  })

  it('active=false devuelve solo los inactivos y sin filtro devuelve todos', async () => {
    const { auth, businessId } = await registerManager()
    await seedVenues(businessId, 2)
    await seedVenues(businessId, 1, false)

    const inactive = await request(baseUrl).get(`${VENUES}?active=false`).set('Authorization', auth)
    const all = await request(baseUrl).get(VENUES).set('Authorization', auth)

    expect(inactive.body.data.venues).toHaveLength(1)
    expect(inactive.body.data.venues[0].isActive).toBe(false)
    expect(all.body.data.venues).toHaveLength(3)
  })

  it('responde 400 con un valor de active inválido', async () => {
    const { auth } = await registerManager()

    const response = await request(baseUrl).get(`${VENUES}?active=si`).set('Authorization', auth)

    expect(response.status).toBe(400)
    expect(response.body.error.details[0].path).toBe('query.active')
  })
})
