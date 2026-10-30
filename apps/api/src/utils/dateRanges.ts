import { TZDate } from '@date-fns/tz'
import { addDays, setHours, startOfDay, startOfWeek } from 'date-fns'
import mongoose from 'mongoose'

// RN-02: se guarda en UTC; "hoy", "mañana" y "fin de semana" se calculan en hora de Colombia.
// Nunca se usa getHours() & co. sobre un Date nativo: dependen de la zona del servidor.
export const APP_TIME_ZONE = 'America/Bogota'

export const DATE_FILTERS = ['today', 'tomorrow', 'weekend'] as const
export type DateFilter = (typeof DATE_FILTERS)[number]

// Intervalo semiabierto [start, end): un evento que empieza justo en `end` no entra.
export interface DateRange {
  start: Date
  end: Date
}

export interface DatedEvent {
  startAt: Date
  endAt: Date
  status: string
}

const WEEKEND_START_HOUR = 18 // el fin de semana arranca el viernes a las 18:00

const toLocal = (date: Date) => new TZDate(date.getTime(), APP_TIME_ZONE)
const toUtc = (date: Date) => new Date(date.getTime())

// Día calendario completo en Colombia; offsetDays = 0 es hoy, 1 es mañana.
export function dayRange(offsetDays = 0, now: Date = new Date()): DateRange {
  const start = startOfDay(addDays(toLocal(now), offsetDays))
  return { start: toUtc(start), end: toUtc(addDays(start, 1)) }
}

// Viernes 18:00 → lunes 00:00 de la semana (lunes a domingo) que contiene `now`.
export function weekendRange(now: Date = new Date()): DateRange {
  const monday = startOfWeek(toLocal(now), { weekStartsOn: 1 })
  const start = setHours(addDays(monday, 4), WEEKEND_START_HOUR)
  return { start: toUtc(start), end: toUtc(addDays(monday, 7)) }
}

// Rango que se usa para filtrar: nunca empieza antes de `now`, así lo que ya terminó no aparece
// y lo que está en curso sí.
export function resolveDateRange(filter: DateFilter, now: Date = new Date()): DateRange {
  const range =
    filter === 'weekend' ? weekendRange(now) : dayRange(filter === 'tomorrow' ? 1 : 0, now)
  return { start: range.start < now ? toUtc(now) : range.start, end: range.end }
}

// Un evento entra si se solapa con el rango: empieza antes de que termine y termina después de que empiece.
export function overlapsRange(event: Pick<DatedEvent, 'startAt' | 'endAt'>, range: DateRange) {
  return event.startAt < range.end && event.endAt > range.start
}

export function isEventInRange(event: DatedEvent, range: DateRange) {
  return event.status === 'published' && overlapsRange(event, range)
}

// Misma condición que overlapsRange, lista para un find() de MongoDB. Los operadores van en
// mongoose.trusted porque sanitizeFilter está activo (config/mongoose).
export function overlapQuery(range: DateRange) {
  return {
    startAt: mongoose.trusted({ $lt: range.end }),
    endAt: mongoose.trusted({ $gt: range.start }),
  }
}
