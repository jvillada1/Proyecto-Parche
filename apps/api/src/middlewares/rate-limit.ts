import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import type { Request } from 'express'
import { env } from '../config/env'
import { TooManyRequestsError } from '../utils/app-error'

interface RateLimiterOptions {
  windowMs: number
  limit: number
  message?: string
  countOnlyFailures?: boolean
  keyParts?: (req: Request) => string[]
}

export function createRateLimiter({
  windowMs,
  limit,
  message,
  countOnlyFailures = false,
  keyParts = () => [],
}: RateLimiterOptions) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: countOnlyFailures,
    keyGenerator: (req) => [ipKeyGenerator(req.ip ?? ''), ...keyParts(req)].join('|'),
    skip: () => env.NODE_ENV === 'test' && process.env.ENABLE_RATE_LIMIT_IN_TESTS !== 'true',
    handler: (_req, _res, next) => next(new TooManyRequestsError(message)),
  })
}

export const registerRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: 'Demasiados registros desde esta red, intenta de nuevo en una hora',
})

export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: 'Demasiados intentos fallidos, intenta de nuevo en 15 minutos',
  countOnlyFailures: true,
  keyParts: (req) => [String(req.body?.email ?? '')],
})
