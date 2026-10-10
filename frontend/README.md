# AgriFair web

The landing page, sign-in, the seller portal (`/client`), the Super Admin
portal (`/superadmin`) and the rider page (`/rider`). Buyers use the Flutter
app in `../mobile`.

```bash
npm install
npm run dev     # http://localhost:5173, talks to VITE_API_URL (see .env.example)
npm run lint
npm run build
```

## How the UI is put together

- `src/index.css` holds the design tokens (colours, radius, shadows) and every
  shared component: buttons, fields, badges, panels, tables, chips, modal,
  menu, alerts, empty and loading states. Light theme only.
- Palette: cream page (`--bg`) and cards (`--surface`), forest greens
  (`--g950` to `--g300`) for the sidebar, dark banners and text, and gold
  (`--gold`, `--gold-lt`) for primary buttons and highlights.
- Shape rule: controls 10px, containers 16px, badges, chips and landing
  buttons fully rounded.
- Fonts: Fraunces for headings and big numbers (`--font-display`), DM Sans
  for everything else, both self-hosted through `@fontsource-variable`.
- Motion: add `reveal` to an element and call `useReveal()` (in `hooks/`) to
  fade it in when it scrolls into view; `--i` staggers siblings. The landing
  hero uses `lp-enter` with `--d`. Hover effects use `translate`, so they never
  fight a reveal's `transform`. Everything turns off under
  `prefers-reduced-motion`.
- Icons: `lucide-react`, at the default stroke.
- `components/PortalShell` is the frame both portals share (sidebar, drawer on
  phones, page title). The open section is in the URL (`?tab=orders`).
- `components/Modal` is built on the native `<dialog>`, which traps focus and
  closes on Escape. Use `ConfirmDialog` for anything that cannot be undone.
- `components/account/AccountForms` holds the profile, password, notification
  and sign-in history forms, used by sellers and Super Admins alike.
- Tables with the `table-stack` class turn into one card per row below 720px,
  using each cell's `data-label`.
- Money, dates and initials go through `utils/format.js` (Intl), so a value
  reads the same everywhere.
- Page styles only add what the shared ones do not cover; check
  `index.css` before writing a new class.
