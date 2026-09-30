# Using this app for your own shop (your own data)

This app was built for Ram-Gear Manufacturing Incorporated. Other shops can use it with **their own data, their own accounts and their own branding**. This guide explains how, step by step. You don't need to know how to program. You do need to copy and paste some text into two websites, GitHub and Supabase.

> **Important: the Ram-Gear web address is Ram-Gear's.**
> If you open `https://ram-gear.github.io/ramgear-app/` and connect it to the cloud, you are using **Ram-Gear's database**, and you need an account created by a Ram-Gear Admin. Don't put your shop's data there. Follow this guide to get **your own copy at your own address, connected to your own database**.

What you'll end up with:

* A copy of the app at `https://<your-github-name>.github.io/<repo-name>/`
* Your own Supabase project (the cloud database and file storage) that only your users can sign in to
* Your logo, company name, address, photo and colours

Cost: GitHub Pages is free for public repositories. Supabase has a free plan that is enough for a small shop, and paid plans for more storage.

---

## 1. Copy the app (GitHub)

1. Create a free account at <https://github.com> if you don't have one.
2. Open the app's repository and click **Fork**, then **Create fork**. You now have your own copy.
3. In your copy, open **Settings › Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute or two, your app is at `https://<your-github-name>.github.io/<repo-name>/`. Keep that address; you'll need it in step 2.

You can edit files right in the GitHub website. Open a file, click the pencil ✏️, change it, then **Commit changes**. Every commit is published automatically within a minute or two.

## 2. Create your own cloud database (Supabase)

1. Create an account at <https://supabase.com> and click **New project**. Pick a name, a strong database password (store it in your password manager) and a region near you.
2. **Create the tables and security rules:** open **SQL Editor › New query**. Paste the whole file [`supabase/migrations/001_init.sql`](../supabase/migrations/001_init.sql) and click **Run**.
   * This creates everything the app needs, including a **private** storage bucket called `ramgear-files` for photos and final PDFs, and rules that let only your signed-in users read or write.
   * The file doesn't contain anyone's project details, and it is safe to run again.
3. **Turn off public sign-ups:** open **Authentication › Sign In / Providers**. Switch off **Allow new users to sign up** and save. Nobody can create an account on their own; only your Admin adds users from inside the app.
   * Leave the **Email** provider enabled. The app uses it behind the scenes and never sends e-mails.
4. **Set the site address:** open **Authentication › URL Configuration** and set **Site URL** to your app address from step 1.
5. **Install the user-admin function.** It creates and changes user accounts on behalf of your Admin, so no secret key is ever in the app.
   * Easiest: **Edge Functions › Deploy a new function › Via Editor**. Name it exactly `rg-admin`, paste the whole file [`supabase/functions/rg-admin/index.ts`](../supabase/functions/rg-admin/index.ts) and deploy. Then open the function's **Details / Settings** and turn **Verify JWT** (enforce JWT verification) **off**. The function checks every caller itself.
   * Or with the Supabase CLI: `supabase functions deploy rg-admin --no-verify-jwt --project-ref <your-project-ref>`
6. **Choose a one-time setup code:** open **Edge Functions › Secrets** (or **Project Settings › Edge Functions**) and add a secret named `RG_SETUP_CODE` with any code you make up (for example `SHOP-7Q4K-2M9X`).
   * The code is only needed once, when your first tablet creates the company's cloud Admin. After that it can't be used again.
7. **Find your two public values:** open **Project Settings › API Keys** (or **Settings › API**) and note:
   * the **Project URL**, like `https://abcdefghijklmnop.supabase.co`
   * the **Publishable key**, which starts with `sb_publishable_`. On older projects, use the "anon public" key instead.

   These two are meant to be public; the security rules from step 2 protect the data. **Never** copy the *secret* or *service_role* key, the database password or an access token into the app or into GitHub.

## 3. Point the app at your database (one file)

In your GitHub copy, edit **`js/config.js`**. It is the only file with cloud settings:

```js
self.RG_CONFIG = {
  cloud: {
    url: 'https://abcdefghijklmnop.supabase.co',      // your Project URL
    publishableKey: 'sb_publishable_xxxxxxxxxxxxxxxx', // your publishable key
    bucket: 'ramgear-files',                           // leave as is
    adminFunction: 'rg-admin',                         // leave as is
  },
};
```

Commit the change. To use the app **without** a cloud (each tablet stands alone), leave `url` and `publishableKey` empty (`''`).

## 4. Your branding

| What | Where to change it |
|---|---|
| Company name (header, login screen, page title) | `index.html` (`Ram-Gear Manufacturing Incorporated`, 3 places) and `js/app.js` (`APP_TITLE`) |
| Address on the login screen | `index.html`, inside `<address class="login-address">` |
| App name on the home screen (“Industrial Gearbox Data”) | `js/app.js` (`HOME_LABEL`) and `index.html` (login card) |
| Logo | replace `img/ramgear-logo.jpg` (a wide logo, about 380 × 90 px, looks best) |
| Login background photo | replace `img/login-bg.jpg` (a landscape photo, about 1600 px wide) |
| App icons (home screen / tab) | replace the PNG files in `icons/` (same sizes and names) |
| Name when installed | `manifest.webmanifest` (`name`, `short_name`) |
| Colours | `app.css`, first lines (`--accent`, `--primary`, header colour `#2C2C2E`, …) |
| Forms | `forms.json` and the PDF templates in `templates/` (see README › *Updating the forms*) |

After changing any file, also bump `APP_BUILD` in `js/version.js`, for example to `'2026-10-01.1'`. That makes tablets pick up the new version.

## 5. First tablet: create your Admin

1. Open your app address in Chrome, Edge or Firefox on the first tablet or PC. Chrome/Edge: **Install app** from the address bar menu.
2. The app asks you to **Create the first Admin account**. Enter your name, a **Tablet ID** (a name for this device, e.g. `Shop Tablet 1`) and a password or PIN.
3. Open **Admin** (top right) › **Cloud sync** › **Connect this tablet to the cloud**. Enter the **setup code** from step 2.6 and your password/PIN. The Admin account is created in the cloud, and any existing data on this tablet is uploaded.
4. Under **Admin › Users**, add your technicians and admins. Each gets a username and a password or PIN. Tell them in person.

## 6. More tablets

1. Open your app address on the new tablet (install it if you like).
2. On the setup screen, tap **Connect to company cloud**, **not** "Create admin account".
3. Sign in with any existing username and password/PIN and enter a **Tablet ID** for the device (e.g. `Shop Tablet 2`). Users, customers, jobs, photos and PDFs download, and from then on everything syncs automatically.

## Good to know

* **Works offline.** Each tablet keeps a full copy of the data. Changes made offline sync when the tablet is back online. The cloud icon at the top shows the status.
* **No overwriting.** A form that is open on one tablet shows as *"In use on Shop Tablet 1"* (read-only) on the others. Finalized forms are locked everywhere; an Admin can reopen one as a new revision.
* **Adding or changing users needs internet** while cloud sync is on. Accounts apply to all tablets.
* **Backups** still work: Admin › Backup all data.
* **Privacy settings.** If a browser is set to delete site data when it closes, the tablet forgets everything. The data is still in the cloud: tap **Connect to company cloud** again. See README › *Keeping data on the device*.
