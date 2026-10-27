import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { nanoid } from 'nanoid'
import type { Types } from 'mongoose'
import { USER_ROLES, type UserRole } from '@parche/shared'
import { env } from '../config/env'
import { RefreshToken } from '../modules/auth/refresh-token.model'

const ACCESS_TOKEN_EXPIRES_IN = '15m'
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function signAccessToken(userId: Types.ObjectId, role: UserRole) {
  return jwt.sign({ role }, env.JWT_ACCESS_SECRET, {
    subject: String(userId),
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  })
}

export interface AccessTokenPayload {
  userId: string
  role: UserRole
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] })
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null
    if (!USER_ROLES.includes(payload.role)) return null
    return { userId: payload.sub, role: payload.role }
  } catch {
    return null
  }
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createRefreshToken(
  userId: Types.ObjectId,
  userAgent?: string,
  family: string = nanoid(),
) {
  const token = randomBytes(48).toString('base64url')

  await RefreshToken.create({
    user: userId,
    tokenHash: hashToken(token),
    family,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    userAgent: userAgent?.slice(0, 300),
  })

  return token
}
