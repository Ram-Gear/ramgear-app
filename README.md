# Ram Gear Jobs (tablet PWA)

Offline, on-device web app for Ram Gear gearbox shop forms:

* **Teardown Evaluation** – `templates/gearbox-teardown-analysis.pdf` ("Ram Gear Gearbox Evaluation")
* **Assembly Verification** – `templates/gearbox-assembly-checklist.pdf` ("Ram Gear Manufacturing Assembly Verification Data")

No backend, no cloud accounts, no analytics. Sign-in uses local user accounts kept on each tablet. Jobs, photos and saved PDFs live in the browser's IndexedDB on the tablet.

## Files
| Path | Purpose |
|---|---|
| `index.html`, `app.css` | Shell + styles (ram-gear.com palette: charcoal #2C2C2E header, teal #2E7386 primary, #4396AC accent) |
| `js/app.js` | UI: home/job/form screens, autosave, photos, finalize/reopen, backup/restore |
| `js/version.js` | **Single source of truth for the revision** (`APP_REV`, `APP_BUILD`); also sets the service-worker cache name |
| `js/auth.js` | Local user accounts (Admin / Technician), salted PBKDF2 hashes, login rate limit, session + idle timeout |
| `js/admin.js` | PBKDF2 key derivation (Web Crypto) and the admin-approval lockout (5 tries / 30 s) |
| `img/` | Login background (shop photo) and the Ram-Gear logo from ram-gear.com |
| `CHANGELOG.md` | What changed in each revision |
| `js/db.js` | IndexedDB v4 (`customers`, `jobs`, `photos`, `docs`, `settings`, `audit`, `users`); migrates v1 jobs into an "Unassigned" customer |
| `js/camera.js` | In-app full-screen camera (getUserMedia): shutter, switch camera, review/retake/use + caption, multi-shot |
| `js/photos.js` | Client-side compression (max 1600 px, JPEG 0.8) + thumbnails |
| `js/pdf.js` | Fills the bundled AcroForm with pdf-lib, flattens finals, appends completion + photo pages |
| `forms.json` | Shared field definition (sections, fields, required items) – generated |
| `templates/*.pdf` | The real fillable templates (also offered as blank downloads) |
| `vendor/pdf-lib.min.js` | pdf-lib 1.17.1 (MIT), vendored – no CDN |
| `vendor/fflate.min.js` | fflate 0.8.2 (MIT) for job-folder zips |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA install + offline cache |
| `tools/gen_forms.py` | Regenerates `forms.json` from `/workspace/gbx/make*.py` and validates every field name against the PDFs (`--copy-templates` also copies the PDFs in) |
| `tools/make_icons.py` | Generates the "RG" icons |

## Updating the forms
1. Rebuild the PDFs (`gbx/make.py`, `gbx/make_teardown.py`).
2. Update `tools/gen_forms.py` if sections/fields changed, then `python tools/gen_forms.py --copy-templates` (must print `OK`).
3. Bump `APP_BUILD` in `js/version.js` so tablets pick up the new files (see *Revision number*).

## Deploy to GitHub Pages (account `Ram-Gear`)
All paths are relative, so it works at `https://ram-gear.github.io/<repo>/`.
1. Create a repo (e.g. `ramgear-app`) under `Ram-Gear`, push the contents of this folder to `main` (root). `tools/` is optional.
2. Settings → Pages → Deploy from branch → `main` / `(root)`.
3. Open `https://ram-gear.github.io/<repo>/` once online on each tablet, then:
   * **iPad Safari:** Share → *Add to Home Screen*.
   * **Android Chrome:** menu → *Install app* / *Add to Home screen*.
4. After any change, bump `APP_BUILD` in `js/version.js` (see *Revision number*). The tablet updates on the next online launch (reopen the app twice).

GitHub Pages serves HTTPS, which service workers, camera capture, and Web Share require.

Forms always appear in this order: **Teardown Evaluation first, then Assembly Verification** (set by the order in `forms.json`).

## Workflow (Customers > Customer file > Job folder > Form)
* Home: searchable customer list (name, contact, phone, email, work order), New customer, Backup, Restore, Blank PDFs.
* Customer file: contact details (Edit / Delete, where Delete removes all their jobs, photos and PDFs after a warning), the customer's jobs with Draft/Completed badges, and New job.
* Job folder: work order, date, gearbox manufacturer/model/serial (auto-filled into both forms along with the customer name), Move to customer, forms with progress, job photos, saved final PDFs (all revisions), and Export job folder (zip of all final PDFs + photos + summary + combined PDF, or just the combined PDF).
* Breadcrumbs in the header plus a labelled back button.
* Form: touch inputs that follow the PDF sections. Autosaves on every change. Photos per section and per component.
* **Export PDF** (draft): the filled template, still editable, plus photo pages. File name `WO-<number>_<customer>_<form>.pdf`.
* **Finalize**: lists every incomplete required item with *Go to* and *N/A*. Once everything is complete, you confirm who signs. The form is then locked (Completed, date, signer). A flattened final PDF (form + completion record listing N/A items + photo pages) is saved in the job as `..._FINAL-rev<N>.pdf`.
* **Reopen**: asks for confirmation, then starts revision N+1. Earlier final PDFs are kept.

## Taking photos

* **Take photo** opens the in-app camera: full-screen preview (rear camera preferred, ideal 1920×1080 or better), a large shutter, **Switch camera** when the device has more than one, and **✕ Done**. Every shot goes to a review step: add a caption, then **Retake** or **Use photo**. After Use, the camera stays open for the next shot. Photos are captured from the video frame at the camera's native resolution, then compressed and saved like any other photo. Closing the camera turns it off (all tracks are stopped).
* If the camera can't be used (permission denied, no camera, camera busy, browser not supported, or the page isn't https), a message says why and offers **Use device camera / pick a file**, a file input with `capture=environment`. On Windows, camera access is under Settings › Privacy & security › Camera, plus the browser's site permissions.
* **Choose from gallery** is always a normal file picker.

