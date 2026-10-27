import bcrypt from 'bcrypt'
import mongoose from 'mongoose'
import { User } from '../users/user.model'
import { RefreshToken } from './refresh-token.model'
import { Business } from '../businesses/business.model'
import type { UserRole } from '@parche/shared'
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from '../../utils/app-error'
import { createRefreshToken, hashToken, signAccessToken } from '../../lib/tokens'
import type {
  ChangePasswordInput,
  CreateAdminInput,
  LoginInput,
  RegisterManagerInput,
} from './auth.schemas'

const BCRYPT_ROUNDS = 12
const EMAIL_TAKEN_MESSAGE = 'Ya existe una cuenta con ese correo'
const INVALID_CREDENTIALS_MESSAGE = 'Correo o contraseña incorrectos'

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('contraseña-inexistente', BCRYPT_ROUNDS)

function isDuplicateKeyError(error: unknown) {
  return (error as { code?: number } | null)?.code === 11000
}

export async function registerManager(input: RegisterManagerInput, userAgent?: string) {
  if (await User.exists({ email: input.email })) throw new ConflictError(EMAIL_TAKEN_MESSAGE)

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)

  let user
  try {
    user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: 'manager',
      lastLoginAt: new Date(),
    })
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new ConflictError(EMAIL_TAKEN_MESSAGE)
    throw error
  }

  let business
  try {
    business = await Business.create({
      owner: user._id,
      name: input.business.name,
      type: input.business.type,
      verificationStatus: 'pending',
    })
  } catch (error) {
    await User.deleteOne({ _id: user._id })
    throw error
  }

  const accessToken = signAccessToken(user._id, 'manager')
  const refreshToken = await createRefreshToken(user._id, userAgent)

  return { user, business, accessToken, refreshToken }
}

export async function createAdmin(input: CreateAdminInput) {
  if (await User.exists({ email: input.email })) throw new ConflictError(EMAIL_TAKEN_MESSAGE)

  try {
    return await User.create({
      name: input.name,
      email: input.email,
      passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      role: 'admin',
    })
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new ConflictError(EMAIL_TAKEN_MESSAGE)
    throw error
  }
}

export async function login(input: LoginInput, userAgent?: string) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash')

  const passwordMatches = await bcrypt.compare(
    input.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  )
  if (!user || !passwordMatches) throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE)

  if (user.status === 'suspended') throw new ForbiddenError('Tu cuenta está suspendida')

  user.lastLoginAt = new Date()
  await user.save()

  const accessToken = signAccessToken(user._id, user.role as UserRole)
  const refreshToken = await createRefreshToken(user._id, userAgent)

  return { user, accessToken, refreshToken }
}

const INVALID_SESSION_MESSAGE = 'Sesión inválida o expirada'

function revokeFamily(family: string) {
  return RefreshToken.updateMany({ family, revokedAt: null }, { revokedAt: new Date() })
}

export async function refreshSession(refreshToken: string, userAgent?: string) {
  const storedToken = await RefreshToken.findOne({ tokenHash: hashToken(refreshToken) })
  if (!storedToken) throw new UnauthorizedError(INVALID_SESSION_MESSAGE)

  if (storedToken.revokedAt) {
    await revokeFamily(storedToken.family)
    throw new UnauthorizedError(INVALID_SESSION_MESSAGE)
  }
  if (storedToken.expiresAt <= new Date()) throw new UnauthorizedError(INVALID_SESSION_MESSAGE)

  const user = await User.findById(storedToken.user)
  if (!user) throw new UnauthorizedError(INVALID_SESSION_MESSAGE)
  if (user.status === 'suspended') {
    await revokeFamily(storedToken.family)
    throw new ForbiddenError('Tu cuenta está suspendida')
  }

  const newRefreshToken = await createRefreshToken(user._id, userAgent, storedToken.family)

  const claimedToken = await RefreshToken.findOneAndUpdate(
    { _id: storedToken._id, revokedAt: null },
    { revokedAt: new Date() },
  )
  if (!claimedToken) {
    await revokeFamily(storedToken.family)
    throw new UnauthorizedError(INVALID_SESSION_MESSAGE)
  }

  const accessToken = signAccessToken(user._id, user.role as UserRole)

  return { accessToken, refreshToken: newRefreshToken }
}

export async function getMe(userId: string) {
  const user = await User.findById(userId)
  if (!user) throw new UnauthorizedError(INVALID_SESSION_MESSAGE)
  if (user.status === 'suspended') throw new ForbiddenError('Tu cuenta está suspendida')

  if (user.role !== 'manager') return { user }

  const business = await Business.findOne({ owner: user._id })
  return { user, business }
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  currentRefreshToken?: string,
) {
  const user = await User.findById(userId).select('+passwordHash')
  if (!user) throw new UnauthorizedError(INVALID_SESSION_MESSAGE)
  if (user.status === 'suspended') throw new ForbiddenError('Tu cuenta está suspendida')

  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new ValidationError('Datos inválidos', [
      { path: 'body.currentPassword', message: 'La contraseña actual es incorrecta' },
    ])
  }

  user.passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS)
  user.passwordChangedAt = new Date()
  await user.save()

  const currentSession = currentRefreshToken
    ? await RefreshToken.findOne({
        tokenHash: hashToken(currentRefreshToken),
        user: user._id,
        revokedAt: null,
      })
    : null

  await RefreshToken.updateMany(
    {
      user: user._id,
      revokedAt: null,
      ...(currentSession && { family: mongoose.trusted({ $ne: currentSession.family }) }),
    },
    { revokedAt: new Date() },
  )
}

export async function logout(refreshToken: string) {
  const storedToken = await RefreshToken.findOne({ tokenHash: hashToken(refreshToken) })
  if (storedToken) await revokeFamily(storedToken.family)
}
