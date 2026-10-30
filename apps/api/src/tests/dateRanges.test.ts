import mongoose, { Types } from 'mongoose'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Event } from '../modules/events/event.model'
import {
  type DateFilter,
  dayRange,
  isEventInRange,
  overlapQuery,
  resolveDateRange,
  weekendRange,
} from '../utils/dateRanges'

// Hora de Colombia (UTC−5 todo el año) → instante UTC.
const co = (local: string) => new Date(`${local}-05:00`)

// El documento dice "miércoles 22 de octubre de 2026", pero ese día es jueves.
// Se usa la semana real: mar 20, mié 21, jue 22, vie 23, sáb 24, dom 25.
const TUE = '2026-10-20'
const WED = '2026-10-21'
const THU = '2026-10-22'
const FRI = '2026-10-23'
const SAT = '2026-10-24'
const SUN = '2026-10-25'

interface Case {
  n: number
  now: string
  startAt: string
  endAt: string
  status?: string
  filter: DateFilter
  expected: boolean
}

// Sección 13.3. El caso 6 se parte en dos filas (hoy y mañana).
// prettier-ignore
const CASES: Case[] = [
  { n: 1, now: `${WED}T14:00`, startAt: `${WED}T20:00`, endAt: `${WED}T23:00`, filter: 'today', expected: true },
  { n: 2, now: `${WED}T14:00`, startAt: `${WED}T08:00`, endAt: `${WED}T10:00`, filter: 'today', expected: false },
  { n: 3, now: `${WED}T14:00`, startAt: `${WED}T12:00`, endAt: `${WED}T16:00`, filter: 'today', expected: true },
  { n: 4, now: `${WED}T01:00`, startAt: `${TUE}T22:00`, endAt: `${WED}T03:00`, filter: 'today', expected: true },
  { n: 5, now: `${WED}T14:00`, startAt: `${TUE}T22:00`, endAt: `${WED}T03:00`, filter: 'today', expected: false },
  { n: 6, now: `${WED}T14:00`, startAt: `${WED}T23:00`, endAt: `${THU}T02:00`, filter: 'today', expected: true },
  { n: 6, now: `${WED}T14:00`, startAt: `${WED}T23:00`, endAt: `${THU}T02:00`, filter: 'tomorrow', expected: true },
  { n: 7, now: `${WED}T14:00`, startAt: `${THU}T10:00`, endAt: `${THU}T12:00`, filter: 'today', expected: false },
  { n: 8, now: `${WED}T14:00`, startAt: `${THU}T10:00`, endAt: `${THU}T12:00`, filter: 'tomorrow', expected: true },
  { n: 9, now: `${WED}T14:00`, startAt: `${FRI}T19:00`, endAt: `${FRI}T22:00`, filter: 'weekend', expected: true },
  { n: 10, now: `${WED}T14:00`, startAt: `${FRI}T16:00`, endAt: `${FRI}T17:30`, filter: 'weekend', expected: false },
  { n: 11, now: `${SAT}T15:00`, startAt: `${SAT}T10:00`, endAt: `${SAT}T13:00`, filter: 'weekend', expected: false },
  { n: 12, now: `${SUN}T22:00`, startAt: `${SUN}T21:00`, endAt: `${SUN}T23:30`, filter: 'weekend', expected: true },
  { n: 13, now: `${WED}T14:00`, startAt: `${WED}T20:00`, endAt: `${WED}T23:00`, status: 'cancelled', filter: 'today', expected: false },
  { n: 14, now: `${WED}T23:59:59`, startAt: `${THU}T00:00`, endAt: `${THU}T02:00`, filter: 'today', expected: false },
]

