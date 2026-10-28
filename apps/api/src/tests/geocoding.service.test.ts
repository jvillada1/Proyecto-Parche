import { describe, expect, it, vi } from 'vitest'
import { createGeocoder } from '../modules/geocoding/geocoding.service'

const DAY_MS = 24 * 60 * 60 * 1000
const USER_AGENT = 'Parche-test/1.0 (pruebas@parche.co)'

const laureles = {
  lat: '6.2447',
  lon: '-75.5906',
  display_name: 'Carrera 70, Laureles, Comuna 11 - Laureles Estadio, Medellín, Antioquia, Colombia',
  address: {
    neighbourhood: 'Laureles',
    suburb: 'Comuna 11 - Laureles Estadio',
    city: 'Medellín',
  },
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setup(body: unknown = [laureles], options: { now?: () => number } = {}) {
  const fetchFn = vi.fn(async () => jsonResponse(body))
  const geocoder = createGeocoder({
    baseUrl: 'https://nominatim.test',
    userAgent: USER_AGENT,
    fetchFn: fetchFn as unknown as typeof fetch,
    intervalMs: 0,
    ...options,
  })
  return { geocoder, fetchFn }
}

function requestOf(fetchFn: ReturnType<typeof vi.fn>, call = 0) {
  const [url, init] = fetchFn.mock.calls[call] as [URL, RequestInit]
  return { url: new URL(url), headers: init.headers as Record<string, string> }
}

describe('geocoder.search', () => {
  it('consulta Nominatim limitado a Colombia y al área de servicio', async () => {
    const { geocoder, fetchFn } = setup()

    await geocoder.search('  Cra. 70 #44-35  ')

    const { url, headers } = requestOf(fetchFn)
    expect(url.origin + url.pathname).toBe('https://nominatim.test/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'Cra. 70 #44-35',
      format: 'jsonv2',
      countrycodes: 'co',
      viewbox: '-75.75,6.5,-75.3,6.05',
      bounded: '1',
      addressdetails: '1',
      'accept-language': 'es',
      limit: '5',
    })
    expect(headers['User-Agent']).toBe(USER_AGENT)
  })

  it('devuelve sugerencias con coordenadas numéricas y el barrio', async () => {
    const { geocoder } = setup()

    const results = await geocoder.search('Cra. 70 #44-35')

    expect(results).toEqual([
      {
        displayName: laureles.display_name,
        lat: 6.2447,
        lng: -75.5906,
        neighborhood: 'Laureles',
        city: 'Medellín',
      },
    ])
  })

  it('descarta resultados fuera del área de servicio', async () => {
    const { geocoder } = setup([laureles, { ...laureles, lat: '4.711', lon: '-74.0721' }])

    const results = await geocoder.search('Carrera 70')

    expect(results).toHaveLength(1)
    expect(results[0]!.lat).toBe(6.2447)
  })

  it('usa la caché para el mismo texto, sin importar mayúsculas ni espacios', async () => {
    const { geocoder, fetchFn } = setup()

    await geocoder.search('Cra. 70 #44-35')
    await geocoder.search('  cra.   70 #44-35 ')

    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('búsquedas iguales simultáneas comparten una sola petición', async () => {
    const { geocoder, fetchFn } = setup()

    await Promise.all([geocoder.search('Laureles'), geocoder.search('laureles')])

    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('la caché expira a las 24 h', async () => {
    let now = 0
    const { geocoder, fetchFn } = setup([laureles], { now: () => now })

    await geocoder.search('Laureles')
    now = DAY_MS - 1
    await geocoder.search('Laureles')
    now = DAY_MS
    await geocoder.search('Laureles')

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('responde GEOCODING_UNAVAILABLE si Nominatim falla y no guarda el error en caché', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse([laureles]))
    const geocoder = createGeocoder({
      baseUrl: 'https://nominatim.test',
      userAgent: USER_AGENT,
      fetchFn,
      intervalMs: 0,
    })

    await expect(geocoder.search('Laureles')).rejects.toMatchObject({
      status: 502,
      code: 'GEOCODING_UNAVAILABLE',
    })
    await expect(geocoder.search('Laureles')).rejects.toMatchObject({
      code: 'GEOCODING_UNAVAILABLE',
    })
    await expect(geocoder.search('Laureles')).resolves.toHaveLength(1)
  })

  it('responde 429 RATE_LIMITED cuando la cola está llena', async () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}))
    const geocoder = createGeocoder({
      baseUrl: 'https://nominatim.test',
      userAgent: USER_AGENT,
      fetchFn,
      maxPending: 1,
    })

    void geocoder.search('Laureles')

    await expect(geocoder.search('Provenza')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    })
  })
})

describe('geocoder.reverse', () => {
  it('consulta la geocodificación inversa y sugiere el barrio', async () => {
    const { geocoder, fetchFn } = setup(laureles)

    const place = await geocoder.reverse(6.2447, -75.5906)

    const { url, headers } = requestOf(fetchFn)
    expect(url.pathname).toBe('/reverse')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      lat: '6.2447',
      lon: '-75.5906',
      format: 'jsonv2',
      addressdetails: '1',
      'accept-language': 'es',
    })
    expect(headers['User-Agent']).toBe(USER_AGENT)
    expect(place).toMatchObject({ neighborhood: 'Laureles', city: 'Medellín' })
  })

  it('usa la comuna si no hay barrio', async () => {
    const { geocoder } = setup({ ...laureles, address: { suburb: 'Comuna 14 - El Poblado' } })

    const place = await geocoder.reverse(6.2087, -75.5664)

    expect(place?.neighborhood).toBe('Comuna 14 - El Poblado')
  })

  it('devuelve null si Nominatim no encuentra nada', async () => {
    const { geocoder } = setup({ error: 'Unable to geocode' })

    await expect(geocoder.reverse(6.2447, -75.5906)).resolves.toBeNull()
  })

  it('responde OUT_OF_SERVICE_AREA sin llamar a Nominatim', async () => {
    const { geocoder, fetchFn } = setup(laureles)

    await expect(geocoder.reverse(4.711, -74.0721)).rejects.toMatchObject({
      status: 422,
      code: 'OUT_OF_SERVICE_AREA',
    })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('usa la caché para el mismo punto', async () => {
    const { geocoder, fetchFn } = setup(laureles)

    await geocoder.reverse(6.2447, -75.5906)
    await geocoder.reverse(6.244700001, -75.590600001)

    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
