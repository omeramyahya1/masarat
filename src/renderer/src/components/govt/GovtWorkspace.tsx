import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Percent } from 'lucide-react'
import SectionNav from '../ui/SectionNav'
import GovtDashboard from './GovtDashboard'
import TaxSettings from './TaxSettings'

type Section = 'overview' | 'taxes'

// Government home: the collection overview and the tax percentages
function GovtWorkspace(): React.JSX.Element {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>('overview')

  return (
    <div className="flex flex-1 flex-col">
      <SectionNav
        label={t('govt.sections')}
        sections={[
          { id: 'overview', label: t('govt.overview'), icon: LayoutDashboard },
          { id: 'taxes', label: t('govt.taxes.tab'), icon: Percent }
        ]}
        value={section}
        onChange={setSection}
      />

      <div className="mx-auto w-full max-w-6xl flex-1 p-6">
        {section === 'overview' ? <GovtDashboard /> : <TaxSettings />}
      </div>
    </div>
  )
}

export default GovtWorkspace
