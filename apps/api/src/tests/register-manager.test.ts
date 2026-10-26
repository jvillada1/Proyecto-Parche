import request from 'supertest'
import jwt from 'jsonwebtoken'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import { Business } from '../modules/businesses/business.model'
import { RefreshToken } from '../modules/auth/refresh-token.model'
import { User } from '../modules/users/user.model'

const ENDPOINT = '/api/v1/auth/register/manager'
const validBody = {
  name: 'Ana Pérez',
  email: 'ana@correo.co',
  password: 'clave1234',
  business: { name: 'Café La Ceiba', type: 'cafe' },
}

const app = createApp()

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Business.deleteMany({}), RefreshToken.deleteMany({})])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/v1/auth/register/manager', () => {
  it('crea usuario manager, negocio pending, y devuelve accessToken y cookie de refresh', async () => {
    const response = await request(app).post(ENDPOINT).send(validBody)

    expect(response.status).toBe(201)
    const { accessToken, user, business } = response.body.data
    expect(user).toMatchObject({ name: 'Ana Pérez', email: 'ana@correo.co', role: 'manager' })
    expect(user.passwordHash).toBeUndefined()
    expect(business).toMatchObject({ name: 'Café La Ceiba', verificationStatus: 'pending' })

    const payload = jwt.decode(accessToken) as { sub: string; role: string }
    expect(payload).toMatchObject({ sub: user.id, role: 'manager' })

    const cookie = response.headers['set-cookie']?.[0] ?? ''
    expect(cookie).toMatch(/^refreshToken=/)
    expect(cookie).toMatch(/HttpOnly/i)

    expect(await RefreshToken.countDocuments({ user: user.id })).toBe(1)
    expect(await Business.countDocuments({ owner: user.id })).toBe(1)
  })

  it('guarda el correo en minúsculas y responde 409 si ya existe', async () => {
    await request(app)
      .post(ENDPOINT)
      .send({ ...validBody, email: 'ANA@Correo.co' })
      .expect(201)
    expect((await User.findOne())?.email).toBe('ana@correo.co')

    const response = await request(app).post(ENDPOINT).send(validBody)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('CONFLICT')
    expect(await User.countDocuments()).toBe(1)
  })

  it.each([
    ['corta', 'abc12', 'al menos 8 caracteres'],
    ['sin número', 'sololetras', 'al menos un número'],
    ['sin letra', '12345678', 'al menos una letra'],
  ])('responde 400 si la contraseña es %s', async (_case, password, message) => {
    const response = await request(app)
      .post(ENDPOINT)
      .send({ ...validBody, password })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.details).toEqual([
      { path: 'body.password', message: expect.stringContaining(message) },
    ])
  })

  it('responde 400 con los campos inválidos de nombre y correo', async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .send({ ...validBody, name: 'A', email: 'no-es-correo' })

    expect(response.status).toBe(400)
    const paths = response.body.error.details.map((detail: { path: string }) => detail.path)
    expect(paths).toEqual(expect.arrayContaining(['body.name', 'body.email']))
  })

  it('no permite elegir el rol desde el body', async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .send({ ...validBody, role: 'admin' })

    expect(response.status).toBe(201)
    expect(response.body.data.user.role).toBe('manager')
  })

  it('borra el usuario si falla la creación del negocio', async () => {
    vi.spyOn(Business, 'create').mockRejectedValueOnce(new Error('fallo simulado'))

    const response = await request(app).post(ENDPOINT).send(validBody)

    expect(response.status).toBe(500)
    expect(await User.countDocuments()).toBe(0)
    expect(await RefreshToken.countDocuments()).toBe(0)
  })
})
