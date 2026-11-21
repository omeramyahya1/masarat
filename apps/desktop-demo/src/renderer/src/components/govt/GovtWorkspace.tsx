import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Percent } from 'lucide-react'
import type { GovtSearchInput } from '../../../../shared/billing'
import type { TripReferenceData } from '../../../../shared/fleet'
import SectionNav from '../ui/SectionNav'
import TripDetails from '../trips/TripDetails'
import GovtDashboard from './GovtDashboard'
import GovtSearch from './GovtSearch'
import GovtSearchBar from './GovtSearchBar'
import TaxSettings from './TaxSettings'

type Section = 'overview' | 'taxes'

// Government home: the collection overview and the tax percentages, a search across every
// owner's trips, and a read-only view of any trip
function GovtWorkspace(): React.JSX.Element {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>('overview')
  const [reference, setReference] = useState<TripReferenceData | null>(null)
  const [search, setSearch] = useState<GovtSearchInput | null>(null)
  const [openTrip, setOpenTrip] = useState<number | null>(null)

  useEffect(() => {
    window.api.govt
      .getReferenceData()
      .then((result) => result.ok && setReference(result.data))
      .catch(() => undefined)
  }, [])

  return (
    <div className="flex flex-1 flex-col">
      <SectionNav
        label={t('govt.sections')}
        sections={[
          { id: 'overview', label: t('govt.overview'), icon: LayoutDashboard },
          { id: 'taxes', label: t('govt.taxes.tab'), icon: Percent }
        ]}
        value={section}
        onChange={(next) => {
          setSection(next)
          setSearch(null)
          setOpenTrip(null)
        }}
      />
      <GovtSearchBar
        cities={reference?.cities ?? []}
        active={search !== null}
        onSearch={(input) => {
          setOpenTrip(null)
          setSearch(input)
        }}
        onClear={() => {
          setOpenTrip(null)
          setSearch(null)
        }}
      />

      {/* The dashboard and the search results stay mounted (hidden) behind an open trip, so
          going back keeps their filters and results */}
      <div className="mx-auto w-full max-w-6xl flex-1 p-6">
        {openTrip !== null && reference && (
          <TripDetails
            key={openTrip}
            tripId={openTrip}
            reference={reference}
            readOnly
            onBack={() => setOpenTrip(null)}
          />
        )}
        {search && (
          <div hidden={openTrip !== null}>
            <GovtSearch input={search} cities={reference?.cities ?? []} onOpenTrip={setOpenTrip} />
          </div>
        )}
        <div hidden={openTrip !== null || search !== null}>
          {section === 'overview' ? <GovtDashboard onOpenTrip={setOpenTrip} /> : <TaxSettings />}
        </div>
      </div>
    </div>
  )
}

export default GovtWorkspace
