import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bus, IdCard, KeyRound, Route, Store, Truck, UserCog, UsersRound } from 'lucide-react'
import type { AuthUser } from '@masarat/shared/auth'
import type { Permission } from '@masarat/shared/permissions'
import TeamPanel from '@masarat/ui/components/members/TeamPanel'
import SectionNav from '@masarat/ui/components/ui/SectionNav'
import { useCan } from '@masarat/ui/lib/account'
import ErrorBoundary from '@masarat/ui/components/ErrorBoundary'
import { useBranches, useReference } from '@masarat/ui/lib/queries'
import { api } from '@masarat/api-client'
import BranchesPanel from './company/BranchesPanel'
import RolesPanel from './company/RolesPanel'
import TemplatesPanel from './company/TemplatesPanel'
import DriversPanel from './fleet/DriversPanel'
import VehiclesPanel from './fleet/VehiclesPanel'
import ProfilePanel from './owner/ProfilePanel'
import TripsPanel from './trips/TripsPanel'

type Section =
  'trips' | 'templates' | 'vehicles' | 'drivers' | 'team' | 'branches' | 'roles' | 'profile'

// Each section, and what the member's role needs to see it (the profile is everyone's)
const SECTIONS: { id: Section; needs: Permission | null }[] = [
  { id: 'trips', needs: 'trips.view' },
  { id: 'templates', needs: 'templates.manage' },
  { id: 'vehicles', needs: 'fleet.view' },
  { id: 'drivers', needs: 'drivers.view' },
  { id: 'team', needs: 'members.manage' },
  { id: 'branches', needs: 'branches.manage' },
  { id: 'roles', needs: 'roles.manage' },
  { id: 'profile', needs: null }
]

const ICONS = {
  trips: Route,
  templates: Bus,
  vehicles: Truck,
  drivers: UsersRound,
  team: UserCog,
  branches: Store,
  roles: KeyRound,
  profile: IdCard
}

// The company's home: its trips, vehicles and drivers, and (for its admins) its team, branches and
// roles, each section shown only to the roles that may use it
function OwnerWorkspace({
  user,
  onUserChange
}: {
  user: AuthUser
  onUserChange: (user: AuthUser) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const can = useCan()
  const sections = SECTIONS.filter((s) => s.needs === null || can(s.needs))
  const [section, setSection] = useState<Section>(sections[0].id)
  // Cached and shared with the sections (lib/queries.ts); a branch saved in Branches refreshes them
  const cities = useReference().data?.cities ?? []
  const branches = useBranches().data ?? []

  return (
    <div className="flex flex-1 flex-col">
      <SectionNav
        label={t('owner.sections')}
        sections={sections.map(({ id }) => ({ id, label: t(`owner.${id}`), icon: ICONS[id] }))}
        value={section}
        onChange={setSection}
      />

      {/* A section that fails to draw shows an error in its place; another section starts afresh */}
      <div className="mx-auto w-full max-w-6xl flex-1 p-6">
        <ErrorBoundary key={section}>
          {section === 'vehicles' ? (
            <VehiclesPanel />
          ) : section === 'drivers' ? (
            <DriversPanel />
          ) : section === 'team' ? (
            <TeamPanel side="company" members={api.company.members} branches={branches} />
          ) : section === 'branches' ? (
            <BranchesPanel cities={cities} onChanged={() => undefined} />
          ) : section === 'templates' ? (
            <TemplatesPanel branches={branches} />
          ) : section === 'roles' ? (
            <RolesPanel />
          ) : section === 'profile' ? (
            <ProfilePanel user={user} onUserChange={onUserChange} />
          ) : (
            <TripsPanel
              onGoToVehicles={() => setSection('vehicles')}
              onGoToCompany={() => setSection('profile')}
            />
          )}
        </ErrorBoundary>
      </div>
    </div>
  )
}

export default OwnerWorkspace
