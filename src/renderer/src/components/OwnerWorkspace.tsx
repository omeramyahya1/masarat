import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Truck, type LucideIcon } from 'lucide-react'
import VehiclesPanel from './fleet/VehiclesPanel'
import TripsPanel from './trips/TripsPanel'

type Section = 'vehicles' | 'trips'

const SECTIONS: readonly { id: Section; icon: LucideIcon }[] = [
  { id: 'vehicles', icon: Truck },
  { id: 'trips', icon: Route }
]

// Fleet owner home: manage vehicles and register trips
function OwnerWorkspace(): React.JSX.Element {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>('vehicles')

  return (
    <div className="flex flex-1 flex-col">
      <nav
        className="flex gap-6 border-b border-stone-200 bg-white px-6"
        aria-label={t('owner.sections')}
      >
        {SECTIONS.map(({ id, icon: Icon }) => {
          const active = id === section
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? 'page' : undefined}
              className={`-mb-px flex items-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors ${
                active
                  ? 'border-brand-700 text-brand-800'
                  : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}
              onClick={() => setSection(id)}
            >
              <Icon size={16} />
              {t(`owner.${id}`)}
            </button>
          )
        })}
      </nav>

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
