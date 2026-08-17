const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const REGISTRY_VERSION = 1;
const LOCAL_SERVER_ID = "local";
const NATIVE_HACHI_TYPE_ID = "hachi";

// Hachi is intentionally the only definition bundled with HachiGen. Other bots
// are loaded from user-owned JSON definitions and cannot replace native Hachi.
const NATIVE_HACHI_DEFINITION = Object.freeze({
	id: NATIVE_HACHI_TYPE_ID,
	displayName: "Hachi",
	source: "native",
	repository: { url: "https://github.com/FearlessKenji/Hachi.git", branch: "main" },
	runtime: { ecosystemFile: "config/ecosystem.config.js", pm2Name: "Hachi" },
	paths: {
		config: "config/config.json",
		database: "database/database.sqlite",
		environment: ".env",
		logs: "logs",
	},
	capabilities: {
		backups: true,
		configuration: true,
		databaseEncryption: true,
		databaseMaintenance: true,
		discordCommands: true,
		gitUpdates: true,
		logs: true,
		pm2: true,
		secretEncryption: true,
	},
});

function stableId(prefix, value) {
	const digest = crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
	return `${prefix}-${digest}`;
}

function assertSafeRelativePath(value, field) {
	const normalized = String(value || "").replace(/\\/gu, "/").replace(/^\.\//u, "");
	if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").some(part => !part || part === "." || part === "..")) {
		throw new Error(`${field} must be a safe relative path.`);
	}
	return normalized;
}

function validateExternalBotDefinition(input, sourcePath = "external definition") {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error(`${sourcePath} must contain a JSON object.`);
	}
	const id = String(input.id || "").trim().toLowerCase();
	const displayName = String(input.displayName || "").trim();
	if (!/^[a-z][a-z0-9-]{1,47}$/u.test(id)) {
		throw new Error(`${sourcePath} has an invalid bot type id.`);
	}
	if (id === NATIVE_HACHI_TYPE_ID) {
		throw new Error(`${sourcePath} cannot replace the native Hachi definition.`);
	}
	if (!displayName || displayName.length > 80) {
		throw new Error(`${sourcePath} has an invalid display name.`);
	}
	const runtime = input.runtime && typeof input.runtime === "object" ? input.runtime : {};
	const definition = {
		id,
		displayName,
		source: "external",
		sourcePath,
		repository: {
			branch: String(input.repository?.branch || "main").trim() || "main",
			url: String(input.repository?.url || "").trim(),
		},
		runtime: {
			ecosystemFile: assertSafeRelativePath(runtime.ecosystemFile || "ecosystem.config.js", "runtime.ecosystemFile"),
			pm2Name: String(runtime.pm2Name || displayName).trim(),
		},
		paths: {},
		capabilities: Object.fromEntries(Object.entries(input.capabilities || {}).map(([key, enabled]) => [key, enabled === true])),
	};
	for (const [key, value] of Object.entries(input.paths || {})) {
		if (value !== undefined && value !== null && String(value).trim()) {
			definition.paths[key] = assertSafeRelativePath(value, `paths.${key}`);
		}
	}
	return definition;
}

function loadBotDefinitions(definitionsDir) {
	const definitions = [NATIVE_HACHI_DEFINITION];
	const errors = [];
	if (!fs.existsSync(definitionsDir)) {
		return { definitions, errors };
	}
	for (const fileName of fs.readdirSync(definitionsDir).filter(name => name.toLowerCase().endsWith(".json")).sort()) {
		const sourcePath = path.join(definitionsDir, fileName);
		try {
			const definition = validateExternalBotDefinition(JSON.parse(fs.readFileSync(sourcePath, "utf8")), sourcePath);
			if (definitions.some(item => item.id === definition.id)) {
				throw new Error(`${sourcePath} duplicates bot type ${definition.id}.`);
			}
			definitions.push(definition);
		} catch (error) {
			errors.push({ fileName, message: error.message });
		}
	}
	return { definitions, errors };
}

function createLegacyFleet(settings, defaultInstallPath) {
	const remote = settings.remote || {};
	const localPath = settings.installPath || defaultInstallPath;
	const remoteConfigured = Boolean(remote.host && remote.username && remote.remotePath);
	const servers = [{ id: LOCAL_SERVER_ID, name: "Local computer", connection: { type: "local" } }];
	if (remoteConfigured) {
		servers.push({
			id: stableId("server", `${remote.username}@${remote.host}:${remote.port || 22}`),
			name: remote.host,
			connection: {
				host: remote.host,
				port: remote.port || 22,
				portMode: remote.portMode || "default",
				sshKeyPath: remote.sshKeyPath || "",
				type: "ssh",
				username: remote.username,
			},
		});
	}
	const activeServer = settings.runtimeTarget === "remote" && remoteConfigured ? servers[1] : servers[0];
	const installPath = activeServer.id === LOCAL_SERVER_ID ? localPath : remote.remotePath;
	const deployment = {
		id: stableId("deployment", `${activeServer.id}:hachi:${installPath}`),
		name: "Hachi",
		botTypeId: NATIVE_HACHI_TYPE_ID,
		serverId: activeServer.id,
		installPath,
		pm2Name: activeServer.id === LOCAL_SERVER_ID ? "Hachi" : (remote.pm2Name || "Hachi"),
		environment: "production",
		credentialProfileId: null,
		policies: {},
	};
	return {
		version: REGISTRY_VERSION,
		activeDeploymentId: deployment.id,
		servers,
		deployments: [deployment],
		credentialProfiles: [],
		policies: { backup: [], security: [], logs: [] },
	};
}

