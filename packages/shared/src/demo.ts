// Demo accounts, created by the demo data seeder (apps/api/src/services/demoData.ts) and listed on the
// login pages so the presenter can sign in with one click. Static on purpose: this is a demo.
import type { UserRole } from './auth'

export interface DemoAccount {
  role: UserRole
  username: string
  password: string
  fullName: string
  // Sudanese mobile number, as stored
  phone: string
  companyName: string | null
  // Fleet owners' carrier details
  address: string | null
  tin: string | null
}

export const DEMO_OWNER_ACCOUNTS: readonly DemoAccount[] = [
  {
    role: 'owner',
    username: 'nile.transport',
    password: 'nile2026',
    fullName: 'Ahmed Osman',
    phone: '+249912301001',
    companyName: 'Nile Transport Co.',
    address: 'الخرطوم بحري، المنطقة الصناعية، شارع المعونة',
    tin: '300145872'
  },
  {
    role: 'owner',
    username: 'redsea.logistics',
    password: 'redsea2026',
    fullName: 'Fatima Hassan',
    phone: '+249912301002',
    companyName: 'Red Sea Logistics',
    address: 'بورتسودان، حي الميناء، مربع 4',
    tin: '300267419'
  },
  {
    role: 'owner',
    username: 'kordofan.haulage',
    password: 'kordofan2026',
    fullName: 'Mohamed Ali',
    phone: '+249912301003',
    companyName: 'Kordofan Haulage',
    address: 'الأبيض، السوق الكبير، شارع النيل',
    tin: '300389036'
  },
  {
    role: 'owner',
    username: 'gezira.freight',
    password: 'gezira2026',
    fullName: 'Amna Ibrahim',
    phone: '+249912301004',
    companyName: 'Gezira Freight',
    address: 'ود مدني، المنطقة الصناعية، شارع الجمهورية',
    tin: '300412658'
  }
]

// Kept across "Regenerate demo data", so the presenter who runs it stays signed in
export const DEMO_GOVT_ACCOUNT: DemoAccount = {
  role: 'govt',
  username: 'ministry.demo',
  password: 'govt2026',
  fullName: 'Tax Collection Officer',
  phone: '+249912301000',
  companyName: null,
  address: null,
  tin: null
}

// Listed on the masarat.com login page when the API runs in demo mode. The government account is
// an admin, so the Users section can be shown.
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [...DEMO_OWNER_ACCOUNTS, DEMO_GOVT_ACCOUNT]
