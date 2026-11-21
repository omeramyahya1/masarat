import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IdCard, Route, Truck, UsersRound } from 'lucide-react'
import type { AuthUser } from '../../../shared/auth'
import DriversPanel from './fleet/DriversPanel'
import VehiclesPanel from './fleet/VehiclesPanel'
import ProfilePanel from './owner/ProfilePanel'
import TripsPanel from './trips/TripsPanel'
import SectionNav from './ui/SectionNav'

type Section = 'vehicles' | 'drivers' | 'trips' | 'profile'

// Fleet owner home: manage vehicles and drivers, register trips and keep the company profile
function OwnerWorkspace({
  user,
  onUserChange
}: {
  user: AuthUser
  onUserChange: (user: AuthUser) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>('vehicles')

  return (
    <div className="flex flex-1 flex-col">
      <SectionNav
        label={t('owner.sections')}
        sections={[
          { id: 'vehicles', label: t('owner.vehicles'), icon: Truck },
          { id: 'drivers', label: t('owner.drivers'), icon: UsersRound },
          { id: 'trips', label: t('owner.trips'), icon: Route },
          { id: 'profile', label: t('owner.profile'), icon: IdCard }
        ]}
        value={section}
        onChange={setSection}
      />

      <div className="mx-auto w-full max-w-6xl flex-1 p-6">
        {section === 'vehicles' ? (
          <VehiclesPanel />
        ) : section === 'drivers' ? (
          <DriversPanel />
        ) : section === 'profile' ? (
          <ProfilePanel user={user} onUserChange={onUserChange} />
        ) : (
          <TripsPanel
            owner={user}
            onGoToVehicles={() => setSection('vehicles')}
            onGoToProfile={() => setSection('profile')}
          />
        )}
      </div>
    </div>
  )
}

export default OwnerWorkspace
