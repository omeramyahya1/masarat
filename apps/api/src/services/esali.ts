import { randomInt } from 'crypto'
import { eq } from 'drizzle-orm'
import { esaliSimBills, getDb, payments } from '../db'

// E-Sali (Ministry of Finance) bill gateway. The MVP talks to a simulation; a real HTTP client
// implementing the same interface replaces it once the API is available.
export interface EsaliBillStatus {
  status: 'pending' | 'paid'
  paidAt?: Date
  paymentRef?: string
}

export interface EsaliGateway {
  createBill(input: { amount: number }): { billId: string }
  getBillStatus(billId: string): EsaliBillStatus | null
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0')

// 13 random digits (randomInt's range is capped below 2^48, so build it from two parts)
const randomDigits = (): string =>
  pad(randomInt(0, 10_000_000), 7) + pad(randomInt(0, 1_000_000), 6)

// yyyy mm 0dd + 13 digits, from the local date the bill is issued
export function newBillId(now = new Date(), digits = randomDigits()): string {
  return `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 3)}${digits}`
}

class MockEsaliGateway implements EsaliGateway {
  createBill({ amount }: { amount: number }): { billId: string } {
    const db = getDb()
    for (;;) {
      const billId = newBillId()
      const taken = db
        .select({ id: esaliSimBills.id })
        .from(esaliSimBills)
        .where(eq(esaliSimBills.billId, billId))
        .get()
      if (taken) continue
      db.insert(esaliSimBills).values({ billId, amount }).run()
      return { billId }
    }
  }

  getBillStatus(billId: string): EsaliBillStatus | null {
    const bill = getDb().select().from(esaliSimBills).where(eq(esaliSimBills.billId, billId)).get()
    if (!bill) return null
    if (bill.status !== 'paid') return { status: 'pending' }
    return {
      status: 'paid',
      paidAt: bill.paidAt ?? undefined,
      paymentRef: bill.paymentRef ?? undefined
    }
  }

  // Demo only: stands in for the user paying the bill from a mobile banking app
  simulatePayment(billId: string): boolean {
    const db = getDb()
    const bill = db.select().from(esaliSimBills).where(eq(esaliSimBills.billId, billId)).get()
    if (!bill) return false
    if (bill.status === 'paid') return true
    let paymentRef: string
    do {
      paymentRef = `BNK${pad(randomInt(0, 1_000_000_000), 9)}`
    } while (
      db
        .select({ id: esaliSimBills.id })
        .from(esaliSimBills)
        .where(eq(esaliSimBills.paymentRef, paymentRef))
        .get() ||
      db.select({ id: payments.id }).from(payments).where(eq(payments.paymentRef, paymentRef)).get()
    )
    db.update(esaliSimBills)
      .set({ status: 'paid', paymentRef, paidAt: new Date() })
      .where(eq(esaliSimBills.billId, billId))
      .run()
    return true
  }
}

export const esali = new MockEsaliGateway()
