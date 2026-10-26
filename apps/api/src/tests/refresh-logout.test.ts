import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { RefreshToken } from '../modules/auth/refresh-token.model'
import { User } from '../modules/users/user.model'

const app = createApp()
const LOGIN = '/api/v1/auth/login'
const REFRESH = '/api/v1/auth/refresh'
const LOGOUT = '/api/v1/auth/logout'

function extractRefreshCookie(response: request.Response) {
  const cookie = (response.get('Set-Cookie') ?? []).find((value) =>
    value.startsWith('refreshToken='),
  )
  return cookie?.split(';')[0] ?? ''
}

async function loginAndGetCookie() {
  const response = await request(app)
    .post(LOGIN)
    .send({ email: 'ana@correo.co', password: 'clave1234' })
    .expect(200)
  return extractRefreshCookie(response)
}

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({})])
  await User.create({
    name: 'Ana Pérez',
    email: 'ana@correo.co',
    passwordHash: await bcrypt.hash('clave1234', 4),
    role: 'manager',
  })
})

describe('POST /api/v1/auth/refresh', () => {
  it('rota el token: devuelve un accessToken nuevo, otra cookie y revoca el anterior', async () => {
    const oldCookie = await loginAndGetCookie()

    const response = await request(app).post(REFRESH).set('Cookie', oldCookie)

    expect(response.status).toBe(200)
    expect(jwt.decode(response.body.data.accessToken)).toMatchObject({ role: 'manager' })
    const newCookie = extractRefreshCookie(response)
    expect(newCookie).toMatch(/^refreshToken=.+/)
    expect(newCookie).not.toBe(oldCookie)

    const tokens = await RefreshToken.find().sort({ createdAt: 1 })
    expect(tokens).toHaveLength(2)
    expect(tokens[0]?.revokedAt).toBeInstanceOf(Date)
    expect(tokens[1]?.revokedAt).toBeUndefined()
    expect(tokens[1]?.family).toBe(tokens[0]?.family)
  })

  it('permite encadenar varias rotaciones con el token más reciente', async () => {
    let cookie = await loginAndGetCookie()

    for (let rotation = 1; rotation <= 3; rotation++) {
      const response = await request(app).post(REFRESH).set('Cookie', cookie).expect(200)
      cookie = extractRefreshCookie(response)
    }

    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(1)
  })

  it('al reusar un token revocado revoca toda la familia', async () => {
    const firstCookie = await loginAndGetCookie()
    const rotated = await request(app).post(REFRESH).set('Cookie', firstCookie).expect(200)
    const secondCookie = extractRefreshCookie(rotated)

    const reuse = await request(app).post(REFRESH).set('Cookie', firstCookie)
    expect(reuse.status).toBe(401)
    expect(reuse.body.error.code).toBe('UNAUTHORIZED')

    await request(app).post(REFRESH).set('Cookie', secondCookie).expect(401)
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0)
  })

  it('no afecta a otras sesiones (otras familias) del usuario', async () => {
    const sessionA = await loginAndGetCookie()
    const sessionB = await loginAndGetCookie()
    await request(app).post(REFRESH).set('Cookie', sessionA).expect(200)

    await request(app).post(REFRESH).set('Cookie', sessionA).expect(401)

    await request(app).post(REFRESH).set('Cookie', sessionB).expect(200)
  })

  it('responde 401 sin cookie', async () => {
    const response = await request(app).post(REFRESH)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it('responde 401 y borra la cookie con un token desconocido', async () => {
    const response = await request(app).post(REFRESH).set('Cookie', 'refreshToken=inventado')

    expect(response.status).toBe(401)
    expect(response.headers['set-cookie']?.[0]).toMatch(/^refreshToken=;/)
  })

  it('responde 401 si el token expiró', async () => {
    const cookie = await loginAndGetCookie()
    await RefreshToken.updateMany({}, { expiresAt: new Date(Date.now() - 1000) })

    await request(app).post(REFRESH).set('Cookie', cookie).expect(401)
  })

  it('responde 403 y revoca la familia si la cuenta fue suspendida', async () => {
    const cookie = await loginAndGetCookie()
    await User.updateOne({ email: 'ana@correo.co' }, { status: 'suspended' })

    const response = await request(app).post(REFRESH).set('Cookie', cookie)

    expect(response.status).toBe(403)
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0)
  })
})

describe('POST /api/v1/auth/logout', () => {
  it('revoca la sesión, borra la cookie y responde 204', async () => {
    const cookie = await loginAndGetCookie()

    const response = await request(app).post(LOGOUT).set('Cookie', cookie)

    expect(response.status).toBe(204)
    expect(response.headers['set-cookie']?.[0]).toMatch(/^refreshToken=;/)
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0)

    await request(app).post(REFRESH).set('Cookie', cookie).expect(401)
  })

  it('es idempotente: responde 204 sin cookie o con un token desconocido', async () => {
    await request(app).post(LOGOUT).expect(204)
    await request(app).post(LOGOUT).set('Cookie', 'refreshToken=inventado').expect(204)
  })
})
