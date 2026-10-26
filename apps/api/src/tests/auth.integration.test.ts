import type { Server } from 'node:http'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { RefreshToken } from '../modules/auth/refresh-token.model'
import { Business } from '../modules/businesses/business.model'
import { User } from '../modules/users/user.model'

const API = '/api/v1'
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

function cookieOf(response: request.Response) {
  return (response.get('Set-Cookie') ?? []).find((cookie) => cookie.startsWith('refreshToken='))
}

describe('índices en MongoDB real', () => {
  it('crea los índices únicos y el TTL definidos en los modelos', async () => {
    const userIndexes = await User.collection.indexes()
    const tokenIndexes = await RefreshToken.collection.indexes()
    const businessIndexes = await Business.collection.indexes()

    expect(userIndexes.find((index) => index.key.email)?.unique).toBe(true)
    expect(tokenIndexes.find((index) => index.key.tokenHash)?.unique).toBe(true)
    expect(tokenIndexes.find((index) => index.key.expiresAt)?.expireAfterSeconds).toBe(0)
    expect(businessIndexes.find((index) => index.key.owner)?.unique).toBe(true)
    expect(businessIndexes.find((index) => index.key.slug)).toMatchObject({
      unique: true,
      partialFilterExpression: { slug: { $type: 'string' } },
    })
  })
})

describe('ciclo de vida de la sesión (servidor HTTP real + cookie jar)', () => {
  it('registro → refresh → logout → refresh rechazado → login → refresh', async () => {
    const browser = request.agent(baseUrl)

    const registered = await browser.post(`${API}/auth/register/manager`).send(manager)
    expect(registered.status).toBe(201)
    expect(registered.body.data.business.verificationStatus).toBe('pending')

    const refreshed = await browser.post(`${API}/auth/refresh`)
    expect(refreshed.status).toBe(200)
    expect(refreshed.body.data.accessToken).toEqual(expect.any(String))

    const loggedOut = await browser.post(`${API}/auth/logout`)
    expect(loggedOut.status).toBe(204)

    const afterLogout = await browser.post(`${API}/auth/refresh`)
    expect(afterLogout.status).toBe(401)

    const loggedIn = await browser
      .post(`${API}/auth/login`)
      .send({ email: manager.email, password: manager.password })
    expect(loggedIn.status).toBe(200)
    expect(loggedIn.body.data.user.email).toBe(manager.email)

    await browser.post(`${API}/auth/refresh`).expect(200)

    const families = await RefreshToken.distinct('family')
    expect(families).toHaveLength(2)
  })

  it('la cookie de refresh solo viaja a /api/v1/auth y no es legible desde JavaScript', async () => {
    const response = await request(baseUrl).post(`${API}/auth/register/manager`).send(manager)

    const cookie = cookieOf(response) ?? ''
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/)
    expect(cookie).toMatch(/HttpOnly/)
    expect(JSON.stringify(response.body)).not.toContain(cookie.split(';')[0]?.split('=')[1] ?? '')
  })

  it('dos dispositivos tienen sesiones independientes y el logout de uno no cierra el otro', async () => {
    await request(baseUrl).post(`${API}/auth/register/manager`).send(manager).expect(201)
    const phone = request.agent(baseUrl)
    const laptop = request.agent(baseUrl)
    const credentials = { email: manager.email, password: manager.password }
    await phone.post(`${API}/auth/login`).send(credentials).expect(200)
    await laptop.post(`${API}/auth/login`).send(credentials).expect(200)

    await phone.post(`${API}/auth/logout`).expect(204)

    await phone.post(`${API}/auth/refresh`).expect(401)
    await laptop.post(`${API}/auth/refresh`).expect(200)
  })

  it('un token robado y reusado cierra la sesión del atacante y la de la víctima', async () => {
    const registered = await request(baseUrl).post(`${API}/auth/register/manager`).send(manager)
    const stolenCookie = cookieOf(registered)?.split(';')[0] ?? ''

    const rotated = await request(baseUrl).post(`${API}/auth/refresh`).set('Cookie', stolenCookie)
    const victimCookie = cookieOf(rotated)?.split(';')[0] ?? ''
    expect(rotated.status).toBe(200)

    await request(baseUrl).post(`${API}/auth/refresh`).set('Cookie', stolenCookie).expect(401)

    await request(baseUrl).post(`${API}/auth/refresh`).set('Cookie', victimCookie).expect(401)
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0)
  })
})

describe('concurrencia contra MongoDB real', () => {
  it('registros simultáneos con el mismo correo: uno gana (201), el resto 409, sin huérfanos', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(baseUrl).post(`${API}/auth/register/manager`).send(manager),
      ),
    )

    const statuses = responses.map((response) => response.status).sort()
    expect(statuses.filter((status) => status === 201)).toHaveLength(1)
    expect(statuses.filter((status) => status === 409)).toHaveLength(4)
    expect(await User.countDocuments()).toBe(1)
    expect(await Business.countDocuments()).toBe(1)
    expect(await RefreshToken.countDocuments()).toBe(1)
  })

  it('dos refresh simultáneos con el mismo token: solo uno obtiene sesión nueva', async () => {
    const registered = await request(baseUrl).post(`${API}/auth/register/manager`).send(manager)
    const cookie = cookieOf(registered)?.split(';')[0] ?? ''

    const [first, second] = await Promise.all([
      request(baseUrl).post(`${API}/auth/refresh`).set('Cookie', cookie),
      request(baseUrl).post(`${API}/auth/refresh`).set('Cookie', cookie),
    ])

    expect([first.status, second.status].sort()).toEqual([200, 401])

    const winner = first.status === 200 ? first : second
    const winnerCookie = cookieOf(winner)?.split(';')[0] ?? ''
    await request(baseUrl).post(`${API}/auth/refresh`).set('Cookie', winnerCookie).expect(401)
  })
})

describe('base de datos', () => {
  it('el hash de la contraseña y el token se guardan en MongoDB y nunca en claro', async () => {
    const registered = await request(baseUrl).post(`${API}/auth/register/manager`).send(manager)
    const rawToken = cookieOf(registered)?.split(';')[0]?.split('=')[1] ?? ''

    const rawUsers = await mongoose.connection.collection('users').find().toArray()
    const rawTokens = await mongoose.connection.collection('refreshtokens').find().toArray()

    expect(JSON.stringify(rawUsers)).not.toContain(manager.password)
    expect(JSON.stringify(rawTokens)).not.toContain(rawToken)
  })
})
