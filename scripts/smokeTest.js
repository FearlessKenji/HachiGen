#!/usr/bin/env node

const fs = require("node:fs");
const childProcess = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

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

async function validateBotRegistryFoundation() {
	const {
		NATIVE_HACHI_DEFINITION,
		createLegacyFleet,
		loadBotDefinitions,
		validateExternalBotDefinition,
	} = requireFresh("src", "botRegistry.js");
	assert(NATIVE_HACHI_DEFINITION.id === "hachi" && NATIVE_HACHI_DEFINITION.source === "native", "Hachi should be the only native bot definition.");
	const fleet = createLegacyFleet({ installPath: "C:\\Bots\\Hachi", runtimeTarget: "local" }, "C:\\Fallback");
	assert(fleet.servers.length === 1 && fleet.deployments.length === 1, "Legacy settings should migrate to one local Hachi deployment.");
	assert(fleet.deployments[0].botTypeId === "hachi", "Migrated deployment should use native Hachi.");
	assert(fleet.activeDeploymentByBotType.hachi === fleet.deployments[0].id, "Legacy migration should create a per-bot active installation target.");
	const repairedFleet = requireFresh("src", "botRegistry.js").normalizeFleetRegistry({
		activeDeploymentId: null,
		deployments: [],
		policies: {},
		servers: [],
		version: 1,
	}, {}, "C:\\Fallback");
	assert(repairedFleet.servers.length === 1 && repairedFleet.servers[0].id === "local", "Fleet should repair a missing Local computer connection.");
	const external = validateExternalBotDefinition({
		id: "optional-bot",
		displayName: "Optional Bot",
		repository: { url: "https://example.invalid/optional-bot.git", branch: "main" },
		runtime: { ecosystemFile: "config/ecosystem.config.js", pm2Name: "OptionalBot" },
		capabilities: { backups: true, databaseEncryption: true, databaseToolConnection: true },
	});
	assert(
		external.source === "external" && external.capabilities.databaseEncryption && external.capabilities.databaseToolConnection,
		"Optional bots should load approved encryption and repository-owned database-tool capabilities.",
	);
	assert(external.credentials.mode === "external" && external.fingerprint, "External bots should default to unmanaged credentials and receive a definition fingerprint.");
	let rejectedUnsafeCredentialAdapter = false;
	try {
		validateExternalBotDefinition({
			id: "unsafe-adapter",
			displayName: "Unsafe Adapter",
			repository: { url: "https://example.invalid/unsafe-adapter.git", branch: "main" },
			credentials: { mode: "adapter" },
			runtime: {},
		});
	} catch {
		rejectedUnsafeCredentialAdapter = true;
	}
	assert(rejectedUnsafeCredentialAdapter, "Credential adapters must declare both a write command and secret-encryption permission.");
	let rejectedMissingRepository = false;
	try {
		validateExternalBotDefinition({ id: "missing-repository", displayName: "Missing Repository", runtime: {} });
	} catch {
		rejectedMissingRepository = true;
	}
	assert(rejectedMissingRepository, "External bot profiles must include a real Git repository identity.");
	let rejectedNativeOverride = false;
	try {
		validateExternalBotDefinition({ id: "hachi", displayName: "Replacement", runtime: {} });
	} catch {
		rejectedNativeOverride = true;
	}
	assert(rejectedNativeOverride, "External definitions must not replace native Hachi.");
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-bot-types-"));
	try {
		fs.writeFileSync(path.join(tempRoot, "optional-bot.json"), JSON.stringify({
			id: "optional-bot",
			displayName: "Optional Bot",
			repository: { url: "https://example.invalid/optional-bot.git", branch: "main" },
			runtime: { ecosystemFile: "ecosystem.config.js" },
		}));
		const loaded = loadBotDefinitions(tempRoot);
		assert(loaded.errors.length === 0 && loaded.definitions.length === 2, "Registry should load native Hachi plus optional definitions.");
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
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
function workflowJobBlock(workflowSource, jobName) {
	const lines = String(workflowSource || "").split(/\r?\n/u);
	const header = `  ${jobName}:`;
	const start = lines.findIndex(line => line === header);

	if (start < 0) {
		return "";
	}

	const endOffset = lines.slice(start + 1).findIndex(line => /^ {2}[A-Za-z0-9_-]+:\s*$/u.test(line));
	const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
	return lines.slice(start, end).join("\n");
}
function restoreEnvValue(name, value) {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

function validatePackageMetadata() {
	const pkg = readJson("package.json");
	const lock = readJson("package-lock.json");
	const rootPackage = lock.packages?.[""];
	// Release builds must not let Electron Builder auto-publish before the workflow upload step.
	const distScript = "electron-builder --win --publish=never && node scripts/copyRootInstaller.js";
	const installerScript = "electron-builder --win nsis --publish=never && node scripts/copyRootInstaller.js";
	const portableScript = "electron-builder --win portable --publish=never";
	assert(pkg.name === "hachigen", "package.json name should be hachigen.");
	assert(pkg.version === lock.version, "package.json and package-lock.json versions do not match.");
	assert(rootPackage?.version === pkg.version, "package-lock root package version does not match package.json.");
	assert(pkg.author?.name === "FearlessKenji", "package.json author should identify the HachiGen publisher.");
	assert(pkg.license === "MIT", "package.json should declare the repository license.");
	assert(pkg.scripts?.check?.includes("node --check main.js"), "package.json is missing the check script.");
	assert(pkg.scripts?.lint === "eslint . --config config/eslint.config.js", "package.json is missing the lint script.");
	assert(pkg.scripts?.smoke === "node scripts/smokeTest.js", "package.json is missing the smoke script.");
	assert(pkg.scripts?.["smoke:packaged-ui"] === "node scripts/packagedUiSmoke.js", "package.json is missing the packaged UI smoke script.");
	assert(pkg.scripts?.dist === distScript, "package.json should build all Windows release targets without implicit CI publishing and copy the installer to the root.");
	assert(pkg.scripts?.["dist:installer"] === installerScript, "package.json should include an installer-only build script without implicit CI publishing that copies the installer to the root.");
	assert(pkg.scripts?.["dist:portable"] === portableScript, "package.json should include a portable-only build script without implicit CI publishing.");
	assert(pkg.build?.productName === "HachiGen", "Electron Builder productName should be HachiGen.");
	assert(pkg.build?.copyright === "Copyright (c) 2026 FearlessKenji", "Electron Builder should include copyright metadata.");
	assert(pkg.build?.artifactName === "HachiGen.${ext}", "Electron Builder artifactName should produce HachiGen.exe.");
	assert(pkg.build?.files?.includes("docs/patch-notes.md"), "Packaged app should include patch notes for the in-app About dialog.");
	assert(pkg.build?.win?.executableName === "HachiGen", "Windows executableName should be HachiGen.");
	assert(pkg.build?.win?.requestedExecutionLevel === "asInvoker", "Windows executable should not request administrator privileges by default.");
	assert(pkg.build?.win?.signtoolOptions?.signingHashAlgorithms?.includes("sha256"), "Windows signing should prefer SHA-256 signatures.");
	assert(pkg.build?.nsis?.artifactName === "HachiGen-Setup-${version}.${ext}", "NSIS installer artifact should be versioned.");
	assert(pkg.build?.nsis?.oneClick === false && pkg.build?.nsis?.allowToChangeInstallationDirectory === true, "NSIS should use an assisted installer with a selectable install path.");
	assert(pkg.build?.nsis?.perMachine === false, "NSIS should default to a per-user AppData install.");
	assert(pkg.build?.nsis?.createDesktopShortcut === true, "NSIS should offer a desktop shortcut option.");
	assert(pkg.build?.portable?.artifactName === "HachiGen.${ext}", "Portable artifact should remain HachiGen.exe for self-updates.");
	const windowsTargets = (pkg.build?.win?.target || []).map(target => target.target);
	assert(windowsTargets.includes("nsis") && windowsTargets.includes("portable"), "Windows build should include installer and portable targets.");
	assert(pkg.repository?.url?.includes("FearlessKenji/HachiGen"), "package metadata should point at the HachiGen repo.");
	assert(!fs.existsSync(path.join(projectRoot, "Build-Installer.ps1")), "Repository root should not contain a PowerShell installer helper.");
	assert(readSource("README.md").includes("HachiGen-Setup-X.X.X.exe") && readSource("README.md").includes("Uninstall HachiGen.exe"), "README should point cloned users to the root installer and installed uninstaller.");
	for (const packageName of Object.keys(pkg.devDependencies || {})) {
		assert(lock.packages?.[`node_modules/${packageName}`], `package-lock.json is missing node_modules/${packageName}.`);
	}
}

function validateProjectFiles() {
	const requiredFiles = [
		"CHANGELOG.md", "README.md", ".github/workflows/ci.yml", ".github/workflows/release.yml",
		"config/eslint.config.js", "docs/bot-definitions.md", "docs/patch-notes.md", "icon.ico", "main.js", "package-lock.json",
		"package.json", "preload.js", "renderer/app.js", "renderer/assets/KenjiBotProfile.svg",
		"renderer/index.html", "renderer/styles.css", "scripts/copyRootInstaller.js", "scripts/packagedUiSmoke.js", "scripts/smokeTest.js",
		"src/botRegistry.js", "src/configuration.js", "src/database-worker.js", "src/hachigenLogger.js", "src/manager.js", "src/shell.js", "src/sqlite-viewer-worker.js",
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
	assert(
		workflow.includes("npm run dist") &&
		workflow.includes("dist/HachiGen.exe") &&
		workflow.includes("dist/HachiGen-Setup-$env:RELEASE_VERSION.exe"),
		"Release workflow should build and upload installer and portable assets.",
	);
	assert(workflow.includes("npm run smoke:packaged-ui"), "Release workflow should launch the packaged UI before uploading assets.");
	assert(workflow.includes("Get-FileHash") && workflow.includes("dist/SHA256SUMS.txt"), "Release workflow should publish SHA-256 checksums.");
	assert(workflow.includes("HACHIGEN_WIN_CSC_LINK") && workflow.includes("WIN_CSC_LINK"), "Release workflow should pass optional Windows signing secrets.");
	assert(workflow.includes("--latest"), "Standalone HachiGen releases should mark the newest HachiGen release as latest.");
	const ciCheckJob = workflowJobBlock(ci, "check");
	const ciLintJob = workflowJobBlock(ci, "lint");
	const ciSmokeJob = workflowJobBlock(ci, "smoke");
	assert(ciCheckJob.includes("name: check") && ciCheckJob.includes("npm run check"), "CI workflow should run check in its own job.");
	assert(ciLintJob.includes("name: lint") && ciLintJob.includes("npm run lint"), "CI workflow should run lint in its own job.");
	assert(ciSmokeJob.includes("name: smoke") && ciSmokeJob.includes("npm run smoke"), "CI workflow should run smoke in its own job.");
	assert(!ciCheckJob.includes("npm run lint") && !ciCheckJob.includes("npm run smoke"), "CI check job should not run lint or smoke.");
	assert(!ciLintJob.includes("npm run check") && !ciLintJob.includes("npm run smoke"), "CI lint job should not run check or smoke.");
	assert(!ciSmokeJob.includes("npm run check") && !ciSmokeJob.includes("npm run lint"), "CI smoke job should not run check or lint.");
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
	assert(
		mainSource.includes("label: \"Export HachiGen Logs\"") &&
		mainSource.includes("label: \"Export Diagnostics Bundle\"") &&
		mainSource.includes("label: \"Export Runtime Archive...\"") &&
		mainSource.includes("label: \"Restore Runtime Archive...\"") &&
		mainSource.includes("label: \"Check for Updates\""),
		"Application menu is missing log export, diagnostics export, runtime archive, or update check actions.",
	);
	assert(!mainSource.includes("label: \"Edit\"") && !mainSource.includes("toggleDevTools") && !mainSource.includes("resetZoom"), "Application menu should not expose Edit, DevTools, or zoom controls.");
	assert(preloadSource.includes("checkVersionUpdates") && rendererSource.includes("api.checkVersionUpdates()"), "Version update menu action is not wired through preload and renderer.");
	assert(
		preloadSource.includes("getDiagnostics") &&
		preloadSource.includes("exportSupportBundle") &&
		rendererSource.includes("api.exportSupportBundle()"),
		"Diagnostics bundle IPC actions are not wired.",
	);
	assert(
		preloadSource.includes("pullRemoteDatabase") &&
		preloadSource.includes("pushLocalDatabaseToRemote") &&
		mainSource.includes("manager:pull-remote-database") &&
		mainSource.includes("manager:push-local-database-to-remote"),
		"Database transfer IPC actions are not wired.",
	);
	const databaseSection = indexSource.match(/<section class="view" data-view-panel="database">[\s\S]*?<section class="view" data-view-panel="logs">/u)?.[0] || "";
	const dashboardSection = indexSource.match(/<section class="view active" data-view-panel="dashboard">[\s\S]*?<section class="view" data-view-panel="setup">/u)?.[0] || "";
	const fleetSection = indexSource.match(/<section class="view" data-view-panel="fleet">[\s\S]*?<section class="view" data-view-panel="logs">/u)?.[0] || "";
	assert(
		fleetSection.includes("Bot Profiles") &&
			fleetSection.includes("Open Folder") &&
			fleetSection.includes("Choose Key") &&
			fleetSection.includes("Review Bot") &&
			!fleetSection.includes(">Environment<") &&
			!fleetSection.includes("Paldeck") &&
			!fleetSection.includes("Hachi is native") &&
			rendererSource.includes('type => type.source === "external"'),
		"Fleet should use profile-based onboarding, assume production, and exclude the built-in runtime.",
	);
	assert(
		!fleetSection.includes('id="fleetServerSelect"') &&
		indexSource.includes("Initial setup requires a local repository") &&
		rendererSource.includes('values.serverId = "local"') &&
		managerSource.includes("Initial bot setup requires a local repository"),
		"Additional-bot onboarding should require a local repository before remote deployment.",
	);
	assert(
		dashboardSection.includes('id="dashboardBotCardLabel">Hachi</div>') &&
			!dashboardSection.includes('<div class="card-label">Fleet</div>') &&
			indexSource.includes('id="globalBotSelect"') &&
			indexSource.includes('id="botViewNav"') &&
			!fleetSection.includes('id="fleetSelectedDeploymentSelect"') &&
			!fleetSection.includes('class="status-grid fleet-status-grid"') &&
			rendererSource.includes("SELECTED_BOT_KEY") &&
			rendererSource.includes("renderExternalDashboard") &&
			stylesSource.includes(".bot-selector") &&
			preloadSource.includes("getFleetDeploymentOverview") &&
			mainSource.includes("manager:get-fleet-deployment-overview"),
		"The global bot context should drive shared views while Fleet remains an inventory manager.",
	);
	assert(
		rendererSource.includes("function renderStatusCard(") &&
		rendererSource.includes("function renderCheckList(") &&
			!indexSource.includes("selected-bot-") &&
			!rendererSource.includes("copy-external-config-secret") &&
			indexSource.includes('data-action="start">Start</button>'),
		"Hachi and additional bots should share renderer components and standard action names.",
	);
	assert(
		preloadSource.includes("getStartupState") &&
			mainSource.includes("manager:get-startup-state") &&
			managerSource.includes("getStartupState()") &&
			/async function init\(\)[\s\S]*api\.getStartupState\(\)[\s\S]*selectedBotId === HACHI_BOT_ID[\s\S]*refreshFleetOverview\(\)/u.test(rendererSource) &&
			!/async function init\(\)[\s\S]*await refreshConfig\(\)[\s\S]*await refreshLogs\(\)[\s\S]*await refreshTestingProfiles\(\)/u.test(rendererSource),
		"Startup should use the lightweight selected-bot snapshot and defer configuration, logs, and testing data.",
	);
	assert(
		indexSource.includes('id="databaseSourceSelect"') &&
		indexSource.includes('class="select-field inline-select-field"') &&
		preloadSource.includes("readTestingDatabaseTable") &&
		mainSource.includes("manager:read-testing-database-table") &&
		managerSource.includes("async readTestingDatabaseTable") &&
		rendererSource.includes('join(", ")'),
		"The shared viewer should support inline Production/Testing sources and preserve visible testing guild-ID separators.",
	);
	assert(
		managerSource.includes('this.getRuntimeTarget() === "remote"') &&
			managerSource.includes("repository = await readRepository()") &&
			managerSource.includes("scan = await readScan()") &&
			managerSource.includes("[repository, scan, database, pm2] = await Promise.all([") &&
			managerSource.includes('context.server.connection.type === "ssh" ? [] : await Promise.allSettled'),
		"Local state probes should remain concurrent while remote state and Fleet overview probes are serialized.",
	);
	assert(
		/selectedBotId === HACHI_BOT_ID\)[\s\S]*refreshState\(\)\.catch/u.test(rendererSource),
		"Switching back to Hachi should replace the lightweight startup snapshot with complete native state.",
	);
	assert(
		managerSource.includes("const targetBranch = branch.stdout.trim() || context.deployment.repositoryBranch"),
		"Live checked-out branches should override saved installation branch snapshots.",
	);
	assert(
		preloadSource.includes("reapproveFleetDeployment") &&
			mainSource.includes("manager:reapprove-fleet-deployment") &&
			managerSource.includes("async reapproveFleetDeployment(deploymentId)") &&
			indexSource.includes('id="reapproveBotProfileButton"'),
		"Changed external profiles should have an explicit validated reapproval workflow.",
	);
	assert(
		managerSource.includes('await attempt("restore code"') &&
			managerSource.includes('await attempt("restore dependencies"') &&
			managerSource.includes('await attempt("restore database"') &&
			managerSource.includes('await attempt("restart previous runtime"'),
		"Fleet update rollback should report code, dependency, database, and runtime recovery separately.",
	);
	assert(
		managerSource.includes("async readRemoteConfigurationFiles()") &&
			managerSource.includes("const files = await this.readRemoteConfigurationFiles();") &&
			!managerSource.includes("const [blankEnv, env, blankConfigText, configText] = await Promise.all(["),
		"Remote Hachi configuration should use one structured SSH read instead of four concurrent sessions.",
	);
	assert(
		indexSource.includes('id="sharedRemoteGrid"') &&
			!indexSource.includes('id="externalRemoteGrid"') &&
			rendererSource.includes("function renderExternalRemote(") &&
			rendererSource.includes("api.testFleetRemoteConnection(readRemoteForm())") &&
			rendererSource.includes("uses a different SSH key") &&
			managerSource.includes("async executeRemoteConnectionTest(settings)") &&
			preloadSource.includes("testFleetRemoteConnection") &&
			mainSource.includes("manager:test-fleet-remote-connection"),
		"Hachi and additional bots should share Remote Connection controls and testing without silently replacing shared SSH keys.",
	);
	assert(
		!indexSource.includes('id="externalBotSummary"') &&
			indexSource.includes('id="hachiConfigurationFields"') &&
			indexSource.includes('id="externalConfigurationFields" hidden') &&
			rendererSource.includes('$("#hachiConfigurationFields").hidden = external'),
		"The bot page should reuse Hachi's native layout and switch only its Configuration fields.",
	);
	assert(
		rendererSource.includes('candidate.detected.ecosystemFound ? definition.runtime.ecosystemFile : "Not detected"') &&
			managerSource.includes("That SSH connection already exists as"),
		"Fleet review should distinguish a detected ecosystem file and reject duplicate SSH endpoints.",
	);
	assert(
		indexSource.includes('data-view="testing"') &&
			indexSource.includes('data-view-panel="testing"') &&
			indexSource.includes('id="testingProfileForm"') &&
			indexSource.includes('id="testingDeploymentSelect"') &&
			indexSource.includes('data-action="start-testing-bot"') &&
			indexSource.includes('data-action="reset-testing-commands"') &&
			indexSource.includes('data-action="reapprove-testing-profile"') &&
			preloadSource.includes("getTestingProfiles") &&
			preloadSource.includes("resetTestingCommands") &&
			mainSource.includes("manager:reset-testing-commands") &&
			managerSource.includes("async resetTestingCommands") &&
			preloadSource.includes("startTestingBot") &&
			preloadSource.includes("copyTestingSecret") &&
			mainSource.includes("manager:copy-testing-secret") &&
			mainSource.includes("manager:start-testing-bot") &&
			managerSource.includes('path.join(this.profilesDir, "Testing")') &&
			managerSource.includes("os:v1:") &&
			rendererSource.includes('testing: "flask"') &&
			managerSource.includes("fleet: this.getFleetState()") &&
			indexSource.includes("The production process can remain online") &&
			!managerSource.includes("Stop this bot's production PM2 process before starting a test identity."),
		"Testing identities should be protected, runnable, and iconized, while Fleet hydrates in the startup state.",
	);
	assert(
		!/<label>/u.test(indexSource) &&
			stylesSource.includes(".field,\n.select-field,\n.choice-field") &&
			stylesSource.includes(".empty-state") &&
			/\.form-actions \{[\s\S]*?margin-top: 0;[\s\S]*?padding-top: 14px;/u.test(stylesSource) &&
			indexSource.includes('PM2 process name <span class="optional-label">(Optional)</span>'),
		"Forms should use shared field, choice, empty-state, and action components instead of bare page-specific controls.",
	);
	assert(
		!indexSource.includes('data-view="credentials"') &&
			!indexSource.includes('data-view-panel="credentials"') &&
			indexSource.includes('id="fleetCredentialFormTemplate"') &&
			indexSource.includes('id="manageBotCredentialsButton"') &&
			rendererSource.includes("showFleetCredentialModal(button.dataset.itemId || selectedBotId)"),
		"Approved additional-bot credentials should live in the selected bot Configuration header rather than Fleet inventory.",
	);
	assert(
		!rendererSource.includes('{ action: "fleet-runtime-start"') &&
			!rendererSource.includes('{ action: "fleet-runtime-stop"') &&
			!rendererSource.includes('{ action: "fleet-runtime-restart"') &&
			!rendererSource.includes('{ action: "fleet-runtime-health"') &&
			rendererSource.includes('{ action: "remove-fleet-deployment"') &&
			!indexSource.includes('id="fleetDeploymentOutput"'),
		"Fleet bot rows should retain only inventory selection and removal instead of duplicating shared operational controls.",
	);
	assert(
		rendererSource.includes('"choose-fleet-bot-folder": "folder"') &&
			/fleetEntry[\s\S]*decorateControlIcon\(button, iconNameForControl\(button\)\)/u.test(rendererSource),
		"Fleet static and generated action buttons should use the shared icon system.",
	);
	assert(
		databaseSection.includes("Backup / Transfer") &&
			!databaseSection.includes("Backup / Transfer...") &&
			!databaseSection.includes("data-action=\"restore-database\""),
		"Database tab should expose Backup / Transfer as the single backup entry point.",
	);
	assert(
		!databaseSection.includes('id="externalDatabasePanel"') &&
			databaseSection.includes('id="hachiDatabaseActions"') &&
			!databaseSection.includes('id="fleetDatabaseActions"') &&
			!databaseSection.includes('id="fleetDatabaseMaintenanceControls"') &&
			rendererSource.includes("function renderExternalDatabase(overview)"),
		"Hachi and additional bots should use one Database composition and one shared action row.",
	);
	assert(
		!rendererSource.includes("externalUpdatesOutput") &&
			!indexSource.includes('id="externalUpdatesPanel"') &&
			rendererSource.includes("function renderExternalUpdates(overview)"),
		"Additional bots should populate the shared Updates view instead of rendering a parallel panel.",
	);
	assert(
		rendererSource.includes("api.readFleetDatabaseTable(selectedBotId, selectedTable, sort)") &&
			!rendererSource.includes('"#hachiDatabaseViewerPanel", "#hachiDatabaseReviewPanel"'),
		"Additional bots should use the generic read-only database viewer while retaining the shared sanitation panel.",
	);
	assert(
		rendererSource.includes('testingSource ? (testingEncrypted ? "Rotate Key" : "Encrypt Data")') &&
			rendererSource.includes("api.protectTestingDatabase(selectedBotId, profileId)") &&
			!managerSource.includes("await this.prepareEncryptedTestingDatabase(context, testDatabase)"),
		"Testing database encryption should be explicit, source-aware, and immediately refreshable instead of running during test startup.",
	);
	assert(
		rendererSource.includes("Additional bots must refresh through their selected deployment adapter") &&
			rendererSource.includes("await refreshFleetOverview()") &&
			rendererSource.includes("if (selectedBotId === HACHI_BOT_ID) {\n\t\t\trenderStashedChanges"),
		"Shared actions should not repaint native Hachi database state over a selected external bot.",
	);
	assert(
		rendererSource.includes("Installation-bound data must never survive a local/remote switch") &&
			rendererSource.includes("fleetBackupState = []") &&
			rendererSource.includes('if (activeView === "database") await loadDatabaseViewer()'),
		"Switching an additional bot's active installation should invalidate and reload location-bound database state.",
	);
	assert(
		managerSource.includes("Viewing is observational") &&
			!managerSource.includes("Review and reapprove this deployment before reading its database"),
		"Read-only Fleet database viewing should remain available while a changed profile awaits mutation approval.",
	);
	assert(
		rendererSource.includes("function showDatabaseBackupTransferModal(") &&
			rendererSource.includes("Pull From Remote") &&
			rendererSource.includes("Push To Remote") &&
			rendererSource.includes("re-encrypt the transferred copy") &&
			rendererSource.includes("function showDatabaseTransferStatus(") &&
			stylesSource.includes(".modal-progress-working"),
		"Database backup/transfer modal or transfer progress status is not wired.",
	);
	assert(
		managerSource.includes("prepareDatabaseBytesForTransfer") &&
			managerSource.includes("databaseTransferTransformScript") &&
			managerSource.includes("rekeyEncryptedDatabase") &&
			managerSource.includes("ensureRemoteDatabaseProtectionKeyForTransfer") &&
			managerSource.includes("ensureLocalDatabaseProtectionKeyForTransfer"),
		"Database transfers should re-encrypt transferred copies with the destination database key.",
	);
	assert(indexSource.includes("id=\"remotePreviewLastTest\"") && managerSource.includes("lastRemoteTest"), "Remote profile should show the last connection test result.");
	assert(
		!indexSource.includes('data-view="remote"') &&
			!indexSource.includes('data-view-panel="remote"') &&
			indexSource.includes('id="remoteConnectionPanel"') &&
			rendererSource.includes('showView("setup");\n\t\twindow.requestAnimationFrame(() => $("#remoteConnectionPanel")'),
		"Remote runtime settings should live inside Hachi and existing shortcuts should route to that panel.",
	);
	assert(mainSource.includes("manager:check-hachigen-updates") && mainSource.includes("manager:install-hachigen-update"), "Main process should handle HachiGen self-update channels.");
	assert(preloadSource.includes("installHachiGenUpdate") && rendererSource.includes("api.installHachiGenUpdate()"), "Self-update install action is not wired.");
	assert(indexSource.includes("id=\"hachigenUpdateMeta\"") && stylesSource.includes(".update-wizard-progress"), "Update wizard UI or styles are missing.");
	assert(indexSource.includes("Content-Security-Policy") && indexSource.includes("connect-src 'none'"), "Renderer should define a restrictive Content Security Policy.");
	assert(mainSource.includes("contextIsolation: true") && mainSource.includes("nodeIntegration: false") && mainSource.includes("sandbox: true"), "BrowserWindow should keep the renderer isolated and sandboxed.");
	assert(!indexSource.includes("id=\"activeInstallPath\"") && !rendererSource.includes("HachiGen Version"), "Global path/version metadata should stay consolidated into sidebar, About, and Diagnostics surfaces.");
	assert(
		!indexSource.includes("id=\"nextActionPanel\"") &&
			indexSource.includes("id=\"dashboardCheckUpdatesButton\"") &&
			!indexSource.includes(">Open Updates</button>") &&
			indexSource.includes("data-action=\"show-remote\"") &&
			stylesSource.includes("margin-top: auto"),
		"Dashboard should use one real update-check button and bottom-aligned panel actions.",
	);
	assert(
		indexSource.includes("data-action=\"check-all-updates\"") &&
			indexSource.includes("id=\"hachiCurrentVersion\"") &&
			indexSource.includes("id=\"hachigenCurrentVersion\"") &&
			indexSource.includes("class=\"stash-header\"") &&
			!indexSource.includes("id=\"incomingCommitsList\"") &&
			!indexSource.includes("id=\"localChangesList\""),
		"Updates view should use combined update checking and version summaries instead of always-visible Git detail panels.",
	);
	assert(indexSource.includes("data-view=\"diagnostics\"") && indexSource.includes("data-action=\"export-support-bundle\""), "Diagnostics view or diagnostics bundle action is missing.");
	assert(
		indexSource.indexOf('data-view="setup">Hachi') > indexSource.indexOf('data-view="dashboard">Dashboard') &&
			indexSource.indexOf('data-view="setup">Hachi') < indexSource.indexOf('data-view="fleet">Fleet') &&
			rendererSource.includes('setup: "Hachi"') &&
			!rendererSource.includes('actionLabel: "Open Setup"'),
		"The Hachi management page should be named Hachi and appear directly below Dashboard.",
	);
	assert(
		preloadSource.includes("getAboutInfo") &&
			rendererSource.includes("function showAboutModal(") &&
			rendererSource.includes("[\"User Data\"") &&
			mainSource.includes("manager:get-about-info") &&
			managerSource.includes("latestReleaseNotesSection"),
		"In-app About, paths, and release notes surface is not wired.",
	);
	assert(
		mainSource.includes("requestSingleInstanceLock") &&
			mainSource.includes("saveWindowState") &&
			mainSource.includes("getWindowState"),
		"Main process should enforce single-instance behavior and remember window state.",
	);
	assert(mainSource.includes("isAllowedExternalUrl") && mainSource.includes("will-navigate") && mainSource.includes("Blocked external link"), "External links should be restricted to known destinations.");
	assert(mainSource.includes("showRecoveryNoticeIfNeeded") && mainSource.includes("getPendingRecoveryEvent"), "Startup recovery notice is not wired.");
	assert(managerSource.includes("hachigen-runtime-archive-v1") && managerSource.includes("restoreRuntimeArchive"), "Runtime archive export/restore support is missing.");
	assert(rendererSource.includes("function setupRecommendation(") && rendererSource.includes("function showSetupGuideModal("), "Renderer is missing setup recommendation or guide modal logic.");
	const setupUpdateStepIndex = rendererSource.indexOf("id: \"updates\"");
	const setupRuntimeStepIndex = rendererSource.indexOf("id: \"runtime\"");
	assert(
		setupUpdateStepIndex !== -1 && setupRuntimeStepIndex !== -1 && setupUpdateStepIndex < setupRuntimeStepIndex,
		"Setup progress should check or review updates before offering to start Hachi.",
	);
	assert(rendererSource.includes("Check updates before starting Hachi."), "Update-check setup step should explain that updates come before starting Hachi.");
	assert(rendererSource.includes("ICON_PATHS") && rendererSource.includes("installRendererDiagnosticsHooks"), "Renderer is missing icon decoration or diagnostics error hooks.");
	assert(
		stylesSource.includes(".dashboard-grid") &&
		stylesSource.includes(".setup-guide-step") &&
		stylesSource.includes(".diagnostics-grid") &&
		stylesSource.includes(".ui-icon"),
		"Setup guide/dashboard/diagnostics styles are missing.",
	);
	assert(
		mainSource.includes("render-process-gone") &&
			mainSource.includes("HACHIGEN_UI_SMOKE_RESULT") &&
			rendererSource.includes("window.__runHachiGenUiSmoke") &&
			readSource("scripts", "packagedUiSmoke.js").includes("renderer workflow checks"),
		"Packaged UI smoke should execute renderer workflow checks and log renderer recovery events.",
	);
	assert(!indexSource.includes("Install Latest") && !rendererSource.includes("Install Latest") && !managerSource.includes("Install Latest"), "HachiGen update UI should not show the old Install Latest action.");
	assert(managerSource.includes("Updates are available: Version") && managerSource.includes("HachiGen is up to date."), "HachiGen update status copy should stay concise.");
	const relaunchesInHiddenUpdater = mainSource.includes("-WindowStyle") &&
		mainSource.includes("Hidden") &&
		mainSource.includes("-PassThru") &&
		mainSource.includes("app.exit(0)") &&
		!mainSource.includes("tasklist /FI");
	assert(relaunchesInHiddenUpdater, "Self-update helper should relaunch cleanly without the old visible cmd loop.");
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

async function validateSelfUpdateUsesRunningVersion() {
	const { HachiManager } = requireFresh("src", "manager.js");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-update-current-"));

	try {
		const manager = new HachiManager({
			defaultInstallPath: tempDir,
			managerRoot: projectRoot,
			userDataPath: path.join(tempDir, "userData"),
		});

		manager.settings.hachiGenReleaseTag = "hachigen-v1.0.1";
		manager.fetchLatestHachiGenRelease = async () => ({
			assetName: "HachiGen.exe",
			assetSize: 91540685,
			assetUrl: "https://example.invalid/HachiGen.exe",
			latestTag: `hachigen-v${manager.getHachiGenVersion()}`,
			publishedAt: "2026-07-14T12:00:00.000Z",
			releaseName: `HachiGen v${manager.getHachiGenVersion()}`,
			releaseUrl: "https://example.invalid/hachigen",
		});

		const update = await manager.checkHachiGenUpdates();

		assert(update.status === "current", "Running the latest package version should report current even if the saved release tag is stale.");
		assert(update.canInstall === false, "Current HachiGen versions should not enable the update action.");
		assert(update.updateAvailable === false, "Current HachiGen versions should not be marked updateAvailable.");
		assert(update.message === "HachiGen is up to date.", "Current HachiGen status should use concise copy.");
		assert(update.currentTag === update.latestTag, "Successful current checks should reconcile the saved HachiGen release tag.");
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}
}

async function validateDiagnosticsBundle() {
	const { HachiManager } = requireFresh("src", "manager.js");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-diagnostics-"));

	try {
		const manager = new HachiManager({
			defaultInstallPath: tempDir,
			managerRoot: projectRoot,
			userDataPath: path.join(tempDir, "userData"),
		});

		manager.getPm2Status = async () => ({
			installed: false,
			message: "PM2 unavailable in smoke test.",
			registered: false,
			status: "missing",
			target: "local",
		});
		manager.getDatabaseState = async () => ({
			exists: false,
			source: "local",
		});
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "logs", "hachi.log"), "Hachi runtime TOKEN=smoke-hachi-token failed.", "utf8");
		manager.log("TOKEN=smoke-secret-token failed during diagnostics bundle test.");

		const diagnostics = await manager.getDiagnostics();
		const bundlePath = path.join(tempDir, "hachigen-diagnostics.tar.gz");
		const result = await manager.exportSupportBundle(bundlePath);
		const bundleText = zlib.gunzipSync(fs.readFileSync(bundlePath)).toString("utf8");

		assert(diagnostics.app.hachiGenVersion, "Diagnostics should include the HachiGen version.");
		assert(result.ok === true && fs.existsSync(bundlePath), "Diagnostics bundle archive was not created.");
		assert(bundleText.includes("diagnostics.json") && bundleText.includes("recent-events.json"), "Diagnostics bundle is missing diagnostics files.");
		assert(bundleText.includes("logs/hachi-runtime/local/hachi.log"), "Diagnostics bundle is missing local Hachi logs.");
		assert(bundleText.includes("Hachi runtime"), "Diagnostics bundle should include readable Hachi log output.");
		assert(bundleText.includes("[redacted]"), "Diagnostics bundle should retain redaction markers.");
		assert(!bundleText.includes("smoke-secret-token"), "Diagnostics bundle leaked a redacted secret.");
		assert(!bundleText.includes("smoke-hachi-token"), "Diagnostics bundle leaked a redacted Hachi log secret.");

		manager.settings.runtimeTarget = "remote";
		manager.settings.remote = {
			host: "example.invalid",
			pm2Name: "Hachi",
			remotePath: "~/Hachi",
			username: "hachi",
		};
		manager.readRemoteLogs = async () => "Remote PM2 TOKEN=smoke-remote-pm2-token failed.";
		manager.readRemoteRuntimeLogFiles = async () => ({
			exists: true,
			files: [
				{
					modifiedAt: "2026-07-16T00:00:00.000Z",
					name: "remote-hachi.log",
					size: 64,
					text: "Remote Hachi TOKEN=smoke-remote-hachi-token failed.",
					truncated: false,
				},
			],
		});

		const remoteBundleFolder = path.join(tempDir, "remote-diagnostics");
		const remoteRuntimeLogs = await manager.writeRuntimeLogsToBundle(remoteBundleFolder);
		const remotePm2Text = fs.readFileSync(path.join(remoteBundleFolder, "logs", "hachi-runtime", "remote", "pm2-snapshot.log"), "utf8");
		const remoteHachiText = fs.readFileSync(path.join(remoteBundleFolder, "logs", "hachi-runtime", "remote", "remote-hachi.log"), "utf8");

		assert(remoteRuntimeLogs.files.length === 2, "Remote diagnostics should include PM2 and Hachi log files.");
		assert(remotePm2Text.includes("[redacted]") && remoteHachiText.includes("[redacted]"), "Remote Hachi logs should be redacted.");
		assert(!remotePm2Text.includes("smoke-remote-pm2-token"), "Remote PM2 diagnostics leaked a redacted secret.");
		assert(!remoteHachiText.includes("smoke-remote-hachi-token"), "Remote Hachi diagnostics leaked a redacted secret.");
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}
}

async function validateRuntimeArchiveRoundTrip() {
	const { HachiManager } = requireFresh("src", "manager.js");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-runtime-"));
	const originalAppData = process.env.APPDATA;
	const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

	try {
		process.env.APPDATA = path.join(tempDir, "appData");
		process.env.XDG_CONFIG_HOME = path.join(tempDir, "xdgConfig");

		const sourceRoot = path.join(tempDir, "sourceHachi");
		const restoreRoot = path.join(tempDir, "restoreHachi");
		const externalKeyDir = path.join(tempDir, "externalKeys");
		const databaseKeyPath = path.join(externalKeyDir, "db.key");
		const secretsKeyPath = path.join(externalKeyDir, "secrets.key");

		fs.mkdirSync(path.join(sourceRoot, "config"), { recursive: true });
		fs.mkdirSync(path.join(sourceRoot, "database"), { recursive: true });
		fs.mkdirSync(path.join(sourceRoot, "node_modules", "ignored"), { recursive: true });
		fs.mkdirSync(path.join(sourceRoot, "exports"), { recursive: true });
		fs.mkdirSync(path.join(sourceRoot, "logs"), { recursive: true });
		fs.mkdirSync(path.join(sourceRoot, ".git"), { recursive: true });
		fs.mkdirSync(externalKeyDir, { recursive: true });
		fs.writeFileSync(path.join(sourceRoot, "package.json"), JSON.stringify({ name: "hachi" }), "utf8");
		fs.writeFileSync(path.join(sourceRoot, "index.js"), "console.log('hachi');\n", "utf8");
		fs.writeFileSync(path.join(sourceRoot, ".env"), [
			"TOKEN=\"runtime-token\"",
			`HACHI_DB_KEY_FILE=${JSON.stringify(databaseKeyPath)}`,
			`HACHI_SECRETS_KEY_FILE=${JSON.stringify(secretsKeyPath)}`,
			"",
		].join("\n"), "utf8");
		fs.writeFileSync(path.join(sourceRoot, "config", "config.json"), JSON.stringify({ guildIds: ["123"] }), "utf8");
		fs.writeFileSync(path.join(sourceRoot, "database", "database.sqlite"), "sqlite-content", "utf8");
		fs.writeFileSync(path.join(sourceRoot, "node_modules", "ignored", "package.js"), "ignored", "utf8");
		fs.writeFileSync(path.join(sourceRoot, "exports", "old.tar.gz"), "ignored", "utf8");
		fs.writeFileSync(path.join(sourceRoot, "logs", "hachi.log"), "ignored", "utf8");
		fs.writeFileSync(path.join(sourceRoot, ".git", "config"), "ignored", "utf8");
		fs.writeFileSync(databaseKeyPath, "database-key\n", "utf8");
		fs.writeFileSync(secretsKeyPath, "secrets-key\n", "utf8");

		const exporter = new HachiManager({
			defaultInstallPath: sourceRoot,
			managerRoot: projectRoot,
			userDataPath: path.join(tempDir, "exporterUserData"),
		});
		exporter.checkpointDatabase = async () => undefined;

		const exported = await exporter.exportRuntimeArchive({ source: "local" });
		const preview = exporter.previewRuntimeArchive(exported.archivePath);

		assert(exported.ok === true && fs.existsSync(exported.archivePath), "Runtime archive was not created.");
		assert(exported.archivePath.startsWith(path.join(sourceRoot, "exports")), "Runtime archive should be saved under the Hachi exports folder.");
		assert(preview.includesSecrets === true && preview.keyFileCount === 2, "Runtime archive should include configured external key files.");

		const restorer = new HachiManager({
			defaultInstallPath: restoreRoot,
			managerRoot: projectRoot,
			userDataPath: path.join(tempDir, "restorerUserData"),
		});
		restorer.checkpointDatabase = async () => undefined;

		const restored = await restorer.restoreRuntimeArchive(exported.archivePath);
		const restoredEnv = fs.readFileSync(path.join(restoreRoot, ".env"), "utf8");

		assert(restored.ok === true, "Runtime archive restore did not report success.");
		assert(fs.readFileSync(path.join(restoreRoot, "database", "database.sqlite"), "utf8") === "sqlite-content", "Runtime archive did not restore the database.");
		assert(fs.existsSync(restorer.getLocalDatabaseKeyLocation().path), "Runtime archive did not restore the database key to the local key location.");
		assert(fs.existsSync(restorer.getLocalSecretsKeyLocation().path), "Runtime archive did not restore the secrets key to the local key location.");
		assert(!restoredEnv.includes(databaseKeyPath) && !restoredEnv.includes(secretsKeyPath), "Runtime archive restore should rewrite remote/source key paths.");
		assert(!fs.existsSync(path.join(restoreRoot, "node_modules", "ignored", "package.js")), "Runtime archive should not restore node_modules.");
		assert(!fs.existsSync(path.join(restoreRoot, "exports", "old.tar.gz")), "Runtime archive should not restore nested exports.");
		assert(!fs.existsSync(path.join(restoreRoot, "logs", "hachi.log")), "Runtime archive should not restore logs.");
		assert(!fs.existsSync(path.join(restoreRoot, ".git", "config")), "Runtime archive should not restore Git metadata.");
	} finally {
		restoreEnvValue("APPDATA", originalAppData);
		restoreEnvValue("XDG_CONFIG_HOME", originalXdgConfigHome);
		fs.rmSync(tempDir, { force: true, recursive: true });
	}
}

async function validateDatabaseTransferOperations() {
	const { HachiManager } = requireFresh("src", "manager.js");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-db-transfer-"));

	try {
		const root = path.join(tempDir, "Hachi");
		const databaseDir = path.join(root, "database");
		const databasePath = path.join(databaseDir, "database.sqlite");
		fs.mkdirSync(databaseDir, { recursive: true });
		fs.writeFileSync(databasePath, "local-before", "utf8");
		fs.writeFileSync(`${databasePath}-wal`, "stale-wal", "utf8");

		const manager = new HachiManager({
			defaultInstallPath: root,
			managerRoot: projectRoot,
			userDataPath: path.join(tempDir, "userData"),
		});
		manager.checkpointLocalDatabase = async () => undefined;
		manager.getDatabaseState = async () => ({ exists: true, source: "local" });
		manager.readRemoteDatabaseFile = async () => ({
			bytes: Buffer.byteLength("remote-db"),
			content: Buffer.from("remote-db", "utf8").toString("base64"),
			ok: true,
		});
		manager.ensureLocalDatabaseProtectionKeyForTransfer = () => "local-key";
		manager.readRemoteDatabaseProtectionKeyIfAvailable = async () => "remote-key";
		manager.prepareDatabaseBytesForTransfer = async ({ sourceContent, sourcePath }) => {
			const content = sourceContent ? Buffer.from(sourceContent) : fs.readFileSync(sourcePath);
			return {
				bytes: content.length,
				content,
				ok: true,
				transform: "rekeyed",
			};
		};
		let localCipherTest = null;
		manager.verifyLocalDatabaseCipherOpen = async () => ({ detail: "ok", ok: true });
		manager.setDatabaseCipherTestState = value => {
			localCipherTest = value;
		};

		const pulled = await manager.pullRemoteDatabase();
		const backupFiles = fs.readdirSync(manager.getDatabaseBackupDir()).filter(file => file.startsWith("database-pre-pull-"));

		assert(pulled.ok === true, "Pull database operation did not report success.");
		assert(fs.readFileSync(databasePath, "utf8") === "remote-db", "Pull database did not replace the local database.");
		assert(!fs.existsSync(`${databasePath}-wal`), "Pull database should remove stale local WAL sidecars.");
		assert(backupFiles.length === 1, "Pull database should create one local safety backup.");
		assert(fs.readFileSync(path.join(manager.getDatabaseBackupDir(), backupFiles[0]), "utf8") === "local-before", "Pull database safety backup should contain the replaced database.");
		assert(pulled.transform === "rekeyed", "Pull database should report key-aware transfer preparation.");
		assert(localCipherTest?.ok === true, "Pull database should record destination key verification.");

		fs.writeFileSync(databasePath, "local-after", "utf8");
		let remoteBackupCreated = false;
		let pushedContent = "";
		manager.ensureRemoteDatabaseProtectionKeyForTransfer = async () => "remote-key";
		manager.verifyRemoteDatabaseCipherOpen = async () => ({ detail: "ok", ok: true });
		manager.remotePathExists = async (remotePath, type) => remotePath === "database/database.sqlite" && type === "f";
		manager.backupRemoteDatabase = async ({ fileName }) => {
			remoteBackupCreated = fileName.startsWith("database-pre-push-");
			return {
				backupPath: `manager/backups/database/${fileName}`,
				ok: true,
			};
		};
		manager.writeRemoteDatabaseFile = async content => {
			pushedContent = Buffer.from(content).toString("utf8");
			return {
				bytes: content.length,
				ok: true,
			};
		};

		const pushed = await manager.pushLocalDatabaseToRemote();

		assert(pushed.ok === true, "Push database operation did not report success.");
		assert(remoteBackupCreated, "Push database should create a remote safety backup when a remote database exists.");
		assert(pushedContent === "local-after", "Push database should send the local database bytes to remote.");
		assert(pushed.transform === "rekeyed", "Push database should report key-aware transfer preparation.");
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}
}

function validateHachiGenUpdateVerification() {
	const { HachiManager } = requireFresh("src", "manager.js");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-verify-"));

	try {
		const manager = new HachiManager({
			defaultInstallPath: tempDir,
			managerRoot: projectRoot,
			userDataPath: path.join(tempDir, "userData"),
		});
		const validExe = path.join(tempDir, "HachiGen.exe");
		const invalidExe = path.join(tempDir, "invalid.exe");
		fs.writeFileSync(validExe, Buffer.concat([Buffer.from("MZ", "ascii"), Buffer.alloc(64)]));
		fs.writeFileSync(invalidExe, "not an executable");

		const verification = manager.validateHachiGenUpdateFile(validExe);
		let invalidRejected = false;

		try {
			manager.validateHachiGenUpdateFile(invalidExe);
		} catch (error) {
			invalidRejected = error.message.includes("Windows executable");
		}

		assert(verification.status === "verified" && verification.sha256.length === 64, "Valid HachiGen downloads should receive a SHA-256 verification result.");
		assert(invalidRejected, "Invalid HachiGen downloads should be rejected before install.");
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
	assert(shellSource.includes("windowsVerbatimArguments"), "Shell wrapper should pass Windows shim commands to cmd.exe without escaped quote breakage.");
	assert(!shellSource.includes("env: { ...process.env"), "Shell wrapper should not spread process.env into spawn options.");
	assert(await commandExists("node"), "Shell wrapper should resolve the current Node command.");
	const npmVersion = await run("npm", ["--version"], {
		timeoutMs: 10000,
	});
	assert(npmVersion.stdout.trim(), "Shell wrapper should launch npm shims successfully.");
	let failedCommandExplained = false;

	try {
		await run("node", ["-e", "console.error('smoke failure detail'); process.exit(7);"], {
			timeoutMs: 1000,
		});
	} catch (error) {
		failedCommandExplained = error.message.includes("node -e [inline script]") &&
			error.message.includes("code 7") &&
			error.message.includes("smoke failure detail");
	}

	assert(failedCommandExplained, "Shell wrapper failures should include where the command failed and a concise reason.");
	const stdinResult = await run("node", ["-e", "process.stdin.pipe(process.stdout);"], {
		input: "hachigen-stdin-ok",
		timeoutMs: 1000,
	});
	assert(stdinResult.stdout === "hachigen-stdin-ok", "Shell wrapper should pipe command input through stdin.");

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
		assert(
			workerSource.includes("request.action === `view` ? {} : loadExpectedSchema(request.root)"),
			"External encrypted viewers should not require Hachi's schema audit module.",
		);
		assert(
			managerSource.includes('scripts["database:encrypt"]') && managerSource.includes('path.join(installPath, "database", "dbToolConnection.js")'),
			"Fleet inspection should discover repository-owned database encryption adapters.",
		);
		assert(
			managerSource.includes("approvedEncryptedViewer ? DATABASE_WORKER_FILE : SQLITE_VIEWER_WORKER_FILE"),
			"Fleet database viewing should select an approved encrypted adapter when available.",
		);
		assert(managerSource.includes("const remoteWorkerPath = \".hachigen/database-worker.js\""), "Remote database worker should stage into .hachigen/.");
		assert(managerSource.includes("await this.writeRemoteText(remoteWorkerPath, remoteWorkerSource)"), "Remote database worker should upload bundled source before launch.");
		assert(managerSource.includes("cat >") && managerSource.includes("input: JSON.stringify(request)"), "Remote database worker should stream source and requests through stdin.");
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}
}

function validateGenericSqliteViewerWorker() {
	const { DatabaseSync } = require("node:sqlite");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-sqlite-viewer-"));
	try {
		const databasePath = path.join(tempDir, "bot.sqlite");
		const database = new DatabaseSync(databasePath);
		database.exec("CREATE TABLE cards (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO cards (name) VALUES ('Smoke');");
		database.close();
		const output = childProcess.execFileSync(
			process.execPath,
			[resolveProject("src", "sqlite-viewer-worker.js")],
			{ cwd: tempDir, input: JSON.stringify({ dbPath: "bot.sqlite", root: ".", table: "cards" }), encoding: "utf8" },
		);
		const result = JSON.parse(output);
		assert(result.ok && result.selectedTable === "cards" && result.rows[0]?.name === "Smoke", "Generic SQLite viewer did not return the selected bot table.");
	} finally {
		fs.rmSync(tempDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
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
		fs.rmSync(tempDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
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

async function validateFleetCredentialAndBackupSecurity() {
	const { HachiManager } = requireFresh("src", "manager.js");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-fleet-security-"));
	const userDataPath = path.join(tempDir, "userData");
	const deploymentPath = path.join(tempDir, "optional-bot");
	fs.mkdirSync(path.join(deploymentPath, "data"), { recursive: true });
	fs.writeFileSync(path.join(deploymentPath, "ecosystem.config.js"), "module.exports = { apps: [] };\n");
	fs.writeFileSync(path.join(deploymentPath, "credentials-write.js"), [
		"const fs=require('node:fs'),crypto=require('node:crypto');",
		"const p=JSON.parse(fs.readFileSync(0,'utf8'));",
		"fs.writeFileSync('credentials.enc',JSON.stringify({clientId:p.clientId,tokenHash:crypto.createHash('sha256').update(p.token).digest('hex')}));",
	].join(""));
	fs.writeFileSync(path.join(deploymentPath, "start-test.js"), [
		"const fs=require('node:fs'),path=require('node:path');",
		"const db=process.env.OPTIONAL_BOT_DATABASE_PATH;",
		"fs.mkdirSync(path.dirname(db),{recursive:true});fs.writeFileSync(db,'isolated test database');",
		"console.log(process.env.TOKEN);setInterval(()=>{},1000);",
	].join(""));
	fs.writeFileSync(path.join(deploymentPath, "plaintext.js"), [
		"const fs=require('node:fs');",
		"const p='data/bot.sqlite',h=Buffer.from('SQLite format 3\\0');",
		"if(!fs.readFileSync(p).subarray(0,16).equals(h))throw Error('not plaintext');",
		"fs.writeFileSync('plaintext-runtime.enabled','true');",
	].join(""));
	fs.writeFileSync(path.join(deploymentPath, "bot-settings.yaml"), "# retained comment\nfeature:\n  enabled: true\napiToken: smoke-secret\n");
	childProcess.execFileSync("git", ["init", "-b", "main"], { cwd: deploymentPath, stdio: "ignore" });
	childProcess.execFileSync("git", ["remote", "add", "origin", "https://example.invalid/optional-bot.git"], { cwd: deploymentPath, stdio: "ignore" });
	childProcess.execFileSync("git", ["checkout", "-b", "test-feature"], { cwd: deploymentPath, stdio: "ignore" });
	const originalDatabase = Buffer.from("SQLite format 3\0smoke database contents");
	fs.writeFileSync(path.join(deploymentPath, "data", "bot.sqlite"), originalDatabase);
	let manager = null;
	try {
		manager = new HachiManager({
			defaultInstallPath: tempDir,
			managerRoot: projectRoot,
			userDataPath,
			protectSecret: value => Buffer.from(String(value)).toString("base64"),
			unprotectSecret: value => Buffer.from(String(value), "base64").toString("utf8"),
		});
		manager.installExternalBotDefinition(JSON.stringify({
			id: "optional-bot",
			displayName: "Optional Bot",
			runtime: { ecosystemFile: "ecosystem.config.js", pm2Name: "OptionalBot" },
			repository: { url: "https://example.invalid/optional-bot.git", branch: "main" },
			paths: { database: "data/bot.sqlite" },
			configuration: { files: ["bot-settings.yaml"] },
			credentials: { mode: "adapter" },
			capabilities: { backups: true, databaseEncryption: true, secretEncryption: true },
			commands: {
				credentialsWrite: { executable: "node", args: ["credentials-write.js"] },
				databasePlaintext: { executable: "node", args: ["plaintext.js"] },
				testStart: { executable: "node", args: ["start-test.js"] },
			},
		}));
		await manager.addFleetDeployment({
			name: "Optional Bot Test",
			botTypeId: "optional-bot",
			serverId: "local",
			installPath: deploymentPath,
			environment: "test",
		});
		const deployment = manager.fleet.deployments.find(item => item.botTypeId === "optional-bot");
		assert(deployment.repositoryBranch === "test-feature", "Fleet should record each installation's checked-out branch instead of forcing the profile branch.");
		manager.addFleetServer({ name: "Remote smoke", connection: { type: "ssh", host: "example.invalid", username: "bot", port: 22, sshKeyPath: "smoke.key" } });
		const remoteServer = manager.fleet.servers.find(item => item.name === "Remote smoke");
		const remoteDeployment = { ...deployment, id: "deployment-remote-smoke", installPath: "/srv/optional-bot", serverId: remoteServer.id };
		manager.fleet.deployments.push(remoteDeployment);
		manager.setActiveFleetDeployment(remoteDeployment.id);
		assert(manager.getFleetDeploymentContext("optional-bot").deployment.id === remoteDeployment.id, "Logical bot context should resolve its selected remote installation.");
		manager.setActiveFleetDeployment(deployment.id);
		assert(manager.getFleetDeploymentContext("optional-bot").deployment.id === deployment.id, "Logical bot context should resolve its selected local installation.");
		const changedContext = {
			definition: { source: "external", fingerprint: "changed", capabilities: { logs: true, pm2: true }, displayName: "Optional Bot" },
			deployment: { definitionFingerprint: "approved", approvedCapabilities: { logs: true, pm2: true } },
		};
		manager.assertFleetCapability(changedContext, "logs", { allowChangedDefinition: true });
		let changedMutationRejected = false;
		try {
			manager.assertFleetCapability(changedContext, "pm2");
		} catch {
			changedMutationRejected = true;
		}
		assert(changedMutationRejected, "Changed profiles should allow approved observation but continue blocking runtime mutations.");
		const configuration = manager.getFleetDeploymentConfiguration(deployment.id);
		const yamlFile = configuration.files.find(file => file.path === "bot-settings.yaml");
		assert(yamlFile?.format === "yaml" && yamlFile.fields.find(field => field.key === "apiToken")?.sensitive, "Profile-declared YAML configuration should load with sensitive fields hidden.");
		manager.saveFleetDeploymentConfiguration(deployment.id, {
			path: yamlFile.path,
			hash: yamlFile.hash,
			fields: [{ key: "feature.enabled", value: "false" }, { key: "apiToken", value: "" }],
		});
		const savedYaml = fs.readFileSync(path.join(deploymentPath, "bot-settings.yaml"), "utf8");
		assert(savedYaml.includes("# retained comment") && savedYaml.includes("enabled: false") && savedYaml.includes("smoke-secret"), "YAML saves should preserve comments and blank sensitive replacements.");
		const overview = await manager.getFleetDeploymentOverview("optional-bot");
		assert(
			overview.deployment.name === "Optional Bot Test" &&
				overview.server.id === "local" &&
				overview.security.database.status === "noncompliant",
			"Fleet overview did not aggregate the selected deployment's status.",
		);
		await manager.saveFleetDeploymentCredentials(deployment.id, { token: "very-secret-token", clientId: "123" });
		assert(!fs.existsSync(path.join(userDataPath, "credential-vault.json")), "HachiGen created a secondary credential vault.");
		assert(!fs.readFileSync(path.join(deploymentPath, "credentials.enc"), "utf8").includes("very-secret-token"), "Bot credential adapter persisted a plaintext token.");
		assert(!JSON.stringify(manager.getFleetState()).includes("very-secret-token"), "Renderer fleet state exposed a Discord token.");
		manager.saveTestingProfile({ name: "Runtime Test", TOKEN: "runtime-test-token", clientId: "456" });
		const encryptedTestingContext = manager.getLocalTestingDeploymentContext("optional-bot");
		encryptedTestingContext.definition = {
			...encryptedTestingContext.definition,
			capabilities: { ...encryptedTestingContext.definition.capabilities, databaseToolConnection: true },
		};
		const testingIdentity = manager.readTestingIdentity("runtime-test");
		const firstEncryptedEnvironment = manager.testingDatabaseEnvironment(encryptedTestingContext, testingIdentity);
		const firstTestingDatabaseKey = manager.getTestingDatabaseKey("runtime-test", "optional-bot");
		const secondTestingDatabaseKey = manager.getTestingDatabaseKey("runtime-test", "optional-bot");
		assert(
			!firstEncryptedEnvironment.env.OPTIONAL_BOT_DB_ENCRYPTION &&
			!firstEncryptedEnvironment.env.OPTIONAL_BOT_DB_KEY &&
			firstTestingDatabaseKey.length >= 32 &&
			firstTestingDatabaseKey === secondTestingDatabaseKey,
			"Plain testing databases should remain plaintext until explicitly encrypted while retaining one stable protected key per identity and bot.",
		);
		const protectedTestingSecrets = fs.readFileSync(path.join(userDataPath, "Profiles", "Testing", "runtime-test", "secrets.env"), "utf8");
		const parsedTestingSecrets = requireFresh("src", "configuration.js").parseDotEnvContent(protectedTestingSecrets);
		assert(
			String(parsedTestingSecrets.HACHIGEN_DATABASE_KEY_OPTIONAL_BOT || "").startsWith("os:v1:") &&
			!protectedTestingSecrets.includes(firstTestingDatabaseKey),
			"Testing database keys should remain OS-protected and absent from plaintext profile files.",
		);
		manager.setActiveFleetDeployment(remoteDeployment.id);
		assert(manager.getLocalTestingDeploymentContext("optional-bot").deployment.id === deployment.id, "Testing should resolve the logical bot's local repository while production targets remote.");
		const testingStart = await manager.startTestingBot("optional-bot", "runtime-test");
		let testingRun;
		for (let attempt = 0; attempt < 20; attempt += 1) {
			testingRun = manager.getTestingRunState().find(item => item.deploymentId === deployment.id);
			if (testingRun?.output.includes("[REDACTED]")) {
				break;
			}
			await new Promise(resolve => {
				setTimeout(resolve, 50);
			});
		}
		assert(testingStart.runs[0].status === "running" && testingRun?.output.includes("[REDACTED]") && !testingRun.output.includes("runtime-test-token"), "Testing process did not start with redacted output.");
		assert(
			testingRun.databasePath.startsWith(path.join(userDataPath, "Profiles", "Testing", "runtime-test")) &&
				fs.readFileSync(testingRun.databasePath, "utf8") === "isolated test database" &&
				fs.readFileSync(path.join(deploymentPath, "data", "bot.sqlite")).equals(originalDatabase),
			"Testing should store its database in the identity profile without modifying production data.",
		);
		manager.stopTestingBot("optional-bot");
		fs.rmSync(testingRun.databasePath, { force: true });
		const { DatabaseSync } = require("node:sqlite");
		const isolatedDatabase = new DatabaseSync(testingRun.databasePath);
		isolatedDatabase.exec("CREATE TABLE test_rows (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO test_rows (value) VALUES ('isolated');");
		isolatedDatabase.close();
		const testingView = await manager.readTestingDatabaseTable("optional-bot", "runtime-test", "test_rows");
		assert(
			testingView.source.type === "testing" && testingView.rows[0].value === "isolated",
			"The testing database viewer should read the selected bot's isolated profile database.",
		);
		manager.setActiveFleetDeployment(deployment.id);
		const audit = await manager.auditFleetDeploymentSecurity("optional-bot");
		assert(audit.database.status === "noncompliant", "Plain SQLite database should be reported as noncompliant.");
		const backup = await manager.backupFleetDatabase("optional-bot");
		assert(fs.readFileSync(backup.backupPath).subarray(0, 5).toString() === "HGBK1", "Fleet database backup should use encrypted HGBK1 format.");
		const backupKeyBeforeRotation = manager.getFleetBackupVault().records[backup.backupId].key;
		const backupRotation = await manager.rotateFleetBackupKeys("optional-bot");
		assert(
			backupRotation.rotated === 1 && manager.getFleetBackupVault().records[backup.backupId].key !== backupKeyBeforeRotation,
			"Fleet Rotate Backups should replace protected envelope keys without pruning backup records.",
		);
		fs.writeFileSync(path.join(deploymentPath, "data", "bot.sqlite"), "damaged");
		const restoreInspection = await manager.inspectFleetDatabaseRestore("optional-bot", backup.backupId);
		assert(restoreInspection.disablesEncryption, "Restore inspection should detect an encrypted-looking to plaintext transition.");
		let unconfirmedRestoreRejected = false;
		try {
			await manager.restoreFleetDatabaseBackup("optional-bot", backup.backupId);
		} catch (error) {
			unconfirmedRestoreRejected = error.message.includes("requires explicit confirmation");
		}
		assert(unconfirmedRestoreRejected, "A plaintext transition should be rejected without explicit confirmation.");
		await manager.restoreFleetDatabaseBackup("optional-bot", backup.backupId, { allowPlaintextTransition: true });
		assert(fs.readFileSync(path.join(deploymentPath, "data", "bot.sqlite")).equals(originalDatabase), "Encrypted fleet backup did not restore original database bytes.");
		assert(fs.existsSync(path.join(deploymentPath, "plaintext-runtime.enabled")), "Plaintext restore did not invoke the bot-owned runtime adapter.");
		manager.getRepositoryInfo = async () => {
			throw new Error("remote unavailable");
		};
		manager.getQuickScan = async () => {
			throw new Error("remote unavailable");
		};
		manager.getDatabaseState = async () => {
			throw new Error("remote unavailable");
		};
		manager.getPm2Status = async () => {
			throw new Error("remote unavailable");
		};
		const degradedState = await manager.getState();
		assert(
			degradedState.repository.error === "remote unavailable" &&
				degradedState.scan.error === "remote unavailable" &&
				degradedState.database.error === "remote unavailable" &&
				degradedState.pm2.status === "unavailable",
			"A failed remote target should return component-level unavailable status instead of rejecting shared state.",
		);
	} finally {
		// Ensure a failed assertion cannot leave the smoke-test child alive.
		manager?.stopAllTestingBots();
		fs.rmSync(tempDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
	}
}

function validateTestingIdentityProtection() {
	const { HachiManager } = requireFresh("src", "manager.js");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-testing-identities-"));
	const userDataPath = path.join(tempDir, "userData");
	try {
		const manager = new HachiManager({
			defaultInstallPath: tempDir,
			managerRoot: projectRoot,
			userDataPath,
			protectSecret: value => Buffer.from(String(value)).toString("base64"),
			unprotectSecret: value => Buffer.from(String(value), "base64").toString("utf8"),
		});
		manager.addFleetServer({ name: "Primary", connection: { type: "ssh", host: "server.example", username: "bot", port: 22 } });
		let duplicateServerRejected = false;
		try {
			manager.addFleetServer({ name: "Duplicate", connection: { type: "ssh", host: "SERVER.EXAMPLE", username: "bot", port: 22 } });
		} catch {
			duplicateServerRejected = true;
		}
		assert(duplicateServerRejected, "Duplicate SSH endpoints should not create multiple Fleet connections.");
		const remoteServer = manager.fleet.servers.find(server => server.name === "Primary");
		const replacementKey = path.join(tempDir, "replacement.key");
		fs.writeFileSync(replacementKey, "-----BEGIN OPENSSH PRIVATE KEY-----\ntest-only\n-----END OPENSSH PRIVATE KEY-----\n");
		manager.updateFleetServer(remoteServer.id, {
			name: "Updated Primary",
			connection: { type: "ssh", host: "new.example", username: "runner", port: 2222, sshKeyPath: replacementKey },
		});
		assert(
			remoteServer.id === manager.fleet.servers.find(server => server.name === "Updated Primary")?.id &&
			manager.fleet.servers.find(server => server.id === remoteServer.id)?.connection.sshKeyPath === replacementKey,
			"Editing a Fleet SSH connection should preserve its stable id and update its key.",
		);
		const nativeHachi = manager.fleet.deployments.find(deployment => deployment.botTypeId === "hachi");
		nativeHachi.serverId = remoteServer.id;
		nativeHachi.installPath = "/srv/hachi";
		manager.removeFleetServer(remoteServer.id);
		assert(nativeHachi.serverId === "local" && nativeHachi.installPath === manager.settings.installPath, "Removing an otherwise empty SSH connection should preserve hidden Hachi state locally.");
		manager.saveTestingProfile({ name: "Shared Test", TOKEN: "test-token", clientId: "123", guildIds: "456\n789", isDefault: true });
		manager.saveTestingProfile({ name: "Secondary", TOKEN: "second-token", clientId: "321" });
		const profiles = manager.getTestingProfiles();
		assert(profiles.length === 2 && profiles[0].isDefault, "Testing profiles should support multiple identities and one optional default.");
		assert(profiles[0].guildIds.length === 2, "Testing profile guild IDs were not normalized.");
		const secretPath = path.join(userDataPath, "Profiles", "Testing", "shared-test", "secrets.env");
		const secrets = fs.readFileSync(secretPath, "utf8");
		assert(secrets.includes("os:v1:") && !secrets.includes("test-token"), "Testing profile .env should contain only OS-protected values.");
		assert(manager.readTestingSecretForCopy("shared-test", "TOKEN").value === "test-token", "Protected testing token did not round-trip for copy.");
		assert(!JSON.stringify(profiles).includes("test-token"), "Testing profile metadata exposed plaintext credentials.");
		let duplicateRejected = false;
		try {
			manager.saveTestingProfile({ name: "Shared Test", TOKEN: "replacement", clientId: "999" });
		} catch {
			duplicateRejected = true;
		}
		assert(duplicateRejected, "A duplicate testing profile name should not overwrite saved credentials.");
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}
}

async function validateDatabaseEncryptionPreflight() {
	const { HachiManager } = requireFresh("src", "manager.js");
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hachigen-encryption-preflight-"));
	const installPath = path.join(tempDir, "bot");
	const driverRoot = path.join(installPath, "node_modules", "better-sqlite3-multiple-ciphers");
	fs.mkdirSync(path.join(installPath, "database"), { recursive: true });
	fs.writeFileSync(path.join(installPath, "package.json"), JSON.stringify({
		dependencies: { "better-sqlite3-multiple-ciphers": "1.0.0" },
		scripts: { "database:encrypt": "node encrypt.js", "database:verify": "node verify.js" },
	}));
	fs.writeFileSync(path.join(installPath, "database", "dbToolConnection.js"), "module.exports={openToolDatabase(){}};\n");
	fs.writeFileSync(path.join(installPath, "database", "dbEncryption.js"), "module.exports={convertPlainDatabaseToEncrypted(){},verifyEncryptedDatabaseFile(){},rekeyEncryptedDatabase(){}};\n");
	const manager = new HachiManager({ defaultInstallPath: tempDir, managerRoot: projectRoot, userDataPath: path.join(tempDir, "userData") });
	const context = {
		definition: { displayName: "Preflight Bot" },
		deployment: { installPath },
		server: { connection: { type: "local" } },
	};
	try {
		let missingInstallRejected = false;
		try {
			await manager.verifyFleetDatabaseEncryptionPrerequisites(context);
		} catch (error) {
			missingInstallRejected = error.message.includes("is not installed") && error.message.includes("No database changes were made");
		}
		assert(missingInstallRejected, "Encryption preflight should reject a declared but uninstalled SQLCipher package before mutation.");
		fs.mkdirSync(driverRoot, { recursive: true });
		fs.writeFileSync(path.join(driverRoot, "package.json"), JSON.stringify({ main: "index.js", name: "better-sqlite3-multiple-ciphers", version: "1.0.0" }));
		fs.writeFileSync(path.join(driverRoot, "index.js"), "module.exports=function SmokeCipherDriver(){};\n");
		const report = await manager.verifyFleetDatabaseEncryptionPrerequisites(context);
		assert(report.ok && report.failures.length === 0, "Encryption preflight should accept a complete current installation.");
		let missingRotationRejected = false;
		try {
			await manager.verifyFleetDatabaseEncryptionPrerequisites(context, { requireRotation: true });
		} catch (error) {
			missingRotationRejected = error.message.includes("database:rotate is missing");
		}
		assert(missingRotationRejected, "Key rotation should require a current database:rotate package adapter.");
		const packageJson = JSON.parse(fs.readFileSync(path.join(installPath, "package.json"), "utf8"));
		packageJson.scripts["database:rotate"] = "node rotate.js";
		fs.writeFileSync(path.join(installPath, "package.json"), JSON.stringify(packageJson));
		assert((await manager.verifyFleetDatabaseEncryptionPrerequisites(context, { requireRotation: true })).ok, "Rotation preflight should accept an installed rotation adapter.");
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}
}

async function main() {
	await test("package metadata and lockfile are consistent", validatePackageMetadata);
	await test("required project files exist", validateProjectFiles);
	await test("fleet registry keeps Hachi native and optional bots external", validateBotRegistryFoundation);
	await test("standalone repository wiring is correct", validateStandaloneWiring);
	await test("renderer, menu, and self-update wiring is correct", validateRendererAndMenuWiring);
	await test("IPC surface is fully wired", validateIpcSurface);
	await test("self-update reports missing assets without IPC failure", validateSelfUpdateUnavailableState);
	await test("self-update uses running package version before saved release tag", validateSelfUpdateUsesRunningVersion);
	await test("diagnostics bundle is created and redacted", validateDiagnosticsBundle);
	await test("runtime archive exports and restores secrets-bearing project data", validateRuntimeArchiveRoundTrip);
	await test("database transfer creates destination backups and moves database bytes", validateDatabaseTransferOperations);
	await test("HachiGen update downloads are verified before install", validateHachiGenUpdateVerification);
	await test("shell wrapper resolves allowed commands safely", validateShellWrapperHardening);
	await test("database worker stages from standalone manager source", validateDatabaseWorkerStaging);
	await test("generic SQLite viewer reads additional bot databases", validateGenericSqliteViewerWorker);
	await test("logs redact secrets and hide Git plumbing", validateLoggingAndQuietState);
	await test("update checks are deduplicated", validateUpdateCheckDeduplication);
	await test("fleet credentials and database backups stay encrypted", validateFleetCredentialAndBackupSecurity);
	await test("testing identities stay OS-protected and out of renderer state", validateTestingIdentityProtection);
	await test("database encryption preflight verifies current package installation", validateDatabaseEncryptionPreflight);

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