// Se repite todo con el proceso en otras zonas: si algo cambia, hay un error de zona horaria.
// Node relee process.env.TZ al asignarla, así que basta con cambiarla en caliente.
describe.each([
  { tz: 'America/Bogota', offset: 300 },
  { tz: 'UTC', offset: 0 },
  { tz: 'Asia/Tokyo', offset: -540 },
])('dateRanges con TZ=$tz', ({ tz, offset }) => {
  const originalTz = process.env.TZ

  beforeAll(() => {
    process.env.TZ = tz
  })

  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it('el proceso está realmente en esa zona', () => {
    expect(new Date(co(`${WED}T14:00`)).getTimezoneOffset()).toBe(offset)
  })

  describe('casos de la sección 13.3', () => {
    it.each(CASES)(
      '#$n: ahora $now, evento $startAt – $endAt, filtro $filter → $expected',
      ({ now, startAt, endAt, status = 'published', filter, expected }) => {
        const range = resolveDateRange(filter, co(now))
        const event = { startAt: co(startAt), endAt: co(endAt), status }
        expect(isEventInRange(event, range)).toBe(expected)
      },
    )
  })

  describe('dayRange', () => {
    it('hoy es el día calendario completo de Colombia', () => {
      expect(dayRange(0, co(`${WED}T14:00`))).toEqual({
        start: co(`${WED}T00:00`),
        end: co(`${THU}T00:00`),
      })
    })

    it('a las 21:00 de Colombia (ya es mañana en UTC) sigue siendo hoy', () => {
      expect(dayRange(0, co(`${WED}T21:00`)).start).toEqual(co(`${WED}T00:00`))
    })

    it('mañana y otros desplazamientos', () => {
      expect(dayRange(1, co(`${WED}T14:00`))).toEqual({
        start: co(`${THU}T00:00`),
        end: co(`${FRI}T00:00`),
      })
      expect(dayRange(-1, co(`${WED}T14:00`)).start).toEqual(co(`${TUE}T00:00`))
    })

    it('cruza fin de mes y de año', () => {
      expect(dayRange(1, co('2026-12-31T22:00'))).toEqual({
        start: co('2027-01-01T00:00'),
        end: co('2027-01-02T00:00'),
      })
    })

    it('por defecto usa la hora actual', () => {
      vi.useFakeTimers({ now: co(`${WED}T14:00`) })
      try {
        expect(dayRange().start).toEqual(co(`${WED}T00:00`))
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('weekendRange', () => {
    it.each([
      ['lunes', '2026-10-19T00:00'],
      ['miércoles', `${WED}T14:00`],
      ['viernes antes de las 18:00', `${FRI}T10:00`],
      ['sábado', `${SAT}T15:00`],
      ['domingo a última hora', `${SUN}T23:59:59`],
    ])('desde el %s es viernes 18:00 → lunes 00:00 de esa semana', (_label, now) => {
      expect(weekendRange(co(now))).toEqual({
        start: co(`${FRI}T18:00`),
        end: co('2026-10-26T00:00'),
      })
    })

    it('el lunes ya apunta al fin de semana siguiente', () => {
      expect(weekendRange(co('2026-10-26T00:00')).start).toEqual(co('2026-10-30T18:00'))
    })

    it('por defecto usa la hora actual', () => {
      vi.useFakeTimers({ now: co(`${WED}T14:00`) })
      try {
        expect(weekendRange().start).toEqual(co(`${FRI}T18:00`))
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('resolveDateRange', () => {
    it('hoy empieza en "ahora" y termina a medianoche de Colombia', () => {
      expect(resolveDateRange('today', co(`${WED}T14:00`))).toEqual({
        start: co(`${WED}T14:00`),
        end: co(`${THU}T00:00`),
      })
    })

    it('mañana es el día completo siguiente', () => {
      expect(resolveDateRange('tomorrow', co(`${WED}T14:00`))).toEqual(
        dayRange(1, co(`${WED}T14:00`)),
      )
    })

    it('fin de semana: antes del viernes 18:00 no se recorta; dentro de él empieza en "ahora"', () => {
      expect(resolveDateRange('weekend', co(`${WED}T14:00`)).start).toEqual(co(`${FRI}T18:00`))
      expect(resolveDateRange('weekend', co(`${SAT}T15:00`)).start).toEqual(co(`${SAT}T15:00`))
    })

    it('devuelve una copia de "now", no la misma referencia', () => {
      const now = co(`${WED}T14:00`)
      expect(resolveDateRange('today', now).start).not.toBe(now)
    })

    it('por defecto usa la hora actual', () => {
      vi.useFakeTimers({ now: co(`${WED}T14:00`) })
      try {
        expect(resolveDateRange('today').start).toEqual(co(`${WED}T14:00`))
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('overlapQuery', () => {
    it('genera la misma condición de solapamiento para MongoDB', () => {
      const range = { start: co(`${WED}T14:00`), end: co(`${THU}T00:00`) }
      expect(overlapQuery(range)).toEqual({
        startAt: mongoose.trusted({ $lt: range.end }),
        endAt: mongoose.trusted({ $gt: range.start }),
      })
    })

    // sanitizeFilter está activo: sin mongoose.trusted, Mongoose rechaza los operadores.
    it('funciona en una consulta real de Event', async () => {
      const range = { start: co(`${WED}T14:00`), end: co(`${THU}T00:00`) }
      const business = new Types.ObjectId()
      const event = (startAt: Date, endAt: Date) => ({
        business,
        title: 'Evento de prueba',
        slug: `evento-${new Types.ObjectId()}`,
        status: 'published',
        businessSnapshot: { name: 'Negocio' },
        startAt,
        endAt,
      })
      await Event.collection.insertMany([
        event(co(`${WED}T12:00`), co(`${WED}T15:00`)),
        event(co(`${WED}T08:00`), co(`${WED}T14:00`)),
        event(co(`${THU}T00:00`), co(`${THU}T02:00`)),
      ])

      expect(await Event.countDocuments({ business, ...overlapQuery(range) })).toBe(1)
      await Event.deleteMany({ business })
    })
  })
})
