import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import { User } from '../modules/users/user.model'
// Cuando crees los demás modelos, impórtalos aquí y agrégalos a la lista:
// import { Business } from '../modules/businesses/business.model';
// import { Venue } from '../modules/venues/venue.model';
// import { Event } from '../modules/events/event.model';

const models = [User]

await connectDB()

for (const m of models) {
  await m.createCollection()
  await m.syncIndexes()
  const indexes = await m.collection.indexes()
  console.log(`${m.collection.collectionName}: ${indexes.map((i) => i.name).join(', ')}`)
}

await mongoose.disconnect()
