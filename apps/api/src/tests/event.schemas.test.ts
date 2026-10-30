import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  eventDraftSchema,
  eventEditPhase,
  eventOngoingSchema,
  eventPublishSchema,
  eventUpdateSchema,
} from '@parche/shared'

// "Ahora": miércoles 21 de octubre de 2026, 14:00 en Colombia.
const NOW = new Date('2026-10-21T19:00:00Z')
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

const complete = () => ({
  title: 'Noche de jazz en Laureles',
  description: 'Trío de jazz en vivo con repertorio de standards y bossa nova.',
  category: 'musica-en-vivo',
  venueId: '6717a3f0c2b4e8a1d9f01234',
  startAt: '2026-10-23T20:00:00-05:00',
  endAt: '2026-10-23T23:00:00-05:00',
  price: { type: 'paid', min: 30_000, max: 80_000 },
  coverImage: {
    url: 'https://res.cloudinary.com/parche/image/upload/v1/parche/evento.jpg',
    publicId: 'parche/evento',
    width: 1920,
    height: 1080,
  },
})

function issuesOf(result: {
  success: boolean
  error?: { issues: { path: PropertyKey[]; message: string }[] }
}) {
  return Object.fromEntries(
    (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]),
  )
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('eventDraftSchema (RN-07)', () => {
  it('solo exige el título', () => {
    expect(eventDraftSchema.parse({ title: 'Noche de jazz' })).toEqual({ title: 'Noche de jazz' })
  })

  it('sin título falla', () => {
    expect(issuesOf(eventDraftSchema.safeParse({}))).toEqual({ title: 'El título es obligatorio' })
  })

  it('valida lo que llegue aunque sea opcional', () => {
    const issues = issuesOf(
      eventDraftSchema.safeParse({ title: 'Noche de jazz', description: 'Corta', category: 'x' }),
    )

    expect(Object.keys(issues)).toEqual(['description', 'category'])
  })

  it('convierte las fechas ISO a Date en UTC', () => {
    const draft = eventDraftSchema.parse({
      title: 'Noche de jazz',
      startAt: '2026-10-23T20:00:00-05:00',
    })

    expect(draft.startAt).toEqual(new Date('2026-10-24T01:00:00Z'))
  })

  it.each(['2026-10-23T20:00:00', '2026-10-23', 'mañana'])(
    'rechaza la fecha %s (sin zona u inválida)',
    (startAt) => {
      expect(issuesOf(eventDraftSchema.safeParse({ title: 'Noche de jazz', startAt }))).toEqual({
        startAt: 'Fecha inválida: usa ISO 8601 con zona horaria',
      })
    },
  )

  it('aplica la duración (RN-11) pero no exige inicio futuro', () => {
    expect(
      eventDraftSchema.safeParse({
        title: 'Noche de jazz',
        startAt: at(-DAY),
        endAt: at(-DAY + 60 * MINUTE),
      }).success,
    ).toBe(true)
    expect(
      issuesOf(
        eventDraftSchema.safeParse({
          title: 'Noche de jazz',
          startAt: at(DAY),
          endAt: at(DAY + 5 * MINUTE),
        }),
      ),
    ).toEqual({ endAt: 'El evento debe durar al menos 15 minutos' })
  })

  it('descarta campos que el gestor no controla', () => {
    const draft = eventDraftSchema.parse({
      title: 'Noche de jazz',
      status: 'published',
      slug: 'x',
      business: 'y',
    })

    expect(draft).toEqual({ title: 'Noche de jazz' })
  })
})

