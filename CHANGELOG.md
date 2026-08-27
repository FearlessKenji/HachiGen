# Changelog

Notable changes to HachiGen are documented here.

## Unreleased

- Removed renderer-side backup-name interpretation. Backup lists, summaries, and restore selectors now display the authoritative managed filename from the vault, minus its `.hgbak` extension.

- Renamed managed HGBK files to the same purpose-and-date schema shown in the interface, with numeric suffixes for same-day collisions. Startup migration updates vault paths transactionally while preserving internal backup IDs, and all modal Close actions now use an X icon instead of the stop-style square.

- Fixed testing controls remaining stuck in the stopping state. Stop Test now waits for the child process's final exit state, escalates to a forced stop after the graceful timeout, and returns the completed run snapshot so Start Test becomes available immediately.

- Hardened shared test-command reset against Discord `50001 Missing Access`. HachiGen now verifies that the saved client ID belongs to the supplied test token, validates configured guild IDs before deleting anything, identifies inaccessible guilds in actionable errors, and tolerates a guild disappearing between discovery and cleanup.

- Standardized the root backup directory as lowercase `backups` and removed the obsolete local `manager/backups/paldeck` source after its migrated HGBK container and vault registration were validated.

- Simplified managed backup names throughout Database and restore selection to a purpose-and-date format such as `pre-encryption-08-21-2026`; opaque backup IDs and HGBK filenames remain internal.

- Fixed migrated pre-encryption backups appearing indistinguishable from encrypted database restore points. Backup listings now inspect the database inside the encrypted HGBK container and preserve the original legacy filename for display.

- Unified Hachi and additional-bot database backups under `backups/<Bot>/<Installation>/` at the HachiGen root. Local and remote installations now use the same OS-protected HGBK vault, retention, restore, and envelope-key rotation pathways without writing new managed backups into bot repositories.
- Added rollback-safe legacy backup migration. Registered HGBK records and older Hachi/Paldeck SQLite backups are copied into the canonical profile folder, checksum-verified or encrypted into HGBK, and left at their original locations so an older build can still be restored.
- Routed Hachi backup, restore, pull/push safety copies, encryption recovery, and key-rotation recovery through the shared backup system. Plaintext restores now update Hachi's runtime encryption mode after explicit confirmation, while transient bot-side rollback files are removed after successful encryption operations.

- Replaced the raw SQLite `file is not a database` error with an explicit Review & Reapprove instruction when an encrypted additional-bot database cannot use its changed repository-owned viewer adapter.

- Fixed Fleet and Hachi runtime status parsing when PM2 prints a `[PM2]` startup banner before its JSON process list.

- Added protection-aware Fleet database restores. Restoring a plaintext backup over an encrypted database now requires explicit confirmation, creates a uniquely named encrypted recovery backup, invokes the bot's approved plaintext-runtime adapter, and retains key material for rollback.
- Existing approved bot profiles can use the narrowly scoped `database:plaintext` package adapter without being removed and added again; HachiGen verifies that script in the selected installation before running it.
- Fleet database restore now lets the user choose the exact managed backup instead of always restoring the newest entry.

### Added

