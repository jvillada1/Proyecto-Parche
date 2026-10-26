import mongoose from 'mongoose'
import { env } from './env'

export async function connectDB() {
  mongoose.set('strictQuery', true)
  mongoose.set('sanitizeFilter', true)
  await mongoose.connect(env.MONGODB_URI)
  console.log(`✅ MongoDB conectado: ${mongoose.connection.name}`)
}