describe('eventPublishSchema', () => {
  it('acepta un evento completo', () => {
    expect(eventPublishSchema.safeParse(complete()).success).toBe(true)
  })

  it('RN-08: exige título, descripción, categoría, lugar, fechas, precio y portada', () => {
    expect(issuesOf(eventPublishSchema.safeParse({}))).toEqual({
      title: 'El título es obligatorio',
      description: 'La descripción es obligatoria',
      category: 'Elige una categoría válida',
      venueId: 'El lugar es obligatorio',
      startAt: 'La fecha de inicio es obligatoria',
      endAt: 'La fecha de fin es obligatoria',
      price: 'El precio es obligatorio',
      coverImage: 'La imagen de portada es obligatoria',
    })
  })

  describe('RN-10: inicio futuro y a máximo 180 días', () => {
    it.each([
      ['ya pasó', -60 * MINUTE],
      ['es justo ahora', 0],
    ])('rechaza un inicio que %s', (_case, offset) => {
      const event = { ...complete(), startAt: at(offset), endAt: at(offset + 60 * MINUTE) }

      expect(issuesOf(eventPublishSchema.safeParse(event))).toEqual({
        startAt: 'El evento debe empezar en el futuro',
      })
    })

    it.each([
      ['dentro de un minuto', MINUTE],
      ['justo a los 180 días', 180 * DAY],
    ])('acepta un inicio %s', (_case, offset) => {
      const event = { ...complete(), startAt: at(offset), endAt: at(offset + 60 * MINUTE) }

      expect(eventPublishSchema.safeParse(event).success).toBe(true)
    })

    it('rechaza un inicio a más de 180 días', () => {
      const offset = 180 * DAY + MINUTE
      const event = { ...complete(), startAt: at(offset), endAt: at(offset + 60 * MINUTE) }

      expect(issuesOf(eventPublishSchema.safeParse(event))).toEqual({
        startAt: 'El evento puede empezar como máximo dentro de 180 días',
      })
    })
  })

  describe('RN-11: duración de 15 minutos a 7 días', () => {
    it.each([
      ['de 15 minutos', 15 * MINUTE],
      ['de 7 días', 7 * DAY],
    ])('acepta una duración %s', (_case, duration) => {
      const event = { ...complete(), startAt: at(DAY), endAt: at(DAY + duration) }

      expect(eventPublishSchema.safeParse(event).success).toBe(true)
    })

    it.each([
      ['fin anterior al inicio', -MINUTE, 'La fecha de fin debe ser posterior a la de inicio'],
      ['fin igual al inicio', 0, 'La fecha de fin debe ser posterior a la de inicio'],
      ['14 minutos', 14 * MINUTE, 'El evento debe durar al menos 15 minutos'],
      ['7 días y un minuto', 7 * DAY + MINUTE, 'El evento puede durar como máximo 7 días'],
    ])('rechaza %s', (_case, duration, message) => {
      const event = { ...complete(), startAt: at(DAY), endAt: at(DAY + duration) }

      expect(issuesOf(eventPublishSchema.safeParse(event))).toEqual({ endAt: message })
    })
  })

  describe('RN-14: precio', () => {
    it.each([
      ['gratis', { type: 'free', min: 0 }],
      ['de pago sin máximo', { type: 'paid', min: 30_000 }],
      ['de pago con rango', { type: 'paid', min: 30_000, max: 80_000 }],
      ['de pago con mínimo igual al máximo', { type: 'paid', min: 30_000, max: 30_000 }],
    ])('acepta %s', (_case, price) => {
      expect(eventPublishSchema.safeParse({ ...complete(), price }).success).toBe(true)
    })

    it.each([
      [
        'gratis con precio',
        { type: 'free', min: 5_000 },
        'price.min',
        'Un evento gratis tiene precio 0',
      ],
      [
        'gratis con máximo',
        { type: 'free', min: 0, max: 0 },
        'price.max',
        'El precio máximo solo aplica a eventos de pago',
      ],
      [
        'de pago con 0',
        { type: 'paid', min: 0 },
        'price.min',
        'Un evento de pago debe tener precio mayor que 0',
      ],
      [
        'con decimales',
        { type: 'paid', min: 30_000.5 },
        'price.min',
        'El precio debe ser un entero en pesos',
      ],
      [
        'por encima del tope',
        { type: 'paid', min: 10_000_001 },
        'price.min',
        'El precio no puede superar 10.000.000 COP',
      ],
      [
        'con máximo menor',
        { type: 'paid', min: 80_000, max: 30_000 },
        'price.max',
        'El precio máximo debe ser mayor o igual al mínimo',
      ],
      [
        'con tipo desconocido',
        { type: 'donation', min: 0 },
        'price.type',
        'El tipo de precio debe ser free o paid',
      ],
    ])('rechaza un precio %s', (_case, price, path, message) => {
      expect(issuesOf(eventPublishSchema.safeParse({ ...complete(), price }))).toEqual({
        [path]: message,
      })
    })
  })

  describe('portada (RN-29)', () => {
    it('rechaza una portada que no es 16:9', () => {
      const coverImage = { ...complete().coverImage, width: 1200, height: 1200 }

      expect(issuesOf(eventPublishSchema.safeParse({ ...complete(), coverImage }))).toEqual({
        'coverImage.height': 'La portada debe tener proporción 16:9',
      })
    })

    it('rechaza una URL que no es https', () => {
      const coverImage = { ...complete().coverImage, url: 'http://res.cloudinary.com/x.jpg' }

      expect(issuesOf(eventPublishSchema.safeParse({ ...complete(), coverImage }))).toHaveProperty([
        'coverImage.url',
      ])
    })
  })

  describe('campos opcionales', () => {
    it('normaliza las etiquetas a minúsculas', () => {
      const event = eventPublishSchema.parse({ ...complete(), tags: [' Jazz ', 'PET-FRIENDLY'] })

      expect(event.tags).toEqual(['jazz', 'pet-friendly'])
    })

    it.each([
      [['aa', 'bb', 'cc', 'dd', 'ee', 'ff'], 'tags', 'Máximo 5 etiquetas'],
      [['jazz', 'JAZZ'], 'tags', 'Las etiquetas no se pueden repetir'],
      [['a'], 'tags.0', 'Cada etiqueta debe tener al menos 2 caracteres'],
    ])('rechaza las etiquetas %j', (tags, path, message) => {
      expect(issuesOf(eventPublishSchema.safeParse({ ...complete(), tags }))).toEqual({
        [path]: message,
      })
    })

    it('rechaza HTML en la descripción', () => {
      const description = '<p>Trío de jazz en vivo con repertorio de standards.</p>'

      expect(issuesOf(eventPublishSchema.safeParse({ ...complete(), description }))).toEqual({
        description: 'La descripción debe ser texto plano, sin HTML',
      })
    })

    it.each(['http://tuboleta.com/jazz', 'javascript:alert(1)', 'https://localhost/x'])(
      'rechaza el enlace externo %s',
      (externalUrl) => {
        expect(issuesOf(eventPublishSchema.safeParse({ ...complete(), externalUrl }))).toEqual({
          externalUrl: 'El enlace debe ser una URL https:// válida',
        })
      },
    )

    it('acepta enlace https e isAdultOnly', () => {
      const event = { ...complete(), externalUrl: 'https://tuboleta.com/jazz', isAdultOnly: true }

      expect(eventPublishSchema.safeParse(event).success).toBe(true)
    })
  })
})

