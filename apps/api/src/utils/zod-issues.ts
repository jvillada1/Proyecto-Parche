import type { ZodError } from 'zod'

export function formatZodIssues(error: ZodError, prefix?: string) {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path].filter((segment) => segment !== undefined).join('.'),
    message: issue.message,
  }))
}
