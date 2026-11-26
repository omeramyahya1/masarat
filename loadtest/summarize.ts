// A table of every run in loadtest/results: per server size and load, whether it met the SLOs,
// the request rate reached, p95 per kind of request, and what the API and Postgres used.
//   bun loadtest/summarize.ts [results dir]
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

const root = resolve(process.argv[2] ?? join(import.meta.dir, 'results'))
const KINDS = ['read', 'write', 'login', 'verify', 'dashboard', 'export'] as const

type Metric = Record<string, number>
const ms = (v: number | undefined): string =>
  v === undefined ? '' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`

function stats(file: string): { api: number[]; apiMb: number[]; db: number[]; dbMb: number[] } {
  const rows = readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split(',').map(Number))
  // The first sample includes start-up; skip it when there are others
  const body = rows.length > 2 ? rows.slice(1) : rows
  return {
    api: body.map((r) => r[1]),
    apiMb: body.map((r) => r[2]),
    db: body.map((r) => r[3]),
    dbMb: body.map((r) => r[4])
  }
}
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const max = (xs: number[]): number => (xs.length ? Math.max(...xs) : 0)

const lines = [
  `| Run | Scale | Result | req/s | ${KINDS.map((k) => `p95 ${k}`).join(' | ')} | errors | API cores avg / max | API MB | DB cores avg / max | DB MB |`,
  `|${'---|'.repeat(9 + KINDS.length)}`
]
for (const label of existsSync(root) ? readdirSync(root).sort() : []) {
  const runs = readdirSync(join(root, label))
    .filter((d) => d.startsWith('scale-'))
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))
  for (const run of runs) {
    const dir = join(root, label, run)
    if (!existsSync(join(dir, 'summary.json'))) continue
    const metrics = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')).metrics as Record<
      string,
      Metric
    >
    const s = existsSync(join(dir, 'stats.csv')) ? stats(join(dir, 'stats.csv')) : null
    const result = existsSync(join(dir, 'result'))
      ? readFileSync(join(dir, 'result'), 'utf8').trim()
      : '?'
    lines.push(
      [
        label,
        run.slice(6),
        result,
        Math.round(metrics.http_reqs?.rate ?? 0),
        ...KINDS.map((k) => ms(metrics[`http_req_duration{kind:${k}}`]?.['p(95)'])),
        `${((metrics.http_req_failed?.value ?? 0) * 100).toFixed(2)}%`,
        s ? `${avg(s.api).toFixed(2)} / ${max(s.api).toFixed(2)}` : '',
        s ? max(s.apiMb) : '',
        s ? `${avg(s.db).toFixed(2)} / ${max(s.db).toFixed(2)}` : '',
        s ? max(s.dbMb) : ''
      ].join(' | ')
    )
  }
}
console.log(lines.map((l) => (l.startsWith('|') ? l : `| ${l} |`)).join('\n'))
