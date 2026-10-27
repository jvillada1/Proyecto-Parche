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
