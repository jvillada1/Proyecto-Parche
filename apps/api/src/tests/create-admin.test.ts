import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { createAdminSchema } from '../modules/auth/auth.schemas'
import { createAdmin } from '../modules/auth/auth.service'
import { Business } from '../modules/businesses/business.model'
import { User } from '../modules/users/user.model'
import { ConflictError } from '../utils/app-error'

const app = createApp()
const ADMIN = { name: 'Admin Parche', email: 'admin@parche.co', password: 'Admin#Segura2026' }

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Business.deleteMany({})])
})

describe('createAdmin', () => {
  it('crea un usuario con rol admin y la contraseña hasheada', async () => {
    const admin = await createAdmin(ADMIN)

    const stored = await User.findById(admin._id).select('+passwordHash')
    expect(stored).toMatchObject({ email: ADMIN.email, role: 'admin', status: 'active' })
    expect(stored!.passwordHash).not.toBe(ADMIN.password)
    expect(await bcrypt.compare(ADMIN.password, stored!.passwordHash)).toBe(true)
  })

  it('no crea negocio para el administrador', async () => {
    await createAdmin(ADMIN)

    expect(await Business.countDocuments()).toBe(0)
  })

  it('lanza ConflictError si el correo ya existe, sin modificar la cuenta existente', async () => {
    await User.create({ ...ADMIN, passwordHash: 'hash', role: 'manager' })

    await expect(createAdmin(ADMIN)).rejects.toBeInstanceOf(ConflictError)
    expect(await User.findOne({ email: ADMIN.email })).toMatchObject({ role: 'manager' })
  })

  it('el administrador puede iniciar sesión y recibe un token con rol admin', async () => {
    await createAdmin(ADMIN)

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200)
    expect(jwt.decode(login.body.data.accessToken)).toMatchObject({ role: 'admin' })

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200)
    expect(me.body.data.user.role).toBe('admin')
    expect(me.body.data).not.toHaveProperty('business')
  })
})

describe('createAdminSchema', () => {
  it('normaliza el correo', () => {
    const parsed = createAdminSchema.parse({ ...ADMIN, email: '  ADMIN@Parche.CO ' })

    expect(parsed.email).toBe('admin@parche.co')
  })

  it.each([
    ['menos de 12 caracteres', 'Ab#12345678'],
    ['sin mayúscula', 'admin#segura2026'],
    ['sin minúscula', 'ADMIN#SEGURA2026'],
    ['sin número', 'Admin#SeguraParche'],
    ['sin símbolo', 'AdminSegura2026'],
  ])('rechaza una contraseña %s', (_case, password) => {
    const result = createAdminSchema.safeParse({ ...ADMIN, password })

    expect(result.success).toBe(false)
  })
})
