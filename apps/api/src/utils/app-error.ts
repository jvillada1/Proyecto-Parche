export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown[],
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Datos inválidos', details?: unknown[]) {
    super(400, 'VALIDATION_ERROR', message, details)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No autenticado') {
    super(401, 'UNAUTHORIZED', message)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tienes permisos para realizar esta acción') {
    super(403, 'FORBIDDEN', message)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado') {
    super(404, 'NOT_FOUND', message)
  }
}

export class ConflictError extends AppError {
  constructor(message = 'El recurso ya existe o está en conflicto') {
    super(409, 'CONFLICT', message)
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Demasiadas solicitudes, intenta de nuevo más tarde') {
    super(429, 'RATE_LIMITED', message)
  }
}

export class OutOfServiceAreaError extends AppError {
  constructor(message = 'La ubicación está fuera del área de servicio') {
    super(422, 'OUT_OF_SERVICE_AREA', message)
  }
}

export class LimitReachedError extends AppError {
  constructor(message: string) {
    super(409, 'LIMIT_REACHED', message)
  }
}

export class GeocodingUnavailableError extends AppError {
  constructor(
    message = 'No pudimos buscar la dirección en este momento. Ubica el pin manualmente en el mapa.',
  ) {
    super(502, 'GEOCODING_UNAVAILABLE', message)
  }
}

export class UploadsNotConfiguredError extends AppError {
  constructor(message = 'La subida de imágenes no está disponible en este momento') {
    super(503, 'UPLOADS_NOT_CONFIGURED', message)
  }
}

// RN-09
export class BusinessNotApprovedError extends AppError {
  constructor(message = 'Tu negocio debe estar aprobado para publicar eventos') {
    super(403, 'BUSINESS_NOT_APPROVED', message)
  }
}

// RN-16 y RN-17
export class EventNotEditableError extends AppError {
  constructor(
    message = 'El evento ya finalizó, fue cancelado o retirado: es de solo lectura',
    details?: unknown[],
  ) {
    super(422, 'EVENT_NOT_EDITABLE', message, details)
  }
}

// RN-18
export class EventNotCancellableError extends AppError {
  constructor(message: string) {
    super(422, 'EVENT_NOT_CANCELLABLE', message)
  }
}

// RN-19
export class EventNotDeletableError extends AppError {
  constructor(
    message = 'Solo los borradores se pueden eliminar; un evento publicado se cancela',
  ) {
    super(422, 'EVENT_NOT_DELETABLE', message)
  }
}

// RN-24
export class VenueHasUpcomingEventsError extends AppError {
  constructor(count: number) {
    super(
      409,
      'VENUE_HAS_UPCOMING_EVENTS',
      `Este lugar tiene ${count} ${count === 1 ? 'evento publicado' : 'eventos publicados'} que aún no ${count === 1 ? 'termina' : 'terminan'}. Cancélalos o muévelos a otro lugar antes de desactivarlo.`,
    )
  }
}
