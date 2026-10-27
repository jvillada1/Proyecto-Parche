import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import mongoose from 'mongoose'
import './config/zod'
import { env } from './config/env'
import { authRoutes } from './modules/auth/auth.routes'
import { myBusinessRoutes } from './modules/businesses/my-business.routes'
import { myVenuesRoutes } from './modules/venues/my-venues.routes'
import { httpLogger } from './middlewares/http-logger'
import { errorHandler, notFoundHandler } from './middlewares/error-handler'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)
  app.use(httpLogger)
  app.use(helmet())
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  app.get('/api/v1/health', (_req, res) => {
    const dbOk = mongoose.connection.readyState === 1
    res.status(dbOk ? 200 : 503).json({ data: { status: dbOk ? 'ok' : 'degraded', db: dbOk } })
  })

  app.use('/api/v1/auth', authRoutes)
  app.use('/api/v1/me/business', myBusinessRoutes)
  app.use('/api/v1/me/venues', myVenuesRoutes)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
