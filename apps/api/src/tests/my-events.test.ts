import bcrypt from 'bcrypt'
import { Types } from 'mongoose'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { RefreshToken } from '../modules/auth/refresh-token.model'
import { Business } from '../modules/businesses/business.model'
import { Event } from '../modules/events/event.model'
import { User } from '../modules/users/user.model'
import { Venue } from '../modules/venues/venue.model'

const API = '/api/v1'
const EVENTS = `${API}/me/events`
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const LAURELES = [-75.5906, 6.2447]

// La carpeta y la nube coinciden con las variables de entorno de tests/setup.ts.
const COVER = {
  url: 'https://res.cloudinary.com/parche-test/image/upload/v1/parche-test/evento.jpg',
  publicId: 'parche-test/evento',
  width: 1920,
  height: 1080,
}

const app = createApp()

beforeAll(async () => {
  await Event.init()
})

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Business.deleteMany({}),
    RefreshToken.deleteMany({}),
    Venue.deleteMany({}),
    Event.deleteMany({}),
  ])
})

const inFuture = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

async function registerManager(email = 'ana@correo.co') {
  const response = await request(app)
    .post(`${API}/auth/register/manager`)
    .send({
      name: 'Ana Pérez',
      email,
      password: 'clave1234',
      business: { name: `Negocio de ${email}`, type: 'cafe' },
    })
    .expect(201)
  return {
    auth: `Bearer ${response.body.data.accessToken}`,
    businessId: response.body.data.business.id as string,
  }
}

async function approvedManager(email?: string) {
  const manager = await registerManager(email)
  await Business.updateOne({ _id: manager.businessId }, { verificationStatus: 'approved' })
  return manager
}

async function createVenue(businessId: string, overrides: Record<string, unknown> = {}) {
  const venue = await Venue.create({
    business: businessId,
    name: 'Sede Laureles',
    address: 'Cra. 70 #44-35',
    neighborhood: 'Laureles',
    comuna: '11',
    location: { type: 'Point', coordinates: LAURELES },
    ...overrides,
  })
  return String(venue._id)
}

function completeEvent(venueId: string) {
  return {
    title: 'Noche de jazz en Laureles',
    description: 'Trío de jazz en vivo con repertorio de standards y bossa nova.',
    category: 'musica-en-vivo',
    tags: ['jazz'],
    venueId,
    startAt: inFuture(2 * DAY),
    endAt: inFuture(2 * DAY + 3 * HOUR),
    price: { type: 'paid', min: 30_000, max: 80_000 },
    coverImage: COVER,
  }
}

function createDraft(auth: string, body: Record<string, unknown>) {
  return request(app).post(EVENTS).set('Authorization', auth).send(body)
}

function publish(auth: string, id: string) {
  return request(app).post(`${EVENTS}/${id}/publish`).set('Authorization', auth)
}

async function draftId(auth: string, body: Record<string, unknown>) {
  const response = await createDraft(auth, body).expect(201)
  return response.body.data.event.id as string
}

describe('acceso a /me/events', () => {
  it('sin token responde 401', async () => {
    const response = await request(app).post(EVENTS).send({ title: 'Noche de jazz' })

    expect(response.status).toBe(401)
  })

  it('un usuario que no es gestor recibe 403', async () => {
    await User.create({
      name: 'Usuario',
      email: 'user@correo.co',
      passwordHash: await bcrypt.hash('clave1234', 4),
      role: 'user',
    })
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'user@correo.co', password: 'clave1234' })

    const response = await createDraft(`Bearer ${login.body.data.accessToken}`, {
      title: 'Noche de jazz',
    })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })
})