- Added independent per-identity, per-bot SQLCipher keys for isolated testing databases. Keys use the existing operating-system-protected testing secret store, are injected only into the local testing process and viewer, and plaintext test databases are backed up and transactionally converted before startup.
- Added automatic external-bot SQLCipher capability discovery and a separately approved repository-owned database-tool capability, allowing the shared Data Viewer to read encrypted production and isolated testing databases without exposing their keys to the interface or assuming older encryption profiles contain an adapter.
- Added a read-only Production/Testing source selector to the shared Database Data Viewer. Testing sources resolve the selected bot's isolated database under its testing identity profile without changing production maintenance targets.
- Added an explicit changed-profile reapproval workflow that shows requested capabilities, revalidates the selected installation, and only then refreshes its immutable permission snapshot.
- Added comment-preserving YAML configuration management and reviewed per-profile configuration file manifests, with safe relative-path validation and the same sensitive-field protections used for `.env` and JSON.
- Added the rollback-safe fleet registry foundation for multiple servers and bot deployments, with automatic migration of the current Hachi target.
- Added a native Hachi bot definition and validated external JSON bot profiles for optional bots; Hachi remains the only bundled bot type.
- Added Fleet and Credentials workspaces for server/deployment registration, external bot discovery, scoped local/SSH PM2 controls, health checks, redacted logs, and deployment-local encrypted Discord credentials.
- Added deployment-local credential fingerprints that block multiple ordinary deployments from starting the same Discord test identity concurrently without storing another token copy.
- Added generic security audits, AES-256-GCM fleet database backups/restores, automatic backup and retention policies, log retention, and adapter-driven database encryption with rollback.
- Added transactional fleet Git updates, external command adapters, Discord command deployment, and external bot-definition installation/removal.
- Added preservation-first external-bot onboarding with a permission preview, immutable capability approval snapshots, definition fingerprints, and deployment repository origin/branch/ecosystem verification.
- Added a guided production-bot onboarding flow that inspects a selected Git repository, detects package scripts, PM2 configuration, database and log paths, previews the generated capabilities, and stores the approved profile under `Profiles/Bots` without changing the bot repository.
- Added multiple local Testing identities under `Profiles/Testing`, with Windows-user-protected values in profile `.env` files, one optional default identity, and 60-second clipboard copy controls.
- Added temporary local bot testing from the Testing tab, including reviewed test-entry detection, in-memory credential injection, parallel production/test operation, redacted process output, and managed stop/exit state.
- Added confirmed test-command resets that delete global and guild commands only from the selected shared test application, then run the selected bot's test deployment adapter with test credentials injected in memory.

### Changed

