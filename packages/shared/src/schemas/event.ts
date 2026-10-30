import { z } from 'zod'
import { EVENT_CATEGORIES } from '../constants/catalogs'
import {
  EVENT_RULES,
  MY_EVENT_TABS,
  containsHtml,
  isCoverAspectRatio,
} from '../constants/events'

const { title, description, tags, maxPriceCop, cancellationReason } = EVENT_RULES

const titleSchema = z
  .string('El título es obligatorio')
  .trim()
  .min(title.min, `El título debe tener al menos ${title.min} caracteres`)
  .max(title.max, `El título no puede superar ${title.max} caracteres`)

const descriptionSchema = z
  .string('La descripción es obligatoria')
  .trim()
  .min(description.min, `La descripción debe tener al menos ${description.min} caracteres`)
  .max(description.max, `La descripción no puede superar ${description.max} caracteres`)
  .refine((text) => !containsHtml(text), 'La descripción debe ser texto plano, sin HTML')

const categorySchema = z.enum(EVENT_CATEGORIES, 'Elige una categoría válida')

const tagsSchema = z
  .array(
    z
      .string('Cada etiqueta debe ser texto')
      .trim()
      .toLowerCase()
      .min(tags.minLength, `Cada etiqueta debe tener al menos ${tags.minLength} caracteres`)
      .max(tags.maxLength, `Cada etiqueta puede tener como máximo ${tags.maxLength} caracteres`),
    'Las etiquetas deben ser una lista',
  )
  .max(tags.max, `Máximo ${tags.max} etiquetas`)
  .refine((list) => new Set(list).size === list.length, 'Las etiquetas no se pueden repetir')

const venueIdSchema = z
  .string('El lugar es obligatorio')
  .regex(/^[0-9a-f]{24}$/i, 'Identificador de lugar inválido')

// RN-02: se exige la zona horaria explícita ("Z" o "-05:00") para no adivinar la del cliente.
const dateSchema = (requiredMessage: string) =>
  z.iso
    .datetime({
      offset: true,
      error: (issue) =>
        issue.input === undefined
          ? requiredMessage
          : 'Fecha inválida: usa ISO 8601 con zona horaria',
    })
    .transform((value) => new Date(value))

const copSchema = z
  .number('El precio debe ser un número')
  .int('El precio debe ser un entero en pesos')
  .max(maxPriceCop, `El precio no puede superar ${maxPriceCop.toLocaleString('es-CO')} COP`)

// RN-14
export const priceSchema = z.discriminatedUnion(
  'type',
  [
    z.object({
      type: z.literal('free'),
      min: z.literal(0, 'Un evento gratis tiene precio 0'),
      max: z.undefined('El precio máximo solo aplica a eventos de pago').optional(),
    }),
    z
      .object({
        type: z.literal('paid'),
        min: copSchema.positive('Un evento de pago debe tener precio mayor que 0'),
        max: copSchema.optional(),
      })
      .refine((price) => price.max === undefined || price.max >= price.min, {
        message: 'El precio máximo debe ser mayor o igual al mínimo',
        path: ['max'],
      }),
  ],
  {
    error: (issue) =>
      issue.input === undefined
        ? 'El precio es obligatorio'
        : 'El tipo de precio debe ser free o paid',
  },
)

// RN-29
export const coverImageSchema = z
  .object(
    {
      url: z.url({ protocol: /^https$/, error: 'La portada debe tener una URL https://' }).max(500),
      publicId: z.string('Falta el publicId de la portada').trim().min(1).max(300),
      width: z.number('Falta el ancho de la portada').int().positive(),
      height: z.number('Falta el alto de la portada').int().positive(),
    },
    'La imagen de portada es obligatoria',
  )
  .refine((image) => isCoverAspectRatio(image.width, image.height), {
    message: 'La portada debe tener proporción 16:9',
    path: ['height'],
  })

const externalUrlSchema = z
  .url({
    protocol: /^https$/,
    hostname: z.regexes.domain,
    error: 'El enlace debe ser una URL https:// válida',
  })
  .max(500, 'El enlace no puede superar 500 caracteres')

const isAdultOnlySchema = z.boolean('isAdultOnly debe ser true o false')

interface EventDates {
  startAt?: Date
  endAt?: Date
}

