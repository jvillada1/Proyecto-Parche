import bcrypt from 'bcrypt'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { RefreshToken } from '../modules/auth/refresh-token.model'
import { User } from '../modules/users/user.model'

const app = createApp()
const LOGIN = '/api/v1/auth/login'
const REFRESH = '/api/v1/auth/refresh'
const PASSWORD = '/api/v1/auth/password'
const EMAIL = 'ana@correo.co'
const CURRENT_PASSWORD = 'clave1234'
const NEW_PASSWORD = 'nuevaClave567'

function extractRefreshCookie(response: request.Response) {
  const cookie = (response.get('Set-Cookie') ?? []).find((value) =>
    value.startsWith('refreshToken='),
  )
  return cookie?.split(';')[0] ?? ''
}

async function login(password = CURRENT_PASSWORD) {
  const response = await request(app).post(LOGIN).send({ email: EMAIL, password }).expect(200)
  return {
    accessToken: response.body.data.accessToken as string,
    cookie: extractRefreshCookie(response),
  }
}

function changePassword(
  session: { accessToken: string; cookie?: string },
  body: Record<string, unknown>,
) {
  const req = request(app).patch(PASSWORD).set('Authorization', `Bearer ${session.accessToken}`)
  if (session.cookie) req.set('Cookie', session.cookie)
  return req.send(body)
}

const validBody = {
  currentPassword: CURRENT_PASSWORD,
  newPassword: NEW_PASSWORD,
  confirmPassword: NEW_PASSWORD,
}

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({})])
  await User.create({
    name: 'Ana Pérez',
    email: EMAIL,
    passwordHash: await bcrypt.hash(CURRENT_PASSWORD, 4),
    role: 'manager',
  })
})

describe('PATCH /api/v1/auth/password', () => {
  it('cambia la contraseña, actualiza passwordChangedAt y responde 200 con mensaje', async () => {
    const session = await login()
    const before = new Date()

    const response = await changePassword(session, validBody)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: { message: 'Contraseña actualizada correctamente' } })
    const user = await User.findOne({ email: EMAIL }).select('+passwordHash')
    expect(await bcrypt.compare(NEW_PASSWORD, user!.passwordHash)).toBe(true)
    expect(user!.passwordChangedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())

    await request(app).post(LOGIN).send({ email: EMAIL, password: CURRENT_PASSWORD }).expect(401)
    await login(NEW_PASSWORD)
  })

  it('revoca las demás sesiones pero mantiene la actual', async () => {
    const otherSession = await login()
    const currentSession = await login()

    await changePassword(currentSession, validBody).expect(200)

    await request(app).post(REFRESH).set('Cookie', otherSession.cookie).expect(401)
    await request(app).post(REFRESH).set('Cookie', currentSession.cookie).expect(200)
  })

  it('revoca todas las sesiones si la petición no trae cookie de sesión', async () => {
    const session = await login()

    await changePassword({ accessToken: session.accessToken }, validBody).expect(200)

    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0)
  })

  it('no conserva una sesión ajena aunque se envíe su cookie', async () => {
    const otherUser = await User.create({
      name: 'Luis Gómez',
      email: 'luis@correo.co',
      passwordHash: await bcrypt.hash(CURRENT_PASSWORD, 4),
    })
    const ownSession = await login()
    const foreignLogin = await request(app)
      .post(LOGIN)
      .send({ email: 'luis@correo.co', password: CURRENT_PASSWORD })
    const foreignCookie = extractRefreshCookie(foreignLogin)

    await changePassword(
      { accessToken: ownSession.accessToken, cookie: foreignCookie },
      validBody,
    ).expect(200)

    expect(
      await RefreshToken.countDocuments({
        user: (await User.findOne({ email: EMAIL }))!._id,
        revokedAt: null,
      }),
    ).toBe(0)
    expect(await RefreshToken.countDocuments({ user: otherUser._id, revokedAt: null })).toBe(1)
  })

  it('responde 400 si la contraseña actual es incorrecta y no cambia nada', async () => {
    const session = await login()

    const response = await changePassword(session, {
      ...validBody,
      currentPassword: 'otraClave999',
    })

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual([
      { path: 'body.currentPassword', message: 'La contraseña actual es incorrecta' },
    ])
    const user = await User.findOne({ email: EMAIL }).select('+passwordHash')
    expect(await bcrypt.compare(CURRENT_PASSWORD, user!.passwordHash)).toBe(true)
    expect(user!.passwordChangedAt).toBeUndefined()
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(1)
  })

  it('responde 400 si la confirmación no coincide', async () => {
    const session = await login()

    const response = await changePassword(session, { ...validBody, confirmPassword: 'distinta123' })

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual([
      { path: 'body.confirmPassword', message: 'Las contraseñas no coinciden' },
    ])
  })

  it('responde 400 si la nueva contraseña es igual a la actual', async () => {
    const session = await login()

    const response = await changePassword(session, {
      currentPassword: CURRENT_PASSWORD,
      newPassword: CURRENT_PASSWORD,
      confirmPassword: CURRENT_PASSWORD,
    })

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual([
      { path: 'body.newPassword', message: 'La nueva contraseña debe ser distinta a la actual' },
    ])
  })

  it('responde 400 si la nueva contraseña no cumple las reglas', async () => {
    const session = await login()

    const response = await changePassword(session, {
      ...validBody,
      newPassword: 'corta',
      confirmPassword: 'corta',
    })

    expect(response.status).toBe(400)
    const paths = response.body.error.details.map((detail: { path: string }) => detail.path)
    expect(paths).toContain('body.newPassword')
  })

  it('responde 400 si faltan campos', async () => {
    const session = await login()

    const response = await changePassword(session, {})

    expect(response.status).toBe(400)
    const paths = response.body.error.details.map((detail: { path: string }) => detail.path)
    expect(paths).toEqual(
      expect.arrayContaining(['body.currentPassword', 'body.newPassword', 'body.confirmPassword']),
    )
  })

  it('responde 401 sin token', async () => {
    const response = await request(app).patch(PASSWORD).send(validBody)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it('responde 403 si la cuenta está suspendida', async () => {
    const session = await login()
    await User.updateOne({ email: EMAIL }, { status: 'suspended' })

    await changePassword(session, validBody).expect(403)
  })
})
