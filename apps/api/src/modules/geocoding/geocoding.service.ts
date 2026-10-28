import { SERVICE_AREA, isInServiceArea } from '@parche/shared'
import { env } from '../../config/env'
import { logger } from '../../lib/logger'
import { QueueFullError, createRequestQueue } from '../../lib/request-queue'
import { TtlCache } from '../../lib/ttl-cache'
import {
  GeocodingUnavailableError,
  OutOfServiceAreaError,
  TooManyRequestsError,
} from '../../utils/app-error'

const DAY_MS = 24 * 60 * 60 * 1000
const BUSY_MESSAGE = 'El buscador de direcciones está ocupado, intenta de nuevo en unos segundos'

// Nominatim espera el viewbox como dos esquinas opuestas: lng1,lat1,lng2,lat2.
const SERVICE_AREA_VIEWBOX = [
  SERVICE_AREA.minLng,
  SERVICE_AREA.maxLat,
  SERVICE_AREA.maxLng,
  SERVICE_AREA.minLat,
].join(',')

interface NominatimAddress {
  neighbourhood?: string
  quarter?: string
  suburb?: string
  city?: string
  town?: string
  village?: string
  municipality?: string
}

interface NominatimPlace {
  lat: string
  lon: string
  display_name: string
  address?: NominatimAddress
}

export interface GeocodingPlace {
  displayName: string
  lat: number
  lng: number
  neighborhood: string | null
  city: string | null
}

// En Medellín el barrio suele venir en `neighbourhood` y la comuna en `suburb`.
function toPlace(place: NominatimPlace): GeocodingPlace {
  const address = place.address ?? {}
  return {
    displayName: place.display_name,
    lat: Number(place.lat),
    lng: Number(place.lon),
    neighborhood: address.neighbourhood ?? address.quarter ?? address.suburb ?? null,
    city: address.city ?? address.town ?? address.village ?? address.municipality ?? null,
  }
}

function searchCacheKey(query: string) {
  return query.trim().toLocaleLowerCase('es').replace(/\s+/g, ' ')
}

// ~1 m de precisión: soltar el pin casi en el mismo punto reutiliza la respuesta.
function reverseCacheKey(lat: number, lng: number) {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`
}

interface GeocoderOptions {
  baseUrl: string
  userAgent: string
  fetchFn?: typeof fetch
  intervalMs?: number
  maxPending?: number
  timeoutMs?: number
  cacheTtlMs?: number
  maxCacheEntries?: number
  now?: () => number
}

// RNF-14: una petición por segundo a Nominatim, User-Agent propio y caché en memoria de 24 h.
// La geocodificación solo sugiere: la ubicación definitiva la decide el gestor con el pin.
export function createGeocoder({
  baseUrl,
  userAgent,
  fetchFn = (...args) => fetch(...args),
  intervalMs = 1000,
  maxPending = 20,
  timeoutMs = 5000,
  cacheTtlMs = DAY_MS,
  maxCacheEntries = 1000,
  now = Date.now,
}: GeocoderOptions) {
  const enqueue = createRequestQueue({ intervalMs, maxPending })
  const searchCache = new TtlCache<Promise<GeocodingPlace[]>>(cacheTtlMs, maxCacheEntries, now)
  const reverseCache = new TtlCache<Promise<GeocodingPlace | null>>(
    cacheTtlMs,
    maxCacheEntries,
    now,
  )

  async function callNominatim<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${endpoint}`)
    url.search = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      'accept-language': 'es',
      ...params,
    }).toString()

    let response: Response
    try {
      response = await enqueue(() =>
        fetchFn(url, {
          headers: { 'User-Agent': userAgent, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        }),
      )
    } catch (error) {
      if (error instanceof QueueFullError) throw new TooManyRequestsError(BUSY_MESSAGE)
      logger.warn({ err: error, endpoint }, 'Nominatim no respondió')
      throw new GeocodingUnavailableError()
    }

    if (!response.ok) {
      logger.warn({ status: response.status, endpoint }, 'Nominatim respondió con error')
      throw new GeocodingUnavailableError()
    }
    return (await response.json()) as T
  }

  // Se guarda la promesa para que búsquedas iguales simultáneas compartan una sola petición.
  // Los errores no se guardan: el siguiente intento vuelve a consultar.
  function cached<T>(cache: TtlCache<Promise<T>>, key: string, load: () => Promise<T>) {
    const hit = cache.get(key)
    if (hit) return hit

    const promise = load()
    cache.set(key, promise)
    promise.catch(() => cache.delete(key))
    return promise
  }

  function search(query: string) {
    return cached(searchCache, searchCacheKey(query), async () => {
      const places = await callNominatim<NominatimPlace[]>('search', {
        q: query.trim(),
        countrycodes: 'co',
        viewbox: SERVICE_AREA_VIEWBOX,
        bounded: '1',
        limit: '5',
      })
      return places.map(toPlace).filter((place) => isInServiceArea(place.lat, place.lng))
    })
  }

  function reverse(lat: number, lng: number) {
    if (!isInServiceArea(lat, lng)) return Promise.reject(new OutOfServiceAreaError())

    return cached(reverseCache, reverseCacheKey(lat, lng), async () => {
      const place = await callNominatim<NominatimPlace | { error: string }>('reverse', {
        lat: String(lat),
        lon: String(lng),
        zoom: '18',
      })
      return 'error' in place ? null : toPlace(place)
    })
  }

  return { search, reverse }
}

export const geocoder = createGeocoder({
  baseUrl: env.NOMINATIM_BASE_URL,
  userAgent: env.NOMINATIM_USER_AGENT,
})
