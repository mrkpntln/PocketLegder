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


## Plan and notifications
- The Plan tab includes a monthly calendar, activities, bills, and utang tracking.
- Plan items are stored locally in the browser and are included in JSON backups.
- The notification bell lists upcoming items and overdue items. On HTTPS hosting, users can enable browser notifications for due-today/overdue items while the app is open.
- Browser notifications are not guaranteed while the app/browser is fully closed; reliable closed-app push notifications require a push-notification service and additional server setup.
- Transaction Logs are read-only. To correct an entry, add a correcting transaction rather than editing a past log.


## Bills and installment manager
- Track utility bills, rent, subscriptions, insurance, loans, installments and other due payments.
- Add categories, notes, due dates, recurring schedules (weekly/monthly/quarterly/yearly), and reminder lead time.
- Supports partial payments, payment methods, optional reference numbers, payment history and remaining-balance progress.
- Each payment is added once as an expense under the Bills category.
- Recurring bills generate the next bill after the current bill is fully paid.
- Attach an image or PDF receipt (up to 500 KB); the receipt is included in JSON backup data.
- Search and filter bills by status and due month; monthly payment totals are shown.
- Bill data is stored locally in this device and included in the JSON backup. Browser notifications require permission and the app/browser to be active; reliable alerts while fully closed require server push notifications.
