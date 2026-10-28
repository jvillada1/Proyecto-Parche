import type { Server } from 'node:http'
import bcrypt from 'bcrypt'
import { Types } from 'mongoose'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { RefreshToken } from '../modules/auth/refresh-token.model'
import { Business } from '../modules/businesses/business.model'
import { User } from '../modules/users/user.model'

const API = '/api/v1'
const ADMIN_BUSINESSES = `${API}/admin/businesses`
const REASON = 'El nombre no coincide con el RUT enviado'

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

async function registerManager(email = 'ana@correo.co', businessName = 'Café La Ceiba') {
  const response = await request(baseUrl)
    .post(`${API}/auth/register/manager`)
    .send({
      name: 'Ana Pérez',
      email,
      password: 'clave1234',
      business: { name: businessName, type: 'cafe' },
    })
    .expect(201)
  return {
    auth: `Bearer ${response.body.data.accessToken}`,
    businessId: response.body.data.business.id as string,
  }
}

async function loginAs(role: 'user' | 'admin', email = `${role}@correo.co`) {
  const user = await User.create({
    name: 'Laura Admin',
    email,
    passwordHash: await bcrypt.hash('clave1234', 4),
    role,
  })
  const response = await request(baseUrl)
    .post(`${API}/auth/login`)
    .send({ email, password: 'clave1234' })
    .expect(200)
  return { auth: `Bearer ${response.body.data.accessToken}`, userId: String(user._id) }
}

function listBusinesses(auth: string, query = '') {
  return request(baseUrl).get(`${ADMIN_BUSINESSES}${query}`).set('Authorization', auth)
}

function approve(auth: string, id: string) {
  return request(baseUrl).post(`${ADMIN_BUSINESSES}/${id}/approve`).set('Authorization', auth)
}

function reject(auth: string, id: string, body: Record<string, unknown> = { reason: REASON }) {
  return request(baseUrl)
    .post(`${ADMIN_BUSINESSES}/${id}/reject`)
    .set('Authorization', auth)
    .send(body)
}

describe('acceso a /admin/businesses', () => {
  const id = new Types.ObjectId().toString()

  it.each([
    ['GET', ADMIN_BUSINESSES],
    ['GET', `${ADMIN_BUSINESSES}/${id}`],
    ['POST', `${ADMIN_BUSINESSES}/${id}/approve`],
    ['POST', `${ADMIN_BUSINESSES}/${id}/reject`],
  ])('%s %s responde 401 sin token', async (method, path) => {
    const response = await request(baseUrl)[method.toLowerCase() as 'get' | 'post'](path)

    expect(response.status).toBe(401)
  })

  it('responde 403 al gestor y no le deja aprobar su propio negocio', async () => {
    const { auth, businessId } = await registerManager()

    const [list, approval, rejection] = await Promise.all([
      listBusinesses(auth),
      approve(auth, businessId),
      reject(auth, businessId),
    ])

    expect(list.status).toBe(403)
    expect(approval.status).toBe(403)
    expect(rejection.status).toBe(403)
    expect(await Business.findById(businessId)).toMatchObject({ verificationStatus: 'pending' })
  })

  it('responde 403 a un usuario normal', async () => {
    const { auth } = await loginAs('user')

    await listBusinesses(auth).expect(403)
  })
})