- External database protection controls now follow the same state-driven lifecycle as Hachi: verified encrypted installations show **Rotate Key**, plaintext installations show **Encrypt Database**, and key export uses the selected bot's approved adapter without passing key material through the renderer. Rotation requires a separately declared and preflighted `database:rotate` package command, while Rotate Backups re-encrypts each selected deployment backup with a new OS-protected envelope key instead of invoking retention pruning.
- Fixed shared action completion repainting native Hachi state over a selected external bot. Paldeck Verify now refreshes through its active local or remote deployment and retains that audit's actual database header, protection status, and controls.
- Added a final read-only encryption preflight against the currently selected installation. HachiGen now requires the encryption and verification scripts, repository adapters, declared runtime SQLCipher package, resolvable installed driver, and expected adapter functions before creating a backup, stopping a bot, or changing any database bytes.
- Changed isolated testing database protection from automatic startup conversion to an explicit, source-aware Database action. Plain test databases now show **Encrypt Data**, encrypted test databases show **Rotate Key**, and successful actions immediately refresh the selected testing status.
- Fixed saved external bot profiles disappearing after requesting the generated `databaseToolConnection` capability by adding that capability to the external-profile validation allowlist.
- Added a lightweight startup snapshot, selected-bot-first loading, tab-level lazy loading for Configuration, Logs, Testing, Database details, and Diagnostics, concurrent local probes, and ordered remote probes.
- Replaced deployment-ID UI selection with a stable logical bot selection and a per-bot active installation target. Shared operations now resolve Local Development or Remote Server immediately before execution, matching Hachi's runtime-target pathway.
- Reused the native Hachi Dashboard, Setup, Updates, Database, Logs, Testing, and Diagnostics compositions for selected additional bots instead of maintaining parallel Fleet panels and action rows; adapters now populate the shared controls and disable only unsupported capabilities.
- Reduced Fleet deployment rows to Select and Remove and removed the redundant Fleet Activity panel; operational status and controls remain on Dashboard and the selected bot's shared views.
- Replaced the alternate external-bot Database page with Hachi's shared Database composition. Capability-aware backup, restore, verification, encryption, protection status, current database, backup history, retention controls, and a generic read-only SQLite viewer now render in the same sections; unsupported sanitation is identified explicitly.
- Fixed additional-bot database viewing incorrectly invoking Hachi's remote database worker, which could surface an unrelated `EAGAIN` read failure.
- Allowed the confined read-only additional-bot Data Viewer to remain available when a Bot Profile has changed, while continuing to require reapproval for commands and mutations.
- Moved additional-bot backup retention into Backups and log retention into Logs instead of presenting an unmatched general Maintenance section.
- Expanded packaged UI smoke testing from a window-load check to renderer workflow assertions covering shared navigation, bot selection, local/remote controls, Configuration, and Testing controls.
- Changed packaged smoke executable selection to prefer the freshly built unpacked application over a potentially stale portable artifact.
- Changed packaged smoke executable selection to prefer the freshly built unpacked application over a potentially stale portable artifact.
- Extracted shared `.env` and structured-configuration parsing, sensitivity classification, and safe nested-value updates from the backend coordinator into a focused configuration module.
- Expanded failed Fleet update recovery to restore the prior commit, reinstall its dependencies, restore the encrypted database backup, and restart a previously online runtime; every recovery step is logged and included in the returned error.
- Reduced Fleet bot inventory rows to Select, Health, and Remove. Runtime, logs, updates, command deployment, credentials, and database operations remain in Dashboard and the selected bot's shared views.
- Removed the separate additional-bot setup composition. The selected bot now uses Hachi's native Install, validation, cron reference, Runtime Location, Remote Connection controls, connection testing, and Connection Preview directly; only Configuration swaps to repository-derived fields.
- Additional-bot remote saves now resolve or create the server-level Fleet connection from the shared Hachi remote form, then attach the bot installation without creating another credential store.
- Separated profile default branches from installation branches. Local setup may use a feature branch while remote production tracks `main`; repository-origin and named-branch validation remain enforced. Live Git status now overrides onboarding snapshots so Bot Profile and updates follow a branch changed after the installation was added.
- Refactored Hachi and additional-bot rendering to share status-card and install-check components plus the same runtime, update, deployment, and secret-copy action names. Bot adapters now supply data without creating parallel control behavior.
- Standardized major view, nested panel, and button-group spacing; removed compounded panel margins and matched input-attached button heights to their fields. External configuration is now one continuous form without source-file separator headings. Runtime installation selectors are compact, connection actions have proper separation, and all credential Copy controls use the shared icon.
- Added one persistent logical-bot selector to the global header. Dashboard, Bot, Updates, Database, Logs, Testing, and Diagnostics now follow Hachi or the selected additional deployment without adding Local/Remote suffixes to bot names.
- Returned Fleet to connection, bot, and profile inventory management by removing its duplicate selected-bot dashboard and selector. External runtime controls, repository updates, Discord command deployment, logs, database audit/backup, and testing now use the shared bot context.
- Changed the Hachi navigation item and selected-bot page title dynamically to the selected bot name while preserving Hachi's existing native setup and local/remote controls unchanged.
- Replaced the sparse additional-bot summary with the native Hachi management layout and repository-derived Configuration fields.
- Added repository-backed JSON configuration forms with sensitive-field redaction, atomic writes, and hash-based external-change detection; added named-tab remote installation attachment and logical-bot runtime switching.
- Expanded repository-backed configuration to `.env` files. Token, secret, password, and key values are write-only in the renderer, blank replacements preserve existing values, and saves update only the bot's original file.
- Added 60-second self-clearing clipboard controls for hidden external-bot configuration values without including those values in renderer state.
- Aligned the global bot selector with the Open Folder and Refresh buttons, and changed additional-bot onboarding to require a local repository before any remote production installation is attached.
- Fixed the shared form-field cascade from reintroducing a vertical offset on the global bot selector.
- Changed credential management so each bot folder is the sole credential store. HachiGen passes credentials to the bot's encrypted storage adapter over stdin and retains only non-secret identity metadata.
- Changed external credentials to remain unmanaged by default. HachiGen can write them only when a reviewed definition explicitly opts into adapter mode and the `secretEncryption` capability.
- Redesigned Fleet around neutral additional-bot onboarding, removed built-in bot references and project-specific placeholders, and moved technical support-file JSON behind an explained advanced disclosure that matches the rest of the interface.
- Consolidated Setup, Fleet, Credentials, and Fleet Security onto shared field, select, textarea, choice, section-header, empty-state, help-text, and form-action components for consistent sizing, typography, spacing, focus, and disabled states.
- Standardized the vertical gap above form action rows so Fleet add buttons no longer sit at different distances from their final fields.
- Made form-action spacing grid-independent and kept the PM2 process optional indicator inline with its label.
- Consolidated additional-bot information into Fleet by removing the Credentials page and adding a contextual credentials modal that appears only for approved adapters, including immediately after compatible bot onboarding.
- Renamed the Setup navigation destination to Hachi and moved it directly below Dashboard, while retaining the stable internal route and updating visible guide/action copy.
- Integrated Hachi's local/remote runtime target, SSH settings, connection testing, and preview into the Hachi page; removed the separate Remote navigation destination and redirected existing shortcuts to the embedded panel.
- Replaced Fleet's empty Bot Support selector with repository inspection, added a native folder picker for local bots, removed the Environment field, and treats every added bot as production.
- Renamed Fleet support records to Bot Profiles and migrated legacy external definitions by copying them into the new `Profiles/Bots` location so older builds remain rollback-compatible.
- Expanded diagnostics bundle export to include redacted Hachi runtime logs and PM2 snapshots alongside HachiGen logs.
- Updated vulnerable transitive build dependencies to patched releases, clearing npm audit findings for `brace-expansion`, `fast-uri`, `tar`, and `undici`.