## Backup reminder

* Every write to customers, jobs (including form edits and finalize), photos or saved PDFs stamps `lastChangeAt`. Generating a backup file stamps `lastBackupAt`. Both live in the IndexedDB `settings` store (key `backup`).
* When the app opens and whenever you return to the home screen, a banner appears if data changed since the last backup **and** there has never been a backup or the last one is at least N days old. It reads "Last backup: N days ago (or Never). Back up now to keep your data safe." and has **Back up now** and **Remind me later** (snoozes for 24 h).
* N is set on the Admin screen (1, 3 or 7 days; default 3) and needs no PIN. "Last backup: <date>" is shown next to Backup on the home screen and on the Admin screen.
* Backups include these settings. Restoring never moves `lastBackupAt` back to an older date.

## Tablet ID

* Each device has a Tablet ID (e.g. "Shop Tablet 2"). You enter it during first-launch admin setup; devices set up before this feature ask once on the next start. Changing it on the Admin screen needs the admin PIN and is written to the audit log. Every audit entry records the Tablet ID.
* New jobs are stamped "Created on: <Tablet ID>", which is shown in the job folder. Each form has a **Tablet used for inspection** field, prefilled with this device's ID and editable while in Draft. At finalize that value is stamped as "Inspected on" and shown on the form, in the job folder, on the Completion record page of the final PDF and in `job-summary.txt`.
* The backup file includes the Tablet ID. A restore only applies it to a device that has no Tablet ID yet.

## Revision number
* `js/version.js` is the only place the revision is defined: `APP_REV` (e.g. `'1.0'`) and `APP_BUILD` (build date + sequence, e.g. `'2026-09-29.1'`).
* It is shown as "Rev 1.1 (build …)" on the login screen, in the header (**Rev** button → About), and on the Admin screen. It is also stamped on the Completion record page of final PDFs, in `job-summary.txt` and in backups (`appRev`, `appBuild`).
* `sw.js` loads `js/version.js` with `importScripts`, and the offline cache name is `rg-rev<APP_REV>-<APP_BUILD>`. The page registers the worker with `updateViaCache: 'none'`, so a change to `version.js` alone triggers the update.
* **How to bump:**
  * For every deploy, increase `APP_BUILD`: today's date plus `.1`, `.2`, … for more deploys on the same day. This is required so tablets refresh their offline cache.
  * For a release, also raise `APP_REV` (`1.0` → `1.1` for features and fixes, `2.0` for big changes) and add a section to `CHANGELOG.md`.

