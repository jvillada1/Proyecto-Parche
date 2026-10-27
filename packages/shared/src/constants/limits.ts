// RN-30: límites por gestor para proteger contra abuso.
export const MANAGER_LIMITS = {
  maxActiveVenues: 20,
  maxFutureEvents: 200,
} as const