function normalizeFleetRegistry(saved, settings, defaultInstallPath) {
	if (!saved || saved.version !== REGISTRY_VERSION || !Array.isArray(saved.servers) || !Array.isArray(saved.deployments)) {
		return createLegacyFleet(settings, defaultInstallPath);
	}
	const deploymentIds = new Set(saved.deployments.map(item => item.id));
	return {
		...saved,
		activeDeploymentId: deploymentIds.has(saved.activeDeploymentId) ? saved.activeDeploymentId : (saved.deployments[0]?.id || null),
		credentialProfiles: Array.isArray(saved.credentialProfiles) ? saved.credentialProfiles : [],
		policies: saved.policies && typeof saved.policies === "object" ? saved.policies : { backup: [], security: [], logs: [] },
	};
}

function normalizeServer(input, existingIds = new Set()) {
	const connection = input?.connection && typeof input.connection === "object" ? input.connection : {};
	const type = connection.type === "ssh" ? "ssh" : "local";
	const name = String(input?.name || "").trim();
	const id = String(input?.id || stableId("server", `${type}:${name}:${connection.host || ""}:${connection.username || ""}`)).trim();
	if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(id) || existingIds.has(id)) {
		throw new Error("Server id is invalid or already in use.");
	}
	if (!name || name.length > 80) {
		throw new Error("Server name is required and must be 80 characters or fewer.");
	}
	if (type === "local") {
		return { id, name, connection: { type } };
	}
	const host = String(connection.host || "").trim();
	const username = String(connection.username || "").trim();
	const port = Number.parseInt(String(connection.port || 22), 10);
	if (!host || !username || !Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("SSH servers require a host, username, and valid port.");
	}
	return {
		id,
		name,
		connection: {
			type,
			host,
			username,
			port,
			portMode: connection.portMode === "custom" ? "custom" : "default",
			sshKeyPath: String(connection.sshKeyPath || "").trim(),
		},
	};
}

function normalizeDeployment(input, fleet, definitions) {
	const serverIds = new Set(fleet.servers.map(item => item.id));
	const definitionIds = new Set(definitions.map(item => item.id));
	const serverId = String(input?.serverId || "").trim();
	const botTypeId = String(input?.botTypeId || "").trim();
	const name = String(input?.name || "").trim();
	const installPath = String(input?.installPath || "").trim();
	if (!serverIds.has(serverId)) {
		throw new Error("Deployment server does not exist.");
	}
	if (!definitionIds.has(botTypeId)) {
		throw new Error("Deployment bot type is not installed.");
	}
	if (!name || name.length > 80 || !installPath) {
		throw new Error("Deployment name and install path are required.");
	}
	const server = fleet.servers.find(item => item.id === serverId);
	if (server.connection.type === "local" && !path.isAbsolute(installPath)) {
		throw new Error("Local deployment paths must be absolute.");
	}
	const pm2Name = String(input.pm2Name || definitions.find(item => item.id === botTypeId)?.runtime?.pm2Name || name).trim();
	if (!pm2Name || pm2Name.length > 100 || /[\r\n\0]/u.test(pm2Name)) {
		throw new Error("Deployment PM2 name is invalid.");
	}
	const id = String(input?.id || stableId("deployment", `${serverId}:${botTypeId}:${installPath}`)).trim();
	if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(id) || fleet.deployments.some(item => item.id === id)) {
		throw new Error("Deployment id is invalid or already in use.");
	}
	return {
		id,
		name,
		botTypeId,
		serverId,
		installPath,
		pm2Name,
		environment: ["development", "test", "staging", "production"].includes(input.environment) ? input.environment : "production",
		credentialProfileId: input.credentialProfileId || null,
		policies: input.policies && typeof input.policies === "object" ? input.policies : {},
	};
}

function writeFleetRegistry(filePath, fleet) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const temporaryPath = `${filePath}.${process.pid}.tmp`;
	fs.writeFileSync(temporaryPath, `${JSON.stringify(fleet, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
	fs.renameSync(temporaryPath, filePath);
}

module.exports = {
	LOCAL_SERVER_ID,
	NATIVE_HACHI_DEFINITION,
	REGISTRY_VERSION,
	createLegacyFleet,
	loadBotDefinitions,
	normalizeDeployment,
	normalizeFleetRegistry,
	normalizeServer,
	validateExternalBotDefinition,
	writeFleetRegistry,
};
