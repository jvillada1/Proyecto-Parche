import type { RequestHandler } from 'express'
import type { UserRole } from '@parche/shared'
import { verifyAccessToken } from '../lib/tokens'
import { ForbiddenError, UnauthorizedError } from '../utils/app-error'

const BEARER_PREFIX = 'Bearer '

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.get('authorization')
  if (!header?.startsWith(BEARER_PREFIX)) {
    return next(new UnauthorizedError('Falta el token de acceso'))
  }

  const payload = verifyAccessToken(header.slice(BEARER_PREFIX.length).trim())
  if (!payload) return next(new UnauthorizedError('Token de acceso inválido o expirado'))

  req.auth = payload
  next()
}

export function requireRole(...roles: [UserRole, ...UserRole[]]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new UnauthorizedError())
    if (!roles.includes(req.auth.role)) return next(new ForbiddenError())
    next()
  }
}
