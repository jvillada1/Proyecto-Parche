import { Types } from 'mongoose'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import { signAccessToken } from '../lib/tokens'

const app = createApp()
const SEARCH = '/api/v1/geocoding/search'
const REVERSE = '/api/v1/geocoding/reverse'

const managerAuth = `Bearer ${signAccessToken(new Types.ObjectId(), 'manager')}`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('acceso a /geocoding', () => {
  it.each([SEARCH, REVERSE])('%s responde 401 sin token', async (path) => {
    await request(app).get(path).expect(401)
  })

  it.each(['user', 'admin'] as const)('responde 403 con rol %s', async (role) => {
    const auth = `Bearer ${signAccessToken(new Types.ObjectId(), role)}`

    await request(app).get(`${SEARCH}?q=Laureles`).set('Authorization', auth).expect(403)
  })
})

describe('GET /api/v1/geocoding/search', () => {
  it.each([
    ['sin q', ''],
    ['con menos de 3 caracteres', '?q=%20ab%20'],
    ['con más de 200 caracteres', `?q=${'a'.repeat(201)}`],
  ])('responde 400 %s', async (_case, query) => {
    const response = await request(app).get(`${SEARCH}${query}`).set('Authorization', managerAuth)

    expect(response.status).toBe(400)
    expect(response.body.error.details[0].path).toBe('query.q')
  })

  it('devuelve las sugerencias de Nominatim', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              lat: '6.2447',
              lon: '-75.5906',
              display_name: 'Laureles, Medellín',
              address: { neighbourhood: 'Laureles', city: 'Medellín' },
            },
          ]),
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(app)
      .get(`${SEARCH}?q=${encodeURIComponent('Cra. 70 #44-35 rutas')}`)
      .set('Authorization', managerAuth)

    expect(response.status).toBe(200)
    expect(response.body.data.results).toEqual([
      {
        displayName: 'Laureles, Medellín',
        lat: 6.2447,
        lng: -75.5906,
        neighborhood: 'Laureles',
        city: 'Medellín',
      },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/v1/geocoding/reverse', () => {
  it.each([
    ['sin coordenadas', '', ['query.lat', 'query.lng']],
    ['con latitud no numérica', '?lat=abc&lng=-75.59', ['query.lat']],
  ])('responde 400 %s', async (_case, query, paths) => {
    const response = await request(app).get(`${REVERSE}${query}`).set('Authorization', managerAuth)

    expect(response.status).toBe(400)
    const received = response.body.error.details.map((detail: { path: string }) => detail.path)
    expect(received).toEqual(expect.arrayContaining(paths))
  })

  it('responde 422 OUT_OF_SERVICE_AREA fuera del área de servicio', async () => {
    const response = await request(app)
      .get(`${REVERSE}?lat=4.711&lng=-74.0721`)
      .set('Authorization', managerAuth)

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('OUT_OF_SERVICE_AREA')
  })

  it('sugiere el barrio del punto', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              lat: '6.2087',
              lon: '-75.5664',
              display_name: 'Provenza, El Poblado, Medellín',
              address: { neighbourhood: 'Provenza', city: 'Medellín' },
            }),
          ),
      ),
    )

    const response = await request(app)
      .get(`${REVERSE}?lat=6.2087&lng=-75.5664`)
      .set('Authorization', managerAuth)

    expect(response.status).toBe(200)
    expect(response.body.data.place).toMatchObject({ neighborhood: 'Provenza', city: 'Medellín' })
  })
})
