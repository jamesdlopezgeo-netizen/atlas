# allocycle brand

**Allogenic record. Autogenic log.**

The name comes from geology. In sedimentology, allocyclic layers are laid down by forces from outside the basin. allocycle does the same thing for one carbon-credit batch: it keeps an outside record, laid down line by line and never rewritten. The brand borrows from the rock record and stays as sober as the product's copy. It never signals more trust than a file supports.

## The mark

A lowercase a. The bowl is the cycle. The stem is the record: three sealed lines stacked like rock layers, with the newest on top in Azurite. Below about 24px the gaps close and it reads as a plain a. That's intended.

- Clear space: leave at least the height of the Azurite line on every side.
- Minimum size: mark 16px; logo (mark and wordmark) 18px tall.
- The wordmark is drawn lettering saved as outlines, so the logo files need no font installed.

Don't:

- recolor the top line green, amber, or red (those are status colors);
- add check marks, shields, leaves, or globes;
- stretch, rotate, outline, or add effects;
- put the color logo on Azurite (use `logo-white.svg`).

## Color

| Name | Light | Dark mode | Role |
| --- | --- | --- | --- |
| Basalt | `#171F28` | `#171F28` (card) | Ink in light mode, ground in dark mode |
| Calcite | `#F8FAFD` | `#E7ECF0` (ink) | Paper in light mode, ink in dark mode |
| Azurite | `#234B99` | `#8EB1F1` | Brand, links, primary actions, sealed lines |
| Shale | `#626A73` | `#A3ABB5` | Muted text |
| Pass | `#21763C` | `#76CF8A` | Pass, approved, issued, chain intact |
| Concern | `#985B0B` | `#EBB25F` | Draft, concern, correction, prototype notice |
| Fail | `#B02B27` | `#F28881` | Fail, chain broken |

Rules:

- Green means pass, approved, or issued, and nothing else.
- Azurite is the brand and never signals a status.
- Amber is for concerns only. Don't use it as decoration.
- Every text pairing in `css/style.css` meets WCAG AA (at least 4.5:1). Azurite on Calcite is 7.9:1.

Basalt and Calcite are named for the clearest image in carbon removal: CO2 injected into dark basalt turns into pale carbonate. Azurite is a copper carbonate mineral, meaning carbon held in stone.

## Type

| Use | Typeface |
| --- | --- |
| Headings and large display | Jost, 500 |
| Interface and body text | Atkinson Hyperlegible Next, 400 to 700 |
| Hashes, IDs, times, log lines | Atkinson Hyperlegible Mono |

The Braille Institute designed Atkinson Hyperlegible to keep look-alike characters apart (0 and O, 1 and l and I, B and 8). That matters when people compare hashes and labels like G-6VGD-0 by eye. Keep the mono for data. Labels and buttons use the text face.

All three are free under the SIL Open Font License. `index.html` loads them from Google Fonts. To avoid that external request, download the woff2 files, put them in `fonts/`, and replace the link with `@font-face` rules.

## Files

| File | Use |
| --- | --- |
| `logo.svg`, `logo.png` | Logo for light backgrounds |
| `logo-on-dark.svg`, `logo-on-dark.png` | Logo for dark backgrounds |
| `logo-one-color.svg`, `logo-white.svg` | Single-color logo (Basalt or Calcite) |
| `mark.svg`, `mark.png` | Mark alone, light backgrounds |
| `mark-on-dark.svg`, `mark-one-color.svg`, `mark-white.svg` | Mark variants |
| `app-icon.svg` | Rounded Basalt tile, for docs and slides |
| `icon-512.png`, `apple-touch-icon.png` | Full-bleed square icons (platforms round the corners) |
| `favicon.svg` | Browser tab icon; switches to light ink in dark mode |
| `../favicon.ico` | Fallback tab icon (16, 32, 48px) |
