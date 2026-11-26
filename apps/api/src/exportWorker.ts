// The export worker: its own process (`bun run --filter @masarat/api worker:exports`), so building
// big Excel and CSV files never takes CPU, memory or database connections from the API instances
// that answer users. Run one or more, on any machine that reaches Postgres, Redis and the bucket.
import { hostname } from 'os'

// Its log lines (and files) say they come from the worker; set before the logger is loaded
process.env.INSTANCE_NAME ||= `exports-${hostname()}`
await import('./exportWorkerMain')
