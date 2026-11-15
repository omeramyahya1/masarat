import { useState } from 'react'
import UpdateNotification from './components/UpdateNotification'

type PanelType = 'government' | 'fleet'

function App(): React.JSX.Element {
  const [activePanel, setActivePanel] = useState<PanelType>('government')

  return (
    <>
      {/* Top Menu Bar Navigation */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-icon">M</div>
          <div className="brand-info">
            <div className="brand-title">
              Masarat MVP
              <span className="brand-badge">Sudan Transport</span>
            </div>
            <div className="brand-tagline">Electronic Manifest & Tax Collection System</div>
          </div>
        </div>

        {/* Workspace Switcher */}
        <div className="view-switcher" role="tablist" aria-label="Workspace Switcher">
          <button
            type="button"
            role="tab"
            aria-selected={activePanel === 'fleet'}
            className={`toggle-btn ${activePanel === 'fleet' ? 'active' : ''}`}
            onClick={() => setActivePanel('fleet')}
          >
            <span className="toggle-icon">🚚</span>
            <span>Fleet Owner Panel</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activePanel === 'government'}
            className={`toggle-btn ${activePanel === 'government' ? 'active' : ''}`}
            onClick={() => setActivePanel('government')}
          >
            <span className="toggle-icon">🏛️</span>
            <span>Government Panel</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <main className="workspace-container">
        {activePanel === 'government' ? (
          <section className="panel-view" key="government">
            <div className="portal-card">
              <div className="portal-avatar govt">🏛️</div>
              <span className="portal-tag govt">Ministry & Regulatory Authorities</span>
              <h1 className="portal-title">Welcome to Government Portal</h1>
              <p className="portal-desc">
                Centralized monitoring for freight transport, real-time tax manifest audits,
                and national transport ledger oversight across Sudan states.
              </p>
              <div className="portal-pills">
                <span className="pill-item">📊 Master Tax Ledger</span>
                <span className="pill-item">🔍 Audit & Manifest Verification</span>
                <span className="pill-item">📈 Real-time Analytics</span>
              </div>
            </div>
          </section>
        ) : (
          <section className="panel-view" key="fleet">
            <div className="portal-card">
              <div className="portal-avatar fleet">🚚</div>
              <span className="portal-tag fleet">Commercial Carrier Portal</span>
              <h1 className="portal-title">Welcome to Fleet Owner Portal</h1>
              <p className="portal-desc">
                Manage commercial trucks and tankers, issue digital waybill manifests,
                and settle automated transport taxes via the Esali payment gateway.
              </p>
              <div className="portal-pills">
                <span className="pill-item">🚛 Vehicle Management</span>
                <span className="pill-item">📋 Trip Creation & Tax Engine</span>
                <span className="pill-item">💳 Esali Bill Clearance</span>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Updater notification banner */}
      <UpdateNotification />
    </>
  )
}

export default App
