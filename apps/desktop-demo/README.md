# Masarat desktop demo

The Electron MVP shown to the government agency. It has the fleet owner and government panels in
one window, with simulated E-Sali payments and demo data. **It's frozen at 1.1.1**: production work
happens in the web apps, and this copy keeps its own `src/shared` so it never breaks.

It's a separate bun project, not one of the root workspaces, so it has its own `bun.lock` and
`node_modules`.

```bash
bun install     # rebuilds better-sqlite3 for Electron
bun run dev
```

On Linux, if Electron stops with "The SUID sandbox helper binary was found, but is not configured
correctly", either fix the helper once:

```bash
sudo chown root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

or run with `ELECTRON_DISABLE_SANDBOX=1 bun run dev`.

Demo accounts are listed on the login pages (e.g. `ministry.demo` / `govt2026`,
`nile.transport` / `nile2026`).

Releasing: see `CLAUDE.md` in this folder.
