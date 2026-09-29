# Ram Gear Jobs (tablet PWA)

Offline, on-device web app for Ram Gear gearbox shop forms:

* **Teardown Evaluation** – `templates/gearbox-teardown-analysis.pdf` ("Ram Gear Gearbox Evaluation")
* **Assembly Verification** – `templates/gearbox-assembly-checklist.pdf` ("Ram Gear Manufacturing Assembly Verification Data")

No backend, no accounts, no analytics. Jobs, photos and saved PDFs live in the browser's IndexedDB on the tablet.

## Files
| Path | Purpose |
|---|---|
| `index.html`, `app.css` | Shell + styles (ram-gear.com palette: charcoal #2C2C2E header, teal #2E7386 primary, #4396AC accent) |
| `js/app.js` | UI: home/job/form screens, autosave, photos, finalize/reopen, backup/restore |
| `js/admin.js` | Local admin account: salted PBKDF2-SHA-256 PIN hash (Web Crypto), verification, 5-try / 30 s lockout |
| `js/db.js` | IndexedDB v2 (`customers`, `jobs`, `photos`, `docs`); migrates v1 jobs into an "Unassigned" customer |
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
3. Bump `VERSION` in `sw.js` so tablets pick up the new files.

## Deploy to GitHub Pages (account `Ram-Gear`)
All paths are relative, so it works at `https://ram-gear.github.io/<repo>/`.
1. Create a repo (e.g. `ramgear-app`) under `Ram-Gear`, push the contents of this folder to `main` (root). `tools/` is optional.
2. Settings → Pages → Deploy from branch → `main` / `(root)`.
3. Open `https://ram-gear.github.io/<repo>/` once online on each tablet, then:
   * **iPad Safari:** Share → *Add to Home Screen*.
   * **Android Chrome:** menu → *Install app* / *Add to Home screen*.
4. After any change, bump `VERSION` in `sw.js`; the tablet updates on the next online launch (reopen the app twice).

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

## Admin approval (per device)
* On first launch you are asked to create the admin account: a name plus a 4–8 digit PIN, entered twice. Only a salted PBKDF2-SHA-256 hash (250,000 iterations) is stored in IndexedDB `settings`; the PIN itself is never stored.
* These actions need the admin PIN: deleting a customer, job, photo or saved PDF revision; reopening a completed form; restoring a backup; changing the PIN. Everyone else can still create, edit and finalize.
* After 5 wrong PINs, approval is locked for 30 s. The lockout is saved, so reloading does not reset it.
* Every attempt and approval is recorded in the audit log (action, item, admin, time, result) under **🔐 Admin** (`#/settings`).
* Backups include the admin hash and the audit log. Restoring a backup adopts the backup's admin account and PIN.
* This protection is local to the device (no server). Someone who can clear the browser's site data can remove the local data, and with it the protection. It guards the workflow, not the device.

Branding: the app header, page title and manifest name read "Ram-Gear Manufacturing Incorporated" (short name "Ram-Gear"). The generated photo and completion-record pages use it too. The PDF form templates are unchanged.
