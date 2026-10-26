import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { RefreshToken } from '../modules/auth/refresh-token.model'
import { User } from '../modules/users/user.model'

const ENDPOINT = '/api/v1/auth/login'
const PASSWORD = 'clave1234'
const INVALID_CREDENTIALS = {
  error: { code: 'UNAUTHORIZED', message: 'Correo o contraseña incorrectos' },
}

const app = createApp()

async function createUser(overrides: Record<string, unknown> = {}) {
  return User.create({
    name: 'Ana Pérez',
    email: 'ana@correo.co',
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    role: 'manager',
    ...overrides,
  })
}

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({})])
})

afterAll(() => {
  delete process.env.ENABLE_RATE_LIMIT_IN_TESTS
})

describe('POST /api/v1/auth/login', () => {
  it('inicia sesión: devuelve accessToken, user, cookie de refresh y actualiza lastLoginAt', async () => {
    const created = await createUser()

    const response = await request(app)
      .post(ENDPOINT)
      .send({ email: 'ANA@correo.co', password: PASSWORD })

    expect(response.status).toBe(200)
    const { accessToken, user } = response.body.data
    expect(user).toMatchObject({ id: String(created._id), email: 'ana@correo.co', role: 'manager' })
    expect(user.passwordHash).toBeUndefined()
    expect(jwt.decode(accessToken)).toMatchObject({ sub: String(created._id), role: 'manager' })

    const cookie = response.headers['set-cookie']?.[0] ?? ''
    expect(cookie).toMatch(/^refreshToken=/)
    expect(cookie).toMatch(/HttpOnly/i)

    expect(await RefreshToken.countDocuments({ user: created._id })).toBe(1)
    expect((await User.findById(created._id))?.lastLoginAt).toBeInstanceOf(Date)
  })

  it('responde el mismo 401 genérico con contraseña incorrecta y con correo inexistente', async () => {
    await createUser()

    const wrongPassword = await request(app)
      .post(ENDPOINT)
      .send({ email: 'ana@correo.co', password: 'otra-clave1' })
    const unknownEmail = await request(app)
      .post(ENDPOINT)
      .send({ email: 'nadie@correo.co', password: PASSWORD })

    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    expect(wrongPassword.body).toEqual(INVALID_CREDENTIALS)
    expect(unknownEmail.body).toEqual(INVALID_CREDENTIALS)
    expect(wrongPassword.headers['set-cookie']).toBeUndefined()
  })

  it('responde 403 si la cuenta está suspendida y no actualiza lastLoginAt', async () => {
    const suspended = await createUser({ status: 'suspended' })

    const response = await request(app)
      .post(ENDPOINT)
      .send({ email: 'ana@correo.co', password: PASSWORD })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
    expect(response.headers['set-cookie']).toBeUndefined()
    expect((await User.findById(suspended._id))?.lastLoginAt).toBeUndefined()
  })

  it('no revela que la cuenta está suspendida si la contraseña es incorrecta', async () => {
    await createUser({ status: 'suspended' })

    const response = await request(app)
      .post(ENDPOINT)
      .send({ email: 'ana@correo.co', password: 'otra-clave1' })

    expect(response.status).toBe(401)
    expect(response.body).toEqual(INVALID_CREDENTIALS)
  })

  it('responde 400 si faltan campos', async () => {
    const response = await request(app).post(ENDPOINT).send({})

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  describe('rate limit', () => {
    it('bloquea el 6.º intento fallido por IP + correo, sin afectar a otro correo', async () => {
      process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true'
      await createUser()
      const attempt = (email: string, password: string) =>
        request(app).post(ENDPOINT).send({ email, password })

      for (let attemptNumber = 1; attemptNumber <= 5; attemptNumber++) {
        await attempt('ana@correo.co', 'incorrecta1').expect(401)
      }

      const blocked = await attempt('ana@correo.co', PASSWORD)
      expect(blocked.status).toBe(429)
      expect(blocked.body.error.code).toBe('RATE_LIMITED')

      await attempt('otro@correo.co', 'incorrecta1').expect(401)
    })

    it('los inicios de sesión exitosos no consumen intentos', async () => {
      process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true'
      await createUser({ email: 'exito@correo.co' })

      for (let attemptNumber = 1; attemptNumber <= 8; attemptNumber++) {
        await request(app)
          .post(ENDPOINT)
          .send({ email: 'exito@correo.co', password: PASSWORD })
          .expect(200)
      }
    })
  })
})
