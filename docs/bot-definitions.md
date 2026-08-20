# Bot profiles

Hachi is the only bot type built into HachiGen. Every additional bot uses a JSON profile managed from Fleet. Removing a profile does not delete its repository or server files.

The normal Fleet wizard inspects the selected local repository or remote SSH path and proposes a profile from its Git origin, branch, package scripts, PM2 ecosystem file, database, and log paths. HachiGen shows that proposal before saving it under its application-data `Profiles/Bots` folder. Inspection and profile creation do not write into the bot repository. Legacy files are copied into this folder during migration and retained in their old location for rollback compatibility.

## Example

```json
{
  "id": "optional-bot",
  "displayName": "Optional Bot",
  "repository": {
    "url": "https://github.com/OWNER/OptionalBot.git",
    "branch": "main"
  },
  "runtime": {
    "ecosystemFile": "config/ecosystem.config.js",
    "pm2Name": "OptionalBot"
  },
  "credentials": {
    "mode": "adapter"
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
    "pm2": true,
    "secretEncryption": true
  },
  "commands": {
    "install": { "executable": "npm", "args": ["install"] },
    "validate": { "executable": "npm", "args": ["run", "check"] },
    "deployCommands": { "executable": "npm", "args": ["run", "deploy"] },
    "credentialsWrite": { "executable": "npm", "args": ["run", "credentials:write"] },
    "databaseEncrypt": { "executable": "npm", "args": ["run", "database:encrypt"] },
    "databaseVerify": { "executable": "npm", "args": ["run", "database:verify"] }
  }
}
```

Only `node`, `npm`, `npx`, `pnpm`, `yarn`, and `git` commands are accepted. Commands are passed as an executable and argument array instead of an arbitrary shell string. Paths must be relative to the deployment root and cannot contain traversal segments.

Before installation, HachiGen displays the repository identity, credential mode, capabilities, commands, and declared paths for approval. A deployment is accepted only when its checked-out Git origin and current branch match the profile. An ecosystem file is also required when the profile enables PM2 control. The approved capability set and profile fingerprint are stored with the deployment; changing the installed profile blocks privileged actions until the deployment is deliberately reviewed and added again.

Capabilities are restrictive permissions. PM2 control, log access or deletion, Git updates, Discord command deployment, backups, database encryption, and credential writing are unavailable unless their corresponding capability was approved. Read-only health and security inspection remain available where possible.

## Database contract

`databaseEncrypt` must convert the declared database to encrypted-at-rest storage without changing its logical data. `databaseVerify` must exit successfully only after opening the database with its configured key and performing a basic read. HachiGen creates an encrypted recovery backup, stops the deployment, runs both operations, inspects the SQLite header, and restores the recovery backup when verification fails.

An encrypted-looking file is reported as `encrypted-unverified` until `databaseVerify` succeeds. A normal `SQLite format 3` header is reported as noncompliant.

## Credentials

Credentials have exactly one source of truth: the bot's own deployment. HachiGen does not keep a credential vault or retain token ciphertext in AppData.

The default `credentials.mode` is `external`. In that mode HachiGen never asks for, reads, moves, rewrites, or deletes the bot's `.env`, JSON, YAML, or other credential files. The bot continues to start using its existing configuration.

An external bot may explicitly use `credentials.mode: "adapter"`. That mode requires both the `secretEncryption` capability and a `credentialsWrite` command. After the user approves those permissions, `credentialsWrite` receives a JSON object through standard input containing `token`, `clientId`, `clientSecret`, `publicKey`, and `guildIds`. The bot's adapter must encrypt and save those values using its normal local credential format and must not print them. Hachi uses its native encrypted secret-storage implementation.

HachiGen retains only a one-way token fingerprint and application ID as non-secret deployment metadata. The fingerprint allows HachiGen to block two known deployments using the same Discord identity from running concurrently unless the user explicitly permits it.

## Testing identities

Testing identities are separate from production-bot credentials. HachiGen stores each identity under `Profiles/Testing/<profile-id>` with non-secret metadata in `profile.json` and Windows-user-protected values in `secrets.env`. The `.env` contains only `os:v1:` protected values; there is no second key file or additional vault. Multiple identities are supported, and at most one may be marked as the optional default.

The renderer receives only field-presence metadata. A Copy action asks the main process to decrypt one value, places it on the clipboard, and clears the clipboard after 60 seconds if it has not changed. Plaintext is not returned to the renderer or written to logs.

To run a test, add the bot as a local Fleet deployment, save a Testing identity, stop that deployment's production PM2 process, and select both under **Run a Bot with a Testing Identity**. HachiGen recognizes `start-test.js`, `test.js`, or `scripts/start-test.js`; Hachi uses `index.js`. It starts the entry point as a temporary child process with `TOKEN`, `clientId`, `testTOKEN`, and `testID` injected in memory. This supports bots that read the standard variables as well as test entry points that map `testTOKEN`/`testID` onto them. The bot's `.env`, JSON, YAML, and other credential files are not rewritten.

Testing launches are currently local-only. Process output is truncated and redacted in the Testing tab, and active testing children receive a stop signal when HachiGen exits.

## Backup format

Fleet backups use the `HGBK1` container with AES-256-GCM authenticated encryption. Each backup gets an independent random key; the key is protected locally by the operating system and is never written beside the backup. Backup records are bound to their source server and deployment to prevent accidental cross-target restores.