describe('GET /api/v1/admin/businesses', () => {
  it('filtra por estado e incluye el nombre y correo del gestor', async () => {
    const { auth } = await loginAs('admin')
    const pending = await registerManager('ana@correo.co', 'Café Pendiente')
    const approved = await registerManager('luis@correo.co', 'Bar Aprobado')
    await approve(auth, approved.businessId).expect(200)

    const response = await listBusinesses(auth, '?status=pending')

    expect(response.status).toBe(200)
    expect(response.body.data.businesses).toHaveLength(1)
    expect(response.body.data.businesses[0]).toMatchObject({
      id: pending.businessId,
      name: 'Café Pendiente',
      verificationStatus: 'pending',
      owner: { name: 'Ana Pérez', email: 'ana@correo.co' },
    })
    expect(response.body.data.businesses[0].owner).not.toHaveProperty('passwordHash')
    expect(response.body.data.pagination).toEqual({ page: 1, limit: 20, total: 1 })
  })

  it('sin estado lista todos, los que llevan más tiempo esperando primero', async () => {
    const { auth } = await loginAs('admin')
    await registerManager('ana@correo.co', 'Primero')
    await registerManager('luis@correo.co', 'Segundo')

    const response = await listBusinesses(auth)

    expect(
      response.body.data.businesses.map((business: { name: string }) => business.name),
    ).toEqual(['Primero', 'Segundo'])
  })

  it('pagina los resultados', async () => {
    const { auth } = await loginAs('admin')
    await registerManager('a@correo.co', 'Uno')
    await registerManager('b@correo.co', 'Dos')
    await registerManager('c@correo.co', 'Tres')

    const response = await listBusinesses(auth, '?status=pending&page=2&limit=2')

    expect(
      response.body.data.businesses.map((business: { name: string }) => business.name),
    ).toEqual(['Tres'])
    expect(response.body.data.pagination).toEqual({ page: 2, limit: 2, total: 3 })
  })

  it.each([
    ['?status=verificado', 'query.status'],
    ['?page=0', 'query.page'],
    ['?limit=101', 'query.limit'],
  ])('responde 400 con %s', async (query, path) => {
    const { auth } = await loginAs('admin')

    const response = await listBusinesses(auth, query)

    expect(response.status).toBe(400)
    expect(response.body.error.details[0].path).toBe(path)
  })

  it('GET /:id devuelve el detalle y 404 si no existe', async () => {
    const { auth } = await loginAs('admin')
    const { businessId } = await registerManager()

    const found = await request(baseUrl)
      .get(`${ADMIN_BUSINESSES}/${businessId}`)
      .set('Authorization', auth)
    const missing = await request(baseUrl)
      .get(`${ADMIN_BUSINESSES}/no-es-un-id`)
      .set('Authorization', auth)

    expect(found.status).toBe(200)
    expect(found.body.data.business.name).toBe('Café La Ceiba')
    expect(missing.status).toBe(404)
  })
})

describe('POST /api/v1/admin/businesses/:id/approve', () => {
  it('aprueba y guarda verifiedAt y verifiedBy', async () => {
    const { auth, userId } = await loginAs('admin')
    const { businessId } = await registerManager()
    const before = Date.now()

    const response = await approve(auth, businessId)

    expect(response.status).toBe(200)
    expect(response.body.data.business).toMatchObject({
      verificationStatus: 'approved',
      verifiedBy: userId,
    })
    const stored = await Business.findById(businessId)
    expect(String(stored?.verifiedBy)).toBe(userId)
    expect(stored?.verifiedAt?.getTime()).toBeGreaterThanOrEqual(before)
    expect(stored?.rejectionReason).toBeUndefined()
  })

  it('responde 409 si ya está aprobado', async () => {
    const { auth } = await loginAs('admin')
    const { businessId } = await registerManager()
    await approve(auth, businessId).expect(200)

    const response = await approve(auth, businessId)

    expect(response.status).toBe(409)
    expect(response.body.error.message).toBe('El negocio ya está aprobado')
  })

  it('responde 409 si está rechazado: primero el gestor debe solicitar revisión', async () => {
    const { auth } = await loginAs('admin')
    const { businessId } = await registerManager()
    await reject(auth, businessId).expect(200)

    await approve(auth, businessId).expect(409)

    expect(await Business.findById(businessId)).toMatchObject({ verificationStatus: 'rejected' })
  })

  it('responde 404 con un id inexistente o mal formado', async () => {
    const { auth } = await loginAs('admin')

    await approve(auth, new Types.ObjectId().toString()).expect(404)
    await approve(auth, 'no-es-un-id').expect(404)
  })

  it('aprobar y rechazar a la vez: solo una decisión se aplica', async () => {
    const { auth } = await loginAs('admin')
    const { businessId } = await registerManager()

    const responses = await Promise.all([approve(auth, businessId), reject(auth, businessId)])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
  })
})

