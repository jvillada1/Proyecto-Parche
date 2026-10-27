import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll } from 'vitest'
import '../config/mongoose'

const mongoServer = await MongoMemoryServer.create()

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = mongoServer.getUri('parche_test')
process.env.JWT_ACCESS_SECRET = 'test-access-secret-test-access-secret'
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-test-refresh-secret'

await mongoose.connect(process.env.MONGODB_URI)

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})
