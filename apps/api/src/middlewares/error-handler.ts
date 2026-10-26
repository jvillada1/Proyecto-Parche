import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { formatZodIssues } from '../utils/zod-issues'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../utils/app-error'

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Ruta no encontrada: ${req.method} ${req.path}`))
}

function normalize(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (error instanceof ZodError) {
    return new ValidationError('Datos inválidos', formatZodIssues(error))
  }

  const mongoOrParserError = error as {
    type?: string
    code?: number
    keyValue?: Record<string, unknown>
  }
  if (mongoOrParserError?.type === 'entity.parse.failed')
    return new ValidationError('JSON inválido')
  if (mongoOrParserError?.code === 11000) {
    return new ConflictError(
      `Ya existe un registro con: ${Object.keys(mongoOrParserError.keyValue ?? {}).join(', ')}`,
    )
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Error interno del servidor')
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const appError = normalize(error)

  if (appError.status >= 500) res.err = error

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details && { details: appError.details }),
    },
  })
}
