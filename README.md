# HachiGen

HachiGen is the desktop manager for [Hachi](https://github.com/FearlessKenji/Hachi). It installs, configures, validates, updates, starts, stops, and inspects a selected Hachi bot folder.

HachiGen is split from the Hachi bot repository so manager updates can ship independently from bot releases.

## What It Manages

- Local and remote Hachi install paths
- `.env` and `config/config.json` setup
- Encrypted secret and database key preparation
- Hachi Git updates and recoverable update stashes
- Slash-command deployment
- PM2 start, stop, restart, status, and logs
- Database backups, restore, schema review, sanitation, migration, and encryption lifecycle
- HachiGen self-updates from `hachigen-vX.X.X` releases

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

Build the portable Windows executable:

```console
npm run dist
```

The executable is created at `dist/HachiGen.exe` and is uploaded by the release workflow.

## Release Track

HachiGen releases use `hachigen-vX.X.X` tags from this repository's `package.json`. Hachi bot releases use `hachi-vX.X.X` tags in the Hachi repository.

Release history is in [CHANGELOG.md](CHANGELOG.md). User-facing notes are in [docs/patch-notes.md](docs/patch-notes.md).