// RN-11
function checkDuration({ startAt, endAt }: EventDates, ctx: z.RefinementCtx) {
  if (!startAt || !endAt) return
  const duration = endAt.getTime() - startAt.getTime()

  let message: string | undefined
  if (duration <= 0) message = 'La fecha de fin debe ser posterior a la de inicio'
  else if (duration < EVENT_RULES.minDurationMs)
    message = 'El evento debe durar al menos 15 minutos'
  else if (duration > EVENT_RULES.maxDurationMs)
    message = 'El evento puede durar como máximo 7 días'

  if (message) ctx.addIssue({ code: 'custom', message, path: ['endAt'] })
}

// RN-10: depende de "ahora", por eso solo se aplica al publicar.
function checkStart({ startAt }: EventDates, ctx: z.RefinementCtx) {
  if (!startAt) return
  const aheadMs = startAt.getTime() - Date.now()

  if (aheadMs <= 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'El evento debe empezar en el futuro',
      path: ['startAt'],
    })
  } else if (aheadMs > EVENT_RULES.maxStartAheadMs) {
    ctx.addIssue({
      code: 'custom',
      message: `El evento puede empezar como máximo dentro de ${EVENT_RULES.maxDaysAhead} días`,
      path: ['startAt'],
    })
  }
}

const optionalFields = {
  tags: tagsSchema.optional(),
  externalUrl: externalUrlSchema.optional(),
  isAdultOnly: isAdultOnlySchema.optional(),
}

const draftFields = {
  title: titleSchema,
  description: descriptionSchema.optional(),
  category: categorySchema.optional(),
  venueId: venueIdSchema.optional(),
  startAt: dateSchema('La fecha de inicio es obligatoria').optional(),
  endAt: dateSchema('La fecha de fin es obligatoria').optional(),
  price: priceSchema.optional(),
  coverImage: coverImageSchema.optional(),
  ...optionalFields,
}

// RN-07: el borrador solo exige el título; lo que llegue se valida igual.
export const eventDraftSchema = z.object(draftFields).superRefine(checkDuration)

// PATCH: todo es opcional y lo que llegue se valida como en el borrador. Qué campos se pueden
// tocar según la fase (RN-15 a RN-17) y las reglas sobre el evento ya combinado las aplica la API.
export const eventUpdateSchema = z
  .object({ ...draftFields, title: titleSchema.optional() })
  .superRefine(checkDuration)
  .refine((changes) => Object.keys(changes).length > 0, 'Envía al menos un campo para actualizar')

// RN-08, RN-10, RN-11 y RN-14: lo que debe cumplir un evento para publicarse.
export const eventPublishSchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema,
    category: categorySchema,
    venueId: venueIdSchema,
    startAt: dateSchema('La fecha de inicio es obligatoria'),
    endAt: dateSchema('La fecha de fin es obligatoria'),
    price: priceSchema,
    coverImage: coverImageSchema,
    ...optionalFields,
  })
  .superRefine((event, ctx) => {
    checkStart(event, ctx)
    checkDuration(event, ctx)
  })

// RN-16: en curso solo se mueve el cierre; debe quedar en el futuro y respetar RN-11.
export const eventOngoingSchema = z
  .object({
    startAt: dateSchema('La fecha de inicio es obligatoria'),
    endAt: dateSchema('La fecha de fin es obligatoria'),
  })
  .superRefine((event, ctx) => {
    if (event.endAt.getTime() <= Date.now()) {
      ctx.addIssue({
        code: 'custom',
        message: 'La fecha de fin debe ser posterior al momento actual',
        path: ['endAt'],
      })
      return
    }
    checkDuration(event, ctx)
  })

// RN-18
export const eventCancelSchema = z.object({
  reason: z
    .string('El motivo de cancelación es obligatorio')
    .trim()
    .min(
      cancellationReason.min,
      `El motivo debe tener al menos ${cancellationReason.min} caracteres`,
    )
    .max(cancellationReason.max, `El motivo no puede superar ${cancellationReason.max} caracteres`),
})

// RF-GES-11
export const myEventsQuerySchema = z.object({
  tab: z
    .enum(MY_EVENT_TABS, 'La pestaña debe ser upcoming, drafts, past o cancelled')
    .default('upcoming'),
  page: z.coerce.number('La página debe ser un número').int().min(1).default(1),
})

export type EventDraftInput = z.infer<typeof eventDraftSchema>
export type EventPublishInput = z.infer<typeof eventPublishSchema>
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>
export type EventCancelInput = z.infer<typeof eventCancelSchema>
export type MyEventsQuery = z.infer<typeof myEventsQuerySchema>
export type PriceInput = z.infer<typeof priceSchema>
export type CoverImageInput = z.infer<typeof coverImageSchema>