describe('eventUpdateSchema', () => {
  it('acepta cambios parciales, incluso sin título', () => {
    const result = eventUpdateSchema.safeParse({ category: 'cultura' })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ category: 'cultura' })
  })

  it('valida lo que llegue', () => {
    const result = eventUpdateSchema.safeParse({ title: 'Hola', price: { type: 'free', min: 1 } })

    expect(Object.keys(issuesOf(result))).toEqual(['title', 'price.min'])
  })

  it('exige al menos un campo conocido', () => {
    expect(issuesOf(eventUpdateSchema.safeParse({}))).toEqual({
      '': 'Envía al menos un campo para actualizar',
    })
    expect(eventUpdateSchema.safeParse({ status: 'published' }).success).toBe(false)
  })

  it('aplica la duración si llegan ambas fechas', () => {
    const result = eventUpdateSchema.safeParse({ startAt: at(DAY), endAt: at(DAY + 5 * MINUTE) })

    expect(issuesOf(result)).toEqual({ endAt: 'El evento debe durar al menos 15 minutos' })
  })
})

describe('eventOngoingSchema (RN-16)', () => {
  it('acepta extender el cierre', () => {
    const result = eventOngoingSchema.safeParse({ startAt: at(-60 * MINUTE), endAt: at(DAY) })

    expect(result.success).toBe(true)
  })

  it('rechaza un cierre que ya pasó', () => {
    const result = eventOngoingSchema.safeParse({
      startAt: at(-120 * MINUTE),
      endAt: at(-MINUTE),
    })

    expect(issuesOf(result)).toEqual({
      endAt: 'La fecha de fin debe ser posterior al momento actual',
    })
  })

  it('mantiene el máximo de 7 días desde el inicio', () => {
    const result = eventOngoingSchema.safeParse({ startAt: at(-60 * MINUTE), endAt: at(7 * DAY) })

    expect(issuesOf(result)).toEqual({ endAt: 'El evento puede durar como máximo 7 días' })
  })
})

describe('eventEditPhase', () => {
  const dates = (startOffset: number, endOffset: number) => ({
    startAt: new Date(NOW.getTime() + startOffset),
    endAt: new Date(NOW.getTime() + endOffset),
  })

  it('un borrador siempre se edita completo, aunque sus fechas hayan pasado', () => {
    expect(eventEditPhase({ status: 'draft' }, NOW)).toBe('full')
    expect(eventEditPhase({ status: 'draft', ...dates(-DAY, -DAY + 60 * MINUTE) }, NOW)).toBe(
      'full',
    )
  })

  it('RN-15: publicado sin empezar se edita completo', () => {
    expect(eventEditPhase({ status: 'published', ...dates(MINUTE, DAY) }, NOW)).toBe('full')
  })

  it('RN-16: en curso desde el instante de inicio hasta antes del cierre', () => {
    expect(eventEditPhase({ status: 'published', ...dates(0, DAY) }, NOW)).toBe('ongoing')
    expect(eventEditPhase({ status: 'published', ...dates(-DAY, MINUTE) }, NOW)).toBe('ongoing')
  })

  it('RN-17: finalizado, cancelado o retirado es de solo lectura', () => {
    expect(eventEditPhase({ status: 'published', ...dates(-DAY, 0) }, NOW)).toBe('locked')
    expect(eventEditPhase({ status: 'cancelled', ...dates(DAY, 2 * DAY) }, NOW)).toBe('locked')
    expect(eventEditPhase({ status: 'removed', ...dates(DAY, 2 * DAY) }, NOW)).toBe('locked')
  })
})
