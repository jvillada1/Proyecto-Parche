import type { Server } from 'node:http'
import bcrypt from 'bcrypt'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { RefreshToken } from '../modules/auth/refresh-token.model'
import { Business } from '../modules/businesses/business.model'
import { User } from '../modules/users/user.model'

const API = '/api/v1'
const MY_BUSINESS = `${API}/me/business`
const REVIEW_REQUEST = `${MY_BUSINESS}/review-request`
const manager = {
  name: 'Ana Pérez',
  email: 'ana@correo.co',
  password: 'clave1234',
  business: { name: 'Café La Ceiba', type: 'cafe' },
}

let server: Server
let baseUrl: string

beforeAll(async () => {
  await Promise.all([User.syncIndexes(), RefreshToken.syncIndexes(), Business.syncIndexes()])
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Business.deleteMany({}), RefreshToken.deleteMany({})])
})

async function registerManager() {
  const response = await request(baseUrl)
    .post(`${API}/auth/register/manager`)
    .send(manager)
    .expect(201)
  return `Bearer ${response.body.data.accessToken}`
}

async function loginAs(role: 'user' | 'admin') {
  const email = `${role}@correo.co`
  await User.create({
    name: 'Otra Persona',
    email,
    passwordHash: await bcrypt.hash('clave1234', 4),
    role,
  })
  const response = await request(baseUrl)
    .post(`${API}/auth/login`)
    .send({ email, password: 'clave1234' })
    .expect(200)
  return `Bearer ${response.body.data.accessToken}`
}

function rejectBusiness() {
  return Business.updateOne(
    {},
    {
      verificationStatus: 'rejected',
      rejectionReason: 'El nombre no coincide con el RUT enviado',
      verifiedAt: new Date(),
      verifiedBy: new mongoose.Types.ObjectId(),
    },
  )
}

function getMyBusiness(auth: string) {
  return request(baseUrl).get(MY_BUSINESS).set('Authorization', auth)
}

function patchMyBusiness(auth: string, body: Record<string, unknown>) {
  return request(baseUrl).patch(MY_BUSINESS).set('Authorization', auth).send(body)
}

function detailPaths(response: request.Response) {
  return response.body.error.details.map((detail: { path: string }) => detail.path)
}

