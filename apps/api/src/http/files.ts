// Sends a stored attachment to the browser, shown inline (the portals preview it in the page)
import { existsSync } from 'fs'
import { extname } from 'path'
import { fail, type AppContext } from './context'

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
}

// Content-Disposition with the original name: an ASCII fallback plus the UTF-8 name (RFC 6266),
// since owners' file names are often Arabic
export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export function sendFile(
  c: AppContext,
  file: { path: string; fileName: string } | undefined
): Response {
  if (!file || !existsSync(file.path)) return fail(c, 'not_found')
  return new Response(Bun.file(file.path), {
    headers: {
      'Content-Type': MIME_TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Disposition': contentDisposition('inline', file.fileName),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store'
    }
  })
}
