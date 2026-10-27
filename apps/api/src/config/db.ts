import mongoose from 'mongoose'
import './mongoose'
import { env } from './env'

export async function connectDB() {
  await mongoose.connect(env.MONGODB_URI)
  console.log(`✅ MongoDB conectado: ${mongoose.connection.name}`)
}
