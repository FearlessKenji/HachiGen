# HachiGen

HachiGen is the desktop manager for [Hachi](https://github.com/FearlessKenji/Hachi). It installs, configures, validates, updates, starts, stops, and inspects a selected Hachi bot folder.

HachiGen is split from the Hachi bot repository so manager updates can ship independently from bot releases.

## Install From A Clone

Run the installer in the repository root:

```text
HachiGen-Setup-X.X.X.exe
```

It is a standard Windows install wizard. It installs per user by default under AppData, lets you choose another install folder, and offers the desktop shortcut option.

The installer creates an app folder that includes `HachiGen.exe` and `Uninstall HachiGen.exe`.

## What It Manages

- Multiple local or SSH servers and bot deployments through the Fleet workspace
- Native Hachi deployments plus validated external bot definitions for optional bots
- Deployment-local encrypted Discord credentials with shared-test-bot concurrency protection and no secondary HachiGen credential vault
- Scoped PM2 runtime controls, Git updates, Discord command deployment, health checks, and redacted logs
- Fleet-wide database security audits, encrypted backups/restores, retention, and adapter-driven encryption with rollback
- Local and remote Hachi install paths
- `.env` and `config/config.json` setup
- Encrypted secret and database key preparation
- Hachi Git updates and recoverable update stashes
- Slash-command deployment
- PM2 start, stop, restart, status, and logs
- Database backups, restore, schema review, sanitation, migration, and encryption lifecycle
- HachiGen self-updates from `hachigen-vX.X.X` releases

Hachi remains the only bot type bundled with HachiGen. See [External bot definitions](docs/bot-definitions.md) to add Paldeck or another optional bot.

## Development

HachiGen expects a sibling Hachi checkout during local development:

```text
GitHub/
  Hachi/
  HachiGen/
```

Run from this repository:

```console
npm ci
npm run check
npm run lint
npm run smoke
npm start
```

Build the Windows release artifacts:

```console
npm run dist
```

The release build creates:

- `HachiGen-Setup-X.X.X.exe` in the repository root for the assisted Windows installer.
- `dist/HachiGen.exe` for the portable executable and HachiGen self-updates.
- `dist/HachiGen-Setup-X.X.X.exe` as Electron Builder's installer output copy.
- `dist/SHA256SUMS.txt` in GitHub releases so downloads can be checked against published SHA-256 hashes.

For one-off builds, use `npm run dist:installer` or `npm run dist:portable`.

Release builds are unsigned by default. If a maintainer chooses to sign artifacts in GitHub Actions, add `HACHIGEN_WIN_CSC_LINK` and `HACHIGEN_WIN_CSC_KEY_PASSWORD` repository secrets; they are passed to electron-builder as `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`.

## Release Track

HachiGen releases use `hachigen-vX.X.X` tags from this repository's `package.json`. Hachi bot releases use `hachi-vX.X.X` tags in the Hachi repository.

Release history is in [CHANGELOG.md](CHANGELOG.md). User-facing notes are in [docs/patch-notes.md](docs/patch-notes.md).
