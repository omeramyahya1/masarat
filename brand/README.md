# Masarat brand

The approved Masarat logo, traced into vectors from the approved artwork. The editable source is the Figma file's _Masarat — Approved logo (vector)_ board, with its components `Masarat/Logo — Horizontal`, `Masarat/Mark`, `Masarat/Wordmark` and `Masarat/App icon`.

## Files

| File | What it is |
| --- | --- |
| `svg/masarat-logo-horizontal.svg` | The full logo: the mark, a divider, and the wordmark (مسارات over MASARAT). 1814 × 418 |
| `svg/masarat-mark.svg` | The two-tone "M" on its own. 734 × 410 |
| `svg/masarat-wordmark.svg` | مسارات over MASARAT, as outlines. 908 × 400 |
| `svg/masarat-app-icon.svg` | The mark on a light green rounded square. 512 × 512 |
| `png/masarat-logo-horizontal.png`, `@2x` | 1814 and 3628 px wide, transparent |
| `png/masarat-mark-512.png`, `-1024` | 512 and 1024 px wide, transparent |
| `png/masarat-app-icon-{192,512,1024}.png` | App icon, transparent corners |
| `png/apple-touch-icon.png` | 180 × 180, opaque and full-bleed (iOS rounds it itself) |
| `png/favicon-{16,32}.png` | Browser tab icons |

The words are outlines, not live text, so they look the same everywhere.

## Colours

The logo uses two greens:

- **Dark** `#01392E`: the left stroke of the M, the divider, the wordmark
- **Light** `#03814C`: the route with its stop

The apps' `brand` scale (`packages/ui/src/assets/main.css`) is built on them. `brand-600` is the light green and `brand-900` the dark green. `brand-700` (`#036a40`) is the button and link colour, and `brand-50` (`#ebf7f1`) the app icon's tile.

## Use

- **In the apps**: the mark (`BrandMark`, `packages/ui/src/components/BrandMark.tsx`) sits next to the translated name `app.name`, so the name follows the language. The landing page shows the full logo (`BrandLockup`).
- **Favicons** come from `packages/ui/public` (each app's `publicDir`).
- **Official documents** (the payment receipt, the manifests, the government report) are issued by ديوان الضرائب and carry the Sudan emblem only. Don't put the Masarat logo on them.
- Don't recolour, stretch or rearrange the logo. On dark backgrounds the dark green is hard to see; a version for dark backgrounds is still to be made.
