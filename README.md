# Ram Gear Jobs (tablet PWA)

Offline, on-device web app for Ram Gear gearbox shop forms:

* **Teardown Evaluation** – `templates/gearbox-teardown-analysis.pdf` ("Ram Gear Gearbox Evaluation")
* **Assembly Verification** – `templates/gearbox-assembly-checklist.pdf` ("Ram Gear Manufacturing Assembly Verification Data")

No backend, no accounts, no analytics. Jobs, photos and saved PDFs live in the browser's IndexedDB on the tablet.

## Files
| Path | Purpose |
|---|---|
| `index.html`, `app.css` | Shell + styles (navy #1f3a5f, matches the PDFs) |
| `js/app.js` | UI: home/job/form screens, autosave, photos, finalize/reopen, backup/restore |
| `js/admin.js` | Local admin account: salted PBKDF2-SHA-256 PIN hash (Web Crypto), verification, 5-try / 30 s lockout |
| `js/db.js` | IndexedDB v2 (`customers`, `jobs`, `photos`, `docs`); migrates v1 jobs into an "Unassigned" customer |
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

## Admin approval (per device)
* On first launch you are asked to create the admin account: a name plus a 4–8 digit PIN, entered twice. Only a salted PBKDF2-SHA-256 hash (250,000 iterations) is stored in IndexedDB `settings`; the PIN itself is never stored.
* These actions need the admin PIN: deleting a customer, job, photo or saved PDF revision; reopening a completed form; restoring a backup; changing the PIN. Everyone else can still create, edit and finalize.
* After 5 wrong PINs, approval is locked for 30 s. The lockout is saved, so reloading does not reset it.
* Every attempt and approval is recorded in the audit log (action, item, admin, time, result) under **🔐 Admin** (`#/settings`).
* Backups include the admin hash and the audit log. Restoring a backup adopts the backup's admin account and PIN.
* This protection is local to the device (no server). Someone who can clear the browser's site data can remove the local data, and with it the protection. It guards the workflow, not the device.

Branding: the app header, page title and manifest name read "Ram-Gear Manufacturing Incorporated" (short name "Ram-Gear"). The generated photo and completion-record pages use it too. The PDF form templates are unchanged.