describe('POST /me/events (borrador)', () => {
  it('RN-07: crea un borrador solo con el título, aunque el negocio esté pendiente', async () => {
    const { auth, businessId } = await registerManager()

    const response = await createDraft(auth, { title: 'Noche de jazz en Laureles' })

    expect(response.status).toBe(201)
    const { event } = response.body.data
    expect(event).toMatchObject({
      title: 'Noche de jazz en Laureles',
      status: 'draft',
      business: businessId,
      businessSnapshot: { name: 'Negocio de ana@correo.co' },
      isAdultOnly: false,
    })
    expect(event.slug).toMatch(/^noche-de-jazz-en-laureles-[0-9a-z]{6}$/)
    expect(event.publishedAt).toBeUndefined()
  })

  it('sin título responde 400', async () => {
    const { auth } = await registerManager()

    const response = await createDraft(auth, { description: 'Algo' })

    expect(response.status).toBe(400)
    expect(response.body.error.details).toContainEqual({
      path: 'body.title',
      message: 'El título es obligatorio',
    })
  })

  it('ignora status, slug y business enviados por el cliente', async () => {
    const { auth, businessId } = await registerManager()

    const response = await createDraft(auth, {
      title: 'Noche de jazz en Laureles',
      status: 'published',
      slug: 'slug-elegido',
      business: new Types.ObjectId().toString(),
    })

    expect(response.body.data.event).toMatchObject({ status: 'draft', business: businessId })
    expect(response.body.data.event.slug).not.toBe('slug-elegido')
  })

  it('guarda un borrador completo y copia los datos del lugar', async () => {
    const { auth, businessId } = await registerManager()
    const venueId = await createVenue(businessId)

    const response = await createDraft(auth, completeEvent(venueId))

    expect(response.status).toBe(201)
    expect(response.body.data.event).toMatchObject({
      venue: venueId,
      location: { type: 'Point', coordinates: LAURELES },
      venueSnapshot: {
        name: 'Sede Laureles',
        address: 'Cra. 70 #44-35',
        neighborhood: 'Laureles',
        comuna: '11',
      },
      price: { type: 'paid', min: 30_000, max: 80_000 },
      coverImage: COVER,
      status: 'draft',
    })
  })

  describe('RN-12: el lugar debe ser del negocio y estar activo', () => {
    it.each([
      ['de otro negocio', async () => createVenue(new Types.ObjectId().toString())],
      ['inactivo', async (businessId: string) => createVenue(businessId, { isActive: false })],
      ['inexistente', async () => new Types.ObjectId().toString()],
    ])('rechaza un lugar %s', async (_case, makeVenue) => {
      const { auth, businessId } = await registerManager()
      const venueId = await makeVenue(businessId)

      const response = await createDraft(auth, { title: 'Noche de jazz', venueId })

      expect(response.status).toBe(400)
      expect(response.body.error.details).toEqual([
        { path: 'venueId', message: 'El lugar no existe, no es de tu negocio o está inactivo' },
      ])
    })
  })

  it('rechaza una portada que no se subió a través de Parche', async () => {
    const { auth } = await registerManager()

    const response = await createDraft(auth, {
      title: 'Noche de jazz',
      coverImage: { ...COVER, url: 'https://res.cloudinary.com/otra-cuenta/image/upload/v1/x.jpg' },
    })

    expect(response.status).toBe(400)
    expect(response.body.error.details).toContainEqual({
      path: 'body.coverImage.url',
      message: 'La imagen debe subirse a través de Parche',
    })
  })

  it('en el borrador acepta fechas pasadas, pero no una duración inválida', async () => {
    const { auth } = await registerManager()

    const past = await createDraft(auth, {
      title: 'Noche de jazz',
      startAt: inFuture(-DAY),
      endAt: inFuture(-DAY + HOUR),
    })
    const tooShort = await createDraft(auth, {
      title: 'Noche de jazz',
      startAt: inFuture(DAY),
      endAt: inFuture(DAY + 10 * 60_000),
    })

    expect(past.status).toBe(201)
    expect(tooShort.status).toBe(400)
  })
})

