import { z } from 'zod'
import { BUSINESS_TYPES } from '@parche/shared'

const phoneSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^3\d{9}$/, 'El celular debe tener 10 dígitos y empezar por 3'))

const instagramSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(
    z
      .string()
      .regex(
        /^[A-Za-z0-9._]{1,30}$/,
        'Instagram: solo letras, números, punto y guion bajo (máx. 30)',
      ),
  )

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && z.regexes.domain.test(url.hostname)
  } catch {
    return false
  }
}

const websiteSchema = z
  .string()
  .trim()
  .max(300, 'El sitio web no puede superar 300 caracteres')
  .refine(isHttpsUrl, 'El sitio web debe ser una URL https:// válida')

const contactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(120, 'El correo no puede superar 120 caracteres')
  .pipe(z.email('Correo de contacto inválido'))

// `null` borra el campo; omitirlo lo deja como está.
export const updateMyBusinessSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'El nombre del negocio debe tener al menos 2 caracteres')
      .max(80, 'El nombre del negocio no puede superar 80 caracteres')
      .optional(),
    type: z.enum(BUSINESS_TYPES, 'Tipo de negocio inválido').optional(),
    description: z
      .string()
      .trim()
      .max(1000, 'La descripción no puede superar 1000 caracteres')
      .nullable()
      .optional(),
    contact: z
      .object({
        phone: phoneSchema.nullable().optional(),
        email: contactEmailSchema.nullable().optional(),
        website: websiteSchema.nullable().optional(),
        instagram: instagramSchema.nullable().optional(),
      })
      .optional(),
  })
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    'Envía al menos un campo para actualizar',
  )

export type UpdateMyBusinessInput = z.infer<typeof updateMyBusinessSchema>
