# Changelog – Industrial Gearbox Data (Ram-Gear Manufacturing Incorporated)

The revision number lives in `js/version.js` (see README › *Revision number*).

## Rev 1.4 – 2026-09-30 (build 2026-09-30.4)

- New **Help** page (`help.html`) with a table of contents and numbered step-by-step instructions: before you start, set up the first tablet, add more tablets or a PC, Firefox settings, daily use and sync status, backups and restore, if browser data is cleared, and setting up for another shop.
- Open it from **Help** in the top bar (every user), **Help & setup guide** on the sign-in screen, or the link on the first-run setup screen. It opens in a new tab, shows the app revision, prints cleanly and works offline once the app has loaded once.
- Keyboard: pressing **Enter** in a dialog field now presses the dialog's main button (Create, Save, Approve…). Before, browsers pressed the first button, which was usually **Cancel**, or **Connect to company cloud** on the first-run screen. Enter on the sign-in screen signs in.
- Layout checked on laptop/desktop (1366×768, 1920×1080), tablet portrait/landscape (768×1024, 1280×800) and phone (390×844) in Chrome and Firefox. Content stays capped at 1100 px on wide screens.
  - On phones the top bar scrolls away instead of staying pinned (it took about a third of the screen), and its buttons are more compact.
  - The Help page's status table turns into cards on phones instead of running off the side.
- The "Saving… / Saved 9:44 AM" text in the form's top bar has a fixed width, so the buttons no longer shift while you click (in Firefox a click on **Finalize** could be lost).

## Rev 1.3 – 2026-09-30 (build 2026-09-30.3)

- Backup file names sort by date and time and show the revision and tablet: `ramgear-backup-2026-09-30-0858-Rev1.3-ShopTablet1.json` (local time, 24 h; the Tablet ID is reduced to letters, digits, `.`, `_` and `-`).
- **Save as…** in the backup dialog lets you choose the folder and name (Chrome/Edge, where the browser supports it). Firefox and other browsers keep **Download** (and **Share** where available).
- Restore accepts any backup file, including the old `ramgear-backup-YYYY-MM-DD.json` names. Cloud sync is unchanged.

## Rev 1.2 – 2026-09-30 (build 2026-09-30.2)

**Cloud sync (Supabase), offline-first**
- The tablet keeps working entirely offline, with IndexedDB as the primary store. When online and signed in, it pushes its changes and pulls everyone else's: users, customers, jobs, forms, photos, saved final PDFs and the audit log. Photos and PDFs go to a private storage bucket.
- The first sync of a tablet uploads everything already on it, including users (as hashes). Imported users get their cloud sign-in the first time they sign in online.
- New tablets: the setup screen has **Connect to company cloud**. Sign in with an existing username and PIN and everything downloads. This also recovers a tablet whose browser deleted its data.
- Check-out lock: a draft form open on one tablet shows *"In use on Tablet A by …"* (read-only, updated live) on the others. The lock is released on leaving the form and expires after 30 minutes if a tablet disappears. Finalized forms are locked in the database on every tablet; reopen (Admin approval) creates a new revision as before.
- Offline edits sync when the connection returns. The header shows ☁ Synced / Offline · N waiting / Sync problem. If a change can't be applied (form in use elsewhere or finalized there), the server version wins and this tablet's values go to the audit log.
- User accounts apply to all tablets. An Admin adds, edits, disables and resets users on any tablet (needs internet) through the `rg-admin` Edge Function. The app contains only the publishable key, never a secret key. Public sign-up is disabled. The first cloud Admin needs a one-time setup code.
- Admin screen: **Cloud sync** card with status, **Sync now**, the list of tablets (last seen, user, app revision) and **Disconnect this tablet**.
- Zip export, combined PDF, final PDF download and backup/restore work unchanged, including on a tablet that received the job from another tablet.

**For other shops**
- `js/config.js` holds all cloud settings. `supabase/migrations/001_init.sql` and `supabase/functions/rg-admin` work for any Supabase project. The new guide [docs/SETUP-FOR-OTHER-SHOPS.md](docs/SETUP-FOR-OTHER-SHOPS.md) covers forking, GitHub Pages, their own Supabase project, branding, the first Admin and Tablet IDs.

## Rev 1.1 – 2026-09-30 (build 2026-09-30.1)

