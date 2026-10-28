import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll } from 'vitest'
import '../config/mongoose'

const mongoServer = await MongoMemoryServer.create()

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = mongoServer.getUri('parche_test')
process.env.JWT_ACCESS_SECRET = 'test-access-secret-test-access-secret'
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-test-refresh-secret'
process.env.CLOUDINARY_CLOUD_NAME = 'parche-test'
process.env.CLOUDINARY_API_KEY = '123456789012345'
process.env.CLOUDINARY_API_SECRET = 'secreto-de-pruebas'
process.env.CLOUDINARY_FOLDER = 'parche-test'

await mongoose.connect(process.env.MONGODB_URI)

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})
