import { env } from './config/env'
import { connectDB } from './config/db'
import { createApp } from './app'

await connectDB()

createApp().listen(env.PORT, () => {
  console.log(`API en http://localhost:${env.PORT}/api/v1/health`)
})
