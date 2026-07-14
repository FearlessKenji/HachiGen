# Changelog

Notable changes to HachiGen are documented here.

## Unreleased

### Changed

- Split HachiGen into its own repository with standalone CI, smoke tests, linting, and release automation.

## v1.0.2 - 2026-07-14

### Changed

- Updated HachiGen package metadata to version `1.0.2`.
- HachiGen releases now build from the standalone HachiGen repository and upload `dist/HachiGen.exe`.

### Fixed

- Fixed HachiGen self-update checks so a missing `HachiGen.exe` release asset shows as unavailable instead of throwing an IPC error.
- Fixed HachiGen self-updates so they use an in-app wizard with progress, run the replacement helper hidden, wait on the old app safely, and force HachiGen to exit if normal shutdown stalls.
- Hardened HachiGen shell command launching by resolving allowed executables before spawning and avoiding inherited environment expansion in spawn options.
