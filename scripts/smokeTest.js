#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
process.chdir(projectRoot);

const results = { failed: 0, passed: 0 };

function resolveProject(...parts) {
	return path.join(projectRoot, ...parts);
}
function readJson(...parts) {
	return JSON.parse(fs.readFileSync(resolveProject(...parts), "utf8"));
}
function requireFresh(...parts) {
	const resolvedPath = require.resolve(resolveProject(...parts));
	delete require.cache[resolvedPath];
	return require(resolvedPath);
}
function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}
async function test(name, fn) {
	try {
		await fn();
		results.passed += 1;
		console.log(`[pass] ${name}`);
	} catch (error) {
		results.failed += 1;
		console.error(`[fail] ${name}`);
		console.error(`       ${error.message}`);
	}
}
function duplicateValues(values) {
	const seen = new Set();
	const duplicates = new Set();
	for (const value of values) {
		if (seen.has(value)) {
			duplicates.add(value);
		} else {
			seen.add(value);
		}
	}
	return [...duplicates];
}
function readSource(...parts) {
	return fs.readFileSync(resolveProject(...parts), "utf8");
}

function validatePackageMetadata() {
	const pkg = readJson("package.json");
	const lock = readJson("package-lock.json");
	const rootPackage = lock.packages?.[""];
	assert(pkg.name === "hachigen", "package.json name should be hachigen.");
	assert(pkg.version === lock.version, "package.json and package-lock.json versions do not match.");
	assert(rootPackage?.version === pkg.version, "package-lock root package version does not match package.json.");
	assert(pkg.scripts?.check?.includes("node --check main.js"), "package.json is missing the check script.");
	assert(pkg.scripts?.lint === "eslint . --config config/eslint.config.js", "package.json is missing the lint script.");
	assert(pkg.scripts?.smoke === "node scripts/smokeTest.js", "package.json is missing the smoke script.");
	assert(pkg.scripts?.dist === "electron-builder --win portable", "package.json should build the portable Windows app.");
	assert(pkg.build?.productName === "HachiGen", "Electron Builder productName should be HachiGen.");
	assert(pkg.build?.artifactName === "HachiGen.${ext}", "Electron Builder artifactName should produce HachiGen.exe.");
	assert(pkg.repository?.url?.includes("FearlessKenji/HachiGen"), "package metadata should point at the HachiGen repo.");
	for (const packageName of Object.keys(pkg.devDependencies || {})) {
		assert(lock.packages?.[`node_modules/${packageName}`], `package-lock.json is missing node_modules/${packageName}.`);
	}
}

function validateProjectFiles() {
	const requiredFiles = [
		"CHANGELOG.md", "README.md", ".github/workflows/ci.yml", ".github/workflows/release.yml",
		"config/eslint.config.js", "docs/patch-notes.md", "icon.ico", "main.js", "package-lock.json",
		"package.json", "preload.js", "renderer/app.js", "renderer/assets/KenjiBotProfile.svg",
		"renderer/index.html", "renderer/styles.css", "scripts/smokeTest.js", "src/database-worker.js",
		"src/hachigenLogger.js", "src/manager.js", "src/shell.js",
	];
	for (const file of requiredFiles) {
		assert(fs.existsSync(resolveProject(file)), `Missing required project file: ${file}.`);
	}
}

