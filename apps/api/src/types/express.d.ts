import type { AccessTokenPayload } from '../lib/tokens'

declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenPayload
    }
  }
}

export {}
