import { Types } from 'mongoose'
import { beforeAll, describe, expect, it } from 'vitest'
import { Event, buildEventSlug } from '../modules/events/event.model'

const LAURELES = [-75.5906, 6.2447]
const SLUG_SUFFIX = /-[0-9a-z]{6}$/

function buildDraft(overrides: Record<string, unknown> = {}) {
  return new Event({
    business: new Types.ObjectId(),
    title: 'Noche de jazz en Laureles',
    businessSnapshot: { name: 'Café Laureles', slug: 'cafe-laureles' },
    ...overrides,
  })
}

const publishable = () => ({
  venue: new Types.ObjectId(),
  description: 'Trío de jazz en vivo con repertorio de standards y bossa nova.',
  category: 'musica-en-vivo',
  tags: ['jazz', 'pet-friendly'],
  startAt: new Date('2026-11-06T01:00:00Z'),
  endAt: new Date('2026-11-06T04:00:00Z'),
  price: { type: 'paid', min: 30_000, max: 50_000 },
  coverImage: {
    url: 'https://res.cloudinary.com/parche/image/upload/v1/parche/evento.jpg',
    publicId: 'parche/evento',
    width: 1920,
    height: 1080,
  },
  location: { type: 'Point', coordinates: LAURELES },
  venueSnapshot: {
    name: 'Sede Laureles',
    address: 'Cra. 70 #44-35',
    neighborhood: 'Laureles',
    comuna: '11',
  },
})

function buildPublished(overrides: Record<string, unknown> = {}) {
  return buildDraft({ ...publishable(), status: 'published', ...overrides })
}

// validate() y no validateSync(): el slug y publishedAt se generan en un hook pre('validate').
async function errorsOf(event: InstanceType<typeof Event>) {
  const error = await event.validate().catch((err: unknown) => err)
  return (error as { errors?: Record<string, { message: string }> } | undefined)?.errors ?? {}
}

