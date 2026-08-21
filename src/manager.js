// Backend coordinator for HachiGen.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const https = require("node:https");
const zlib = require("node:zlib");
const { Buffer } = require("node:buffer");
const { URL } = require("node:url");
const {
	HachiGenLogger,
	getDefaultHachiGenUserDataPath,
	redactHachiGenLogText,
} = require("./hachigenLogger.js");
const { commandExists, run } = require("./shell.js");
const {
	loadBotDefinitions,
	normalizeDeployment,
	normalizeFleetRegistry,
	normalizeServer,
	validateExternalBotDefinition,
	writeFleetRegistry,
} = require("./botRegistry.js");

// This file contains HachiGen's backend coordinator.
// The renderer never edits files or runs commands directly; it asks this class
// to validate installs, save configuration, check Git updates, deploy commands,
// and control the Hachi PM2 process.

// The repository HachiGen clones when the selected install folder is empty.
const REPO_URL = "https://github.com/FearlessKenji/Hachi.git";
const UPDATE_REMOTE = "origin";
const UPDATE_BRANCH = "main";
const UPDATE_TARGET = `${UPDATE_REMOTE}/${UPDATE_BRANCH}`;
const HACHIGEN_RELEASE_TAG_PREFIX = "hachigen-v";
const HACHIGEN_RELEASE_API = "https://api.github.com/repos/FearlessKenji/HachiGen/releases?per_page=50";
const HACHIGEN_RELEASES_URL = "https://github.com/FearlessKenji/HachiGen/releases";
const HACHIGEN_ASSET_NAME = "HachiGen.exe";
const DEFAULT_SSH_PORT = 22;
const DIAGNOSTIC_RUNTIME_LOG_LIMIT = 5;
const DIAGNOSTIC_RUNTIME_LOG_MAX_BYTES = 256 * 1024;
const DIAGNOSTIC_PM2_LOG_LINES = 240;
const DISCORD_API_BASE = "https://discord.com/api/v10";

function discordApiRequest(method, route, token, body = null) {
	// Test-command cleanup talks directly to Discord so it can bulk-overwrite
	// only the selected test application's commands without invoking bot code.
	return new Promise((resolve, reject) => {
		const payload = body === null ? null : Buffer.from(JSON.stringify(body));
		const request = https.request(`${DISCORD_API_BASE}${route}`, {
			headers: {
				Accept: "application/json",
				Authorization: `Bot ${token}`,
				...(payload ? { "Content-Length": payload.length, "Content-Type": "application/json" } : {}),
				"User-Agent": "HachiGen Test Command Manager",
			},
			method,
		}, response => {
			const chunks = [];
			response.on("data", chunk => chunks.push(Buffer.from(chunk)));
			response.on("end", () => {
				const text = Buffer.concat(chunks).toString("utf8");
				if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
					reject(new Error(`Discord API returned HTTP ${response.statusCode}: ${text.slice(0, 240)}`));
					return;
				}
				resolve(text ? parseJsonText(text, null) : null);
			});
			response.on("error", reject);
		});
		request.setTimeout(60000, () => request.destroy(new Error("Discord API request timed out.")));
		request.on("error", reject);
		if (payload) {
			request.write(payload);
		}
		request.end();
	});
}

function createUncheckedUpdateState(message = "Updates have not been checked yet.") {
	return {
		status: "unchecked",
		available: false,
		checkedAt: null,
		updateTarget: UPDATE_TARGET,
		message,
	};
}

function createUncheckedHachiGenUpdateState(message = "HachiGen updates have not been checked yet.") {
	return {
		status: "unchecked",
		assetName: HACHIGEN_ASSET_NAME,
		assetSize: 0,
		assetUrl: "",
		checkedAt: null,
		currentTag: null,
		currentVersion: "",
		latestTag: null,
		releaseUrl: HACHIGEN_RELEASES_URL,
		canInstall: false,
		updateAvailable: false,
		message,
	};
}

// PM2 process name used by the bot itself. If this changes in Hachi's
// ecosystem config, it should change here too.
const PROCESS_NAME = "Hachi";
const MIN_NODE_VERSION = {
	label: "20.17.0",
	major: 20,
	minor: 17,
};

// Auto-stashes created by HachiGen use this text so they can be found later
// without confusing them with the user's own manual Git stashes.
const HACHIGEN_STASH_PREFIX = "HachiGen auto-stash before update";

const DEFAULT_REMOTE_SETTINGS = {
	host: "",
	username: "",
	sshKeyPath: "",
	portMode: "default",
	port: DEFAULT_SSH_PORT,
	remotePath: "",
	pm2Name: PROCESS_NAME,
};
const RUNTIME_ARCHIVE_FORMAT = "hachigen-runtime-archive-v1";
const RUNTIME_ARCHIVE_EXCLUDED_DIRECTORIES = new Set([
	".cache",
	".codex",
	".git",
	".next",
	"build",
	"coverage",
	"dist",
	"exports",
	"logs",
	"node_modules",
	"tmp",
]);
const RUNTIME_ARCHIVE_EXCLUDED_FILES = new Set([
	".DS_Store",
]);

// Values stored in the .env file. These are secrets or API/client IDs.
const ENV_FIELDS = [
	"TOKEN",
	"clientId",
	"twitchClientId",
	"twitchSecret",
	"kickClientId",
	"kickSecret",
];

// Values stored in config/config.json. These are bot settings rather than
// process environment variables.
const CONFIG_FIELDS = [
	"botOwners",
	"guildIds",
	"twitchCron",
	"kickCron",
	"birthdayCron",
	"statusCron",
	"authCron",
];

// Defaults used when a new config file is written and no value exists yet.
const CONFIG_DEFAULTS = {
	twitchCron: "*/1 * * * *",
	kickCron: "*/1 * * * *",
	birthdayCron: "0 * * * *",
	statusCron: "*/10 * * * *",
	authCron: "0 * * * *",
};

// Optional database-protection fields are managed from the Database tab. They
// stay out of the Setup form, but config saves must still preserve them.
const DATABASE_PROTECTION_ENV_FIELDS = [
	"HACHI_DB_ENCRYPTION",
	"HACHI_DB_KEY_FILE",
	"HACHI_DB_KEY",
];
const SECRET_PROTECTION_ENV_FIELDS = [
	"HACHI_SECRETS_ENCRYPTION",
	"HACHI_SECRETS_KEY_FILE",
	"HACHI_SECRETS_KEY",
];
const ENV_BOOTSTRAP_FIELDS = [
	...DATABASE_PROTECTION_ENV_FIELDS,
	...SECRET_PROTECTION_ENV_FIELDS,
];
const ENCRYPTED_SECRET_PREFIX = "enc:v1:aes-256-gcm:";
const CIPHER_DRIVER_PACKAGE = "better-sqlite3-multiple-ciphers";
const SQLITE_HEADER = Buffer.from([
	0x53,
	0x51,
	0x4c,
	0x69,
	0x74,
	0x65,
	0x20,
	0x66,
	0x6f,
	0x72,
	0x6d,
	0x61,
	0x74,
	0x20,
	0x33,
	0x00,
]);

// The database worker is copied to Electron's user-data folder before running.
// External Node cannot reliably execute files inside a packaged app.asar.
const DATABASE_WORKER_FILE = "database-worker.js";

// Check whether a file or folder exists. This tiny wrapper keeps the rest of
// the file readable when many validation steps ask "does this path exist?".
function fileExists(filePath) {
	return fs.existsSync(filePath);
}

// Decide whether a config value should count as incomplete. Blank strings and
// template placeholders both mean the user still needs to fill that field in.
function isMissingValue(value) {
	if (Array.isArray(value)) {
		return value.length === 0 || value.every(item => isMissingValue(item));
	}

	return value === undefined ||
		value === null ||
		String(value).trim() === "" ||
		String(value).includes("(REQUIRED)");
}

function normalizeConfigIdList(value) {
	if (Array.isArray(value)) {
		return [...new Set(value.flatMap(item => normalizeConfigIdList(item)).filter(Boolean))];
	}

	return [...new Set(String(value || "")
		.split(/[\s,]+/u)
		.map(item => item.trim())
		.filter(item => item && !item.includes("(REQUIRED)")))];
}

function normalizeProfileId(value, fallback = "profile") {
	const normalized = String(value || "").trim().toLowerCase()
		.replace(/[^a-z0-9_-]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 64);
	return normalized || `${fallback}-${crypto.randomUUID().slice(0, 8)}`;
}

function fleetRemoteInspectionScript(ecosystemCandidates, databaseCandidates, logCandidates, testEntryCandidates) {
	// Emit exactly one JSON object so empty optional fields cannot shift positional shell output.
	return `const fs=require('node:fs'),cp=require('node:child_process');` +
		`const first=(items,type)=>items.find(item=>{try{return fs.statSync(item)[type]();}catch{return false;}})||null;` +
		`const git=args=>cp.execFileSync('git',args,{encoding:'utf8'}).trim();` +
		`const optionalGit=args=>{try{return git(args);}catch{return '';}};` +
		`const packageJson=fs.existsSync('package.json')?JSON.parse(fs.readFileSync('package.json','utf8')):{};` +
		`const output={origin:git(['remote','get-url','origin']),branch:git(['branch','--show-current']),` +
		`defaultBranch:optionalGit(['symbolic-ref','--quiet','--short','refs/remotes/origin/HEAD']).split('/').pop(),packageJson,` +
		`packageLockFound:fs.existsSync('package-lock.json'),` +
		`ecosystemFile:first(${JSON.stringify(ecosystemCandidates)},'isFile'),` +
		`databasePath:first(${JSON.stringify(databaseCandidates)},'isFile'),` +
		`logsPath:first(${JSON.stringify(logCandidates)},'isDirectory'),` +
		`testEntry:first(${JSON.stringify(testEntryCandidates)},'isFile')};` +
		`process.stdout.write(JSON.stringify(output));`;
}

function idListForForm(value) {
	return normalizeConfigIdList(value).join("\n");
}

function normalizeConfigValuesForForm(values) {
	const botOwners = values.botOwners ?? values.ownerIds ?? values.botOwner ?? values.ownerId ?? [];
	const guildIds = values.guildIds ?? values.guildIDs ?? values.guildId ?? values.guildID ?? [];

	return {
		...values,
		botOwners: idListForForm(botOwners),
		guildIds: idListForForm(guildIds),
	};
}

function buildConfigValuesForSave(values) {
	return {
		// Keep these explicit so saved config only contains supported fields.
		botOwners: normalizeConfigIdList(values.botOwners ?? values.ownerIds ?? values.botOwner ?? values.ownerId),
		guildIds: normalizeConfigIdList(values.guildIds ?? values.guildIDs ?? values.guildId ?? values.guildID),
		twitchCron: values.twitchCron || CONFIG_DEFAULTS.twitchCron,
		kickCron: values.kickCron || CONFIG_DEFAULTS.kickCron,
		birthdayCron: values.birthdayCron || CONFIG_DEFAULTS.birthdayCron,
		statusCron: values.statusCron || CONFIG_DEFAULTS.statusCron,
		authCron: values.authCron || CONFIG_DEFAULTS.authCron,
	};
}

// Create a directory and any missing parent folders. This makes writes safe
// even when the selected install folder is brand new.
function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

// Default callback used when HachiManager is created without a visible window,
// such as during future tests or command-line experiments.
function noop() {
	return undefined;
}

// Read JSON safely. Missing or invalid files return the fallback so a damaged
// local config can be shown as "needs attention" instead of crashing HachiGen.
function readJson(filePath, fallback = null) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return fallback;
	}
}

function packageDependencyNames(packageJson) {
	return Object.keys(packageJson?.dependencies || {}).sort();
}

function missingPackageDependencies(root, packageJson) {
	return packageDependencyNames(packageJson).filter(packageName => {
		try {
			require.resolve(packageName, { paths: [root] });
			return false;
		} catch {
			return true;
		}
	});
}

function parseJsonText(text, fallback = {}) {
	try {
		return JSON.parse(String(text || ""));
	} catch {
		return fallback;
	}
}

function isSensitiveConfigKey(key) {
	return /(?:token|secret|password|private.?key|api.?key)/iu.test(String(key));
}

function flattenConfigValues(value, prefix = "", output = []) {
	for (const [key, child] of Object.entries(value || {})) {
		const field = prefix ? `${prefix}.${key}` : key;
		if (child && typeof child === "object" && !Array.isArray(child)) {
			flattenConfigValues(child, field, output);
		} else if (["string", "number", "boolean"].includes(typeof child)) {
			output.push({ key: field, type: typeof child, value: child });
		}
	}
	return output;
}

function setConfigValue(target, dottedKey, value) {
	const parts = String(dottedKey).split(".");
	if (!parts.length || parts.some(part => !part || ["__proto__", "constructor", "prototype"].includes(part))) {
		throw new Error("Configuration field is invalid.");
	}
	let cursor = target;
	for (const part of parts.slice(0, -1)) {
		if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) {
			throw new Error(`Configuration field ${dottedKey} no longer exists.`);
		}
		cursor = cursor[part];
	}
	if (!Object.hasOwn(cursor, parts.at(-1))) {
		throw new Error(`Configuration field ${dottedKey} no longer exists.`);
	}
	cursor[parts.at(-1)] = value;
}

// Parse Hachi's simple KEY=value .env files. HachiGen only needs enough parsing
// to load and save its known fields, so comments, blanks, and one quote layer
// are handled without bringing in a larger dotenv writer.
function parseDotEnvContent(content) {
	const values = {};
	const lines = String(content || "").split(/\r?\n/);

	for (const line of lines) {
		const trimmed = line.trim();

		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		const equalsIndex = trimmed.indexOf("=");

		if (equalsIndex === -1) {
			continue;
		}

		const key = trimmed.slice(0, equalsIndex).trim();
		let value = trimmed.slice(equalsIndex + 1).trim();

		if (value.startsWith("\"") && value.endsWith("\"")) {
			try {
				value = JSON.parse(value);
			} catch {
				value = value.slice(1, -1);
			}
		} else if (value.startsWith("'") && value.endsWith("'")) {
			value = value.slice(1, -1);
		}

		values[key] = value;
	}

	return values;
}

function parseDotEnv(filePath) {
	if (!fileExists(filePath)) {
		return {};
	}

	return parseDotEnvContent(fs.readFileSync(filePath, "utf8"));
}

// Format one value for .env output. JSON.stringify gives safe quoting for
// secrets that contain spaces, punctuation, or backslashes.
function formatEnvValue(value) {
	return JSON.stringify(String(value || ""));
}

function updateDotEnvContent(content, values) {
	const pending = new Map(Object.entries(values));
	const lines = String(content || "").split(/\r?\n/u);
	const output = [];

	for (const line of lines) {
		if (!line.trim()) {
			if (line || output.length) {
				output.push(line);
			}

			continue;
		}

		const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/u);

		if (!match || !pending.has(match[1])) {
			output.push(line);
			continue;
		}

		const key = match[1];
		output.push(`${key}=${formatEnvValue(pending.get(key))}`);
		pending.delete(key);
	}

	for (const [key, value] of pending) {
		output.push(`${key}=${formatEnvValue(value)}`);
	}

	return `${output.filter((line, index, collection) => line || index < collection.length - 1).join("\n")}\n`;
}

function buildEnvLines(merged, currentEnv = {}) {
	const envLines = ENV_FIELDS.map(field => `${field}=${formatEnvValue(merged[field])}`);
	const written = new Set(ENV_FIELDS);

	for (const field of ENV_BOOTSTRAP_FIELDS) {
		const value = merged[field];
		written.add(field);

		if (value !== undefined && value !== null && String(value).trim()) {
			envLines.push(`${field}=${formatEnvValue(value)}`);
		}
	}

	for (const field of Object.keys(currentEnv)) {
		if (written.has(field)) {
			continue;
		}

		const value = merged[field] ?? currentEnv[field];

		if (value !== undefined && value !== null && String(value).trim()) {
			envLines.push(`${field}=${formatEnvValue(value)}`);
		}
	}

	return envLines;
}

function isEncryptedSecretValue(value) {
	return String(value || "").startsWith(ENCRYPTED_SECRET_PREFIX);
}

function isSecretPlaceholderValue(value) {
	return String(value || "").includes("(REQUIRED)");
}

function isMissingSecretValue(value) {
	return value === undefined ||
		value === null ||
		String(value).trim() === "" ||
		isSecretPlaceholderValue(value);
}

function isProtectableEnvField(field) {
	return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(String(field || "")) &&
		!ENV_BOOTSTRAP_FIELDS.includes(field);
}

function envSecretProtectionMetadata(envValues) {
	const fields = {};
	const encryptedFields = [];
	const plaintextFields = [];

	for (const field of ENV_FIELDS) {
		const value = envValues[field];
		const hasValue = !isMissingSecretValue(value);
		const encrypted = hasValue && isEncryptedSecretValue(value);
		const plaintext = hasValue && !encrypted;

		if (encrypted) {
			encryptedFields.push(field);
		} else if (plaintext) {
			plaintextFields.push(field);
		}

		fields[field] = {
			copyable: encrypted,
			encrypted,
			hasValue,
			plaintext,
		};
	}

	return {
		encryptionEnabled: isEnabledValue(envValues.HACHI_SECRETS_ENCRYPTION),
		encryptedFields,
		fields,
		keyFile: envValues.HACHI_SECRETS_KEY_FILE || "",
		plaintextFields,
	};
}

function displayEnvValues(envValues) {
	const values = { ...envValues };

	for (const field of ENV_FIELDS) {
		values[field] = "";
	}

	return values;
}

function isEnabledValue(value) {
	return ["1", "on", "true", "yes", "prepared", "key-ready", "encrypted", "runtime", "active"].includes(String(value || "").trim().toLowerCase());
}

function generateDatabaseKey() {
	return crypto.randomBytes(32).toString("base64url");
}

function normalizeDatabaseKey(value) {
	return String(value || "").trim();
}

function resolveLocalPath(value, cwd = process.cwd()) {
	const expanded = expandWindowsEnv(value);

	if (!expanded) {
		return "";
	}

	if (expanded === "~") {
		return os.homedir();
	}

	if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
		return path.join(os.homedir(), expanded.slice(2));
	}

	return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}

function fileStatus(filePath) {
	if (!filePath) {
		return {
			exists: false,
			path: "",
			readable: false,
		};
	}

	try {
		const stats = fs.statSync(filePath);
		return {
			exists: stats.isFile(),
			modifiedAt: stats.mtime.toISOString(),
			path: filePath,
			readable: stats.isFile(),
			size: stats.size,
		};
	} catch {
		return {
			exists: false,
			path: filePath,
			readable: false,
		};
	}
}

function readTextFile(filePath, fallback = "") {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch {
		return fallback;
	}
}

function readTextFileTail(filePath, maxBytes = DIAGNOSTIC_RUNTIME_LOG_MAX_BYTES) {
	try {
		const stats = fs.statSync(filePath);

		if (!stats.isFile()) {
			return {
				error: "Path is not a file.",
				size: 0,
				text: "",
				truncated: false,
			};
		}

		const start = Math.max(0, stats.size - maxBytes);
		const length = stats.size - start;
		const fd = fs.openSync(filePath, "r");

		try {
			const buffer = Buffer.alloc(length);
			fs.readSync(fd, buffer, 0, length, start);
			const text = buffer.toString("utf8");

			return {
				modifiedAt: stats.mtime.toISOString(),
				size: stats.size,
				text: start > 0 ?
					`[HachiGen diagnostics: showing the last ${formatFileSize(maxBytes)} of ${formatFileSize(stats.size)}]\n${text.replace(/^[^\n]*(?:\r?\n)?/u, "")}` :
					text,
				truncated: start > 0,
			};
		} finally {
			fs.closeSync(fd);
		}
	} catch (error) {
		return {
			error: readableCause(error),
			size: 0,
			text: "",
			truncated: false,
		};
	}
}

function safeDiagnosticFileName(value, fallback = "log.txt") {
	const baseName = path.basename(String(value || "").trim())
		.split("")
		.map(char => (char.charCodeAt(0) < 32 || "<>:\"/\\|?*".includes(char) ? "_" : char))
		.join("")
		.replace(/^\.+$/u, "");

	return (baseName || fallback).slice(0, 80);
}

function writeJsonFile(filePath, value) {
	ensureDir(path.dirname(filePath));
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, "\t")}\n`, "utf8");
}

function removeLocalDatabaseSidecars(databasePath) {
	for (const sidecar of [`${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`]) {
		if (fileExists(sidecar)) {
			fs.rmSync(sidecar, { force: true });
		}
	}
}

function sha256Buffer(buffer) {
	const hash = crypto.createHash("sha256");
	hash.update(buffer);
	return hash.digest("hex");
}

function supportBundleStamp(date = new Date()) {
	return date.toISOString().replace(/\D/gu, "").slice(0, 14);
}

function runtimeArchiveStamp(date = new Date()) {
	return date.toISOString().replace(/\D/gu, "").slice(0, 14);
}

function normalizeArchivePath(value) {
	return String(value || "").replace(/\\/gu, "/").replace(/^\/+/u, "");
}

function assertSafeRelativeArchivePath(value, label = "archive path") {
	const normalized = normalizeArchivePath(value);

	if (!normalized || normalized.split("/").some(part => !part || part === "." || part === "..")) {
		throw new Error(`Invalid ${label}: ${value || "empty"}.`);
	}

	return normalized;
}

function isPathInside(root, filePath) {
	const relative = path.relative(path.resolve(root), path.resolve(filePath));
	return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isRuntimeArchiveExcludedDirectory(name) {
	return RUNTIME_ARCHIVE_EXCLUDED_DIRECTORIES.has(String(name || "").toLowerCase());
}

function isRuntimeArchiveExcludedFile(name) {
	return RUNTIME_ARCHIVE_EXCLUDED_FILES.has(String(name || ""));
}

function isSensitiveRuntimeArchivePath(relativePath) {
	const normalized = normalizeArchivePath(relativePath).toLowerCase();
	return normalized === ".env" ||
		normalized.endsWith(".key") ||
		normalized.includes("/keys/") ||
		normalized.startsWith("database/") ||
		normalized.startsWith("manager/backups/database/");
}

function readTarOctal(buffer, offset, length) {
	const text = buffer.toString("ascii", offset, offset + length).replace(/\0.*$/u, "").trim();
	return text ? Number.parseInt(text, 8) || 0 : 0;
}

function readTarName(buffer, offset) {
	return buffer.toString("utf8", offset, offset + 100).replace(/\0.*$/u, "");
}

function readTarGzEntries(archivePath) {
	const archiveBuffer = zlib.gunzipSync(fs.readFileSync(archivePath));
	const entries = new Map();
	let offset = 0;

	while (offset + 512 <= archiveBuffer.length) {
		const header = archiveBuffer.subarray(offset, offset + 512);

		if (header.every(byte => byte === 0)) {
			break;
		}

		const name = readTarName(header, 0);
		const size = readTarOctal(header, 124, 12);
		const typeFlag = header.toString("ascii", 156, 157);
		const contentStart = offset + 512;
		const contentEnd = contentStart + size;

		if (!name || contentEnd > archiveBuffer.length) {
			throw new Error("Runtime archive is damaged or incomplete.");
		}

		if (!typeFlag || typeFlag === "0") {
			entries.set(assertSafeRelativeArchivePath(name), Buffer.from(archiveBuffer.subarray(contentStart, contentEnd)));
		}

		offset = contentStart + Math.ceil(size / 512) * 512;
	}

	return entries;
}

function runtimeArchiveProjectFileEntry(filePath, restorePath, sourcePath = filePath) {
	const content = fs.readFileSync(filePath);

	return {
		bytes: content.length,
		content,
		restoreKind: "project",
		restorePath: normalizeArchivePath(restorePath),
		sensitive: isSensitiveRuntimeArchivePath(restorePath),
		sha256: sha256Buffer(content),
		sourcePath,
	};
}

function collectLocalProjectFiles(root) {
	const files = [];

	function visit(directory) {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!isRuntimeArchiveExcludedDirectory(entry.name)) {
					visit(path.join(directory, entry.name));
				}

				continue;
			}

			if (!entry.isFile() || isRuntimeArchiveExcludedFile(entry.name)) {
				continue;
			}

			const fullPath = path.join(directory, entry.name);
			const restorePath = normalizeArchivePath(path.relative(root, fullPath));
			files.push(runtimeArchiveProjectFileEntry(fullPath, restorePath));
		}
	}

	visit(root);
	return files;
}

function readRuntimeArchiveManifest(archivePath) {
	const entries = readTarGzEntries(archivePath);
	const manifestBuffer = entries.get("manifest.json");

	if (!manifestBuffer) {
		throw new Error("Runtime archive is missing manifest.json.");
	}

	const manifest = parseJsonText(manifestBuffer.toString("utf8"), null);

	if (!manifest || manifest.format !== RUNTIME_ARCHIVE_FORMAT || !Array.isArray(manifest.entries)) {
		throw new Error("Choose a HachiGen runtime archive.");
	}

	for (const entry of manifest.entries) {
		entry.archivePath = assertSafeRelativeArchivePath(entry.archivePath, "payload path");

		if (!entries.has(entry.archivePath)) {
			throw new Error(`Runtime archive is missing payload file ${entry.archivePath}.`);
		}

		const content = entries.get(entry.archivePath);

		if (entry.sha256 && sha256Buffer(content) !== entry.sha256) {
			throw new Error(`Runtime archive payload failed checksum verification: ${entry.archivePath}.`);
		}

		if (entry.restoreKind === "project") {
			entry.restorePath = assertSafeRelativeArchivePath(entry.restorePath, "restore path");
		} else if (!["database-key", "secrets-key"].includes(entry.restoreKind)) {
			throw new Error(`Runtime archive contains an unsupported restore kind: ${entry.restoreKind || "unknown"}.`);
		}
	}

	return {
		entries,
		manifest,
	};
}

function summarizeSettings(settings = {}) {
	const remote = normalizeRemoteSettings(settings.remote);

	return {
		activeStash: settings.activeStash ?
			{
				createdAt: settings.activeStash.createdAt || "",
				ref: settings.activeStash.ref || "",
			} :
			null,
		hachiGenReleaseTag: settings.hachiGenReleaseTag || null,
		installPath: settings.installPath || "",
		remote: {
			configured: Boolean(remote.host && remote.username && remote.remotePath),
			hasHost: Boolean(remote.host),
			hasSshKeyPath: Boolean(remote.sshKeyPath),
			lastTest: normalizeRemoteTestState(settings.lastRemoteTest),
			portMode: remote.portMode,
			pm2Name: remote.pm2Name || PROCESS_NAME,
		},
		runtimeTarget: settings.runtimeTarget === "remote" ? "remote" : "local",
	};
}

function redactUrlCredentials(value) {
	try {
		const parsed = new URL(String(value || ""));

		if (parsed.username) {
			parsed.username = "redacted";
		}

		if (parsed.password) {
			parsed.password = "redacted";
		}

		return parsed.toString();
	} catch {
		return redactHachiGenLogText(value);
	}
}

function normalizeGitRepositoryIdentity(value) {
	return String(value || "")
		.trim()
		.replace(/^git@([^:]+):/iu, "https://$1/")
		.replace(/^git\+ssh:\/\/git@/iu, "https://")
		.replace(/^ssh:\/\/git@/iu, "https://")
		.replace(/\.git\/?$/iu, "")
		.replace(/\/$/u, "")
		.toLowerCase();
}

function summarizeRepository(repository = {}) {
	return {
		currentBranch: repository.currentBranch || "",
		isGit: Boolean(repository.isGit),
		originUrl: redactUrlCredentials(repository.originUrl || ""),
		source: repository.source || "",
		updateTarget: repository.updateTarget || UPDATE_TARGET,
	};
}

function summarizeScan(scan = {}) {
	return {
		configurationMissing: scan.configurationMissing || [],
		configurationReady: Boolean(scan.configurationReady),
		dependenciesReady: scan.dependenciesReady !== false,
		hasConfig: Boolean(scan.hasConfig),
		hasEnv: Boolean(scan.hasEnv),
		hasGit: Boolean(scan.hasGit),
		hasNodeModules: Boolean(scan.hasNodeModules),
		installPath: scan.installPath || "",
		missingDependencies: scan.missingDependencies || [],
		missingFiles: scan.missingFiles || [],
		packageName: scan.packageName || "",
		packageVersion: scan.packageVersion || "",
		projectFound: Boolean(scan.projectFound),
		source: scan.source || "",
	};
}

function summarizeUpdateState(update = {}) {
	return {
		available: Boolean(update.available || update.updateAvailable),
		checkedAt: update.checkedAt || null,
		message: update.message || "",
		status: update.status || "unchecked",
		updateTarget: update.updateTarget || "",
		verification: update.verification || null,
	};
}

function databaseFileStatus(dbPath) {
	if (!dbPath || !fileExists(dbPath)) {
		return {
			detail: "No database file found.",
			dot: "muted",
			encryptedLikely: false,
			label: "Missing",
			path: dbPath || "",
			status: "missing",
		};
	}

	const stats = fs.statSync(dbPath);

	if (!stats.isFile()) {
		return {
			detail: "Database path exists but is not a file.",
			dot: "bad",
			encryptedLikely: false,
			label: "Invalid Path",
			path: dbPath,
			status: "invalid",
		};
	}

	if (stats.size < SQLITE_HEADER.length) {
		return {
			detail: "Database file is too small to be a valid encrypted database.",
			dot: "bad",
			encryptedLikely: false,
			label: "Invalid Format",
			path: dbPath,
			size: stats.size,
			status: "invalid",
		};
	}

	const handle = fs.openSync(dbPath, "r");
	const header = Buffer.alloc(SQLITE_HEADER.length);

	try {
		fs.readSync(handle, header, 0, SQLITE_HEADER.length, 0);
	} finally {
		fs.closeSync(handle);
	}

	if (header.equals(SQLITE_HEADER)) {
		return {
			detail: "Database is still plain SQLite.",
			dot: "info",
			encryptedLikely: false,
			label: "Plain SQLite",
			path: dbPath,
			size: stats.size,
			status: "plaintext",
		};
	}

	return {
		detail: "Database file is encrypted. Open it with the configured key to verify access.",
		dot: "info",
		encryptedLikely: true,
		label: "Encrypted",
		path: dbPath,
		size: stats.size,
		status: "encrypted",
	};
}

function loadDatabaseEncryptionModule(root) {
	const modulePath = path.join(root, "database", "dbEncryption.js");

	if (!fileExists(modulePath)) {
		return null;
	}

	try {
		const resolved = require.resolve(modulePath);
		delete require.cache[resolved];
		return require(resolved);
	} catch {
		return null;
	}
}

function databaseFileProtectionStatus(databaseFile, cipherTest, keyReady) {
	if (!databaseFile?.encryptedLikely) {
		return databaseFile;
	}

	if (!keyReady) {
		return {
			...databaseFile,
			detail: "Database is encrypted. Configure the database key to verify access.",
			dot: "warn",
			label: "Encrypted",
			status: "encrypted",
		};
	}

	if (["database-verified", "runtime-verified"].includes(cipherTest?.status)) {
		return {
			...databaseFile,
			detail: "Database opens with the configured key.",
			dot: "good",
			label: "Encrypted",
			status: "encrypted",
		};
	}

	if (cipherTest?.status === "database-invalid") {
		return {
			...databaseFile,
			detail: cipherTest.detail || "Database could not be opened with the configured key.",
			dot: "bad",
			encryptedLikely: false,
			label: "Invalid Format",
			status: "invalid",
		};
	}

	return {
		...databaseFile,
		detail: "Database file is encrypted. Use Verify to confirm key access.",
		dot: "info",
		label: "Encrypted",
		status: "encrypted",
	};
}

function findPackageJson(modulePath, packageName) {
	let currentDir = path.dirname(modulePath);

	while (currentDir && currentDir !== path.dirname(currentDir)) {
		const packagePath = path.join(currentDir, "package.json");

		if (fileExists(packagePath)) {
			try {
				const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

				if (packageJson.name === packageName) {
					return packagePath;
				}
			} catch {
				return "";
			}
		}

		currentDir = path.dirname(currentDir);
	}

	return "";
}

function cipherDriverStatus(root) {
	try {
		const modulePath = require.resolve(CIPHER_DRIVER_PACKAGE, { paths: [root] });
		const packagePath = findPackageJson(modulePath, CIPHER_DRIVER_PACKAGE);
		const packageJson = packagePath ? JSON.parse(fs.readFileSync(packagePath, "utf8")) : {};

		return {
			detail: "SQLCipher driver is installed and ready for encrypted database access.",
			dot: "good",
			installed: true,
			label: "Driver Installed",
			modulePath,
			packageName: CIPHER_DRIVER_PACKAGE,
			status: "installed",
			version: packageJson.version || "",
		};
	} catch (error) {
		return {
			detail: `${CIPHER_DRIVER_PACKAGE} is not available in node_modules. Install / Validate installs Hachi dependencies normally.`,
			dot: "warn",
			error: error.code || error.message || String(error),
			installed: false,
			label: "Driver Missing",
			packageName: CIPHER_DRIVER_PACKAGE,
			status: "missing",
			version: "",
		};
	}
}

function hybridDatabaseRuntimeStatus() {
	return {
		detail: "Hachi uses SQLCipher for database access while HACHI_DB_ENCRYPTION=encrypted is set.",
		dot: "good",
		encryptedRuntimeReady: true,
		label: "Runtime Ready",
		status: "runtime-ready",
	};
}

function databaseProtectionDetail(prefix, databaseFile) {
	if (databaseFile?.status === "encrypted") {
		return `${prefix} Database encryption is active.`;
	}

	if (databaseFile?.status === "missing") {
		return `${prefix} Hachi will create an encrypted database on first start.`;
	}

	if (databaseFile?.status === "plaintext") {
		return `${prefix} Plaintext database must be converted before Hachi starts.`;
	}

	if (databaseFile?.status === "invalid") {
		return `${prefix} Database file is not a valid encrypted Hachi database.`;
	}

	return `${prefix} Encrypted database runtime is ready.`;
}

function databaseProtectionSummary({ databaseFile, directKeyConfigured, encryptionEnabled, keyFileStatus }) {
	if (encryptionEnabled && keyFileStatus?.readable) {
		return {
			detail: databaseProtectionDetail(`Key file ready.`, databaseFile),
			dot: databaseFile?.status === "invalid" ? `bad` : databaseFile?.status === "plaintext" ? `warn` : `good`,
			label: databaseFile?.status === "invalid" ? `Invalid Database` : databaseFile?.status === "plaintext" ? `Plaintext Database` : `Key Ready`,
			status: `key-ready`,
		};
	}

	if (encryptionEnabled && keyFileStatus?.path && !keyFileStatus.readable) {
		return {
			detail: `Configured key file is missing or unreadable. Do not generate a replacement for an encrypted database.`,
			dot: `bad`,
			label: `Key Missing`,
			status: `key-missing`,
		};
	}

	if (encryptionEnabled && directKeyConfigured) {
		return {
			detail: databaseProtectionDetail(`Direct key configured.`, databaseFile),
			dot: databaseFile?.status === "invalid" ? `bad` : `warn`,
			label: databaseFile?.status === "invalid" ? `Invalid Database` : `Direct Key`,
			status: `direct-key`,
		};
	}

	return {
		detail: `Database encryption is required. Generate a key to prepare this install.`,
		dot: `muted`,
		label: `Key Required`,
		status: `not-configured`,
	};
}

// Create a timestamp safe for Windows folder names. Colons are not allowed in
// normal Windows paths, so ISO timestamps are cleaned before use.
function timestampFolderName() {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

// Date-only stamp used for the normal manual backup filename.
function dateStamp() {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

// Timestamp used for automatic safety backups that should never collide.
function fileTimestamp() {
	const now = new Date();
	const date = dateStamp();
	const hours = String(now.getHours()).padStart(2, "0");
	const minutes = String(now.getMinutes()).padStart(2, "0");
	const seconds = String(now.getSeconds()).padStart(2, "0");
	return `${date}-${hours}${minutes}${seconds}`;
}

function displayPath(filePath, root = process.cwd()) {
	if (!filePath) {
		return "";
	}

	const resolvedPath = path.resolve(String(filePath));
	const resolvedRoot = path.resolve(String(root || process.cwd()));
	const relativePath = path.relative(resolvedRoot, resolvedPath);

	if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
		return relativePath || path.basename(resolvedPath);
	}

	return path.basename(resolvedPath) || resolvedPath;
}

function readableCause(error) {
	return redactHachiGenLogText(error?.message || String(error || "Unknown error.")).replace(/^ShellError:\s*/u, "");
}

function errorWithContext(context, error) {
	const wrapped = new Error(`${context}: ${readableCause(error)}`);
	wrapped.cause = error;
	return wrapped;
}

function failedToolVersionMessage(command, result) {
	const output = redactHachiGenLogText(result?.stderr || result?.stdout || "")
		.replace(/\s+/gu, " ")
		.trim();
	const reason = output ? `: ${output}` : ".";

	return `${command} is installed, but HachiGen could not run ${command} --version${reason}`;
}

function normalizeWindowState(value = null) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}

	const bounds = value.bounds && typeof value.bounds === "object" ? value.bounds : value;
	const width = Math.max(1040, Math.round(Number(bounds.width) || 0));
	const height = Math.max(720, Math.round(Number(bounds.height) || 0));
	const x = Number.isFinite(Number(bounds.x)) ? Math.round(Number(bounds.x)) : null;
	const y = Number.isFinite(Number(bounds.y)) ? Math.round(Number(bounds.y)) : null;

	if (!width || !height) {
		return null;
	}

	return {
		bounds: {
			...(x === null ? {} : { x }),
			...(y === null ? {} : { y }),
			height,
			width,
		},
		maximized: Boolean(value.maximized),
	};
}

function patchNotesSummary(markdown) {
	const text = String(markdown || "");
	const unreleased = topLevelMarkdownSection(text, "Unreleased");
	let lines = releaseNoteBullets(unreleased);

	// Release builds reset Unreleased, so fall back to the latest dated section.
	if (!lines.length) {
		lines = releaseNoteBullets(latestReleaseNotesSection(text));
	}

	return lines.slice(0, 8);
}

function topLevelMarkdownSection(text, heading) {
	const lines = String(text || "").split(/\r?\n/u);
	const start = lines.findIndex(line => line.trim() === `# ${heading}`);

	if (start < 0) {
		return "";
	}

	const endOffset = lines.slice(start + 1).findIndex(line => /^#\s+/u.test(line));
	const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
	return lines.slice(start + 1, end).join("\n").trim();
}

function latestReleaseNotesSection(text) {
	const lines = String(text || "").split(/\r?\n/u);
	const start = lines.findIndex(line => /^# v\d+\.\d+\.\d+(?:\s+-\s+.*)?$/u.test(line.trim()));

	if (start < 0) {
		return "";
	}

	const endOffset = lines.slice(start + 1).findIndex(line => /^#\s+/u.test(line));
	const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
	return lines.slice(start + 1, end).join("\n").trim();
}

function releaseNoteBullets(section) {
	if (!section) {
		return [];
	}

	return String(section)
		.split(/\r?\n/u)
		.map(line => line.trim())
		.filter(line => line.startsWith("- "))
		.map(line => line.slice(2).trim())
		.filter(Boolean);
}

function backupRotationSummaryText(rotation) {
	if (!rotation) {
		return "";
	}

	if (!rotation.total) {
		return "0 backups found";
	}

	const parts = [];

	if (rotation.rekeyed) {
		parts.push(`${rotation.rekeyed} rekeyed`);
	}

	if (rotation.converted) {
		parts.push(`${rotation.converted} encrypted`);
	}

	if (rotation.verified) {
		parts.push(`${rotation.verified} verified`);
	}

	if (rotation.skipped) {
		parts.push(`${rotation.skipped} skipped`);
	}

	return parts.length ? parts.join(", ") : `${rotation.total} checked`;
}

function formatFileSize(bytes) {
	if (!bytes) {
		return "0 B";
	}

	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unitIndex = 0;

	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}

	return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function parseNodeVersion(versionText) {
	const match = String(versionText || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)/u);

	if (!match) {
		return null;
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
}

function parsePackageVersion(versionText) {
	const match = String(versionText || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)/u);

	if (!match) {
		return null;
	}

	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function comparePackageVersions(left, right) {
	const leftParts = parsePackageVersion(left);
	const rightParts = parsePackageVersion(right);

	if (!leftParts || !rightParts) {
		return String(left || "").localeCompare(String(right || ""));
	}

	for (let index = 0; index < 3; index += 1) {
		if (leftParts[index] > rightParts[index]) {
			return 1;
		}

		if (leftParts[index] < rightParts[index]) {
			return -1;
		}
	}

	return 0;
}

function hachiGenReleaseVersion(tagName) {
	const tag = String(tagName || "").trim();

	if (!tag.startsWith(HACHIGEN_RELEASE_TAG_PREFIX)) {
		return "";
	}

	return tag.slice(HACHIGEN_RELEASE_TAG_PREFIX.length);
}

function compareHachiGenReleases(left, right) {
	const versionComparison = comparePackageVersions(
		hachiGenReleaseVersion(left?.tag_name),
		hachiGenReleaseVersion(right?.tag_name),
	);

	if (versionComparison !== 0) {
		return versionComparison;
	}

	return new Date(left?.published_at || left?.created_at || 0).getTime() -
		new Date(right?.published_at || right?.created_at || 0).getTime();
}

function resolveRedirectUrl(location, sourceUrl) {
	try {
		return new URL(location, sourceUrl).toString();
	} catch {
		return location;
	}
}

function requestHttps(url, { accept = "*/*", maxRedirects = 5, timeoutMs = 60000 } = {}) {
	return new Promise((resolve, reject) => {
		const request = https.get(url, {
			headers: {
				Accept: accept,
				"User-Agent": "HachiGen Update Checker",
			},
		}, response => {
			const statusCode = response.statusCode || 0;
			const location = response.headers.location;

			if ([301, 302, 303, 307, 308].includes(statusCode) && location && maxRedirects > 0) {
				response.resume();
				resolve(requestHttps(resolveRedirectUrl(location, url), {
					accept,
					maxRedirects: maxRedirects - 1,
					timeoutMs,
				}));
				return;
			}

			const chunks = [];
			response.on("data", chunk => chunks.push(Buffer.from(chunk)));
			response.on("end", () => {
				const buffer = Buffer.concat(chunks);

				if (statusCode < 200 || statusCode >= 300) {
					reject(new Error(`HTTP ${statusCode} while requesting ${url}: ${buffer.toString("utf8").slice(0, 240)}`));
					return;
				}

				resolve({
					buffer,
					headers: response.headers,
					statusCode,
				});
			});
			response.on("error", reject);
		});

		request.setTimeout(timeoutMs, () => {
			request.destroy(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
		});
		request.on("error", reject);
	});
}

async function requestJson(url) {
	const response = await requestHttps(url, {
		accept: "application/vnd.github+json",
	});
	const parsed = parseJsonText(response.buffer.toString("utf8"), null);

	if (!parsed) {
		throw new Error(`Could not parse JSON response from ${url}.`);
	}

	return parsed;
}

function downloadUrlToFile(url, targetPath, { maxRedirects = 5, onProgress = noop, timeoutMs = 300000 } = {}) {
	return new Promise((resolve, reject) => {
		ensureDir(path.dirname(targetPath));

		const request = https.get(url, {
			headers: {
				Accept: "application/octet-stream",
				"User-Agent": "HachiGen Update Downloader",
			},
		}, response => {
			const statusCode = response.statusCode || 0;
			const location = response.headers.location;

			if ([301, 302, 303, 307, 308].includes(statusCode) && location && maxRedirects > 0) {
				response.resume();
				resolve(downloadUrlToFile(resolveRedirectUrl(location, url), targetPath, {
					maxRedirects: maxRedirects - 1,
					onProgress,
					timeoutMs,
				}));
				return;
			}

			if (statusCode < 200 || statusCode >= 300) {
				const chunks = [];
				response.on("data", chunk => chunks.push(Buffer.from(chunk)));
				response.on("end", () => {
					reject(new Error(`HTTP ${statusCode} while downloading HachiGen: ${Buffer.concat(chunks).toString("utf8").slice(0, 240)}`));
				});
				response.on("error", reject);
				return;
			}

			const file = fs.createWriteStream(targetPath);
			const totalBytes = Number(response.headers["content-length"]) || 0;
			let downloadedBytes = 0;

			response.on("data", chunk => {
				downloadedBytes += chunk.length;
				onProgress({
					bytes: downloadedBytes,
					percent: totalBytes ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null,
					totalBytes,
				});
			});
			response.pipe(file);
			file.on("finish", () => {
				file.close(error => {
					if (error) {
						reject(error);
						return;
					}

					resolve({
						bytes: fileExists(targetPath) ? fs.statSync(targetPath).size : 0,
						targetPath,
					});
				});
			});
			file.on("error", error => {
				response.destroy();
				try {
					fs.rmSync(targetPath, { force: true });
				} catch {
					// Best-effort cleanup. The caller will still receive the write error.
				}
				reject(error);
			});
			response.on("error", error => {
				file.destroy();
				reject(error);
			});
		});

		request.setTimeout(timeoutMs, () => {
			request.destroy(new Error(`Download timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
		});
		request.on("error", reject);
	});
}

function sha256File(filePath) {
	const hash = crypto.createHash("sha256");
	hash.update(fs.readFileSync(filePath));
	return hash.digest("hex");
}

function readFilePrefix(filePath, length) {
	const file = fs.openSync(filePath, "r");
	const buffer = Buffer.alloc(length);

	try {
		fs.readSync(file, buffer, 0, length, 0);
		return buffer;
	} finally {
		fs.closeSync(file);
	}
}

function verifyHachiGenUpdateFile(filePath, expectedBytes = 0) {
	if (!fileExists(filePath)) {
		throw new Error("Downloaded HachiGen update file was not found.");
	}

	const stats = fs.statSync(filePath);

	if (!stats.isFile() || stats.size <= 0) {
		throw new Error("Downloaded HachiGen update is empty or invalid.");
	}

	if (expectedBytes && stats.size !== expectedBytes) {
		throw new Error(`Downloaded HachiGen update size mismatch. Expected ${expectedBytes} bytes, got ${stats.size}.`);
	}

	const prefix = readFilePrefix(filePath, 2).toString("ascii");

	if (prefix !== "MZ") {
		throw new Error("Downloaded HachiGen update is not a Windows executable.");
	}

	return {
		bytes: stats.size,
		checkedAt: new Date().toISOString(),
		sha256: sha256File(filePath),
		status: "verified",
	};
}

function nodeVersionMeetsMinimum(versionText) {
	const parsed = parseNodeVersion(versionText);

	if (!parsed) {
		return false;
	}

	return parsed.major > MIN_NODE_VERSION.major ||
		(parsed.major === MIN_NODE_VERSION.major && parsed.minor >= MIN_NODE_VERSION.minor);
}

// PM2 sometimes prints non-JSON text around `pm2 jlist` output. Extracting the
// array portion makes status checks more forgiving without hiding parse errors.
function parsePm2Json(stdout) {
	const text = String(stdout || "");
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");

	if (start === -1 || end === -1 || end < start) {
		return [];
	}

	return JSON.parse(text.slice(start, end + 1));
}

// Convert one `git status --porcelain` line into the object the Updates UI
// groups and displays. Example: " M src/manager.js" becomes Modified.
function describeGitStatus(rawLine) {
	const code = rawLine.slice(0, 2);
	const filePath = rawLine.slice(3).trim();
	const statusCodes = code.replace(/\s/g, "").split("");
	const statusMap = {
		"?": "New",
		A: "Added",
		C: "Copied",
		D: "Deleted",
		M: "Modified",
		R: "Renamed",
		U: "Conflict",
	};

	let label = "Changed";

	if (code === "??") {
		label = "New";
	} else if (statusCodes.includes("U")) {
		label = "Conflict";
	} else if (statusCodes.includes("R")) {
		label = "Renamed";
	} else if (statusCodes.includes("A")) {
		label = "Added";
	} else if (statusCodes.includes("D")) {
		label = "Deleted";
	} else if (statusCodes.includes("M")) {
		label = "Modified";
	} else if (statusCodes.length) {
		label = statusMap[statusCodes[0]] || "Changed";
	}

	return {
		raw: rawLine,
		code,
		label,
		path: filePath,
		description: `${label}: ${filePath}`,
	};
}

// Convert one `git stash show --name-status` line into the same display shape
// used by local changes. This keeps the UI grouping code shared for current
// local changes and saved stashes.
function describeNameStatus(rawLine) {
	const parts = rawLine.split(/\t+/).filter(Boolean);
	const code = parts[0] || "";
	const status = code.charAt(0);
	const statusMap = {
		A: "Added",
		C: "Copied",
		D: "Deleted",
		M: "Modified",
		R: "Renamed",
		U: "Conflict",
	};
	const label = statusMap[status] || "Changed";
	const pathValue = (status === "R" || status === "C") && parts.length >= 3 ?
		`${parts[1]} -> ${parts[2]}` :
		parts.slice(1).join(" ");

	return {
		raw: rawLine,
		code,
		label,
		path: pathValue,
		description: `${label}: ${pathValue}`,
	};
}

// Count how many changed files fall into each friendly status label. The UI can
// use this for summaries without reparsing individual file rows.
function summarizeLocalChanges(changes) {
	const counts = changes.reduce((summary, change) => {
		summary[change.label] = (summary[change.label] || 0) + 1;
		return summary;
	}, {});

	return {
		total: changes.length,
		counts,
	};
}

// Convert a short `git log --oneline` row into structured commit data for the
// incoming updates panel.
function parseIncomingCommit(line) {
	const trimmed = line.trim();
	const firstSpace = trimmed.indexOf(" ");

	if (firstSpace === -1) {
		return {
			hash: trimmed,
			message: "",
			text: trimmed,
		};
	}

	return {
		hash: trimmed.slice(0, firstSpace),
		message: trimmed.slice(firstSpace + 1),
		text: trimmed,
	};
}

// Parse one HachiGen stash row created by:
// git stash list --format=%H%x09%gd%x09%ct%x09%gs
// The format uses tabs so stash messages with spaces remain intact.
function parseStashLine(line) {
	const [hash, ref, timestamp, ...subjectParts] = line.split("\t");
	const subject = subjectParts.join("\t");
	const message = subject.replace(/^On .*?:\s*/, "");
	const timestampNumber = Number(timestamp);

	return {
		hash,
		ref,
		subject,
		message,
		createdAt: Number.isFinite(timestampNumber) ?
			new Date(timestampNumber * 1000).toISOString() :
			null,
	};
}

function expandWindowsEnv(value) {
	return String(value || "").trim().replace(/%([^%]+)%/gu, (_match, key) => process.env[key] || _match);
}

function sshPrivateKeyValidationError(filePath) {
	const expandedPath = expandWindowsEnv(filePath);

	if (!expandedPath) {
		return "SSH private key path is required.";
	}

	let stats;

	try {
		stats = fs.statSync(expandedPath);
	} catch {
		return `SSH private key was not found at ${expandedPath}.`;
	}

	if (!stats.isFile()) {
		return "SSH private key path must point to a file.";
	}

	if (stats.size === 0) {
		return "SSH private key file is empty.";
	}

	if (stats.size > 1024 * 1024) {
		return "SSH private key file is too large to be a normal private key.";
	}

	const buffer = Buffer.alloc(Math.min(stats.size, 16384));
	const descriptor = fs.openSync(expandedPath, "r");

	try {
		fs.readSync(descriptor, buffer, 0, buffer.length, 0);
	} finally {
		fs.closeSync(descriptor);
	}

	const preview = buffer.toString("utf8").trimStart();
	const hasPemHeader = /^-----BEGIN (?:OPENSSH PRIVATE|RSA PRIVATE|DSA PRIVATE|EC PRIVATE|PRIVATE|ENCRYPTED PRIVATE) KEY-----/u.test(preview);
	const hasPuttyHeader = /^PuTTY-User-Key-File-\d+:/u.test(preview);

	return hasPemHeader || hasPuttyHeader ? "" : "Selected file does not look like an SSH private key.";
}

function assertSshPrivateKeyFile(filePath) {
	const error = sshPrivateKeyValidationError(filePath);

	if (error) {
		throw new Error(error);
	}

	return expandWindowsEnv(filePath);
}

function normalizeRemotePath(value) {
	const cleaned = String(value || "").trim().replace(/\\/gu, "/");

	if (!cleaned || cleaned === "~" || cleaned.startsWith("~/") || cleaned.startsWith("/")) {
		return cleaned;
	}

	return `~/${cleaned.replace(/^\/+/u, "")}`;
}

function normalizeRemoteSettings(values = {}) {
	const merged = {
		...DEFAULT_REMOTE_SETTINGS,
		...values,
	};
	const portMode = merged.portMode === "custom" ? "custom" : "default";
	const parsedPort = Number.parseInt(String(merged.port), 10);
	const customPort = Number.isInteger(parsedPort) ? parsedPort : null;

	return {
		host: String(merged.host || "").trim(),
		username: String(merged.username || "").trim(),
		sshKeyPath: String(merged.sshKeyPath || "").trim(),
		portMode,
		port: portMode === "custom" ? customPort : DEFAULT_SSH_PORT,
		remotePath: normalizeRemotePath(merged.remotePath),
		pm2Name: String(merged.pm2Name || PROCESS_NAME).trim() || PROCESS_NAME,
	};
}

function validateRemoteSettings(settings, { requireFields = true } = {}) {
	const errors = [];

	if (requireFields && !settings.host) {
		errors.push("Remote host is required.");
	}

	if (requireFields && !settings.username) {
		errors.push("Remote username is required.");
	}

	if (requireFields && !settings.sshKeyPath) {
		errors.push("SSH private key path is required.");
	}

	if (requireFields && !settings.remotePath) {
		errors.push("Remote Hachi path is required.");
	}

	if (requireFields && !settings.pm2Name) {
		errors.push("PM2 process name is required.");
	}

	if (settings.portMode === "custom" && (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535)) {
		errors.push("Custom SSH port must be between 1 and 65535.");
	}

	return errors;
}

function remoteConnectionLabel(settings = {}) {
	const host = settings.host ? `${settings.username || "user"}@${settings.host}` : "remote profile";
	return settings.remotePath ? `${host}:${settings.remotePath}` : host;
}

function normalizeRemoteTestState(value = null) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}

	return {
		checkedAt: String(value.checkedAt || ""),
		message: redactHachiGenLogText(value.message || ""),
		ok: Boolean(value.ok),
		target: redactHachiGenLogText(value.target || ""),
	};
}

function quotePosix(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function quoteRemotePath(value) {
	const text = String(value || "");

	if (text === "~") {
		return "~";
	}

	if (text.startsWith("~/")) {
		return `~/${quotePosix(text.slice(2))}`;
	}

	return quotePosix(text);
}

function gitShellCommand(args) {
	return ["git", ...args.map(arg => quotePosix(arg))].join(" ");
}

function parseJsonResult(result, fallbackMessage) {
	const output = (result.stdout || "").trim();

	try {
		return JSON.parse(output);
	} catch {
		throw new Error(result.stderr || output || fallbackMessage);
	}
}

function sanitizeShellLogEntry(entry) {
	let message = redactHachiGenLogText(entry.message);

	if (entry.stream === "command" && /^> ssh(?:\s|$)/u.test(message)) {
		return {
			...entry,
			message: "> ssh [remote command hidden]",
		};
	}

	if (entry.stream === "command") {
		message = message
			.replace(/^> node -e\s+.+/u, "> node -e [inline script]")
			.replace(/^> ssh-keygen\s+.+/u, "> ssh-keygen [arguments hidden]");
	}

	return {
		...entry,
		message: message.replace(/(-i\s+)(?:"[^"]+"|\S+)/u, "$1[ssh-key]"),
	};
}

function shouldShowShellEntryInUi(entry) {
	if (entry.stream === "command") {
		return false;
	}

	const command = String(entry.command || "").toLowerCase();
	const args = Array.isArray(entry.args) ? entry.args.map(arg => String(arg)) : [];
	const firstArg = args[0] || "";

	if (command === "git") {
		return false;
	}

	if ((command === "node" || command === "npm") && ["--version", "-v", "version"].includes(firstArg)) {
		return false;
	}

	if (["where", "which"].includes(command)) {
		return false;
	}

	return true;
}

class HachiManager {
	constructor({ managerRoot, defaultInstallPath, userDataPath, sendEvent, protectSecret, unprotectSecret }) {
		// managerRoot is the manager folder in development and the bundled app
		// location after packaging. defaultInstallPath is passed from main.js so
		// packaged HachiGen can default to the folder beside HachiGen.exe.
		this.managerRoot = managerRoot;
		this.defaultInstallPath = defaultInstallPath || path.resolve(managerRoot, "..");

		// userDataPath is Electron's app data folder. HachiGen uses this in both
		// development and packaged builds so settings/logs do not live in source.
		this.userDataPath = userDataPath || getDefaultHachiGenUserDataPath();
		this.settingsPath = path.join(this.userDataPath, "settings.json");
		this.fleetPath = path.join(this.userDataPath, "fleet.json");
		this.profilesDir = path.join(this.userDataPath, "Profiles");
		this.botDefinitionsDir = path.join(this.profilesDir, "Bots");
		this.testingProfilesDir = path.join(this.profilesDir, "Testing");
		this.protectSecret = protectSecret || null;
		this.unprotectSecret = unprotectSecret || null;

		// sendEvent comes from main.js and streams backend activity to the UI.
		this.sendEvent = sendEvent || noop;
		this.logger = new HachiGenLogger({
			userDataPath: this.userDataPath,
		});

		// operationLog is a small live cache for renderer events. The persisted
		// HachiGen log in AppData is the durable source used by the Logs tab.
		this.operationLog = this.logger.readRecentEvents(500);

		// updateState stores the most recent update check so the UI can redraw
		// without running Git commands every time it needs a label.
		this.updateState = createUncheckedUpdateState();
		this.hachiGenUpdateState = createUncheckedHachiGenUpdateState();
		// checkUpdatesPromise deduplicates overlapping update checks. Startup
		// checks and manual button clicks can arrive together, especially for
		// remote installs where SSH/Git commands take several seconds.
		this.checkUpdatesPromise = null;
		this.databaseCipherTest = null;
		this.fleetMaintenanceTimer = null;
		this.testingRuns = new Map();

		ensureDir(this.userDataPath);
		this.migrateLegacyBotProfiles();
		this.settings = this.loadSettings();
		this.fleet = this.loadFleetRegistry();
	}

	migrateLegacyBotProfiles() {
		const legacyDir = path.join(this.userDataPath, "bot-definitions");
		ensureDir(this.botDefinitionsDir);
		ensureDir(this.testingProfilesDir);
		if (!fileExists(legacyDir)) {
			return;
		}
		// Copy rather than move so rolling back to an older HachiGen build remains safe.
		for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
			if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") {
				continue;
			}
			const destination = path.join(this.botDefinitionsDir, entry.name);
			if (!fileExists(destination)) {
				fs.copyFileSync(path.join(legacyDir, entry.name), destination);
			}
		}
	}

	getTestingProfiles() {
		ensureDir(this.testingProfilesDir);
		const profiles = [];
		for (const entry of fs.readdirSync(this.testingProfilesDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}
			const root = path.join(this.testingProfilesDir, entry.name);
			const metadata = readJson(path.join(root, "profile.json"), null);
			if (!metadata) {
				continue;
			}
			const secrets = parseDotEnv(path.join(root, "secrets.env"));
			profiles.push({
				id: entry.name,
				name: String(metadata.name || entry.name),
				isDefault: metadata.isDefault === true,
				guildIds: normalizeConfigIdList(metadata.guildIds),
				createdAt: metadata.createdAt || null,
				updatedAt: metadata.updatedAt || null,
				hasValues: Object.fromEntries(["TOKEN", "clientId", "publicKey", "clientSecret"].map(field => [field, String(secrets[field] || "").startsWith("os:v1:")])),
			});
		}
		return profiles.sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name));
	}

	saveTestingProfile(values) {
		if (!this.protectSecret) {
			throw new Error("Operating-system secret protection is unavailable.");
		}
		const requestedId = normalizeProfileId(values?.id || values?.name, "testing");
		const existing = this.getTestingProfiles().find(profile => profile.id === requestedId);
		if (!values?.id && existing) {
			throw new Error("A testing identity already uses that profile name.");
		}
		const profileId = existing ? requestedId : normalizeProfileId(values?.name || requestedId, "testing");
		const root = path.join(this.testingProfilesDir, profileId);
		ensureDir(root);
		const metadataPath = path.join(root, "profile.json");
		const secretsPath = path.join(root, "secrets.env");
		const now = new Date().toISOString();
		const previousMetadata = readJson(metadataPath, {});
		const previousSecrets = fileExists(secretsPath) ? fs.readFileSync(secretsPath, "utf8") : "";
		const updates = { HACHIGEN_TEST_SECRETS_PROTECTION: "os" };
		for (const field of ["TOKEN", "clientId", "publicKey", "clientSecret"]) {
			const submitted = String(values?.[field] || "").trim();
			if (submitted) {
				updates[field] = `os:v1:${this.protectSecret(submitted)}`;
			}
		}
		const parsedSecrets = parseDotEnvContent(updateDotEnvContent(previousSecrets, updates));
		if (!String(parsedSecrets.TOKEN || "").startsWith("os:v1:") || !String(parsedSecrets.clientId || "").startsWith("os:v1:")) {
			throw new Error("A test bot token and application ID are required.");
		}
		if (values?.isDefault) {
			for (const profile of this.getTestingProfiles()) {
				if (profile.id === profileId) {
					continue;
				}
				const otherPath = path.join(this.testingProfilesDir, profile.id, "profile.json");
				const other = readJson(otherPath, null);
				if (other?.isDefault) {
					writeJsonFile(otherPath, { ...other, isDefault: false, updatedAt: now });
				}
			}
		}
		writeJsonFile(metadataPath, {
			createdAt: previousMetadata.createdAt || now,
			guildIds: normalizeConfigIdList(values?.guildIds ?? previousMetadata.guildIds),
			id: profileId,
			isDefault: values?.isDefault === true,
			name: String(values?.name || previousMetadata.name || profileId).trim(),
			updatedAt: now,
			version: 1,
		});
		fs.writeFileSync(secretsPath, updateDotEnvContent(previousSecrets, updates), { encoding: "utf8", mode: 0o600 });
		this.log(`Testing identity saved: ${profileId}.`, { area: "testing", profileId });
		return { message: "Testing identity saved.", profiles: this.getTestingProfiles() };
	}

	readTestingSecretForCopy(profileId, field) {
		if (!this.unprotectSecret) {
			throw new Error("Operating-system secret protection is unavailable.");
		}
		if (!["TOKEN", "clientId", "publicKey", "clientSecret"].includes(field)) {
			throw new Error("Unsupported testing credential field.");
		}
		const safeId = normalizeProfileId(profileId);
		const secrets = parseDotEnv(path.join(this.testingProfilesDir, safeId, "secrets.env"));
		const protectedValue = String(secrets[field] || "");
		if (!protectedValue.startsWith("os:v1:")) {
			throw new Error(`${field} has no saved value.`);
		}
		return { field, profileId: safeId, ttlMs: 60000, value: this.unprotectSecret(protectedValue.slice("os:v1:".length)) };
	}

	readTestingIdentity(profileId) {
		if (!this.unprotectSecret) {
			throw new Error("Operating-system secret protection is unavailable.");
		}
		const safeId = normalizeProfileId(profileId);
		const metadata = readJson(path.join(this.testingProfilesDir, safeId, "profile.json"), null);
		const secrets = parseDotEnv(path.join(this.testingProfilesDir, safeId, "secrets.env"));
		if (!metadata) {
			throw new Error("Testing identity was not found.");
		}
		const values = {};
		for (const field of ["TOKEN", "clientId", "publicKey", "clientSecret"]) {
			const protectedValue = String(secrets[field] || "");
			values[field] = protectedValue.startsWith("os:v1:") ? this.unprotectSecret(protectedValue.slice("os:v1:".length)) : "";
		}
		if (!values.TOKEN || !values.clientId) {
			throw new Error("Testing identity requires a bot token and application ID.");
		}
		return { id: safeId, guildIds: normalizeConfigIdList(metadata.guildIds), name: metadata.name || safeId, values };
	}

	testingIdentityEnvironment(identity) {
		return {
			...process.env,
			TOKEN: identity.values.TOKEN,
			clientId: identity.values.clientId,
			clientSecret: identity.values.clientSecret,
			guildIds: identity.guildIds.join(","),
			HACHIGEN_TEST_MODE: "true",
			publicKey: identity.values.publicKey,
			testID: identity.values.clientId,
			testTOKEN: identity.values.TOKEN,
		};
	}

	async resetTestingCommands(deploymentId, profileId) {
		const context = this.getFleetDeploymentContext(deploymentId);
		if (context.server.connection.type !== "local") {
			throw new Error("Test commands can be managed only from a local bot repository.");
		}
		const packageJson = readJson(path.join(context.deployment.installPath, "package.json"), {});
		const hasDetectedTestDeploy = packageJson.scripts?.["deploy:test"];
		if (context.definition.id !== "hachi" && !context.definition.commands?.testDeployCommands && !hasDetectedTestDeploy) {
			throw new Error(`${context.definition.displayName} does not define a test command deployment script.`);
		}
		const identity = this.readTestingIdentity(profileId);
		const applicationId = encodeURIComponent(identity.values.clientId);
		const botGuilds = await discordApiRequest("GET", "/users/@me/guilds?limit=200", identity.values.TOKEN);
		const guildIds = new Set([
			...identity.guildIds,
			...(Array.isArray(botGuilds) ? botGuilds.map(guild => String(guild.id || "")).filter(Boolean) : []),
		]);

		// Bulk-overwrite with an empty array deletes commands only for this test
		// application. Production application IDs and tokens never enter this path.
		await discordApiRequest("PUT", `/applications/${applicationId}/commands`, identity.values.TOKEN, []);
		for (const guildId of guildIds) {
			await discordApiRequest("PUT", `/applications/${applicationId}/guilds/${encodeURIComponent(guildId)}/commands`, identity.values.TOKEN, []);
		}

		const env = this.testingIdentityEnvironment(identity);
		if (context.definition.id === "hachi") {
			await this.runFleetDefinitionCommand(deploymentId, "deployGlobalCommands", { env, timeoutMs: 300000 });
			if (identity.guildIds.length) {
				const source = [
					"const {getCommandData,redeployCommands}=require('./utils/commandLoader.js');",
					"const ids=process.env.guildIds.split(',').filter(Boolean),commands=getCommandData('guild');",
					"(async()=>{for(const guildId of ids)await redeployCommands('guild',",
					"{clientId:process.env.clientId,commands,guildId,token:process.env.TOKEN});})()",
					".catch(e=>{console.error(e);process.exitCode=1;});",
				].join("");
				await this.runFleetDeploymentCommand(context, { command: "node", args: ["-e", source] }, "", { env, timeoutMs: 300000 });
			}
		} else if (context.definition.commands?.testDeployCommands) {
			await this.runFleetDefinitionCommand(deploymentId, "testDeployCommands", { env, timeoutMs: 300000 });
		} else if (hasDetectedTestDeploy) {
			// Preserve older generated profiles: deploy:test is a deliberately named,
			// local-only test adapter and still requires the UI confirmation.
			await this.runFleetDeploymentCommand(context, { command: "npm", args: ["run", "deploy:test"] }, "", { env, timeoutMs: 300000 });
		} else {
			throw new Error(`${context.definition.displayName} does not define a test-compatible command deployment.`);
		}
		this.log(`Test commands reset for ${context.deployment.name} using ${identity.name}.`, {
			area: "testing",
			deploymentId,
			profileId: identity.id,
		});
		return { deploymentId, guildCount: guildIds.size, ok: true, message: "Test application commands were deleted and redeployed." };
	}

	getTestingRunState() {
		return [...this.testingRuns.values()].map(runState => ({
			deploymentId: runState.deploymentId,
			exitedAt: runState.exitedAt || null,
			exitCode: runState.exitCode ?? null,
			output: runState.output || "",
			profileId: runState.profileId,
			startedAt: runState.startedAt,
			status: runState.status,
		}));
	}

	async startTestingBot(deploymentId, profileId) {
		const context = this.getFleetDeploymentContext(deploymentId);
		if (context.server.connection.type !== "local") {
			throw new Error("Testing identities currently run local bot deployments only.");
		}
		const existing = this.testingRuns.get(deploymentId);
		if (existing?.status === "running") {
			throw new Error("This bot already has a testing process running.");
		}
		const detectedTestEntry = ["start-test.js", "test.js", "scripts/start-test.js"]
			.find(candidate => fileExists(path.join(context.deployment.installPath, candidate)));
		const command = context.definition.commands?.testStart ||
			(detectedTestEntry ? { executable: "node", args: [detectedTestEntry] } : null) ||
			(context.definition.id === "hachi" ? { executable: "node", args: ["index.js"] } : null);
		if (context.definition.source === "external" && context.deployment.definitionFingerprint !== context.definition.fingerprint) {
			throw new Error(`${context.definition.displayName} profile changed after approval. Review the deployment before testing it.`);
		}
		if (!command || command.executable !== "node" || !command.args?.length) {
			throw new Error(`${context.definition.displayName} does not have a recognized local testing entry point.`);
		}
		const entryPath = path.resolve(context.deployment.installPath, command.args[0]);
		const relativeEntry = path.relative(path.resolve(context.deployment.installPath), entryPath);
		if (!relativeEntry || relativeEntry.startsWith("..") || path.isAbsolute(relativeEntry) || !fileExists(entryPath)) {
			throw new Error("The bot's testing entry point is missing or outside its repository.");
		}
		const identity = this.readTestingIdentity(profileId);
		const env = this.testingIdentityEnvironment(identity);
		// Use the bot host's Node runtime; process.execPath is HachiGen.exe in packaged builds.
		const child = childProcess.spawn("node", [entryPath, ...command.args.slice(1)], {
			cwd: context.deployment.installPath,
			env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		const runState = { child, deploymentId, exitedAt: null, exitCode: null, output: "", profileId: identity.id, startedAt: new Date().toISOString(), status: "starting" };
		this.testingRuns.set(deploymentId, runState);
		const appendOutput = chunk => {
			let output = `${runState.output}${chunk}`;
			for (const secret of Object.values(identity.values).filter(Boolean)) {
				output = output.split(secret).join("[REDACTED]");
			}
			runState.output = redactHachiGenLogText(output).slice(-20000);
		};
		child.stdout.on("data", appendOutput);
		child.stderr.on("data", appendOutput);
		child.on("exit", code => {
			runState.status = "exited";
			runState.exitCode = code;
			runState.exitedAt = new Date().toISOString();
			this.log(`Testing process exited for ${context.deployment.name}.`, { area: "testing", deploymentId, exitCode: code });
		});
		await new Promise((resolve, reject) => {
			child.once("spawn", () => {
				runState.status = "running";
				resolve();
			});
			child.once("error", error => {
				runState.status = "exited";
				runState.exitedAt = new Date().toISOString();
				reject(error);
			});
		});
		this.log(`Testing process started for ${context.deployment.name} with ${identity.name}.`, { area: "testing", deploymentId, profileId: identity.id });
		return { message: "Testing process started without changing bot credential files.", runs: this.getTestingRunState() };
	}

	stopTestingBot(deploymentId) {
		const runState = this.testingRuns.get(deploymentId);
		if (!runState || runState.status !== "running") {
			throw new Error("This bot does not have a running testing process.");
		}
		runState.status = "stopping";
		runState.child.kill("SIGTERM");
		this.log(`Testing process stop requested.`, { area: "testing", deploymentId });
		return { message: "Testing process is stopping.", runs: this.getTestingRunState() };
	}

	stopAllTestingBots() {
		for (const runState of this.testingRuns.values()) {
			if (["running", "starting"].includes(runState.status)) {
				runState.child.kill("SIGTERM");
			}
		}
	}

	deleteTestingProfile(profileId) {
		const safeId = normalizeProfileId(profileId);
		const root = path.join(this.testingProfilesDir, safeId);
		if (!fileExists(path.join(root, "profile.json"))) {
			throw new Error("Testing identity was not found.");
		}
		fs.rmSync(root, { force: true, recursive: true });
		this.log(`Testing identity deleted: ${safeId}.`, { area: "testing", profileId: safeId });
		return { message: "Testing identity deleted.", profiles: this.getTestingProfiles() };
	}

	loadFleetRegistry() {
		// The fleet registry is stored separately from legacy settings so the
		// migration can be rolled back without destroying the working Hachi setup.
		const saved = readJson(this.fleetPath, null);
		const fleet = normalizeFleetRegistry(saved, this.settings, this.defaultInstallPath);
		writeFleetRegistry(this.fleetPath, fleet);
		return fleet;
	}

	saveFleetRegistry() {
		writeFleetRegistry(this.fleetPath, this.fleet);
	}

	addFleetServer(values) {
		const server = normalizeServer(values, new Set(this.fleet.servers.map(item => item.id)));
		if (server.connection.type === "ssh") {
			const duplicate = this.fleet.servers.find(item => item.connection.type === "ssh" &&
				item.connection.host.toLowerCase() === server.connection.host.toLowerCase() &&
				item.connection.username === server.connection.username &&
				item.connection.port === server.connection.port);
			if (duplicate) {
				throw new Error(`That SSH connection already exists as ${duplicate.name}.`);
			}
		}
		this.fleet.servers.push(server);
		this.saveFleetRegistry();
		this.log(`Fleet server added: ${server.name}.`, { area: "fleet", serverId: server.id });
		return this.getFleetState();
	}

	removeFleetServer(serverId) {
		const server = this.fleet.servers.find(item => item.id === serverId);
		if (!server) {
			throw new Error("Server was not found.");
		}
		if (server.id === "local") {
			throw new Error("The built-in local server cannot be removed.");
		}
		const attachedDeployments = this.fleet.deployments.filter(item => item.serverId === server.id);
		if (attachedDeployments.some(item => item.botTypeId !== "hachi")) {
			throw new Error("Move or remove this server's deployments first.");
		}
		// Fleet hides Hachi, but early migration still attached its internal record to
		// the configured remote server. Move that record locally so an apparently
		// empty additional-bot connection can be removed without losing Hachi state.
		for (const deployment of attachedDeployments) {
			deployment.serverId = "local";
			deployment.installPath = this.settings.installPath || this.defaultInstallPath;
			deployment.pm2Name = "Hachi";
		}
		this.fleet.servers = this.fleet.servers.filter(item => item.id !== server.id);
		this.saveFleetRegistry();
		this.log(`Fleet server removed: ${server.name}.`, { area: "fleet", serverId: server.id });
		return this.getFleetState();
	}

	async addFleetDeployment(values) {
		const definitions = loadBotDefinitions(this.botDefinitionsDir).definitions;
		const deployment = normalizeDeployment(values, this.fleet, definitions);
		const server = this.fleet.servers.find(item => item.id === deployment.serverId);
		const definition = definitions.find(item => item.id === deployment.botTypeId);
		const verified = await this.verifyFleetDeploymentCandidate({ definition, deployment, server });
		// Branches belong to installations, not capabilities. A reviewed local
		// checkout may use a feature branch while production tracks main.
		const verifiedDeployment = { ...deployment, repositoryBranch: verified.branch };
		this.fleet.deployments.push(verifiedDeployment);
		this.fleet.activeDeploymentId = verifiedDeployment.id;
		this.saveFleetRegistry();
		this.log(`Fleet deployment added: ${verifiedDeployment.name}.`, { area: "fleet", deploymentId: verifiedDeployment.id, serverId: verifiedDeployment.serverId });
		return this.getFleetState();
	}

	async inspectFleetBotCandidate(values) {
		const server = this.fleet.servers.find(item => item.id === values?.serverId);
		if (!server) {
			throw new Error("Select a valid connection.");
		}
		// Profile generation and testing begin from a repository HachiGen can
		// inspect directly. Remote deployments are attached only after approval.
		if (server.connection.type !== "local") {
			throw new Error("Initial bot setup requires a local repository. Add the remote production installation afterward.");
		}
		const installPath = String(values?.installPath || "").trim();
		if (!installPath) {
			throw new Error("Select a bot folder.");
		}
		const ecosystemCandidates = ["ecosystem.config.js", "ecosystem.config.cjs", "config/ecosystem.config.js", "config/ecosystem.config.cjs"];
		const databaseCandidates = ["database/database.sqlite", "data/database.sqlite", "data/bot.sqlite", "database.sqlite"];
		const logCandidates = ["logs", "log"];
		const testEntryCandidates = ["start-test.js", "test.js", "scripts/start-test.js"];
		let origin;
		let branch;
		let profileBranch;
		let packageJson;
		let ecosystemFile;
		let ecosystemFound;
		let databasePath;
		let logsPath;
		let packageLockFound;
		let testEntry;
		if (server.connection.type === "ssh") {
			const inspectionSource = fleetRemoteInspectionScript(ecosystemCandidates, databaseCandidates, logCandidates, testEntryCandidates);
			const inspectScript = `cd ${quoteRemotePath(installPath)} && node -e ${quotePosix(inspectionSource)}`;
			const result = await this.runFleetRemoteCommand(server, inspectScript, { allowFailure: true, log: false, timeoutMs: 30000 });
			if (result.code !== 0) {
				throw new Error(result.stderr || "Remote bot folder must be a Git checkout with an origin remote.");
			}
			const inspection = parseJsonText(result.stdout.trim(), null);
			if (!inspection) {
				throw new Error("Remote repository inspection returned an invalid response.");
			}
			({ origin, branch, packageJson, packageLockFound, databasePath, logsPath } = inspection);
			profileBranch = inspection.defaultBranch || branch;
			testEntry = inspection.testEntry;
			ecosystemFile = inspection.ecosystemFile || "ecosystem.config.js";
			ecosystemFound = Boolean(inspection.ecosystemFile);
		} else {
			if (!fileExists(installPath)) {
				throw new Error("Bot folder does not exist.");
			}
			const originResult = await run("git", ["remote", "get-url", "origin"], { allowFailure: true, cwd: installPath, timeoutMs: 30000 });
			const branchResult = await run("git", ["branch", "--show-current"], { allowFailure: true, cwd: installPath, timeoutMs: 30000 });
			const defaultBranchResult = await run("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { allowFailure: true, cwd: installPath, timeoutMs: 30000 });
			if (originResult.code !== 0 || !originResult.stdout.trim()) {
				throw new Error("Bot folder must be a Git checkout with an origin remote.");
			}
			origin = originResult.stdout.trim();
			branch = branchResult.stdout.trim();
			profileBranch = defaultBranchResult.stdout.trim().replace(/^origin\//u, "") || branch;
			packageJson = readJson(path.join(installPath, "package.json"), {});
			packageLockFound = fileExists(path.join(installPath, "package-lock.json"));
			ecosystemFile = ecosystemCandidates.find(candidate => fileExists(path.join(installPath, candidate))) || "ecosystem.config.js";
			ecosystemFound = fileExists(path.join(installPath, ecosystemFile));
			databasePath = databaseCandidates.find(candidate => fileExists(path.join(installPath, candidate)));
			logsPath = logCandidates.find(candidate => fileExists(path.join(installPath, candidate)));
			testEntry = testEntryCandidates.find(candidate => fileExists(path.join(installPath, candidate)));
		}
		if (!String(origin || "").trim() || String(origin).trim() === "-" || !String(branch || "").trim() || String(branch).trim() === "-") {
			throw new Error("Bot folder must be a Git checkout with an origin remote.");
		}
		const scripts = packageJson.scripts || {};
		const validationScript = ["check", "lint", "test"].find(name => scripts[name]);
		const deployScript = ["deploy", "deploy:commands", "commands:deploy"].find(name => scripts[name]);
		const testDeployScript = ["deploy:test", "test:deploy"].find(name => scripts[name]);
		const displayName = String(values?.name || packageJson.displayName || packageJson.name || path.basename(installPath)).trim();
		const id = normalizeProfileId(packageJson.name || displayName, "bot");
		const definition = {
			id,
			displayName,
			repository: { branch: String(profileBranch || branch || "").trim() || "main", url: String(origin).trim() },
			runtime: { ecosystemFile, pm2Name: String(values?.pm2Name || displayName).trim() },
			credentials: { mode: "external" },
			paths: {},
			capabilities: { gitUpdates: true, pm2: ecosystemFound },
			commands: { install: { executable: "npm", args: [packageLockFound ? "ci" : "install"] } },
		};
		if (validationScript) {
			definition.commands.validate = { executable: "npm", args: ["run", validationScript] };
		}
		if (deployScript) {
			definition.commands.deployCommands = { executable: "npm", args: ["run", deployScript] };
			definition.capabilities.discordCommands = true;
		}
		if (testDeployScript) {
			definition.commands.testDeployCommands = { executable: "npm", args: ["run", testDeployScript] };
			definition.capabilities.discordCommands = true;
		}
		if (testEntry) {
			definition.commands.testStart = { executable: "node", args: [testEntry] };
		}
		if (databasePath) {
			definition.paths.database = databasePath;
			definition.capabilities.backups = true;
		}
		if (logsPath) {
			definition.paths.logs = logsPath;
			definition.capabilities.logs = true;
		}
		return {
			definition,
			detected: { branch, databasePath: databasePath || null, ecosystemFound: definition.capabilities.pm2, ecosystemFile, logsPath: logsPath || null, packageName: packageJson.name || null },
			installPath,
			serverId: server.id,
			warnings: definition.capabilities.pm2 ? [] : ["No PM2 ecosystem file was found. The bot will be added without PM2 controls."],
		};
	}

	previewExternalBotDefinition(jsonText) {
		const parsed = parseJsonText(jsonText, null);
		if (!parsed) {
			throw new Error("Bot definition is not valid JSON.");
		}
		const definition = validateExternalBotDefinition(parsed);
		return {
			id: definition.id,
			displayName: definition.displayName,
			repository: definition.repository,
			credentialsMode: definition.credentials.mode,
			capabilities: Object.entries(definition.capabilities).filter(([, enabled]) => enabled).map(([name]) => name),
			commands: Object.keys(definition.commands),
			paths: definition.paths,
			fingerprint: definition.fingerprint,
		};
	}

	setActiveFleetDeployment(deploymentId) {
		if (!this.fleet.deployments.some(item => item.id === deploymentId)) {
			throw new Error("Deployment was not found.");
		}
		this.fleet.activeDeploymentId = deploymentId;
		this.saveFleetRegistry();
		return this.getFleetState();
	}

	removeFleetDeployment(deploymentId) {
		const deployment = this.fleet.deployments.find(item => item.id === deploymentId);
		if (!deployment) {
			throw new Error("Deployment was not found.");
		}
		if (deployment.botTypeId === "hachi" && this.fleet.deployments.filter(item => item.botTypeId === "hachi").length === 1) {
			throw new Error("The migrated native Hachi deployment cannot be removed until another Hachi deployment exists.");
		}
		this.fleet.deployments = this.fleet.deployments.filter(item => item.id !== deploymentId);
		if (this.fleet.activeDeploymentId === deploymentId) {
			this.fleet.activeDeploymentId = this.fleet.deployments[0]?.id || null;
		}
		this.saveFleetRegistry();
		this.log(`Fleet deployment removed: ${deployment.name}.`, { area: "fleet", deploymentId });
		return this.getFleetState();
	}

	installExternalBotDefinition(jsonText) {
		const parsed = parseJsonText(jsonText, null);
		if (!parsed) {
			throw new Error("Bot definition is not valid JSON.");
		}
		const definition = validateExternalBotDefinition(parsed);
		ensureDir(this.botDefinitionsDir);
		const destination = path.join(this.botDefinitionsDir, `${definition.id}.json`);
		if (fileExists(destination)) {
			throw new Error(`Bot type ${definition.id} is already installed.`);
		}
		writeJsonFile(destination, parsed);
		this.log(`External bot type installed: ${definition.displayName}.`, { area: "fleet", botTypeId: definition.id });
		return this.getFleetState();
	}

	async verifyFleetDeploymentCandidate(context) {
		if (!context.definition.repository?.url) {
			throw new Error("Bot definition must declare its repository URL.");
		}
		let origin;
		let branch;
		let ecosystemFound;
		if (context.server.connection.type === "ssh") {
			const ecosystemCheck = context.definition.capabilities?.pm2 ?
				` && test -f ${quotePosix(context.definition.runtime.ecosystemFile)}` :
				"";
			const result = await this.runFleetRemoteCommand(
				context.server,
				`cd ${quoteRemotePath(context.deployment.installPath)} && git remote get-url origin && git branch --show-current${ecosystemCheck}`,
				{ allowFailure: true, log: false, timeoutMs: 30000 },
			);
			if (result.code !== 0) {
				throw new Error(result.stderr || "Remote deployment is missing its Git origin or ecosystem file.");
			}
			const lines = result.stdout.trim().split(/\r?\n/u);
			origin = lines[0];
			branch = lines[1];
			ecosystemFound = true;
		} else {
			if (!fileExists(context.deployment.installPath)) {
				throw new Error("Deployment folder does not exist.");
			}
			const result = await run("git", ["remote", "get-url", "origin"], {
				allowFailure: true,
				cwd: context.deployment.installPath,
				timeoutMs: 30000,
			});
			if (result.code !== 0) {
				throw new Error("Deployment folder is not a Git checkout with an origin remote.");
			}
			origin = result.stdout.trim();
			const branchResult = await run("git", ["branch", "--show-current"], {
				allowFailure: true,
				cwd: context.deployment.installPath,
				timeoutMs: 30000,
			});
			branch = branchResult.stdout.trim();
			ecosystemFound = fileExists(path.join(context.deployment.installPath, context.definition.runtime.ecosystemFile));
		}
		if (normalizeGitRepositoryIdentity(origin) !== normalizeGitRepositoryIdentity(context.definition.repository.url)) {
			throw new Error(`Repository origin mismatch. Expected ${context.definition.repository.url}, found ${redactUrlCredentials(origin)}.`);
		}
		if (!branch) {
			throw new Error("Deployment repository is in detached HEAD state. Check out a named branch before adding it.");
		}
		if (context.definition.capabilities?.pm2 && !ecosystemFound) {
			throw new Error(`Required ecosystem file was not found: ${context.definition.runtime.ecosystemFile}.`);
		}
		return { branch, origin, ok: true };
	}

	removeExternalBotDefinition(botTypeId) {
		if (botTypeId === "hachi") {
			throw new Error("Native Hachi cannot be removed.");
		}
		if (this.fleet.deployments.some(item => item.botTypeId === botTypeId)) {
			throw new Error("Remove this bot type's deployments first.");
		}
		const destination = path.join(this.botDefinitionsDir, `${botTypeId}.json`);
		if (!fileExists(destination)) {
			throw new Error("External bot type was not found.");
		}
		fs.rmSync(destination, { force: true });
		this.log(`External bot type removed: ${botTypeId}.`, { area: "fleet", botTypeId });
		return this.getFleetState();
	}

	async runFleetDefinitionCommand(deploymentId, commandName, options = {}) {
		const context = this.getFleetDeploymentContext(deploymentId);
		const capabilityByCommand = {
			credentialsWrite: "secretEncryption",
			databaseEncrypt: "databaseEncryption",
			databaseVerify: "databaseEncryption",
			deployCommands: "discordCommands",
			deployGlobalCommands: "discordCommands",
			deployGuildCommands: "discordCommands",
			deleteCommands: "discordCommands",
			testDeployCommands: "discordCommands",
			install: "gitUpdates",
			validate: "gitUpdates",
		};
		if (capabilityByCommand[commandName]) {
			this.assertFleetCapability(context, capabilityByCommand[commandName]);
		}
		const command = context.definition.commands?.[commandName];
		if (!command) {
			throw new Error(`${context.definition.displayName} does not define ${commandName}.`);
		}
		const remoteCommand = [command.executable, ...command.args].map(quotePosix).join(" ");
		return this.runFleetDeploymentCommand(
			context,
			{ command: command.executable, args: command.args },
			remoteCommand,
			{ env: options.env, timeoutMs: options.timeoutMs || 600000 },
		);
	}

	async runFleetGit(context, args, options = {}) {
		if (context.server.connection.type === "ssh") {
			return this.runFleetRemoteCommand(
				context.server,
				`cd ${quoteRemotePath(context.deployment.installPath)} && ${gitShellCommand(args)}`,
				options,
			);
		}
		return run("git", args, {
			cwd: context.deployment.installPath,
			allowFailure: Boolean(options.allowFailure),
			timeoutMs: options.timeoutMs || 300000,
			onLog: options.log === false ? undefined : entry => this.logShell(entry),
		});
	}

	async getFleetRepositoryStatus(deploymentId, options = {}) {
		const context = this.getFleetDeploymentContext(deploymentId);
		if (options.fetch) {
			this.assertFleetCapability(context, "gitUpdates");
		}
		const [head, branch, changes, origin] = await Promise.all([
			this.runFleetGit(context, ["rev-parse", "HEAD"], { allowFailure: true, log: false }),
			this.runFleetGit(context, ["branch", "--show-current"], { allowFailure: true, log: false }),
			this.runFleetGit(context, ["status", "--porcelain"], { allowFailure: true, log: false }),
			this.runFleetGit(context, ["remote", "get-url", "origin"], { allowFailure: true, log: false }),
		]);
		if (head.code !== 0) {
			return { deploymentId, isGit: false, message: "Deployment is not a Git checkout." };
		}
		// A user may deliberately switch an installation after onboarding. Always
		// update the branch that is actually checked out, using saved metadata only
		// when Git cannot report a current branch.
		const targetBranch = branch.stdout.trim() || context.deployment.repositoryBranch || context.definition.repository?.branch || "main";
		const originUrl = origin.stdout.trim();
		const originMatches = origin.code === 0 && normalizeGitRepositoryIdentity(originUrl) === normalizeGitRepositoryIdentity(context.definition.repository?.url);
		if (!originMatches && options.fetch) {
			throw new Error(`Repository origin mismatch. Expected ${context.definition.repository?.url || "a declared URL"}, found ${redactUrlCredentials(originUrl) || "none"}.`);
		}
		let behind = null;
		if (options.fetch) {
			await this.runFleetGit(context, ["fetch", "origin", targetBranch], { timeoutMs: 300000 });
			const count = await this.runFleetGit(context, ["rev-list", "--count", `HEAD..origin/${targetBranch}`], { allowFailure: true, log: false });
			behind = count.code === 0 ? Number.parseInt(count.stdout.trim(), 10) || 0 : null;
		}
		return {
			deploymentId,
			isGit: true,
			head: head.stdout.trim(),
			branch: branch.stdout.trim(),
			originUrl: redactUrlCredentials(originUrl),
			originMatches,
			targetBranch,
			dirty: Boolean(changes.stdout.trim()),
			changes: changes.stdout.trim().split(/\r?\n/u).filter(Boolean).slice(0, 100),
			behind,
			updateAvailable: behind !== null && behind > 0,
		};
	}

	async updateFleetDeployment(deploymentId) {
		const context = this.getFleetDeploymentContext(deploymentId);
		this.assertFleetCapability(context, "gitUpdates");
		if (!context.definition.capabilities?.gitUpdates) {
			throw new Error(`${context.definition.displayName} does not declare Git update capability.`);
		}
		const before = await this.getFleetRepositoryStatus(deploymentId, { fetch: true });
		if (!before.isGit) {
			throw new Error(before.message);
		}
		if (before.dirty) {
			throw new Error("Deployment has local changes. Commit or stash them before updating.");
		}
		if (!before.updateAvailable) {
			return { ...before, ok: true, message: "Deployment is already current." };
		}
		let databaseBackup = null;
		if (context.definition.paths?.database) {
			this.assertFleetCapability(context, "backups");
			databaseBackup = await this.backupFleetDatabase(deploymentId);
		}
		await this.controlFleetDeployment(deploymentId, "stop").catch(() => null);
		try {
			await this.runFleetGit(context, ["merge", "--ff-only", `origin/${before.targetBranch}`], { timeoutMs: 300000 });
			if (context.definition.commands?.install) {
				await this.runFleetDefinitionCommand(deploymentId, "install", { timeoutMs: 600000 });
			}
			if (context.definition.commands?.validate) {
				await this.runFleetDefinitionCommand(deploymentId, "validate", { timeoutMs: 300000 });
			}
			if (context.definition.capabilities?.pm2) {
				await this.controlFleetDeployment(deploymentId, "start");
			}
			const after = await this.getFleetRepositoryStatus(deploymentId);
			this.log(`Fleet deployment updated: ${context.deployment.name}.`, { area: "fleet-update", deploymentId, from: before.head, to: after.head });
			return { ...after, backupId: databaseBackup?.backupId || null, ok: true, message: "Deployment updated and validated." };
		} catch (error) {
			// The worktree was verified clean before updating, so returning to the
			// recorded commit cannot overwrite user changes created before this run.
			await this.runFleetGit(context, ["reset", "--hard", before.head], { allowFailure: true, timeoutMs: 300000 });
			if (databaseBackup) {
				await this.restoreFleetDatabaseBackup(deploymentId, databaseBackup.backupId);
			}
			throw new Error(`${error.message} Code and database rollback attempted.`);
		}
	}

	async deployFleetDiscordCommands(deploymentId) {
		const context = this.getFleetDeploymentContext(deploymentId);
		this.assertFleetCapability(context, "discordCommands");
		if (!context.definition.capabilities?.discordCommands) {
			throw new Error(`${context.definition.displayName} does not declare Discord command deployment capability.`);
		}
		await this.assertCredentialLeaseAvailable(deploymentId);
		if (context.definition.id === "hachi") {
			for (const commandName of ["deleteCommands", "deployGlobalCommands", "deployGuildCommands"]) {
				await this.runFleetDefinitionCommand(deploymentId, commandName, { timeoutMs: 300000 });
			}
		} else {
			await this.runFleetDefinitionCommand(deploymentId, "deployCommands", { timeoutMs: 300000 });
		}
		this.log(`Discord commands deployed for ${context.deployment.name}.`, { area: "fleet-discord", deploymentId });
		return { deploymentId, ok: true, message: "Discord commands deployed." };
	}

	getFleetDeploymentContext(deploymentId) {
		const deployment = this.fleet.deployments.find(item => item.id === deploymentId);
		if (!deployment) {
			throw new Error("Deployment was not found.");
		}
		const server = this.fleet.servers.find(item => item.id === deployment.serverId);
		if (!server) {
			throw new Error("Deployment server was not found.");
		}
		const loaded = loadBotDefinitions(this.botDefinitionsDir);
		const definition = loaded.definitions.find(item => item.id === deployment.botTypeId);
		if (!definition) {
			throw new Error(`Bot type ${deployment.botTypeId} is not installed.`);
		}
		return { definition, deployment, server };
	}

	assertFleetCapability(context, capability) {
		if (context.definition.source === "native") {
			return;
		}
		if (context.deployment.definitionFingerprint !== context.definition.fingerprint) {
			throw new Error(`${context.definition.displayName} definition changed after approval. Review and reapprove this deployment before modifying it.`);
		}
		if (!context.definition.capabilities?.[capability] || !context.deployment.approvedCapabilities?.[capability]) {
			throw new Error(`${context.definition.displayName} deployment has not approved the ${capability} capability.`);
		}
	}

	async runFleetRemoteCommand(server, command, options = {}) {
		const connection = server.connection;
		const settings = normalizeRemoteSettings({
			host: connection.host,
			username: connection.username,
			sshKeyPath: connection.sshKeyPath,
			portMode: connection.portMode,
			port: connection.port,
			remotePath: "/",
			pm2Name: "unused",
		});
		validateRemoteSettings(settings, { requireFields: true });
		return run("ssh", this.buildRemoteSshArgs(settings, command), {
			allowFailure: Boolean(options.allowFailure),
			input: options.input,
			timeoutMs: options.timeoutMs || 120000,
			onLog: options.log === false ? undefined : entry => this.logShell(entry),
		});
	}

	async runFleetDeploymentCommand(context, localCommand, remoteCommand, options = {}) {
		if (context.server.connection.type === "ssh") {
			return this.runFleetRemoteCommand(context.server, `cd ${quoteRemotePath(context.deployment.installPath)} && ${remoteCommand}`, options);
		}
		return run(localCommand.command, localCommand.args || [], {
			cwd: context.deployment.installPath,
			allowFailure: Boolean(options.allowFailure),
			env: options.env,
			input: options.input,
			timeoutMs: options.timeoutMs || 120000,
			onLog: options.log === false ? undefined : entry => this.logShell(entry),
		});
	}

	async getFleetDeploymentStatus(deploymentId) {
		const context = this.getFleetDeploymentContext(deploymentId);
		let result;
		if (context.server.connection.type === "ssh") {
			result = await this.runFleetRemoteCommand(context.server, "pm2 jlist", { allowFailure: true, log: false, timeoutMs: 30000 });
		} else {
			if (!await commandExists("pm2")) {
				return { deploymentId, installed: false, registered: false, status: "pm2-missing", message: "PM2 is not installed." };
			}
			result = await run("pm2", ["jlist"], { allowFailure: true, timeoutMs: 30000 });
		}
		if (result.code !== 0) {
			return { deploymentId, installed: true, registered: false, status: "error", message: result.stderr || "Could not read PM2 status." };
		}
		try {
			const app = parsePm2Json(result.stdout).find(item => item.name === context.deployment.pm2Name);
			if (!app) {
				return { deploymentId, installed: true, registered: false, status: "not-registered", message: `${context.deployment.pm2Name} is not registered.` };
			}
			return {
				deploymentId,
				installed: true,
				registered: true,
				status: app.pm2_env?.status || "unknown",
				pid: app.pid || null,
				cpu: app.monit?.cpu || 0,
				memory: app.monit?.memory || 0,
				restarts: app.pm2_env?.restart_time || 0,
				message: `${context.deployment.name} is ${app.pm2_env?.status || "unknown"}.`,
			};
		} catch (error) {
			return { deploymentId, installed: true, registered: false, status: "error", message: error.message };
		}
	}

	async controlFleetDeployment(deploymentId, action) {
		if (!["start", "stop", "restart"].includes(action)) {
			throw new Error("Unsupported runtime action.");
		}
		const context = this.getFleetDeploymentContext(deploymentId);
		this.assertFleetCapability(context, "pm2");
		if (action === "start" || action === "restart") {
			await this.assertCredentialLeaseAvailable(deploymentId);
		}
		if (!context.definition.capabilities?.pm2) {
			throw new Error(`${context.definition.displayName} does not declare PM2 capability.`);
		}
		const status = await this.getFleetDeploymentStatus(deploymentId);
		const ecosystem = context.definition.runtime.ecosystemFile;
		let localArgs;
		let remoteCommand;
		if (action === "start" && !status.registered) {
			localArgs = ["start", ecosystem, "--only", context.deployment.pm2Name];
			remoteCommand = `pm2 start ${quotePosix(ecosystem)} --only ${quotePosix(context.deployment.pm2Name)}`;
		} else {
			localArgs = [action === "start" ? "restart" : action, context.deployment.pm2Name];
			remoteCommand = `pm2 ${action === "start" ? "restart" : action} ${quotePosix(context.deployment.pm2Name)}`;
		}
		this.log(`${action[0].toUpperCase()}${action.slice(1)}ing fleet deployment ${context.deployment.name}.`, { area: "fleet-runtime", action, deploymentId, serverId: context.server.id });
		await this.runFleetDeploymentCommand(context, { command: "pm2", args: localArgs }, remoteCommand);
		if (action !== "stop") {
			if (context.server.connection.type === "ssh") {
				await this.runFleetRemoteCommand(context.server, "pm2 save", { timeoutMs: 120000 });
			} else {
				await run("pm2", ["save"], { timeoutMs: 120000, onLog: entry => this.logShell(entry) });
			}
		}
		return this.getFleetDeploymentStatus(deploymentId);
	}

	async getFleetDeploymentLogs(deploymentId, lines = 200) {
		const context = this.getFleetDeploymentContext(deploymentId);
		this.assertFleetCapability(context, "logs");
		const safeLines = Math.min(1000, Math.max(20, Number.parseInt(String(lines), 10) || 200));
		const result = await this.runFleetDeploymentCommand(
			context,
			{ command: "pm2", args: ["logs", context.deployment.pm2Name, "--lines", String(safeLines), "--nostream", "--no-color"] },
			`pm2 logs ${quotePosix(context.deployment.pm2Name)} --lines ${safeLines} --nostream --no-color`,
			{ allowFailure: true, log: false, timeoutMs: 30000 },
		);
		return { deploymentId, logs: redactHachiGenLogText(`${result.stdout || ""}${result.stderr ? `\n${result.stderr}` : ""}`), ok: result.code === 0 };
	}

	async checkFleetDeploymentHealth(deploymentId) {
		const context = this.getFleetDeploymentContext(deploymentId);
		let pathResult;
		if (context.server.connection.type === "ssh") {
			pathResult = await this.runFleetRemoteCommand(context.server, `test -d ${quoteRemotePath(context.deployment.installPath)}`, { allowFailure: true, log: false, timeoutMs: 30000 });
		} else {
			pathResult = { code: fileExists(context.deployment.installPath) ? 0 : 1 };
		}
		const runtime = await this.getFleetDeploymentStatus(deploymentId);
		return {
			deploymentId,
			checkedAt: new Date().toISOString(),
			installFound: pathResult.code === 0,
			runtime,
			security: { status: "unverified", message: "Run a deployment security audit before treating stored Discord data as protected." },
			ok: pathResult.code === 0 && !["error", "pm2-missing"].includes(runtime.status),
		};
	}

	async getFleetDeploymentOverview(deploymentId) {
		const context = this.getFleetDeploymentContext(deploymentId);
		const [healthResult, repositoryResult, securityResult] = await Promise.allSettled([
			this.checkFleetDeploymentHealth(deploymentId),
			this.getFleetRepositoryStatus(deploymentId),
			this.auditFleetDeploymentSecurity(deploymentId),
		]);
		const failure = result => result.status === "rejected" ? { error: readableCause(result.reason) } : result.value;
		return {
			deployment: {
				capabilities: context.definition.source === "native" ? context.definition.capabilities : context.deployment.approvedCapabilities,
				id: context.deployment.id,
				installPath: context.deployment.installPath,
				name: context.deployment.name,
			},
			health: failure(healthResult),
			repository: failure(repositoryResult),
			security: failure(securityResult),
			server: {
				id: context.server.id,
				name: context.server.name,
				type: context.server.connection.type,
			},
		};
	}

	getFleetBackupVault() {
		return readJson(path.join(this.userDataPath, "fleet-backup-vault.json"), { version: 1, records: {} }) || { version: 1, records: {} };
	}

	saveFleetBackupVault(vault) {
		if (!this.protectSecret) {
			throw new Error("Operating-system backup-key encryption is unavailable.");
		}
		const filePath = path.join(this.userDataPath, "fleet-backup-vault.json");
		const temporaryPath = `${filePath}.${process.pid}.tmp`;
		fs.writeFileSync(temporaryPath, `${JSON.stringify(vault, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
		fs.renameSync(temporaryPath, filePath);
	}

	async auditFleetDeploymentSecurity(deploymentId) {
		const context = this.getFleetDeploymentContext(deploymentId);
		const databaseRelativePath = context.definition.paths?.database;
		if (!databaseRelativePath) {
			return { deploymentId, checkedAt: new Date().toISOString(), database: { status: "not-applicable", message: "No database is declared." }, ok: true };
		}
		let database;
		if (context.server.connection.type === "ssh") {
			// Kept as one literal because it executes on the remote Node runtime.
			// eslint-disable-next-line max-len
			const script = "const fs=require('node:fs');const p=process.argv[1];if(!fs.existsSync(p)){console.log(JSON.stringify({exists:false}));process.exit(0)}const fd=fs.openSync(p,'r');const b=Buffer.alloc(16);fs.readSync(fd,b,0,16,0);fs.closeSync(fd);const s=fs.statSync(p);console.log(JSON.stringify({exists:true,header:b.toString('hex'),size:s.size,mode:s.mode&511}))";
			const result = await this.runFleetRemoteCommand(
				context.server,
				`cd ${quoteRemotePath(context.deployment.installPath)} && node -e ${quotePosix(script)} ${quotePosix(databaseRelativePath)}`,
				{ allowFailure: true, log: false, timeoutMs: 30000 },
			);
			database = parseJsonText(result.stdout, { exists: false, error: result.stderr || "Database inspection failed." });
		} else {
			const databasePath = path.join(context.deployment.installPath, databaseRelativePath);
			if (!isPathInside(context.deployment.installPath, databasePath)) {
				throw new Error("Database path escapes the deployment root.");
			}
			if (!fileExists(databasePath)) {
				database = { exists: false };
			} else {
				const fd = fs.openSync(databasePath, "r");
				const header = Buffer.alloc(16);
				try {
					fs.readSync(fd, header, 0, 16, 0);
				} finally {
					fs.closeSync(fd);
				}
				const stats = fs.statSync(databasePath);
				database = { exists: true, header: header.toString("hex"), size: stats.size, mode: stats.mode & 0o777 };
			}
		}
		if (!database.exists) {
			return { deploymentId, checkedAt: new Date().toISOString(), database: { ...database, status: "missing", message: "Declared database was not found." }, ok: false };
		}
		const plaintext = database.header === SQLITE_HEADER.toString("hex");
		let verified = false;
		let verificationMessage = "Encrypted-looking header has not been verified with the database key.";
		const databaseVerificationApproved = context.definition.native ||
			(context.definition.capabilities?.databaseEncryption && context.deployment.approvedCapabilities?.databaseEncryption);
		if (!plaintext && context.definition.commands?.databaseVerify && databaseVerificationApproved) {
			const result = await this.runFleetDefinitionCommand(deploymentId, "databaseVerify", { timeoutMs: 120000 });
			verified = result.code === 0;
			verificationMessage = verified ? "Database opened successfully through the bot's declared verification command." : "Database verification command failed.";
		}
		const status = plaintext ? "noncompliant" : (verified ? "protected" : "encrypted-unverified");
		return {
			deploymentId,
			checkedAt: new Date().toISOString(),
			database: {
				...database,
				path: databaseRelativePath,
				plaintext,
				verified,
				status,
				message: plaintext ? "Plain SQLite header detected. Discord API data is not encrypted at rest." : verificationMessage,
			},
			ok: status === "protected",
		};
	}

	async backupFleetDatabase(deploymentId) {
		if (!this.protectSecret) {
			throw new Error("Operating-system backup-key encryption is unavailable.");
		}
		const context = this.getFleetDeploymentContext(deploymentId);
		this.assertFleetCapability(context, "backups");
		const databaseRelativePath = context.definition.paths?.database;
		if (!databaseRelativePath) {
			throw new Error("This bot type does not declare a database.");
		}
		const backupId = `backup-${crypto.randomUUID()}`;
		const fileName = `database-${runtimeArchiveStamp()}.hgbak`;
		const key = crypto.randomBytes(32);
		const iv = crypto.randomBytes(12);
		let backupPath;
		let bytes;
		if (context.server.connection.type === "ssh") {
			backupPath = `manager/backups/fleet/${fileName}`;
			// The remote worker receives its key through stdin, never argv.
			// eslint-disable-next-line max-len
			const script = "const fs=require('node:fs'),p=JSON.parse(fs.readFileSync(0,'utf8')),c=require('node:crypto');fs.mkdirSync(require('node:path').dirname(p.out),{recursive:true});const d=fs.readFileSync(p.src),iv=Buffer.from(p.iv,'base64'),k=Buffer.from(p.key,'base64'),x=c.createCipheriv('aes-256-gcm',k,iv),e=Buffer.concat([x.update(d),x.final()]),tag=x.getAuthTag();fs.writeFileSync(p.out,Buffer.concat([Buffer.from('HGBK1'),iv,tag,e]),{mode:384});console.log(JSON.stringify({bytes:e.length+33,path:p.out}))";
			const result = await this.runFleetRemoteCommand(
				context.server,
				`cd ${quoteRemotePath(context.deployment.installPath)} && node -e ${quotePosix(script)}`,
				{ input: JSON.stringify({ src: databaseRelativePath, out: backupPath, key: key.toString("base64"), iv: iv.toString("base64") }), log: false, timeoutMs: 300000 },
			);
			const parsed = parseJsonText(result.stdout, null);
			if (!parsed) {
				throw new Error("Remote encrypted backup did not return metadata.");
			}
			bytes = parsed.bytes;
		} else {
			const sourcePath = path.join(context.deployment.installPath, databaseRelativePath);
			backupPath = path.join(context.deployment.installPath, "manager", "backups", "fleet", fileName);
			if (!isPathInside(context.deployment.installPath, sourcePath) || !fileExists(sourcePath)) {
				throw new Error("Declared database was not found.");
			}
			ensureDir(path.dirname(backupPath));
			const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
			const encrypted = Buffer.concat([cipher.update(fs.readFileSync(sourcePath)), cipher.final()]);
			fs.writeFileSync(backupPath, Buffer.concat([Buffer.from("HGBK1"), iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
			bytes = encrypted.length + 33;
		}
		const vault = this.getFleetBackupVault();
		vault.records[backupId] = {
			backupPath,
			createdAt: new Date().toISOString(),
			deploymentId,
			key: this.protectSecret(key.toString("base64")),
			serverId: context.server.id,
		};
		this.saveFleetBackupVault(vault);
		this.log(`Encrypted fleet database backup created for ${context.deployment.name}.`, { area: "fleet-backup", backupId, deploymentId, serverId: context.server.id });
		await this.pruneFleetBackups(deploymentId);
		return { backupId, backupPath, bytes, encrypted: true, ok: true };
	}

	async restoreFleetDatabaseBackup(deploymentId, backupId) {
		if (!this.unprotectSecret) {
			throw new Error("Operating-system backup-key decryption is unavailable.");
		}
		const context = this.getFleetDeploymentContext(deploymentId);
		this.assertFleetCapability(context, "backups");
		const record = this.getFleetBackupVault().records[backupId];
		if (!record || record.deploymentId !== deploymentId || record.serverId !== context.server.id) {
			throw new Error("Backup does not belong to this deployment and server.");
		}
		const databaseRelativePath = context.definition.paths?.database;
		const key = this.unprotectSecret(record.key);
		await this.controlFleetDeployment(deploymentId, "stop").catch(() => null);
		if (context.server.connection.type === "ssh") {
			// Restore keeps the prior remote file beside the database for recovery.
			// eslint-disable-next-line max-len
			const script = "const fs=require('node:fs'),p=JSON.parse(fs.readFileSync(0,'utf8')),c=require('node:crypto'),b=fs.readFileSync(p.src);if(b.subarray(0,5).toString()!=='HGBK1')throw Error('Invalid backup');const d=c.createDecipheriv('aes-256-gcm',Buffer.from(p.key,'base64'),b.subarray(5,17));d.setAuthTag(b.subarray(17,33));const out=Buffer.concat([d.update(b.subarray(33)),d.final()]);try{fs.copyFileSync(p.dest,p.dest+'.pre-restore')}catch{}fs.writeFileSync(p.dest,out,{mode:384});";
			await this.runFleetRemoteCommand(context.server, `cd ${quoteRemotePath(context.deployment.installPath)} && node -e ${quotePosix(script)}`, {
				input: JSON.stringify({ src: record.backupPath, dest: databaseRelativePath, key }),
				log: false,
				timeoutMs: 300000,
			});
		} else {
			const buffer = fs.readFileSync(record.backupPath);
			if (buffer.subarray(0, 5).toString() !== "HGBK1") {
				throw new Error("Backup format is invalid.");
			}
			const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), buffer.subarray(5, 17));
			decipher.setAuthTag(buffer.subarray(17, 33));
			const restored = Buffer.concat([decipher.update(buffer.subarray(33)), decipher.final()]);
			const destination = path.join(context.deployment.installPath, databaseRelativePath);
			if (fileExists(destination)) {
				fs.copyFileSync(destination, `${destination}.pre-restore`);
			}
			fs.writeFileSync(destination, restored, { mode: 0o600 });
			removeLocalDatabaseSidecars(destination);
		}
		this.log(`Encrypted fleet database backup restored for ${context.deployment.name}.`, { area: "fleet-backup", backupId, deploymentId });
		return { backupId, deploymentId, ok: true, message: "Database restored. Start the deployment after reviewing its security audit." };
	}

	async encryptFleetDatabase(deploymentId) {
		const context = this.getFleetDeploymentContext(deploymentId);
		this.assertFleetCapability(context, "databaseEncryption");
		if (context.definition.id === "hachi" && context.deployment.installPath === this.getActiveInstallIdentifier()) {
			return this.convertDatabaseEncryption();
		}
		if (!context.definition.commands?.databaseEncrypt || !context.definition.commands?.databaseVerify) {
			throw new Error("External bot definition must declare databaseEncrypt and databaseVerify commands.");
		}
		const recovery = await this.backupFleetDatabase(deploymentId);
		await this.controlFleetDeployment(deploymentId, "stop").catch(() => null);
		try {
			await this.runFleetDefinitionCommand(deploymentId, "databaseEncrypt", { timeoutMs: 600000 });
			const audit = await this.auditFleetDeploymentSecurity(deploymentId);
			if (!audit.ok) {
				throw new Error(audit.database.message || "Encrypted database verification failed.");
			}
			return { ...audit, backupId: recovery.backupId, message: "Database encrypted and verified. Encrypted recovery backup retained." };
		} catch (error) {
			await this.restoreFleetDatabaseBackup(deploymentId, recovery.backupId);
			throw new Error(`${error.message} Original database restored from encrypted recovery backup.`);
		}
	}

	setFleetDeploymentPolicies(deploymentId, values = {}) {
		const deployment = this.fleet.deployments.find(item => item.id === deploymentId);
		if (!deployment) {
			throw new Error("Deployment was not found.");
		}
		deployment.policies = {
			...deployment.policies,
			backupRetention: Math.min(365, Math.max(1, Number.parseInt(String(values.backupRetention), 10) || 14)),
			autoBackupHours: Math.min(720, Math.max(0, Number.parseInt(String(values.autoBackupHours), 10) || 0)),
			logRetentionDays: Math.min(3650, Math.max(1, Number.parseInt(String(values.logRetentionDays), 10) || 30)),
			requireEncryptedDatabase: values.requireEncryptedDatabase !== false,
			requireEncryptedBackups: true,
		};
		this.saveFleetRegistry();
		this.log(`Security and retention policies updated for ${deployment.name}.`, { area: "fleet-policy", deploymentId });
		return this.getFleetState();
	}

	startFleetMaintenance() {
		if (this.fleetMaintenanceTimer) {
			return;
		}
		const runMaintenance = () => this.runFleetMaintenance().catch(error => {
			this.event("error", `Fleet maintenance failed: ${error.message}`, { area: "fleet-maintenance" });
		});
		this.fleetMaintenanceTimer = setInterval(runMaintenance, 5 * 60 * 1000);
		this.fleetMaintenanceTimer.unref?.();
		setTimeout(runMaintenance, 15000).unref?.();
	}

	stopFleetMaintenance() {
		if (this.fleetMaintenanceTimer) {
			clearInterval(this.fleetMaintenanceTimer);
		}
		this.fleetMaintenanceTimer = null;
	}

	async runFleetMaintenance() {
		for (const deployment of this.fleet.deployments) {
			const hours = deployment.policies?.autoBackupHours || 0;
			if (!hours) {
				continue;
			}
			const context = this.getFleetDeploymentContext(deployment.id);
			if (!context.definition.paths?.database) {
				continue;
			}
			// Scheduled work must honor the same reviewed capability snapshot as manual actions.
			if (!context.definition.native && !context.deployment.approvedCapabilities?.backups) {
				continue;
			}
			const latest = this.listFleetBackups(deployment.id)[0];
			const due = !latest || Date.now() - new Date(latest.createdAt).getTime() >= hours * 3600000;
			if (!due) {
				continue;
			}
			await this.backupFleetDatabase(deployment.id);
			if (context.definition.native || context.deployment.approvedCapabilities?.logs) {
				await this.pruneFleetLogs(deployment.id).catch(() => null);
			}
		}
		return { ok: true };
	}

	listFleetBackups(deploymentId) {
		return Object.entries(this.getFleetBackupVault().records)
			.filter(([, record]) => record.deploymentId === deploymentId)
			.map(([backupId, record]) => ({ backupId, backupPath: record.backupPath, createdAt: record.createdAt, serverId: record.serverId, encrypted: true }))
			.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
	}

	async pruneFleetBackups(deploymentId) {
		const context = this.getFleetDeploymentContext(deploymentId);
		this.assertFleetCapability(context, "backups");
		const backups = this.listFleetBackups(deploymentId);
		const expired = backups.slice(context.deployment.policies?.backupRetention || 14);
		if (!expired.length) {
			return { deploymentId, deleted: 0, kept: backups.length, ok: true };
		}
		if (context.server.connection.type === "ssh") {
			// eslint-disable-next-line max-len
			const script = "const fs=require('node:fs'),p=JSON.parse(fs.readFileSync(0,'utf8'));for(const f of p.files){const n=f.replace(/\\\\/g,'/');if(!n.startsWith('manager/backups/fleet/')||n.includes('..'))throw Error('Unsafe backup path');fs.rmSync(n,{force:true})}";
			await this.runFleetRemoteCommand(context.server, `cd ${quoteRemotePath(context.deployment.installPath)} && node -e ${quotePosix(script)}`, {
				input: JSON.stringify({ files: expired.map(item => item.backupPath) }),
				log: false,
			});
		} else {
			const backupRoot = path.join(context.deployment.installPath, "manager", "backups", "fleet");
			for (const backup of expired) {
				if (!isPathInside(backupRoot, backup.backupPath)) {
					throw new Error("Refused to prune a backup outside the deployment backup directory.");
				}
				fs.rmSync(backup.backupPath, { force: true });
			}
		}
		const vault = this.getFleetBackupVault();
		for (const backup of expired) {
			delete vault.records[backup.backupId];
		}
		this.saveFleetBackupVault(vault);
		this.log(`Pruned ${expired.length} expired encrypted backup(s) for ${context.deployment.name}.`, { area: "fleet-backup", deploymentId });
		return { deploymentId, deleted: expired.length, kept: backups.length - expired.length, ok: true };
	}

	async pruneFleetLogs(deploymentId) {
		const context = this.getFleetDeploymentContext(deploymentId);
		this.assertFleetCapability(context, "logs");
		const logsRelativePath = context.definition.paths?.logs;
		if (!logsRelativePath) {
			throw new Error("This bot type does not declare a log directory.");
		}
		const retentionDays = context.deployment.policies?.logRetentionDays || 30;
		if (context.server.connection.type === "ssh") {
			// eslint-disable-next-line max-len
			const script = "const fs=require('node:fs'),path=require('node:path'),p=JSON.parse(fs.readFileSync(0,'utf8')),cut=Date.now()-p.days*86400000;let n=0;if(fs.existsSync(p.dir))for(const e of fs.readdirSync(p.dir,{withFileTypes:true})){const f=path.join(p.dir,e.name);if(e.isFile()&&/\\.(?:log|txt)$/i.test(e.name)&&fs.statSync(f).mtimeMs<cut){fs.rmSync(f,{force:true});n++}}console.log(JSON.stringify({deleted:n}))";
			const result = await this.runFleetRemoteCommand(context.server, `cd ${quoteRemotePath(context.deployment.installPath)} && node -e ${quotePosix(script)}`, {
				input: JSON.stringify({ dir: logsRelativePath, days: retentionDays }),
				log: false,
			});
			return { deploymentId, ...parseJsonText(result.stdout, { deleted: 0 }), ok: true };
		}
		const logsPath = path.join(context.deployment.installPath, logsRelativePath);
		if (!isPathInside(context.deployment.installPath, logsPath)) {
			throw new Error("Log path escapes deployment root.");
		}
		const cutoff = Date.now() - retentionDays * 86400000;
		let deleted = 0;
		if (fileExists(logsPath)) {
			for (const entry of fs.readdirSync(logsPath, { withFileTypes: true })) {
				const filePath = path.join(logsPath, entry.name);
				if (entry.isFile() && /\.(?:log|txt)$/iu.test(entry.name) && fs.statSync(filePath).mtimeMs < cutoff) {
					fs.rmSync(filePath, { force: true });
					deleted += 1;
				}
			}
		}
		this.log(`Pruned ${deleted} expired log file(s) for ${context.deployment.name}.`, { area: "fleet-logs", deploymentId });
		return { deploymentId, deleted, ok: true };
	}

	async assertCredentialLeaseAvailable(deploymentId) {
		const deployment = this.fleet.deployments.find(item => item.id === deploymentId);
		if (!deployment?.credentialFingerprint || deployment.allowConcurrentCredentials) {
			return;
		}
		const conflicts = this.fleet.deployments.filter(item =>
			item.id !== deploymentId && item.credentialFingerprint === deployment.credentialFingerprint,
		);
		for (const conflict of conflicts) {
			const status = await this.getFleetDeploymentStatus(conflict.id);
			if (status.status === "online" || status.status === "launching") {
				throw new Error(`The same Discord identity is already active on ${conflict.name}. Stop that deployment before starting this one.`);
			}
		}
	}

	async saveFleetDeploymentCredentials(deploymentId, values) {
		const context = this.getFleetDeploymentContext(deploymentId);
		if (context.definition.source !== "native") {
			this.assertFleetCapability(context, "secretEncryption");
			if (context.definition.credentials?.mode !== "adapter") {
				throw new Error("This bot keeps credentials externally managed. HachiGen will not modify them.");
			}
		}
		const token = String(values?.token || "").trim();
		const clientId = String(values?.clientId || "").trim();
		if (!token || !clientId) {
			throw new Error("Discord token and application ID are required.");
		}
		const payload = {
			token,
			clientId,
			clientSecret: String(values.clientSecret || ""),
			publicKey: String(values.publicKey || ""),
			guildIds: normalizeConfigIdList(values.guildIds),
		};
		if (context.definition.id === "hachi" && context.deployment.installPath === this.getActiveInstallIdentifier()) {
			await this.writeConfiguration({ TOKEN: token, clientId });
		} else {
			const command = context.definition.commands?.credentialsWrite;
			if (!command) {
				throw new Error("External bot definition must declare credentialsWrite to encrypt credentials in its deployment folder.");
			}
			const remoteCommand = [command.executable, ...command.args].map(quotePosix).join(" ");
			await this.runFleetDeploymentCommand(
				context,
				{ command: command.executable, args: command.args },
				remoteCommand,
				{ input: JSON.stringify(payload), timeoutMs: 120000 },
			);
		}
		context.deployment.credentialFingerprint = crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
		context.deployment.credentialsConfigured = true;
		context.deployment.applicationId = clientId;
		context.deployment.allowConcurrentCredentials = Boolean(values.allowConcurrent);
		this.saveFleetRegistry();
		this.log(`Deployment credentials updated in ${context.deployment.name}'s own storage.`, {
			area: "deployment-credentials",
			deploymentId,
		});
		return this.getFleetState();
	}

	getFleetState() {
		const botTypes = loadBotDefinitions(this.botDefinitionsDir);
		const servers = this.fleet.servers.map(server => ({
			...server,
			deploymentCount: this.fleet.deployments.filter(deployment => deployment.serverId === server.id).length,
		}));

		return {
			activeDeploymentId: this.fleet.activeDeploymentId,
			botDefinitionErrors: botTypes.errors,
			botTypes: botTypes.definitions,
			deployments: this.fleet.deployments.map(deployment => {
				const server = this.fleet.servers.find(item => item.id === deployment.serverId);
				const definition = botTypes.definitions.find(item => item.id === deployment.botTypeId);
				const packageJson = server?.connection?.type === "local" ? readJson(path.join(deployment.installPath, "package.json"), {}) : {};
				return {
					...deployment,
					testCommandsAvailable: definition?.id === "hachi" || Boolean(definition?.commands?.testDeployCommands || packageJson.scripts?.["deploy:test"]),
				};
			}),
			policies: this.fleet.policies,
			servers,
			version: this.fleet.version,
		};
	}

	getFleetDeploymentConfiguration(deploymentId) {
		const selected = this.getFleetDeploymentContext(deploymentId);
		const localDeployment = this.fleet.deployments.find(item => item.botTypeId === selected.deployment.botTypeId &&
			this.fleet.servers.find(server => server.id === item.serverId)?.connection?.type === "local");
		if (!localDeployment) {
			throw new Error("A local source repository is required to manage this bot's configuration.");
		}
		const candidates = [".env", "config/config.json", "config.json", "config/settings.json", "settings.json"];
		const files = candidates.flatMap(relativePath => {
			const filePath = path.join(localDeployment.installPath, relativePath);
			if (!isPathInside(localDeployment.installPath, filePath) || !fileExists(filePath)) {
				return [];
			}
			const text = fs.readFileSync(filePath, "utf8");
			if (relativePath === ".env") {
				const fields = Object.entries(parseDotEnvContent(text)).map(([key, value]) => {
					const sensitive = isSensitiveConfigKey(key);
					return { hasValue: sensitive ? Boolean(value) : undefined, key, sensitive, type: "string", value: sensitive ? "" : value };
				});
				return [{ fields, format: "env", hash: crypto.createHash("sha256").update(text).digest("hex"), path: relativePath }];
			}
			const parsed = parseJsonText(text, null);
			if (!parsed || Array.isArray(parsed)) {
				return [];
			}
			const fields = flattenConfigValues(parsed).map(field => {
				const sensitive = isSensitiveConfigKey(field.key);
				return { ...field, hasValue: sensitive ? Boolean(field.value) : undefined, sensitive, value: sensitive ? "" : field.value };
			});
			return [{
				fields,
				format: "json",
				hash: crypto.createHash("sha256").update(text).digest("hex"),
				path: relativePath,
			}];
		});
		return { deploymentId, files, localDeploymentId: localDeployment.id };
	}

	saveFleetDeploymentConfiguration(deploymentId, values = {}) {
		const configuration = this.getFleetDeploymentConfiguration(deploymentId);
		const file = configuration.files.find(item => item.path === values.path);
		if (!file) {
			throw new Error("Configuration file is not managed for this bot.");
		}
		const localDeployment = this.fleet.deployments.find(item => item.id === configuration.localDeploymentId);
		const filePath = path.join(localDeployment.installPath, file.path);
		const currentText = fs.readFileSync(filePath, "utf8");
		if (crypto.createHash("sha256").update(currentText).digest("hex") !== values.hash) {
			throw new Error("Configuration changed outside HachiGen. Refresh before saving.");
		}
		if (file.format === "env") {
			const updates = {};
			for (const field of Array.isArray(values.fields) ? values.fields : []) {
				if (!Object.hasOwn(parseDotEnvContent(currentText), field.key)) {
					throw new Error(`Environment field ${field.key} no longer exists.`);
				}
				// Sensitive inputs are replacements only; blank means preserve the
				// existing value, which never crossed the IPC boundary.
				if (!isSensitiveConfigKey(field.key) || String(field.value || "")) {
					updates[field.key] = String(field.value ?? "");
				}
			}
			const temporaryPath = `${filePath}.hachigen-${process.pid}.tmp`;
			fs.writeFileSync(temporaryPath, updateDotEnvContent(currentText, updates), { encoding: "utf8", mode: 0o600 });
			fs.renameSync(temporaryPath, filePath);
			this.log(`Environment configuration saved for ${localDeployment.name}.`, { area: "fleet", deploymentId });
			return this.getFleetDeploymentConfiguration(deploymentId);
		}
		const parsed = parseJsonText(currentText, null);
		for (const field of Array.isArray(values.fields) ? values.fields : []) {
			if (isSensitiveConfigKey(field.key) && !String(field.value || "")) {
				continue;
			}
			const original = flattenConfigValues(parsed).find(item => item.key === field.key);
			if (!original) {
				throw new Error(`Configuration field ${field.key} no longer exists.`);
			}
			let next = field.value;
			if (original.type === "number") {
				next = Number(next);
			}
			if (original.type === "boolean") {
				next = next === true || next === "true";
			}
			setConfigValue(parsed, field.key, next);
		}
		const temporaryPath = `${filePath}.hachigen-${process.pid}.tmp`;
		fs.writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		fs.renameSync(temporaryPath, filePath);
		this.log(`Configuration saved for ${localDeployment.name}.`, { area: "fleet", deploymentId });
		return this.getFleetDeploymentConfiguration(deploymentId);
	}

	readFleetConfigurationSecretForCopy(deploymentId, relativePath, key) {
		const configuration = this.getFleetDeploymentConfiguration(deploymentId);
		const file = configuration.files.find(item => item.path === relativePath);
		const field = file?.fields.find(item => item.key === key);
		if (!file || !field?.sensitive) {
			throw new Error("Choose a recognized sensitive configuration field.");
		}
		const localDeployment = this.fleet.deployments.find(item => item.id === configuration.localDeploymentId);
		const filePath = path.join(localDeployment.installPath, file.path);
		const text = fs.readFileSync(filePath, "utf8");
		const value = file.format === "env" ? parseDotEnvContent(text)[key] : flattenConfigValues(parseJsonText(text, {})).find(item => item.key === key)?.value;
		if (value === undefined || value === null || String(value) === "") {
			throw new Error(`${key} has no saved value.`);
		}
		return { field: key, ttlMs: 60000, value: String(value) };
	}

	loadSettings() {
		// In development, this is the parent of manager/. In the packaged exe,
		// this is the folder containing HachiGen.exe.
		const defaults = {
			installPath: this.defaultInstallPath,
			activeStash: null,
			hachiGenReleaseTag: null,
			lastRemoteTest: null,
			lastRecoveryNoticeEventTime: null,
			remote: { ...DEFAULT_REMOTE_SETTINGS },
			runtimeTarget: "local",
			windowState: null,
		};
		const saved = readJson(this.settingsPath, {}) || {};

		return {
			...defaults,
			...saved,
			lastRemoteTest: normalizeRemoteTestState(saved.lastRemoteTest),
			windowState: normalizeWindowState(saved.windowState),
			remote: normalizeRemoteSettings(saved.remote),
			runtimeTarget: saved.runtimeTarget === "remote" ? "remote" : "local",
		};
	}

	saveSettings() {
		// settings.json stores user choices such as install path and active stash.
		ensureDir(path.dirname(this.settingsPath));
		fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, "\t"));
	}

	getWindowState() {
		return normalizeWindowState(this.settings.windowState);
	}

	saveWindowState(windowState) {
		const normalized = normalizeWindowState(windowState);

		if (!normalized) {
			return { ok: false, message: "Window state was not saved." };
		}

		this.settings.windowState = normalized;
		this.saveSettings();
		return { ok: true, message: "Window state saved." };
	}

	getPendingRecoveryEvent() {
		const events = this.logger.readRecentEvents(80, { includeHidden: true });
		const recoveryEvents = events.filter(event => ["crash-handler", "process-recovery"].includes(event.area));
		const latest = recoveryEvents[recoveryEvents.length - 1] || null;

		if (!latest || latest.time === this.settings.lastRecoveryNoticeEventTime) {
			return null;
		}

		return latest;
	}

	markRecoveryEventNotified(eventTime) {
		if (!eventTime) {
			return { ok: false, message: "Recovery event was not marked." };
		}

		this.settings.lastRecoveryNoticeEventTime = eventTime;
		this.saveSettings();
		return { ok: true, message: "Recovery notice recorded." };
	}

	async getAboutInfo() {
		const scan = await this.getQuickScan().catch(() => null);
		const logs = this.logger.ensureLogs();
		const notesPath = path.join(this.managerRoot, "docs", "patch-notes.md");
		const releaseNotes = patchNotesSummary(readTextFile(notesPath));

		return {
			appName: "HachiGen",
			fleet: this.getFleetState(),
			hachiGenVersion: this.getHachiGenVersion(),
			hachiVersion: scan?.packageVersion || "unknown",
			installPath: this.getInstallPath(),
			paths: {
				logFolder: logs.folder,
				settingsPath: this.settingsPath,
				userDataPath: this.userDataPath,
			},
			releaseNotes,
			runtimeTarget: this.getRuntimeTarget(),
			updateChannel: "Stable releases (hachigen-v*)",
			updateTarget: UPDATE_TARGET,
		};
	}

	event(type, message, details = {}) {
		// Every event has the same shape so the renderer can format it predictably.
		const event = this.logger.writeEvent({
			details,
			message,
			time: new Date().toISOString(),
			type,
		});

		this.operationLog.push(event);

		// Keep the log useful without letting it grow forever.
		if (this.operationLog.length > 500) {
			this.operationLog.shift();
		}

		if (event.uiVisible !== false) {
			this.sendEvent(event);
		}
	}

	log(message, details = {}) {
		// Convenience wrapper for normal informational events.
		this.event("log", message, details);
	}

	recordRendererEvent(payload = {}) {
		// Renderer-side validation failures and UI-only exceptions should land in
		// the same operation log as backend work. The renderer cannot write that
		// log directly, so it sends a narrow event payload through IPC.
		const type = payload.type === "error" ? "error" : "log";
		const message = redactHachiGenLogText(payload.message || "").trim() || "HachiGen renderer event recorded without a message.";
		const rawDetails = payload.details && typeof payload.details === "object" && !Array.isArray(payload.details) ?
			payload.details :
			{};
		const details = {
			...Object.fromEntries(Object.entries(rawDetails).map(([key, value]) => [
				key,
				typeof value === "string" ? redactHachiGenLogText(value) : value,
			])),
			source: "renderer",
		};

		this.event(type, message, details);
		return { ok: true };
	}

	logDatabase(message, details = {}) {
		this.log(`Database protection: ${message}`, {
			area: "database-protection",
			...details,
		});
	}

	logShell(entry) {
		// Shell output is tagged separately so the UI can show whether it came
		// from stdout, stderr, or the displayed command itself.
		const sanitized = sanitizeShellLogEntry(entry);
		this.event("shell", sanitized.message, {
			area: "shell",
			stream: sanitized.stream,
			uiVisible: shouldShowShellEntryInUi(sanitized),
		});
	}

	startLogCleanup(options = {}) {
		return this.logger.startLogCleanup(options);
	}

	stopLogCleanup() {
		this.logger.stopLogCleanup();
	}

	initCrashHandlers() {
		this.logger.initCrashHandlers();
	}

	getInstallPath() {
		// Return the folder HachiGen should treat as the Hachi install. Most
		// backend operations start by resolving paths relative to this value.
		return this.settings.installPath;
	}

	getHachiGenVersion() {
		// HachiGen has its own package metadata because the manager executable is
		// released separately from the bot checkout it manages.
		return readJson(path.join(this.managerRoot, "package.json"), {}).version || "";
	}

	loadSecretEncryption() {
		const candidates = [
			path.join(this.getInstallPath(), "config", "secretEncryption.js"),
			path.join(this.managerRoot, "config", "secretEncryption.js"),
			path.resolve(__dirname, "..", "..", "config", "secretEncryption.js"),
		];

		for (const modulePath of candidates) {
			if (!fileExists(modulePath)) {
				continue;
			}

			const resolved = require.resolve(modulePath);
			delete require.cache[resolved];
			return require(resolved);
		}

		throw new Error("Hachi's secret encryption helper was not found. Update Hachi, then try again.");
	}

	getLocalSecretsKeyLocation() {
		const homeDir = os.homedir();

		if (process.platform === "win32") {
			const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");

			return {
				label: "Recommended",
				path: path.join(appData, "Hachi", "secrets.key"),
				scope: "user",
				storage: "recommended",
			};
		}

		if (process.platform === "darwin") {
			return {
				label: "Recommended",
				path: path.join(homeDir, "Library", "Application Support", "Hachi", "secrets.key"),
				scope: "user",
				storage: "recommended",
			};
		}

		return {
			label: "Recommended",
			path: path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "hachi", "secrets.key"),
			scope: "user",
			storage: "recommended",
		};
	}

	async setInstallPath(installPath) {
		// Validate and normalize the chosen path immediately. After this point,
		// the rest of HachiGen can assume installPath is absolute and non-empty.
		if (!installPath || !String(installPath).trim()) {
			throw new Error("Install path cannot be empty.");
		}

		const nextInstallPath = path.resolve(String(installPath));

		if (this.settings.installPath !== nextInstallPath) {
			this.updateState = createUncheckedUpdateState("Updates have not been checked for this install path yet.");
		}

		this.settings.installPath = nextInstallPath;
		this.saveSettings();
		this.log(`Install path set to ${this.settings.installPath}`);
	}

	getRemoteSettings() {
		const remote = normalizeRemoteSettings(this.settings.remote);
		this.settings.remote = remote;
		return remote;
	}

	getRuntimeTarget() {
		return this.settings.runtimeTarget === "remote" ? "remote" : "local";
	}

	getActiveInstallIdentifier() {
		return this.getRuntimeTarget() === "remote" ?
			this.getRemoteSettings().remotePath :
			this.getInstallPath();
	}

	getDatabaseCipherTestTarget() {
		return `${this.getRuntimeTarget()}:${this.getActiveInstallIdentifier()}`;
	}

	getDatabaseCipherTestState() {
		if (this.databaseCipherTest?.target !== this.getDatabaseCipherTestTarget()) {
			return null;
		}

		const result = this.databaseCipherTest.result;

		if (result?.status === "runtime-verified") {
			return {
				...result,
				detail: "Encrypted database runtime opens successfully with the configured key.",
			};
		}

		return result;
	}

	setDatabaseCipherTestState(result) {
		this.databaseCipherTest = {
			result,
			target: this.getDatabaseCipherTestTarget(),
		};
	}

	getRemoteState() {
		const settings = this.getRemoteSettings();
		const errors = validateRemoteSettings(settings);

		return {
			active: this.getRuntimeTarget() === "remote",
			configured: errors.length === 0,
			errors,
			lastTest: normalizeRemoteTestState(this.settings.lastRemoteTest),
			settings,
		};
	}

	setRuntimeTarget(target) {
		const nextTarget = target === "remote" ? "remote" : "local";

		if (nextTarget === "remote") {
			const settings = this.getRemoteSettings();
			const errors = validateRemoteSettings(settings);

			if (errors.length) {
				throw new Error(errors[0]);
			}

			assertSshPrivateKeyFile(settings.sshKeyPath);
		}

		this.settings.runtimeTarget = nextTarget;
		this.saveSettings();
		this.log(`Runtime target set to ${nextTarget === "remote" ? "remote server" : "local development"}.`);

		return {
			ok: true,
			message: `Runtime target set to ${nextTarget === "remote" ? "Remote" : "Local"}.`,
			runtimeTarget: nextTarget,
		};
	}

	saveRemoteSettings(values) {
		const remote = normalizeRemoteSettings(values);
		const errors = validateRemoteSettings(remote, { requireFields: false });

		if (errors.length) {
			throw new Error(errors[0]);
		}

		if (remote.sshKeyPath) {
			assertSshPrivateKeyFile(remote.sshKeyPath);
		}

		const currentRemote = normalizeRemoteSettings(this.settings.remote);
		const remoteChanged = JSON.stringify(currentRemote) !== JSON.stringify(remote);
		this.settings.remote = remote;
		if (remoteChanged) {
			this.settings.lastRemoteTest = null;
		}
		this.saveSettings();
		this.log("Remote settings saved.");

		return {
			ok: true,
			message: "Remote settings saved.",
			remote: this.getRemoteState(),
		};
	}

	validateSshKeyPath(sshKeyPath) {
		assertSshPrivateKeyFile(sshKeyPath);

		return {
			ok: true,
			message: "SSH key selected.",
			sshKeyPath,
		};
	}

	buildRemoteSshArgs(settings, remoteCommand) {
		const args = [
			"-i",
			expandWindowsEnv(settings.sshKeyPath),
			"-o",
			"BatchMode=yes",
			"-o",
			"ConnectTimeout=10",
		];

		if (settings.portMode === "custom") {
			args.push("-p", String(settings.port));
		}

		args.push(`${settings.username}@${settings.host}`);

		if (remoteCommand) {
			args.push(remoteCommand);
		}

		return args;
	}

	async requireRemoteRuntime() {
		const settings = this.getRemoteSettings();
		const errors = validateRemoteSettings(settings);

		if (errors.length) {
			throw new Error(errors[0]);
		}

		assertSshPrivateKeyFile(settings.sshKeyPath);

		if (!await commandExists("ssh")) {
			throw new Error("OpenSSH client was not found on this computer.");
		}

		return settings;
	}

	async runRemoteCommand(remoteCommand, { allowFailure = false, input, log = false, timeoutMs = 30000 } = {}) {
		const settings = await this.requireRemoteRuntime();
		return run("ssh", this.buildRemoteSshArgs(settings, remoteCommand), {
			allowFailure,
			input,
			timeoutMs,
			onLog: log ? entry => this.logShell(entry) : null,
		});
	}

	async runRemoteHachiCommand(command, options = {}) {
		const settings = await this.requireRemoteRuntime();
		const shouldLog = options.log === true;

		return run("ssh", this.buildRemoteSshArgs(settings, `cd ${quoteRemotePath(settings.remotePath)} && ${command}`), {
			allowFailure: Boolean(options.allowFailure),
			input: options.input,
			timeoutMs: options.timeoutMs || 30000,
			onLog: shouldLog ? entry => this.logShell(entry) : null,
		});
	}

	async runRemoteHachiJson(command, options = {}) {
		const result = await this.runRemoteHachiCommand(command, {
			...options,
			allowFailure: true,
		});

		return parseJsonResult(result, options.fallbackMessage || "Remote command did not return valid JSON.");
	}

	async remotePathExists(relativePath, type = "e") {
		const result = await this.runRemoteHachiCommand(`test -${type} ${quotePosix(relativePath)}`, {
			allowFailure: true,
			log: false,
			timeoutMs: 10000,
		});

		return result.code === 0;
	}

	async readRemoteText(relativePath) {
		const result = await this.runRemoteHachiCommand(`if test -f ${quotePosix(relativePath)}; then cat ${quotePosix(relativePath)}; fi`, {
			allowFailure: true,
			log: false,
			timeoutMs: 15000,
		});

		return result.stdout || "";
	}

	async readRemoteConfigurationFiles() {
		// Configuration refresh used to open four SSH sessions concurrently. Some
		// servers throttle concurrent handshakes, so read the fixed allowlist in one
		// remote process and return structured content instead.
		const script = [
			"const fs=require('node:fs');",
			`const files=${JSON.stringify(["blank.env", ".env", "config/blank.json", "config/config.json"])};`,
			"const output={};",
			"for(const file of files)output[file]=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';",
			"process.stdout.write(JSON.stringify(output));",
		].join("");
		return this.runRemoteHachiJson(`node -e ${quotePosix(script)}`, {
			fallbackMessage: "Remote configuration files could not be read.",
			log: false,
			timeoutMs: 30000,
		});
	}

	async writeRemoteText(relativePath, content) {
		const directory = path.posix.dirname(relativePath);
		const mkdir = directory && directory !== "." ? `mkdir -p ${quotePosix(directory)} && ` : "";

		await this.runRemoteHachiCommand(`${mkdir}cat > ${quotePosix(relativePath)}`, {
			input: String(content),
			timeoutMs: 30000,
		});
	}

	async runGit(args, options = {}) {
		if (this.getRuntimeTarget() === "remote") {
			return this.runRemoteHachiCommand(gitShellCommand(args), options);
		}

		return run("git", args, {
			cwd: this.getInstallPath(),
			allowFailure: Boolean(options.allowFailure),
			timeoutMs: options.timeoutMs || 300000,
			onLog: options.log === false ? null : options.onLog || (entry => this.logShell(entry)),
		});
	}

	remotePm2ErrorStatus(message) {
		return {
			installed: false,
			registered: false,
			status: "remote-error",
			target: "remote",
			message,
		};
	}

	remotePm2StatusFromResult(result, settings) {
		if (result.code !== 0) {
			const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
			const missingPm2 = /pm2: command not found|pm2.*not recognized|not found/u.test(detail);

			return {
				installed: !missingPm2,
				registered: false,
				status: missingPm2 ? "pm2-missing" : "error",
				target: "remote",
				message: detail || "Could not read remote PM2 status.",
			};
		}

		try {
			const apps = parsePm2Json(result.stdout);
			const app = apps.find(item => item.name === settings.pm2Name);

			if (!app) {
				return {
					installed: true,
					registered: false,
					status: "not-registered",
					target: "remote",
					message: `${settings.pm2Name} is not registered in remote PM2.`,
				};
			}

			return {
				installed: true,
				registered: true,
				status: app.pm2_env?.status || "unknown",
				restarts: app.pm2_env?.restart_time || 0,
				cpu: app.monit?.cpu || 0,
				memory: app.monit?.memory || 0,
				pid: app.pid || null,
				target: "remote",
				message: `Remote ${settings.pm2Name} is ${app.pm2_env?.status || "unknown"}.`,
			};
		} catch (error) {
			return this.remotePm2ErrorStatus(error.message);
		}
	}

	async getRemotePm2Status() {
		let settings;

		try {
			settings = await this.requireRemoteRuntime();
		} catch (error) {
			return this.remotePm2ErrorStatus(error.message);
		}

		const result = await run("ssh", this.buildRemoteSshArgs(settings, "pm2 jlist"), {
			allowFailure: true,
			timeoutMs: 15000,
		});

		return this.remotePm2StatusFromResult(result, settings);
	}

	async startRemoteBot() {
		const settings = await this.requireRemoteRuntime();
		const name = quotePosix(settings.pm2Name);
		const ecosystem = quotePosix("config/ecosystem.config.js");
		const remoteCommand = [
			`cd ${quoteRemotePath(settings.remotePath)}`,
			`if pm2 describe ${name} --no-color >/dev/null 2>&1; then pm2 restart ${ecosystem} --only ${name}; else pm2 start ${ecosystem} --only ${name}; fi`,
			"pm2 save",
		].join(" && ");

		this.log(`Starting remote ${settings.pm2Name}...`);
		await this.runRemoteCommand(remoteCommand, {
			timeoutMs: 120000,
		});
		return this.getRemotePm2Status();
	}

	async stopRemoteBot() {
		const settings = await this.requireRemoteRuntime();

		this.log(`Stopping remote ${settings.pm2Name}...`);
		await this.runRemoteCommand(`pm2 stop ${quotePosix(settings.pm2Name)}`, {
			timeoutMs: 120000,
		});
		return this.getRemotePm2Status();
	}

	async restartRemoteBot() {
		const settings = await this.requireRemoteRuntime();
		const name = quotePosix(settings.pm2Name);
		const ecosystem = quotePosix("config/ecosystem.config.js");
		const remoteCommand = [
			`cd ${quoteRemotePath(settings.remotePath)}`,
			`if pm2 describe ${name} --no-color >/dev/null 2>&1; then pm2 restart ${name}; else pm2 start ${ecosystem} --only ${name}; fi`,
			"pm2 save",
		].join(" && ");

		this.log(`Restarting remote ${settings.pm2Name}...`);
		await this.runRemoteCommand(remoteCommand, {
			timeoutMs: 120000,
		});
		return this.getRemotePm2Status();
	}

	async readRemoteLogs(lines = 160) {
		const settings = await this.requireRemoteRuntime();
		const remoteCommand = [
			`cd ${quoteRemotePath(settings.remotePath)}`,
			`pm2 logs ${quotePosix(settings.pm2Name)} --lines ${Number.parseInt(String(lines), 10) || 160} --nostream --no-color`,
		].join(" && ");
		const result = await this.runRemoteCommand(remoteCommand, {
			allowFailure: true,
			log: false,
			timeoutMs: 30000,
		});

		return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
	}

	async readLocalPm2Snapshot(lines = 160) {
		if (!await commandExists("pm2")) {
			return "";
		}

		const result = await run("pm2", ["logs", PROCESS_NAME, "--lines", String(lines), "--nostream"], {
			allowFailure: true,
			timeoutMs: 30000,
		});

		return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
	}

	async testRemoteConnection() {
		const settings = this.getRemoteSettings();
		this.log("Testing remote connection...");
		const tested = await this.executeRemoteConnectionTest(settings);
		const lastTest = {
			checkedAt: tested.checkedAt,
			message: tested.message,
			ok: tested.ok,
			target: remoteConnectionLabel(settings),
		};

		this.settings.lastRemoteTest = lastTest;
		this.saveSettings();

		return tested;
	}

	async testFleetRemoteConnection(values) {
		const settings = normalizeRemoteSettings(values);
		this.log("Testing Fleet remote connection...", { area: "fleet" });
		return this.executeRemoteConnectionTest(settings);
	}

	async executeRemoteConnectionTest(settings) {
		const errors = validateRemoteSettings(settings);
		if (errors.length) {
			throw new Error(errors[0]);
		}
		assertSshPrivateKeyFile(settings.sshKeyPath);
		if (!await commandExists("ssh")) {
			throw new Error("OpenSSH client was not found on this computer.");
		}
		const remoteCommand = [
			`cd ${quoteRemotePath(settings.remotePath)}`,
			"printf 'path='",
			"pwd",
			"printf 'node='",
			"node -v",
			"printf 'pm2='",
			`pm2 describe ${quotePosix(settings.pm2Name)} --no-color`,
		].join(" && ");
		const result = await run("ssh", this.buildRemoteSshArgs(settings, remoteCommand), {
			allowFailure: true,
			timeoutMs: 20000,
		});
		const ok = result.code === 0;
		return {
			checkedAt: new Date().toISOString(),
			code: result.code,
			ok,
			message: ok ? "Remote connection validated." : "Remote connection test failed. Review the output for details.",
			stderr: result.stderr,
			stdout: result.stdout,
		};
	}

	getPaths() {
		// Central path list. If Hachi moves a file, update it here and every
		// validation/install/update method will follow the new location.
		const root = this.getInstallPath();

		return {
			root,
			packageJson: path.join(root, "package.json"),
			index: path.join(root, "index.js"),
			env: path.join(root, ".env"),
			blankEnv: path.join(root, "blank.env"),
			configDir: path.join(root, "config"),
			configJson: path.join(root, "config", "config.json"),
			blankConfig: path.join(root, "config", "blank.json"),
			ecosystem: path.join(root, "config", "ecosystem.config.js"),
			deleteCommands: path.join(root, "delete-all-commands.js"),
			deployGlobal: path.join(root, "deploy-global-commands.js"),
			deployGuild: path.join(root, "deploy-guild-commands.js"),
			dbAudit: path.join(root, "database", "dbAudit.js"),
			database: path.join(root, "database", "database.sqlite"),
			logs: path.join(root, "logs"),
			git: path.join(root, ".git"),
			nodeModules: path.join(root, "node_modules"),
		};
	}

	getDatabaseBackupDir() {
		// Database backups live inside the selected install folder so they stay
		// with the Hachi instance they protect, while .gitignore keeps them local.
		// Example: <Hachi>/manager/backups/database/database-2026-06-21.sqlite
		return path.join(this.getInstallPath(), "manager", "backups", "database");
	}

	getRuntimeExportsDir() {
		// Runtime archives intentionally live beside the selected Hachi project,
		// while .gitignore keeps the secrets-bearing exports folder local only.
		return path.join(this.getInstallPath(), "exports");
	}

	getDatabaseWorkerPath() {
		// External Node cannot run a worker directly from app.asar. Copy the
		// packaged worker source to userData and execute that normal file instead.
		// The copy is refreshed only when the bundled worker text changes.
		const sourcePath = path.join(this.managerRoot, "src", DATABASE_WORKER_FILE);
		const targetPath = path.join(this.userDataPath, DATABASE_WORKER_FILE);
		const source = fs.readFileSync(sourcePath, "utf8");
		const current = fileExists(targetPath) ? fs.readFileSync(targetPath, "utf8") : null;

		if (current !== source) {
			ensureDir(path.dirname(targetPath));
			fs.writeFileSync(targetPath, source, "utf8");
		}

		return targetPath;
	}

	getDatabaseBackups() {
		// Return backup metadata for the Database tab without mutating files.
		// Sorting newest-first makes the most likely restore target appear first.
		const backupDir = this.getDatabaseBackupDir();

		if (!fileExists(backupDir)) {
			return [];
		}

		const dbEncryption = loadDatabaseEncryptionModule(this.getInstallPath());
		const currentKey = this.readLocalDatabaseProtectionKeyIfAvailable();

		return fs.readdirSync(backupDir)
			.filter(file => /\.sqlite$/i.test(file))
			.map(file => {
				const fullPath = path.join(backupDir, file);
				const stats = fs.statSync(fullPath);
				const protection = dbEncryption?.describeDatabaseBackup ?
					dbEncryption.describeDatabaseBackup({
						backupPath: fullPath,
						currentKey,
						root: this.getInstallPath(),
						verifyWithCurrentKey: false,
					}) :
					null;

				return {
					file,
					fullPath,
					modifiedAt: stats.mtime.toISOString(),
					protection,
					size: stats.size,
					sizeLabel: formatFileSize(stats.size),
				};
			})
			.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
	}

	getLocalDatabaseKeyLocation() {
		const homeDir = os.homedir();

		if (process.platform === "win32") {
			const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");

			return {
				label: "Recommended",
				path: path.join(appData, "Hachi", "db.key"),
				scope: "user",
				storage: "recommended",
			};
		}

		if (process.platform === "darwin") {
			return {
				label: "Recommended",
				path: path.join(homeDir, "Library", "Application Support", "Hachi", "db.key"),
				scope: "user",
				storage: "recommended",
			};
		}

		return {
			label: "Recommended",
			path: path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "hachi", "db.key"),
			scope: "user",
			storage: "recommended",
		};
	}

	readLocalEnvText() {
		const paths = this.getPaths();
		return fileExists(paths.env) ? fs.readFileSync(paths.env, "utf8") : "";
	}

	readLocalEnvValues() {
		return parseDotEnvContent(this.readLocalEnvText());
	}

	// Secret-protection helpers keep decrypted values out of the renderer. The
	// renderer sends raw user input only on Save, HachiGen encrypts it here, and
	// future reads return metadata plus blank form fields. Blank submitted values
	// mean "preserve the saved encrypted value", not "erase the secret".
	readLocalSecretsKey(rawEnv = this.readLocalEnvValues()) {
		const secrets = this.loadSecretEncryption();
		const paths = this.getPaths();
		const directKey = String(rawEnv.HACHI_SECRETS_KEY || "").trim();

		if (directKey) {
			return {
				key: directKey,
				keyFilePath: "",
				source: "direct",
			};
		}

		const keyFilePath = secrets.resolveKeyFilePath(rawEnv.HACHI_SECRETS_KEY_FILE || "", paths.root);

		if (!keyFilePath) {
			throw new Error("No .env secrets key is configured.");
		}

		if (!fileExists(keyFilePath)) {
			throw new Error(`Configured .env secrets key file is missing: ${keyFilePath}`);
		}

		const key = fs.readFileSync(keyFilePath, "utf8").trim();

		if (!key) {
			throw new Error(`Configured .env secrets key file is empty: ${keyFilePath}`);
		}

		return {
			key,
			keyFilePath,
			source: "file",
		};
	}

	ensureLocalSecretsKey(rawEnv = this.readLocalEnvValues()) {
		const directKey = String(rawEnv.HACHI_SECRETS_KEY || "").trim();

		if (directKey || String(rawEnv.HACHI_SECRETS_KEY_FILE || "").trim()) {
			return this.readLocalSecretsKey(rawEnv);
		}

		const secrets = this.loadSecretEncryption();
		const location = this.getLocalSecretsKeyLocation();
		const generated = !fileExists(location.path);

		ensureDir(path.dirname(location.path));

		if (generated) {
			fs.writeFileSync(location.path, `${secrets.generateSecretKey()}\n`, {
				encoding: "utf8",
				mode: 0o600,
			});
		}

		try {
			fs.chmodSync(path.dirname(location.path), 0o700);
			fs.chmodSync(location.path, 0o600);
		} catch {
			// Windows ACLs may not map cleanly to POSIX modes; the key still exists.
		}

		return {
			generated,
			key: fs.readFileSync(location.path, "utf8").trim(),
			keyFilePath: location.path,
			source: "file",
		};
	}

	encryptEnvValuesForSave(values, rawEnv, key) {
		const secrets = this.loadSecretEncryption();
		const updates = {};

		for (const field of ENV_FIELDS) {
			const submittedValue = values[field];
			const existingValue = rawEnv[field];

			if (!isMissingSecretValue(submittedValue)) {
				updates[field] = secrets.encryptSecretValue(field, submittedValue, key);
			} else if (isEncryptedSecretValue(existingValue)) {
				updates[field] = existingValue;
			} else if (!isMissingSecretValue(existingValue)) {
				updates[field] = secrets.encryptSecretValue(field, existingValue, key);
			} else {
				updates[field] = "";
			}
		}

		for (const [field, existingValue] of Object.entries(rawEnv)) {
			if (ENV_FIELDS.includes(field) || !isProtectableEnvField(field) || isMissingSecretValue(existingValue)) {
				continue;
			}

			updates[field] = isEncryptedSecretValue(existingValue) ?
				existingValue :
				secrets.encryptSecretValue(field, existingValue, key);
		}

		return updates;
	}

	buildProtectedEnvValues(values, rawEnv, keyInfo) {
		return {
			...this.encryptEnvValuesForSave(values, rawEnv, keyInfo.key),
			HACHI_SECRETS_ENCRYPTION: "encrypted",
			HACHI_SECRETS_KEY: keyInfo.source === "direct" ? keyInfo.key : "",
			HACHI_SECRETS_KEY_FILE: keyInfo.keyFilePath || "",
		};
	}

	async readRemoteAbsoluteText(filePath) {
		const result = await this.runRemoteCommand(`if test -f ${quotePosix(filePath)}; then cat ${quotePosix(filePath)}; fi`, {
			allowFailure: true,
			log: false,
			timeoutMs: 15000,
		});

		return result.stdout || "";
	}

	async writeRemoteAbsoluteText(filePath, content) {
		const directory = path.posix.dirname(filePath);

		await this.runRemoteCommand(
			`mkdir -p ${quotePosix(directory)} && cat > ${quotePosix(filePath)} && chmod 700 ${quotePosix(directory)} && chmod 600 ${quotePosix(filePath)}`,
			{
				input: String(content),
				log: false,
				timeoutMs: 30000,
			},
		);
	}

	async getRemoteDefaultSecretsKeyFile() {
		const script = `
const secrets = require("./config/secretEncryption.js");
process.stdout.write(JSON.stringify({ path: secrets.getDefaultSecretKeyFile() }));
`;
		const result = await this.runRemoteHachiJson(`node -e ${quotePosix(script)}`, {
			fallbackMessage: "Could not resolve remote .env secrets key location.",
			log: false,
			timeoutMs: 15000,
		});

		return result.path;
	}

	async resolveRemoteSecretsKeyFile(value) {
		const script = `
const secrets = require("./config/secretEncryption.js");
const request = JSON.parse(process.argv[1]);
process.stdout.write(JSON.stringify({ path: secrets.resolveKeyFilePath(request.value, process.cwd()) }));
`;
		const result = await this.runRemoteHachiJson(`node -e ${quotePosix(script)} ${quotePosix(JSON.stringify({ value }))}`, {
			fallbackMessage: "Could not resolve remote .env secrets key file.",
			log: false,
			timeoutMs: 15000,
		});

		return result.path;
	}

	async readRemoteSecretsKey(rawEnv) {
		const directKey = String(rawEnv.HACHI_SECRETS_KEY || "").trim();

		if (directKey) {
			return {
				key: directKey,
				keyFilePath: "",
				source: "direct",
			};
		}

		const configured = String(rawEnv.HACHI_SECRETS_KEY_FILE || "").trim();

		if (!configured) {
			throw new Error("No remote .env secrets key is configured.");
		}

		const keyFilePath = await this.resolveRemoteSecretsKeyFile(configured);
		const key = (await this.readRemoteAbsoluteText(keyFilePath)).trim();

		if (!key) {
			throw new Error(`Configured remote .env secrets key file is missing or empty: ${keyFilePath}`);
		}

		return {
			key,
			keyFilePath,
			source: "file",
		};
	}

	async ensureRemoteSecretsKey(rawEnv) {
		const directKey = String(rawEnv.HACHI_SECRETS_KEY || "").trim();

		if (directKey || String(rawEnv.HACHI_SECRETS_KEY_FILE || "").trim()) {
			return this.readRemoteSecretsKey(rawEnv);
		}

		const keyFilePath = await this.getRemoteDefaultSecretsKeyFile();
		let key = (await this.readRemoteAbsoluteText(keyFilePath)).trim();
		let generated = false;

		if (!key) {
			const script = `
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const keyFilePath = process.argv[1];
fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
let generated = false;
if (!fs.existsSync(keyFilePath) || !fs.readFileSync(keyFilePath, "utf8").trim()) {
	fs.writeFileSync(keyFilePath, crypto.randomBytes(32).toString("base64url") + "\\n", {
		encoding: "utf8",
		mode: 0o600,
	});
	generated = true;
}
try {
	fs.chmodSync(path.dirname(keyFilePath), 0o700);
	fs.chmodSync(keyFilePath, 0o600);
} catch {}
process.stdout.write(JSON.stringify({
	generated,
	key: fs.readFileSync(keyFilePath, "utf8").trim(),
}));
`;
			const result = await this.runRemoteHachiJson(`node -e ${quotePosix(script)} ${quotePosix(keyFilePath)}`, {
				fallbackMessage: "Could not create remote .env secrets key.",
				log: false,
				timeoutMs: 30000,
			});

			key = result.key;
			generated = Boolean(result.generated);
		}

		return {
			generated,
			key,
			keyFilePath,
			source: "file",
		};
	}

	async prepareSecretProtection() {
		if (this.getRuntimeTarget() === "remote") {
			const rawEnvText = await this.readRemoteText(".env");
			const rawEnv = parseDotEnvContent(rawEnvText);
			const keyInfo = await this.ensureRemoteSecretsKey(rawEnv);
			const protectedEnv = this.buildProtectedEnvValues({}, rawEnv, keyInfo);
			const merged = {
				...rawEnv,
				...protectedEnv,
			};

			await this.writeRemoteText(".env", `${buildEnvLines(merged, rawEnv).join("\n")}\n`);
			this.log(`Secret protection: remote .env values are encrypted with ${keyInfo.keyFilePath || "a direct key"}.`);

			return {
				keyFilePath: keyInfo.keyFilePath,
				ok: true,
				source: "remote",
			};
		}

		const paths = this.getPaths();
		const rawEnv = this.readLocalEnvValues();
		const keyInfo = this.ensureLocalSecretsKey(rawEnv);
		const protectedEnv = this.buildProtectedEnvValues({}, rawEnv, keyInfo);
		const merged = {
			...rawEnv,
			...protectedEnv,
		};

		fs.writeFileSync(paths.env, `${buildEnvLines(merged, rawEnv).join("\n")}\n`, "utf8");
		this.log(`Secret protection: local .env values are encrypted with ${displayPath(keyInfo.keyFilePath) || "a direct key"}.`);

		return {
			keyFilePath: keyInfo.keyFilePath,
			ok: true,
			source: "local",
		};
	}

	async readEnvSecretForCopy(field) {
		if (!ENV_FIELDS.includes(field)) {
			throw new Error("Unknown .env secret field.");
		}

		const secrets = this.loadSecretEncryption();
		const rawEnv = this.getRuntimeTarget() === "remote" ?
			parseDotEnvContent(await this.readRemoteText(".env")) :
			this.readLocalEnvValues();
		const encryptedValue = rawEnv[field];

		if (isMissingSecretValue(encryptedValue)) {
			throw new Error(`${field} is not saved yet.`);
		}

		if (!isEncryptedSecretValue(encryptedValue)) {
			throw new Error(`${field} is not encrypted yet. Save configuration first.`);
		}

		const keyInfo = this.getRuntimeTarget() === "remote" ?
			await this.readRemoteSecretsKey(rawEnv) :
			this.readLocalSecretsKey(rawEnv);

		return {
			field,
			ttlMs: 60000,
			value: secrets.decryptSecretValue(field, encryptedValue, keyInfo.key),
		};
	}

	readLocalDatabaseProtectionEnv() {
		const paths = this.getPaths();
		return fileExists(paths.env) ? parseDotEnv(paths.env) : {};
	}

	readLocalDatabaseProtectionKeyIfAvailable() {
		try {
			const env = this.readLocalDatabaseProtectionEnv();
			const paths = this.getPaths();
			const configuredKeyFile = resolveLocalPath(env.HACHI_DB_KEY_FILE || "", paths.root);

			if (configuredKeyFile && fileExists(configuredKeyFile)) {
				return normalizeDatabaseKey(fs.readFileSync(configuredKeyFile, "utf8"));
			}

			return normalizeDatabaseKey(env.HACHI_DB_KEY);
		} catch {
			return "";
		}
	}

	updateLocalDatabaseProtectionEnv(values) {
		const paths = this.getPaths();
		const current = fileExists(paths.env) ? fs.readFileSync(paths.env, "utf8") : "";
		fs.writeFileSync(paths.env, updateDotEnvContent(current, values), "utf8");
	}

	localDatabaseProtectionState() {
		const paths = this.getPaths();
		const env = this.readLocalDatabaseProtectionEnv();
		const recommended = this.getLocalDatabaseKeyLocation();
		const configuredKeyFile = resolveLocalPath(env.HACHI_DB_KEY_FILE || "", paths.root);
		const keyFileStatus = fileStatus(configuredKeyFile);
		const encryptionEnabled = isEnabledValue(env.HACHI_DB_ENCRYPTION);
		const directKeyConfigured = Boolean(String(env.HACHI_DB_KEY || "").trim());
		const keyReadyForDatabase = encryptionEnabled && (keyFileStatus.readable || directKeyConfigured);
		const cipherTest = keyReadyForDatabase ? this.getDatabaseCipherTestState() : null;
		const databaseFile = databaseFileProtectionStatus(
			databaseFileStatus(paths.database),
			cipherTest,
			keyReadyForDatabase,
		);
		const summary = databaseProtectionSummary({
			databaseFile,
			directKeyConfigured,
			encryptionEnabled,
			keyFileStatus,
		});
		const keyReady = ["key-ready", "direct-key"].includes(summary.status);

		return {
			...summary,
			configuredKeyFile,
			databaseFile,
			directKeyConfigured,
			driver: cipherDriverStatus(paths.root),
			encryptionEnabled,
			keyFileStatus,
			locations: {
				recommended,
			},
			cipherTest: keyReady ? cipherTest : null,
			runtime: hybridDatabaseRuntimeStatus(),
			source: "local",
			updatedAt: new Date().toISOString(),
		};
	}

	remoteDatabaseProtectionScript(action) {
		const request = JSON.stringify({ action });

		return `
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const request = ${request};
const CIPHER_DRIVER_PACKAGE = ${JSON.stringify(CIPHER_DRIVER_PACKAGE)};
const SQLITE_HEADER = Buffer.from([
	0x53,
	0x51,
	0x4c,
	0x69,
	0x74,
	0x65,
	0x20,
	0x66,
	0x6f,
	0x72,
	0x6d,
	0x61,
	0x74,
	0x20,
	0x33,
	0x00,
]);
function parseDotEnv(content) {
	const values = {};
	for (const line of String(content || "").split(/\\r?\\n/u)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const equalsIndex = trimmed.indexOf("=");
		if (equalsIndex === -1) {
			continue;
		}
		const key = trimmed.slice(0, equalsIndex).trim();
		let value = trimmed.slice(equalsIndex + 1).trim();
		if (value.startsWith('"') && value.endsWith('"')) {
			try {
				value = JSON.parse(value);
			} catch {
				value = value.slice(1, -1);
			}
		} else if (value.startsWith("'") && value.endsWith("'")) {
			value = value.slice(1, -1);
		}
		values[key] = value;
	}
	return values;
}
function formatEnvValue(value) {
	return JSON.stringify(String(value || ""));
}
function updateDotEnvContent(content, values) {
	const pending = new Map(Object.entries(values));
	const lines = String(content || "").split(/\\r?\\n/u);
	const output = [];
	for (const line of lines) {
		if (!line.trim()) {
			if (line || output.length) {
				output.push(line);
			}

			continue;
		}
		const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\\s*=/u);
		if (!match || !pending.has(match[1])) {
			output.push(line);
			continue;
		}
		const key = match[1];
		output.push(key + "=" + formatEnvValue(pending.get(key)));
		pending.delete(key);
	}
	for (const [key, value] of pending) {
		output.push(key + "=" + formatEnvValue(value));
	}
	return output.filter((line, index, collection) => line || index < collection.length - 1).join("\\n") + "\\n";
}
function enabled(value) {
	return ["1", "on", "true", "yes", "prepared", "key-ready", "encrypted", "runtime", "active"].includes(String(value || "").trim().toLowerCase());
}
function resolveRemotePath(value) {
	const text = String(value || "").trim();
	if (!text) {
		return "";
	}
	if (text === "~") {
		return os.homedir();
	}
	if (text.startsWith("~/")) {
		return path.join(os.homedir(), text.slice(2));
	}
	return path.isAbsolute(text) ? text : path.resolve(process.cwd(), text);
}
function location() {
	return {
		label: "Recommended",
		path: path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "hachi", "db.key"),
		scope: "user",
		storage: "recommended",
	};
}
function keyStatus(filePath) {
	if (!filePath) {
		return { exists: false, path: "", readable: false };
	}
	try {
		const stats = fs.statSync(filePath);
		return {
			exists: stats.isFile(),
			modifiedAt: stats.mtime.toISOString(),
			path: filePath,
			readable: stats.isFile(),
			size: stats.size,
		};
	} catch {
		return { exists: false, path: filePath, readable: false };
	}
}
function databaseFileStatus(dbPath) {
	if (!dbPath || !fs.existsSync(dbPath)) {
		return {
			detail: "No database file found.",
			dot: "muted",
			encryptedLikely: false,
			label: "Missing",
			path: dbPath || "",
			status: "missing",
		};
	}
	const stats = fs.statSync(dbPath);
	if (!stats.isFile()) {
		return {
			detail: "Database path exists but is not a file.",
			dot: "bad",
			encryptedLikely: false,
			label: "Invalid Path",
			path: dbPath,
			status: "invalid",
		};
	}
	if (stats.size < SQLITE_HEADER.length) {
		return {
			detail: "Database file is too small to be a valid encrypted database.",
			dot: "bad",
			encryptedLikely: false,
			label: "Invalid Format",
			path: dbPath,
			size: stats.size,
			status: "invalid",
		};
	}
	const handle = fs.openSync(dbPath, "r");
	const header = Buffer.alloc(SQLITE_HEADER.length);
	try {
		fs.readSync(handle, header, 0, SQLITE_HEADER.length, 0);
	} finally {
		fs.closeSync(handle);
	}
	if (header.equals(SQLITE_HEADER)) {
		return {
			detail: "Database is still plain SQLite.",
			dot: "info",
			encryptedLikely: false,
			label: "Plain SQLite",
			path: dbPath,
			size: stats.size,
			status: "plaintext",
		};
	}
	return {
		detail: "Database file is encrypted. Open it with the configured key to verify access.",
		dot: "info",
		encryptedLikely: true,
		label: "Encrypted",
		path: dbPath,
		size: stats.size,
		status: "encrypted",
	};
}
function databaseAccessStatus(dbPath, key) {
	const status = databaseFileStatus(dbPath);
	if (!status.encryptedLikely) {
		return status;
	}
	if (!String(key || "").trim()) {
		return {
			...status,
			detail: "Database is encrypted. Configure the database key to verify access.",
			dot: "warn",
			label: "Encrypted",
			status: "encrypted",
		};
	}
	try {
		const dbEncryption = require("./database/dbEncryption.js");
		return dbEncryption.databaseAccessStatus({
			dbPath,
			key,
			root: process.cwd(),
		});
	} catch (error) {
		return {
			...status,
			detail: "Database could not be opened with the configured key: " + (error.message || String(error)),
			dot: "bad",
			encryptedLikely: false,
			label: "Invalid Format",
			status: "invalid",
		};
	}
}
function findPackageJson(modulePath, packageName) {
	let currentDir = path.dirname(modulePath);
	while (currentDir && currentDir !== path.dirname(currentDir)) {
		const packagePath = path.join(currentDir, "package.json");
		if (fs.existsSync(packagePath)) {
			try {
				const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
				if (packageJson.name === packageName) {
					return packagePath;
				}
			} catch {
				return "";
			}
		}
		currentDir = path.dirname(currentDir);
	}
	return "";
}
function cipherDriverStatus(root) {
	try {
		const modulePath = require.resolve(CIPHER_DRIVER_PACKAGE, { paths: [root] });
		const packagePath = findPackageJson(modulePath, CIPHER_DRIVER_PACKAGE);
		const packageJson = packagePath ? JSON.parse(fs.readFileSync(packagePath, "utf8")) : {};
		return {
			detail: "SQLCipher driver is installed and ready for encrypted database access.",
			dot: "good",
			installed: true,
			label: "Driver Installed",
			modulePath,
			packageName: CIPHER_DRIVER_PACKAGE,
			status: "installed",
			version: packageJson.version || "",
		};
	} catch (error) {
		return {
			detail: CIPHER_DRIVER_PACKAGE + " is not available in node_modules. Install / Validate installs Hachi dependencies normally.",
			dot: "warn",
			error: error.code || error.message || String(error),
			installed: false,
			label: "Driver Missing",
			packageName: CIPHER_DRIVER_PACKAGE,
			status: "missing",
			version: "",
		};
	}
}
function runtimeStatus() {
	return {
		detail: "Hachi uses SQLCipher for database access while HACHI_DB_ENCRYPTION=encrypted is set.",
		dot: "good",
		encryptedRuntimeReady: true,
		label: "Runtime Ready",
		status: "runtime-ready",
	};
}
function protectionDetail(prefix, databaseFile) {
	if (databaseFile.status === "encrypted") {
		return prefix + " Database encryption is active.";
	}
	if (databaseFile.status === "missing") {
		return prefix + " Hachi will create an encrypted database on first start.";
	}
	if (databaseFile.status === "plaintext") {
		return prefix + " Plaintext database must be converted before Hachi starts.";
	}
	if (databaseFile.status === "invalid") {
		return prefix + " Database file is not a valid encrypted Hachi database.";
	}
	return prefix + " Encrypted database runtime is ready.";
}
function summary(encryptionEnabled, directKeyConfigured, keyFileStatus, databaseFile) {
	if (encryptionEnabled && keyFileStatus.readable) {
		return {
			detail: protectionDetail("Key file ready.", databaseFile),
			dot: databaseFile.status === "invalid" ? "bad" : databaseFile.status === "plaintext" ? "warn" : "good",
			label: databaseFile.status === "invalid" ? "Invalid Database" : databaseFile.status === "plaintext" ? "Plaintext Database" : "Key Ready",
			status: "key-ready",
		};
	}
	if (encryptionEnabled && keyFileStatus.path && !keyFileStatus.readable) {
		return {
			detail: "Configured key file is missing or unreadable. Do not generate a replacement for an encrypted database.",
			dot: "bad",
			label: "Key Missing",
			status: "key-missing",
		};
	}
	if (encryptionEnabled && directKeyConfigured) {
		return {
			detail: protectionDetail("Direct key configured.", databaseFile),
			dot: databaseFile.status === "invalid" ? "bad" : "warn",
			label: databaseFile.status === "invalid" ? "Invalid Database" : "Direct Key",
			status: "direct-key",
		};
	}
	return {
		detail: "Database encryption is required. Generate a key to prepare this install.",
		dot: "muted",
		label: "Key Required",
		status: "not-configured",
	};
}
function state() {
	const envText = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
	const env = parseDotEnv(envText);
	const configuredKeyFile = resolveRemotePath(env.HACHI_DB_KEY_FILE || "");
	const keyFileStatus = keyStatus(configuredKeyFile);
	const encryptionEnabled = enabled(env.HACHI_DB_ENCRYPTION);
	const directKeyConfigured = Boolean(String(env.HACHI_DB_KEY || "").trim());
	const databaseKey = keyFileStatus.readable ? fs.readFileSync(configuredKeyFile, "utf8").trim() : String(env.HACHI_DB_KEY || "").trim();
	const databaseFile = databaseAccessStatus("database/database.sqlite", databaseKey);
	return {
		...summary(encryptionEnabled, directKeyConfigured, keyFileStatus, databaseFile),
		configuredKeyFile,
		databaseFile,
		directKeyConfigured,
		driver: cipherDriverStatus(process.cwd()),
		encryptionEnabled,
		keyFileStatus,
		locations: {
			recommended: location(),
		},
		runtime: runtimeStatus(),
		source: "remote",
		updatedAt: new Date().toISOString(),
	};
}
function readConfiguredKey() {
	const envText = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
	const env = parseDotEnv(envText);
	const configuredKeyFile = resolveRemotePath(env.HACHI_DB_KEY_FILE || "");
	if (configuredKeyFile) {
		if (!fs.existsSync(configuredKeyFile)) {
			throw new Error("Configured database key file is missing.");
		}
		return fs.readFileSync(configuredKeyFile, "utf8").trim();
	}
	return String(env.HACHI_DB_KEY || "").trim();
}
if (request.action === "read-key") {
	try {
		const key = readConfiguredKey();
		if (!key) {
			throw new Error("No database key is configured.");
		}
		process.stdout.write(JSON.stringify({ key, ok: true }));
	} catch (error) {
		process.stdout.write(JSON.stringify({ error: error.message || String(error), ok: false }));
	}
	process.exit(0);
}
if (request.action === "prepare") {
	const current = state();
	if (current.directKeyConfigured && !current.configuredKeyFile) {
		const envText = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
		fs.writeFileSync(".env", updateDotEnvContent(envText, {
			HACHI_DB_ENCRYPTION: "encrypted",
		}), "utf8");
		process.stdout.write(JSON.stringify({ ...state(), ok: true }));
		process.exit(0);
	}
	if (current.configuredKeyFile) {
		if (!current.keyFileStatus.readable) {
			process.stdout.write(JSON.stringify({
				...current,
				error: "Configured database key file is missing. HachiGen will not generate a replacement because encrypted databases require the original key.",
				ok: false,
			}));
			process.exit(0);
		}
		try {
			fs.chmodSync(path.dirname(current.configuredKeyFile), 0o700);
			fs.chmodSync(current.configuredKeyFile, 0o600);
		} catch {
			// Existing keys may live in locations where this user cannot chmod.
		}
		const envText = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
		fs.writeFileSync(".env", updateDotEnvContent(envText, {
			HACHI_DB_ENCRYPTION: "encrypted",
			HACHI_DB_KEY_FILE: current.configuredKeyFile,
		}), "utf8");
	} else {
		const selected = location();
		fs.mkdirSync(path.dirname(selected.path), { recursive: true });
		if (!fs.existsSync(selected.path)) {
			fs.writeFileSync(selected.path, crypto.randomBytes(32).toString("base64url") + "\\n", {
				encoding: "utf8",
				mode: 0o600,
			});
		}
		fs.chmodSync(path.dirname(selected.path), 0o700);
		fs.chmodSync(selected.path, 0o600);
		const envText = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
		fs.writeFileSync(".env", updateDotEnvContent(envText, {
			HACHI_DB_ENCRYPTION: "encrypted",
			HACHI_DB_KEY_FILE: selected.path,
		}), "utf8");
	}
}
process.stdout.write(JSON.stringify({ ...state(), ok: true }));
`;
	}

	async getRemoteDatabaseProtectionState() {
		const protection = await this.runRemoteHachiJson(`node -e ${quotePosix(this.remoteDatabaseProtectionScript("state"))}`, {
			fallbackMessage: "Could not read remote database protection state.",
			log: false,
			timeoutMs: 30000,
		});
		const keyReady = ["key-ready", "direct-key"].includes(protection.status);

		return {
			...protection,
			cipherTest: keyReady ? this.getDatabaseCipherTestState() : null,
		};
	}

	async getDatabaseProtectionState() {
		if (this.getRuntimeTarget() === "remote") {
			return this.getRemoteDatabaseProtectionState();
		}

		return this.localDatabaseProtectionState();
	}

	async prepareDatabaseProtection() {
		if (this.getRuntimeTarget() === "remote") {
			this.logDatabase("preparing remote encryption key and runtime settings.");
			const protection = await this.runRemoteHachiJson(
				`node -e ${quotePosix(this.remoteDatabaseProtectionScript("prepare"))}`,
				{
					fallbackMessage: "Remote database protection setup did not return valid JSON.",
					log: false,
					timeoutMs: 30000,
				},
			);

			if (protection.ok === false) {
				throw new Error(protection.error || "Remote database key setup failed.");
			}

			this.logDatabase(`remote key ready at ${protection.configuredKeyFile || "configured key"}.`, {
				source: "remote",
			});

			return {
				database: await this.getDatabaseState(),
				message: `Database protection key ready at ${protection.configuredKeyFile}.`,
				ok: true,
				protection,
			};
		}

		const current = this.localDatabaseProtectionState();
		this.logDatabase("preparing local encryption key and runtime settings.");

		if (current.directKeyConfigured && !current.configuredKeyFile) {
			this.updateLocalDatabaseProtectionEnv({
				HACHI_DB_ENCRYPTION: "encrypted",
			});
			const protection = this.localDatabaseProtectionState();
			this.logDatabase("direct key is configured; runtime encryption flag is set.", {
				source: "local",
			});

			return {
				database: await this.getDatabaseState(),
				message: "Direct database key is already configured. No key file was generated.",
				ok: true,
				protection,
			};
		}

		if (current.configuredKeyFile) {
			if (!current.keyFileStatus.readable) {
				throw new Error("Configured database key file is missing. HachiGen will not generate a replacement because encrypted databases require the original key.");
			}

			try {
				fs.chmodSync(path.dirname(current.configuredKeyFile), 0o700);
				fs.chmodSync(current.configuredKeyFile, 0o600);
			} catch {
				// Windows ACLs may not map cleanly to POSIX modes; the key still exists.
			}

			this.updateLocalDatabaseProtectionEnv({
				HACHI_DB_ENCRYPTION: "encrypted",
				HACHI_DB_KEY_FILE: current.configuredKeyFile,
			});

			const protection = this.localDatabaseProtectionState();
			this.logDatabase(`key file ready at ${displayPath(protection.configuredKeyFile)}.`, {
				source: "local",
			});

			return {
				database: await this.getDatabaseState(),
				message: `Database protection key ready at ${protection.configuredKeyFile}.`,
				ok: true,
				protection,
			};
		}

		const location = this.getLocalDatabaseKeyLocation();
		ensureDir(path.dirname(location.path));
		const generated = !fileExists(location.path);

		if (generated) {
			fs.writeFileSync(location.path, `${generateDatabaseKey()}\n`, {
				encoding: "utf8",
				mode: 0o600,
			});
		}

		try {
			fs.chmodSync(path.dirname(location.path), 0o700);
			fs.chmodSync(location.path, 0o600);
		} catch {
			// Windows ACLs may not map cleanly to POSIX modes; the key still exists.
		}

		this.updateLocalDatabaseProtectionEnv({
			HACHI_DB_ENCRYPTION: "encrypted",
			HACHI_DB_KEY_FILE: location.path,
		});

		const protection = this.localDatabaseProtectionState();
		this.logDatabase(`${generated ? "generated" : "reused"} key file at ${displayPath(protection.configuredKeyFile)}.`, {
			source: "local",
		});

		return {
			database: await this.getDatabaseState(),
			message: `Database protection key ready at ${protection.configuredKeyFile}.`,
			ok: true,
			protection,
		};
	}

	databaseCipherVerificationScript() {
		return `
const path = require("node:path");
try {
	const dbEncryption = require("./database/dbEncryption.js");
	const keyInfo = dbEncryption.readDatabaseKeyFromEnvFile(path.resolve(".env"), process.env, process.cwd());
	const databasePath = path.resolve("database", "database.sqlite");
	const databaseStatus = dbEncryption.databaseFileStatus(databasePath);
	let cipherTest = null;

	if (databaseStatus.encryptedLikely) {
		try {
			const verification = dbEncryption.verifyEncryptedDatabaseFile({
				dbPath: databasePath,
				key: keyInfo.key,
				root: process.cwd(),
			});
			cipherTest = {
				...verification,
				detail: "Encrypted database opened successfully with the configured key.",
				dot: "good",
				ok: true,
				label: "Database Verified",
				status: "database-verified",
				target: "database",
			};
		} catch (databaseError) {
			cipherTest = {
				detail: "Database could not be opened with the configured key: " + (databaseError.message || String(databaseError)),
				dot: "bad",
				ok: false,
				label: "Database Check Failed",
				status: "database-invalid",
				target: "database",
			};
		}
	} else {
		cipherTest = dbEncryption.verifyCipherDriverCanOpen({
			key: keyInfo.key,
			root: process.cwd(),
		});
	}
	process.stdout.write(JSON.stringify({
		cipherTest: {
			...cipherTest,
			checkedAt: new Date().toISOString(),
			keySource: keyInfo.source,
		},
		ok: Boolean(cipherTest.ok),
	}));
} catch (error) {
	process.stdout.write(JSON.stringify({
		cipherTest: {
			detail: error.message || String(error),
			dot: "bad",
			ok: false,
			label: "Cipher Test Failed",
			status: "failed",
			checkedAt: new Date().toISOString(),
		},
		ok: false,
	}));
}
`;
	}

	async verifyLocalDatabaseCipherOpen() {
		const result = await run("node", ["-e", this.databaseCipherVerificationScript()], {
			allowFailure: true,
			cwd: this.getInstallPath(),
			timeoutMs: 120000,
		});

		try {
			const parsed = parseJsonResult(result, "Local cipher verification did not return valid JSON.");
			return parsed.cipherTest;
		} catch (error) {
			return {
				checkedAt: new Date().toISOString(),
				detail: error.message || String(error),
				dot: "bad",
				ok: false,
				label: "Cipher Test Failed",
				status: "failed",
			};
		}
	}

	async verifyRemoteDatabaseCipherOpen() {
		const result = await this.runRemoteHachiJson(
			`node -e ${quotePosix(this.databaseCipherVerificationScript())}`,
			{
				fallbackMessage: "Remote cipher verification did not return valid JSON.",
				log: false,
				timeoutMs: 120000,
			},
		);

		return result.cipherTest;
	}

	async verifyDatabaseCipherOpen() {
		this.logDatabase("running encrypted database verification.");
		const cipherTest = this.getRuntimeTarget() === "remote" ?
			await this.verifyRemoteDatabaseCipherOpen() :
			await this.verifyLocalDatabaseCipherOpen();

		this.setDatabaseCipherTestState(cipherTest);
		this.logDatabase(`${cipherTest.label || "Verification"}: ${cipherTest.detail || "No detail returned."}`, {
			ok: Boolean(cipherTest.ok),
			status: cipherTest.status,
		});
		return cipherTest;
	}

	async verifyDatabaseProtection() {
		const protection = await this.getDatabaseProtectionState();
		const keyReady = ["key-ready", "direct-key"].includes(protection.status);
		this.logDatabase(`status check: ${protection.label}. ${protection.detail}`);
		const cipherTest = keyReady ? await this.verifyDatabaseCipherOpen() : null;

		if (cipherTest) {
			protection.cipherTest = cipherTest;
		}

		return {
			message: cipherTest ?
				`${protection.label}: ${protection.detail} ${cipherTest.label}: ${cipherTest.detail}` :
				`${protection.label}: ${protection.detail}`,
			ok: protection.status !== "key-missing" && (!cipherTest || cipherTest.ok),
			protection,
		};
	}

	databaseEncryptionConversionScript(backupFileName) {
		return `
const fs = require("node:fs");
const path = require("node:path");
const backupFileName = ${JSON.stringify(backupFileName)};

function output(payload) {
	process.stdout.write(JSON.stringify(payload));
}

function parseDotEnv(content) {
	const values = {};
	for (const line of String(content || "").split(/\\r?\\n/u)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const equalsIndex = trimmed.indexOf("=");
		if (equalsIndex === -1) {
			continue;
		}
		const key = trimmed.slice(0, equalsIndex).trim();
		let value = trimmed.slice(equalsIndex + 1).trim();
		if (value.startsWith('"') && value.endsWith('"')) {
			try {
				value = JSON.parse(value);
			} catch {
				value = value.slice(1, -1);
			}
		} else if (value.startsWith("'") && value.endsWith("'")) {
			value = value.slice(1, -1);
		}
		values[key] = value;
	}
	return values;
}

function formatEnvValue(value) {
	return JSON.stringify(String(value || ""));
}

function updateDotEnvContent(content, values) {
	const pending = new Map(Object.entries(values));
	const lines = String(content || "").split(/\\r?\\n/u);
	const outputLines = [];
	for (const line of lines) {
		if (!line.trim()) {
			if (line || outputLines.length) {
				outputLines.push(line);
			}
			continue;
		}
		const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\\s*=/u);
		if (!match || !pending.has(match[1])) {
			outputLines.push(line);
			continue;
		}
		const key = match[1];
		outputLines.push(key + "=" + formatEnvValue(pending.get(key)));
		pending.delete(key);
	}
	for (const [key, value] of pending) {
		outputLines.push(key + "=" + formatEnvValue(value));
	}
	return outputLines.filter((line, index, collection) => line || index < collection.length - 1).join("\\n") + "\\n";
}

function removeDatabaseSidecars(databasePath) {
	for (const filePath of [
		databasePath + "-wal",
		databasePath + "-shm",
		databasePath + "-journal",
	]) {
		try {
			if (fs.existsSync(filePath)) {
				fs.rmSync(filePath, { force: true });
			}
		} catch {
			// A stale sidecar cleanup failure should not hide the main result.
		}
	}
}

function checkpointDatabase(databasePath) {
	let db = null;
	try {
		const Database = require("better-sqlite3-multiple-ciphers");
		db = new Database(databasePath, { fileMustExist: true });
		db.pragma("wal_checkpoint(FULL)");
	} catch {
		// The conversion backup still proceeds; any copy/lock issue is surfaced later.
	} finally {
		if (db) {
			db.close();
		}
	}
}

function applyRuntimeEnv(keyInfo) {
	process.env.HACHI_DB_ENCRYPTION = "encrypted";
	process.env.HACHI_DB_KEY = keyInfo.key;
	if (keyInfo.keyFilePath) {
		process.env.HACHI_DB_KEY_FILE = keyInfo.keyFilePath;
	}
}

async function verifyRuntimeOpen(keyInfo) {
	applyRuntimeEnv(keyInfo);
	const { sequelize } = require("./database/dbObjects.js");
	try {
		await sequelize.authenticate();
	} finally {
		await sequelize.close().catch(() => null);
	}
}

function restoreFromBackup({ backupPath, databasePath, envPath, originalEnv }) {
	if (fs.existsSync(backupPath)) {
		fs.copyFileSync(backupPath, databasePath);
	}
	removeDatabaseSidecars(databasePath);
	fs.writeFileSync(envPath, originalEnv, "utf8");
}

(async () => {
	const dbEncryption = require("./database/dbEncryption.js");
	const databasePath = path.resolve("database", "database.sqlite");
	const databaseDir = path.dirname(databasePath);
	const backupDir = path.resolve("manager", "backups", "database");
	const backupPath = path.join(backupDir, backupFileName);
	const encryptedTempPath = path.join(databaseDir, "database-encrypted-" + Date.now() + "-" + process.pid + ".tmp.sqlite");
	const envPath = path.resolve(".env");
	const originalEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
	const keyInfo = dbEncryption.readDatabaseKeyFromEnvFile(envPath, process.env, process.cwd());

	if (!String(keyInfo.key || "").trim()) {
		throw new Error("No database key is configured.");
	}

	applyRuntimeEnv(keyInfo);
	const before = dbEncryption.databaseFileStatus(databasePath);

	if (before.encryptedLikely) {
		dbEncryption.verifyEncryptedDatabaseFile({
			dbPath: databasePath,
			key: keyInfo.key,
			root: process.cwd(),
		});
		fs.writeFileSync(envPath, updateDotEnvContent(originalEnv, {
			HACHI_DB_ENCRYPTION: "encrypted",
		}), "utf8");
		await verifyRuntimeOpen(keyInfo);
		output({
			alreadyEncrypted: true,
			backupPath: "",
			fileName: "",
			message: "Database is already encrypted. Runtime mode was verified.",
			ok: true,
			status: dbEncryption.databaseFileStatus(databasePath),
		});
		return;
	}

	if (before.status !== "plaintext") {
		throw new Error("Database conversion requires a plain SQLite database. Current status: " + before.label + ".");
	}

	fs.mkdirSync(backupDir, { recursive: true });
	if (fs.existsSync(backupPath)) {
		throw new Error("Recovery backup already exists: " + backupPath);
	}

	checkpointDatabase(databasePath);
	fs.copyFileSync(databasePath, backupPath);
	try {
		fs.chmodSync(backupPath, 0o600);
	} catch {
		// Windows ACLs may not map cleanly to POSIX modes.
	}
	dbEncryption.writeDatabaseBackupMetadata({
		backupPath,
		key: "",
		reason: "pre-encryption",
		root: process.cwd(),
		source: "conversion",
		status: before,
	});

	let databaseOverwritten = false;
	try {
		const conversion = dbEncryption.convertPlainDatabaseToEncrypted({
			key: keyInfo.key,
			root: process.cwd(),
			sourcePath: databasePath,
			targetPath: encryptedTempPath,
		});

		fs.copyFileSync(encryptedTempPath, databasePath);
		databaseOverwritten = true;
		removeDatabaseSidecars(databasePath);
		fs.writeFileSync(envPath, updateDotEnvContent(originalEnv, {
			HACHI_DB_ENCRYPTION: "encrypted",
		}), "utf8");
		await verifyRuntimeOpen(keyInfo);

		output({
			...conversion,
			backupPath,
			fileName: backupFileName,
			message: "Database encrypted. Plaintext recovery backup created: " + backupFileName,
			ok: true,
			status: dbEncryption.databaseFileStatus(databasePath),
		});
	} catch (error) {
		if (databaseOverwritten) {
			try {
				restoreFromBackup({ backupPath, databasePath, envPath, originalEnv });
			} catch (restoreError) {
				throw new Error((error.message || String(error)) + " Rollback failed: " + (restoreError.message || String(restoreError)));
			}
		} else {
			fs.writeFileSync(envPath, originalEnv, "utf8");
		}
		throw error;
	} finally {
		for (const filePath of [
			encryptedTempPath,
			encryptedTempPath + "-wal",
			encryptedTempPath + "-shm",
			encryptedTempPath + "-journal",
		]) {
			try {
				if (fs.existsSync(filePath)) {
					fs.rmSync(filePath, { force: true });
				}
			} catch {
				// Temporary cleanup can be retried by the OS or user later.
			}
		}
	}
})().catch(error => {
	output({
		error: error.message || String(error),
		ok: false,
	});
});
`;
	}

	async convertDatabaseEncryption() {
		const backupFileName = `database-pre-encryption-${fileTimestamp()}-${Date.now()}.sqlite`;

		this.logDatabase("starting plaintext database conversion.");
		await this.prepareDatabaseProtection();
		const verification = await this.verifyDatabaseProtection();

		if (!verification.ok) {
			throw new Error(verification.message || "Database protection verification failed.");
		}

		this.logDatabase("checkpointing database before conversion.");
		await this.checkpointLocalDatabase();

		const script = this.databaseEncryptionConversionScript(backupFileName);
		this.logDatabase(`creating encrypted database and recovery backup ${backupFileName}.`);
		const result = this.getRuntimeTarget() === "remote" ?
			await this.runRemoteHachiJson(`node -e ${quotePosix(script)}`, {
				fallbackMessage: "Remote database encryption conversion did not return valid JSON.",
				log: false,
				timeoutMs: 600000,
			}) :
			parseJsonResult(await run("node", ["-e", script], {
				allowFailure: true,
				cwd: this.getInstallPath(),
				timeoutMs: 600000,
			}), "Database encryption conversion did not return valid JSON.");

		if (!result.ok) {
			throw new Error(result.error || "Database encryption conversion failed.");
		}

		this.setDatabaseCipherTestState({
			checkedAt: new Date().toISOString(),
			detail: "Encrypted database runtime opens successfully with the configured key.",
			dot: "good",
			ok: true,
			label: "Runtime Verified",
			status: "runtime-verified",
		});
		this.logDatabase(result.message || "Database encrypted.", {
			backup: result.fileName || "",
			objectsCopied: result.objectsCopied,
			rowsCopied: result.rowsCopied,
			tablesCopied: result.tablesCopied,
		});

		return {
			...result,
			database: await this.getDatabaseState(),
		};
	}

	databaseKeyRotationScript(backupFileName, { rotateBackups = false } = {}) {
		return `
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const backupFileName = ${JSON.stringify(backupFileName)};
const rotateBackups = ${rotateBackups ? "true" : "false"};

function output(payload) {
	process.stdout.write(JSON.stringify(payload));
}

function parseDotEnv(content) {
	const values = {};
	for (const line of String(content || "").split(/\\r?\\n/u)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const equalsIndex = trimmed.indexOf("=");
		if (equalsIndex === -1) {
			continue;
		}
		const key = trimmed.slice(0, equalsIndex).trim();
		let value = trimmed.slice(equalsIndex + 1).trim();
		if (value.startsWith('"') && value.endsWith('"')) {
			try {
				value = JSON.parse(value);
			} catch {
				value = value.slice(1, -1);
			}
		} else if (value.startsWith("'") && value.endsWith("'")) {
			value = value.slice(1, -1);
		}
		values[key] = value;
	}
	return values;
}

function formatEnvValue(value) {
	return JSON.stringify(String(value || ""));
}

function updateDotEnvContent(content, values) {
	const pending = new Map(Object.entries(values));
	const lines = String(content || "").split(/\\r?\\n/u);
	const outputLines = [];
	for (const line of lines) {
		if (!line.trim()) {
			if (line || outputLines.length) {
				outputLines.push(line);
			}
			continue;
		}
		const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\\s*=/u);
		if (!match || !pending.has(match[1])) {
			outputLines.push(line);
			continue;
		}
		const key = match[1];
		const value = pending.get(key);
		if (value !== null && value !== undefined) {
			outputLines.push(key + "=" + formatEnvValue(value));
		}
		pending.delete(key);
	}
	for (const [key, value] of pending) {
		if (value !== null && value !== undefined) {
			outputLines.push(key + "=" + formatEnvValue(value));
		}
	}
	return outputLines.filter((line, index, collection) => line || index < collection.length - 1).join("\\n") + "\\n";
}

function removeDatabaseSidecars(databasePath) {
	for (const filePath of [
		databasePath + "-wal",
		databasePath + "-shm",
		databasePath + "-journal",
	]) {
		try {
			if (fs.existsSync(filePath)) {
				fs.rmSync(filePath, { force: true });
			}
		} catch {
			// A stale sidecar cleanup failure should not hide the main result.
		}
	}
}

async function verifyRuntimeOpen(newKey, keyFilePath) {
	process.env.HACHI_DB_ENCRYPTION = "encrypted";
	process.env.HACHI_DB_KEY = newKey;
	if (keyFilePath) {
		process.env.HACHI_DB_KEY_FILE = keyFilePath;
	}
	const { sequelize } = require("./database/dbObjects.js");
	try {
		await sequelize.authenticate();
	} finally {
		await sequelize.close().catch(() => null);
	}
}

(async () => {
	const dbEncryption = require("./database/dbEncryption.js");
	const databasePath = path.resolve("database", "database.sqlite");
	const backupDir = path.resolve("manager", "backups", "database");
	const backupPath = path.join(backupDir, backupFileName);
	const envPath = path.resolve(".env");
	const originalEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
	const env = parseDotEnv(originalEnv);
	const keyInfo = dbEncryption.readDatabaseKeyFromEnvFile(envPath, process.env, process.cwd());
	const oldKey = String(keyInfo.key || "").trim();
	const newKey = crypto.randomBytes(32).toString("base64url");
	const databaseStatus = dbEncryption.databaseFileStatus(databasePath);
	const usingDirectKey = keyInfo.source === "direct";
	const keyFilePath = keyInfo.keyFilePath || "";
	const originalKeyFile = keyFilePath && fs.existsSync(keyFilePath) ? fs.readFileSync(keyFilePath, "utf8") : null;

	if (!oldKey) {
		throw new Error("No database key is configured.");
	}

	if (databaseStatus.status === "plaintext") {
		throw new Error("Plaintext databases must be converted before rotating the encryption key.");
	}

	if (databaseStatus.encryptedLikely) {
		fs.mkdirSync(backupDir, { recursive: true });
		if (fs.existsSync(backupPath)) {
			throw new Error("Key rotation backup already exists: " + backupPath);
		}
		fs.copyFileSync(databasePath, backupPath);
		try {
			fs.chmodSync(backupPath, 0o600);
		} catch {
			// Windows ACLs may not map cleanly to POSIX modes.
		}
		dbEncryption.writeDatabaseBackupMetadata({
			backupPath,
			key: oldKey,
			reason: "pre-key-rotation",
			root: process.cwd(),
			source: "key-rotation",
		});
	}

	let databaseRekeyed = false;

	try {
		if (databaseStatus.encryptedLikely) {
			dbEncryption.rekeyEncryptedDatabase({
				dbPath: databasePath,
				newKey,
				oldKey,
				root: process.cwd(),
			});
			databaseRekeyed = true;
		}

		if (usingDirectKey) {
			fs.writeFileSync(envPath, updateDotEnvContent(originalEnv, {
				HACHI_DB_ENCRYPTION: "encrypted",
				HACHI_DB_KEY: newKey,
			}), "utf8");
		} else {
			if (!keyFilePath) {
				throw new Error("No database key file is configured.");
			}

			fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
			fs.writeFileSync(keyFilePath, newKey + "\\n", {
				encoding: "utf8",
				mode: 0o600,
			});
			try {
				fs.chmodSync(keyFilePath, 0o600);
			} catch {
				// Windows ACLs may not map cleanly to POSIX modes.
			}
			fs.writeFileSync(envPath, updateDotEnvContent(originalEnv, {
				HACHI_DB_ENCRYPTION: "encrypted",
				HACHI_DB_KEY: env.HACHI_DB_KEY ? null : undefined,
				HACHI_DB_KEY_FILE: keyFilePath,
			}), "utf8");
		}

		if (databaseStatus.encryptedLikely) {
			await verifyRuntimeOpen(newKey, keyFilePath);
		}

		let backupRotation = null;
		if (rotateBackups) {
			try {
				backupRotation = dbEncryption.rotateDatabaseBackups({
					backupDir,
					includePlaintext: true,
					newKey,
					oldKey,
					root: process.cwd(),
					source: "key-rotation",
				});
			} catch (backupError) {
				backupRotation = {
					converted: 0,
					entries: [{
						error: backupError.message || String(backupError),
						ok: false,
						status: "skipped",
					}],
					ok: false,
					rekeyed: 0,
					skipped: 1,
					total: 0,
					verified: 0,
				};
			}
		}

		const backupMessage = backupRotation ?
			" " + dbEncryption.databaseBackupRotationSummary(backupRotation) :
			"";

		output({
			backupRotation,
			backupPath: databaseStatus.encryptedLikely ? backupPath : "",
			fileName: databaseStatus.encryptedLikely ? backupFileName : "",
			message: databaseStatus.encryptedLikely ?
				"Database key rotated. Encrypted safety backup created: " + backupFileName + "." + backupMessage :
				"Database key rotated. No database exists yet; first startup will create an encrypted database with the new key." + backupMessage,
			ok: true,
			status: dbEncryption.databaseFileStatus(databasePath),
		});
	} catch (error) {
		if (databaseRekeyed && fs.existsSync(backupPath)) {
			try {
				fs.copyFileSync(backupPath, databasePath);
				removeDatabaseSidecars(databasePath);
			} catch {
				// The thrown error below still explains the original failure.
			}
		}
		fs.writeFileSync(envPath, originalEnv, "utf8");
		if (keyFilePath && originalKeyFile !== null) {
			fs.writeFileSync(keyFilePath, originalKeyFile, "utf8");
		}
		throw error;
	}
})().catch(error => {
	output({
		error: error.message || String(error),
		ok: false,
	});
});
`;
	}

	async rotateDatabaseKey({ rotateBackups = false } = {}) {
		const backupFileName = `database-pre-key-rotation-${fileTimestamp()}-${Date.now()}.sqlite`;
		const protection = await this.getDatabaseProtectionState();

		if (!["key-ready", "direct-key"].includes(protection.status)) {
			throw new Error("Generate a database key before rotating it.");
		}

		this.logDatabase(`starting key rotation${rotateBackups ? " with backup rotation" : ""}.`);
		this.logDatabase(`planned safety backup: ${backupFileName}.`);
		const script = this.databaseKeyRotationScript(backupFileName, { rotateBackups });
		const result = this.getRuntimeTarget() === "remote" ?
			await this.runRemoteHachiJson(`node -e ${quotePosix(script)}`, {
				fallbackMessage: "Remote database key rotation did not return valid JSON.",
				log: false,
				timeoutMs: 600000,
			}) :
			parseJsonResult(await run("node", ["-e", script], {
				allowFailure: true,
				cwd: this.getInstallPath(),
				timeoutMs: 600000,
			}), "Database key rotation did not return valid JSON.");

		if (!result.ok) {
			throw new Error(result.error || "Database key rotation failed.");
		}

		this.setDatabaseCipherTestState({
			checkedAt: new Date().toISOString(),
			detail: "Encrypted database runtime opens successfully with the configured key.",
			dot: "good",
			ok: true,
			label: "Runtime Verified",
			status: "runtime-verified",
		});
		this.logDatabase(result.message || "Database key rotated.", {
			backup: result.fileName || "",
			backupRotation: backupRotationSummaryText(result.backupRotation),
		});

		return {
			...result,
			database: await this.getDatabaseState(),
		};
	}

	databaseBackupRotationScript() {
		return `
const path = require("node:path");

function output(payload) {
	process.stdout.write(JSON.stringify(payload));
}

try {
	const dbEncryption = require("./database/dbEncryption.js");
	const backupDir = path.resolve("manager", "backups", "database");
	const keyInfo = dbEncryption.readDatabaseKeyFromEnvFile(path.resolve(".env"), process.env, process.cwd());
	const currentKey = String(keyInfo.key || "").trim();

	if (!currentKey) {
		throw new Error("No database key is configured.");
	}

	const backupRotation = dbEncryption.rotateDatabaseBackups({
		backupDir,
		includePlaintext: true,
		newKey: currentKey,
		oldKey: currentKey,
		root: process.cwd(),
		source: "backup-rotation",
	});

	output({
		backupRotation,
		message: dbEncryption.databaseBackupRotationSummary(backupRotation),
		ok: backupRotation.ok !== false,
	});
} catch (error) {
	output({
		error: error.message || String(error),
		ok: false,
	});
}
`;
	}

	async rotateDatabaseBackups() {
		const protection = await this.getDatabaseProtectionState();

		if (!["key-ready", "direct-key"].includes(protection.status)) {
			throw new Error("Generate a database key before rotating backup encryption.");
		}

		this.logDatabase("checking backups against the current database key.");
		const script = this.databaseBackupRotationScript();
		const result = this.getRuntimeTarget() === "remote" ?
			await this.runRemoteHachiJson(`node -e ${quotePosix(script)}`, {
				fallbackMessage: "Remote database backup rotation did not return valid JSON.",
				log: false,
				timeoutMs: 600000,
			}) :
			parseJsonResult(await run("node", ["-e", script], {
				allowFailure: true,
				cwd: this.getInstallPath(),
				timeoutMs: 600000,
			}), "Database backup rotation did not return valid JSON.");

		if (!result.ok) {
			throw new Error(result.error || "Database backup rotation failed.");
		}

		this.logDatabase(result.message || "Database backups checked.", {
			backupRotation: backupRotationSummaryText(result.backupRotation),
		});

		return {
			...result,
			database: await this.getDatabaseState(),
		};
	}

	async readDatabaseProtectionKey() {
		if (this.getRuntimeTarget() === "remote") {
			const result = await this.runRemoteHachiJson(`node -e ${quotePosix(this.remoteDatabaseProtectionScript("read-key"))}`, {
				fallbackMessage: "Remote database key read did not return valid JSON.",
				log: false,
				timeoutMs: 30000,
			});

			if (!result.ok) {
				throw new Error(result.error || "Remote database key is not available.");
			}

			const key = normalizeDatabaseKey(result.key);

			if (!key) {
				throw new Error("Remote database key is empty.");
			}

			return key;
		}

		const env = this.readLocalDatabaseProtectionEnv();
		const paths = this.getPaths();
		const configuredKeyFile = resolveLocalPath(env.HACHI_DB_KEY_FILE || "", paths.root);

		if (configuredKeyFile) {
			const key = normalizeDatabaseKey(fs.readFileSync(configuredKeyFile, "utf8"));

			if (!key) {
				throw new Error("Configured database key file is empty.");
			}

			return key;
		}

		const directKey = normalizeDatabaseKey(env.HACHI_DB_KEY);

		if (!directKey) {
			throw new Error("No database key is configured.");
		}

		return directKey;
	}

	async exportDatabaseKeyBackup(backupPath) {
		const resolvedBackupPath = path.resolve(String(backupPath || ""));

		if (!resolvedBackupPath) {
			throw new Error("Choose a file path for the database key backup.");
		}

		const key = await this.readDatabaseProtectionKey();
		ensureDir(path.dirname(resolvedBackupPath));
		fs.writeFileSync(resolvedBackupPath, `${key}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});

		try {
			fs.chmodSync(resolvedBackupPath, 0o600);
		} catch {
			// Windows ACLs may not map cleanly to POSIX modes; the backup was written.
		}

		this.logDatabase(`key backup exported to ${path.basename(resolvedBackupPath)}.`, {
			fileName: path.basename(resolvedBackupPath),
		});

		return {
			backupPath: resolvedBackupPath,
			fileName: path.basename(resolvedBackupPath),
			message: `Database key backup exported to ${path.basename(resolvedBackupPath)}.`,
			ok: true,
		};
	}

	async getDatabaseState() {
		if (this.getRuntimeTarget() === "remote") {
			return this.getRemoteDatabaseState();
		}

		// Build lightweight database status for the Database tab. Opening SQLite
		// is reserved for explicit Backup/Restore/Sanitize actions.
		// This method is safe to call often from getState().
		const paths = this.getPaths();
		const exists = fileExists(paths.database);
		const stats = exists ? fs.statSync(paths.database) : null;
		const backups = this.getDatabaseBackups();
		const audit = await this.auditDatabase({ quiet: true });

		return {
			audit,
			backupDir: this.getDatabaseBackupDir(),
			backups,
			exists,
			latestBackup: backups[0] || null,
			modifiedAt: stats ? stats.mtime.toISOString() : null,
			path: paths.database,
			protection: await this.getDatabaseProtectionState(),
			size: stats ? stats.size : 0,
			sizeLabel: stats ? formatFileSize(stats.size) : "0 B",
			source: "local",
		};
	}

	async getRemoteDatabaseState() {
		const script = `
const fs = require("node:fs");
const path = require("node:path");
const databasePath = "database/database.sqlite";
const backupDir = "manager/backups/database";
let dbEncryption = null;
let currentKey = "";
try {
	dbEncryption = require("./database/dbEncryption.js");
	currentKey = dbEncryption.readDatabaseKeyFromEnvFile(path.resolve(".env"), process.env, process.cwd()).key || "";
} catch {
	dbEncryption = null;
}
function fileInfo(filePath) {
	if (!fs.existsSync(filePath)) {
		return null;
	}
	const stats = fs.statSync(filePath);
	return {
		modifiedAt: stats.mtime.toISOString(),
		size: stats.size,
	};
}
const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir)
	.filter(file => /\\.sqlite$/i.test(file))
	.map(file => {
		const fullPath = path.posix.join(backupDir, file);
		const stats = fs.statSync(fullPath);
		const protection = dbEncryption && dbEncryption.describeDatabaseBackup ?
			dbEncryption.describeDatabaseBackup({ backupPath: fullPath, currentKey, root: process.cwd() }) :
			null;
		return {
			file,
			fullPath,
			modifiedAt: stats.mtime.toISOString(),
			protection,
			size: stats.size,
		};
	})
	.sort((left, right) => new Date(right.modifiedAt) - new Date(left.modifiedAt)) : [];
process.stdout.write(JSON.stringify({
	backupDir,
	backups,
	database: fileInfo(databasePath),
	path: databasePath,
}));
`;
		const state = await this.runRemoteHachiJson(`node -e ${quotePosix(script)}`, {
			fallbackMessage: "Could not read remote database state.",
			log: false,
			timeoutMs: 20000,
		});
		const backups = (state.backups || []).map(backup => ({
			...backup,
			sizeLabel: formatFileSize(backup.size),
		}));
		const exists = Boolean(state.database);
		const audit = await this.auditDatabase({ quiet: true });

		return {
			audit,
			backupDir: state.backupDir || "manager/backups/database",
			backups,
			exists,
			latestBackup: backups[0] || null,
			modifiedAt: state.database?.modifiedAt || null,
			path: state.path || "database/database.sqlite",
			protection: await this.getDatabaseProtectionState(),
			size: state.database?.size || 0,
			sizeLabel: state.database ? formatFileSize(state.database.size) : "0 B",
			source: "remote",
		};
	}

	async runDatabaseWorker(action, options = {}) {
		if (this.getRuntimeTarget() === "remote") {
			return this.runRemoteDatabaseWorker(action, options);
		}

		return this.runLocalDatabaseWorker(action, options);
	}

	async runLocalDatabaseWorker(action, options = {}) {
		// Run SQLite inspection/cleanup in the user's normal Node.js process.
		// That keeps native sqlite3 loading out of Electron's runtime.
		// The worker returns JSON, so this method converts worker failures into
		// normal JavaScript errors for the renderer toast/log handling.
		const paths = this.getPaths();

		if (!fileExists(paths.database)) {
			throw new Error("No Hachi database exists in the selected install folder.");
		}

		await this.ensureNodeAndNpm(false);

		const request = {
			action,
			dbPath: paths.database,
			root: paths.root,
			...options,
		};
		// Pipe the request through stdin instead of argv so payload size cannot
		// trip Windows command-line length limits.
		const result = await run("node", [this.getDatabaseWorkerPath()], {
			cwd: paths.root,
			allowFailure: true,
			input: JSON.stringify(request),
			timeoutMs: 300000,
		});
		const output = (result.stdout || "").trim();
		let parsed = null;

		try {
			parsed = JSON.parse(output);
		} catch {
			throw new Error(result.stderr || output || "Database worker did not return valid JSON.");
		}

		if (!parsed.ok) {
			throw new Error(parsed.error || result.stderr || "Database operation failed.");
		}

		return parsed;
	}

	async runRemoteDatabaseWorker(action, options = {}) {
		const request = {
			action,
			dbPath: "database/database.sqlite",
			root: ".",
			...options,
		};
		const remoteWorkerPath = ".hachigen/database-worker.js";
		const remoteWorkerSource = fs.readFileSync(path.join(this.managerRoot, "src", DATABASE_WORKER_FILE), "utf8");
		await this.writeRemoteText(remoteWorkerPath, remoteWorkerSource);
		const result = await this.runRemoteHachiCommand(`node ${quotePosix(remoteWorkerPath)}`, {
			allowFailure: true,
			input: JSON.stringify(request),
			log: false,
			timeoutMs: 300000,
		});
		const parsed = parseJsonResult(result, "Remote database worker did not return valid JSON.");

		if (!parsed.ok) {
			throw new Error(parsed.error || result.stderr || "Remote database operation failed.");
		}

		return parsed;
	}

	async runDatabaseAuditCommand(args = [], { quiet = false } = {}) {
		if (this.getRuntimeTarget() === "remote") {
			return this.runRemoteDatabaseAuditCommand(args, { quiet });
		}

		// Run the same audit/migration script that users can run from the console.
		// --json keeps stdout parseable for HachiGen.
		const paths = this.getPaths();

		if (!fileExists(paths.database)) {
			return {
				detail: "No database file found.",
				dot: "muted",
				exists: false,
				forceMigrationAvailable: false,
				label: "Not Created",
				migrationAvailable: false,
				ok: true,
				status: "missing",
			};
		}

		if (!fileExists(paths.dbAudit)) {
			return {
				detail: "database/dbAudit.js is missing.",
				dot: "bad",
				error: "database/dbAudit.js is missing.",
				exists: true,
				forceMigrationAvailable: false,
				label: "Audit Error",
				migrationAvailable: false,
				ok: false,
				status: "error",
			};
		}

		if (!await commandExists("node")) {
			return {
				detail: "Node.js is required to audit the database.",
				dot: "bad",
				error: "Node.js is required to audit the database.",
				exists: true,
				forceMigrationAvailable: false,
				label: "Audit Error",
				migrationAvailable: false,
				ok: false,
				status: "error",
			};
		}

		const result = await run("node", ["database/dbAudit.js", "--json", ...args], {
			cwd: paths.root,
			allowFailure: true,
			timeoutMs: 300000,
			onLog: quiet ? null : entry => this.logShell(entry),
		});
		const output = (result.stdout || "").trim();

		try {
			return JSON.parse(output);
		} catch {
			return {
				detail: "Database audit did not return valid JSON.",
				dot: "bad",
				error: result.stderr || output || "Database audit failed.",
				exists: true,
				forceMigrationAvailable: false,
				label: "Audit Error",
				migrationAvailable: false,
				ok: false,
				status: "error",
			};
		}
	}

	async runRemoteDatabaseAuditCommand(args = []) {
		const result = await this.runRemoteHachiCommand(`node database/dbAudit.js --json ${args.map(arg => quotePosix(arg)).join(" ")}`, {
			allowFailure: true,
			log: false,
			timeoutMs: 300000,
		});
		const output = (result.stdout || "").trim();

		try {
			return JSON.parse(output);
		} catch {
			return {
				detail: "Remote database audit did not return valid JSON.",
				dot: "bad",
				error: result.stderr || output || "Remote database audit failed.",
				exists: true,
				forceMigrationAvailable: false,
				label: "Audit Error",
				migrationAvailable: false,
				ok: false,
				status: "error",
			};
		}
	}

	async auditDatabase(options = {}) {
		// Audit only. This powers the Dashboard database card and button states.
		return this.runDatabaseAuditCommand([], options);
	}

	async migrateDatabase({ force = false } = {}) {
		// Migrate through the shared console command. Safe migration refuses
		// destructive changes; force migration allows exact-schema rebuilds.
		const result = await this.runDatabaseAuditCommand([force ? "--force" : "--migrate"]);

		if (!result.ok) {
			throw new Error(result.message || result.error || "Database migration failed.");
		}

		this.log(result.message || "Database migration complete.");

		return {
			...result,
			database: await this.getDatabaseState(),
		};
	}

	async checkpointDatabase() {
		// Ask SQLite to flush WAL data before copying the database. If the
		// dependency is unavailable, backup still falls back to copying the file.
		// This keeps Backup useful even if the database worker cannot run.
		return this.getRuntimeTarget() === "remote" ?
			this.checkpointRemoteDatabase() :
			this.checkpointLocalDatabase();
	}

	async checkpointLocalDatabase() {
		try {
			await this.runLocalDatabaseWorker("checkpoint");
		} catch (error) {
			this.log(`Database checkpoint skipped: ${error.message}`);
		}
	}

	async checkpointRemoteDatabase() {
		try {
			await this.runRemoteDatabaseWorker("checkpoint");
		} catch (error) {
			this.log(`Remote database checkpoint skipped: ${error.message}`);
		}
	}

	async backupDatabase({ fileName = `database-${dateStamp()}.sqlite`, overwrite = false } = {}) {
		if (this.getRuntimeTarget() === "remote") {
			return this.backupRemoteDatabase({ fileName, overwrite });
		}

		return this.backupLocalDatabase({ fileName, overwrite });
	}

	async backupLocalDatabase({ fileName = `database-${dateStamp()}.sqlite`, overwrite = false, reason = "manual" } = {}) {
		this.logDatabase(`${overwrite ? "overwriting" : "creating"} backup ${fileName}.`);
		// Copy the current database into the dated backup folder. Manual backups
		// use a date-only filename so HachiGen can ask before replacing today's.
		// Automatic safety backups pass unique timestamped filenames.
		const paths = this.getPaths();

		if (!fileExists(paths.database)) {
			throw new Error("No Hachi database exists to back up.");
		}

		const backupDir = this.getDatabaseBackupDir();
		const backupPath = path.join(backupDir, fileName);

		ensureDir(backupDir);

		if (fileExists(backupPath) && !overwrite) {
			return {
				backupPath,
				fileName,
				needsOverwrite: true,
				ok: false,
				message: `${fileName} already exists.`,
			};
		}

		await this.checkpointDatabase();
		fs.copyFileSync(paths.database, backupPath);
		const dbEncryption = loadDatabaseEncryptionModule(paths.root);
		let protection = null;

		if (dbEncryption?.writeDatabaseBackupMetadata) {
			try {
				const key = this.readLocalDatabaseProtectionKeyIfAvailable();
				const metadata = dbEncryption.writeDatabaseBackupMetadata({
					backupPath,
					key,
					reason,
					root: paths.root,
					source: "local",
				});
				protection = dbEncryption.describeDatabaseBackup({
					backupPath,
					currentKey: key,
					root: paths.root,
					verifyWithCurrentKey: false,
				});
				protection.metadata = metadata;
			} catch (error) {
				this.logDatabase(`backup metadata skipped: ${error.message || error}`);
			}
		}
		this.logDatabase(`backup created: ${displayPath(backupPath, paths.root)}.`, {
			fileName,
			protection: protection?.label || "",
		});

		return {
			backupPath,
			fileName,
			ok: true,
			protection,
			message: `Database backup created: ${fileName}`,
		};
	}

	async backupRemoteDatabase({ fileName = `database-${dateStamp()}.sqlite`, overwrite = false } = {}) {
		const safeFileName = path.basename(fileName);
		this.logDatabase(`${overwrite ? "overwriting" : "creating"} remote backup ${safeFileName}.`);
		const script = `
const fs = require("node:fs");
const path = require("node:path");
const databasePath = "database/database.sqlite";
const backupDir = "manager/backups/database";
const fileName = ${JSON.stringify(safeFileName)};
const overwrite = ${overwrite ? "true" : "false"};
const backupPath = path.posix.join(backupDir, fileName);
let dbEncryption = null;
let currentKey = "";
try {
	dbEncryption = require("./database/dbEncryption.js");
	currentKey = dbEncryption.readDatabaseKeyFromEnvFile(path.resolve(".env"), process.env, process.cwd()).key || "";
} catch {
	dbEncryption = null;
}
if (!fs.existsSync(databasePath)) {
	process.stdout.write(JSON.stringify({ ok: false, error: "No remote Hachi database exists to back up." }));
	process.exit(0);
}
fs.mkdirSync(backupDir, { recursive: true });
if (fs.existsSync(backupPath) && !overwrite) {
	process.stdout.write(JSON.stringify({
		backupPath,
		fileName,
		needsOverwrite: true,
		ok: false,
		message: fileName + " already exists.",
	}));
	process.exit(0);
}
fs.copyFileSync(databasePath, backupPath);
let protection = null;
if (dbEncryption && dbEncryption.writeDatabaseBackupMetadata) {
	try {
		const metadata = dbEncryption.writeDatabaseBackupMetadata({
			backupPath,
			key: currentKey,
			reason: "manual",
			root: process.cwd(),
			source: "remote",
		});
		protection = dbEncryption.describeDatabaseBackup({ backupPath, currentKey, root: process.cwd() });
		protection.metadata = metadata;
	} catch {
		protection = null;
	}
}
process.stdout.write(JSON.stringify({
	backupPath,
	fileName,
	ok: true,
	protection,
	message: "Remote database backup created: " + fileName,
}));
`;

		await this.checkpointRemoteDatabase();
		const result = await this.runRemoteHachiJson(`node -e ${quotePosix(script)}`, {
			fallbackMessage: "Remote database backup did not return valid JSON.",
			timeoutMs: 300000,
		});

		if (result.error) {
			throw new Error(result.error);
		}

		if (result.ok) {
			this.logDatabase(`remote backup created: ${result.fileName || safeFileName}.`, {
				protection: result.protection?.label || "",
			});
		}

		return result;
	}

	async readRemoteDatabaseFile() {
		await this.checkpointRemoteDatabase();
		const script = `
const fs = require("node:fs");
const databasePath = "database/database.sqlite";
if (!fs.existsSync(databasePath)) {
	process.stdout.write(JSON.stringify({ ok: false, error: "No remote Hachi database exists to pull." }));
	process.exit(0);
}
const content = fs.readFileSync(databasePath);
const stats = fs.statSync(databasePath);
process.stdout.write(JSON.stringify({
	bytes: content.length,
	content: content.toString("base64"),
	modifiedAt: stats.mtime.toISOString(),
	ok: true,
	path: databasePath,
}));
`;
		const result = await this.runRemoteHachiJson(`node -e ${quotePosix(script)}`, {
			fallbackMessage: "Remote database pull did not return valid JSON.",
			log: false,
			timeoutMs: 300000,
		});

		if (!result.ok) {
			throw new Error(result.error || "Remote database pull failed.");
		}

		return result;
	}

	async writeRemoteDatabaseFile(content) {
		const script = `
const fs = require("node:fs");
const path = require("node:path");
const chunks = [];
process.stdin.on("data", chunk => chunks.push(chunk));
process.stdin.on("end", () => {
	try {
		const request = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
		const content = Buffer.from(String(request.content || ""), "base64");
		const databasePath = "database/database.sqlite";
		fs.mkdirSync(path.dirname(databasePath), { recursive: true });
		for (const sidecar of [databasePath + "-wal", databasePath + "-shm", databasePath + "-journal"]) {
			if (fs.existsSync(sidecar)) {
				fs.rmSync(sidecar, { force: true });
			}
		}
		fs.writeFileSync(databasePath, content);
		process.stdout.write(JSON.stringify({
			bytes: content.length,
			ok: true,
			path: databasePath,
		}));
	} catch (error) {
		process.stdout.write(JSON.stringify({ ok: false, error: error.message || String(error) }));
	}
});
`;
		const result = await this.runRemoteHachiJson(`node -e ${quotePosix(script)}`, {
			fallbackMessage: "Remote database push did not return valid JSON.",
			input: JSON.stringify({
				content: Buffer.from(content).toString("base64"),
			}),
			log: false,
			timeoutMs: 300000,
		});

		if (!result.ok) {
			throw new Error(result.error || "Remote database push failed.");
		}

		return result;
	}

	async readRemoteDatabaseProtectionKeyIfAvailable() {
		try {
			const result = await this.runRemoteHachiJson(`node -e ${quotePosix(this.remoteDatabaseProtectionScript("read-key"))}`, {
				fallbackMessage: "Remote database key read did not return valid JSON.",
				log: false,
				timeoutMs: 30000,
			});

			return result.ok ? normalizeDatabaseKey(result.key) : "";
		} catch {
			return "";
		}
	}

	async ensureRemoteDatabaseProtectionKeyForTransfer() {
		const protection = await this.runRemoteHachiJson(
			`node -e ${quotePosix(this.remoteDatabaseProtectionScript("prepare"))}`,
			{
				fallbackMessage: "Remote database protection setup did not return valid JSON.",
				log: false,
				timeoutMs: 30000,
			},
		);

		if (protection.ok === false) {
			throw new Error(protection.error || "Remote database key setup failed.");
		}

		const key = await this.readRemoteDatabaseProtectionKeyIfAvailable();

		if (!key) {
			throw new Error("Remote database key is not available. Generate or restore the remote database key before transfer.");
		}

		return key;
	}

	ensureLocalDatabaseProtectionKeyForTransfer() {
		const current = this.localDatabaseProtectionState();

		if (["key-ready", "direct-key"].includes(current.status)) {
			const key = this.readLocalDatabaseProtectionKeyIfAvailable();

			if (key) {
				return key;
			}
		}

		if (current.databaseFile?.encryptedLikely) {
			throw new Error("Local database is encrypted, but its configured key is missing. Restore the local database key before transfer.");
		}

		if (current.directKeyConfigured && !current.configuredKeyFile) {
			this.updateLocalDatabaseProtectionEnv({
				HACHI_DB_ENCRYPTION: "encrypted",
			});
			return this.readLocalDatabaseProtectionKeyIfAvailable();
		}

		if (current.configuredKeyFile) {
			if (!current.keyFileStatus.readable) {
				throw new Error("Configured local database key file is missing. HachiGen will not generate a replacement because encrypted databases require the original key.");
			}

			try {
				fs.chmodSync(path.dirname(current.configuredKeyFile), 0o700);
				fs.chmodSync(current.configuredKeyFile, 0o600);
			} catch {
				// Windows ACLs may not map cleanly to POSIX modes; the key still exists.
			}

			this.updateLocalDatabaseProtectionEnv({
				HACHI_DB_ENCRYPTION: "encrypted",
				HACHI_DB_KEY_FILE: current.configuredKeyFile,
			});
			return this.readLocalDatabaseProtectionKeyIfAvailable();
		}

		const location = this.getLocalDatabaseKeyLocation();
		ensureDir(path.dirname(location.path));

		if (!fileExists(location.path)) {
			fs.writeFileSync(location.path, `${generateDatabaseKey()}\n`, {
				encoding: "utf8",
				mode: 0o600,
			});
		}

		try {
			fs.chmodSync(path.dirname(location.path), 0o700);
			fs.chmodSync(location.path, 0o600);
		} catch {
			// Windows ACLs may not map cleanly to POSIX modes; the key still exists.
		}

		this.updateLocalDatabaseProtectionEnv({
			HACHI_DB_ENCRYPTION: "encrypted",
			HACHI_DB_KEY_FILE: location.path,
		});
		const key = this.readLocalDatabaseProtectionKeyIfAvailable();

		if (!key) {
			throw new Error("Local database key could not be prepared for transfer.");
		}

		return key;
	}

	databaseTransferTransformScript() {
		// Transfer adapts a temporary database copy to the destination key. The
		// source and destination installs keep their own configured keys.
		return `
const fs = require("node:fs");
const path = require("node:path");

function output(payload) {
	process.stdout.write(JSON.stringify(payload));
}

const chunks = [];
process.stdin.on("data", chunk => chunks.push(chunk));
process.stdin.on("end", () => {
	try {
		const request = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
		const dbEncryption = require("./database/dbEncryption.js");
		const sourcePath = path.resolve(String(request.sourcePath || ""));
		const targetPath = path.resolve(String(request.targetPath || ""));
		const sourceKey = String(request.sourceKey || "").trim();
		const destinationKey = String(request.destinationKey || "").trim();
		const sourceLabel = String(request.sourceLabel || "source");
		const destinationLabel = String(request.destinationLabel || "destination");

		if (!sourcePath || !fs.existsSync(sourcePath)) {
			throw new Error("Transfer source database file does not exist.");
		}

		if (!targetPath) {
			throw new Error("Transfer target database file was not provided.");
		}

		fs.mkdirSync(path.dirname(targetPath), { recursive: true });

		if (fs.existsSync(targetPath)) {
			fs.rmSync(targetPath, { force: true });
		}

		const before = dbEncryption.databaseFileStatus(sourcePath);
		let transform = "copied";

		if (before.status === "plaintext") {
			if (destinationKey) {
				dbEncryption.convertPlainDatabaseToEncrypted({
					key: destinationKey,
					root: process.cwd(),
					sourcePath,
					targetPath,
				});
				transform = "encrypted";
			} else {
				fs.copyFileSync(sourcePath, targetPath);
				transform = "copied-plaintext";
			}
		} else if (before.encryptedLikely) {
			if (!sourceKey) {
				throw new Error(sourceLabel + " database is encrypted, but the " + sourceLabel + " database key is not available.");
			}

			if (!destinationKey) {
				throw new Error(destinationLabel + " database key is not available.");
			}

			fs.copyFileSync(sourcePath, targetPath);

			if (sourceKey === destinationKey) {
				dbEncryption.verifyEncryptedDatabaseFile({
					dbPath: targetPath,
					key: destinationKey,
					root: process.cwd(),
				});
				transform = "verified";
			} else {
				dbEncryption.rekeyEncryptedDatabase({
					dbPath: targetPath,
					newKey: destinationKey,
					oldKey: sourceKey,
					root: process.cwd(),
				});
				transform = "rekeyed";
			}
		} else {
			throw new Error("Transfer source database is not a recognizable Hachi database.");
		}

		if (destinationKey) {
			dbEncryption.verifyEncryptedDatabaseFile({
				dbPath: targetPath,
				key: destinationKey,
				root: process.cwd(),
			});
		}

		const after = dbEncryption.databaseFileStatus(targetPath);
		output({
			after,
			before,
			bytes: fs.statSync(targetPath).size,
			ok: true,
			transform,
		});
	} catch (error) {
		output({
			error: error.message || String(error),
			ok: false,
		});
	}
});
`;
	}

	async prepareDatabaseBytesForTransfer({
		destinationKey,
		destinationLabel,
		sourceContent = null,
		sourceKey = "",
		sourceLabel,
		sourcePath = "",
	} = {}) {
		const paths = this.getPaths();
		const dbEncryption = loadDatabaseEncryptionModule(paths.root);

		if (!dbEncryption?.rekeyEncryptedDatabase || !dbEncryption?.convertPlainDatabaseToEncrypted) {
			throw new Error("Hachi database encryption helpers are not available. Update or validate Hachi before transferring encrypted databases.");
		}

		await this.ensureNodeAndNpm(false);
		const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-db-transfer-"));
		const tempSourcePath = path.join(tempFolder, "source.sqlite");
		const targetPath = path.join(tempFolder, "target.sqlite");
		const effectiveSourcePath = sourceContent ? tempSourcePath : sourcePath;

		try {
			if (sourceContent) {
				fs.writeFileSync(tempSourcePath, Buffer.from(sourceContent));
			}

			const result = parseJsonResult(await run("node", ["-e", this.databaseTransferTransformScript()], {
				allowFailure: true,
				cwd: paths.root,
				input: JSON.stringify({
					destinationKey,
					destinationLabel,
					sourceKey,
					sourceLabel,
					sourcePath: effectiveSourcePath,
					targetPath,
				}),
				timeoutMs: 600000,
			}), "Database transfer re-encryption did not return valid JSON.");

			if (!result.ok) {
				throw new Error(result.error || "Database transfer re-encryption failed.");
			}

			const content = fs.readFileSync(targetPath);

			return {
				...result,
				bytes: content.length,
				content,
			};
		} finally {
			try {
				fs.rmSync(tempFolder, { force: true, recursive: true });
			} catch {
				// Temporary transfer files can be cleaned up by the OS if still locked.
			}
		}
	}

	async pullRemoteDatabase() {
		const paths = this.getPaths();
		this.logDatabase("pulling remote database to local install.");
		const remoteDatabase = await this.readRemoteDatabaseFile();
		this.logDatabase("remote database downloaded for local transfer.", {
			bytes: remoteDatabase.bytes,
			remotePath: remoteDatabase.path || "database/database.sqlite",
		});
		const localKey = this.ensureLocalDatabaseProtectionKeyForTransfer();
		const remoteKey = await this.readRemoteDatabaseProtectionKeyIfAvailable();
		const transfer = await this.prepareDatabaseBytesForTransfer({
			destinationKey: localKey,
			destinationLabel: "local",
			sourceContent: Buffer.from(remoteDatabase.content, "base64"),
			sourceKey: remoteKey,
			sourceLabel: "remote",
		});
		let safetyBackup = null;

		if (fileExists(paths.database)) {
			const backup = await this.backupLocalDatabase({
				fileName: `database-pre-pull-${fileTimestamp()}-${Date.now()}.sqlite`,
				overwrite: false,
				reason: "transfer-pull",
			});
			safetyBackup = backup.backupPath;
		}

		ensureDir(path.dirname(paths.database));
		removeLocalDatabaseSidecars(paths.database);
		fs.writeFileSync(paths.database, transfer.content);
		this.databaseCipherTest = null;
		const verification = await this.verifyLocalDatabaseCipherOpen();

		if (!verification?.ok) {
			throw new Error(`Local database was transferred but could not be verified with the local key: ${verification?.detail || "verification failed"}`);
		}

		this.setDatabaseCipherTestState(verification);
		this.logDatabase(`remote database pulled to ${displayPath(paths.database, paths.root)}.`, {
			safetyBackup: safetyBackup ? displayPath(safetyBackup, paths.root) : "",
			transform: transfer.transform,
		});

		return {
			bytes: transfer.bytes,
			database: await this.getDatabaseState(),
			localPath: paths.database,
			message: `Remote database pulled to local Hachi and encrypted with the local database key.${safetyBackup ? ` Safety backup: ${path.basename(safetyBackup)}.` : ""}`,
			ok: true,
			remotePath: remoteDatabase.path || "database/database.sqlite",
			safetyBackup,
			source: "remote",
			target: "local",
			transform: transfer.transform,
			verification,
		};
	}

	async pushLocalDatabaseToRemote() {
		const paths = this.getPaths();

		if (!fileExists(paths.database)) {
			throw new Error("No local Hachi database exists to push.");
		}

		this.logDatabase("pushing local database to remote install.");
		await this.checkpointLocalDatabase();
		const remoteKey = await this.ensureRemoteDatabaseProtectionKeyForTransfer();
		const localKey = this.readLocalDatabaseProtectionKeyIfAvailable();
		const transfer = await this.prepareDatabaseBytesForTransfer({
			destinationKey: remoteKey,
			destinationLabel: "remote",
			sourceKey: localKey,
			sourceLabel: "local",
			sourcePath: paths.database,
		});
		let safetyBackup = null;

		if (await this.remotePathExists("database/database.sqlite", "f")) {
			const backup = await this.backupRemoteDatabase({
				fileName: `database-pre-push-${fileTimestamp()}-${Date.now()}.sqlite`,
				overwrite: false,
			});
			safetyBackup = backup.backupPath || "";
		}

		const pushed = await this.writeRemoteDatabaseFile(transfer.content);
		const verification = await this.verifyRemoteDatabaseCipherOpen();

		if (!verification?.ok) {
			throw new Error(`Remote database was transferred but could not be verified with the remote key: ${verification?.detail || "verification failed"}`);
		}

		this.logDatabase("local database pushed to remote install.", {
			bytes: pushed.bytes,
			localPath: paths.database,
			remotePath: pushed.path || "database/database.sqlite",
			safetyBackup,
			transform: transfer.transform,
		});

		return {
			bytes: pushed.bytes,
			database: await this.getDatabaseState(),
			localPath: paths.database,
			message: `Local database pushed to remote Hachi and encrypted with the remote database key.${safetyBackup ? ` Remote safety backup: ${safetyBackup}.` : ""}`,
			ok: true,
			remotePath: pushed.path || "database/database.sqlite",
			safetyBackup,
			source: "local",
			target: "remote",
			transform: transfer.transform,
			verification,
		};
	}

	async restoreDatabaseFromBackup(backupPath) {
		if (this.getRuntimeTarget() === "remote") {
			throw new Error("Remote database restore from a local backup file is not available yet.");
		}

		// Replace the current database with a chosen HachiGen backup. A unique
		// pre-restore backup is created first so the user has a rollback point.
		const paths = this.getPaths();
		const resolvedBackup = path.resolve(String(backupPath || ""));
		const backupDir = path.resolve(this.getDatabaseBackupDir());
		const relativeBackup = path.relative(backupDir, resolvedBackup);

		// Only allow files from HachiGen's backup folder. This prevents the
		// restore command from being used as a general file overwrite tool.
		if (relativeBackup.startsWith("..") || path.isAbsolute(relativeBackup)) {
			throw new Error("Choose a database backup from HachiGen's backup folder.");
		}

		if (!fileExists(resolvedBackup)) {
			throw new Error("The selected database backup does not exist.");
		}

		if (!/\.sqlite$/i.test(path.basename(resolvedBackup))) {
			throw new Error("Choose a .sqlite database backup file.");
		}

		this.logDatabase(`restoring backup ${path.basename(resolvedBackup)}.`);
		ensureDir(path.dirname(paths.database));

		let safetyBackup = null;

		if (fileExists(paths.database)) {
			const safety = await this.backupDatabase({
				fileName: `database-pre-restore-${fileTimestamp()}.sqlite`,
				overwrite: false,
			});
			safetyBackup = safety.backupPath;
		}

		fs.copyFileSync(resolvedBackup, paths.database);

		// SQLite may leave write-ahead-log sidecar files beside the database.
		// After restoring a backup, old sidecars must be removed so they do not
		// overlay stale data onto the restored database.
		for (const sidecar of [`${paths.database}-wal`, `${paths.database}-shm`]) {
			if (fileExists(sidecar)) {
				fs.rmSync(sidecar, { force: true });
			}
		}

		this.logDatabase(`restored backup ${path.basename(resolvedBackup)}.`, {
			safetyBackup: safetyBackup ? displayPath(safetyBackup, paths.root) : "",
		});

		return {
			backupPath: resolvedBackup,
			ok: true,
			message: `Database restored from ${path.basename(resolvedBackup)}.`,
			safetyBackup,
			targetPath: paths.database,
		};
	}

	async reviewDatabaseSanitation() {
		// Produce a review-only report. No rows are changed until the renderer
		// sends selected cleanable action IDs back to applyDatabaseSanitation().
		// The returned database state refreshes backup/status panels after review.
		const report = await this.runDatabaseWorker("review");
		this.log(`Database sanitation review completed with ${report.summary.findingCount} finding(s).`);
		return {
			...report,
			database: await this.getDatabaseState(),
		};
	}

	async readDatabaseTable(tableName = "", sort = {}) {
		// Load a read-only preview for the Database tab viewer. The worker checks
		// that the requested table exists before using it in a quoted SQL query.
		const view = await this.runDatabaseWorker("view", { sort, table: tableName });
		const sourceLabel = this.getRuntimeTarget() === "remote" ? "Remote database" : "Database";
		this.log(`${sourceLabel} viewer loaded ${view.selectedTable || "no table"}.`);
		return {
			...view,
			database: await this.getDatabaseState(),
		};
	}

	async applyDatabaseSanitation(actionIds = []) {
		// Clean only the reviewed action IDs chosen by the user. A unique backup
		// is created first because cleanup deletes or updates database rows.
		// The worker runs another review afterward, so the UI gets fresh findings.
		const selected = Array.isArray(actionIds) ? actionIds.filter(Boolean) : [];

		if (!selected.length) {
			throw new Error("No database sanitation actions were selected.");
		}

		const backup = await this.backupDatabase({
			fileName: `database-pre-sanitize-${fileTimestamp()}.sqlite`,
			overwrite: false,
		});
		const report = await this.runDatabaseWorker("apply", { actionIds: selected });

		this.log(`Database sanitation cleaned ${report.applied.length} issue group(s).`);

		return {
			...report,
			backup,
			database: await this.getDatabaseState(),
		};
	}

	isProjectFolder() {
		// Decide whether the selected folder already looks like a Hachi install.
		// This intentionally checks only the minimum files needed before deeper
		// validation runs.
		const paths = this.getPaths();
		return fileExists(paths.packageJson) && fileExists(paths.index);
	}

	isEmptyDirectory(dirPath) {
		// Used before cloning so HachiGen only writes into empty or missing
		// folders, never over an unrelated project.
		if (!fileExists(dirPath)) {
			return true;
		}

		return fs.readdirSync(dirPath).length === 0;
	}

	quickScan() {
		// Build a fast health snapshot for the Dashboard and Setup page. It only
		// reads local files, so it is safe to call often during normal rendering.
		const paths = this.getPaths();
		const requiredFiles = [
			["package.json", paths.packageJson],
			["index.js", paths.index],
			["config/ecosystem.config.js", paths.ecosystem],
			["delete-all-commands.js", paths.deleteCommands],
			["deploy-global-commands.js", paths.deployGlobal],
			["deploy-guild-commands.js", paths.deployGuild],
		];
		const missingFiles = requiredFiles
			.filter(([, filePath]) => !fileExists(filePath))
			.map(([label]) => label);
		const config = this.readLocalConfiguration();
		const packageJson = readJson(paths.packageJson, {});
		const missingDependencies = missingPackageDependencies(paths.root, packageJson);

		return {
			installPath: paths.root,
			source: "local",
			projectFound: missingFiles.length === 0,
			packageName: packageJson.name || null,
			packageVersion: packageJson.version || null,
			missingFiles,
			hasEnv: fileExists(paths.env),
			hasConfig: fileExists(paths.configJson),
			hasGit: fileExists(paths.git),
			hasNodeModules: fileExists(paths.nodeModules),
			dependenciesReady: missingDependencies.length === 0,
			missingDependencies,
			configurationMissing: config.missing,
			configurationReady: config.missing.length === 0,
		};
	}

	async getQuickScan() {
		if (this.getRuntimeTarget() === "remote") {
			return this.remoteQuickScan();
		}

		return this.quickScan();
	}

	async remoteQuickScan() {
		const config = await this.readRemoteConfiguration();
		const script = `
const fs = require("node:fs");
function exists(filePath) {
	return fs.existsSync(filePath);
}
function readJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return {};
	}
}
function missingDependencies(root, packageJson) {
	return Object.keys(packageJson.dependencies || {}).sort().filter(packageName => {
		try {
			require.resolve(packageName, { paths: [root] });
			return false;
		} catch {
			return true;
		}
	});
}
const requiredFiles = [
	["package.json", "package.json"],
	["index.js", "index.js"],
	["config/ecosystem.config.js", "config/ecosystem.config.js"],
	["delete-all-commands.js", "delete-all-commands.js"],
	["deploy-global-commands.js", "deploy-global-commands.js"],
	["deploy-guild-commands.js", "deploy-guild-commands.js"],
];
const missingFiles = requiredFiles.filter(([, filePath]) => !exists(filePath)).map(([label]) => label);
const packageJson = readJson("package.json");
const missingPackageNames = missingDependencies(process.cwd(), packageJson);
process.stdout.write(JSON.stringify({
	installPath: process.cwd(),
	source: "remote",
	projectFound: missingFiles.length === 0,
	packageName: packageJson.name || null,
	packageVersion: packageJson.version || null,
	missingFiles,
	hasEnv: exists(".env"),
	hasConfig: exists("config/config.json"),
	hasGit: exists(".git"),
	hasNodeModules: exists("node_modules"),
	dependenciesReady: missingPackageNames.length === 0,
	missingDependencies: missingPackageNames,
}));
`;
		const scan = await this.runRemoteHachiJson(`node -e ${quotePosix(script)}`, {
			fallbackMessage: "Could not scan remote Hachi install.",
			log: false,
			timeoutMs: 20000,
		});

		return {
			...scan,
			configurationMissing: config.missing,
			configurationReady: config.missing.length === 0,
		};
	}

	readLocalConfiguration() {
		// Merge blank templates and real config files into one UI-friendly shape.
		// Template values reveal available fields; real user values override them.
		const paths = this.getPaths();
		const envValues = {
			...parseDotEnv(paths.blankEnv),
			...parseDotEnv(paths.env),
		};
		const configValues = {
			...readJson(paths.blankConfig, {}),
			...readJson(paths.configJson, {}),
		};
		const displayConfigValues = normalizeConfigValuesForForm(configValues);
		const missing = [];

		// Missing lists are used to color dashboard/setup status indicators.
		for (const field of ENV_FIELDS) {
			if (isMissingValue(envValues[field])) {
				missing.push(field);
			}
		}

		for (const field of CONFIG_FIELDS) {
			if (isMissingValue(displayConfigValues[field])) {
				missing.push(field);
			}
		}

		return {
			exists: {
				env: fileExists(paths.env),
				config: fileExists(paths.configJson),
			},
			envProtection: envSecretProtectionMetadata(envValues),
			values: {
				...displayEnvValues(envValues),
				...displayConfigValues,
			},
			missing,
		};
	}

	readConfiguration() {
		return this.readLocalConfiguration();
	}

	async readActiveConfiguration() {
		if (this.getRuntimeTarget() === "remote") {
			return this.readRemoteConfiguration();
		}

		return this.readLocalConfiguration();
	}

	async readRemoteConfiguration() {
		const files = await this.readRemoteConfigurationFiles();
		const blankEnv = files["blank.env"] || "";
		const env = files[".env"] || "";
		const blankConfigText = files["config/blank.json"] || "";
		const configText = files["config/config.json"] || "";
		const envValues = {
			...parseDotEnvContent(blankEnv),
			...parseDotEnvContent(env),
		};
		const configValues = {
			...parseJsonText(blankConfigText, {}),
			...parseJsonText(configText, {}),
		};
		const displayConfigValues = normalizeConfigValuesForForm(configValues);
		const missing = [];

		for (const field of ENV_FIELDS) {
			if (isMissingValue(envValues[field])) {
				missing.push(field);
			}
		}

		for (const field of CONFIG_FIELDS) {
			if (isMissingValue(displayConfigValues[field])) {
				missing.push(field);
			}
		}

		return {
			exists: {
				env: Boolean(env.trim()),
				config: Boolean(configText.trim()),
			},
			envProtection: envSecretProtectionMetadata(envValues),
			source: "remote",
			values: {
				...displayEnvValues(envValues),
				...displayConfigValues,
			},
			missing,
		};
	}

	async writeConfiguration(values) {
		if (this.getRuntimeTarget() === "remote") {
			return this.writeRemoteConfiguration(values);
		}

		// Split the Setup form into the two files Hachi expects: .env for
		// secrets/client IDs and config/config.json for bot behavior settings.
		const paths = this.getPaths();
		ensureDir(paths.configDir);

		const rawEnv = this.readLocalEnvValues();
		const keyInfo = this.ensureLocalSecretsKey(rawEnv);
		const protectedEnv = this.buildProtectedEnvValues(values, rawEnv, keyInfo);
		const current = this.readLocalConfiguration().values;
		const merged = {
			...current,
			...values,
		};
		const mergedEnv = {
			...rawEnv,
			...protectedEnv,
		};

		const envLines = buildEnvLines(mergedEnv, rawEnv);
		const configValues = buildConfigValuesForSave(merged);

		fs.writeFileSync(paths.env, `${envLines.join("\n")}\n`, "utf8");
		fs.writeFileSync(paths.configJson, `${JSON.stringify(configValues, null, "\t")}\n`, "utf8");
		this.log(`Configuration saved. .env values are encrypted with ${displayPath(keyInfo.keyFilePath) || "a direct key"}.`);
		return this.readLocalConfiguration();
	}

	async writeRemoteConfiguration(values) {
		const files = await this.readRemoteConfigurationFiles();
		const blankEnvText = files["blank.env"] || "";
		const rawEnvText = files[".env"] || "";
		const blankConfigText = files["config/blank.json"] || "";
		const configText = files["config/config.json"] || "";
		const rawEnv = {
			...parseDotEnvContent(blankEnvText),
			...parseDotEnvContent(rawEnvText),
		};
		const currentConfig = {
			...parseJsonText(blankConfigText, {}),
			...parseJsonText(configText, {}),
		};
		const keyInfo = await this.ensureRemoteSecretsKey(rawEnv);
		const protectedEnv = this.buildProtectedEnvValues(values, rawEnv, keyInfo);
		const merged = {
			...currentConfig,
			...values,
		};
		const mergedEnv = {
			...rawEnv,
			...protectedEnv,
		};
		const envLines = buildEnvLines(mergedEnv, rawEnv);
		const configValues = buildConfigValuesForSave(merged);

		await this.writeRemoteText(".env", `${envLines.join("\n")}\n`);
		await this.writeRemoteText("config/config.json", `${JSON.stringify(configValues, null, "\t")}\n`);
		this.log(`Remote configuration saved. .env values are encrypted with ${keyInfo.keyFilePath || "a direct key"}.`);
		return this.readRemoteConfiguration();
	}

	updateStateMatchesRepository(repository) {
		const state = this.updateState || {};

		if (!state.checkedAt || state.status === "unchecked") {
			return true;
		}

		if (state.source && state.source !== this.getRuntimeTarget()) {
			return false;
		}

		if (state.installPath && state.installPath !== this.getActiveInstallIdentifier()) {
			return false;
		}

		const checkedRepository = state.repository || {};

		if (typeof checkedRepository.isGit === "boolean" && checkedRepository.isGit !== repository.isGit) {
			return false;
		}

		const checkedSource = checkedRepository.source || state.source;

		if (checkedSource && checkedSource !== repository.source) {
			return false;
		}

		const checkedBranch = checkedRepository.currentBranch || state.currentBranch;

		if (checkedBranch && repository.currentBranch && checkedBranch !== repository.currentBranch) {
			return false;
		}

		const checkedOrigin = checkedRepository.originUrl || state.originUrl;

		if (checkedOrigin && repository.originUrl && checkedOrigin !== repository.originUrl) {
			return false;
		}

		return true;
	}

	async getState() {
		// Build the complete state object consumed by renderer/app.js. This keeps
		// the renderer simple: it redraws from one object instead of coordinating
		// several backend calls itself.
		const repository = await this.getRepositoryInfo();

		if (!this.updateStateMatchesRepository(repository)) {
			this.updateState = createUncheckedUpdateState("Updates have not been checked for this install path yet.");
		}

		try {
			await this.refreshActiveStash();
		} catch {
			// If Git stash inspection fails, keep the older saved stash value
			// instead of breaking the whole Dashboard render.
			this.updateState.stash = this.settings.activeStash || null;
		}

		const scan = await this.getQuickScan();

		return {
			appName: "HachiGen",
			database: await this.getDatabaseState(),
			hachiGenUpdate: this.hachiGenUpdateState,
			hachiGenVersion: this.getHachiGenVersion(),
			installPath: this.getInstallPath(),
			repository,
			remote: this.getRemoteState(),
			runtimeTarget: this.getRuntimeTarget(),
			scan,
			updates: this.updateState,
			pm2: await this.getPm2Status(),
			recentEvents: this.logger.readRecentEvents(80),
			fleet: this.getFleetState(),
		};
	}

	async getDiagnostics() {
		const logs = this.logger.ensureLogs();
		const [scanResult, repositoryResult, pm2Result, databaseResult] = await Promise.allSettled([
			this.getQuickScan(),
			this.getRepositoryInfo({ log: false }),
			this.getPm2Status(),
			this.getDatabaseState(),
		]);
		const scan = scanResult.status === "fulfilled" ? scanResult.value : null;
		const repository = repositoryResult.status === "fulfilled" ? repositoryResult.value : null;
		const pm2 = pm2Result.status === "fulfilled" ? pm2Result.value : null;
		const database = databaseResult.status === "fulfilled" ? databaseResult.value : null;
		const crashText = readTextFile(logs.crash);
		const crashCount = (crashText.match(/\[CRASH\]/gu) || []).length;

		return {
			generatedAt: new Date().toISOString(),
			app: {
				hachiGenVersion: this.getHachiGenVersion(),
				node: process.versions.node,
				electron: process.versions.electron || "",
				platform: process.platform,
				arch: process.arch,
				pid: process.pid,
			},
			paths: {
				installPath: this.getInstallPath(),
				logFolder: logs.folder,
				settingsPath: this.settingsPath,
				userDataPath: this.userDataPath,
			},
			settings: summarizeSettings(this.settings),
			scan: scan ?
				summarizeScan(scan) :
				{
					error: scanResult.reason?.message || "Scan unavailable.",
				},
			repository: repository ?
				summarizeRepository(repository) :
				{
					error: repositoryResult.reason?.message || "Repository unavailable.",
				},
			pm2: pm2 ?
				{
					installed: Boolean(pm2.installed),
					message: pm2.message || "",
					pid: pm2.pid || null,
					registered: Boolean(pm2.registered),
					status: pm2.status || "unknown",
					target: pm2.target || this.getRuntimeTarget(),
				} :
				{
					error: pm2Result.reason?.message || "PM2 status unavailable.",
				},
			database: database ?
				{
					audit: database.audit ?
						{
							detail: database.audit.detail || "",
							label: database.audit.label || "",
							status: database.audit.status || "",
						} :
						null,
					exists: Boolean(database.exists),
					source: database.source || this.getRuntimeTarget(),
				} :
				{
					error: databaseResult.reason?.message || "Database status unavailable.",
				},
			updates: {
				hachi: summarizeUpdateState(this.updateState),
				hachiGen: summarizeUpdateState(this.hachiGenUpdateState),
			},
			recovery: {
				crashCount,
				crashLog: fileStatus(logs.crash),
				recentCrashEvents: this.logger.readRecentEvents(20, { includeHidden: true })
					.filter(event => event.area === "crash-handler" || event.area === "process-recovery"),
			},
		};
	}

	readLocalRuntimeLogFiles({ limit = DIAGNOSTIC_RUNTIME_LOG_LIMIT, maxBytes = DIAGNOSTIC_RUNTIME_LOG_MAX_BYTES } = {}) {
		const paths = this.getPaths();
		const result = {
			errors: [],
			exists: fileExists(paths.logs),
			files: [],
			folder: paths.logs,
		};

		if (!result.exists) {
			return result;
		}

		try {
			if (!fs.statSync(paths.logs).isDirectory()) {
				result.errors.push(`${displayPath(paths.logs)} exists but is not a directory.`);
				return result;
			}
		} catch (error) {
			result.errors.push(`Could not inspect ${displayPath(paths.logs)}: ${readableCause(error)}`);
			return result;
		}

		result.files = fs.readdirSync(paths.logs)
			.filter(file => /\.(log|txt)$/iu.test(file))
			.flatMap(file => {
				try {
					const fullPath = path.join(paths.logs, file);
					const stats = fs.statSync(fullPath);

					if (!stats.isFile()) {
						return [];
					}

					return [{
						file,
						fullPath,
						modified: stats.mtimeMs,
					}];
				} catch (error) {
					return [{
						error: readableCause(error),
						file,
						modified: 0,
					}];
				}
			})
			.sort((a, b) => b.modified - a.modified)
			.slice(0, limit)
			.map(file => file.error ?
				{
					error: file.error,
					name: file.file,
				} :
				{
					name: file.file,
					path: file.fullPath,
					...readTextFileTail(file.fullPath, maxBytes),
				});

		return result;
	}

	async readRemoteRuntimeLogFiles({
		limit = DIAGNOSTIC_RUNTIME_LOG_LIMIT,
		maxBytes = DIAGNOSTIC_RUNTIME_LOG_MAX_BYTES,
	} = {}) {
		const safeLimit = Math.max(1, Math.min(20, Number.parseInt(String(limit), 10) || DIAGNOSTIC_RUNTIME_LOG_LIMIT));
		const safeMaxBytes = Math.max(4096, Math.min(1024 * 1024, Number.parseInt(String(maxBytes), 10) || DIAGNOSTIC_RUNTIME_LOG_MAX_BYTES));
		const script = `
const fs = require("node:fs");
const path = require("node:path");
const logsDir = "logs";
const limit = ${JSON.stringify(safeLimit)};
const maxBytes = ${JSON.stringify(safeMaxBytes)};

function readTail(filePath, stats) {
	const start = Math.max(0, stats.size - maxBytes);
	const length = stats.size - start;
	const fd = fs.openSync(filePath, "r");

	try {
		const buffer = Buffer.alloc(length);
		fs.readSync(fd, buffer, 0, length, start);
		return {
			text: start > 0 ? buffer.toString("utf8").replace(/^[^\\n]*(?:\\r?\\n)?/u, "") : buffer.toString("utf8"),
			truncated: start > 0,
		};
	} finally {
		fs.closeSync(fd);
	}
}

const payload = {
	exists: fs.existsSync(logsDir),
	files: [],
};

if (payload.exists) {
	for (const entry of fs.readdirSync(logsDir, { withFileTypes: true })) {
		if (!entry.isFile() || !/\\.(log|txt)$/iu.test(entry.name)) {
			continue;
		}

		const filePath = path.join(logsDir, entry.name);

		try {
			const stats = fs.statSync(filePath);
			payload.files.push({
				modified: stats.mtimeMs,
				modifiedAt: stats.mtime.toISOString(),
				name: entry.name,
				size: stats.size,
				...readTail(filePath, stats),
			});
		} catch (error) {
			payload.files.push({
				error: error.message || String(error),
				modified: 0,
				name: entry.name,
				size: 0,
				text: "",
				truncated: false,
			});
		}
	}
}

payload.files = payload.files
	.sort((a, b) => b.modified - a.modified)
	.slice(0, limit);
process.stdout.write(JSON.stringify(payload));
`;

		return this.runRemoteHachiJson(`node -e ${quotePosix(script)}`, {
			fallbackMessage: "Remote Hachi logs did not return valid JSON.",
			timeoutMs: 45000,
		});
	}

	writeDiagnosticLogFile(baseFolder, relativeFolder, requestedName, text, details = {}) {
		const targetFolder = path.join(baseFolder, ...normalizeArchivePath(relativeFolder).split("/"));
		const requestedFileName = safeDiagnosticFileName(requestedName);
		const parsed = path.parse(requestedFileName);
		let fileName = requestedFileName;
		let targetPath = path.join(targetFolder, fileName);
		let counter = 2;

		ensureDir(targetFolder);

		while (fileExists(targetPath)) {
			fileName = `${parsed.name}-${counter}${parsed.ext}`;
			targetPath = path.join(targetFolder, fileName);
			counter += 1;
		}

		const redactedText = redactHachiGenLogText(text || "");
		fs.writeFileSync(targetPath, redactedText, "utf8");

		return {
			...details,
			bytes: Buffer.byteLength(redactedText, "utf8"),
			file: path.relative(baseFolder, targetPath).replace(/\\/gu, "/"),
		};
	}

	async writeRuntimeLogsToBundle(tempFolder) {
		// Diagnostics bundles keep HachiGen logs and managed Hachi runtime logs
		// separate so error reports can distinguish app failures from bot output.
		const target = this.getRuntimeTarget();
		const runtimeFolder = `logs/hachi-runtime/${target}`;
		const summary = {
			errors: [],
			files: [],
			target,
		};

		if (target === "remote") {
			summary.source = remoteConnectionLabel(this.getRemoteSettings());

			try {
				const pm2Text = await this.readRemoteLogs(DIAGNOSTIC_PM2_LOG_LINES);

				if (pm2Text) {
					summary.files.push(this.writeDiagnosticLogFile(tempFolder, runtimeFolder, "pm2-snapshot.log", pm2Text, {
						kind: "pm2",
						source: "remote",
					}));
				}
			} catch (error) {
				summary.errors.push(`Remote PM2 logs unavailable: ${readableCause(error)}`);
			}

			try {
				const remoteLogs = await this.readRemoteRuntimeLogFiles();
				summary.logFolder = remoteLogs.exists ? "logs" : "not found";

				for (const file of remoteLogs.files || []) {
					if (file.error) {
						summary.errors.push(`Remote log ${file.name}: ${redactHachiGenLogText(file.error)}`);
						continue;
					}

					summary.files.push(this.writeDiagnosticLogFile(tempFolder, runtimeFolder, file.name, file.text, {
						kind: "hachi-log",
						modifiedAt: file.modifiedAt || "",
						size: Number(file.size) || 0,
						source: "remote",
						truncated: Boolean(file.truncated),
					}));
				}
			} catch (error) {
				summary.errors.push(`Remote Hachi log files unavailable: ${readableCause(error)}`);
			}
		} else {
			const localLogs = this.readLocalRuntimeLogFiles();
			summary.logFolder = localLogs.folder;
			summary.source = this.getInstallPath();
			summary.errors.push(...localLogs.errors);

			for (const file of localLogs.files) {
				if (file.error) {
					summary.errors.push(`Local log ${file.name}: ${file.error}`);
					continue;
				}

				summary.files.push(this.writeDiagnosticLogFile(tempFolder, runtimeFolder, file.name, file.text, {
					kind: "hachi-log",
					modifiedAt: file.modifiedAt || "",
					size: Number(file.size) || 0,
					source: "local",
					truncated: Boolean(file.truncated),
				}));
			}

			try {
				const pm2Text = await this.readLocalPm2Snapshot(DIAGNOSTIC_PM2_LOG_LINES);

				if (pm2Text) {
					summary.files.push(this.writeDiagnosticLogFile(tempFolder, runtimeFolder, "pm2-snapshot.log", pm2Text, {
						kind: "pm2",
						source: "local",
					}));
				}
			} catch (error) {
				summary.errors.push(`Local PM2 logs unavailable: ${readableCause(error)}`);
			}
		}

		if (!summary.files.length && !summary.errors.length) {
			summary.files.push(this.writeDiagnosticLogFile(
				tempFolder,
				runtimeFolder,
				"no-runtime-logs-found.txt",
				`No Hachi runtime logs were found for the ${target} target.`,
				{
					kind: "notice",
					source: target,
				},
			));
		}

		return summary;
	}

	validateHachiGenUpdateFile(filePath, expectedBytes = 0) {
		return verifyHachiGenUpdateFile(filePath, expectedBytes);
	}

	async exportSupportBundle(targetPath) {
		if (!targetPath) {
			throw new Error("Choose where to save the diagnostics bundle.");
		}

		const resolvedTargetPath = path.resolve(targetPath);
		const stamp = supportBundleStamp();
		const tempFolder = path.join(this.userDataPath, "diagnostics-bundles", `hachigen-diagnostics-${stamp}`);
		const logPaths = this.logger.ensureLogs();

		if (fs.existsSync(tempFolder)) {
			fs.rmSync(tempFolder, { force: true, recursive: true });
		}

		ensureDir(tempFolder);

		try {
			const baseDiagnostics = await this.getDiagnostics();
			const runtimeLogs = await this.writeRuntimeLogsToBundle(tempFolder);
			const diagnostics = {
				...baseDiagnostics,
				runtimeLogs,
			};

			writeJsonFile(path.join(tempFolder, "diagnostics.json"), diagnostics);
			writeJsonFile(path.join(tempFolder, "settings-summary.json"), summarizeSettings(this.settings));
			writeJsonFile(path.join(tempFolder, "recent-events.json"), this.logger.readRecentEvents(200, { includeHidden: true }));
			fs.writeFileSync(path.join(tempFolder, "README.txt"), [
				"HachiGen diagnostics bundle",
				`Created: ${diagnostics.generatedAt}`,
				"",
				"This bundle contains redacted HachiGen diagnostics, recent HachiGen events, HachiGen logs, and Hachi runtime logs.",
				"Hachi runtime logs are capped to the newest files and latest log output so the archive stays readable.",
				"It does not include .env, config.json, database files, SSH keys, or decrypted secrets.",
				"",
			].join("\n"), "utf8");

			const logsFolder = path.join(tempFolder, "logs", "hachigen");
			ensureDir(logsFolder);

			for (const [label, sourcePath] of Object.entries({
				"crash.log": logPaths.crash,
				"raw.log": logPaths.raw,
				"structured.pretty.log": logPaths.structuredPretty,
			})) {
				if (fileExists(sourcePath)) {
					fs.writeFileSync(path.join(logsFolder, label), readTextFile(sourcePath), "utf8");
				}
			}

			ensureDir(path.dirname(resolvedTargetPath));

			if (!await this.logger.compressFolderToTarGz(tempFolder, resolvedTargetPath)) {
				throw new Error("Could not write diagnostics bundle archive.");
			}

			this.log(`Diagnostics bundle exported to ${displayPath(resolvedTargetPath)}.`);
			return {
				bundlePath: resolvedTargetPath,
				diagnostics,
				message: `Diagnostics bundle saved to ${path.basename(resolvedTargetPath)}.`,
				ok: true,
			};
		} finally {
			fs.rmSync(tempFolder, { force: true, recursive: true });
		}
	}

	runtimeArchiveDefaultPath() {
		return path.join(this.getRuntimeExportsDir(), `hachi-runtime-${runtimeArchiveStamp()}.tar.gz`);
	}

	resolveLocalSecretsKeyFile(value) {
		try {
			return this.loadSecretEncryption().resolveKeyFilePath(value, this.getInstallPath());
		} catch {
			return resolveLocalPath(value, this.getInstallPath());
		}
	}

	addExternalLocalKeyEntry(entries, rawEnv, { field, restoreKind, resolver }) {
		const configured = String(rawEnv[field] || "").trim();

		if (!configured) {
			return;
		}

		const keyPath = resolver(configured);

		if (!keyPath || !fileExists(keyPath) || isPathInside(this.getInstallPath(), keyPath)) {
			return;
		}

		const content = fs.readFileSync(keyPath);
		entries.push({
			bytes: content.length,
			content,
			restoreKind,
			sensitive: true,
			sha256: sha256Buffer(content),
			sourcePath: keyPath,
		});
	}

	async collectLocalRuntimeArchiveEntries() {
		const paths = this.getPaths();

		if (!fileExists(paths.root)) {
			throw new Error("The selected local Hachi folder does not exist.");
		}

		await this.checkpointDatabase();
		const entries = collectLocalProjectFiles(paths.root);
		const rawEnv = fileExists(paths.env) ? parseDotEnv(paths.env) : {};

		this.addExternalLocalKeyEntry(entries, rawEnv, {
			field: "HACHI_DB_KEY_FILE",
			restoreKind: "database-key",
			resolver: value => resolveLocalPath(value, paths.root),
		});
		this.addExternalLocalKeyEntry(entries, rawEnv, {
			field: "HACHI_SECRETS_KEY_FILE",
			restoreKind: "secrets-key",
			resolver: value => this.resolveLocalSecretsKeyFile(value),
		});

		return {
			entries,
			source: {
				path: paths.root,
				type: "local",
			},
			warnings: [],
		};
	}

	remoteRuntimeArchiveScript() {
		return `
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const excludedDirectories = new Set(${JSON.stringify([...RUNTIME_ARCHIVE_EXCLUDED_DIRECTORIES])});
const excludedFiles = new Set(${JSON.stringify([...RUNTIME_ARCHIVE_EXCLUDED_FILES])});
function normalizeArchivePath(value) {
	return String(value || "").replace(/\\\\/g, "/").replace(/^\\/+/, "");
}
function parseDotEnvContent(content) {
	const values = {};
	for (const line of String(content || "").split(/\\r?\\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const equalsIndex = trimmed.indexOf("=");
		if (equalsIndex === -1) {
			continue;
		}
		let value = trimmed.slice(equalsIndex + 1).trim();
		if (value.startsWith('"') && value.endsWith('"')) {
			try {
				value = JSON.parse(value);
			} catch {
				value = value.slice(1, -1);
			}
		} else if (value.startsWith("'") && value.endsWith("'")) {
			value = value.slice(1, -1);
		}
		values[trimmed.slice(0, equalsIndex).trim()] = value;
	}
	return values;
}
function resolveRemotePath(value) {
	const text = String(value || "").trim();
	if (!text) {
		return "";
	}
	if (text === "~") {
		return os.homedir();
	}
	if (text.startsWith("~/")) {
		return path.join(os.homedir(), text.slice(2));
	}
	return path.isAbsolute(text) ? text : path.resolve(process.cwd(), text);
}
function isInsideRoot(filePath) {
	const relative = path.relative(process.cwd(), filePath);
	return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function isSensitiveRuntimeArchivePath(relativePath) {
	const normalized = normalizeArchivePath(relativePath).toLowerCase();
	return normalized === ".env" ||
		normalized.endsWith(".key") ||
		normalized.includes("/keys/") ||
		normalized.startsWith("database/") ||
		normalized.startsWith("manager/backups/database/");
}
function sha256Buffer(buffer) {
	const hash = crypto.createHash("sha256");
	hash.update(buffer);
	return hash.digest("hex");
}
const files = [];
const warnings = [];
function addFile(filePath, restoreKind, restorePath) {
	try {
		const content = fs.readFileSync(filePath);
		files.push({
			bytes: content.length,
			content: content.toString("base64"),
			restoreKind,
			restorePath: restorePath ? normalizeArchivePath(restorePath) : "",
			sensitive: restoreKind !== "project" || isSensitiveRuntimeArchivePath(restorePath),
			sha256: sha256Buffer(content),
			sourcePath: filePath,
		});
	} catch (error) {
		warnings.push(\`Skipped \${filePath}: \${error.message || error}\`);
	}
}
function visit(directory) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!excludedDirectories.has(entry.name.toLowerCase())) {
				visit(path.join(directory, entry.name));
			}
			continue;
		}
		if (!entry.isFile() || excludedFiles.has(entry.name)) {
			continue;
		}
		const fullPath = path.join(directory, entry.name);
		addFile(fullPath, "project", path.relative(process.cwd(), fullPath));
	}
}
function addExternalKey(env, field, restoreKind) {
	const keyPath = resolveRemotePath(env[field]);
	if (!keyPath || !fs.existsSync(keyPath) || isInsideRoot(keyPath)) {
		return;
	}
	addFile(keyPath, restoreKind, "");
}
visit(process.cwd());
const env = parseDotEnvContent(fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "");
addExternalKey(env, "HACHI_DB_KEY_FILE", "database-key");
addExternalKey(env, "HACHI_SECRETS_KEY_FILE", "secrets-key");
process.stdout.write(JSON.stringify({
	files,
	ok: true,
	path: process.cwd(),
	warnings,
}));
`;
	}

	async collectRemoteRuntimeArchiveEntries() {
		await this.checkpointDatabase();
		const remote = await this.requireRemoteRuntime();
		const result = await this.runRemoteHachiJson(`node -e ${quotePosix(this.remoteRuntimeArchiveScript())}`, {
			fallbackMessage: "Remote runtime export did not return valid JSON.",
			log: false,
			timeoutMs: 600000,
		});

		if (!result.ok) {
			throw new Error(result.error || "Remote runtime export failed.");
		}

		return {
			entries: (result.files || []).map(file => ({
				bytes: Number(file.bytes) || 0,
				content: Buffer.from(String(file.content || ""), "base64"),
				restoreKind: file.restoreKind,
				restorePath: file.restorePath || "",
				sensitive: Boolean(file.sensitive),
				sha256: file.sha256 || "",
				sourcePath: file.sourcePath || "",
			})),
			source: {
				host: remote.host,
				path: result.path || remote.remotePath,
				type: "remote",
			},
			warnings: Array.isArray(result.warnings) ? result.warnings : [],
		};
	}

	writeRuntimeArchivePayload(stagingFolder, entry, index) {
		const archivePath = `payload/${String(index + 1).padStart(6, "0")}.bin`;
		const payloadPath = path.join(stagingFolder, archivePath);
		const content = Buffer.from(entry.content || "");

		ensureDir(path.dirname(payloadPath));
		fs.writeFileSync(payloadPath, content);

		return {
			archivePath,
			bytes: content.length,
			restoreKind: entry.restoreKind,
			restorePath: entry.restoreKind === "project" ? assertSafeRelativeArchivePath(entry.restorePath, "restore path") : "",
			sensitive: Boolean(entry.sensitive),
			sha256: sha256Buffer(content),
			sourcePath: entry.sourcePath || "",
		};
	}

	async exportRuntimeArchive({ source = this.getRuntimeTarget(), targetPath = this.runtimeArchiveDefaultPath() } = {}) {
		const archiveSource = source === "remote" ? "remote" : "local";
		const collected = archiveSource === "remote" ?
			await this.collectRemoteRuntimeArchiveEntries() :
			await this.collectLocalRuntimeArchiveEntries();

		if (!collected.entries.length) {
			throw new Error("No runtime files were found to export.");
		}

		const resolvedTargetPath = path.resolve(targetPath);
		const stagingFolder = path.join(this.userDataPath, "runtime-archives", `hachi-runtime-${runtimeArchiveStamp()}`);

		if (fs.existsSync(stagingFolder)) {
			fs.rmSync(stagingFolder, { force: true, recursive: true });
		}

		ensureDir(stagingFolder);
		ensureDir(path.dirname(resolvedTargetPath));

		try {
			const manifestEntries = collected.entries.map((entry, index) => this.writeRuntimeArchivePayload(stagingFolder, entry, index));
			const manifest = {
				app: {
					hachiGenVersion: this.getHachiGenVersion(),
				},
				createdAt: new Date().toISOString(),
				entries: manifestEntries,
				format: RUNTIME_ARCHIVE_FORMAT,
				includesSecrets: manifestEntries.some(entry => entry.sensitive),
				source: collected.source,
				warnings: collected.warnings,
			};

			writeJsonFile(path.join(stagingFolder, "manifest.json"), manifest);

			if (!await this.logger.compressFolderToTarGz(stagingFolder, resolvedTargetPath)) {
				throw new Error("Could not write runtime archive.");
			}

			this.log(`Runtime archive exported to ${displayPath(resolvedTargetPath)}.`);
			return {
				archivePath: resolvedTargetPath,
				fileCount: manifestEntries.length,
				includesSecrets: manifest.includesSecrets,
				message: `Runtime archive saved to ${displayPath(resolvedTargetPath, this.getInstallPath())}.`,
				ok: true,
				source: collected.source,
				warnings: collected.warnings,
			};
		} finally {
			fs.rmSync(stagingFolder, { force: true, recursive: true });
		}
	}

	previewRuntimeArchive(archivePath) {
		const resolvedArchivePath = path.resolve(String(archivePath || ""));

		if (!fileExists(resolvedArchivePath)) {
			throw new Error("Choose an existing runtime archive.");
		}

		const { manifest } = readRuntimeArchiveManifest(resolvedArchivePath);
		const projectFiles = manifest.entries.filter(entry => entry.restoreKind === "project");
		const keyFiles = manifest.entries.filter(entry => entry.restoreKind !== "project");

		return {
			archivePath: resolvedArchivePath,
			createdAt: manifest.createdAt || "",
			fileCount: manifest.entries.length,
			includesSecrets: Boolean(manifest.includesSecrets),
			keyFileCount: keyFiles.length,
			message: `Runtime archive contains ${manifest.entries.length} files.`,
			ok: true,
			projectFileCount: projectFiles.length,
			source: manifest.source || null,
			warnings: manifest.warnings || [],
		};
	}

	backupExistingRuntimeRestoreTarget(targetPath, backupPath, copied, seen) {
		const resolvedTarget = path.resolve(targetPath);

		if (seen.has(resolvedTarget) || !fileExists(resolvedTarget)) {
			return;
		}

		seen.add(resolvedTarget);
		ensureDir(path.dirname(backupPath));
		fs.copyFileSync(resolvedTarget, backupPath);
		copied.push(backupPath);
	}

	runtimeArchiveRestoreTarget(entry) {
		if (entry.restoreKind === "database-key") {
			return {
				envUpdates: {
					HACHI_DB_KEY: "",
					HACHI_DB_KEY_FILE: this.getLocalDatabaseKeyLocation().path,
				},
				targetPath: this.getLocalDatabaseKeyLocation().path,
			};
		}

		if (entry.restoreKind === "secrets-key") {
			return {
				envUpdates: {
					HACHI_SECRETS_KEY: "",
					HACHI_SECRETS_KEY_FILE: this.getLocalSecretsKeyLocation().path,
				},
				targetPath: this.getLocalSecretsKeyLocation().path,
			};
		}

		const targetPath = path.resolve(this.getInstallPath(), entry.restorePath);

		if (!isPathInside(this.getInstallPath(), targetPath)) {
			throw new Error(`Runtime archive restore path escapes the Hachi folder: ${entry.restorePath}.`);
		}

		return {
			envUpdates: {},
			targetPath,
		};
	}

	async restoreRuntimeArchive(archivePath) {
		const resolvedArchivePath = path.resolve(String(archivePath || ""));
		const { entries, manifest } = readRuntimeArchiveManifest(resolvedArchivePath);
		const root = this.getInstallPath();
		const backupDir = path.join(root, "manager", "backups", `runtime-restore-${timestampFolderName()}`);
		const copiedBackups = [];
		const backupSeen = new Set();
		const restoredPaths = new Set();
		const envUpdates = {};

		if (!fileExists(root)) {
			ensureDir(root);
		}

		if (manifest.entries.some(entry => entry.restoreKind === "project" && entry.restorePath === "database/database.sqlite") && this.getRuntimeTarget() === "local") {
			await this.checkpointDatabase();
		}

		for (const entry of manifest.entries) {
			const content = entries.get(entry.archivePath);
			const restoreTarget = this.runtimeArchiveRestoreTarget(entry);
			const backupRelativePath = entry.restoreKind === "project" ?
				path.join("project", ...entry.restorePath.split("/")) :
				path.join("keys", `${entry.restoreKind}-${path.basename(restoreTarget.targetPath)}`);

			this.backupExistingRuntimeRestoreTarget(
				restoreTarget.targetPath,
				path.join(backupDir, backupRelativePath),
				copiedBackups,
				backupSeen,
			);

			ensureDir(path.dirname(restoreTarget.targetPath));
			fs.writeFileSync(restoreTarget.targetPath, content);

			if (entry.restoreKind !== "project") {
				try {
					fs.chmodSync(path.dirname(restoreTarget.targetPath), 0o700);
					fs.chmodSync(restoreTarget.targetPath, 0o600);
				} catch {
					// Windows ACLs may not map cleanly to POSIX modes.
				}
			}

			Object.assign(envUpdates, restoreTarget.envUpdates);

			if (entry.restoreKind === "project") {
				restoredPaths.add(entry.restorePath);
			}
		}

		const envPath = path.join(root, ".env");

		if (Object.keys(envUpdates).length && fileExists(envPath)) {
			this.backupExistingRuntimeRestoreTarget(
				envPath,
				path.join(backupDir, "project", ".env"),
				copiedBackups,
				backupSeen,
			);
			fs.writeFileSync(envPath, updateDotEnvContent(fs.readFileSync(envPath, "utf8"), envUpdates), "utf8");
		}

		if (restoredPaths.has("database/database.sqlite")) {
			for (const sidecar of ["database/database.sqlite-wal", "database/database.sqlite-shm"]) {
				if (restoredPaths.has(sidecar)) {
					continue;
				}

				const sidecarPath = path.join(root, ...sidecar.split("/"));

				this.backupExistingRuntimeRestoreTarget(
					sidecarPath,
					path.join(backupDir, "project", ...sidecar.split("/")),
					copiedBackups,
					backupSeen,
				);

				if (fileExists(sidecarPath)) {
					fs.rmSync(sidecarPath, { force: true });
				}
			}
		}

		this.log(`Runtime archive restored from ${displayPath(resolvedArchivePath)}.`);
		return {
			archivePath: resolvedArchivePath,
			backupDir: copiedBackups.length ? backupDir : "",
			fileCount: manifest.entries.length,
			message: `Runtime archive restored ${manifest.entries.length} files.${copiedBackups.length ? ` Safety backup: ${displayPath(backupDir, root)}.` : ""}`,
			ok: true,
			source: manifest.source || null,
		};
	}

	async installWithWinget(packageId, label) {
		// Install a missing system tool with winget. This is only called from
		// repair flows, so passive checks never install software unexpectedly.
		const hasWinget = await commandExists("winget");

		if (!hasWinget) {
			throw new Error(`${label} is missing and winget is not available. Install ${label} manually, then try again.`);
		}

		this.log(`${label} is missing. Installing with winget...`);
		await run("winget", [
			"install",
			packageId,
			"-e",
			"--accept-package-agreements",
			"--accept-source-agreements",
		], {
			timeoutMs: 900000,
			onLog: entry => this.logShell(entry),
		});
	}

	async ensureNodeAndNpm(installMissing) {
		// Ensure Node.js and npm are available. installMissing decides whether
		// HachiGen only reports a problem or tries to install Node.js via winget.
		let hasNode = await commandExists("node");
		let hasNpm = await commandExists("npm");

		if ((!hasNode || !hasNpm) && installMissing) {
			await this.installWithWinget("OpenJS.NodeJS", "Node.js");
			hasNode = await commandExists("node");
			hasNpm = await commandExists("npm");
		}

		if (!hasNode || !hasNpm) {
			throw new Error("Node.js and npm are required for Hachi.");
		}

		// Returning versions gives the UI/logs something concrete to display.
		const nodeVersion = await run("node", ["--version"], {
			allowFailure: true,
			onLog: entry => this.logShell(entry),
		});

		if (nodeVersion.code !== 0) {
			throw new Error(failedToolVersionMessage("node", nodeVersion));
		}

		if (!nodeVersionMeetsMinimum(nodeVersion.stdout)) {
			const found = nodeVersion.stdout.trim() || "unknown";
			throw new Error(`Node.js ${MIN_NODE_VERSION.label} or newer is required for Hachi dependencies. Found ${found}.`);
		}

		const npmVersion = await run("npm", ["--version"], {
			allowFailure: true,
			onLog: entry => this.logShell(entry),
		});

		if (npmVersion.code !== 0 || !npmVersion.stdout.trim()) {
			throw new Error(failedToolVersionMessage("npm", npmVersion));
		}

		return {
			node: nodeVersion.stdout.trim(),
			npm: npmVersion.stdout.trim(),
		};
	}

	async ensureGit(installMissing) {
		// Ensure Git is available for clone/update actions. Existing non-Git
		// installs can still be inspected, but updates need Git.
		let hasGit = await commandExists("git");

		if (!hasGit && installMissing) {
			await this.installWithWinget("Git.Git", "Git");
			hasGit = await commandExists("git");
		}

		if (!hasGit) {
			throw new Error("Git is required for install and update actions.");
		}

		const version = await run("git", ["--version"], {
			allowFailure: true,
			onLog: entry => this.logShell(entry),
		});

		return version.stdout.trim();
	}

	async ensurePm2(installMissing) {
		// Ensure PM2 is available because it owns the long-running Hachi process
		// after HachiGen closes.
		let hasPm2 = await commandExists("pm2");

		if (!hasPm2 && installMissing) {
			await this.ensureNodeAndNpm(true);
			this.log("PM2 is missing. Installing globally with npm...");
			try {
				await run("npm", ["install", "-g", "pm2"], {
					timeoutMs: 900000,
					onLog: entry => this.logShell(entry),
				});
			} catch (error) {
				throw errorWithContext("Could not install PM2 with npm", error);
			}
			hasPm2 = await commandExists("pm2");
		}

		if (!hasPm2) {
			throw new Error("PM2 is required to run Hachi in the background.");
		}

		return true;
	}

	async installRepositoryIfNeeded() {
		// Clone Hachi only when the selected folder is empty or missing. Existing
		// Hachi installs are left alone; non-empty unrelated folders are rejected.
		const paths = this.getPaths();

		if (this.isProjectFolder()) {
			return false;
		}

		if (!this.isEmptyDirectory(paths.root)) {
			throw new Error("The selected install path is not empty and does not look like a Hachi folder.");
		}

		await this.ensureGit(true);
		ensureDir(path.dirname(paths.root));
		this.log(`Cloning Hachi into ${paths.root}`);
		await run("git", ["clone", REPO_URL, paths.root], {
			timeoutMs: 900000,
			onLog: entry => this.logShell(entry),
		});
		return true;
	}

	async ensureNpmDependencies() {
		// Install Hachi's package dependencies into the selected install folder.
		// This is called during validation/start and after updates.
		if (!this.isProjectFolder()) {
			throw new Error("Hachi is not installed in the selected folder.");
		}

		try {
			await this.ensureNodeAndNpm(true);
		} catch (error) {
			throw errorWithContext("Could not prepare Node.js and npm for Hachi dependencies", error);
		}

		this.log("Installing Hachi npm dependencies...");
		try {
			await run("npm", ["install"], {
				cwd: this.getInstallPath(),
				timeoutMs: 900000,
				onLog: entry => this.logShell(entry),
			});
		} catch (error) {
			throw errorWithContext(`Could not install Hachi npm dependencies in ${displayPath(this.getInstallPath()) || "the selected install folder"}`, error);
		}
	}

	async runConfigValidation() {
		// Reuse Hachi's existing configCheck.js so command-line validation and
		// HachiGen validation stay in sync.
		await this.ensureNodeAndNpm(false);
		this.log("Running Hachi configuration validation...");
		await run("node", ["-e", "require('./config/configCheck.js')"], {
			cwd: this.getInstallPath(),
			timeoutMs: 120000,
			onLog: entry => this.logShell(entry),
		});
		return true;
	}

	async installOrValidate() {
		if (this.getRuntimeTarget() === "remote") {
			return this.validateInstall({ repair: true });
		}

		// Handle the Setup page's Install / Validate button. It creates or clones
		// the install when needed, then runs the repair-capable validation path.
		await this.installRepositoryIfNeeded();
		return this.validateInstall({ repair: true });
	}

	async validateInstall({ repair = false } = {}) {
		if (this.getRuntimeTarget() === "remote") {
			return this.validateRemoteInstall({ repair });
		}

		// Validate the selected install. repair=false only reports problems;
		// repair=true is allowed to create folders, clone, install deps, and PM2.
		this.log(repair ? "Validating and repairing Hachi install..." : "Validating Hachi install...");

		const paths = this.getPaths();

		if (!fileExists(paths.root)) {
			ensureDir(paths.root);
		}

		if (repair) {
			await this.installRepositoryIfNeeded();
		}

		if (!this.isProjectFolder()) {
			const scan = this.quickScan();
			return {
				ok: false,
				message: "The selected path does not contain a complete Hachi install.",
				scan,
			};
		}

		const prerequisites = {};

		// Each prerequisite is checked in order so the log reads like a checklist.
		prerequisites.node = await this.ensureNodeAndNpm(repair);

		if (fileExists(paths.git)) {
			prerequisites.git = await this.ensureGit(repair);
		}

		const dependencyScan = this.quickScan();

		if (!dependencyScan.hasNodeModules || !dependencyScan.dependenciesReady) {
			await this.ensureNpmDependencies();
		} else {
			this.log("Hachi npm dependencies found.");
		}

		if (repair) {
			await this.ensurePm2(true);
			await this.prepareSecretProtection();
			const protectionSetup = await this.prepareDatabaseProtection();

			if (protectionSetup.protection?.databaseFile?.status === "plaintext") {
				await this.convertDatabaseEncryption();
			}
		}

		let configOk = false;
		let configMessage = "Configuration was not checked.";

		try {
			// Validation errors are not fatal here; they become a clear status
			// message that the Setup page can show to the user.
			await this.runConfigValidation();
			configOk = true;
			configMessage = "Configuration is valid.";
		} catch (error) {
			configMessage = error.stderr || error.message;
		}

		const scan = this.quickScan();
		const ok = scan.projectFound && scan.hasNodeModules && scan.dependenciesReady && configOk;

		return {
			ok,
			message: ok ? "Hachi install is ready." : "Hachi install needs attention.",
			scan,
			prerequisites,
			config: {
				ok: configOk,
				message: configMessage,
			},
		};
	}

	async validateRemoteInstall({ repair = false } = {}) {
		this.log(repair ? "Validating and repairing remote Hachi install..." : "Validating remote Hachi install...");
		const scan = await this.remoteQuickScan();

		if (!scan.projectFound) {
			return {
				ok: false,
				message: "The remote path does not contain a complete Hachi install.",
				scan,
			};
		}

		const nodeResult = await this.runRemoteHachiCommand("node --version", {
			allowFailure: true,
			timeoutMs: 30000,
		});
		const remoteNodeVersion = nodeResult.stdout.trim();

		if (nodeResult.code !== 0 || !nodeVersionMeetsMinimum(remoteNodeVersion)) {
			const message = `Remote Node.js ${MIN_NODE_VERSION.label} or newer is required for Hachi dependencies. Found ${remoteNodeVersion || "missing"}.`;

			return {
				ok: false,
				message,
				scan,
				config: {
					ok: false,
					message,
				},
				prerequisites: {
					node: remoteNodeVersion || "missing",
				},
			};
		}

		if (repair && (!scan.hasNodeModules || !scan.dependenciesReady)) {
			this.log("Installing remote Hachi npm dependencies...");
			await this.runRemoteHachiCommand("npm install", {
				timeoutMs: 900000,
			});
		}

		if (repair) {
			await this.prepareSecretProtection();
			const protectionSetup = await this.prepareDatabaseProtection();

			if (protectionSetup.protection?.databaseFile?.status === "plaintext") {
				await this.convertDatabaseEncryption();
			}
		}

		const configResult = await this.runRemoteHachiCommand(`node -e ${quotePosix("require('./config/configCheck.js')")}`, {
			allowFailure: true,
			timeoutMs: 120000,
		});
		const refreshedScan = await this.remoteQuickScan();
		const configOk = configResult.code === 0;
		const ok = refreshedScan.projectFound && refreshedScan.hasNodeModules && refreshedScan.dependenciesReady && configOk;

		return {
			ok,
			message: ok ? "Remote Hachi install is ready." : "Remote Hachi install needs attention.",
			scan: refreshedScan,
			config: {
				ok: configOk,
				message: configOk ? "Configuration is valid." : configResult.stderr || configResult.stdout || "Remote configuration validation failed.",
			},
		};
	}

	async getLocalChanges({ log = true } = {}) {
		// Return raw Git porcelain lines for files changed locally. HachiGen
		// shows these before updating so generated or edited files are visible.
		const paths = this.getPaths();

		if (this.getRuntimeTarget() === "remote" && !await this.remotePathExists(".git", "d")) {
			return [];
		}

		if (this.getRuntimeTarget() !== "remote" && !fileExists(paths.git)) {
			return [];
		}

		const result = await this.runGit(["status", "--porcelain=v1", "-uall"], {
			allowFailure: true,
			log,
		});

		// Raw lines are parsed later so the UI can show both grouped labels and
		// the original Git-style status if needed. Do not trim each line here:
		// Git porcelain status uses leading spaces as part of its two-character
		// status code, such as " M .gitignore" for a modified unstaged file.
		return result.stdout
			.split(/\r?\n/)
			.filter(line => line.trim());
	}

	async getRepositoryInfo({ onLog = null, log = Boolean(onLog) } = {}) {
		const paths = this.getPaths();
		const isRemote = this.getRuntimeTarget() === "remote";
		const info = {
			isGit: isRemote ? await this.remotePathExists(".git", "d") : fileExists(paths.git),
			currentBranch: null,
			originUrl: null,
			updateRemote: UPDATE_REMOTE,
			updateBranch: UPDATE_BRANCH,
			updateTarget: UPDATE_TARGET,
			source: isRemote ? "remote" : "local",
		};

		if (!info.isGit) {
			return info;
		}

		const runGit = async args => {
			try {
				const result = await this.runGit(args, {
					allowFailure: true,
					log,
					onLog: onLog || undefined,
				});

				return result.code === 0 ? result.stdout.trim() : "";
			} catch {
				return "";
			}
		};

		info.currentBranch = await runGit(["branch", "--show-current"]);
		info.originUrl = await runGit(["remote", "get-url", UPDATE_REMOTE]);

		if (!info.currentBranch) {
			const shortHead = await runGit(["rev-parse", "--short", "HEAD"]);
			info.currentBranch = shortHead ? `detached:${shortHead}` : null;
		}

		return info;
	}

	async getIncomingCommits() {
		// Return commits on the update target that are not present locally, giving the
		// Updates panel a concrete list of incoming work.
		const result = await this.runGit(["log", "--oneline", "--no-decorate", `HEAD..${UPDATE_TARGET}`], {
			allowFailure: true,
		});

		return result.stdout
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(Boolean)
			.map(parseIncomingCommit);
	}

	async getHachiGenStashes({ log = false } = {}) {
		// Return only auto-stashes created by HachiGen. User-created stashes are
		// intentionally ignored so Restore/Delete buttons cannot touch them.
		const paths = this.getPaths();

		if (this.getRuntimeTarget() === "remote" && !await this.remotePathExists(".git", "d")) {
			return [];
		}

		if (this.getRuntimeTarget() !== "remote" && !fileExists(paths.git)) {
			return [];
		}

		const result = await this.runGit(["stash", "list", "--format=%H%x09%gd%x09%ct%x09%gs"], {
			allowFailure: true,
			log,
		});

		if (result.code !== 0) {
			return [];
		}

		return result.stdout
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(Boolean)
			.map(parseStashLine)
			.filter(stash => stash.message.includes(HACHIGEN_STASH_PREFIX));
	}

	async getStashChanges(stashRef, { log = false } = {}) {
		// Read the file list inside a stash. Git versions differ on untracked
		// stash display, so this tries the richer command and falls back safely.
		const commands = [
			["stash", "show", "--name-status", "--include-untracked", stashRef],
			["stash", "show", "--name-status", stashRef],
		];

		for (const args of commands) {
			const result = await this.runGit(args, {
				allowFailure: true,
				log,
			});

			if (result.code === 0) {
				return result.stdout
					.split(/\r?\n/)
					.map(line => line.trim())
					.filter(Boolean)
					.map(describeNameStatus);
			}
		}

		return [];
	}

	async refreshActiveStash(options = {}) {
		// Synchronize settings.activeStash with the real Git stash list. This is
		// why Restore/Delete buttons update correctly if a stash is removed by Git
		// or another tool outside HachiGen.
		const stashes = await this.getHachiGenStashes(options);
		const savedHash = this.settings.activeStash?.hash;
		const activeStashBase = stashes.find(stash => stash.hash === savedHash) || stashes[0] || null;
		const activeStash = activeStashBase ?
			{
				...activeStashBase,
				changes: await this.getStashChanges(activeStashBase.ref, options),
			} :
			null;

		if (activeStash) {
			activeStash.changeSummary = summarizeLocalChanges(activeStash.changes);
		}

		if (activeStash?.hash !== this.settings.activeStash?.hash) {
			this.settings.activeStash = activeStash;
			this.saveSettings();
		}

		this.updateState.stash = activeStash;
		this.updateState.stashes = stashes;
		return activeStash;
	}

	async createAutoStash() {
		// Save local work before an update. The -u flag includes untracked files,
		// which are the "??" entries shown in Git status.
		const message = `${HACHIGEN_STASH_PREFIX} ${new Date().toISOString()}`;

		this.log(`Saving ${this.getRuntimeTarget()} changes to a recoverable Git stash...`);
		await this.runGit(["stash", "push", "-u", "-m", message], {
			timeoutMs: 300000,
		});

		const stashes = await this.getHachiGenStashes();
		const activeStash = stashes.find(stash => stash.message === message) || stashes[0] || null;
		this.settings.activeStash = activeStash;
		this.saveSettings();

		const enrichedStash = await this.refreshActiveStash();
		this.updateState.stash = enrichedStash;
		this.updateState.stashes = stashes;
		return enrichedStash;
	}

	async checkUpdates() {
		if (this.checkUpdatesPromise) {
			return this.checkUpdatesPromise;
		}

		this.checkUpdatesPromise = this.performUpdateCheck();

		try {
			return await this.checkUpdatesPromise;
		} finally {
			this.checkUpdatesPromise = null;
		}
	}

	async checkVersionUpdates() {
		// Help -> Check for Updates is intentionally a version comparison. The
		// Updates page can still run the deeper commit/worktree check before
		// applying changes.
		const paths = this.getPaths();
		const scan = await this.getQuickScan();
		const currentVersion = scan.packageVersion || readJson(paths.packageJson, {}).version || "";
		const repository = await this.getRepositoryInfo({ onLog: entry => this.logShell(entry) });

		if (!repository.isGit) {
			return {
				currentVersion,
				message: "This install is not a Git checkout, so HachiGen cannot compare versions with the repo.",
				ok: false,
				repositoryVersion: "",
				updateAvailable: false,
			};
		}

		this.log(`${this.getRuntimeTarget() === "remote" ? "Remote" : "Local"}: checking Hachi version against ${UPDATE_TARGET}...`);
		await this.runGit(["fetch", UPDATE_REMOTE, UPDATE_BRANCH], {
			timeoutMs: 300000,
		});

		const remotePackageResult = await this.runGit(["show", `${UPDATE_TARGET}:package.json`], {
			allowFailure: true,
		});

		if (remotePackageResult.code !== 0) {
			throw new Error(remotePackageResult.stderr || `Could not read package.json from ${UPDATE_TARGET}.`);
		}

		const repositoryPackage = parseJsonText(remotePackageResult.stdout, {});
		const repositoryVersion = repositoryPackage.version || "";

		if (!currentVersion || !repositoryVersion) {
			throw new Error(`Could not compare versions. Current: ${currentVersion || "unknown"}, repo: ${repositoryVersion || "unknown"}.`);
		}

		const comparison = comparePackageVersions(repositoryVersion, currentVersion);
		const updateAvailable = comparison > 0;
		const message = updateAvailable ?
			`Hachi ${repositoryVersion} is available. Current version is ${currentVersion}.` :
			comparison === 0 ?
				`Hachi is current at ${currentVersion}.` :
				`Current version ${currentVersion} is newer than ${UPDATE_TARGET} (${repositoryVersion}).`;

		this.log(`Version check complete. ${message}`);

		return {
			currentBranch: repository.currentBranch,
			currentVersion,
			message,
			ok: true,
			repositoryVersion,
			updateAvailable,
			updateTarget: UPDATE_TARGET,
		};
	}

	async fetchLatestHachiGenRelease() {
		// HachiGen is distributed as its own release track. The repo can also
		// contain Hachi bot releases, so filter to hachigen-v* tags before
		// selecting the newest manager build.
		const releases = await requestJson(HACHIGEN_RELEASE_API);
		const matchingReleases = Array.isArray(releases) ?
			releases.filter(release => {
				const tag = String(release?.tag_name || "");
				return !release?.draft && /^hachigen-v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(tag);
			}) :
			[];
		const stableReleases = matchingReleases.filter(release => !release.prerelease);
		const candidates = stableReleases.length ? stableReleases : matchingReleases;
		const release = candidates.sort((left, right) => compareHachiGenReleases(right, left))[0];

		if (!release) {
			return {
				assetName: null,
				assetSize: 0,
				assetUrl: null,
				latestTag: "",
				publishedAt: null,
				releaseName: "No HachiGen release",
				releaseUrl: HACHIGEN_RELEASES_URL,
				unavailableReason: "No HachiGen releases were found. Publish a hachigen-v* release that includes HachiGen.exe.",
			};
		}

		const asset = (release.assets || []).find(item => item.name === HACHIGEN_ASSET_NAME);

		if (!asset?.browser_download_url) {
			const latestTag = release.tag_name || "";

			return {
				assetName: HACHIGEN_ASSET_NAME,
				assetSize: 0,
				assetUrl: null,
				latestTag,
				publishedAt: release.published_at || null,
				releaseName: release.name || latestTag || "Latest HachiGen release",
				releaseUrl: release.html_url || HACHIGEN_RELEASES_URL,
				unavailableReason: `Latest HachiGen release${latestTag ? ` ${latestTag}` : ""} does not include ${HACHIGEN_ASSET_NAME}.`,
			};
		}

		return {
			assetName: asset.name,
			assetSize: asset.size || 0,
			assetUrl: asset.browser_download_url,
			latestTag: release.tag_name || "",
			publishedAt: release.published_at || null,
			releaseName: release.name || release.tag_name || "Latest release",
			releaseUrl: release.html_url || HACHIGEN_RELEASES_URL,
		};
	}

	async checkHachiGenUpdates() {
		const checkedAt = new Date().toISOString();

		try {
			const latest = await this.fetchLatestHachiGenRelease();
			const savedTag = this.settings.hachiGenReleaseTag || null;
			let currentTag = String(savedTag || "").startsWith(HACHIGEN_RELEASE_TAG_PREFIX) ? savedTag : null;
			const currentVersion = this.getHachiGenVersion();

			if (!latest.assetUrl) {
				const message = latest.unavailableReason || `No ${HACHIGEN_ASSET_NAME} asset is available from the latest HachiGen release.`;

				this.hachiGenUpdateState = {
					...latest,
					canInstall: false,
					checkedAt,
					currentTag,
					currentVersion,
					message,
					status: "unavailable",
					updateAvailable: false,
				};
				this.log(`HachiGen update check complete. ${message}`);
				return this.hachiGenUpdateState;
			}

			const latestVersion = hachiGenReleaseVersion(latest.latestTag);
			const updateAvailable = latestVersion && currentVersion ?
				comparePackageVersions(latestVersion, currentVersion) > 0 :
				(currentTag ? currentTag !== latest.latestTag : true);
			const versionLabel = latestVersion || latest.latestTag || "Unknown";
			const message = updateAvailable ?
				`Updates are available: Version ${versionLabel}` :
				"HachiGen is up to date.";

			if (!updateAvailable && latest.latestTag && currentTag !== latest.latestTag) {
				currentTag = latest.latestTag;
				this.settings.hachiGenReleaseTag = latest.latestTag;
				this.saveSettings();
			}

			this.hachiGenUpdateState = {
				...latest,
				canInstall: updateAvailable && Boolean(latest.assetUrl),
				checkedAt,
				currentTag,
				currentVersion,
				message,
				status: updateAvailable ? "available" : "current",
				updateAvailable,
			};
			this.log(`HachiGen update check complete. ${message}`);
			return this.hachiGenUpdateState;
		} catch (error) {
			this.hachiGenUpdateState = {
				...createUncheckedHachiGenUpdateState(error.message || "HachiGen update check failed."),
				checkedAt,
				currentVersion: this.getHachiGenVersion(),
				status: "error",
			};
			this.event("error", `HachiGen update check failed: ${error.message || error}`);
			throw error;
		}
	}

	async downloadHachiGenUpdate(targetPath, updateState = null, options = {}) {
		// Download only the release asset the checker selected. The main process
		// decides whether to install it, open it, or hand the path to the user.
		const update = updateState?.assetUrl ? updateState : await this.checkHachiGenUpdates();

		if (!update.assetUrl) {
			throw new Error("No HachiGen release asset is available to download.");
		}

		const result = await downloadUrlToFile(update.assetUrl, targetPath, {
			onProgress: options.onProgress,
		});
		const verification = this.validateHachiGenUpdateFile(targetPath, result.bytes);
		this.log(`Downloaded and verified ${HACHIGEN_ASSET_NAME} update to ${displayPath(targetPath)}. SHA-256: ${verification.sha256}.`);

		return {
			...update,
			bytes: result.bytes,
			verification,
			targetPath,
		};
	}

	markHachiGenReleaseInstalled(tag) {
		if (!tag) {
			return;
		}

		this.settings.hachiGenReleaseTag = tag;
		this.saveSettings();
		this.hachiGenUpdateState = {
			...this.hachiGenUpdateState,
			currentTag: tag,
			status: "current",
			updateAvailable: false,
		};
	}

	async performUpdateCheck() {
		// Fetch and compare local HEAD against the update target. This method reports
		// update availability and local changes, but never modifies the worktree.
		const paths = this.getPaths();
		const installPath = this.getActiveInstallIdentifier();
		const hasGit = this.getRuntimeTarget() === "remote" ? await this.remotePathExists(".git", "d") : fileExists(paths.git);

		if (!hasGit) {
			this.updateState = {
				...createUncheckedUpdateState("This install is not a Git checkout, so HachiGen cannot check for updates."),
				status: "not_git",
				checkedAt: new Date().toISOString(),
				updateTarget: UPDATE_TARGET,
				message: "This install is not a Git checkout, so HachiGen cannot check for updates.",
			};
			return this.updateState;
		}

		if (this.getRuntimeTarget() !== "remote") {
			await this.ensureGit(true);
		}

		const repository = await this.getRepositoryInfo({ onLog: entry => this.logShell(entry) });
		const localChanges = await this.getLocalChanges();
		const localChangeDetails = localChanges.map(describeGitStatus);
		const localChangeSummary = summarizeLocalChanges(localChangeDetails);
		const sourceLabel = this.getRuntimeTarget() === "remote" ? "Remote" : "Local";
		this.log(`${sourceLabel}: checking Hachi updates...`);

		// Fetch updates for the configured update target so the comparison below
		// uses fresh remote data.
		await this.runGit(["fetch", UPDATE_REMOTE, UPDATE_BRANCH], {
			timeoutMs: 300000,
		});

		const local = (await this.runGit(["rev-parse", "HEAD"])).stdout.trim();
		const remote = (await this.runGit(["rev-parse", UPDATE_TARGET])).stdout.trim();
		const base = (await this.runGit(["merge-base", "HEAD", UPDATE_TARGET])).stdout.trim();
		const localTree = (await this.runGit(["rev-parse", "HEAD^{tree}"])).stdout.trim();
		const remoteTree = (await this.runGit(["rev-parse", `${UPDATE_TARGET}^{tree}`])).stdout.trim();

		const blocked = localChanges.length > 0;
		const committedFilesMatchTarget = Boolean(localTree && remoteTree && localTree === remoteTree);
		const filesMatchTarget = committedFilesMatchTarget && !blocked;
		const onUpdateBranch = repository.currentBranch === UPDATE_BRANCH;
		const canFastForward = local !== remote && base === local;
		const historyDiverged = local !== remote && base !== local;
		const available = onUpdateBranch && canFastForward;
		let status = "current";
		let message = "Hachi is up to date.";

		if (!onUpdateBranch) {
			status = filesMatchTarget ? "branch_current" : "branch_mismatch";
			if (filesMatchTarget) {
				message = `Current branch is ${repository.currentBranch || "unknown"}. Files match ${UPDATE_TARGET}. Automatic updates only run from ${UPDATE_BRANCH}.`;
			} else if (committedFilesMatchTarget) {
				message = `Current branch is ${repository.currentBranch || "unknown"}. Committed files match ${UPDATE_TARGET}, but local changes exist.`;
			} else {
				message = `Current branch is ${repository.currentBranch || "unknown"} and differs from ${UPDATE_TARGET}. Use Git to update manually.`;
			}
		} else if (available) {
			status = "available";
			message = "Updates available";
		} else if (historyDiverged) {
			status = filesMatchTarget ? "history_current" : "diverged";
			message = filesMatchTarget ?
				`Files match ${UPDATE_TARGET}, but Git history differs. Review with Git before updating.` :
				`Local and ${UPDATE_TARGET} history have diverged. Update manually.`;
		}

		const incomingCommits = filesMatchTarget ? [] : await this.getIncomingCommits();

		this.updateState = {
			status,
			available,
			blocked,
			diverged: historyDiverged,
			checkedAt: new Date().toISOString(),
			installPath,
			local,
			remote,
			base,
			localTree,
			remoteTree,
			committedFilesMatchTarget,
			filesMatchTarget,
			onUpdateBranch,
			currentBranch: repository.currentBranch,
			originUrl: repository.originUrl,
			updateRemote: UPDATE_REMOTE,
			updateBranch: UPDATE_BRANCH,
			updateTarget: UPDATE_TARGET,
			repository,
			source: this.getRuntimeTarget(),
			localChanges,
			localChangeDetails,
			localChangeSummary,
			incomingCommits,
			incomingCommitCount: incomingCommits.length,
			message: available && blocked ?
				"Updates available. Local changes will be stashed before updating." :
				message,
		};

		await this.refreshActiveStash();

		if (this.getRuntimeTarget() === "remote") {
			const stashCount = this.updateState.stashes?.length || 0;
			this.log(`Remote: found ${stashCount} saved HachiGen ${stashCount === 1 ? "stash" : "stashes"}.`);
		}

		return this.updateState;
	}

	async backupBeforeUpdate() {
		if (this.getRuntimeTarget() === "remote") {
			return this.backupRemoteBeforeUpdate();
		}

		// Copy user-owned runtime files before changing code. This is separate
		// from Git stash because .env/database files may be ignored by Git.
		const paths = this.getPaths();
		const backupDir = path.join(paths.root, "manager", "backups", timestampFolderName());
		const files = [
			[paths.env, ".env"],
			[paths.configJson, path.join("config", "config.json")],
			[paths.database, path.join("database", "database.sqlite")],
		];
		const copied = [];

		for (const [source, relativeTarget] of files) {
			if (!fileExists(source)) {
				continue;
			}

			const target = path.join(backupDir, relativeTarget);
			ensureDir(path.dirname(target));
			fs.copyFileSync(source, target);
			copied.push(relativeTarget);
		}

		return {
			backupDir,
			copied,
		};
	}

	async backupRemoteBeforeUpdate() {
		const backupDir = `manager/backups/${timestampFolderName()}`;
		const script = `
const fs = require("node:fs");
const path = require("node:path");
const backupDir = ${JSON.stringify(backupDir)};
const files = [
	[".env", ".env"],
	["config/config.json", "config/config.json"],
	["database/database.sqlite", "database/database.sqlite"],
];
const copied = [];
for (const [source, relativeTarget] of files) {
	if (!fs.existsSync(source)) {
		continue;
	}
	const target = path.posix.join(backupDir, relativeTarget);
	fs.mkdirSync(path.posix.dirname(target), { recursive: true });
	fs.copyFileSync(source, target);
	copied.push(relativeTarget);
}
process.stdout.write(JSON.stringify({ backupDir, copied }));
`;
		const backup = await this.runRemoteHachiJson(`node -e ${quotePosix(script)}`, {
			fallbackMessage: "Remote pre-update backup did not return valid JSON.",
			timeoutMs: 120000,
		});

		return backup;
	}

	async applyUpdate() {
		// Apply an available update by fast-forwarding to the update target. It never
		// hard-resets; local work is stashed first and runtime files are backed up.
		if (!this.updateState.available) {
			await this.checkUpdates();
		}

		if (!this.updateState.available) {
			return this.updateState;
		}

		let autoStash = null;

		if (this.updateState.blocked) {
			// Save local work before the merge so the update can proceed safely.
			autoStash = await this.createAutoStash();
		}

		const backup = await this.backupBeforeUpdate();
		this.log(`Backed up ${this.getRuntimeTarget()} config before update: ${backup.backupDir}`);
		this.log(`Applying ${this.getRuntimeTarget()} update from ${UPDATE_TARGET}...`);
		await this.runGit(["merge", "--ff-only", UPDATE_TARGET], {
			timeoutMs: 300000,
		});

		// New bot code may have new package dependencies.
		try {
			if (this.getRuntimeTarget() === "remote") {
				this.log("Remote: installing npm dependencies after update...");
				await this.runRemoteHachiCommand("npm install", {
					log: true,
					timeoutMs: 900000,
				});
			} else {
				await this.ensureNpmDependencies();
			}
		} catch (error) {
			throw errorWithContext(`${this.getRuntimeTarget() === "remote" ? "Remote" : "Local"} update failed while installing npm dependencies after the Git merge`, error);
		}

		const refreshedState = await this.checkUpdates();

		this.updateState = {
			...refreshedState,
			backup,
			stash: autoStash || refreshedState.stash,
			message: autoStash ?
				`Update complete. Local changes were saved as ${autoStash.ref}.` :
				refreshedState.message,
		};

		return this.updateState;
	}

	async restoreStashedChanges() {
		// Apply the active HachiGen stash without dropping it. Keeping the stash
		// lets the user confirm the restore before choosing Delete Changes.
		const activeStash = await this.refreshActiveStash();

		if (!activeStash) {
			throw new Error("No HachiGen saved stash is available to restore.");
		}

		this.log(`Restoring saved changes from ${activeStash.ref}...`);
		await this.runGit(["stash", "apply", activeStash.ref], {
			timeoutMs: 300000,
		});

		await this.checkUpdates();
		return {
			ok: true,
			message: `Restored saved changes from ${activeStash.ref}. The stash is still available until deleted.`,
			stash: activeStash,
		};
	}

	async deleteStashedChanges() {
		// Permanently drop the active HachiGen-created stash after the user no
		// longer needs Restore Changes.
		const activeStash = await this.refreshActiveStash();

		if (!activeStash) {
			throw new Error("No HachiGen saved stash is available to delete.");
		}

		this.log(`Deleting saved changes from ${activeStash.ref}...`);
		await this.runGit(["stash", "drop", activeStash.ref], {
			timeoutMs: 300000,
		});

		this.settings.activeStash = null;
		this.saveSettings();
		await this.refreshActiveStash();

		return {
			ok: true,
			message: `Deleted saved changes from ${activeStash.ref}.`,
		};
	}

	async deployCommands() {
		if (this.getRuntimeTarget() === "remote") {
			return this.deployRemoteCommands();
		}

		// Redeploy slash commands from a clean Discord state. Deleting first
		// removes commands that no longer exist locally before the fresh global
		// and guild command lists are uploaded.
		if (!this.isProjectFolder()) {
			throw new Error("Hachi is not installed in the selected folder.");
		}

		await this.runConfigValidation();
		this.log("Deleting existing Hachi slash commands...");
		await run("node", ["delete-all-commands.js"], {
			cwd: this.getInstallPath(),
			timeoutMs: 300000,
			onLog: entry => this.logShell(entry),
		});
		this.log("Deploying fresh Hachi slash commands...");
		await run("node", ["deploy-global-commands.js"], {
			cwd: this.getInstallPath(),
			timeoutMs: 300000,
			onLog: entry => this.logShell(entry),
		});
		await run("node", ["deploy-guild-commands.js"], {
			cwd: this.getInstallPath(),
			timeoutMs: 300000,
			onLog: entry => this.logShell(entry),
		});
		this.log("Slash commands deployed.");
		return { ok: true, message: "Commands deployed." };
	}

	async deployRemoteCommands() {
		const validation = await this.validateRemoteInstall({ repair: false });

		if (!validation.ok) {
			throw new Error(validation.config?.message || validation.message || "Remote Hachi validation failed.");
		}

		this.log("Deleting existing Hachi slash commands from remote source...");
		await this.runRemoteHachiCommand("node delete-all-commands.js", {
			timeoutMs: 300000,
		});
		this.log("Deploying fresh Hachi slash commands from remote source...");
		await this.runRemoteHachiCommand("node deploy-global-commands.js", {
			timeoutMs: 300000,
		});
		await this.runRemoteHachiCommand("node deploy-guild-commands.js", {
			timeoutMs: 300000,
		});
		this.log("Remote slash commands deployed.");
		return { ok: true, message: "Remote commands deployed." };
	}

	async pm2Describe() {
		// Ask PM2 whether the Hachi process is already registered. Start/restart
		// uses this to choose between registering a new process and restarting it.
		return run("pm2", ["describe", PROCESS_NAME], {
			allowFailure: true,
			timeoutMs: 30000,
			onLog: entry => this.logShell(entry),
		});
	}

	async getPm2Status() {
		if (this.getRuntimeTarget() === "remote") {
			return this.getRemotePm2Status();
		}

		return this.getLocalPm2Status();
	}

	async getLocalPm2Status() {
		// Convert PM2's process list into the small status object used by
		// Dashboard cards, status dots, and runtime details.
		const hasPm2 = await commandExists("pm2");

		if (!hasPm2) {
			return {
				installed: false,
				registered: false,
				status: "pm2-missing",
				message: "PM2 is not installed.",
			};
		}

		// jlist is PM2's machine-readable process list.
		const result = await run("pm2", ["jlist"], {
			allowFailure: true,
			timeoutMs: 30000,
		});

		if (result.code !== 0) {
			return {
				installed: true,
				registered: false,
				status: "error",
				message: result.stderr || "Could not read PM2 status.",
			};
		}

		try {
			const apps = parsePm2Json(result.stdout);
			const app = apps.find(item => item.name === PROCESS_NAME);

			// PM2 can be installed even if Hachi has never been started.
			if (!app) {
				return {
					installed: true,
					registered: false,
					status: "not-registered",
					message: "Hachi is not registered in PM2.",
				};
			}

			return {
				installed: true,
				registered: true,
				status: app.pm2_env?.status || "unknown",
				restarts: app.pm2_env?.restart_time || 0,
				cpu: app.monit?.cpu || 0,
				memory: app.monit?.memory || 0,
				pid: app.pid || null,
				message: `Hachi is ${app.pm2_env?.status || "unknown"}.`,
			};
		} catch (error) {
			return {
				installed: true,
				registered: false,
				status: "error",
				message: error.message,
			};
		}
	}

	async startBot() {
		if (this.getRuntimeTarget() === "remote") {
			return this.startRemoteBot();
		}

		// Validate and repair before starting so PM2 is never asked to run a
		// half-installed or misconfigured bot.
		const validation = await this.validateInstall({ repair: true });

		if (!validation.ok) {
			throw new Error(validation.config?.message || validation.message || "Hachi validation failed.");
		}

		const paths = this.getPaths();
		await this.ensurePm2(true);
		const describe = await this.pm2Describe();

		// If PM2 already knows about Hachi, restart the existing process using
		// the ecosystem file. Otherwise, register it for the first time.
		if (describe.code === 0) {
			this.log("Restarting Hachi through PM2...");
			await run("pm2", ["restart", paths.ecosystem, "--only", PROCESS_NAME], {
				cwd: paths.root,
				timeoutMs: 120000,
				onLog: entry => this.logShell(entry),
			});
		} else {
			this.log("Starting Hachi through PM2...");
			await run("pm2", ["start", paths.ecosystem, "--only", PROCESS_NAME], {
				cwd: paths.root,
				timeoutMs: 120000,
				onLog: entry => this.logShell(entry),
			});
		}

		// pm2 save makes PM2 remember the process list for future restores/startup.
		await run("pm2", ["save"], {
			timeoutMs: 120000,
			onLog: entry => this.logShell(entry),
		});

		return this.getPm2Status();
	}

	async stopBot() {
		if (this.getRuntimeTarget() === "remote") {
			return this.stopRemoteBot();
		}

		// Stop the PM2 process without deleting its registration. That keeps
		// future Start/Restart behavior predictable.
		await this.ensurePm2(false);
		this.log("Stopping Hachi through PM2...");
		await run("pm2", ["stop", PROCESS_NAME], {
			timeoutMs: 120000,
			onLog: entry => this.logShell(entry),
		});
		return this.getPm2Status();
	}

	async restartBot() {
		if (this.getRuntimeTarget() === "remote") {
			return this.restartRemoteBot();
		}

		// Restart the PM2 process when it exists. If Hachi has not been
		// registered yet, fall back to the full Start path.
		await this.ensurePm2(true);
		const describe = await this.pm2Describe();

		if (describe.code === 0) {
			this.log("Restarting Hachi through PM2...");
			await run("pm2", ["restart", PROCESS_NAME], {
				timeoutMs: 120000,
				onLog: entry => this.logShell(entry),
			});
			return this.getPm2Status();
		}

		return this.startBot();
	}

	readLocalLogs(limit = 160) {
		// Read the newest Hachi runtime log file from the install folder and keep
		// only the tail so the Logs tab stays responsive.
		const paths = this.getPaths();

		if (!fileExists(paths.logs)) {
			return "";
		}

		const files = fs.readdirSync(paths.logs)
			.filter(file => /\.(log|txt)$/i.test(file))
			.map(file => ({
				file,
				fullPath: path.join(paths.logs, file),
				modified: fs.statSync(path.join(paths.logs, file)).mtimeMs,
			}))
			.sort((a, b) => b.modified - a.modified);

		if (!files.length) {
			return "";
		}

		const text = fs.readFileSync(files[0].fullPath, "utf8");
		return text.split(/\r?\n/).slice(-limit).join("\n");
	}

	async getLogs() {
		// Build the combined Logs tab payload: local Hachi logs, PM2 snapshot
		// output, and HachiGen's in-memory operation log.
		if (this.getRuntimeTarget() === "remote") {
			let pm2 = "";

			try {
				pm2 = await this.readRemoteLogs();
			} catch (error) {
				pm2 = error.message || "Could not read remote logs.";
			}

			return {
				local: "",
				pm2,
				target: "remote",
				events: this.logger.readRecentEvents(160),
			};
		}

		const local = this.readLocalLogs();
		// --nostream takes a snapshot instead of leaving a live command running.
		const pm2 = await this.readLocalPm2Snapshot(160);

		return {
			local,
			pm2,
			target: "local",
			events: this.logger.readRecentEvents(160),
		};
	}
}

module.exports = {
	HachiManager,
};
