# Changelog

Notable changes to HachiGen are documented here.

## Unreleased

### Added

- Added the rollback-safe fleet registry foundation for multiple servers and bot deployments, with automatic migration of the current Hachi target.
- Added a native Hachi bot definition and validated external JSON bot definitions for optional bots such as Paldeck; Hachi remains the only bundled bot type.
- Added Fleet and Credentials workspaces for server/deployment registration, external bot discovery, scoped local/SSH PM2 controls, health checks, redacted logs, and deployment-local encrypted Discord credentials.
- Added deployment-local credential fingerprints that block multiple ordinary deployments from starting the same Discord test identity concurrently without storing another token copy.
- Added generic security audits, AES-256-GCM fleet database backups/restores, automatic backup and retention policies, log retention, and adapter-driven database encryption with rollback.
- Added transactional fleet Git updates, external command adapters, Discord command deployment, and external bot-definition installation/removal.
- Added preservation-first external-bot onboarding with a permission preview, immutable capability approval snapshots, definition fingerprints, and deployment repository origin/branch/ecosystem verification.

### Changed

- Changed credential management so each bot folder is the sole credential store. HachiGen passes credentials to the bot's encrypted storage adapter over stdin and retains only non-secret identity metadata.
- Changed external credentials to remain unmanaged by default. HachiGen can write them only when a reviewed definition explicitly opts into adapter mode and the `secretEncryption` capability.
- Redesigned Fleet around neutral additional-bot onboarding, removed built-in bot references and project-specific placeholders, and moved technical support-file JSON behind an explained advanced disclosure that matches the rest of the interface.
- Consolidated Setup, Fleet, Credentials, and Fleet Security onto shared field, select, textarea, choice, section-header, empty-state, help-text, and form-action components for consistent sizing, typography, spacing, focus, and disabled states.
- Standardized the vertical gap above form action rows so Fleet add buttons no longer sit at different distances from their final fields.
- Expanded diagnostics bundle export to include redacted Hachi runtime logs and PM2 snapshots alongside HachiGen logs.
- Updated vulnerable transitive build dependencies to patched releases, clearing npm audit findings for `brace-expansion`, `fast-uri`, `tar`, and `undici`.

### Fixed

- Fixed the smoke-test CI workflow parser so split CI job assertions do not fail with an undefined helper.

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
