// Server log. Plain console for now, so the host (systemd, Docker, …) collects it.
export const log = {
  info: (...args: unknown[]): void => console.info(...args),
  warn: (...args: unknown[]): void => console.warn(...args),
  error: (...args: unknown[]): void => console.error(...args)
}
