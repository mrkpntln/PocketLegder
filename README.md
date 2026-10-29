# PocketLedger PWA

An installable, sage-green personal finance tracker built with HTML, CSS, and vanilla JavaScript.

## Features included
- Income and expense transactions with custom calculator keypad
- Built-in income/expense categories and custom categories
- Dashboard with lifetime and monthly totals
- Transaction log search, date filters, type/category filters, edit/delete
- Monthly category reports and CSV export
- JSON backup and restore
- Local IndexedDB storage for offline use
- Optional Supabase email/password account and cloud sync
- PWA manifest and service worker shell cache

## Run locally
Service workers do not work from `file://`. Serve the folder over HTTP, for example:
- VS Code: install/use the Live Server extension and open `index.html`
- Python: `python -m http.server 8080` from this folder, then open `http://localhost:8080`

For installation on Android, deploy over HTTPS (GitHub Pages, Netlify, or another HTTPS host), open the URL in Chrome, then use **Install app** or **Add to Home screen**.

## Enable accounts and cloud sync
1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase-schema.sql`.
3. Open `app.js` and fill in:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (publishable/anon key only)
4. In Supabase Authentication settings, configure your site's URL and allowed redirect URLs.
5. Deploy over HTTPS, then create an account in the app.

**Never put a Supabase `service_role` key in browser code.** The browser uses only the public anon/publishable key; RLS policies protect the table. Keep email confirmation enabled if desired and configure password/security settings in Supabase.

## Important behavior / limitations
- The app works offline without Supabase, and local entries are stored in this browser's IndexedDB.
- Sign-in and cloud sync require internet.
- Local records are not automatically uploaded until you sign in and sync.
- The initial sync uses transaction IDs and `updated_at` to merge rows, but this starter build does not yet implement cloud tombstones for deletions. A deleted row on one device may reappear after syncing from another device if an older cloud copy exists. For production multi-device use, add a soft-delete/tombstone field and conflict-resolution tests before relying on sync.
- Custom category definitions are currently stored locally per browser; transactions sync, category definitions do not yet sync between devices.
- Test with dummy data before storing sensitive personal finance records.
