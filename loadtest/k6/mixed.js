// The whole national workload at once, each kind of user at its own arrival rate.
//   SCALE=1 is the target (20,000 trips a day); 0.25 and 0.5 are 5,000 and 10,000.
//   FLOWS=verify,govtReview runs only those. DURATION=5m by default (3h for a soak test).
//   TRIPS_PER_DAY=2000 books at that volume instead (only the booking rate changes).
//   k6 run -e SCALE=1 loadtest/k6/mixed.js
import { signInAll, thresholds } from './lib.js'
export { booking, browse, govtDashboard, govtReview, exportData, verify, login } from './flows.js'

const SCALE = Number(__ENV.SCALE || 1)
const TRIPS_PER_DAY = Number(__ENV.TRIPS_PER_DAY || 20000)
const DURATION = __ENV.DURATION || '5m'
const FLOWS = (
  __ENV.FLOWS || 'booking,browse,govtDashboard,govtReview,exportData,verify,login'
).split(',')

// Rates at SCALE=1, from the agreed numbers (loadtest/README.md has the reasoning): 20,000 trips a
// day (10% buses), about 4,300 company members and 100 government staff. The peak hour carries 15%
// of a day's bookings and browsing. `vusPerUnit`: VUs per trip a minute, with room to spare.
const TARGET = {
  // 20,000 trips a day (TRIPS_PER_DAY), 15% of them in the peak hour: 0.85 a second
  booking: { perMinute: (TRIPS_PER_DAY * 0.15) / 60, vusPerUnit: 0.6 },
  // About 25 page views per trip (the clerk's list, the trip, searches; accountants and admins
  // checking): 500,000 a day, 15% in the peak hour, about 21 a second. The same as 60% of the
  // 4,312 members online, each looking at a page every 2 minutes.
  browse: { perMinute: 22 * 60, vusPerUnit: 0.02 },
  // 100 government staff. 5 seniors (supervisors) follow the dashboard, each about once a minute
  // (a new view 3 times in 10, otherwise a refresh of today); 95 agents each search and review
  // about once a minute
  govtDashboard: { perMinute: 5, vusPerUnit: 1 },
  govtReview: { perMinute: 95, vusPerUnit: 0.1 },
  // 6 data exports an hour (a month of trips and bills as Excel), prepared by the export worker;
  // an iteration lasts until the file is downloaded (minutes)
  exportData: { perMinute: 0.1, vusPerUnit: 20 },
  // Checkpoint scans: about 6 checkpoints per trip, 120,000 scans a day, about 10% in the peak
  // hour: 3.3 a second, rounded up
  verify: { perMinute: 4 * 60, vusPerUnit: 0.01 },
  // The morning rush: 60% of the ~4,400 accounts sign in within the first 30 minutes, 1.5 a
  // second
  login: { perMinute: 90, vusPerUnit: 0.03 }
}

const SCENARIOS = Object.fromEntries(
  FLOWS.map((flow) => {
    const { perMinute, vusPerUnit } = TARGET[flow]
    // Per hour, so a rate under one a minute (the exports) keeps its value
    const rate = Math.max(1, Math.round(perMinute * 60 * SCALE))
    const perMinuteNow = rate / 60
    return [
      flow,
      {
        executor: 'constant-arrival-rate',
        exec: flow,
        rate,
        timeUnit: '1h',
        duration: DURATION,
        preAllocatedVUs: Math.max(2, Math.ceil(perMinuteNow * vusPerUnit)),
        // Room for responses up to ~4× slower than expected, and no more: past that the server is
        // past its limit, and k6 drops the late iterations (a failure, see dropped_iterations in
        // lib.js) instead of piling up VUs until the machine runs out of memory
        maxVUs: Math.max(10, Math.ceil(perMinuteNow * vusPerUnit * 4))
      }
    ]
  })
)

export const options = {
  // Keep each VU's session cookie across iterations (k6 clears it by default)
  noCookiesReset: true,
  // setup() signs every account in first (a few thousand at the larger scales)
  setupTimeout: '15m',
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds,
  scenarios: SCENARIOS
}

// Every account a VU may sign in as, signed in before the measured run (lib.js signInAll)
export function setup() {
  // (from SCENARIOS: k6 replaces `options` with its own object at run time)
  const vus = Object.values(SCENARIOS).reduce((n, s) => n + s.maxVUs, 0)
  return { sessions: signInAll(vus) }
}
