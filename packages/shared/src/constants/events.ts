import type { EventStatus } from './catalogs'

export const PRICE_TYPES = ['free', 'paid'] as const
export type PriceType = (typeof PRICE_TYPES)[number]

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

// Reglas de eventos que comparten el modelo, la API y el frontend.
export const EVENT_RULES = {
  title: { min: 5, max: 100 },
  description: { min: 20, max: 2000 },
  tags: { max: 5, minLength: 2, maxLength: 24 },
  // RN-18
  cancellationReason: { min: 10, max: 300 },
  // RN-14
  maxPriceCop: 10_000_000,
  // RN-10
  maxDaysAhead: 180,
  maxStartAheadMs: 180 * DAY_MS,
  // RN-11
  minDurationMs: 15 * MINUTE_MS,
  maxDurationMs: 7 * DAY_MS,
  // RN-29: portada 16:9; se tolera un 2 % por el redondeo de los recortes.
  coverAspectRatio: 16 / 9,
  coverAspectTolerance: 0.02,
} as const

export function isCoverAspectRatio(width: number, height: number) {
  return (
    Math.abs(width / height / EVENT_RULES.coverAspectRatio - 1) <= EVENT_RULES.coverAspectTolerance
  )
}

// Texto plano: cualquier cosa con forma de etiqueta (<b>, </p>, <!-- -->, <script>) se rechaza.
export function containsHtml(text: string) {
  return /<[a-z!/?][^>]*>/i.test(text)
}

// RN-16: lo único que se puede tocar mientras el evento está en curso.
export const ONGOING_EDITABLE_FIELDS = ['description', 'price', 'externalUrl', 'endAt'] as const
export type OngoingEditableField = (typeof ONGOING_EDITABLE_FIELDS)[number]

// full: borrador o publicado sin empezar (RN-15); ongoing: en curso (RN-16);
// locked: finalizado, cancelado o retirado (RN-17).
export type EventEditPhase = 'full' | 'ongoing' | 'locked'

interface EditableEvent {
  status: EventStatus
  startAt?: Date | null
  endAt?: Date | null
}

export function eventEditPhase(
  { status, startAt, endAt }: EditableEvent,
  now: Date = new Date(),
): EventEditPhase {
  if (status === 'draft') return 'full'
  if (status !== 'published' || !startAt || !endAt) return 'locked'
  if (now < startAt) return 'full'
  return now < endAt ? 'ongoing' : 'locked'
}

// RF-GES-11: pestañas del listado del gestor; el listado va de 20 en 20.
export const MY_EVENT_TABS = ['upcoming', 'drafts', 'past', 'cancelled'] as const
export type MyEventTab = (typeof MY_EVENT_TABS)[number]
export const MY_EVENTS_PAGE_SIZE = 20

// Etiqueta de estado que ve el gestor en cada fila.
export type EventDisplayStatus = 'draft' | 'upcoming' | 'ongoing' | 'past' | 'cancelled' | 'removed'

export function eventDisplayStatus(event: EditableEvent, now: Date = new Date()): EventDisplayStatus {
  if (event.status !== 'published') return event.status
  const phase = eventEditPhase(event, now)
  if (phase === 'full') return 'upcoming'
  return phase === 'ongoing' ? 'ongoing' : 'past'
}

// Acciones de cada fila del listado. La ficha pública existe para publicados y cancelados (RN-18).
export function eventActions(event: EditableEvent, now: Date = new Date()) {
  const phase = eventEditPhase(event, now)
  return {
    view: event.status === 'published' || event.status === 'cancelled',
    edit: phase !== 'locked',
    duplicate: true,
    cancel: event.status === 'published' && phase !== 'locked',
    delete: event.status === 'draft',
  }
}