describe('POST /me/events/:id/publish', () => {
  it('publica un borrador completo', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const id = await draftId(auth, completeEvent(venueId))
    const before = Date.now()

    const response = await publish(auth, id)

    expect(response.status).toBe(200)
    const { event } = response.body.data
    expect(event).toMatchObject({ id, status: 'published', venue: venueId })
    expect(new Date(event.publishedAt).getTime()).toBeGreaterThanOrEqual(before)
  })

  it.each(['pending', 'rejected'])(
    'RN-09: con el negocio %s responde 403 BUSINESS_NOT_APPROVED',
    async (verificationStatus) => {
      const { auth, businessId } = await registerManager()
      const venueId = await createVenue(businessId)
      const id = await draftId(auth, completeEvent(venueId))
      await Business.updateOne(
        { _id: businessId },
        { verificationStatus, rejectionReason: 'Faltan datos de contacto' },
      )

      const response = await publish(auth, id)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('BUSINESS_NOT_APPROVED')
      expect((await Event.findById(id))?.status).toBe('draft')
    },
  )

  it('RN-08: un borrador incompleto responde 400 con los campos que faltan', async () => {
    const { auth } = await approvedManager()
    const id = await draftId(auth, { title: 'Noche de jazz en Laureles' })

    const response = await publish(auth, id)

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('El evento no está completo para publicarse')
    expect(response.body.error.details.map((detail: { path: string }) => detail.path)).toEqual([
      'description',
      'category',
      'venueId',
      'startAt',
      'endAt',
      'price',
      'coverImage',
    ])
  })

  it('RN-10: no publica un evento cuyo inicio ya pasó', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const id = await draftId(auth, {
      ...completeEvent(venueId),
      startAt: inFuture(-HOUR),
      endAt: inFuture(2 * HOUR),
    })

    const response = await publish(auth, id)

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual([
      { path: 'startAt', message: 'El evento debe empezar en el futuro' },
    ])
  })

  it('RN-10: no publica un evento a más de 180 días', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const id = await draftId(auth, {
      ...completeEvent(venueId),
      startAt: inFuture(181 * DAY),
      endAt: inFuture(181 * DAY + HOUR),
    })

    const response = await publish(auth, id)

    expect(response.body.error.details).toEqual([
      { path: 'startAt', message: 'El evento puede empezar como máximo dentro de 180 días' },
    ])
  })

  it('RN-12: no publica si el lugar se desactivó después de guardar el borrador', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const id = await draftId(auth, completeEvent(venueId))
    await Venue.updateOne({ _id: venueId }, { isActive: false })

    const response = await publish(auth, id)

    expect(response.status).toBe(400)
    expect(response.body.error.details[0].path).toBe('venueId')
  })

  it('refresca las copias del lugar y del negocio al publicar', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const id = await draftId(auth, completeEvent(venueId))
    await Venue.updateOne({ _id: venueId }, { name: 'Sede Laureles Renovada' })
    await Business.updateOne({ _id: businessId }, { name: 'Café Nuevo' })

    const response = await publish(auth, id)

    expect(response.body.data.event.venueSnapshot.name).toBe('Sede Laureles Renovada')
    expect(response.body.data.event.businessSnapshot.name).toBe('Café Nuevo')
  })

  it('RN-13: el slug no cambia al publicar ni después', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const created = await createDraft(auth, completeEvent(venueId))
    const { id, slug } = created.body.data.event

    const published = await publish(auth, id)
    const event = await Event.findById(id)
    event!.title = 'Otro título para el evento'
    event!.slug = 'otro-slug'
    await event!.save()

    expect(published.body.data.event.slug).toBe(slug)
    expect((await Event.findById(id))?.slug).toBe(slug)
  })

  it('es idempotente: publicar dos veces devuelve el mismo evento', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const id = await draftId(auth, completeEvent(venueId))

    const first = await publish(auth, id)
    const second = await publish(auth, id)

    expect(second.status).toBe(200)
    expect(second.body.data.event.publishedAt).toBe(first.body.data.event.publishedAt)
  })

  it('no publica un evento cancelado', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const id = await draftId(auth, completeEvent(venueId))
    await Event.updateOne(
      { _id: id },
      { status: 'cancelled', cancellationReason: 'Lluvia fuerte en la ciudad' },
    )

    const response = await publish(auth, id)

    expect(response.status).toBe(409)
  })

  it.each([
    ['de otro negocio', 'otro'],
    ['inexistente', 'inexistente'],
    ['con id mal formado', 'mal-formado'],
  ])('un evento %s responde 404', async (_case, kind) => {
    const { auth } = await approvedManager()
    let id = 'no-es-un-id'
    if (kind === 'inexistente') id = new Types.ObjectId().toString()
    if (kind === 'otro') {
      const other = await approvedManager('otro@correo.co')
      id = await draftId(other.auth, { title: 'Evento de otro negocio' })
    }

    const response = await publish(auth, id)

    expect(response.status).toBe(404)
  })

  it('publica un evento gratis', async () => {
    const { auth, businessId } = await approvedManager()
    const venueId = await createVenue(businessId)
    const id = await draftId(auth, { ...completeEvent(venueId), price: { type: 'free', min: 0 } })

    const response = await publish(auth, id)

    expect(response.status).toBe(200)
    expect(response.body.data.event.price).toEqual({ type: 'free', min: 0 })
  })
})