**Fixed: "every time I open the app it asks me to create a new admin" (Firefox)**
- Cause: the app's login, user and database code was working. Accounts and jobs survived full browser restarts in Chrome, Edge (Chromium) and Firefox with normal settings. But when Firefox is set to **"Delete cookies and site data when Firefox is closed"** or **"Never remember history"** (or a private window is used), Firefox erases the app's IndexedDB data every time it closes. The app then found an empty device and silently showed first-run setup again.
- The setup screen now says *"Seeing this setup screen again?"*, explains that the browser deleted the data, and gives the exact steps for the browser in use. Firefox: Settings › Privacy & Security › Cookies and Site Data › turn off "Delete cookies and site data when Firefox is closed", or Manage Exceptions… › add `https://ram-gear.github.io` › **Allow**. Chrome/Edge have equivalent steps.
- The app asks the browser for persistent storage (`navigator.storage.persist()`) when the first admin is created, and from a **Keep data on this device** button. A home-screen warning appears while storage is not persistent, and the Admin screen shows the storage status with a **Request persistent storage** button.
- Setup now only runs on a device that has never had accounts. It never runs when user accounts, a legacy admin PIN, or Rev 1.0+ jobs exist. If jobs exist but the accounts are gone, the login screen offers **Restore accounts from a backup** instead.
- A storage read error (IndexedDB can't be opened, e.g. blocked by a privacy mode or another tab) now shows "Can't open this app's storage" with a **Try again** button, never the setup screen. Database upgrades close the old connection in other tabs (`onversionchange`) so they cannot get stuck.
- A newly downloaded version takes over automatically on the login screen (service worker `controllerchange`).

**Firefox / Chrome / Edge**
- The whole e2e suite runs in Playwright Chromium and Playwright Firefox with persistent profiles. It covers the main flow, login/admin, camera (fake media), PDF export, zip, backup/restore, the backup reminder, restarts, upgrades and clear-on-close.
- Browsers that can't share files (desktop Firefox) show **Download** instead of **Share** ("Download final PDF"). Sharing still falls back to a download elsewhere.
- Login screen: the cursor no longer jumps to the other field while the user is typing. In Firefox this could put the PIN into the username box.
- Screen changes run one at a time, so a quick tap while the Admin screen is loading can't mix two screens.

## Rev 1.0 – 2026-09-29 (build 2026-09-29.1)

First numbered release.

**Forms and jobs**
- Teardown Evaluation and Assembly Verification forms based on the bundled fillable PDF templates (the templates are unchanged). Autosave, required-item tracking, N/A marking and auto-fill of customer, work order, manufacturer, model and serial.
- Structure: Customers › Customer file › Job folder › Forms, with "Industrial Gearbox Data" as the home screen.
- Finalize produces a flattened final PDF with a Completion record and photo pages, and locks the form. Reopen (admin-approved) creates a new revision, and every revision is kept.
- Job folder export: a zip with all final PDFs, photos, `job-summary.txt` and a combined PDF, or the combined PDF alone.

**Photos**
- In-app full-screen camera (getUserMedia): rear camera preferred, ideal 1920×1080, switch camera, review/retake/use with caption, several shots in a row. It falls back to the device camera or file picker when the camera is unavailable or denied. Choose from gallery is still available.

**Users and security (local to each tablet)**
- Ram-Gear-branded login screen with the ram-gear.com logo, legal name and address, over the shop photo.
- Admin-managed user accounts (Admin / Technician) with no self sign-up. Passwords and PINs are stored only as salted PBKDF2-SHA-256 hashes.
- 5 failed sign-ins → 30 s lockout. Idle auto-lock after 15 min (adjustable). Log out button in the header.
- Admin approval for deletes, reopen, restore, Tablet ID change and password change. The audit log records user, approver and tablet.
- The earlier admin-PIN setup migrates to the first Admin user (same name and PIN).

**Traceability**
- Tablet ID per device: stamped "Created on" for jobs and "Inspected on" for forms, editable per draft form.
- Signed-in user stamped as "Created by", "Finalized by" and a prefilled "Inspected by".
- The revision (Rev + build) is shown on the login screen, in the header (About) and on the Admin screen, and stamped on Completion records, `job-summary.txt` and backups.

**Data safety**
- Backup / restore of all data (JSON), including users (hashes only), audit log, Tablet ID and backup settings.
- Backup reminder banner when data changed and the last backup is older than 1, 3 or 7 days (default 3), or there has never been one. Remind me later snoozes it for 24 h. Restoring never moves "last backup" back to an older date.
- Works fully offline after the first visit (service worker cache).

**Look**
- Colors taken from ram-gear.com: charcoal #2C2C2E header, teal #2E7386 primary buttons, #4396AC accent, #3E555C steel, #F3F5F6 light panels, #E8EAED page background. RG icons are in the new primary color.
