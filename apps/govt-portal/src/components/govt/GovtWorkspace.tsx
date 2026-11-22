import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Percent, UsersRound } from 'lucide-react'
import type { AuthUser } from '@masarat/shared/auth'
import type { GovtSearchInput } from '@masarat/shared/billing'
import type { TripReferenceData } from '@masarat/shared/fleet'
import SectionNav from '@masarat/ui/components/ui/SectionNav'
import TripDetails from '@masarat/ui/components/trips/TripDetails'
import GovtDashboard from './GovtDashboard'
import GovtSearch from './GovtSearch'
import GovtSearchBar from './GovtSearchBar'
import TaxSettings from './TaxSettings'
import UsersPanel from './users/UsersPanel'
import { api } from '@masarat/api-client'

type Section = 'overview' | 'taxes' | 'users'

// Government home: the collection overview, the tax percentages and (for admins) the government
// accounts, a search across every owner's trips, and a read-only view of any trip
function GovtWorkspace({ user }: { user: AuthUser }): React.JSX.Element {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>('overview')
  const [reference, setReference] = useState<TripReferenceData | null>(null)
  const [search, setSearch] = useState<GovtSearchInput | null>(null)
  const [openTrip, setOpenTrip] = useState<number | null>(null)

  useEffect(() => {
    api.govt
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
          { id: 'taxes', label: t('govt.taxes.tab'), icon: Percent },
          ...(user.isAdmin
            ? [{ id: 'users' as const, label: t('govt.users.tab'), icon: UsersRound }]
            : [])
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
            <GovtSearch
              key={JSON.stringify(search)}
              input={search}
              cities={reference?.cities ?? []}
              onOpenTrip={setOpenTrip}
            />
          </div>
        )}
        <div hidden={openTrip !== null || search !== null}>
          {section === 'overview' ? (
            <GovtDashboard onOpenTrip={setOpenTrip} />
          ) : section === 'taxes' ? (
            <TaxSettings />
          ) : (
            <UsersPanel currentUserId={user.id} />
          )}
        </div>
      </div>
    </div>
  )
}

export default GovtWorkspace
