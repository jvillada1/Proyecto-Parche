// Rectángulo aproximado del Valle de Aburrá (regla RN-23)
export const SERVICE_AREA = { minLat: 6.05, maxLat: 6.5, minLng: -75.75, maxLng: -75.3 } as const
export const MEDELLIN_CENTER = { lat: 6.2442, lng: -75.5812 } as const

export function isInServiceArea(lat: number, lng: number): boolean {
  const a = SERVICE_AREA
  return lat >= a.minLat && lat <= a.maxLat && lng >= a.minLng && lng <= a.maxLng
}
