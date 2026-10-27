import express from 'express'
import jwt from 'jsonwebtoken'
import { Types } from 'mongoose'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { signAccessToken } from '../lib/tokens'
import { requireAuth, requireRole } from '../middlewares/auth'
import { errorHandler } from '../middlewares/error-handler'
import { Business } from '../modules/businesses/business.model'
import { User } from '../modules/users/user.model'

const app = createApp()
const ME = '/api/v1/auth/me'

async function createUser(overrides: Record<string, unknown> = {}) {
  return User.create({
    name: 'Ana Pérez',
    email: 'ana@correo.co',
    passwordHash: 'hash-irrelevante',
    role: 'manager',
    ...overrides,
  })
}

function bearer(token: string) {
  return `Bearer ${token}`
}

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Business.deleteMany({})])
})

describe('GET /api/v1/auth/me', () => {
  it('devuelve el usuario y su negocio si es gestor', async () => {
    const user = await createUser()
    const business = await Business.create({ owner: user._id, name: 'Café Parche', type: 'cafe' })

    const response = await request(app)
      .get(ME)
      .set('Authorization', bearer(signAccessToken(user._id, 'manager')))

    expect(response.status).toBe(200)
    expect(response.body.data.user).toMatchObject({
      id: String(user._id),
      email: 'ana@correo.co',
      role: 'manager',
    })
    expect(response.body.data.user).not.toHaveProperty('passwordHash')
    expect(response.body.data.business).toMatchObject({
      id: String(business._id),
      name: 'Café Parche',
    })
  })

  it('devuelve business null si el gestor aún no tiene negocio', async () => {
    const user = await createUser()

    const response = await request(app)
      .get(ME)
      .set('Authorization', bearer(signAccessToken(user._id, 'manager')))
      .expect(200)

    expect(response.body.data.business).toBeNull()
  })

  it('no incluye negocio para un usuario que no es gestor', async () => {
    const user = await createUser({ role: 'user' })

    const response = await request(app)
      .get(ME)
      .set('Authorization', bearer(signAccessToken(user._id, 'user')))
      .expect(200)

    expect(response.body.data.user.role).toBe('user')
    expect(response.body.data).not.toHaveProperty('business')
  })

  it('responde 401 sin token', async () => {
    const response = await request(app).get(ME)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it.each([
    ['esquema distinto a Bearer', 'Basic abc123'],
    ['token mal formado', 'Bearer no-es-un-jwt'],
    [
      'firma inválida',
      bearer(
        jwt.sign({ role: 'admin' }, 'otro-secreto-otro-secreto-otro-secreto', { subject: 'x' }),
      ),
    ],
    [
      'token expirado',
      bearer(
        jwt.sign({ role: 'user' }, process.env.JWT_ACCESS_SECRET!, {
          subject: String(new Types.ObjectId()),
          expiresIn: -10,
        }),
      ),
    ],
    [
      'rol desconocido',
      bearer(
        jwt.sign({ role: 'superadmin' }, process.env.JWT_ACCESS_SECRET!, {
          subject: String(new Types.ObjectId()),
        }),
      ),
    ],
  ])('responde 401 con %s', async (_case, authorization) => {
    const response = await request(app).get(ME).set('Authorization', authorization)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it('responde 401 si el usuario del token ya no existe', async () => {
    await request(app)
      .get(ME)
      .set('Authorization', bearer(signAccessToken(new Types.ObjectId(), 'user')))
      .expect(401)
  })

  it('responde 403 si la cuenta está suspendida', async () => {
    const user = await createUser({ status: 'suspended' })

    await request(app)
      .get(ME)
      .set('Authorization', bearer(signAccessToken(user._id, 'manager')))
      .expect(403)
  })
})

describe('requireRole', () => {
  const protectedApp = express()
  protectedApp.get('/admin', requireAuth, requireRole('admin'), (_req, res) => {
    res.json({ data: { ok: true } })
  })
  protectedApp.get('/gestion', requireAuth, requireRole('manager', 'admin'), (_req, res) => {
    res.json({ data: { ok: true } })
  })
  protectedApp.get('/sin-auth', requireRole('admin'), (_req, res) => {
    res.json({ data: { ok: true } })
  })
  protectedApp.use(errorHandler)

  const tokenFor = (role: 'user' | 'manager' | 'admin') =>
    bearer(signAccessToken(new Types.ObjectId(), role))

  it('responde 401 sin token', async () => {
    const response = await request(protectedApp).get('/admin')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it.each(['user', 'manager'] as const)('responde 403 con rol incorrecto (%s)', async (role) => {
    const response = await request(protectedApp).get('/admin').set('Authorization', tokenFor(role))

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('permite el acceso con el rol requerido', async () => {
    await request(protectedApp).get('/admin').set('Authorization', tokenFor('admin')).expect(200)
  })

  it('acepta cualquiera de varios roles', async () => {
    await request(protectedApp)
      .get('/gestion')
      .set('Authorization', tokenFor('manager'))
      .expect(200)
    await request(protectedApp).get('/gestion').set('Authorization', tokenFor('admin')).expect(200)
    await request(protectedApp).get('/gestion').set('Authorization', tokenFor('user')).expect(403)
  })

  it('responde 401 si se usa sin requireAuth antes', async () => {
    await request(protectedApp).get('/sin-auth').set('Authorization', tokenFor('admin')).expect(401)
  })
})
