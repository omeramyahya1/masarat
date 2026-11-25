// The whole national workload at once, each kind of user at its own arrival rate.
//   SCALE=1 is the target (20,000 trips a day); 0.25 and 0.5 are 5,000 and 10,000.
//   FLOWS=verify,govt runs only those. DURATION=5m by default (3h for a soak test).
//   k6 run -e SCALE=1 loadtest/k6/mixed.js
import { thresholds } from './lib.js'
export { booking, browse, govt, exportData, verify, login } from './flows.js'

const SCALE = Number(__ENV.SCALE || 1)
const DURATION = __ENV.DURATION || '5m'
const FLOWS = (__ENV.FLOWS || 'booking,browse,govt,exportData,verify').split(',')

// Per-second rates at SCALE=1 (see loadtest/README.md for where they come from), and how many
// VUs each needs at that rate (rate × the seconds an iteration takes, with room to spare)
const TARGET = {
  // 20,000 trips a day, 15% of them in the peak hour: 0.85 a second
  booking: { perMinute: 51, vusPerUnit: 0.6 },
  // 5,000 members online, a page view every ~35 s
  browse: { perMinute: 140 * 60, vusPerUnit: 0.02 },
  // ~300 government staff: 2 dashboard visits (dashboard, search, trip) a second
  govt: { perMinute: 120, vusPerUnit: 0.2 },
  // One Excel export a minute
  exportData: { perMinute: 1, vusPerUnit: 1 },
  // 100 checkpoint scans a second
  verify: { perMinute: 100 * 60, vusPerUnit: 0.01 },
  // The shift-start rush: 5,000 sign-ins in 15 minutes
  login: { perMinute: 6 * 60, vusPerUnit: 0.03 }
}

export const options = {
  // Keep each VU's session cookie across iterations (k6 clears it by default)
  noCookiesReset: true,
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds,
  scenarios: Object.fromEntries(
    FLOWS.map((flow) => {
      const { perMinute, vusPerUnit } = TARGET[flow]
      const rate = Math.max(1, Math.round(perMinute * SCALE))
      return [
        flow,
        {
          executor: 'constant-arrival-rate',
          exec: flow,
          rate,
          timeUnit: '1m',
          duration: DURATION,
          preAllocatedVUs: Math.max(2, Math.ceil(rate * vusPerUnit)),
          // Room for responses up to ~4× slower than expected, and no more: past that the server is
          // past its limit, and k6 drops the late iterations (a failure, see dropped_iterations in
          // lib.js) instead of piling up VUs until the machine runs out of memory
          maxVUs: Math.max(10, Math.ceil(rate * vusPerUnit * 4))
        }
      ]
    })
  )
}
