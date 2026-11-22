// The public verify page's API: what a scanned QR code opens
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { certificates, getDb } from '../src/db'
import { ensureDemoData } from '../src/services/demoData'
import { verifyManifest } from '../src/services/verify'
import { verifyUrl } from '@masarat/shared/billing'
import { browser, resetData } from './helpers'

let token: string
let validUntil: Date

beforeAll(async () => {
  await resetData()
  await ensureDemoData()
  const [certificate] = await getDb().select().from(certificates).limit(1)
  token = certificate.qrToken
  validUntil = certificate.validUntil
}, 60_000)

describe('verify', () => {
  test('the QR holds the site link with the token', () => {
    expect(verifyUrl('https://masarat.com/', token)).toBe(`https://masarat.com/verify/${token}`)
  })

  test('anyone can check a manifest, signed out, and sees no personal details', async () => {
    const result = await browser().call('GET', `/verify/${token}`)
    expect(result.status).toBe(200)
    const data = result.body.data
    expect(data.manifestNo).toMatch(/^MNF-/)
    expect(data.certificateNo).toMatch(/^MSR-/)
    expect(Object.keys(data).sort()).toEqual(
      [
        'amountPaid',
        'carrierName',
        'certificateNo',
        'checkedAt',
        'destination',
        'issuedAt',
        'manifestNo',
        'origin',
        'plateNumber',
        'status',
        'tripDate',
        'tripKind',
        'validUntil'
      ].sort()
    )
  })

  test('valid until the end of its date, expired after', async () => {
    const before = await verifyManifest(token, new Date(validUntil.getTime() - 1000))
    const after = await verifyManifest(token, new Date(validUntil.getTime() + 1000))
    expect(before.ok && before.data.status).toBe('valid')
    expect(after.ok && after.data.status).toBe('expired')
  })

  test('unknown or malformed tokens are not found', async () => {
    expect((await browser().call('GET', `/verify/${'0'.repeat(32)}`)).status).toBe(404)
    expect((await browser().call('GET', '/verify/not-a-token')).status).toBe(404)
  })

  test('a token stops working if its certificate is gone', async () => {
    const [other] = await getDb().select().from(certificates).limit(1).offset(1)
    await getDb()
      .update(certificates)
      .set({ qrToken: 'f'.repeat(32) })
      .where(eq(certificates.id, other.id))
    expect((await browser().call('GET', `/verify/${other.qrToken}`)).status).toBe(404)
  })

  test('too many checks from one address are slowed down', async () => {
    const b = browser()
    let last = 0
    for (let i = 0; i < 70; i++) last = (await b.call('GET', `/verify/${token}`)).status
    expect(last).toBe(429)
  })
})
