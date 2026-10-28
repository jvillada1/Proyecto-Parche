import { z } from 'zod'

export const searchQuerySchema = z.object({
  q: z
    .string('Escribe la dirección a buscar')
    .trim()
    .min(3, 'Escribe al menos 3 caracteres')
    .max(200, 'La búsqueda no puede superar 200 caracteres'),
})

export const reverseQuerySchema = z.object({
  lat: z.coerce.number('La latitud debe ser un número').min(-90).max(90),
  lng: z.coerce.number('La longitud debe ser un número').min(-180).max(180),
})

export type SearchQuery = z.infer<typeof searchQuerySchema>
export type ReverseQuery = z.infer<typeof reverseQuerySchema>