describe('PATCH /me/events/:id', () => {
  function update(auth: string, id: string, body: Record<string, unknown>) {
    return request(app).patch(`${EVENTS}/${id}`).set('Authorization', auth).send(body)
  }

  // Mueve las fechas directo en la base: por la API no se puede crear un evento en el pasado.
  async function moveDates(id: string, startOffset: number, endOffset: number) {
    await Event.updateOne(
      { _id: id },
      { startAt: new Date(Date.now() + startOffset), endAt: new Date(Date.now() + endOffset) },
    )
  }

  describe('borrador', () => {
    it('edita cualquier campo y el slug sigue al título', async () => {
      const { auth } = await registerManager()
      const created = await createDraft(auth, { title: 'Noche de jazz en Laureles' })
      const { id, slug } = created.body.data.event

      const response = await update(auth, id, {
        title: 'Tarde de salsa en Laureles',
        category: 'fiesta',
      })

      expect(response.status).toBe(200)
      const { event } = response.body.data
      expect(event).toMatchObject({ title: 'Tarde de salsa en Laureles', category: 'fiesta' })
      expect(event.slug).not.toBe(slug)
      expect(event.slug).toMatch(/^tarde-de-salsa-en-laureles-[0-9a-z]{6}$/)
    })

    it('valida la duración con las fechas ya guardadas', async () => {
      const { auth } = await registerManager()
      const id = await draftId(auth, {
        title: 'Noche de jazz en Laureles',
        startAt: inFuture(DAY),
        endAt: inFuture(DAY + 2 * HOUR),
      })

      const response = await update(auth, id, { endAt: inFuture(DAY + 5 * 60_000) })

      expect(response.status).toBe(400)
      expect(response.body.error.details).toEqual([
        { path: 'endAt', message: 'El evento debe durar al menos 15 minutos' },
      ])
    })
  })

  describe('RN-15: publicado que no ha empezado', () => {
    it('permite la edición completa y refresca la ubicación al cambiar de lugar', async () => {
      const { auth, businessId, id } = await publishedEvent()
      const otherVenueId = await createVenue(businessId, {
        name: 'Sede Provenza',
        neighborhood: 'El Poblado',
        comuna: '14',
        location: { type: 'Point', coordinates: [-75.5659, 6.2087] },
      })

      const response = await update(auth, id, {
        title: 'Noche de jazz en Provenza',
        venueId: otherVenueId,
        startAt: inFuture(3 * DAY),
        endAt: inFuture(3 * DAY + 2 * HOUR),
        category: 'cultura',
      })

      expect(response.status).toBe(200)
      expect(response.body.data.event).toMatchObject({
        status: 'published',
        venue: otherVenueId,
        category: 'cultura',
        location: { type: 'Point', coordinates: [-75.5659, 6.2087] },
        venueSnapshot: { name: 'Sede Provenza', comuna: '14' },
      })
    })

    it('RN-13: el slug no cambia aunque cambie el título', async () => {
      const { auth, id } = await publishedEvent()
      const { slug } = (await Event.findById(id))!

      const response = await update(auth, id, { title: 'Otro título para el evento' })

      expect(response.body.data.event.slug).toBe(slug)
    })

    it('RN-10: no permite mover el inicio al pasado', async () => {
      const { auth, id } = await publishedEvent()

      const response = await update(auth, id, {
        startAt: inFuture(-HOUR),
        endAt: inFuture(2 * HOUR),
      })

      expect(response.status).toBe(400)
      expect(response.body.error.details).toEqual([
        { path: 'startAt', message: 'El evento debe empezar en el futuro' },
      ])
    })

    it('RN-11: revisa la duración contra el inicio guardado', async () => {
      const { auth, id } = await publishedEvent()

      const response = await update(auth, id, { endAt: inFuture(10 * DAY) })

      expect(response.status).toBe(400)
      expect(response.body.error.details).toEqual([
        { path: 'endAt', message: 'El evento puede durar como máximo 7 días' },
      ])
    })

    it('RN-12: no acepta un lugar inactivo', async () => {
      const { auth, businessId, id } = await publishedEvent()
      const inactive = await createVenue(businessId, { name: 'Sede cerrada', isActive: false })

      const response = await update(auth, id, { venueId: inactive })

      expect(response.status).toBe(400)
      expect(response.body.error.details[0].path).toBe('venueId')
    })

    it('RN-14: al pasar a gratis se descarta el precio máximo anterior', async () => {
      const { auth, id } = await publishedEvent()

      const response = await update(auth, id, { price: { type: 'free', min: 0 } })

      expect(response.status).toBe(200)
      expect(response.body.data.event.price).toEqual({ type: 'free', min: 0 })
      expect((await Event.findById(id))!.toObject().price).toEqual({ type: 'free', min: 0 })
    })
  })

  describe('RN-16: en curso', () => {
    it('permite editar descripción, precio, enlace y extender el cierre', async () => {
      const { auth, id } = await publishedEvent()
      await moveDates(id, -HOUR, 2 * HOUR)
      const endAt = inFuture(4 * HOUR)

      const response = await update(auth, id, {
        description: 'Se extiende la jornada: el trío toca un set adicional hasta tarde.',
        price: { type: 'paid', min: 20_000 },
        externalUrl: 'https://ejemplo.com/entradas',
        endAt,
      })

      expect(response.status).toBe(200)
      expect(response.body.data.event).toMatchObject({
        price: { type: 'paid', min: 20_000 },
        externalUrl: 'https://ejemplo.com/entradas',
        endAt,
      })
    })

    it('rechaza otros campos con 422 EVENT_NOT_EDITABLE y no guarda nada', async () => {
      const { auth, id } = await publishedEvent()
      await moveDates(id, -HOUR, 2 * HOUR)

      const response = await update(auth, id, {
        title: 'Otro título para el evento',
        description: 'Una descripción nueva que sí sería válida por sí sola.',
        startAt: inFuture(HOUR),
      })

      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe('EVENT_NOT_EDITABLE')
      expect(response.body.error.details.map((detail: { path: string }) => detail.path)).toEqual([
        'title',
        'startAt',
      ])
      expect((await Event.findById(id))!.title).toBe('Noche de jazz en Laureles')
    })

    it('no permite poner el cierre en el pasado', async () => {
      const { auth, id } = await publishedEvent()
      await moveDates(id, -2 * HOUR, 2 * HOUR)

      const response = await update(auth, id, { endAt: inFuture(-HOUR) })

      expect(response.status).toBe(400)
      expect(response.body.error.details).toEqual([
        { path: 'endAt', message: 'La fecha de fin debe ser posterior al momento actual' },
      ])
    })

    it('RN-11: no permite extender el cierre más allá de 7 días desde el inicio', async () => {
      const { auth, id } = await publishedEvent()
      await moveDates(id, -HOUR, 2 * HOUR)

      const response = await update(auth, id, { endAt: inFuture(7 * DAY) })

      expect(response.status).toBe(400)
      expect(response.body.error.details).toEqual([
        { path: 'endAt', message: 'El evento puede durar como máximo 7 días' },
      ])
    })
  })

  describe('RN-17: solo lectura', () => {
    it('un evento finalizado responde 422 EVENT_NOT_EDITABLE', async () => {
      const { auth, id } = await publishedEvent()
      await moveDates(id, -3 * HOUR, -HOUR)

      const response = await update(auth, id, { description: 'Gracias a todos por venir anoche.' })

      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe('EVENT_NOT_EDITABLE')
    })

    it.each([
      ['cancelled', { cancellationReason: 'Lluvia fuerte en la ciudad' }],
      ['removed', { removalReason: 'Contenido que incumple las normas' }],
    ])('un evento %s responde 422 EVENT_NOT_EDITABLE', async (status, reason) => {
      const { auth, id } = await publishedEvent()
      await Event.updateOne({ _id: id }, { status, ...reason })

      const response = await update(auth, id, { externalUrl: 'https://ejemplo.com/otro' })

      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe('EVENT_NOT_EDITABLE')
      expect((await Event.findById(id))!.externalUrl).toBeUndefined()
    })
  })

  it('un cuerpo vacío o sin campos editables responde 400', async () => {
    const { auth } = await registerManager()
    const id = await draftId(auth, { title: 'Noche de jazz en Laureles' })

    const empty = await update(auth, id, {})
    const unknown = await update(auth, id, { status: 'published', slug: 'otro' })

    expect(empty.status).toBe(400)
    expect(unknown.status).toBe(400)
    expect(empty.body.error.details[0].message).toBe('Envía al menos un campo para actualizar')
  })

  it('rechaza una portada que no se subió a través de Parche', async () => {
    const { auth } = await registerManager()
    const id = await draftId(auth, { title: 'Noche de jazz en Laureles' })

    const response = await update(auth, id, {
      coverImage: { ...COVER, url: 'https://otro-sitio.com/imagen.jpg' },
    })

    expect(response.status).toBe(400)
    expect(response.body.error.details[0].path).toBe('body.coverImage.url')
  })

  it('un evento de otro negocio responde 404', async () => {
    const { auth } = await registerManager()
    const other = await registerManager('otro@correo.co')
    const id = await draftId(other.auth, { title: 'Evento de otro negocio' })

    const response = await update(auth, id, { title: 'Me lo quiero quedar' })

    expect(response.status).toBe(404)
  })
})

