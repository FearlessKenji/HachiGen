HachiGen Patch Notes

These notes are written for people running the HachiGen desktop manager. For the full developer history, see [CHANGELOG.md](https://github.com/FearlessKenji/HachiGen/blob/main/CHANGELOG.md).

# Unreleased

- Began the multi-server, multi-bot foundation while keeping existing Hachi management intact. Hachi remains the only built-in bot, and optional bots will be supplied through external definitions.
- Added Fleet and Credentials pages for managing servers, bot deployments, deployment-local encrypted Discord identities, runtime controls, health checks, and logs. HachiGen does not retain a second token copy, while shared test identities remain protected from accidental concurrent use.
- Added fleet security audits, encrypted database backups and restores, automatic retention, safe bot updates with rollback, and external bot definitions for optional projects such as Paldeck.
- External bots are now preservation-first: HachiGen previews requested permissions before installing an adapter, verifies each deployment's Git origin, branch, and ecosystem file, and blocks actions if the definition changes after approval.
- External credentials remain completely under the bot's control by default. Credential entry is available only for a deliberately approved encrypted-storage adapter; HachiGen never keeps a second token copy.
- Fleet now focuses only on additional bots, uses the same stacked-panel layout as the rest of HachiGen, and explains bot support files in plain language instead of presenting an unexplained external-definition editor.
- Setup, Fleet, Credentials, and Fleet Security now share the same form controls, labels, action alignment, empty states, spacing, focus treatment, and disabled appearance.
- Corrected inconsistent spacing above the Add Server and Add Bot buttons in Fleet.
- Matched the Fleet add-button rows exactly and changed the label to `PM2 process name (Optional)` on one line.
- Additional-bot credentials now live directly in Fleet instead of a separate sidebar page. Compatible bots show a Credentials action and open the same secure form automatically when first added.
- Export Diagnostics now includes redacted Hachi runtime logs and PM2 output in addition to HachiGen logs, so bot errors are easier to investigate from one bundle.
- Updated bundled development and build tooling dependencies to resolve reported security vulnerabilities.

# v1.1.0 - 2026-07-16

## HachiGen

### Updates

- HachiGen can now be installed with a normal Windows installer in addition to the portable executable. Built installers are copied to the repository root as `HachiGen-Setup-X.X.X.exe`, and older root installer copies are cleared during builds.
- The Dashboard now shows a denser operations overview with runtime controls, target status, update status, recent activity, and one real `Check Updates` button.
- The Updates tab now checks Hachi and HachiGen together, shows current and available versions, and only shows saved-change recovery when HachiGen has a stash to restore or delete.
- Saved Changes restore and delete actions now sit at the top of the Updates card.
- Updating Hachi with local changes now shows a confirmation listing added, modified, and deleted files before HachiGen saves those changes and continues.
- The setup guide now checks or reviews updates before starting Hachi, including after switching between local and remote targets.
- The File menu can now export and restore Hachi runtime archives. HachiGen warns when archives include secrets and keys, saves exports under `exports/`, and makes safety backups before restore.
- The Database tab now uses one `Backup / Transfer` button for database backup, restore, remote pull, and remote push. Pull and push make a backup on the destination side before replacing an existing database.
- Database pull and push now re-encrypt the transferred copy with the destination database key, so local and remote installs can keep separate keys.
- Database transfers and restores now show clearer running and finished states, including source, destination, data size, and safety-backup details.
- HachiGen now has a Diagnostics tab with status summaries, copied diagnostic info, diagnostics bundle export, log-folder access, and recovery details.
- Error popups and logs now include clearer action context and the most useful command output when HachiGen can identify why something failed.
- The Remote tab now remembers the last connection test result.
- About HachiGen now includes release notes and shows where app data, logs, and settings are stored.
- Repeated path and version details have been reduced so the sidebar, About panel, Diagnostics tab, and Updates tab each have clearer jobs.
- HachiGen now remembers window size and position, focuses the existing window when opened twice, and shows a recovery prompt after previous UI crashes.
- HachiGen's interface is more compact and polished, with cleaner icons, tighter spacing, stronger focus states, fixed-height sidebar behavior, and more consistent Dashboard card actions.
- HachiGen self-updates now verify the downloaded executable and record its SHA-256 hash before installation.
- HachiGen includes additional desktop security hardening for renderer isolation and external links.

### Fixes

- Local updates no longer fail during dependency installation when npm is installed under `C:\Program Files\nodejs`.
- Selecting and copying text from the PM2 or HachiGen log windows is smoother because visible log refreshes now wait until the selection is cleared.
- Remote database table viewing no longer fails with `spawn ENAMETOOLONG` when HachiGen stages or runs its remote database worker.
- HachiGen self-updates now close and relaunch more reliably after replacing the app.

# v1.0.2 - 2026-07-14

## HachiGen

### Updates

- HachiGen now reports missing self-update release assets as unavailable instead of showing a manager error popup.
- HachiGen self-updates now use an in-app wizard with progress instead of opening a blank command window while waiting to replace and relaunch the app.
- HachiGen now uses `1.0.2` for its packaged app metadata.
- HachiGen now resolves approved system tools before launching them, reducing shell-command security warnings from GitHub CodeQL.
