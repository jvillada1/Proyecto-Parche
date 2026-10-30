import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import { User } from '../modules/users/user.model'
import { Business } from '../modules/businesses/business.model'
import { RefreshToken } from '../modules/auth/refresh-token.model'
import { Venue } from '../modules/venues/venue.model'
import { Event } from '../modules/events/event.model'

const models = [User, RefreshToken, Business, Venue, Event]

await connectDB()

for (const model of models) {
  await model.createCollection()
  await model.syncIndexes()
  const indexes = await model.collection.indexes()
  console.log(
    `${model.collection.collectionName}: ${indexes.map((index) => index.name).join(', ')}`,
  )
}

await mongoose.disconnect()
