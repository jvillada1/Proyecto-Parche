import { Schema, model, type InferSchemaType } from 'mongoose'
import { BUSINESS_TYPES, VERIFICATION_STATUSES } from '@parche/shared'

const imageSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { _id: false },
)

const businessSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    slug: { type: String, lowercase: true, trim: true },
    type: { type: String, enum: BUSINESS_TYPES, required: true },
    description: { type: String, trim: true, maxlength: 1000 },
    logo: imageSchema,
    coverImage: imageSchema,
    contact: {
      phone: {
        type: String,
        set: (value: string) => value.replace(/\s+/g, ''),
        match: [/^3\d{9}$/, 'El celular debe tener 10 dígitos y empezar por 3'],
      },
      email: {
        type: String,
        lowercase: true,
        trim: true,
        maxlength: 120,
        match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Correo de contacto inválido'],
      },
      website: {
        type: String,
        trim: true,
        match: [/^https:\/\/\S+$/, 'El sitio web debe ser una URL https://'],
      },
      instagram: {
        type: String,
        trim: true,
        set: (value: string) => value.replace(/^@/, ''),
        match: [
          /^[A-Za-z0-9._]{1,30}$/,
          'Instagram: solo letras, números, punto y guion bajo (máx. 30)',
        ],
      },
    },
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'pending' },
    rejectionReason: {
      type: String,
      trim: true,
      minlength: 10,
      maxlength: 300,
      required: [
        function (this: { verificationStatus?: string }) {
          return this.verificationStatus === 'rejected'
        },
        'El motivo de rechazo es obligatorio',
      ],
    },
    verifiedAt: Date,
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
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

businessSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: 'string' } } },
)

export type BusinessDoc = InferSchemaType<typeof businessSchema>
export const Business = model('Business', businessSchema)