function validateStandaloneWiring() {
	const mainSource = readSource("main.js");
	const managerSource = readSource("src", "manager.js");
	const workflow = readSource(".github", "workflows", "release.yml");
	const ci = readSource(".github", "workflows", "ci.yml");
	const version = readJson("package.json").version;
	assert(mainSource.includes("FearlessKenji/HachiGen/blob/main/CHANGELOG.md"), "Help links should point at the HachiGen changelog.");
	assert(mainSource.includes("path.resolve(__dirname, \"..\", \"Hachi\")"), "Development default install path should target the sibling Hachi repo.");
	assert(managerSource.includes("REPO_URL = \"https://github.com/FearlessKenji/Hachi.git\""), "HachiGen should still install/update Hachi from the Hachi repo.");
	assert(managerSource.includes("repos/FearlessKenji/HachiGen/releases"), "Self-update checks should use the HachiGen repo releases.");
	assert(!managerSource.includes("releases/latest"), "Release checks should not use the repo-wide latest release endpoint.");
	assert(workflow.includes("Get-Content package.json") && !workflow.includes("manager/package.json"), "Release workflow should resolve versions from root package.json.");
	assert(workflow.includes("npm run check") && workflow.includes("npm run lint") && workflow.includes("npm run smoke"), "Release workflow should verify before building.");
	assert(workflow.includes("npm run dist") && workflow.includes("dist/HachiGen.exe"), "Release workflow should build and upload dist/HachiGen.exe.");
	assert(workflow.includes("--latest"), "Standalone HachiGen releases should mark the newest HachiGen release as latest.");
	assert(ci.includes("npm run check") && ci.includes("npm run lint") && ci.includes("npm run smoke"), "CI workflow should run check, lint, and smoke.");
	assert(ci.includes("npm audit --audit-level=moderate"), "CI workflow should include dependency audit.");
	assert(readSource("CHANGELOG.md").includes(`## v${version}`), "CHANGELOG.md should include the current release entry.");
	assert(readSource("docs", "patch-notes.md").includes(`# v${version}`), "docs/patch-notes.md should include the current release entry.");
}

