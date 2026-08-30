const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const REGISTRY_VERSION = 1;
const LOCAL_SERVER_ID = "local";
const NATIVE_HACHI_TYPE_ID = "hachi";
const EXTERNAL_CAPABILITY_NAMES = new Set([
	"backups", "configuration", "databaseEncryption", "databaseMaintenance", "databaseToolConnection",
	"discordCommands", "gitUpdates", "logs", "pm2", "secretEncryption",
]);

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
	commands: {
		deleteCommands: { executable: "node", args: ["delete-all-commands.js"] },
		deployGlobalCommands: { executable: "node", args: ["deploy-global-commands.js"] },
		deployGuildCommands: { executable: "node", args: ["deploy-guild-commands.js"] },
		install: { executable: "npm", args: ["install"] },
		validate: { executable: "node", args: ["-e", "require('./config/configCheck.js')"] },
	},
});

function stableId(prefix, value) {
	const digest = crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
	return `${prefix}-${digest}`;
}

function definitionFingerprint(definition) {
	const copy = { ...definition };
	delete copy.sourcePath;
	delete copy.fingerprint;
	return crypto.createHash("sha256").update(JSON.stringify(copy)).digest("hex");
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
	const credentialsMode = String(input.credentials?.mode || "external").trim();
	if (!["external", "adapter"].includes(credentialsMode)) {
		throw new Error(`${sourcePath} credentials.mode must be external or adapter.`);
	}
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
		capabilities: {},
		commands: {},
		configuration: { files: [] },
		credentials: { mode: credentialsMode },
	};
	if (!definition.repository.url || definition.repository.url === "-" || !definition.repository.branch || definition.repository.branch === "-") {
		throw new Error(`${sourcePath} must declare a repository URL and branch.`);
	}
	for (const [key, enabled] of Object.entries(input.capabilities || {})) {
		if (!EXTERNAL_CAPABILITY_NAMES.has(key)) {
			throw new Error(`${sourcePath} requests unsupported capability ${key}.`);
		}
		definition.capabilities[key] = enabled === true;
	}
	for (const [name, command] of Object.entries(input.commands || {})) {
		if (!command || typeof command !== "object" || Array.isArray(command)) {
			throw new Error(`${sourcePath} command ${name} must be an object.`);
		}
		const executable = String(command.executable || "").trim();
		if (!/^(?:node|npm|npx|pnpm|yarn|git)$/u.test(executable)) {
			throw new Error(`${sourcePath} command ${name} uses an unsupported executable.`);
		}
		const args = Array.isArray(command.args) ? command.args.map(value => String(value)) : [];
		if (args.some(value => /[\r\n\0]/u.test(value))) {
			throw new Error(`${sourcePath} command ${name} contains invalid arguments.`);
		}
		definition.commands[name] = { executable, args };
	}
	for (const [key, value] of Object.entries(input.paths || {})) {
		if (value !== undefined && value !== null && String(value).trim()) {
			definition.paths[key] = assertSafeRelativePath(value, `paths.${key}`);
		}
	}
	const configurationFiles = Array.isArray(input.configuration?.files) ? input.configuration.files : [];
	if (configurationFiles.length > 20) {
		throw new Error(`${sourcePath} declares too many configuration files.`);
	}
	definition.configuration.files = [...new Set(configurationFiles.map((value, index) =>
		assertSafeRelativePath(value, `configuration.files[${index}]`)))];
	for (const file of definition.configuration.files) {
		if (!/(?:^|\/)\.env(?:\.[^/]+)?$|\.(?:json|ya?ml)$/iu.test(file)) {
			throw new Error(`${sourcePath} configuration file ${file} must be an .env, JSON, YAML, or YML file.`);
		}
	}
	if (credentialsMode === "adapter" && !definition.commands.credentialsWrite) {
		throw new Error(`${sourcePath} uses adapter credentials but does not define credentialsWrite.`);
	}
	if (credentialsMode === "adapter" && !definition.capabilities.secretEncryption) {
		throw new Error(`${sourcePath} uses adapter credentials but does not request secretEncryption.`);
	}
	definition.fingerprint = definitionFingerprint(definition);
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
		credentialFingerprint: null,
		credentialsConfigured: false,
		policies: {},
	};
	return {
		version: REGISTRY_VERSION,
		activeDeploymentId: deployment.id,
		activeDeploymentByBotType: { [deployment.botTypeId]: deployment.id },
		servers,
		deployments: [deployment],
		policies: { backup: [], security: [], logs: [] },
	};
}

