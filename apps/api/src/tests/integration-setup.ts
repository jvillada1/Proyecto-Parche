import { randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import { afterAll } from 'vitest'
import '../config/mongoose'

const mongoBaseUri = process.env.INTEGRATION_MONGODB_URI ?? 'mongodb://localhost:27017'
const databaseName = `parche_integration_${randomBytes(4).toString('hex')}`

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = `${mongoBaseUri}/${databaseName}`
process.env.JWT_ACCESS_SECRET = 'integration-access-secret-integration-access'
process.env.JWT_REFRESH_SECRET = 'integration-refresh-secret-integration-refresh'
process.env.CLOUDINARY_CLOUD_NAME = 'parche-test'
process.env.CLOUDINARY_API_KEY = '123456789012345'
process.env.CLOUDINARY_API_SECRET = 'secreto-de-pruebas'
process.env.CLOUDINARY_FOLDER = 'parche-test'

try {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 })
} catch (error) {
  throw new Error(`No se pudo conectar a MongoDB en ${mongoBaseUri}. ¿Corriste "pnpm db:up"?`, {
    cause: error,
  })
}

afterAll(async () => {
  await Promise.all(mongoose.modelNames().map((modelName) => mongoose.model(modelName).init()))
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})
