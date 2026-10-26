export const USER_ROLES = ['user', 'manager', 'admin'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const EVENT_STATUSES = ['draft', 'published', 'cancelled', 'removed'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

export const EVENT_CATEGORIES = [
  'musica-en-vivo',
  'fiesta',
  'gastronomia',
  'cultura',
  'deporte-bienestar',
  'mercados-ferias',
  'talleres',
  'familiar',
  'otro',
] as const
export type EventCategory = (typeof EVENT_CATEGORIES)[number]

export const BUSINESS_TYPES = [
  'restaurante',
  'bar',
  'cafe',
  'discoteca',
  'centro-cultural',
  'marca',
  'organizador',
  'otro',
] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

export const VERIFICATION_STATUSES = ['pending', 'approved', 'rejected'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export const COMUNAS = {
  '01': 'Popular',
  '02': 'Santa Cruz',
  '03': 'Manrique',
  '04': 'Aranjuez',
  '05': 'Castilla',
  '06': 'Doce de Octubre',
  '07': 'Robledo',
  '08': 'Villa Hermosa',
  '09': 'Buenos Aires',
  '10': 'La Candelaria',
  '11': 'Laureles - Estadio',
  '12': 'La América',
  '13': 'San Javier',
  '14': 'El Poblado',
  '15': 'Guayabal',
  '16': 'Belén',
  '50': 'San Sebastián de Palmitas',
  '60': 'San Cristóbal',
  '70': 'Altavista',
  '80': 'San Antonio de Prado',
  '90': 'Santa Elena',
} as const
export type ComunaCode = keyof typeof COMUNAS
export const COMUNA_CODES = Object.keys(COMUNAS) as ComunaCode[]
