import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Percent, SlidersHorizontal, UsersRound } from 'lucide-react'
import type { Permission } from '@masarat/shared/permissions'
import type { GovtSearchInput } from '@masarat/shared/billing'
import TeamPanel from '@masarat/ui/components/members/TeamPanel'
import SectionNav from '@masarat/ui/components/ui/SectionNav'
import { useCan } from '@masarat/ui/lib/account'
import ErrorBoundary from '@masarat/ui/components/ErrorBoundary'
import { useGovtReference } from '@masarat/ui/lib/queries'
import TripDetails from '@masarat/ui/components/trips/TripDetails'
import GovtDashboard from './GovtDashboard'
import GovtSearch from './GovtSearch'
import GovtSearchBar from './GovtSearchBar'
import SettingsPanel from './SettingsPanel'
import TaxSettings from './TaxSettings'
import { api } from '@masarat/api-client'

type Section = 'overview' | 'taxes' | 'settings' | 'users'

// Each section, and what the user's role needs to see it
const SECTIONS: { id: Section; needs: Permission; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', needs: 'govt.dashboard', icon: LayoutDashboard },
  { id: 'taxes', needs: 'govt.charges', icon: Percent },
  { id: 'settings', needs: 'govt.settings', icon: SlidersHorizontal },
  { id: 'users', needs: 'govt.users', icon: UsersRound }
]

const SECTION_LABELS: Record<Section, string> = {
  overview: 'govt.overview',
  taxes: 'govt.taxes.tab',
  settings: 'govt.settings.tab',
  users: 'members.tab'
}

// Government home: the collection overview, and for admins the taxes and fees and the government
// accounts; a search across every company's trips, and a read-only view of any trip
function GovtWorkspace(): React.JSX.Element {
  const { t } = useTranslation()
  const can = useCan()
  const sections = SECTIONS.filter((s) => can(s.needs))
  const [section, setSection] = useState<Section>(sections[0]?.id ?? 'overview')
  // Cached (lib/queries.ts), shared with the dashboard
  const reference = useGovtReference().data ?? null
  const [search, setSearch] = useState<GovtSearchInput | null>(null)
  const [openTrip, setOpenTrip] = useState<number | null>(null)

  return (
    <div className="flex flex-1 flex-col">
      <SectionNav
        label={t('govt.sections')}
        sections={sections.map(({ id, icon }) => ({
          id,
          label: t(SECTION_LABELS[id]),
          icon
        }))}
        value={section}
        onChange={(next) => {
          setSection(next)
          setSearch(null)
          setOpenTrip(null)
        }}
      />
      {can('govt.search') && (
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
      )}

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
            <GovtSearch
              key={JSON.stringify(search)}
              input={search}
              cities={reference?.cities ?? []}
              onOpenTrip={setOpenTrip}
            />
          </div>
        )}
        <div hidden={openTrip !== null || search !== null}>
          {/* A section that fails to draw shows an error in its place */}
          <ErrorBoundary key={section}>
            {section === 'overview' ? (
              <GovtDashboard onOpenTrip={setOpenTrip} />
            ) : section === 'taxes' ? (
              <TaxSettings />
            ) : section === 'settings' ? (
              <SettingsPanel />
            ) : (
              <TeamPanel side="govt" members={api.govt.users} />
            )}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}

export default GovtWorkspace
