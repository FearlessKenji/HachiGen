# External bot definitions

Hachi is the only bot type built into HachiGen. Paldeck and every other optional bot are installed as external JSON definitions from the Fleet page. Removing a definition does not delete its repository or server files.

## Example

```json
{
  "id": "paldeck",
  "displayName": "Paldeck",
  "repository": {
    "url": "https://github.com/OWNER/Paldeck.git",
    "branch": "main"
  },
  "runtime": {
    "ecosystemFile": "config/ecosystem.config.js",
    "pm2Name": "Paldeck"
  },
  "paths": {
    "database": "database/database.sqlite",
    "environment": ".env",
    "logs": "logs"
  },
  "capabilities": {
    "backups": true,
    "databaseEncryption": true,
    "discordCommands": true,
    "gitUpdates": true,
    "logs": true,
    "pm2": true
  },
  "commands": {
    "install": { "executable": "npm", "args": ["install"] },
    "validate": { "executable": "npm", "args": ["run", "check"] },
    "deployCommands": { "executable": "npm", "args": ["run", "deploy"] },
    "databaseEncrypt": { "executable": "npm", "args": ["run", "database:encrypt"] },
    "databaseVerify": { "executable": "npm", "args": ["run", "database:verify"] }
  }
}
```

Only `node`, `npm`, `npx`, `pnpm`, `yarn`, and `git` commands are accepted. Commands are passed as an executable and argument array instead of an arbitrary shell string. Paths must be relative to the deployment root and cannot contain traversal segments.

## Database contract

`databaseEncrypt` must convert the declared database to encrypted-at-rest storage without changing its logical data. `databaseVerify` must exit successfully only after opening the database with its configured key and performing a basic read. HachiGen creates an encrypted recovery backup, stops the deployment, runs both operations, inspects the SQLite header, and restores the recovery backup when verification fails.

An encrypted-looking file is reported as `encrypted-unverified` until `databaseVerify` succeeds. A normal `SQLite format 3` header is reported as noncompliant.

## Credentials

Credential profiles are encrypted through Electron's operating-system credential protection. When a profile is assigned, HachiGen injects it into the process environment without creating a plaintext `.env` file. Remote credentials travel through SSH standard input rather than command arguments. HachiGen does not run `pm2 save` for an injected profile because the PM2 dump could persist its environment.

Shared profiles are exclusive by default. Starting or restarting one deployment is blocked while another known deployment using the same profile is online. Enable concurrent use only for an intentional clustered or sharded bot.

## Backup format

Fleet backups use the `HGBK1` container with AES-256-GCM authenticated encryption. Each backup gets an independent random key; the key is protected locally by the operating system and is never written beside the backup. Backup records are bound to their source server and deployment to prevent accidental cross-target restores.
