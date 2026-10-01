/* Single source of truth for the app revision. Loaded by index.html (window) and by sw.js (importScripts),
   so the offline cache name changes whenever this file changes. See README "Revision number". */
self.APP_REV = '1.5.1';               // release number shown as "Rev 1.5.1" (bump for each release; see CHANGELOG.md)
self.APP_BUILD = '2026-10-01.2';    // build date + sequence; bump on every deploy, even within the same revision
self.APP_REV_LABEL = `Rev ${self.APP_REV} (build ${self.APP_BUILD})`;