describe('acceso a /me/business', () => {
  it.each([
    ['GET', MY_BUSINESS],
    ['PATCH', MY_BUSINESS],
    ['POST', REVIEW_REQUEST],
  ])('%s %s responde 401 sin token', async (method, path) => {
    const response = await request(baseUrl)[method.toLowerCase() as 'get' | 'patch' | 'post'](path)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it.each(['user', 'admin'] as const)('responde 403 con rol %s', async (role) => {
    const auth = await loginAs(role)

    const responses = await Promise.all([
      request(baseUrl).get(MY_BUSINESS).set('Authorization', auth),
      request(baseUrl).patch(MY_BUSINESS).set('Authorization', auth).send({ name: 'Hackeado' }),
      request(baseUrl).post(REVIEW_REQUEST).set('Authorization', auth),
    ])

    for (const response of responses) {
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
    }
  })

  it('responde 404 si el gestor no tiene negocio', async () => {
    const auth = await registerManager()
    await Business.deleteMany({})

    const response = await getMyBusiness(auth)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })
})

describe('GET /api/v1/me/business', () => {
  it('devuelve el negocio del gestor con su estado de verificación', async () => {
    const auth = await registerManager()

    const response = await getMyBusiness(auth)

    expect(response.status).toBe(200)
    expect(response.body.data.business).toMatchObject({
      name: 'Café La Ceiba',
      type: 'cafe',
      verificationStatus: 'pending',
    })
    expect(response.body.data.business.id).toEqual(expect.any(String))
  })

  it('incluye el motivo cuando el negocio fue rechazado', async () => {
    const auth = await registerManager()
    await rejectBusiness()

    const response = await getMyBusiness(auth)

    expect(response.body.data.business).toMatchObject({
      verificationStatus: 'rejected',
      rejectionReason: 'El nombre no coincide con el RUT enviado',
    })
  })

  it('solo devuelve el negocio propio', async () => {
    const auth = await registerManager()
    await request(baseUrl)
      .post(`${API}/auth/register/manager`)
      .send({ ...manager, email: 'luis@correo.co', business: { name: 'Bar Otro', type: 'bar' } })
      .expect(201)

    const response = await getMyBusiness(auth)

    expect(response.body.data.business.name).toBe('Café La Ceiba')
  })
})

describe('PATCH /api/v1/me/business', () => {
  it('actualiza datos y contacto, normaliza valores y persiste en MongoDB', async () => {
    const auth = await registerManager()

    const response = await patchMyBusiness(auth, {
      name: 'Café La Ceiba Laureles',
      description: 'Café de especialidad con música en vivo los viernes',
      contact: {
        phone: '300 123 4567',
        email: 'Hola@LaCeiba.co',
        website: 'https://laceiba.co',
        instagram: '@cafe.laceiba',
      },
    })

    expect(response.status).toBe(200)
    expect(response.body.data.business).toMatchObject({
      name: 'Café La Ceiba Laureles',
      contact: {
        phone: '3001234567',
        email: 'hola@laceiba.co',
        website: 'https://laceiba.co',
        instagram: 'cafe.laceiba',
      },
    })
    const stored = await Business.findOne().lean()
    expect(stored?.contact).toMatchObject({ phone: '3001234567', instagram: 'cafe.laceiba' })
  })

  it('un PATCH parcial de contacto no borra los demás campos de contacto', async () => {
    const auth = await registerManager()
    await patchMyBusiness(auth, {
      contact: { phone: '3001234567', instagram: 'laceiba' },
    }).expect(200)

    const response = await patchMyBusiness(auth, { contact: { website: 'https://laceiba.co' } })

    expect(response.body.data.business.contact).toEqual({
      phone: '3001234567',
      instagram: 'laceiba',
      website: 'https://laceiba.co',
    })
  })

  it('null borra un campo', async () => {
    const auth = await registerManager()
    await patchMyBusiness(auth, {
      description: 'Algo',
      contact: { phone: '3001234567', instagram: 'laceiba' },
    }).expect(200)

    const response = await patchMyBusiness(auth, { description: null, contact: { phone: null } })

    expect(response.status).toBe(200)
    expect(response.body.data.business).not.toHaveProperty('description')
    expect(response.body.data.business.contact).toEqual({ instagram: 'laceiba' })
  })

  it.each([
    ['con 9 dígitos', '300123456'],
    ['con 11 dígitos', '30012345678'],
    ['que no empieza por 3', '6041234567'],
    ['con letras', '300abc4567'],
    ['con indicativo', '+573001234567'],
  ])('rechaza un celular %s', async (_case, phone) => {
    const auth = await registerManager()

    const response = await patchMyBusiness(auth, { contact: { phone } })

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual([
      {
        path: 'body.contact.phone',
        message: 'El celular debe tener 10 dígitos y empezar por 3',
      },
    ])
  })

  it.each([
    ['con espacios', 'cafe laceiba'],
    ['con caracteres no permitidos', 'cafe-laceiba!'],
    ['de más de 30 caracteres', 'a'.repeat(31)],
    ['vacío', '@'],
  ])('rechaza un Instagram %s', async (_case, instagram) => {
    const auth = await registerManager()

    const response = await patchMyBusiness(auth, { contact: { instagram } })

    expect(response.status).toBe(400)
    expect(detailPaths(response)).toEqual(['body.contact.instagram'])
  })

  it.each([
    ['http://', 'http://laceiba.co'],
    ['sin protocolo', 'laceiba.co'],
    ['otro protocolo', 'ftp://laceiba.co'],
    ['javascript:', 'javascript:alert(1)'],
    ['sin dominio válido', 'https://localhost'],
  ])('rechaza un sitio web %s', async (_case, website) => {
    const auth = await registerManager()

    const response = await patchMyBusiness(auth, { contact: { website } })

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual([
      { path: 'body.contact.website', message: 'El sitio web debe ser una URL https:// válida' },
    ])
  })

  it('no aplica nada si un campo es inválido', async () => {
    const auth = await registerManager()

    await patchMyBusiness(auth, {
      name: 'Nombre Nuevo',
      contact: { phone: '123' },
    }).expect(400)

    expect(await Business.findOne()).toMatchObject({ name: 'Café La Ceiba' })
  })

  it('ignora campos de verificación y de propiedad enviados en el body', async () => {
    const auth = await registerManager()
    const before = await Business.findOne().lean()

    const response = await patchMyBusiness(auth, {
      name: 'Café Nuevo',
      verificationStatus: 'approved',
      verifiedAt: new Date().toISOString(),
      owner: new mongoose.Types.ObjectId().toString(),
      slug: 'otro-slug',
    })

    expect(response.status).toBe(200)
    const stored = await Business.findOne().lean()
    expect(stored).toMatchObject({ name: 'Café Nuevo', verificationStatus: 'pending' })
    expect(String(stored?.owner)).toBe(String(before?.owner))
    expect(stored?.verifiedAt).toBeUndefined()
    expect(stored?.slug).toBeUndefined()
  })

  it('responde 400 con body vacío', async () => {
    const auth = await registerManager()

    const response = await patchMyBusiness(auth, {})

    expect(response.status).toBe(400)
    expect(response.body.error.details[0].message).toBe('Envía al menos un campo para actualizar')
  })
})

describe('PATCH /api/v1/me/business sobre un negocio aprobado', () => {
  function approveBusiness() {
    return Business.updateOne(
      {},
      {
        verificationStatus: 'approved',
        verifiedAt: new Date(),
        verifiedBy: new mongoose.Types.ObjectId(),
      },
    )
  }

  it.each([
    ['el nombre', { name: 'Café La Ceiba Laureles' }],
    ['el tipo', { type: 'bar' }],
  ])('cambiar %s lo devuelve a revisión (pending)', async (_case, body) => {
    const auth = await registerManager()
    await approveBusiness()

    const response = await patchMyBusiness(auth, body)

    expect(response.status).toBe(200)
    expect(response.body.data.business).toMatchObject({ ...body, verificationStatus: 'pending' })
    const stored = await Business.findOne().lean()
    expect(stored).toMatchObject({ verificationStatus: 'pending' })
    expect(stored?.verifiedAt).toBeUndefined()
    expect(stored?.verifiedBy).toBeUndefined()
  })

  it('reenviar el mismo nombre y tipo no lo saca de approved', async () => {
    const auth = await registerManager()
    await approveBusiness()

    const response = await patchMyBusiness(auth, { name: '  Café La Ceiba  ', type: 'cafe' })

    expect(response.body.data.business.verificationStatus).toBe('approved')
  })

  it('cambiar descripción o contacto no lo saca de approved', async () => {
    const auth = await registerManager()
    await approveBusiness()

    const response = await patchMyBusiness(auth, {
      description: 'Nueva descripción',
      contact: { phone: '3001234567', website: 'https://laceiba.co' },
    })

    expect(response.status).toBe(200)
    expect(response.body.data.business.verificationStatus).toBe('approved')
    expect((await Business.findOne().lean())?.verifiedAt).toBeInstanceOf(Date)
  })

  it('un negocio rechazado que cambia el nombre sigue rechazado hasta solicitar revisión', async () => {
    const auth = await registerManager()
    await rejectBusiness()

    const response = await patchMyBusiness(auth, { name: 'Café La Ceiba SAS' })

    expect(response.body.data.business).toMatchObject({
      verificationStatus: 'rejected',
      rejectionReason: 'El nombre no coincide con el RUT enviado',
    })
  })

  it('un PATCH inválido no cambia el estado de verificación', async () => {
    const auth = await registerManager()
    await approveBusiness()

    await patchMyBusiness(auth, { name: 'Nuevo', contact: { phone: '123' } }).expect(400)

    expect(await Business.findOne()).toMatchObject({
      name: 'Café La Ceiba',
      verificationStatus: 'approved',
    })
  })

  it('ediciones simultáneas de nombre: ninguna deja el negocio aprobado con otro nombre', async () => {
    const auth = await registerManager()
    await approveBusiness()

    const responses = await Promise.all(
      ['Nombre Uno', 'Nombre Dos', 'Nombre Tres'].map((name) => patchMyBusiness(auth, { name })),
    )

    for (const response of responses) expect([200, 409]).toContain(response.status)
    expect(await Business.findOne()).toMatchObject({ verificationStatus: 'pending' })
  })
})

describe('POST /api/v1/me/business/review-request', () => {
  it('tras un rechazo devuelve el negocio a pending y limpia los datos del rechazo', async () => {
    const auth = await registerManager()
    await rejectBusiness()

    const response = await request(baseUrl).post(REVIEW_REQUEST).set('Authorization', auth)

    expect(response.status).toBe(200)
    expect(response.body.data.business.verificationStatus).toBe('pending')
    expect(response.body.data.business).not.toHaveProperty('rejectionReason')
    const stored = await Business.findOne().lean()
    expect(stored).toMatchObject({ verificationStatus: 'pending' })
    expect(stored?.rejectionReason).toBeUndefined()
    expect(stored?.verifiedAt).toBeUndefined()
    expect(stored?.verifiedBy).toBeUndefined()
  })

  it('flujo completo: rechazo → corrige datos → solicita revisión → GET muestra pending', async () => {
    const auth = await registerManager()
    await rejectBusiness()

    await patchMyBusiness(auth, { name: 'Café La Ceiba SAS' }).expect(200)
    const rejected = await getMyBusiness(auth)
    expect(rejected.body.data.business.verificationStatus).toBe('rejected')

    await request(baseUrl).post(REVIEW_REQUEST).set('Authorization', auth).expect(200)

    const afterRequest = await getMyBusiness(auth)
    expect(afterRequest.body.data.business).toMatchObject({
      name: 'Café La Ceiba SAS',
      verificationStatus: 'pending',
    })
  })

  it('responde 409 si el negocio ya está en revisión', async () => {
    const auth = await registerManager()

    const response = await request(baseUrl).post(REVIEW_REQUEST).set('Authorization', auth)

    expect(response.status).toBe(409)
    expect(response.body.error.message).toBe('Tu negocio ya está en revisión')
  })

  it('responde 409 si el negocio ya está verificado, sin cambiar su estado', async () => {
    const auth = await registerManager()
    await Business.updateOne({}, { verificationStatus: 'approved', verifiedAt: new Date() })

    const response = await request(baseUrl).post(REVIEW_REQUEST).set('Authorization', auth)

    expect(response.status).toBe(409)
    expect(response.body.error.message).toBe('Tu negocio ya está verificado')
    expect(await Business.findOne()).toMatchObject({ verificationStatus: 'approved' })
  })

  it('responde 404 si el gestor no tiene negocio', async () => {
    const auth = await registerManager()
    await Business.deleteMany({})

    await request(baseUrl).post(REVIEW_REQUEST).set('Authorization', auth).expect(404)
  })

  it('solicitudes simultáneas: solo una pasa a pending, las demás 409', async () => {
    const auth = await registerManager()
    await rejectBusiness()

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(baseUrl).post(REVIEW_REQUEST).set('Authorization', auth),
      ),
    )

    const statuses = responses.map((response) => response.status).sort()
    expect(statuses).toEqual([200, 409, 409, 409, 409])
  })
})
