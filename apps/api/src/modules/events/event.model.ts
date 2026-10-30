import { Schema, model, type InferSchemaType } from 'mongoose'
import { customAlphabet } from 'nanoid'
import slugify from 'slugify'
import {
  COMUNA_CODES,
  EVENT_CATEGORIES,
  EVENT_RULES,
  EVENT_STATUSES,
  PRICE_TYPES,
  containsHtml,
  isCoverAspectRatio,
  type EventStatus,
} from '@parche/shared'
import { pointSchema } from '../venues/venue.model'

const { title, description, tags, maxPriceCop, cancellationReason } = EVENT_RULES

// RN-13
const slugSuffix = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)

export function buildEventSlug(title: string) {
  const base = slugify(title, { lower: true, strict: true, locale: 'es', trim: true })
  return `${base || 'evento'}-${slugSuffix()}`
}

interface EventThis {
  status?: EventStatus
  startAt?: Date | null
  publishedAt?: Date | null
  price?: { type?: string | null; min?: number | null } | null
}

// RN-07 y RN-08: el borrador se guarda incompleto; al salir de draft estos campos son obligatorios.
function requiredToPublish(this: EventThis) {
  return this.status !== 'draft'
}

const requiredIfStatus = (status: EventStatus, message: string): [() => boolean, string] => [
  function (this: EventThis) {
    return this.status === status
  },
  message,
]

const isWholeCop = (value: number) => Number.isInteger(value) && value <= maxPriceCop

const coverImageSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    width: { type: Number, required: true, min: 1 },
    height: { type: Number, required: true, min: 1 },
  },
  { _id: false },
)

coverImageSchema.path('height').validate(function (this: { width?: number }, height: number) {
  if (!this.width || !height) return true
  return isCoverAspectRatio(this.width, height)
}, 'La portada debe tener proporción 16:9')

const venueSnapshotSchema = new Schema(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    neighborhood: { type: String, required: true },
    comuna: { type: String, enum: COMUNA_CODES, required: true },
  },
  { _id: false },
)

const businessSnapshotSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: String,
    logoUrl: String,
  },
  { _id: false },
)

const counter = { type: Number, default: 0, min: 0 }

const eventSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    // Que sea del mismo negocio y esté activo lo comprueba el servicio: requiere consultar Venue.
    venue: { type: Schema.Types.ObjectId, ref: 'Venue', required: requiredToPublish },
    title: { type: String, required: true, trim: true, minlength: title.min, maxlength: title.max },
    slug: {
      type: String,
      required: true,
      immutable: function (this: EventThis) {
        return this.publishedAt != null
      },
    },
    description: {
      type: String,
      trim: true,
      minlength: description.min,
      maxlength: description.max,
      required: requiredToPublish,
      validate: {
        validator: (text: string) => !containsHtml(text),
        message: 'La descripción debe ser texto plano, sin HTML',
      },
    },
    category: { type: String, enum: EVENT_CATEGORIES, required: requiredToPublish },
    tags: {
      type: [
        {
          type: String,
          trim: true,
          lowercase: true,
          minlength: tags.minLength,
          maxlength: tags.maxLength,
        },
      ],
      validate: [
        {
          validator: (list: string[]) => list.length <= tags.max,
          message: `Máximo ${tags.max} etiquetas`,
        },
        {
          validator: (list: string[]) => new Set(list).size === list.length,
          message: 'Las etiquetas no se pueden repetir',
        },
      ],
    },
    // Fechas en UTC (RN-02). Que el inicio sea futuro (RN-10) depende de "ahora": lo valida
    // eventPublishSchema al publicar, no el modelo (un evento pasado debe poder guardarse).
    startAt: { type: Date, required: requiredToPublish },
    endAt: {
      type: Date,
      required: requiredToPublish,
      validate: {
        // RN-11
        validator: function (this: EventThis, endAt: Date) {
          if (!this.startAt) return true
          const duration = endAt.getTime() - this.startAt.getTime()
          return duration >= EVENT_RULES.minDurationMs && duration <= EVENT_RULES.maxDurationMs
        },
        message: 'El evento debe durar entre 15 minutos y 7 días',
      },
    },
    price: {
      type: { type: String, enum: PRICE_TYPES, required: requiredToPublish },
      min: {
        type: Number,
        required: requiredToPublish,
        validate: [
          {
            validator: isWholeCop,
            message: 'El precio debe ser un entero en COP de hasta 10.000.000',
          },
          {
            validator: function (this: EventThis, min: number) {
              if (this.price?.type === 'free') return min === 0
              if (this.price?.type === 'paid') return min > 0
              return min >= 0
            },
            message: 'El precio es 0 si el evento es gratis y mayor que 0 si es de pago',
          },
        ],
      },
      max: {
        type: Number,
        validate: [
          {
            validator: isWholeCop,
            message: 'El precio debe ser un entero en COP de hasta 10.000.000',
          },
          {
            validator: function (this: EventThis, max: number) {
              return this.price?.type !== 'free' && max >= (this.price?.min ?? 0)
            },
            message:
              'El precio máximo debe ser mayor o igual al mínimo y solo aplica a eventos de pago',
          },
        ],
      },
    },
    coverImage: { type: coverImageSchema, required: requiredToPublish },
    externalUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      match: [/^https:\/\/\S+$/, 'El enlace debe ser una URL https://'],
    },
    isAdultOnly: { type: Boolean, default: false },
    status: { type: String, enum: EVENT_STATUSES, default: 'draft', required: true },
    publishedAt: Date,
    cancelledAt: Date,
    cancellationReason: {
      type: String,
      trim: true,
      minlength: cancellationReason.min,
      maxlength: cancellationReason.max,
      required: requiredIfStatus('cancelled', 'El motivo de cancelación es obligatorio'),
    },
    removalReason: {
      type: String,
      trim: true,
      minlength: 10,
      maxlength: 300,
      required: requiredIfStatus('removed', 'El motivo de retiro es obligatorio'),
    },
    // Copias desnormalizadas del lugar y del negocio para pintar tarjetas sin populate.
    location: { type: pointSchema, required: requiredToPublish },
    venueSnapshot: { type: venueSnapshotSchema, required: requiredToPublish },
    businessSnapshot: { type: businessSnapshotSchema, required: true },
    seriesId: { type: Schema.Types.ObjectId },
    stats: {
      views: counter,
      directionsClicks: counter,
      externalClicks: counter,
      saves: counter,
    },
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

eventSchema.pre('validate', function () {
  // El slug sigue al título mientras el evento no se haya publicado nunca.
  const followsTitle = this.publishedAt == null && this.isModified('title')
  if (this.title && (!this.slug || followsTitle)) {
    this.slug = buildEventSlug(this.title)
  }
  if (this.status === 'published' && this.publishedAt == null) {
    this.publishedAt = new Date()
  }
})

eventSchema.index({ slug: 1 }, { unique: true })
eventSchema.index({ location: '2dsphere' })
// Listados públicos: publicados que se solapan con un rango (utils/dateRanges).
eventSchema.index({ status: 1, endAt: 1, startAt: 1 })
// Pestañas y contadores del panel del gestor.
eventSchema.index({ business: 1, status: 1, endAt: 1 })

export type EventDoc = InferSchemaType<typeof eventSchema>
export const Event = model('Event', eventSchema)
