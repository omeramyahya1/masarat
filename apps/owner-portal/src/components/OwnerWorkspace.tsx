import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IdCard, KeyRound, Route, Store, Truck, UserCog, UsersRound } from 'lucide-react'
import type { AuthUser } from '@masarat/shared/auth'
import type { TripReferenceData } from '@masarat/shared/fleet'
import type { BranchRecord } from '@masarat/shared/members'
import type { Permission } from '@masarat/shared/permissions'
import TeamPanel from '@masarat/ui/components/members/TeamPanel'
import SectionNav from '@masarat/ui/components/ui/SectionNav'
import { useCan } from '@masarat/ui/lib/account'
import { api } from '@masarat/api-client'
import BranchesPanel from './company/BranchesPanel'
import RolesPanel from './company/RolesPanel'
import DriversPanel from './fleet/DriversPanel'
import VehiclesPanel from './fleet/VehiclesPanel'
import ProfilePanel from './owner/ProfilePanel'
import TripsPanel from './trips/TripsPanel'

type Section = 'trips' | 'vehicles' | 'drivers' | 'team' | 'branches' | 'roles' | 'profile'

// Each section, and what the member's role needs to see it (the profile is everyone's)
const SECTIONS: { id: Section; needs: Permission | null }[] = [
  { id: 'trips', needs: 'trips.view' },
  { id: 'vehicles', needs: 'fleet.view' },
  { id: 'drivers', needs: 'drivers.view' },
  { id: 'team', needs: 'members.manage' },
  { id: 'branches', needs: 'branches.manage' },
  { id: 'roles', needs: 'roles.manage' },
  { id: 'profile', needs: null }
]

const ICONS = {
  trips: Route,
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
  const [cities, setCities] = useState<TripReferenceData['cities']>([])
  const [branches, setBranches] = useState<BranchRecord[]>([])

  const loadBranches = useCallback(async (): Promise<void> => {
    const result = await api.company.branches()
    if (result.ok) setBranches(result.data)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void loadBranches()
    api.trips
      .getReferenceData()
      .then((result) => result.ok && setCities(result.data.cities))
      .catch(() => undefined)
  }, [loadBranches])

  return (
    <div className="flex flex-1 flex-col">
      <SectionNav
        label={t('owner.sections')}
        sections={sections.map(({ id }) => ({ id, label: t(`owner.${id}`), icon: ICONS[id] }))}
        value={section}
        onChange={setSection}
      />

      <div className="mx-auto w-full max-w-6xl flex-1 p-6">
        {section === 'vehicles' ? (
          <VehiclesPanel />
        ) : section === 'drivers' ? (
          <DriversPanel />
        ) : section === 'team' ? (
          <TeamPanel side="company" members={api.company.members} branches={branches} />
        ) : section === 'branches' ? (
          <BranchesPanel cities={cities} onChanged={() => void loadBranches()} />
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
      </div>
    </div>
  )
}

export default OwnerWorkspace
