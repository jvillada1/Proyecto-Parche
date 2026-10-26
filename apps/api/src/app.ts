import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import mongoose from 'mongoose'
import { env } from './config/env'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  app.get('/api/v1/health', (_req, res) => {
    const dbOk = mongoose.connection.readyState === 1
    res.status(dbOk ? 200 : 503).json({ data: { status: dbOk ? 'ok' : 'degraded', db: dbOk } })
  })

  // Aquí irán las rutas de cada módulo, por ejemplo:
  // app.use('/api/v1/auth', authRoutes);

  return app
}
