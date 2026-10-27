import { Schema, model, type InferSchemaType } from 'mongoose'
import { COMUNA_CODES, MUNICIPALITIES, isInServiceArea } from '@parche/shared'

function isLngLatPair(coordinates: number[]) {
  return coordinates.length === 2 && coordinates.every(Number.isFinite)
}

const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point', required: true },
    coordinates: {
      type: [Number],
      required: true,
      validate: [
        {
          validator: isLngLatPair,
          message: 'Las coordenadas deben ser [longitud, latitud]',
        },
        {
          // RN-23: la sede debe estar dentro del área de servicio.
          validator: (coordinates: number[]) =>
            !isLngLatPair(coordinates) || isInServiceArea(coordinates[1]!, coordinates[0]!),
          message: 'La ubicación está fuera del área de servicio',
        },
      ],
    },
  },
  { _id: false },
)

const venueSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    address: { type: String, required: true, trim: true, minlength: 5, maxlength: 160 },
    neighborhood: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    comuna: { type: String, enum: COMUNA_CODES, required: true },
    municipality: { type: String, enum: MUNICIPALITIES, default: 'medellin', required: true },
    location: { type: pointSchema, required: true },
    referenceNotes: { type: String, trim: true, maxlength: 200 },
    isActive: { type: Boolean, default: true, required: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = String(ret._id)
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

venueSchema.index({ location: '2dsphere' })

export type VenueDoc = InferSchemaType<typeof venueSchema>
export const Venue = model('Venue', venueSchema)
