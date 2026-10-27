import type { Request } from 'express'
import { UnauthorizedError } from './app-error'

export function currentUserId(req: Request) {
  if (!req.auth) throw new UnauthorizedError()
  return req.auth.userId
}