## Keeping data on the device (Firefox, Chrome, Edge)
Everything is stored in the browser's IndexedDB for `https://ram-gear.github.io`. If the browser deletes site data when it closes, the accounts and jobs are gone and the app shows first-run setup again. The setup screen then says so and shows these steps:
* **Firefox:** Settings › Privacy & Security › Cookies and Site Data. Either turn off **Delete cookies and site data when Firefox is closed**, or use **Manage Exceptions…** › `https://ram-gear.github.io` › **Allow** (not "Allow for Session") › Save Changes. History must not be "Never remember history", and don't use a Private Window.
* **Chrome:** Settings › Privacy and security › Site settings › Additional content settings › On-device site data. Choose "Allow sites to save data on your device", or add the site under "Allowed to save data". Don't use Incognito.
* **Edge:** Settings › Cookies and site permissions › Manage and delete cookies and site data. Turn off "Clear cookies and site data when you close all windows", or add the site under Allow. Don't use InPrivate.
* The app requests persistent storage (`navigator.storage.persist()`), which protects against automatic cleanup when the disk is low. It does **not** override the "delete on close" settings above. The Admin screen shows the status, and home shows a warning while storage is not persistent.
* Setup never runs when the device already has accounts or jobs. A storage read error shows an error screen with **Try again**, not setup.
* Keep taking backups (Admin › Backup all data). A backup is the only way to recover after the browser wipes the data.

## Sign-in and user accounts (per device)
* The app opens to a Ram-Gear login screen: the logo, "Ram-Gear Manufacturing Incorporated", 6150 E Hwy 44, Alice, TX 78332 (as published on ram-gear.com), username, and password or PIN. It works offline because everything is local and cached.
* A secret is either a 4–8 digit PIN or a password of at least 8 characters. Only salted PBKDF2-SHA-256 hashes (250,000 iterations) are stored in the IndexedDB `users` store.
* There is no self sign-up. An **Admin** creates users and can edit, disable/enable or reset them under Admin screen › **Users**. Roles:
  * **Admin**: everything, including user management and approving admin-only actions.
  * **Technician**: can create, edit and finalize. Technicians cannot open the Admin screen.
* You cannot disable yourself, and the last active Admin cannot be disabled or demoted.
* First launch on a new tablet creates the first Admin (name = username) and asks for the Tablet ID. Tablets from the earlier admin-PIN version are migrated: the admin account becomes the first Admin user, who signs in with their existing name and PIN.
* 5 failed sign-ins lock sign-in for 30 s. The lockout is saved on the device, and every attempt is audit-logged.
* The header shows the signed-in user and a **Log out** button. The app locks after 15 minutes without activity. Admins can change this on the Admin screen (5, 10, 15, 30 or 60 min). After a lock, the same user continues where they left off.
* The signed-in user is stamped on each job ("Created by"), each form ("created by", "finalized by", and the "Inspected by" field prefilled), the Completion record, `job-summary.txt` and every audit entry.
* Backups include the users (hashes only). A restore replaces accounts with the same username.

## Admin approval (per device)
* These actions need an Admin's password or PIN, even when an Admin is signed in: deleting a customer, job, photo or saved PDF revision; reopening a completed form; restoring a backup; changing the Tablet ID; changing your own password. When a Technician is signed in, an Admin enters their username plus password or PIN.
* After 5 wrong entries, approval is locked for 30 s. The lockout is saved, so reloading does not reset it.
* Every attempt and approval is recorded in the audit log (time, action, item, user, approved by, tablet, result) under **🔐 Admin** (`#/settings`).
* Backups include the users (hashes) and the audit log.
* This protection is local to the device (no server). Someone who can clear the browser's site data can remove the local data, and with it the protection. It guards the workflow, not the device.

Branding: the app header, page title and manifest name read "Ram-Gear Manufacturing Incorporated" (short name "Ram-Gear"). The generated photo and completion-record pages use it too. The PDF form templates are unchanged.