### Fixed

- Removed duplicate initial additional-bot overview hydration and serialized saved remote overview/Hachi state probes to prevent simultaneous SSH banner exchanges from making valid installations appear missing until Test Connection was run.
- Testing identity guild IDs now render as a comma-separated list in the single-line editor instead of collapsing newline-separated IDs into one apparent number, and Data Viewer labels now sit inline with their selectors.
- Added a local Testing-tab profile review pathway so remote production outages cannot block approval of a bot's local testing adapter, and changed Hachi state refreshes to report failed SSH probes as unavailable component status instead of rejecting the complete state response.
- Testing actions now resolve the selected bot's current local installation by logical bot identity, refresh Fleet before rendering testing controls, and no longer submit stale or removed deployment IDs after Fleet changes.
- Fixed additional-bot local/remote switches retaining the prior installation's cached database rows; all location-bound Database, Configuration, backup, and log state now reloads for the active deployment.
- Isolated testing databases under each testing identity profile and refused to start database-backed bots that do not expose a supported test database-path environment variable.
- Fixed the generic remote SQLite viewer synchronously reading SSH stdin, which could still surface `EAGAIN: resource temporarily unavailable`.

- Allowed previously approved read-only PM2 log retrieval while a changed Bot Profile awaits reapproval, while continuing to block changed-profile commands and mutations. Database audits now skip changed-profile verification adapters instead of executing them.
- Added shared icons to Fleet's generated Select, Health, Edit, and Remove buttons and filled the icon map for the remaining Fleet, Testing, database, and profile actions.
- Added explicit editing for saved Fleet SSH connections, including key rotation and duplicate-endpoint validation while preserving stable server ids for attached deployments.
- Fixed remote Hachi Configuration reads intermittently timing out by replacing four concurrent 15-second SSH sessions with one structured, allowlisted remote read and a 30-second operation timeout. Remote saves reuse the same read path.
- Consolidated native and Fleet SSH connection tests onto one validated execution path, and stopped additional-bot remote saves from silently ignoring a newly selected key when a matching server connection already exists.
- Fixed the smoke-test CI workflow parser so split CI job assertions do not fail with an undefined helper.
- Fixed valid-version Fleet registries with an empty server list so Local computer is restored and Connection selectors submit a valid value.
- Fixed Fleet's generated-profile review so a fallback ecosystem filename is not presented as detected, rejected duplicate SSH endpoints, and added the shared validated SSH key picker to the connection form.
- Fixed removal of connections showing zero additional bots when a hidden legacy Hachi migration record was still attached; the native record is preserved on Local computer before removal.
- Fixed remote bot inspection by replacing positional shell output with validated JSON, rejecting missing Git identity before approval, detecting remote lockfiles correctly, and recovering Fleet state before profile installation.
- Fixed initial Fleet rendering by including stored Fleet state in the main startup snapshot, and added the missing Testing navigation icon.

## v1.1.0 - 2026-07-16

### Added