async function publishedEvent() {
  const manager = await approvedManager()
  const venueId = await createVenue(manager.businessId)
  const id = await draftId(manager.auth, completeEvent(venueId))
  await publish(manager.auth, id).expect(200)
  return { ...manager, venueId, id }
}

describe('POST /me/events/:id/duplicate (RN-20)', () => {
  function duplicate(auth: string, id: string) {
    return request(app).post(`${EVENTS}/${id}/duplicate`).set('Authorization', auth)
  }

  it('crea un borrador con todo copiado excepto fechas, slug y estado', async () => {
    const { auth, id, venueId } = await publishedEvent()
    await Event.updateOne({ _id: id }, { 'stats.views': 40 })
    const source = (await Event.findById(id))!

    const response = await duplicate(auth, id)

    expect(response.status).toBe(201)
    const { event } = response.body.data
    expect(event.id).not.toBe(id)
    expect(event).toMatchObject({
      status: 'draft',
      title: source.title,
      description: source.description,
      category: 'musica-en-vivo',
      tags: ['jazz'],
      venue: venueId,
      price: { type: 'paid', min: 30_000, max: 80_000 },
      coverImage: COVER,
      venueSnapshot: { name: 'Sede Laureles' },
      stats: { views: 0 },
    })
    expect(event.slug).not.toBe(source.slug)
    expect(event.slug).toMatch(/^noche-de-jazz-en-laureles-[0-9a-z]{6}$/)
    expect(event).not.toHaveProperty('startAt')
    expect(event).not.toHaveProperty('endAt')
    expect(event).not.toHaveProperty('publishedAt')
  })

  it('RN-17: también duplica un evento cancelado, sin copiar el motivo', async () => {
    const { auth, id } = await publishedEvent()
    await Event.updateOne(
      { _id: id },
      { status: 'cancelled', cancellationReason: 'Lluvia fuerte en la ciudad' },
    )

    const response = await duplicate(auth, id)

    expect(response.status).toBe(201)
    expect(response.body.data.event.status).toBe('draft')
    expect(response.body.data.event).not.toHaveProperty('cancellationReason')
  })

  it('RN-12: no copia el lugar si ya está inactivo', async () => {
    const { auth, id, venueId } = await publishedEvent()
    await Venue.updateOne({ _id: venueId }, { isActive: false })

    const response = await duplicate(auth, id)

    expect(response.status).toBe(201)
    const { event } = response.body.data
    expect(event).not.toHaveProperty('venue')
    expect(event).not.toHaveProperty('location')
    expect(event).not.toHaveProperty('venueSnapshot')
  })

  it('duplica un borrador que solo tiene título', async () => {
    const { auth } = await registerManager()
    const id = await draftId(auth, { title: 'Noche de jazz en Laureles' })

    const response = await duplicate(auth, id)

    expect(response.status).toBe(201)
    expect(response.body.data.event).toMatchObject({
      status: 'draft',
      title: 'Noche de jazz en Laureles',
    })
    expect(await Event.countDocuments()).toBe(2)
  })

  it('un evento de otro negocio responde 404', async () => {
    const { auth } = await registerManager()
    const other = await registerManager('otro@correo.co')
    const id = await draftId(other.auth, { title: 'Evento de otro negocio' })

    expect((await duplicate(auth, id)).status).toBe(404)
  })
})

