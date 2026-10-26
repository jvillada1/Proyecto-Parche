import { env } from './config/env'
import { connectDB } from './config/db'
import { createApp } from './app'
import { logger } from './lib/logger'

await connectDB()

createApp().listen(env.PORT, () => {
  logger.info(`API en http://localhost:${env.PORT}/api/v1/health`)
})
