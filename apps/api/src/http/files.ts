// Sends a stored attachment to the browser, shown inline (the portals preview it in the page)
import { extname } from 'path'
import { CONTENT_TYPES } from '../services/documents'
import { objectStore } from '../services/storage'
import { fail, type AppContext } from './context'

// Content-Disposition with the original name: an ASCII fallback plus the UTF-8 name (RFC 6266),
// since owners' file names are often Arabic
export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

// Streams an attachment from object storage
export async function sendFile(
  c: AppContext,
  file: { key: string; fileName: string } | undefined
): Promise<Response> {
  const body = file ? await objectStore.stream(file.key) : null
  if (!file || !body) return fail(c, 'not_found')
  const extension = extname(file.key).slice(1).toLowerCase()
  return new Response(body, {
    headers: {
      'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
      'Content-Disposition': contentDisposition('inline', file.fileName),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store'
    }
  })
}
