/* App revision. Shown in the UI ("Rev N") and used as the service-worker cache name, so bumping it
   makes every tablet download the new files on the next visit. Update CHANGELOG.md when you bump. */
self.APP_REV = '1.7.2';             // release number shown as "Rev 1.6" (bump for each release; see CHANGELOG.md)
self.APP_BUILD = '2026-10-05.2';    // build date + sequence; bump on every deploy, even within the same revision
self.APP_REV_LABEL = `Rev ${self.APP_REV} (build ${self.APP_BUILD})`;