describe('POST /me/events/:id/cancel (RN-18)', () => {
  const REASON = 'Se cancela por lluvia fuerte en la ciudad'

  function cancel(auth: string, id: string, body: Record<string, unknown> = { reason: REASON }) {
    return request(app).post(`${EVENTS}/${id}/cancel`).set('Authorization', auth).send(body)
  }

  it('cancela un publicado y guarda el motivo', async () => {
    const { auth, id } = await publishedEvent()
    const before = Date.now()

    const response = await cancel(auth, id, { reason: `  ${REASON}  ` })

    expect(response.status).toBe(200)
    const { event } = response.body.data
    expect(event).toMatchObject({ status: 'cancelled', cancellationReason: REASON })
    expect(new Date(event.cancelledAt).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('cancela un evento en curso', async () => {
    const { auth, id } = await publishedEvent()
    await Event.updateOne(
      { _id: id },
      { startAt: new Date(Date.now() - HOUR), endAt: new Date(Date.now() + HOUR) },
    )

    expect((await cancel(auth, id)).status).toBe(200)
  })

  it.each([
    ['sin motivo', {}],
    ['con motivo corto', { reason: 'Lluvia' }],
    ['con motivo de solo espacios', { reason: '            ' }],
    ['con motivo largo', { reason: 'a'.repeat(301) }],
  ])('%s responde 400', async (_case, body) => {
    const { auth, id } = await publishedEvent()

    const response = await cancel(auth, id, body)

    expect(response.status).toBe(400)
    expect(response.body.error.details[0].path).toBe('body.reason')
    expect((await Event.findById(id))!.status).toBe('published')
  })

  it('es idempotente: cancelar dos veces conserva el primer motivo', async () => {
    const { auth, id } = await publishedEvent()
    const first = await cancel(auth, id)

    const second = await cancel(auth, id, { reason: 'Otro motivo distinto al primero' })

    expect(second.status).toBe(200)
    expect(second.body.data.event.cancellationReason).toBe(REASON)
    expect(second.body.data.event.cancelledAt).toBe(first.body.data.event.cancelledAt)
  })

  it('un borrador responde 422 EVENT_NOT_CANCELLABLE', async () => {
    const { auth } = await registerManager()
    const id = await draftId(auth, { title: 'Noche de jazz en Laureles' })

    const response = await cancel(auth, id)

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('EVENT_NOT_CANCELLABLE')
  })

  it('un evento finalizado responde 422 EVENT_NOT_CANCELLABLE', async () => {
    const { auth, id } = await publishedEvent()
    await Event.updateOne(
      { _id: id },
      { startAt: new Date(Date.now() - 3 * HOUR), endAt: new Date(Date.now() - HOUR) },
    )

    const response = await cancel(auth, id)

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('EVENT_NOT_CANCELLABLE')
  })

  it('un evento retirado responde 422 EVENT_NOT_CANCELLABLE', async () => {
    const { auth, id } = await publishedEvent()
    await Event.updateOne(
      { _id: id },
      { status: 'removed', removalReason: 'Contenido que incumple las normas' },
    )

    const response = await cancel(auth, id)

    expect(response.status).toBe(422)
    expect((await Event.findById(id))!.status).toBe('removed')
  })

  it('un evento de otro negocio responde 404', async () => {
    const { auth } = await registerManager('otro@correo.co')
    const { id } = await publishedEvent()

    expect((await cancel(auth, id)).status).toBe(404)
  })
})

describe('DELETE /me/events/:id (RN-19)', () => {
  function remove(auth: string, id: string) {
    return request(app).delete(`${EVENTS}/${id}`).set('Authorization', auth)
  }

  it('elimina un borrador y responde 204', async () => {
    const { auth } = await registerManager()
    const id = await draftId(auth, { title: 'Noche de jazz en Laureles' })

    const response = await remove(auth, id)

    expect(response.status).toBe(204)
    expect(response.body).toEqual({})
    expect(await Event.findById(id)).toBeNull()
  })

  it('un publicado responde 422 EVENT_NOT_DELETABLE y no se borra', async () => {
    const { auth, id } = await publishedEvent()

    const response = await remove(auth, id)

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('EVENT_NOT_DELETABLE')
    expect(await Event.findById(id)).not.toBeNull()
  })

  it('un cancelado responde 422 EVENT_NOT_DELETABLE', async () => {
    const { auth, id } = await publishedEvent()
    await Event.updateOne(
      { _id: id },
      { status: 'cancelled', cancellationReason: 'Lluvia fuerte en la ciudad' },
    )

    expect((await remove(auth, id)).status).toBe(422)
  })

  it.each([
    ['de otro negocio', 'otro'],
    ['ya eliminado', 'eliminado'],
  ])('un evento %s responde 404', async (_case, kind) => {
    const { auth } = await registerManager()
    let id: string
    if (kind === 'otro') {
      const other = await registerManager('otro@correo.co')
      id = await draftId(other.auth, { title: 'Evento de otro negocio' })
    } else {
      id = await draftId(auth, { title: 'Noche de jazz en Laureles' })
      await remove(auth, id).expect(204)
    }

    const response = await remove(auth, id)

    expect(response.status).toBe(404)
    expect(await Event.countDocuments({ _id: id })).toBe(kind === 'otro' ? 1 : 0)
  })
})

describe('panel del gestor', () => {
  let seq = 0

  // Inserta directo en la colección: así se arman eventos pasados o en curso sin pasar por la API.
  async function seed(businessId: string, fields: Record<string, unknown>) {
    seq += 1
    const { insertedId } = await Event.collection.insertOne({
      business: new Types.ObjectId(businessId),
      title: `Evento número ${seq}`,
      slug: `evento-${seq}`,
      status: 'published',
      businessSnapshot: { name: 'Negocio' },
      updatedAt: new Date(),
      ...fields,
    })
    return String(insertedId)
  }

  const window = (startOffset: number, endOffset: number) => ({
    startAt: new Date(Date.now() + startOffset),
    endAt: new Date(Date.now() + endOffset),
  })

  // Un evento de cada clase; los que están en curso cuentan como próximos.
  async function seedOneOfEach(businessId: string) {
    return {
      upcoming: await seed(businessId, window(2 * DAY, 2 * DAY + HOUR)),
      ongoing: await seed(businessId, window(-HOUR, HOUR)),
      draft: await seed(businessId, { status: 'draft' }),
      past: await seed(businessId, window(-2 * DAY, -2 * DAY + HOUR)),
      cancelled: await seed(businessId, {
        status: 'cancelled',
        cancellationReason: 'Lluvia fuerte en la ciudad',
        ...window(DAY, DAY + HOUR),
      }),
      removed: await seed(businessId, {
        status: 'removed',
        removalReason: 'Contenido que incumple las normas',
        ...window(-DAY, -DAY + HOUR),
      }),
    }
  }

  function list(auth: string, query: Record<string, string | number> = {}) {
    return request(app).get(EVENTS).query(query).set('Authorization', auth)
  }

  const idsOf = (response: request.Response) =>
    response.body.data.events.map((event: { id: string }) => event.id)

  describe('GET /me/events (RF-GES-11)', () => {
    it('por defecto muestra próximos: publicados futuros y en curso, del más cercano al más lejano', async () => {
      const { auth, businessId } = await registerManager()
      const ids = await seedOneOfEach(businessId)

      const response = await list(auth)

      expect(response.status).toBe(200)
      expect(idsOf(response)).toEqual([ids.ongoing, ids.upcoming])
      expect(response.body.data.pagination).toEqual({ page: 1, limit: 20, total: 2 })
    })

    it.each([
      ['drafts', ['draft']],
      ['past', ['past']],
      ['cancelled', ['cancelled', 'removed']],
    ] as const)('la pestaña %s filtra lo que corresponde', async (tab, expected) => {
      const { auth, businessId } = await registerManager()
      const ids = await seedOneOfEach(businessId)

      const response = await list(auth, { tab })

      expect(idsOf(response)).toEqual(expected.map((kind) => ids[kind]))
    })

    it('pasados van del más reciente al más antiguo', async () => {
      const { auth, businessId } = await registerManager()
      const older = await seed(businessId, window(-10 * DAY, -10 * DAY + HOUR))
      const recent = await seed(businessId, window(-DAY, -DAY + HOUR))

      const response = await list(auth, { tab: 'past' })

      expect(idsOf(response)).toEqual([recent, older])
    })

    it('los borradores van por la última edición', async () => {
      const { auth, businessId } = await registerManager()
      const old = await seed(businessId, { status: 'draft', updatedAt: new Date(Date.now() - DAY) })
      const recent = await seed(businessId, { status: 'draft', updatedAt: new Date() })

      const response = await list(auth, { tab: 'drafts' })

      expect(idsOf(response)).toEqual([recent, old])
    })

    it('pagina de 20 en 20 sin repetir ni saltar eventos', async () => {
      const { auth, businessId } = await registerManager()
      const ids: string[] = []
      for (let day = 1; day <= 25; day += 1) {
        ids.push(await seed(businessId, window(day * DAY, day * DAY + HOUR)))
      }

      const first = await list(auth, { page: 1 })
      const second = await list(auth, { page: 2 })
      const third = await list(auth, { page: 3 })

      expect(idsOf(first)).toEqual(ids.slice(0, 20))
      expect(idsOf(second)).toEqual(ids.slice(20))
      expect(idsOf(third)).toEqual([])
      expect(second.body.data.pagination).toEqual({ page: 2, limit: 20, total: 25 })
    })

    it('cada fila trae lo que pinta el listado, el estado visible y las acciones', async () => {
      const { auth, businessId } = await approvedManager()
      const venueId = await createVenue(businessId)
      const id = await draftId(auth, completeEvent(venueId))
      await publish(auth, id).expect(200)

      const response = await list(auth)

      const [row] = response.body.data.events
      expect(row).toMatchObject({
        id,
        title: 'Noche de jazz en Laureles',
        status: 'published',
        coverImage: COVER,
        venueSnapshot: { name: 'Sede Laureles', neighborhood: 'Laureles' },
        displayStatus: 'upcoming',
        actions: { view: true, edit: true, duplicate: true, cancel: true, delete: false },
      })
      expect(row.startAt).toBeDefined()
      expect(row).not.toHaveProperty('description')
      expect(row).not.toHaveProperty('stats')
    })

    it.each([
      ['ongoing', 'upcoming', { view: true, edit: true, duplicate: true, cancel: true, delete: false }],
      ['draft', 'drafts', { view: false, edit: true, duplicate: true, cancel: false, delete: true }],
      ['past', 'past', { view: true, edit: false, duplicate: true, cancel: false, delete: false }],
      [
        'cancelled',
        'cancelled',
        { view: true, edit: false, duplicate: true, cancel: false, delete: false },
      ],
      ['removed', 'cancelled', { view: false, edit: false, duplicate: true, cancel: false, delete: false }],
    ] as const)('un evento %s muestra sus acciones', async (kind, tab, actions) => {
      const { auth, businessId } = await registerManager()
      const ids = await seedOneOfEach(businessId)

      const response = await list(auth, { tab })

      const row = response.body.data.events.find((event: { id: string }) => event.id === ids[kind])
      expect(row.displayStatus).toBe(kind)
      expect(row.actions).toEqual(actions)
    })

    it('solo muestra eventos del propio negocio', async () => {
      const { auth } = await registerManager()
      const other = await registerManager('otro@correo.co')
      await seed(other.businessId, window(DAY, DAY + HOUR))

      const response = await list(auth)

      expect(response.body.data.events).toEqual([])
    })

    it.each([
      [{ tab: 'todos' }, 'query.tab'],
      [{ page: 0 }, 'query.page'],
      [{ page: 'dos' }, 'query.page'],
    ])('una consulta inválida responde 400 (%o)', async (query, path) => {
      const { auth } = await registerManager()

      const response = await list(auth, query)

      expect(response.status).toBe(400)
      expect(response.body.error.details[0].path).toBe(path)
    })
  })

  describe('GET /me/events/summary', () => {
    it('cuenta los eventos de cada pestaña y cuántos están en curso', async () => {
      const { auth, businessId } = await registerManager()
      await seedOneOfEach(businessId)
      await seed(businessId, { status: 'draft' })
      const other = await registerManager('otro@correo.co')
      await seedOneOfEach(other.businessId)

      const response = await request(app).get(`${EVENTS}/summary`).set('Authorization', auth)

      expect(response.status).toBe(200)
      expect(response.body.data.summary).toEqual({
        upcoming: 2,
        ongoing: 1,
        drafts: 2,
        past: 1,
        cancelled: 2,
      })
    })

    it('un negocio sin eventos tiene todo en cero', async () => {
      const { auth } = await registerManager()

      const response = await request(app).get(`${EVENTS}/summary`).set('Authorization', auth)

      expect(response.body.data.summary).toEqual({
        upcoming: 0,
        ongoing: 0,
        drafts: 0,
        past: 0,
        cancelled: 0,
      })
    })
  })
})
