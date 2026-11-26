// Request validation at the boundary: each route declares the schema of its body or query
// (@masarat/shared/schemas) and reads the checked value with c.req.valid(...). A request that
// doesn't match answers `invalid_request` (or the route's own code) with 400 before any service
// runs; unknown fields are dropped. The same declarations feed the OpenAPI document (openapi.ts).
import type { MiddlewareHandler } from 'hono'
import { describeRoute, validator } from 'hono-openapi'
import type { ZodType } from 'zod'
import { log } from '../log'

type Target = 'json' | 'query' | 'form'

// The validators' return types are Hono's typed middleware (they carry the parsed input to
// c.req.valid), which only inference can spell out
/* eslint-disable @typescript-eslint/explicit-function-return-type */

function check<T extends Target, S extends ZodType>(target: T, schema: S, error: string) {
  return validator(target, schema, (result, c) => {
    if (!result.success) {
      log.debug('Request refused by its schema', {
        target,
        issues: result.error.map((issue) => ({
          path: issue.path?.map((p) => (typeof p === 'object' ? p.key : p)).join('.'),
          message: issue.message
        }))
      })
      return c.json({ ok: false, error }, 400)
    }
    return undefined
  })
}

// The JSON body
export const body = <S extends ZodType>(schema: S, error = 'invalid_request') =>
  check('json', schema, error)

// The query string
export const query = <S extends ZodType>(schema: S, error = 'invalid_request') =>
  check('query', schema, error)

// A multipart form
export const form = <S extends ZodType>(schema: S, error = 'invalid_request') =>
  check('form', schema, error)

/* eslint-enable @typescript-eslint/explicit-function-return-type */

// What the route does, for the OpenAPI document
export const doc = (tag: string, summary: string, description?: string): MiddlewareHandler =>
  describeRoute({ tags: [tag], summary, description })