- Added a standard NSIS Windows installer alongside the portable executable, with richer app metadata, an install-directory wizard, optional desktop shortcut support, an installed uninstaller, and a build step that copies `HachiGen-Setup-X.X.X.exe` to the repository root while removing stale root installer copies.
- Added release SHA-256 checksum publishing plus HachiGen self-update download verification and executable validation before install.
- Added an in-app About/release-notes modal with app identity, storage paths, log paths, settings paths, and release notes.
- Added a first-run setup guide for validating Hachi, checking configuration, reviewing updates, and starting the runtime.
- Added File menu runtime archive export/restore for moving Hachi project data, including a secrets-and-keys confirmation, manifest validation, default `exports/` output, and local safety backups.
- Added a `Backup / Transfer` database modal that can back up, restore, pull from remote, or push to remote with destination safety backups.
- Added database transfer and restore progress/result modals with explicit source, destination, transferred-size, and safety-backup details.
- Added a Diagnostics view with sanitized diagnostics bundle export, copied diagnostics, recent events, redacted HachiGen logs, log-folder access, and recovery summaries.
- Added remembered remote connection-test status to the Remote preview.
- Added single-instance behavior, saved window bounds, and startup recovery reporting after a previous renderer/process failure.
- Added packaged UI smoke testing for release builds.
- Added `.gitattributes` line-ending normalization so text files stay LF under Windows Git settings.

### Changed

- Reworked the Dashboard into an operations overview with runtime controls, target, update, activity, and common-action panels.
- Refined the Dashboard operations overview with a single check-updates control and bottom-aligned action rows across target, update, and activity cards.
- Reworked the Updates page around one combined Hachi/HachiGen check, version-focused Hachi and HachiGen summaries, and a saved-changes recovery panel that appears only when a stash exists.
- Moved Saved Changes restore/delete controls into the Updates card header and removed the ellipsis from the Database `Backup / Transfer` button.
- Changed database pull/push transfers to re-encrypt the transferred copy with the destination database key and verify it opens there, instead of copying the source encrypted file as-is.
- Changed the Hachi update flow to confirm local added/modified/deleted files before HachiGen saves them to a recoverable stash and updates.
- Changed the setup guide ordering so checking or reviewing updates happens before `Start Hachi`, including after switching runtime targets.
- Tightened the app's dark palette, spacing, panel density, sidebar scrolling, and modal spacing for a more compact desktop feel.
- Replaced the custom inline button/navigation icon paths with inline Lucide SVG shapes and tightened icon mappings for Dashboard, Diagnostics, support, remote, and validation actions.
- Added icon treatment, keyboard-friendly dashboard cards, stronger focus states, and more native-feeling button states.
- Consolidated repeated UI metadata by removing the global topbar path, keeping update panels focused on check state, and narrowing About to app identity and app storage locations.
- Improved action error messages so UI failures include the action context and a concise, redacted command reason when available.
- Enabled Electron renderer sandboxing while keeping the existing context-isolated preload IPC bridge.
- Added a Content Security Policy and stricter external-link allow-listing for renderer navigation.
- Replaced the broad starter `.gitignore` with HachiGen-specific ignores for local agent files, dependencies, builds, environment files, logs, and tool caches.
- Simplified the HachiGen self-update panel copy and changed the HachiGen update button so it switches from `Check Updates` to `Update` when an update is available.
- Updated HachiGen package metadata to version `1.1.0`.

### Fixed

- Fixed release builds so Electron Builder cannot implicitly publish from CI during `npm run dist`; GitHub release uploads remain handled by the release workflow.
- Fixed Windows npm/PM2 shim launching so local update dependency installs can run from paths like `C:\Program Files\nodejs\npm.cmd`.
- Paused visible log-window redraws while text is selected so periodic log refreshes do not interrupt copying PM2 or HachiGen output.
- Fixed remote database table reads that could fail with `spawn ENAMETOOLONG` by streaming remote worker source and database worker requests through stdin instead of command-line arguments.
- Fixed HachiGen self-update relaunch handling so the running app exits decisively and the updater logs the relaunched process ID.
- Fixed the app shell layout so the sidebar stays viewport-sized while long pages scroll in the main content pane.
- Fixed the smoke-test workflow parser so split CI job assertions do not fail with an undefined helper.

## v1.0.2 - 2026-07-14

### Changed

- Updated HachiGen package metadata to version `1.0.2`.
- HachiGen releases now build from the standalone HachiGen repository and upload `dist/HachiGen.exe`.

### Fixed

- Fixed HachiGen self-update checks so a missing `HachiGen.exe` release asset shows as unavailable instead of throwing an IPC error.
- Fixed HachiGen self-updates so they use an in-app wizard with progress, run the replacement helper hidden, wait on the old app safely, and force HachiGen to exit if normal shutdown stalls.
- Hardened HachiGen shell command launching by resolving allowed executables before spawning and avoiding inherited environment expansion in spawn options.
