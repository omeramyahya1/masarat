// Demo accounts, created by the demo data seeder (src/main/services/demoData.ts) and listed on the
// login pages so the presenter can sign in with one click. Static on purpose: this is a demo.
import type { UserRole } from './auth'

export interface DemoAccount {
  role: UserRole
  username: string
  password: string
  fullName: string
  companyName: string | null
}

export const DEMO_OWNER_ACCOUNTS: readonly DemoAccount[] = [
  {
    role: 'owner',
    username: 'nile.transport',
    password: 'nile2026',
    fullName: 'Ahmed Osman',
    companyName: 'Nile Transport Co.'
  },
  {
    role: 'owner',
    username: 'redsea.logistics',
    password: 'redsea2026',
    fullName: 'Fatima Hassan',
    companyName: 'Red Sea Logistics'
  },
  {
    role: 'owner',
    username: 'kordofan.haulage',
    password: 'kordofan2026',
    fullName: 'Mohamed Ali',
    companyName: 'Kordofan Haulage'
  },
  {
    role: 'owner',
    username: 'gezira.freight',
    password: 'gezira2026',
    fullName: 'Amna Ibrahim',
    companyName: 'Gezira Freight'
  }
]

// Kept across "Regenerate demo data", so the presenter who runs it stays signed in
export const DEMO_GOVT_ACCOUNT: DemoAccount = {
  role: 'govt',
  username: 'ministry.demo',
  password: 'govt2026',
  fullName: 'Tax Collection Officer',
  companyName: null
}

export const demoAccountsFor = (role: UserRole): readonly DemoAccount[] =>
  role === 'owner' ? DEMO_OWNER_ACCOUNTS : [DEMO_GOVT_ACCOUNT]
