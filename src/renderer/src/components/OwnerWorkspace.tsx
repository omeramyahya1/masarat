import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Truck } from 'lucide-react'
import VehiclesPanel from './fleet/VehiclesPanel'
import TripsPanel from './trips/TripsPanel'
import SectionNav from './ui/SectionNav'

type Section = 'vehicles' | 'trips'

// Fleet owner home: manage vehicles and register trips
function OwnerWorkspace(): React.JSX.Element {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>('vehicles')

  return (
    <div className="flex flex-1 flex-col">
      <SectionNav
        label={t('owner.sections')}
        sections={[
          { id: 'vehicles', label: t('owner.vehicles'), icon: Truck },
          { id: 'trips', label: t('owner.trips'), icon: Route }
        ]}
        value={section}
        onChange={setSection}
      />

      <div className="mx-auto w-full max-w-6xl flex-1 p-6">
        {section === 'vehicles' ? (
          <VehiclesPanel />
        ) : (
          <TripsPanel onGoToVehicles={() => setSection('vehicles')} />
        )}
      </div>
    </div>
  )
}

export default OwnerWorkspace
