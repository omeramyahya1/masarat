// Public: what the QR code on the receipt and manifest opens. No session needed.
import { Hono } from 'hono'
import { verifyManifest } from '../services/verify'
import { send, type AppEnv } from '../http/context'
import { rateLimit } from '../http/rateLimit'
import { doc } from '../http/validate'

// Generous for officers scanning at a checkpoint, too slow for guessing tokens
const VERIFY_LIMIT = rateLimit(60, 60 * 1000)

export const verifyRoutes = new Hono<AppEnv>().get(
  '/:token',
  doc('Public', 'Verify a manifest from its QR code'),
  VERIFY_LIMIT,
  async (c) => send(c, await verifyManifest(c.req.param('token')))
)