describe('Event', () => {
  it('un borrador es válido solo con los campos obligatorios y aplica los valores por defecto', async () => {
    const event = buildDraft()

    expect(await errorsOf(event)).toEqual({})
    expect(event.status).toBe('draft')
    expect(event.isAdultOnly).toBe(false)
    expect(event.publishedAt).toBeUndefined()
    expect(event.stats).toMatchObject({
      views: 0,
      directionsClicks: 0,
      externalClicks: 0,
      saves: 0,
    })
    expect(event.slug).toMatch(/^noche-de-jazz-en-laureles-[0-9a-z]{6}$/)
  })

  it('exige siempre business, title y businessSnapshot', async () => {
    expect(Object.keys(await errorsOf(new Event({})))).toEqual(
      expect.arrayContaining(['business', 'title', 'businessSnapshot']),
    )
  })

  it('exige el nombre del negocio en businessSnapshot', async () => {
    const event = buildDraft({ businessSnapshot: { slug: 'cafe-laureles' } })

    expect(await errorsOf(event)).toHaveProperty(['businessSnapshot.name'])
  })

  describe('obligatorios para publicar (RN-07 y RN-08)', () => {
    const PUBLISH_FIELDS = [
      'venue',
      'description',
      'category',
      'startAt',
      'endAt',
      'price.type',
      'price.min',
      'coverImage',
      'location',
      'venueSnapshot',
    ]

    it('un borrador los puede dejar vacíos', async () => {
      expect(await errorsOf(buildDraft())).toEqual({})
    })

    it.each(['published', 'cancelled', 'removed'])(
      'con estado %s son obligatorios',
      async (status) => {
        const event = buildDraft({
          status,
          cancellationReason: 'Lluvia fuerte en la ciudad',
          removalReason: 'Contenido no permitido',
        })

        expect(Object.keys(await errorsOf(event)).sort()).toEqual([...PUBLISH_FIELDS].sort())
      },
    )

    it('un evento completo se puede publicar', async () => {
      expect(await errorsOf(buildPublished())).toEqual({})
    })
  })

  it.each([
    ['title', 'Jazz'],
    ['title', 'J'.repeat(101)],
    ['description', 'Muy corto'],
    ['description', 'D'.repeat(2001)],
  ])('rechaza %s con longitud inválida', async (field, value) => {
    expect(await errorsOf(buildDraft({ [field]: value }))).toHaveProperty(field)
  })

  describe('description', () => {
    it('acepta texto plano con saltos de línea y comparaciones', async () => {
      const description = 'Primera línea del evento.\nSegunda línea: entrada < 18 años no.'
      const event = buildDraft({ description })

      expect(await errorsOf(event)).toEqual({})
      expect(event.description).toBe(description)
    })

    it.each([
      '<b>Gran concierto</b> de jazz en vivo',
      'Concierto de jazz <script>alert(1)</script>',
    ])('rechaza HTML: %s', async (description) => {
      const errors = await errorsOf(buildDraft({ description }))

      expect(errors.description?.message).toBe('La descripción debe ser texto plano, sin HTML')
    })
  })

  it('rechaza una categoría fuera del catálogo', async () => {
    expect(await errorsOf(buildDraft({ category: 'concierto' }))).toHaveProperty('category')
  })

  describe('tags', () => {
    it('las pasa a minúsculas y recorta espacios', async () => {
      const event = buildDraft({ tags: [' Jazz ', 'PET-FRIENDLY'] })

      expect(await errorsOf(event)).toEqual({})
      expect([...event.tags]).toEqual(['jazz', 'pet-friendly'])
    })

    it('rechaza más de 5', async () => {
      const errors = await errorsOf(buildDraft({ tags: ['aa', 'bb', 'cc', 'dd', 'ee', 'ff'] }))

      expect(errors.tags?.message).toBe('Máximo 5 etiquetas')
    })

    it('rechaza repetidas', async () => {
      const errors = await errorsOf(buildDraft({ tags: ['jazz', 'JAZZ'] }))

      expect(errors.tags?.message).toBe('Las etiquetas no se pueden repetir')
    })

    it.each(['a', 'x'.repeat(25)])('rechaza una etiqueta de longitud inválida: %s', async (tag) => {
      expect(await errorsOf(buildDraft({ tags: [tag] }))).toHaveProperty(['tags.0'])
    })
  })

  describe('fechas (RN-11)', () => {
    // startAt de publishable() es 2026-11-06T01:00:00Z.
    it.each([
      ['igual al inicio', '2026-11-06T01:00:00Z'],
      ['anterior al inicio', '2026-11-05T23:00:00Z'],
      ['a 14 minutos del inicio', '2026-11-06T01:14:00Z'],
      ['a más de 7 días del inicio', '2026-11-13T01:01:00Z'],
    ])('rechaza un fin %s', async (_case, endAt) => {
      const errors = await errorsOf(buildPublished({ endAt: new Date(endAt) }))

      expect(errors.endAt?.message).toBe('El evento debe durar entre 15 minutos y 7 días')
    })

    it.each([
      ['de 15 minutos', '2026-11-06T01:15:00Z'],
      ['de 7 días', '2026-11-13T01:00:00Z'],
    ])('acepta una duración %s', async (_case, endAt) => {
      expect(await errorsOf(buildPublished({ endAt: new Date(endAt) }))).toEqual({})
    })

    it('en un borrador acepta el fin sin inicio', async () => {
      expect(await errorsOf(buildDraft({ endAt: new Date('2026-11-06T04:00:00Z') }))).toEqual({})
    })
  })

  describe('price', () => {
    it.each([
      ['gratis con 0', { type: 'free', min: 0 }],
      ['de pago sin máximo', { type: 'paid', min: 20_000 }],
      ['de pago con rango', { type: 'paid', min: 20_000, max: 20_000 }],
      ['de pago en el tope', { type: 'paid', min: 10_000_000 }],
    ])('acepta %s', async (_case, price) => {
      expect(await errorsOf(buildPublished({ price }))).toEqual({})
    })

    it.each([
      ['gratis con precio', { type: 'free', min: 5_000 }, 'price.min'],
      ['de pago con 0', { type: 'paid', min: 0 }, 'price.min'],
      ['con decimales', { type: 'paid', min: 20_000.5 }, 'price.min'],
      ['por encima del tope', { type: 'paid', min: 10_000_001 }, 'price.min'],
      ['con máximo menor al mínimo', { type: 'paid', min: 50_000, max: 30_000 }, 'price.max'],
      [
        'con máximo por encima del tope',
        { type: 'paid', min: 50_000, max: 10_000_001 },
        'price.max',
      ],
      ['gratis con máximo', { type: 'free', min: 0, max: 0 }, 'price.max'],
      ['con tipo desconocido', { type: 'donation', min: 0 }, 'price.type'],
    ])('rechaza un precio %s', async (_case, price, path) => {
      expect(await errorsOf(buildPublished({ price }))).toHaveProperty([path])
    })

    it('en un borrador sin tipo acepta cualquier entero no negativo', async () => {
      expect(await errorsOf(buildDraft({ price: { min: 0 } }))).toEqual({})
      expect(await errorsOf(buildDraft({ price: { min: -1 } }))).toHaveProperty(['price.min'])
    })
  })

  describe('coverImage (RN-29)', () => {
    const cover = (width: number, height: number) => ({
      ...publishable().coverImage,
      width,
      height,
    })

    it.each([
      [1920, 1080],
      [1280, 720],
      [1900, 1080],
    ])('acepta %ix%i (16:9 con tolerancia del 2 %)', async (width, height) => {
      expect(await errorsOf(buildPublished({ coverImage: cover(width, height) }))).toEqual({})
    })

    it.each([
      [1600, 1200],
      [1080, 1080],
      [1080, 1920],
    ])('rechaza %ix%i', async (width, height) => {
      const errors = await errorsOf(buildPublished({ coverImage: cover(width, height) }))

      expect(errors['coverImage.height']?.message).toBe('La portada debe tener proporción 16:9')
    })

    it('exige url, publicId y dimensiones positivas', async () => {
      const errors = await errorsOf(buildPublished({ coverImage: { width: 0, height: 1080 } }))

      expect(Object.keys(errors)).toEqual(
        expect.arrayContaining(['coverImage.url', 'coverImage.publicId', 'coverImage.width']),
      )
    })
  })

  describe('externalUrl', () => {
    it('acepta https://', async () => {
      expect(await errorsOf(buildDraft({ externalUrl: 'https://tuboleta.com/jazz' }))).toEqual({})
    })

    it.each(['http://tuboleta.com/jazz', 'tuboleta.com', 'javascript:alert(1)'])(
      'rechaza %s',
      async (externalUrl) => {
        expect(await errorsOf(buildDraft({ externalUrl }))).toHaveProperty('externalUrl')
      },
    )
  })

  describe('motivos de cancelación y retiro', () => {
    it.each([
      ['cancelled', 'cancellationReason'],
      ['removed', 'removalReason'],
    ])('con estado %s exige %s', async (status, field) => {
      const errors = await errorsOf(buildPublished({ status }))

      expect(Object.keys(errors)).toEqual([field])
    })

    it.each([
      ['cancelled', 'cancellationReason'],
      ['removed', 'removalReason'],
    ])('con estado %s y %s es válido', async (status, field) => {
      const event = buildPublished({ status, [field]: 'Lluvia fuerte en la ciudad' })

      expect(await errorsOf(event)).toEqual({})
    })

    it('rechaza un motivo demasiado corto', async () => {
      const event = buildPublished({ status: 'cancelled', cancellationReason: 'Lluvia' })

      expect(await errorsOf(event)).toHaveProperty('cancellationReason')
    })
  })

  it('rechaza un estado fuera del catálogo', async () => {
    expect(await errorsOf(buildDraft({ status: 'archived' }))).toHaveProperty('status')
  })

  it('aplica a location las mismas reglas que a la sede (RN-23)', async () => {
    const errors = await errorsOf(
      buildPublished({ location: { type: 'Point', coordinates: [-74.0721, 4.711] } }),
    )

    expect(errors['location.coordinates']?.message).toBe(
      'La ubicación está fuera del área de servicio',
    )
  })

  it('valida la comuna de venueSnapshot', async () => {
    const venueSnapshot = { ...publishable().venueSnapshot, comuna: '17' }

    expect(await errorsOf(buildPublished({ venueSnapshot }))).toHaveProperty([
      'venueSnapshot.comuna',
    ])
  })

  it('rechaza contadores negativos', async () => {
    expect(await errorsOf(buildDraft({ stats: { views: -1 } }))).toHaveProperty(['stats.views'])
  })

  describe('publishedAt', () => {
    it('se fija al publicar por primera vez', async () => {
      const before = new Date()
      const event = buildPublished()
      await event.validate()

      expect(event.publishedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
    })

    it('no se sobrescribe si ya existía', async () => {
      const publishedAt = new Date('2026-10-01T15:00:00Z')
      const event = buildPublished({ publishedAt })
      await event.validate()

      expect(event.publishedAt).toEqual(publishedAt)
    })
  })

  describe('slug', () => {
    it('se arma con el título sin tildes ni símbolos y un sufijo de 6 caracteres', () => {
      expect(buildEventSlug('¡Concierto de Música Andina en Belén!')).toMatch(
        /^concierto-de-musica-andina-en-belen-[0-9a-z]{6}$/,
      )
    })

    it('usa "evento" si el título no deja caracteres válidos', () => {
      expect(buildEventSlug('🎷🎶 ★★★')).toMatch(/^evento-[0-9a-z]{6}$/)
    })

    it('genera sufijos distintos para el mismo título', () => {
      expect(buildEventSlug('Noche de jazz')).not.toBe(buildEventSlug('Noche de jazz'))
    })

    describe('en base de datos', () => {
      beforeAll(async () => {
        await Event.init()
      })

      it('sigue al título mientras el evento es borrador', async () => {
        const event = await buildDraft().save()
        event.title = 'Noche de bossa nova'
        await event.save()

        expect(event.slug).toMatch(/^noche-de-bossa-nova-/)
        expect(event.slug).toMatch(SLUG_SUFFIX)
      })

      it('no cambia al editar otros campos de un borrador', async () => {
        const event = await buildDraft().save()
        const { slug } = event
        event.description = 'Una descripción nueva que tiene más de veinte caracteres.'
        await event.save()

        expect(event.slug).toBe(slug)
      })

      it('es inmutable tras publicar', async () => {
        const event = await buildPublished().save()
        const { slug } = event
        event.title = 'Título nuevo del evento'
        event.slug = 'otro-slug-123456'
        await event.save()

        const stored = await Event.findById(event._id).lean()
        expect(stored?.slug).toBe(slug)
        expect(stored?.title).toBe('Título nuevo del evento')
      })

      it('es único', async () => {
        const first = await buildDraft().save()
        const duplicate = buildDraft()
        await duplicate.validate()
        duplicate.slug = first.slug

        await expect(Event.collection.insertOne(duplicate.toObject())).rejects.toMatchObject({
          code: 11000,
        })
      })
    })
  })

  it('serializa con id y sin _id ni __v', () => {
    const json = buildDraft().toJSON()

    expect(json).toHaveProperty('id')
    expect(json).not.toHaveProperty('_id')
    expect(json).not.toHaveProperty('__v')
  })
})
