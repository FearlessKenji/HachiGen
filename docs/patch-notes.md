HachiGen Patch Notes

These notes are written for people running the HachiGen desktop manager. For the full developer history, see [CHANGELOG.md](https://github.com/FearlessKenji/HachiGen/blob/main/CHANGELOG.md).

# Unreleased

- After **Stop Test** finishes, **Start Test** now becomes available immediately. HachiGen waits for the test process to exit instead of leaving the page on a stale “stopping” snapshot.

- Reset Test Commands now checks that the testing token and client ID belong together and that the test bot can access every configured test server. Instead of Discord's generic `Missing Access` response, HachiGen identifies the incorrect client ID or inaccessible server IDs and explains how to correct them.

- The shared folder is now consistently named lowercase `backups`. The old local `manager` backup folder is removed once its Paldeck recovery point has been safely migrated.

- Backup names are now short and readable, such as `pre-encryption-08-21-2026` or `backup-08-24-2026`. Internal encrypted filenames are no longer shown in the normal interface.

- Pre-encryption recovery points are labeled **Plaintext database** in Backups. The `.hgbak` file itself remains encrypted by HachiGen; the label describes the database that will be restored.

- Hachi and additional bots now keep database backups in one obvious place: `HachiGen/backups/<Bot>/Local` or `HachiGen/backups/<Bot>/Remote-<Server>`. The same encrypted backup format, restore picker, retention policy, and **Rotate Backups** action apply to every bot.
- Existing Hachi and Paldeck backups are safely imported on startup. HachiGen copies and verifies them before using the new location and retains the originals for rollback compatibility.
- Hachi's backup and transfer tools now use the same managed backup list as other bots. Restoring a plaintext Hachi backup can disable database encryption after confirmation without deleting the retained key material.

- Encrypted additional-bot databases now explain when **Review & Reapprove** is required instead of incorrectly reporting that the file is not a database.

- Fixed additional-bot Dashboard status showing a JSON error when PM2 starts its background daemon while HachiGen checks the bot.

- Database restore now recognizes when a backup will change a bot from encrypted storage back to plaintext. HachiGen explains the change, asks for confirmation, updates the bot's runtime mode automatically, and keeps the encrypted database and key available for recovery.
- Existing Paldeck profiles do not need to be removed and re-added for plaintext restore; HachiGen checks the selected installation for the new adapter when it is needed.
- **Backup / Transfer** now includes a backup selector for additional bots, so a specific pre-encryption recovery point can be chosen instead of always restoring the latest backup.

- Protected Paldeck installations now show **Rotate Key** instead of **Encrypt Database**. Rotation performs a real bot-owned rekey with rollback, **Export Key Backup** works for the selected encrypted bot, and **Rotate Backups** gives every HachiGen-managed backup a new protected encryption key instead of pruning it. Plain databases continue to show the encryption action.
- Fixed Verify on remote Paldeck replacing its Database page with Hachi's encrypted database details. External-bot actions now refresh through the selected bot and installation, so plaintext Paldeck remains reported as plaintext.
- Before encrypting or rotating any additional-bot database, HachiGen now rechecks the selected local or remote installation for its package scripts, encryption adapters, declared SQLCipher dependency, and installed driver. A failed preflight stops before the bot, backups, keys, or database are changed.
- Test databases are no longer encrypted automatically when a bot starts. Select the testing identity in Database and use **Encrypt Data** when ready; after encryption, the same action becomes **Rotate Key**. The selected testing status refreshes immediately without touching production.
- Fixed Paldeck disappearing from HachiGen after its encrypted database profile was generated. Repository-owned database-tool access is now recognized as a supported, separately reviewed capability.
- Every encrypted testing database now receives its own OS-protected key, separate from production and from other test identities. HachiGen injects it only while that test bot or Testing Data Viewer runs. Existing plaintext test data is backed up and converted before startup, while the production database remains untouched.
- Additional bots can now advertise their own SQLCipher encryption and verification scripts. Once the updated Bot Profile is reviewed, HachiGen uses that bot's approved database adapter to view encrypted production or isolated testing data through the same Database page while keys remain in the bot's existing environment or key file.
- Saved remote bots now hydrate correctly on first launch without requiring Test Connection. HachiGen no longer launches duplicate overviews or simultaneous SSH probe chains that can make a reachable install appear missing.
- The Database Data Viewer can now switch between Production and any saved testing identity for the selected bot. Test databases are view-only, and the Source and Table labels are displayed inline with their selectors.
- Saved testing guild IDs now remain visibly separated by commas when reopened.
- Changed additional-bot profiles can now be reviewed directly in Testing against the required local repository, even while production targets an unavailable remote server. Hachi remote timeouts now leave the interface usable and show unavailable status instead of breaking the complete refresh.
- Starting, stopping, or resetting commands for a test bot now follows its current local repository even after installations are replaced or the production target is remote. Changed bot profiles still require an explicit one-time Review & Reapprove for safety.
- HachiGen now opens from a lightweight local snapshot and loads only the selected bot's Dashboard first. Configuration, Logs, Testing, Database details, and Diagnostics load when opened; local checks run concurrently while remote checks use one reliable ordered pathway.
- Additional bots now switch local and remote installations through the same logical selected-bot pathway used by Hachi. The selected bot stays constant while its active installation changes, and every shared tab follows that target automatically.
- Switching an additional bot between Local Development and Remote Server now reloads the database from that active installation instead of retaining rows cached from the previous location.
- Testing runs now keep their database under the selected testing identity's profile. HachiGen will not start a database-backed test process unless the bot supports an isolated database-path environment variable, preventing production data from being overwritten.
- Selected additional bots now use Hachi's existing layouts and controls across Dashboard, Setup, Updates, Database, Logs, Testing, and Diagnostics. Bot-specific adapters supply the data, while unsupported operations are simply disabled.
- Fixed the remaining `EAGAIN` error when a remote additional bot's Data Viewer reads its request over SSH.
- Fleet bot rows now contain only Select and Remove, and the redundant Activity box has been removed. Dashboard remains the place to check health and operate the selected bot.
- Additional bots now use the same Database page structure as Hachi, including Database, Protection, Current database, Backups, and a read-only SQLite Data Viewer. Backup maintenance lives with Backups, and Sanitation remains visible with a clear explanation when the bot has no sanitation adapter.
- Opening an additional bot's Data Viewer no longer starts Hachi's database worker, preventing the unrelated `EAGAIN` read error seen with remote databases.
- Data Viewer remains usable while a changed Bot Profile awaits review. Actions that run commands or modify the bot still require reapproval.
- The extra Maintenance section is gone: backup retention now appears with Backups, while log retention appears on Logs.
- Logs remain readable through the previously approved capability when a Bot Profile changes, while commands and modifications still wait for Review Profile. Dashboard database checks also avoid running an unapproved changed verification command.
- Fleet's Open Folder and generated inventory buttons now use the same icons as the rest of HachiGen. Icons were also added to the remaining Fleet, Testing, database, and profile actions.
- Packaged-build verification now checks the shared bot selector, navigation, Configuration, local/remote controls, and Testing controls instead of only checking whether the window opens.
- Packaged verification now tests the freshly built unpacked application before considering an older portable executable.
- Internal configuration handling is now isolated from the main bot manager, reducing the chance that future bot-format changes affect runtime, update, or database operations.
- If an additional-bot update fails, HachiGen now reports each recovery result separately while restoring the previous code, dependencies, database, and previously running process where applicable.
- When an additional bot's Profile changes, its Bot page now offers Review Profile. HachiGen shows the requested permissions and revalidates the repository before enabling the changed profile.
- Additional-bot Configuration now discovers YAML and YML files as well as `.env` and JSON. Bot Profiles can safely declare other configuration filenames, and YAML comments and formatting are retained when values are changed.
- Fleet bot rows now stay focused on inventory with Select, Health, and Remove. Start, stop, restart, logs, updates, commands, credentials, and database tools remain available through Dashboard and the selected bot's normal tabs.
- Saved Fleet connections can now be edited safely, including changing an SSH private key without removing attached bot installations.
- Fixed remote Hachi Configuration sometimes failing with an SSH timeout. HachiGen now reads the required remote configuration files through one connection instead of opening four connections at once.
- Hachi and additional bots now use the same underlying SSH connection test. HachiGen also warns when an existing Fleet server uses a different private key instead of silently keeping the old key while appearing to save the new one.
- The selected bot now uses Hachi's actual bot-page layout rather than a separately assembled additional-bot page. Install, validation, cron help, every Remote Connection field and action, remote testing, and Connection Preview are shared directly; only Configuration changes to match the selected repository.
- Saving an additional bot's remote settings reuses a matching Fleet server or creates its single server-level connection, then attaches the bot installation without creating another credential store.
- Fixed remote installation attachment failing when the local setup repository used a feature branch and the production server used `main`. HachiGen tracks branches separately for each installation and now immediately reflects later branch changes instead of continuing to display the onboarding branch.
- Hachi and additional bots now use the same underlying status, validation, runtime, update, command-deployment, and credential-copy controls. Selecting another bot changes the data and supported capabilities without switching to separately implemented behavior.
- Spacing between page sections, nested cards, and button groups is now consistent. Open Folder and Copy buttons match their associated fields, Configuration is one clean form without file separators, Runtime Location uses a compact installation selector, and credential Copy buttons consistently include the copy icon.
- HachiGen now has one Bot selector in the global header. Choose Hachi or an additional bot once, and Dashboard, the bot page, Updates, Database, Logs, Testing, and Diagnostics follow that selection.
- Fleet is again focused on adding and organizing connections, bots, and profiles. Its duplicate status cards and selected-bot control have been removed.
- Additional bots can now use the shared Dashboard runtime controls, repository update and command-deployment tools, database audit and encrypted backup actions, runtime logs, and testing identities. The bot page and navigation label change to the selected bot's name.
- Additional-bot pages now use Hachi's native bot-page layout, with Configuration generated from the selected repository.
- Additional-bot Configuration now comes from supported JSON files in the local source repository, including Paldeck's `config/config.json`. Sensitive-looking fields stay hidden, and HachiGen refuses to overwrite a file changed outside the app. The bot tab now also attaches remote installations and switches the active local/remote runtime without duplicating the bot in the global selector.
- Configuration also includes the bot's `.env`. Tokens, secrets, passwords, and keys are never displayed or returned to the interface; their blank fields preserve the saved value, while entering a value replaces it directly in the bot's own file.
- Hidden configuration values now have Copy buttons matching Hachi and Testing. Values are read only when copied, never stored in the page, and clear from the clipboard after 60 seconds if the clipboard is unchanged.
- Bot names no longer include Local or Remote suffixes. Location remains deployment/runtime information rather than part of a bot's identity.
- Corrected the global Bot selector alignment. Adding a bot now always starts with a local repository for safe inspection and testing; remote production installations are connected afterward.
- Corrected the remaining vertical offset between the global Bot selector, Open Folder, and Refresh controls.
- Began the multi-server, multi-bot foundation while keeping existing Hachi management intact. Hachi remains the only built-in bot, and optional bots use separately approved profiles.
- Added Fleet and Credentials pages for managing servers, bot deployments, deployment-local encrypted Discord identities, runtime controls, health checks, and logs. HachiGen does not retain a second token copy, while shared test identities remain protected from accidental concurrent use.
- Added fleet security audits, encrypted database backups and restores, automatic retention, safe bot updates with rollback, and external bot profiles for optional projects.
- External bots are now preservation-first: HachiGen previews requested permissions before installing an adapter, verifies each deployment's Git origin, branch, and ecosystem file, and blocks actions if the definition changes after approval.
- External credentials remain completely under the bot's control by default. Credential entry is available only for a deliberately approved encrypted-storage adapter; HachiGen never keeps a second token copy.
- Fleet now focuses only on additional bots, uses the same stacked-panel layout as the rest of HachiGen, and explains bot support files in plain language instead of presenting an unexplained external-definition editor.
- Setup, Fleet, Credentials, and Fleet Security now share the same form controls, labels, action alignment, empty states, spacing, focus treatment, and disabled appearance.
- Corrected inconsistent spacing above the Add Server and Add Bot buttons in Fleet.
- Matched the Fleet add-button rows exactly and changed the label to `PM2 process name (Optional)` on one line.
- Additional-bot credentials now live directly in Fleet instead of a separate sidebar page. Compatible bots show a Credentials action and open the same secure form automatically when first added.
- Setup is now named Hachi and sits directly below Dashboard in the sidebar, making it clear that the page manages the built-in bot rather than application-wide setup.
- Remote settings now live under Hachi as its Runtime Location section. The separate Remote sidebar tab was removed, while Dashboard and guide shortcuts still open the correct settings directly.
- Adding a bot now uses a guided review: choose its repository folder, let HachiGen detect its Git source, package scripts, PM2 file, database, and logs, then approve the generated production profile. HachiGen saves profiles in its own `Profiles/Bots` folder and does not modify the bot repository.
- Fleet now has an Open Folder picker, no longer shows empty Bot Support or Environment selectors, and assumes every added bot is production.
- Added a Testing tab for one or more local Discord test identities. Each identity is protected for the current Windows user in its own profile `.env`, can optionally be the default, and provides the same temporary 60-second copy behavior as Hachi credentials.
- Fixed empty Fleet Connection dropdowns by restoring the permanent Local computer connection in affected saved registries.
- Fleet connections now have the same Choose Key control as Hachi, reject duplicate SSH host/user/port entries, and clearly say when no PM2 ecosystem file was detected.
- Connections showing zero additional bots can now be removed even when an older hidden Hachi migration record was attached to them. Hachi remains preserved under Local computer.
- Fixed remote bot review showing `-` for its repository and branch, followed by a `botTypes` error. Remote inspection now validates structured Git and runtime details before showing approval.
- Stored Fleet connections now appear immediately at launch without a manual refresh.
- Testing now includes a flask icon and can start or stop a selected local bot with a selected testing identity. Credentials are injected only into the temporary process, production credential files are unchanged, and the production PM2 process can remain online alongside the test.
- Testing can now reset the shared test application's commands for the selected bot. HachiGen deletes that test application's global and guild commands, then redeploys through Hachi or the bot's `deploy:test` adapter without using production credentials.
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
