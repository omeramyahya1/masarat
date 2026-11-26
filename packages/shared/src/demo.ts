// Demo companies and accounts, created by the demo data seeder (apps/api/src/services/demoData.ts)
// in demo mode, and listed on the login page so the presenter can sign in with one click. Static
// on purpose: this is a demo.
import type { BuiltinRoleKey, GovtRoleKey } from './permissions'

export interface DemoAccount {
  username: string
  password: string
  fullName: string
  // Sudanese mobile number, as stored
  phone: string
}

export interface DemoCompany {
  name: string
  // The carrier details printed on its manifests
  address: string
  tin: string
  admin: DemoAccount
  accountant: DemoAccount
  // Each branch has one clerk. `city` is the city's English name as seeded.
  branches: readonly { name: string; city: string; clerk: DemoAccount }[]
}

// Everyone in a company signs in with the company's password
const member = (
  username: string,
  password: string,
  fullName: string,
  phone: string
): DemoAccount => ({ username, password, fullName, phone })

export const DEMO_COMPANIES: readonly DemoCompany[] = [
  {
    name: 'Nile Transport Co.',
    address: 'الخرطوم بحري، المنطقة الصناعية، شارع المعونة',
    tin: '300145872',
    admin: member('nile.transport', 'nile2026', 'Ahmed Osman', '+249912301001'),
    accountant: member('nile.accountant', 'nile2026', 'Salma Idris', '+249912301011'),
    branches: [
      {
        name: 'مكتب بحري',
        city: 'Bahri',
        clerk: member('nile.clerk1', 'nile2026', 'Khalid Yousif', '+249912301021')
      },
      {
        name: 'مكتب ميناء بورتسودان',
        city: 'Port Sudan',
        clerk: member('nile.clerk2', 'nile2026', 'Hassan Babiker', '+249912301022')
      },
      {
        name: 'مكتب عطبرة',
        city: 'Atbara',
        clerk: member('nile.clerk3', 'nile2026', 'Mona Abdalla', '+249912301023')
      }
    ]
  },
  {
    name: 'Red Sea Logistics',
    address: 'بورتسودان، حي الميناء، مربع 4',
    tin: '300267419',
    admin: member('redsea.logistics', 'redsea2026', 'Fatima Hassan', '+249912301002'),
    accountant: member('redsea.accountant', 'redsea2026', 'Omer Saeed', '+249912301012'),
    branches: [
      {
        name: 'مكتب الميناء الجنوبي',
        city: 'Port Sudan',
        clerk: member('redsea.clerk1', 'redsea2026', 'Amir Hamid', '+249912301031')
      },
      {
        name: 'مكتب كسلا',
        city: 'Kassala',
        clerk: member('redsea.clerk2', 'redsea2026', 'Nadia Musa', '+249912301032')
      }
    ]
  },
  {
    name: 'Kordofan Haulage',
    address: 'الأبيض، السوق الكبير، شارع النيل',
    tin: '300389036',
    admin: member('kordofan.haulage', 'kordofan2026', 'Mohamed Ali', '+249912301003'),
    accountant: member('kordofan.accountant', 'kordofan2026', 'Huda Adam', '+249912301013'),
    branches: [
      {
        name: 'مكتب الأبيض',
        city: 'El Obeid',
        clerk: member('kordofan.clerk1', 'kordofan2026', 'Ibrahim Eisa', '+249912301041')
      },
      {
        name: 'مكتب نيالا',
        city: 'Nyala',
        clerk: member('kordofan.clerk2', 'kordofan2026', 'Yasir Bakheet', '+249912301042')
      },
      {
        name: 'مكتب كوستي',
        city: 'Kosti',
        clerk: member('kordofan.clerk3', 'kordofan2026', 'Rasha Gamal', '+249912301043')
      }
    ]
  },
  {
    name: 'Gezira Freight',
    address: 'ود مدني، المنطقة الصناعية، شارع الجمهورية',
    tin: '300412658',
    admin: member('gezira.freight', 'gezira2026', 'Amna Ibrahim', '+249912301004'),
    accountant: member('gezira.accountant', 'gezira2026', 'Tariq Osman', '+249912301014'),
    branches: [
      {
        name: 'مكتب ود مدني',
        city: 'Wad Madani',
        clerk: member('gezira.clerk1', 'gezira2026', 'Siham Ali', '+249912301051')
      },
      {
        name: 'مكتب القضارف',
        city: 'Gedaref',
        clerk: member('gezira.clerk2', 'gezira2026', 'Adil Hamza', '+249912301052')
      }
    ]
  }
]

// Kept across "Regenerate demo data", so the presenter who runs it stays signed in
export const DEMO_GOVT_ACCOUNTS: readonly (DemoAccount & { role: GovtRoleKey })[] = [
    {
      ...member('ministry.demo', 'govt2026', 'Tax Collection Officer', '+249912301000'),
      role: 'govt_admin'
    },
    {
      ...member('ministry.supervisor', 'govt2026', 'Review Supervisor', '+249912301008'),
      role: 'govt_supervisor'
    },
    {
      ...member('ministry.agent', 'govt2026', 'Revenue Analyst', '+249912301009'),
      role: 'govt_agent'
    }
  ]

// What the login page lists in demo mode: every company admin, one company's clerk and
// accountant (to show what a branch-scoped role sees), and the three government roles. The other
// clerks sign in the same way (see DEMO_COMPANIES).
export interface DemoLogin extends DemoAccount {
  role: BuiltinRoleKey
  // The company's name; null for the government
  companyName: string | null
}

export const DEMO_ACCOUNTS: readonly DemoLogin[] = [
  ...DEMO_COMPANIES.map((c) => ({
    ...c.admin,
    role: 'company_admin' as const,
    companyName: c.name
  })),
  {
    ...DEMO_COMPANIES[0].branches[0].clerk,
    role: 'clerk',
    companyName: DEMO_COMPANIES[0].name
  },
  { ...DEMO_COMPANIES[0].accountant, role: 'accountant', companyName: DEMO_COMPANIES[0].name },
  ...DEMO_GOVT_ACCOUNTS.map((a) => ({ ...a, companyName: null }))
]
