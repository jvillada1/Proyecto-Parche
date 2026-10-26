import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { hashToken } from '../lib/tokens'
import { RefreshToken } from '../modules/auth/refresh-token.model'
import { Business } from '../modules/businesses/business.model'
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

afterAll(() => {
  delete process.env.ENABLE_RATE_LIMIT_IN_TESTS
})

describe('POST /api/v1/auth/register/manager (validación del negocio)', () => {
  it('responde 400 con un tipo de negocio inválido', async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .send({ ...validBody, business: { name: 'Bar X', type: 'zzz' } })

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual([
      { path: 'body.business.type', message: 'Tipo de negocio inválido' },
    ])
  })

  it('responde 400 si falta el negocio o su nombre es muy corto', async () => {
    const withoutBusiness = await request(app)
      .post(ENDPOINT)
      .send({ name: 'Ana', email: 'ana@correo.co', password: 'clave1234' })
    const shortBusinessName = await request(app)
      .post(ENDPOINT)
      .send({ ...validBody, business: { name: 'A', type: 'bar' } })

    expect(withoutBusiness.status).toBe(400)
    expect(withoutBusiness.body.error.details[0].path).toBe('body.business')
    expect(shortBusinessName.status).toBe(400)
    expect(shortBusinessName.body.error.details[0].path).toBe('body.business.name')
    expect(await User.countDocuments()).toBe(0)
  })

  it('responde 400 si la contraseña supera 72 caracteres', async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .send({ ...validBody, password: 'a1'.repeat(37) })

    expect(response.status).toBe(400)
    expect(response.body.error.details[0].path).toBe('body.password')
  })
})

describe('POST /api/v1/auth/register/manager (datos guardados)', () => {
  it('guarda la contraseña con bcrypt y el refresh token solo como hash SHA-256', async () => {
    const response = await request(app).post(ENDPOINT).send(validBody).expect(201)

    const savedUser = await User.findOne().select('+passwordHash')
    expect(savedUser?.passwordHash).toMatch(/^\$2[aby]\$12\$/)
    expect(savedUser?.passwordHash).not.toContain('clave1234')

    const cookie = response.get('Set-Cookie')?.[0] ?? ''
    const rawToken = cookie.split(';')[0]?.replace('refreshToken=', '') ?? ''
    const savedToken = await RefreshToken.findOne()
    expect(savedToken?.tokenHash).toBe(hashToken(rawToken))
    expect(savedToken?.tokenHash).not.toBe(rawToken)
  })

  it('fija la cookie con HttpOnly, SameSite=Lax y Path de auth', async () => {
    const response = await request(app).post(ENDPOINT).send(validBody).expect(201)

    const cookie = response.get('Set-Cookie')?.[0] ?? ''
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/)
    expect(cookie).toMatch(/Max-Age=604800/)
  })

  it('crea el negocio sin slug, pendiente, y asociado al nuevo usuario', async () => {
    const response = await request(app).post(ENDPOINT).send(validBody).expect(201)

    const savedBusiness = await Business.findOne()
    expect(String(savedBusiness?.owner)).toBe(response.body.data.user.id)
    expect(savedBusiness?.verificationStatus).toBe('pending')
    expect(savedBusiness?.slug).toBeUndefined()
  })

  it('permite registrar varios managers (varios negocios pendientes sin slug)', async () => {
    await request(app).post(ENDPOINT).send(validBody).expect(201)
    await request(app)
      .post(ENDPOINT)
      .send({ ...validBody, email: 'luis@correo.co', business: { name: 'Bar Luis', type: 'bar' } })
      .expect(201)

    expect(await Business.countDocuments()).toBe(2)
  })
})

describe('POST /api/v1/auth/register/manager (rate limit)', () => {
  it('responde 429 a partir de la petición 11 desde la misma IP', async () => {
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true'

    for (let attemptNumber = 1; attemptNumber <= 10; attemptNumber++) {
      await request(app).post(ENDPOINT).send({}).expect(400)
    }
    const response = await request(app).post(ENDPOINT).send(validBody)

    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe('RATE_LIMITED')
    expect(response.get('Retry-After')).toBeDefined()
    expect(await User.countDocuments()).toBe(0)
  })
})