describe('POST /api/v1/admin/businesses/:id/reject', () => {
  it('rechaza con motivo y guarda verifiedAt y verifiedBy', async () => {
    const { auth, userId } = await loginAs('admin')
    const { businessId } = await registerManager()

    const response = await reject(auth, businessId, { reason: `  ${REASON}  ` })

    expect(response.status).toBe(200)
    expect(response.body.data.business).toMatchObject({
      verificationStatus: 'rejected',
      rejectionReason: REASON,
      verifiedBy: userId,
    })
    expect((await Business.findById(businessId))?.verifiedAt).toBeInstanceOf(Date)
  })

  it.each([
    ['sin motivo', {}],
    ['con motivo de 9 caracteres', { reason: 'x'.repeat(9) }],
    ['con motivo de solo espacios', { reason: '          ' + 'corto' }],
    ['con motivo de 301 caracteres', { reason: 'x'.repeat(301) }],
  ])('responde 400 %s y no cambia el estado', async (_case, body) => {
    const { auth } = await loginAs('admin')
    const { businessId } = await registerManager()

    const response = await reject(auth, businessId, body)

    expect(response.status).toBe(400)
    expect(response.body.error.details[0].path).toBe('body.reason')
    expect(await Business.findById(businessId)).toMatchObject({ verificationStatus: 'pending' })
  })

  it('acepta motivos de 10 y de 300 caracteres', async () => {
    const { auth } = await loginAs('admin')
    const first = await registerManager('ana@correo.co', 'Uno')
    const second = await registerManager('luis@correo.co', 'Dos')

    await reject(auth, first.businessId, { reason: 'x'.repeat(10) }).expect(200)
    await reject(auth, second.businessId, { reason: 'x'.repeat(300) }).expect(200)
  })

  it('responde 409 si ya está aprobado', async () => {
    const { auth } = await loginAs('admin')
    const { businessId } = await registerManager()
    await approve(auth, businessId).expect(200)

    await reject(auth, businessId).expect(409)

    expect(await Business.findById(businessId)).toMatchObject({ verificationStatus: 'approved' })
  })
})

describe('RN-22: rechazo → corrección → nueva revisión → aprobación', () => {
  it('el gestor ve el motivo, corrige, solicita revisión y el admin aprueba', async () => {
    const admin = await loginAs('admin')
    const manager = await registerManager()

    await reject(admin.auth, manager.businessId).expect(200)

    const seen = await request(baseUrl).get(`${API}/me/business`).set('Authorization', manager.auth)
    expect(seen.body.data.business).toMatchObject({
      verificationStatus: 'rejected',
      rejectionReason: REASON,
    })

    await request(baseUrl)
      .patch(`${API}/me/business`)
      .set('Authorization', manager.auth)
      .send({ name: 'Café La Ceiba SAS' })
      .expect(200)
    const resubmitted = await request(baseUrl)
      .post(`${API}/me/business/review-request`)
      .set('Authorization', manager.auth)
    expect(resubmitted.body.data.business.verificationStatus).toBe('pending')
    expect(resubmitted.body.data.business).not.toHaveProperty('rejectionReason')

    const queue = await listBusinesses(admin.auth, '?status=pending')
    expect(queue.body.data.businesses.map((business: { id: string }) => business.id)).toEqual([
      manager.businessId,
    ])

    const approved = await approve(admin.auth, manager.businessId)
    expect(approved.body.data.business).toMatchObject({
      name: 'Café La Ceiba SAS',
      verificationStatus: 'approved',
      verifiedBy: admin.userId,
    })
  })
})
