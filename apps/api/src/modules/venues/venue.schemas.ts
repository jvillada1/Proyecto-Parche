import { z } from 'zod'
import { COMUNA_CODES, MUNICIPALITIES, type ComunaCode } from '@parche/shared'

// La API recibe { lat, lng } para evitar confusiones de orden; se guarda como GeoJSON [lng, lat].
const locationSchema = z.object({
  lat: z.number('La latitud debe ser un número').min(-90).max(90),
  lng: z.number('La longitud debe ser un número').min(-180).max(180),
})

const nameSchema = z
  .string()
  .trim()
  .min(2, 'El nombre debe tener al menos 2 caracteres')
  .max(80, 'El nombre no puede superar 80 caracteres')

const addressSchema = z
  .string()
  .trim()
  .min(5, 'La dirección debe tener al menos 5 caracteres')
  .max(160, 'La dirección no puede superar 160 caracteres')

const neighborhoodSchema = z
  .string()
  .trim()
  .min(2, 'El barrio debe tener al menos 2 caracteres')
  .max(60, 'El barrio no puede superar 60 caracteres')

const comunaSchema = z.enum(
  COMUNA_CODES as [ComunaCode, ...ComunaCode[]],
  'Código de comuna o corregimiento inválido',
)

const municipalitySchema = z.enum(MUNICIPALITIES, 'Municipio no disponible')

const referenceNotesSchema = z
  .string()
  .trim()
  .max(200, 'Las indicaciones no pueden superar 200 caracteres')

export const createVenueSchema = z.object({
  name: nameSchema,
  address: addressSchema,
  neighborhood: neighborhoodSchema,
  comuna: comunaSchema,
  municipality: municipalitySchema.optional(),
  location: locationSchema,
  referenceNotes: referenceNotesSchema.optional(),
})

// `null` en referenceNotes borra el campo; omitir un campo lo deja como está.
export const updateVenueSchema = z
  .object({
    name: nameSchema.optional(),
    address: addressSchema.optional(),
    neighborhood: neighborhoodSchema.optional(),
    comuna: comunaSchema.optional(),
    municipality: municipalitySchema.optional(),
    location: locationSchema.optional(),
    referenceNotes: referenceNotesSchema.nullable().optional(),
    isActive: z.boolean('isActive debe ser true o false').optional(),
  })
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    'Envía al menos un campo para actualizar',
  )

export type LocationInput = z.infer<typeof locationSchema>
export type CreateVenueInput = z.infer<typeof createVenueSchema>
export type UpdateVenueInput = z.infer<typeof updateVenueSchema>
