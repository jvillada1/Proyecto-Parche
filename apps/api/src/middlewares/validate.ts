import type { RequestHandler } from 'express'
import type { ZodType } from 'zod'
import { ValidationError } from '../utils/app-error'
import { formatZodIssues } from '../utils/zod-issues'

type RequestPart = 'body' | 'query' | 'params'
type ValidationSchemas = Partial<Record<RequestPart, ZodType>>

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const failedFields: ReturnType<typeof formatZodIssues> = []

    for (const part of ['body', 'query', 'params'] as const) {
      const schema = schemas[part]
      if (!schema) continue

      const result = schema.safeParse(req[part])
      if (!result.success) {
        failedFields.push(...formatZodIssues(result.error, part))
        continue
      }

      Object.defineProperty(req, part, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      })
    }

    if (failedFields.length > 0) return next(new ValidationError('Datos inválidos', failedFields))
    next()
  }
}
