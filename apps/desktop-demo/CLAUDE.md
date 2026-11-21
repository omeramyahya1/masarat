# Masarat desktop demo

The Electron MVP (fleet owner and government panels in one window, toggled in the header), frozen
at 1.1.1. Don't port new features here unless asked: production work goes into the web apps at
the repo root. The domain rules in the root `CLAUDE.md` describe how this demo behaves. Its code
lives in `src/main` (main process, services, db), `src/preload` (the `window.api` bridge),
`src/renderer` and `src/shared`.

This is a separate bun project, not a root workspace: run `bun install` / `bun run …` in this
folder. Use bun, not npm.

## Releasing

- Packaging config lives only in `electron-builder.yml`. Don't add a `build` key to `package.json`: electron-builder would read that instead and silently ignore the yml (including `extraResources: drizzle`, without which installed builds can't migrate).
- The package name stays `masarat-mvp`, because the release file names (and the release workflow's checks) use it.
- **To release**: commit everything, run `bun pm version patch` here and `git push`, then `bun run release`. `scripts/tag-release.mjs` pushes the `v<version>` tag for the current commit. Nothing is built locally.
- **The tag starts `.github/workflows/release.yml`**, which works in this folder:
  1. *prepare* creates the release as a **draft**.
  2. *build* runs the Linux AppImage (ubuntu) and the Windows installer and portable `.exe` (windows) in parallel. electron-builder uploads them into the draft (`releaseType: draft`).
  3. *publish* checks that all 5 files are attached (`AppImage`, `latest-linux.yml`, `-setup.exe`, `-portable.exe`, `latest.yml`), then publishes.

  Publishing is what triggers the release notification (Slack), so it only goes out once every download exists. Don't publish the draft by hand.
- **If a run fails**: fix the problem, then Actions → *Release* → *Run workflow* with the tag. It reuses the draft. If the fix needs new code, bump the version instead.
- electron-updater reads `latest-linux.yml` / `latest.yml` from the latest published release.
