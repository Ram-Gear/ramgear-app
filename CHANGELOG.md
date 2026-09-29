# Changelog – Industrial Gearbox Data (Ram-Gear Manufacturing Incorporated)

The revision number lives in `js/version.js` (see README › *Revision number*).

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
