import { randomUUID } from 'node:crypto'
import { pinoHttp } from 'pino-http'
import { logger } from '../lib/logger'

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const requestId = req.headers['x-request-id']
    const id = typeof requestId === 'string' ? requestId : randomUUID()
    res.setHeader('X-Request-Id', id)
    return id
  },
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return 'error'
    if (res.statusCode >= 400) return 'warn'
    return 'info'
  },
  autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
})