function validateRendererAndMenuWiring() {
	const mainSource = readSource("main.js");
	const preloadSource = readSource("preload.js");
	const rendererSource = readSource("renderer", "app.js");
	const indexSource = readSource("renderer", "index.html");
	const stylesSource = readSource("renderer", "styles.css");
	const managerSource = readSource("src", "manager.js");
	const { HachiManager } = requireFresh("src", "manager.js");
	assert(rendererSource.includes("function refreshCurrentDatabaseViewer()"), "Renderer is missing the database viewer refresh helper.");
	assert(/if \(action === "apply-sanitize"\)[\s\S]*refreshCurrentDatabaseViewer\(\);/u.test(rendererSource), "Sanitation cleanup should refresh the database viewer cache.");
	assert(/const result = await runAction\("Restore database"[\s\S]*refreshCurrentDatabaseViewer\(\);/u.test(rendererSource), "Database restore should refresh the database viewer cache.");
	assert(mainSource.includes("Menu.setApplicationMenu(buildApplicationMenu())"), "HachiGen should install a custom application menu.");
	assert(mainSource.includes("label: \"File\"") && mainSource.includes("label: \"View\"") && mainSource.includes("label: \"Help\""), "Application menu is missing expected menus.");
	assert(mainSource.includes("label: \"Export HachiGen Logs\"") && mainSource.includes("label: \"Check for Updates\""), "Application menu is missing log export or update check actions.");
	assert(!mainSource.includes("label: \"Edit\"") && !mainSource.includes("toggleDevTools") && !mainSource.includes("resetZoom"), "Application menu should not expose Edit, DevTools, or zoom controls.");
	assert(preloadSource.includes("checkVersionUpdates") && rendererSource.includes("api.checkVersionUpdates()"), "Version update menu action is not wired through preload and renderer.");
	assert(mainSource.includes("manager:check-hachigen-updates") && mainSource.includes("manager:install-hachigen-update"), "Main process should handle HachiGen self-update channels.");
	assert(preloadSource.includes("installHachiGenUpdate") && rendererSource.includes("api.installHachiGenUpdate()"), "Self-update install action is not wired.");
	assert(indexSource.includes("id=\"hachigenUpdateMeta\"") && stylesSource.includes(".update-wizard-progress"), "Update wizard UI or styles are missing.");
	assert(mainSource.includes("-WindowStyle") && mainSource.includes("Hidden") && !mainSource.includes("tasklist /FI"), "Self-update helper should run hidden without the old visible cmd loop.");
	assert(managerSource.includes("HACHIGEN_RELEASE_TAG_PREFIX = \"hachigen-v\""), "Update checks should use hachigen-v* releases.");
	assert(typeof HachiManager.prototype.checkVersionUpdates === "function", "HachiManager is missing checkVersionUpdates().");
	assert(typeof HachiManager.prototype.checkHachiGenUpdates === "function", "HachiManager is missing checkHachiGenUpdates().");
	assert(typeof HachiManager.prototype.downloadHachiGenUpdate === "function", "HachiManager is missing downloadHachiGenUpdate().");
}

function validateIpcSurface() {
	const preloadSource = readSource("preload.js");
	const mainSource = readSource("main.js");
	const rendererSource = readSource("renderer", "app.js");
	const { HachiManager } = requireFresh("src", "manager.js");
	const apiEntries = [...preloadSource.matchAll(/^\s*([A-Za-z]\w*)\s*:\s*(?:\([^)]*\)|[A-Za-z]\w*)\s*=>\s*invoke\("([^"]+)"/gmu)]
		.map(match => ({ channel: match[2], name: match[1] }));
	const methodEntries = [...preloadSource.matchAll(/^\s*([A-Za-z]\w*)\s*\([^)]*\)\s*\{/gmu)]
		.map(match => match[1]);
	const exposedApiNames = new Set([
		...apiEntries.map(entry => entry.name),
		...methodEntries,
	]);
	const preloadChannels = apiEntries.map(entry => entry.channel);
	const handlerChannels = [...mainSource.matchAll(/^\s*ipcMain\.handle\("([^"]+)"/gmu)].map(match => match[1]);
	const handlerChannelSet = new Set(handlerChannels);
	const rendererCalls = [...rendererSource.matchAll(/\bapi\.([A-Za-z]\w*)\s*\(/gu)].map(match => match[1]);
	const managerMethods = [...mainSource.matchAll(/\bmanager\.([A-Za-z]\w*)\s*\(/gu)].map(match => match[1]);

	assert(apiEntries.length >= 30, "Preload exposes too few IPC actions.");
	assert(duplicateValues(apiEntries.map(entry => entry.name)).length === 0, "Preload has duplicate API names.");
	assert(duplicateValues(preloadChannels).length === 0, "Preload has duplicate IPC channels.");
	assert(duplicateValues(handlerChannels).length === 0, "Main has duplicate IPC handlers.");

	for (const channel of preloadChannels) {
		assert(handlerChannelSet.has(channel), `Preload exposes ${channel}, but main.js does not handle it.`);
		assert(channel.startsWith("manager:"), `IPC channel ${channel} should use the manager: prefix.`);
	}

	for (const apiName of rendererCalls) {
		assert(exposedApiNames.has(apiName), `Renderer calls api.${apiName}(), but preload.js does not expose it.`);
	}

	for (const methodName of managerMethods) {
		assert(typeof HachiManager.prototype[methodName] === "function", `main.js calls manager.${methodName}(), but HachiManager does not define it.`);
	}

	assert(exposedApiNames.has("onEvent"), "Preload must expose the live event subscription helper.");
	assert(mainSource.includes("manager:event"), "Main process must forward manager:event updates.");
}

async function validateSelfUpdateUnavailableState() {
	const { HachiManager } = requireFresh("src", "manager.js");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-update-unavailable-"));

	try {
		const manager = new HachiManager({
			defaultInstallPath: tempDir,
			managerRoot: projectRoot,
			userDataPath: path.join(tempDir, "userData"),
		});

		manager.fetchLatestHachiGenRelease = async () => ({
			assetName: "HachiGen.exe",
			assetSize: 0,
			assetUrl: null,
			latestTag: "hachigen-v9.9.9",
			publishedAt: "2026-07-14T12:00:00.000Z",
			releaseName: "HachiGen v9.9.9",
			releaseUrl: "https://example.invalid/hachigen-v9.9.9",
			unavailableReason: "Latest HachiGen release hachigen-v9.9.9 does not include HachiGen.exe.",
		});

		const update = await manager.checkHachiGenUpdates();

		assert(update.status === "unavailable", "Missing release assets should return an unavailable update state.");
		assert(update.canInstall === false, "Missing release assets should not enable installation.");
		assert(update.updateAvailable === false, "Missing release assets should not be treated as installable updates.");
		assert(update.message.includes("does not include HachiGen.exe"), "Unavailable update state should explain the missing asset.");
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}
}

async function validateShellWrapperHardening() {
	const shellSource = readSource("src", "shell.js");
	const { commandExists, run } = requireFresh("src", "shell.js");
	let unsupportedCommandRejected = false;

	assert(shellSource.includes("ALLOWED_COMMANDS"), "Shell wrapper should constrain executable names.");
	assert(shellSource.includes("resolveCommandPath(command"), "Shell wrapper should resolve executables before spawning.");
	assert(!shellSource.includes("env: { ...process.env"), "Shell wrapper should not spread process.env into spawn options.");
	assert(await commandExists("node"), "Shell wrapper should resolve the current Node command.");

	try {
		await run("not-a-hachigen-tool", [], { allowFailure: true, timeoutMs: 1000 });
	} catch (error) {
		unsupportedCommandRejected = error.message.includes("Unsupported command");
	}

	assert(unsupportedCommandRejected, "Shell wrapper should reject unsupported executable names before spawning.");
}

function validateDatabaseWorkerStaging() {
	const managerSource = readSource("src", "manager.js");
	const workerSource = readSource("src", "database-worker.js");
	const { HachiManager } = requireFresh("src", "manager.js");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-worker-copy-"));

	try {
		const manager = new HachiManager({
			defaultInstallPath: tempDir,
			managerRoot: projectRoot,
			userDataPath: path.join(tempDir, "userData"),
		});
		const workerPath = manager.getDatabaseWorkerPath();

		assert(fs.existsSync(workerPath), "getDatabaseWorkerPath() did not copy the bundled worker into userData.");
		assert(fs.readFileSync(workerPath, "utf8") === workerSource, "Copied database worker does not match bundled source.");
		assert(
			workerSource.includes("createRequire(path.join(path.resolve(root || \".\"), \"package.json\"))"),
			"Database worker should load Hachi modules from the selected install root.",
		);
		assert(managerSource.includes("const remoteWorkerPath = \".hachigen/database-worker.js\""), "Remote database worker should stage into .hachigen/.");
		assert(managerSource.includes("await this.writeRemoteText(remoteWorkerPath, remoteWorkerSource)"), "Remote database worker should upload bundled source before launch.");
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}
}

async function validateLoggingAndQuietState() {
	const { HachiManager } = requireFresh("src", "manager.js");
	const { dateFolderName, getDefaultHachiGenUserDataPath } = requireFresh("src", "hachigenLogger.js");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-logs-"));
	const liveEvents = [];

	try {
		assert(getDefaultHachiGenUserDataPath().includes("HachiGen"), "Default user-data path should be app-data scoped.");
		fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });

		const manager = new HachiManager({
			defaultInstallPath: tempDir,
			managerRoot: projectRoot,
			sendEvent: event => liveEvents.push(event),
			userDataPath: path.join(tempDir, "userData"),
		});

		manager.recordRendererEvent({
			details: { label: "TOKEN=smoke-secret-token" },
			message: "TOKEN=smoke-secret-token failed",
			type: "error",
		});

		const logFolder = path.join(tempDir, "userData", "logs", dateFolderName());
		const rawLog = fs.readFileSync(path.join(logFolder, "raw.log"), "utf8");

		assert(rawLog.includes("[redacted]"), "Renderer log did not redact secrets.");
		assert(!rawLog.includes("smoke-secret-token"), "Renderer log leaked a secret.");

		const calls = [];
		manager.runGit = async (args, options = {}) => {
			calls.push({
				hasOnLog: typeof options.onLog === "function",
				log: options.log,
			});

			if (args[0] === "branch") {
				return { code: 0, stderr: "", stdout: "main\n" };
			}

			if (args[0] === "remote") {
				return { code: 0, stderr: "", stdout: "https://example.test/Hachi.git\n" };
			}

			return { code: 0, stderr: "", stdout: "" };
		};

		await manager.getRepositoryInfo();
		await manager.refreshActiveStash();

		assert(calls.length === 3, `Routine state probes executed ${calls.length} Git commands instead of 3.`);
		assert(calls.every(call => call.log === false), "Routine state probes should run quietly.");

		manager.logShell({ args: ["rev-parse", "HEAD"], command: "git", message: "> git rev-parse HEAD", stream: "command" });
		manager.logShell({ args: ["rev-parse", "HEAD"], command: "git", message: "abc123", stream: "stdout" });
		manager.logShell({ args: ["install"], command: "npm", message: "up to date", stream: "stdout" });

		const visibleEvents = manager.logger.readRecentEvents(10);
		const allEvents = manager.logger.readRecentEvents(10, { includeHidden: true });

		assert(liveEvents.some(event => event.message.includes("up to date")), "Visible shell output was not sent to the live UI log.");
		assert(!visibleEvents.some(event => event.message.includes("git rev-parse") || event.message === "abc123"), "Visible log included Git plumbing.");
		assert(
			allEvents.some(event => event.message.includes("git rev-parse") && event.uiVisible === false),
			"Hidden Git command was not persisted with uiVisible=false.",
		);
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}
}

async function validateUpdateCheckDeduplication() {
	const { HachiManager } = requireFresh("src", "manager.js");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-update-dedupe-"));

	try {
		const manager = new HachiManager({
			defaultInstallPath: tempDir,
			managerRoot: projectRoot,
			userDataPath: path.join(tempDir, "userData"),
		});
		let workerCalls = 0;
		const releases = [];

		manager.performUpdateCheck = () => {
			workerCalls += 1;
			return new Promise(resolve => {
				releases.push(resolve);
			});
		};

		const firstCheck = manager.checkUpdates();
		const secondCheck = manager.checkUpdates();

		assert(workerCalls === 1, "Overlapping update checks should share one worker.");
		releases[0]({ status: "current", message: "smoke" });
		await Promise.all([firstCheck, secondCheck]);
		assert(manager.checkUpdatesPromise === null, "Update check lock was not cleared after completion.");

		const thirdCheck = manager.checkUpdates();

		assert(workerCalls === 2, "Follow-up update check did not start a new worker after completion.");
		releases[1]({ status: "current", message: "follow-up" });
		await thirdCheck;
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}
}

async function main() {
	await test("package metadata and lockfile are consistent", validatePackageMetadata);
	await test("required project files exist", validateProjectFiles);
	await test("standalone repository wiring is correct", validateStandaloneWiring);
	await test("renderer, menu, and self-update wiring is correct", validateRendererAndMenuWiring);
	await test("IPC surface is fully wired", validateIpcSurface);
	await test("self-update reports missing assets without IPC failure", validateSelfUpdateUnavailableState);
	await test("shell wrapper resolves allowed commands safely", validateShellWrapperHardening);
	await test("database worker stages from standalone manager source", validateDatabaseWorkerStaging);
	await test("logs redact secrets and hide Git plumbing", validateLoggingAndQuietState);
	await test("update checks are deduplicated", validateUpdateCheckDeduplication);

	console.log("");
	console.log(`Smoke test complete: ${results.passed} passed, ${results.failed} failed.`);

	if (results.failed) {
		process.exitCode = 1;
	}
}

main().catch(error => {
	console.error("[fail] smoke test crashed");
	console.error(error);
	process.exitCode = 1;
});