function normalizeFleetRegistry(saved, settings, defaultInstallPath) {
	if (!saved || saved.version !== REGISTRY_VERSION || !Array.isArray(saved.servers) || !Array.isArray(saved.deployments)) {
		return createLegacyFleet(settings, defaultInstallPath);
	}
	// Local computer is a permanent Fleet connection. Repair early registry files
	// that were saved with an empty server list instead of leaving every selector unusable.
	const localServer = { id: LOCAL_SERVER_ID, name: "Local computer", connection: { type: "local" } };
	const hasLocalServer = saved.servers.some(server => server?.id === LOCAL_SERVER_ID);
	const servers = hasLocalServer ?
		saved.servers.map(server => server.id === LOCAL_SERVER_ID ? localServer : server) :
		[localServer, ...saved.servers];
	const deploymentIds = new Set(saved.deployments.map(item => item.id));
	const savedActiveByType = saved.activeDeploymentByBotType && typeof saved.activeDeploymentByBotType === "object" ? saved.activeDeploymentByBotType : {};
	const activeDeploymentByBotType = {};
	for (const botTypeId of new Set(saved.deployments.map(item => item.botTypeId))) {
		const requested = saved.deployments.find(item => item.id === savedActiveByType[botTypeId] && item.botTypeId === botTypeId);
		const legacyActive = saved.deployments.find(item => item.id === saved.activeDeploymentId && item.botTypeId === botTypeId);
		const fallback = saved.deployments.find(item => item.botTypeId === botTypeId && item.serverId === LOCAL_SERVER_ID) || saved.deployments.find(item => item.botTypeId === botTypeId);
		activeDeploymentByBotType[botTypeId] = (requested || legacyActive || fallback)?.id || null;
	}
	// Credential profiles were removed before release. Strip their metadata so
	// each deployment folder remains the only credential source of truth.
	const registry = { ...saved };
	delete registry.credentialProfiles;
	return {
		...registry,
		activeDeploymentId: deploymentIds.has(saved.activeDeploymentId) ? saved.activeDeploymentId : (saved.deployments[0]?.id || null),
		activeDeploymentByBotType,
		deployments: saved.deployments.map(item => {
			const deployment = { ...item };
			delete deployment.credentialProfileId;
			return deployment;
		}),
		policies: saved.policies && typeof saved.policies === "object" ? saved.policies : { backup: [], security: [], logs: [] },
		servers,
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
	const definition = definitions.find(item => item.id === botTypeId);
	return {
		id,
		name,
		botTypeId,
		serverId,
		installPath,
		pm2Name,
		repositoryBranch: String(input.repositoryBranch || "").trim() || null,
		environment: ["development", "test", "staging", "production"].includes(input.environment) ? input.environment : "production",
		credentialFingerprint: input.credentialFingerprint || null,
		credentialsConfigured: Boolean(input.credentialsConfigured),
		approvedCapabilities: Object.fromEntries(Object.entries(definition?.capabilities || {}).filter(([, enabled]) => enabled)),
		definitionFingerprint: definition?.fingerprint || "native-hachi",
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
	definitionFingerprint,
	loadBotDefinitions,
	normalizeDeployment,
	normalizeFleetRegistry,
	normalizeServer,
	validateExternalBotDefinition,
	writeFleetRegistry,
};
