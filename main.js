// Electron main process for HachiGen.
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
	app,
	BrowserWindow,
	clipboard,
	// ipcMain is Electron's request handler for messages from the renderer window.
	// HachiGen's HTML/JS page cannot call Node.js APIs directly, so it asks the
	// main process to perform approved actions through named IPC channels.
	ipcMain,
	dialog,
	Menu,
	screen,
	shell,
} = require("electron");
const { HachiManager } = require("./src/manager.js");
const managerPackage = require("./package.json");

const HELP_LINKS = {
	changelog: "https://github.com/FearlessKenji/HachiGen/blob/main/CHANGELOG.md",
	docs: "https://fearlesskenji.github.io/Hachi/",
	patchNotes: "https://github.com/FearlessKenji/HachiGen/blob/main/docs/patch-notes.md",
	readme: "https://github.com/FearlessKenji/HachiGen#readme",
	releases: "https://github.com/FearlessKenji/HachiGen/releases",
};
const ALLOWED_GITHUB_REPOSITORIES = new Set(["/FearlessKenji/Hachi", "/FearlessKenji/HachiGen"]);

// Electron apps have a "main process" and one or more windows.
// This file is the main process: it creates the HachiGen window and
// connects window button clicks to backend manager actions.
let mainWindow;
let manager;
let clipboardClearTimer = null;
let windowStateSaveTimer = null;
const UI_SMOKE_MODE = process.env.HACHIGEN_UI_SMOKE === "1";

// Forward backend activity to the window when it is available. Backend actions
// can outlive a particular BrowserWindow, so this checks before sending.
function sendEvent(event) {
	if (mainWindow && !mainWindow.isDestroyed()) {
		// This is the opposite direction from ipcMain.handle(): manager.js emits a
		// live event, main.js sends it to the renderer, and preload.js exposes a
		// subscription helper as window.hachiGen.onEvent(...).
		mainWindow.webContents.send("manager:event", event);
	}
}

function sendMenuAction(action, details = {}) {
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.webContents.send("manager:menu-action", {
			action,
			...details,
		});
	}
}

function scheduleClipboardClear(secret, ttlMs) {
	if (clipboardClearTimer) {
		clearTimeout(clipboardClearTimer);
	}

	clipboardClearTimer = setTimeout(() => {
		if (clipboard.readText() === secret) {
			clipboard.clear();
		}
	}, ttlMs);

	if (typeof clipboardClearTimer.unref === "function") {
		clipboardClearTimer.unref();
	}
}

function isAllowedExternalUrl(url) {
	try {
		const parsed = new URL(String(url || ""));

		if (parsed.protocol !== "https:") {
			return false;
		}

		if (parsed.hostname === "github.com") {
			return Array.from(ALLOWED_GITHUB_REPOSITORIES).some(repoPath => parsed.pathname === repoPath || parsed.pathname.startsWith(`${repoPath}/`));
		}

		if (parsed.hostname === "fearlesskenji.github.io") {
			return parsed.pathname === "/Hachi/" || parsed.pathname.startsWith("/Hachi/");
		}

		return parsed.hostname === "crontab.guru" && (parsed.pathname === "/" || parsed.pathname === "");
	} catch {
		return false;
	}
}

function openExternal(url) {
	if (!isAllowedExternalUrl(url)) {
		manager?.event("error", `Blocked external link: ${String(url || "unknown")}`, {
			area: "external-link",
		});
		return false;
	}

	shell.openExternal(url).catch(error => {
		manager?.event("error", `Could not open external link: ${error.message || error}`, {
			area: "external-link",
		});
	});
	return true;
}

async function openHachiGenLogFolder() {
	const logFolder = manager?.logger?.logsPath;

	if (!logFolder) {
		return { ok: false, message: "HachiGen log folder is not available yet." };
	}

	const result = await shell.openPath(logFolder);

	if (result) {
		dialog.showErrorBox("Open HachiGen Log Folder", result);
		return { ok: false, message: result };
	}

	return { ok: true, message: "Opened HachiGen log folder." };
}

function readLogSection(label, filePath) {
	if (!filePath || !fs.existsSync(filePath)) {
		return `## ${label}\n\nNot found.`;
	}

	return `## ${label}\n\n${fs.readFileSync(filePath, "utf8").trim() || "Empty."}`;
}

async function exportHachiGenLogs() {
	if (!manager?.logger) {
		return;
	}

	const paths = manager.logger.ensureLogs();
	const stamp = new Date().toISOString().replace(/\D/gu, "").slice(0, 14);
	const result = await dialog.showSaveDialog(mainWindow, {
		defaultPath: `hachigen-logs-${stamp}.txt`,
		filters: [
			{ name: "Text logs", extensions: ["txt"] },
			{ name: "All files", extensions: ["*"] },
		],
		title: "Export HachiGen Logs",
	});

	if (result.canceled || !result.filePath) {
		return;
	}

	const content = [
		`# HachiGen Logs Export`,
		`Exported: ${new Date().toISOString()}`,
		`HachiGen: ${managerPackage.version}`,
		`Install path: ${manager.getInstallPath()}`,
		readLogSection("Raw Log", paths.raw),
		readLogSection("Structured Pretty Log", paths.structuredPretty),
		readLogSection("Crash Log", paths.crash),
	].join("\n\n");

	fs.writeFileSync(result.filePath, `${content}\n`, "utf8");
	manager.log(`HachiGen logs exported to ${result.filePath}.`);
}

async function copyDiagnosticInfo() {
	const diagnostics = manager ? await manager.getDiagnostics().catch(() => null) : null;
	const lines = [
		`HachiGen: ${diagnostics?.app?.hachiGenVersion || managerPackage.version}`,
		`Hachi: ${diagnostics?.scan?.packageVersion || "unknown"}`,
		`Runtime target: ${diagnostics?.settings?.runtimeTarget || manager?.getRuntimeTarget?.() || "unknown"}`,
		`Install path: ${diagnostics?.paths?.installPath || manager?.getInstallPath?.() || "unknown"}`,
		`Branch: ${diagnostics?.repository?.currentBranch || "unknown"}`,
		`Update target: ${diagnostics?.repository?.updateTarget || "origin/main"}`,
		`Project found: ${diagnostics?.scan?.projectFound === undefined ? "unknown" : diagnostics.scan.projectFound}`,
		`PM2: ${diagnostics?.pm2?.status || "unknown"}`,
		`Crash count: ${diagnostics?.recovery?.crashCount ?? "unknown"}`,
	].join("\n");

	clipboard.writeText(lines);
	manager?.log("Diagnostic info copied to clipboard.");
	return { ok: true, message: "Diagnostic info copied to clipboard." };
}

async function exportSupportBundle() {
	if (!manager) {
		return { ok: false, message: "HachiGen is still starting." };
	}

	const stamp = new Date().toISOString().replace(/\D/gu, "").slice(0, 14);
	const result = await dialog.showSaveDialog(mainWindow, {
		defaultPath: `hachigen-diagnostics-${stamp}.tar.gz`,
		filters: [
			{ name: "Diagnostics bundle", extensions: ["gz"] },
			{ name: "All files", extensions: ["*"] },
		],
		title: "Export Diagnostics Bundle",
	});

	if (result.canceled || !result.filePath) {
		return { ok: false, message: "Diagnostics export canceled." };
	}

	return manager.exportSupportBundle(result.filePath);
}

function showMenuActionError(title, error) {
	const message = error?.message || String(error || "Unknown error.");

	manager?.event("error", `${title}: ${message}`, {
		area: "menu-action",
	});
	dialog.showErrorBox(title, message);
}

function runtimeArchiveSourceLabel() {
	if (manager?.getRuntimeTarget?.() !== "remote") {
		return `Local: ${manager?.getInstallPath?.() || "selected Hachi folder"}`;
	}

	const remote = manager.getRemoteSettings();
	const host = remote.username && remote.host ? `${remote.username}@${remote.host}` : remote.host || "remote profile";
	return `Remote: ${host}${remote.remotePath ? `:${remote.remotePath}` : ""}`;
}

async function exportRuntimeArchive() {
	if (!manager) {
		return { ok: false, message: "HachiGen is still starting." };
	}

	const targetPath = manager.runtimeArchiveDefaultPath();
	const result = await dialog.showMessageBox(mainWindow, {
		buttons: ["Export Runtime Archive", "Cancel"],
		cancelId: 1,
		defaultId: 1,
		detail: [
			"This archive includes Hachi project files and can include .env, database files, configured database keys, and configured secret-encryption keys.",
			"Anyone with the archive may be able to run this Hachi runtime or read its data.",
			"",
			`Source: ${runtimeArchiveSourceLabel()}`,
			`Destination: ${targetPath}`,
			"",
			"HachiGen saves runtime archives in the Hachi exports folder, which is ignored by git.",
		].join("\n"),
		message: "Export a secrets-bearing runtime archive?",
		type: "warning",
	});

	if (result.response !== 0) {
		return { ok: false, message: "Runtime archive export canceled." };
	}

	try {
		const exported = await manager.exportRuntimeArchive({ targetPath });
		await dialog.showMessageBox(mainWindow, {
			buttons: ["OK"],
			detail: `${exported.archivePath}\n\nFiles: ${exported.fileCount}`,
			message: "Runtime archive exported.",
			type: "info",
		});
		return exported;
	} catch (error) {
		showMenuActionError("Export Runtime Archive", error);
		return { ok: false, message: error?.message || String(error) };
	}
}

async function restoreRuntimeArchive() {
	if (!manager) {
		return { ok: false, message: "HachiGen is still starting." };
	}

	const selection = await dialog.showOpenDialog(mainWindow, {
		defaultPath: manager.getRuntimeExportsDir(),
		filters: [
			{ name: "Runtime archives", extensions: ["gz"] },
			{ name: "All files", extensions: ["*"] },
		],
		properties: ["openFile"],
		title: "Choose Runtime Archive",
	});

	if (selection.canceled || !selection.filePaths.length) {
		return { ok: false, message: "Runtime archive restore canceled." };
	}

	try {
		const preview = manager.previewRuntimeArchive(selection.filePaths[0]);
		const result = await dialog.showMessageBox(mainWindow, {
			buttons: ["Restore Runtime Archive", "Cancel"],
			cancelId: 1,
			defaultId: 1,
			detail: [
				`Archive: ${preview.archivePath}`,
				`Destination: ${manager.getInstallPath()}`,
				`Files: ${preview.fileCount}`,
				`Project files: ${preview.projectFileCount}`,
				`Key files: ${preview.keyFileCount}`,
				`Source: ${preview.source?.type || "unknown"}${preview.source?.host ? ` (${preview.source.host})` : ""}`,
				"",
				"Restore writes into the selected local Hachi folder and updates restored key-file paths to this computer.",
				"Existing matching files are copied to manager/backups before they are replaced.",
				"Stop Hachi before restoring if it is currently running.",
			].join("\n"),
			message: "Restore this runtime archive?",
			type: "warning",
		});

		if (result.response !== 0) {
			return { ok: false, message: "Runtime archive restore canceled." };
		}

		const restored = await manager.restoreRuntimeArchive(preview.archivePath);
		await dialog.showMessageBox(mainWindow, {
			buttons: ["OK"],
			detail: restored.backupDir ?
				`Restored files: ${restored.fileCount}\nSafety backup: ${restored.backupDir}` :
				`Restored files: ${restored.fileCount}`,
			message: "Runtime archive restored.",
			type: "info",
		});
		return restored;
	} catch (error) {
		showMenuActionError("Restore Runtime Archive", error);
		return { ok: false, message: error?.message || String(error) };
	}
}

function focusMainWindow() {
	if (!mainWindow || mainWindow.isDestroyed()) {
		return;
	}

	if (mainWindow.isMinimized()) {
		mainWindow.restore();
	}

	mainWindow.show();
	mainWindow.focus();
}

function recordProcessRecovery(message, details = {}) {
	manager?.event("error", message, {
		area: "process-recovery",
		...details,
	});
}

function savedWindowOptions() {
	const saved = manager?.getWindowState?.();

	if (!saved?.bounds) {
		return {};
	}

	const bounds = saved.bounds;
	const visible = screen.getAllDisplays().some(display => {
		const area = display.workArea;
		return bounds.x < area.x + area.width &&
			bounds.x + bounds.width > area.x &&
			bounds.y < area.y + area.height &&
			bounds.y + bounds.height > area.y;
	});

	return visible ? bounds : {};
}

function saveMainWindowState() {
	if (!mainWindow || mainWindow.isDestroyed() || !manager?.saveWindowState) {
		return;
	}

	manager.saveWindowState({
		bounds: mainWindow.getBounds(),
		maximized: mainWindow.isMaximized(),
	});
}

function scheduleWindowStateSave() {
	if (windowStateSaveTimer) {
		clearTimeout(windowStateSaveTimer);
	}

	windowStateSaveTimer = setTimeout(() => {
		windowStateSaveTimer = null;
		saveMainWindowState();
	}, 400);
}

async function showRecoveryNoticeIfNeeded() {
	if (UI_SMOKE_MODE || !mainWindow || mainWindow.isDestroyed() || !manager?.getPendingRecoveryEvent) {
		return;
	}

	const recoveryEvent = manager.getPendingRecoveryEvent();

	if (!recoveryEvent) {
		return;
	}

	manager.markRecoveryEventNotified(recoveryEvent.time);
	const result = await dialog.showMessageBox(mainWindow, {
		buttons: ["Open Diagnostics", "Export Diagnostics", "Dismiss"],
		cancelId: 2,
		defaultId: 0,
		detail: `${new Date(recoveryEvent.time).toLocaleString()}\n${recoveryEvent.message}\n\nHachiGen saved diagnostics and logs for review.`,
		message: "HachiGen recovered from a previous problem.",
		type: "warning",
	});

	if (result.response === 0) {
		sendMenuAction("show-view", { view: "diagnostics" });
	} else if (result.response === 1) {
		await exportSupportBundle();
	}
}

function formatFileSize(bytes) {
	const size = Number(bytes) || 0;

	if (size < 1024) {
		return `${size} B`;
	}

	if (size < 1024 * 1024) {
		return `${(size / 1024).toFixed(1)} KB`;
	}

	return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function resolveDevelopmentInstallPath() {
	const siblingHachi = path.resolve(__dirname, "..", "Hachi");

	if (fs.existsSync(path.join(siblingHachi, "package.json"))) {
		return siblingHachi;
	}

	return siblingHachi;
}

function windowsPowerShellPath() {
	const systemRoot = process.env.SystemRoot || "C:\\Windows";
	const bundledPowerShell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

	return fs.existsSync(bundledPowerShell) ? bundledPowerShell : "powershell.exe";
}

function quitForHachiGenUpdate() {
	if (manager) {
		manager.stopLogCleanup();
	}

	for (const window of BrowserWindow.getAllWindows()) {
		window.destroy();
	}

	app.exit(0);
}

function emitHachiGenUpdateProgress(step, message, details = {}) {
	manager?.event("log", message, {
		area: "hachigen-update",
		hachiGenUpdateWizard: true,
		stage: step,
		status: details.status || "running",
		...details,
	});
}

async function installHachiGenUpdate() {
	emitHachiGenUpdateProgress("check", "Checking latest HachiGen release...", {
		progress: 8,
	});
	const update = await manager.checkHachiGenUpdates();

	if (!update.canInstall) {
		emitHachiGenUpdateProgress("check", update.message || "No HachiGen release asset is available.", {
			progress: 100,
			status: "error",
		});
		throw new Error(update.message || "No HachiGen release asset is available.");
	}

	if (!app.isPackaged || process.platform !== "win32") {
		emitHachiGenUpdateProgress("open", "Opened the latest HachiGen release download.", {
			progress: 100,
			status: "complete",
		});
		openExternal(update.assetUrl || update.releaseUrl || HELP_LINKS.releases);
		return {
			...update,
			message: "Development builds cannot replace the running Electron process. Opened the latest HachiGen release download.",
			ok: true,
		};
	}

	const tempDir = path.join(os.tmpdir(), `hachigen-update-${Date.now()}`);
	const updatePath = path.join(tempDir, "HachiGen.exe");
	const scriptPath = path.join(tempDir, "install-hachigen-update.ps1");
	const logPath = path.join(tempDir, "install-hachigen-update.log");
	let lastProgressBucket = -1;

	emitHachiGenUpdateProgress("download", `Downloading ${update.latestTag || "HachiGen update"}...`, {
		assetName: update.assetName,
		progress: 15,
	});
	const installed = await manager.downloadHachiGenUpdate(updatePath, update, {
		onProgress: progress => {
			const percent = progress.percent === null ? null : Math.max(0, Math.min(100, progress.percent));
			const bucket = percent === null ? -1 : Math.floor(percent / 5);

			if (bucket === lastProgressBucket && percent !== 100) {
				return;
			}

			lastProgressBucket = bucket;
			emitHachiGenUpdateProgress("download", percent === null ?
				`Downloading ${update.assetName || "HachiGen.exe"}... ${formatFileSize(progress.bytes)} received.` :
				`Downloading ${update.assetName || "HachiGen.exe"}... ${percent}%`,
			{
				bytes: progress.bytes,
				progress: percent === null ? 35 : 15 + Math.round(percent * 0.55),
				totalBytes: progress.totalBytes,
			});
		},
	});
	const targetPath = process.execPath;
	emitHachiGenUpdateProgress("prepare", "Preparing HachiGen installer...", {
		progress: 74,
	});
	const script = [
		"param(",
		"	[Parameter(Mandatory=$true)][int]$ParentPid,",
		"	[Parameter(Mandatory=$true)][string]$Target,",
		"	[Parameter(Mandatory=$true)][string]$Update,",
		"	[Parameter(Mandatory=$true)][string]$LogPath",
		")",
		"$ErrorActionPreference = 'Stop'",
		"function Write-UpdateLog([string]$Message) {",
		"	$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'",
		"	Add-Content -LiteralPath $LogPath -Value \"[$stamp] $Message\" -Encoding UTF8",
		"}",
		"try {",
		"	Write-UpdateLog \"Waiting for HachiGen process $ParentPid to exit.\"",
		"	Wait-Process -Id $ParentPid -Timeout 30 -ErrorAction SilentlyContinue",
		"	if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {",
		"		Write-UpdateLog \"HachiGen process $ParentPid did not exit in time; stopping it.\"",
		"		Stop-Process -Id $ParentPid -Force -ErrorAction SilentlyContinue",
		"		Wait-Process -Id $ParentPid -Timeout 10 -ErrorAction SilentlyContinue",
		"	}",
		"	$deadline = (Get-Date).AddSeconds(60)",
		"	$copied = $false",
		"	do {",
		"		try {",
		"			Copy-Item -LiteralPath $Update -Destination $Target -Force -ErrorAction Stop",
		"			$copied = $true",
		"		} catch {",
		"			Write-UpdateLog \"Waiting for target file lock: $($_.Exception.Message)\"",
		"			Start-Sleep -Milliseconds 750",
		"		}",
		"	} until ($copied -or (Get-Date) -gt $deadline)",
		"	if (-not $copied) {",
		"		throw \"Timed out replacing HachiGen.exe.\"",
		"	}",
		"	Write-UpdateLog \"HachiGen.exe replaced successfully.\"",
		"	$started = Start-Process -FilePath $Target -WorkingDirectory (Split-Path -Parent $Target) -PassThru",
		"	if ($started) {",
		"		Write-UpdateLog \"Relaunched HachiGen with PID $($started.Id).\"",
		"	} else {",
		"		Write-UpdateLog \"Relaunch command completed without a process handle.\"",
		"	}",
		"	Remove-Item -LiteralPath $Update -Force -ErrorAction SilentlyContinue",
		"	Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue",
		"} catch {",
		"	Write-UpdateLog \"Update failed: $($_.Exception.Message)\"",
		"	exit 1",
		"}",
		"",
	].join("\r\n");

	fs.writeFileSync(scriptPath, script, "utf8");
	manager.markHachiGenReleaseInstalled(update.latestTag);
	manager.log(`HachiGen ${update.latestTag || "update"} downloaded. HachiGen will close, replace itself, and relaunch. Installer log: ${logPath}`);
	emitHachiGenUpdateProgress("install", "Ready to replace HachiGen. The app will close and relaunch.", {
		installerLog: logPath,
		progress: 90,
	});

	const child = childProcess.spawn(windowsPowerShellPath(), [
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-WindowStyle",
		"Hidden",
		"-File",
		scriptPath,
		"-ParentPid",
		String(process.pid),
		"-Target",
		targetPath,
		"-Update",
		updatePath,
		"-LogPath",
		logPath,
	], {
		detached: true,
		shell: false,
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();

	emitHachiGenUpdateProgress("restart", "Closing HachiGen so the updater can replace and relaunch it.", {
		progress: 100,
		status: "complete",
	});
	setTimeout(() => quitForHachiGenUpdate(), 500);

	return {
		...installed,
		message: `HachiGen ${update.latestTag || "update"} downloaded. HachiGen will close, replace itself, and relaunch.`,
		ok: true,
	};
}

function buildApplicationMenu() {
	return Menu.buildFromTemplate([
		{
			label: "File",
			submenu: [
				{
					label: "Open Hachi Folder",
					click: () => sendMenuAction("open-folder"),
				},
				{
					label: "Open HachiGen Log Folder",
					click: () => openHachiGenLogFolder(),
				},
				{
					label: "Export HachiGen Logs",
					click: () => exportHachiGenLogs(),
				},
				{
					label: "Export Diagnostics Bundle",
					click: () => exportSupportBundle(),
				},
				{
					label: "Export Runtime Archive...",
					click: () => exportRuntimeArchive(),
				},
				{
					label: "Restore Runtime Archive...",
					click: () => restoreRuntimeArchive(),
				},
				{ type: "separator" },
				{
					label: "Exit",
					role: "quit",
				},
			],
		},
		{
			label: "View",
			submenu: [
				{
					label: "Dashboard",
					click: () => sendMenuAction("show-view", { view: "dashboard" }),
				},
				{
					label: "Setup",
					click: () => sendMenuAction("show-view", { view: "setup" }),
				},
				{
					label: "Remote",
					click: () => sendMenuAction("show-view", { view: "remote" }),
				},
				{
					label: "Updates",
					click: () => sendMenuAction("show-view", { view: "updates" }),
				},
				{
					label: "Database",
					click: () => sendMenuAction("show-view", { view: "database" }),
				},
				{
					label: "Logs",
					click: () => sendMenuAction("show-view", { view: "logs" }),
				},
				{
					label: "Diagnostics",
					click: () => sendMenuAction("show-view", { view: "diagnostics" }),
				},
				{ type: "separator" },
				{
					label: "Refresh Current View",
					accelerator: "F5",
					click: () => sendMenuAction("refresh-current-view"),
				},
			],
		},
		{
			label: "Window",
			submenu: [
				{ role: "minimize" },
				{ role: "close" },
			],
		},
		{
			label: "Help",
			submenu: [
				{
					label: "Check for Updates",
					click: () => sendMenuAction("check-version-updates"),
				},
				{ type: "separator" },
				{
					label: "Open Documentation",
					click: () => openExternal(HELP_LINKS.docs),
				},
				{
					label: "Open README",
					click: () => openExternal(HELP_LINKS.readme),
				},
				{
					label: "Open Changelog",
					click: () => openExternal(HELP_LINKS.changelog),
				},
				{
					label: "Open Patch Notes",
					click: () => openExternal(HELP_LINKS.patchNotes),
				},
				{ type: "separator" },
				{
					label: "Open HachiGen Log Folder",
					click: () => openHachiGenLogFolder(),
				},
				{
					label: "Copy Diagnostic Info",
					click: () => copyDiagnosticInfo(),
				},
				{
					label: "Export Diagnostics Bundle",
					click: () => exportSupportBundle(),
				},
				{ type: "separator" },
				{
					label: "About HachiGen",
					click: () => sendMenuAction("show-about"),
				},
			],
		},
	]);
}

// Create the visible desktop window and load the renderer files. Security
// options here keep the web page isolated from raw Node.js access.
function createWindow() {
	const windowState = manager?.getWindowState?.();
	mainWindow = new BrowserWindow({
		width: 1240,
		height: 820,
		minWidth: 1040,
		minHeight: 720,
		...savedWindowOptions(),
		show: !UI_SMOKE_MODE,
		title: "HachiGen",
		backgroundColor: "#000000",
		webPreferences: {
			// preload.js is the controlled doorway between the UI and this backend.
			preload: path.join(__dirname, "preload.js"),
			// These settings keep Node.js APIs out of the web page itself.
			// sandbox also limits preload.js to Electron's safe renderer bridge.
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	if (windowState?.maximized) {
		mainWindow.maximize();
	}

	mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

	mainWindow.webContents.once("did-finish-load", () => {
		if (UI_SMOKE_MODE) {
			manager?.log("Packaged UI smoke mode loaded the renderer.");
			setTimeout(() => app.exit(0), 150);
			return;
		}

		showRecoveryNoticeIfNeeded();
	});

	mainWindow.webContents.once("did-fail-load", (_event, errorCode, errorDescription) => {
		recordProcessRecovery(`Renderer failed to load: ${errorDescription || errorCode}`, {
			errorCode,
			errorDescription,
		});

		if (UI_SMOKE_MODE) {
			app.exit(1);
		}
	});

	mainWindow.webContents.on("render-process-gone", (_event, details) => {
		recordProcessRecovery(`Renderer process exited: ${details.reason || "unknown"}.`, details);

		if (UI_SMOKE_MODE) {
			app.exit(1);
			return;
		}

		dialog.showMessageBox(mainWindow, {
			buttons: ["Reload", "Close"],
			defaultId: 0,
			detail: "The interface stopped unexpectedly. HachiGen saved the event to Diagnostics and can reload the window now.",
			message: "HachiGen needs to reload this window.",
			type: "warning",
		}).then(result => {
			if (result.response === 0 && mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.reload();
			}
		});
	});

	mainWindow.on("unresponsive", () => {
		recordProcessRecovery("HachiGen window became unresponsive.");
	});

	mainWindow.on("responsive", () => {
		manager?.log("HachiGen window became responsive again.", {
			area: "process-recovery",
		});
	});

	mainWindow.on("move", scheduleWindowStateSave);
	mainWindow.on("resize", scheduleWindowStateSave);
	mainWindow.on("maximize", scheduleWindowStateSave);
	mainWindow.on("unmaximize", scheduleWindowStateSave);

	mainWindow.on("closed", () => {
		if (windowStateSaveTimer) {
			clearTimeout(windowStateSaveTimer);
			windowStateSaveTimer = null;
		}
		mainWindow = null;
	});

	// Links such as Cron Guru should open in the user's browser instead of
	// creating a second Electron window inside HachiGen.
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		openExternal(url);
		return { action: "deny" };
	});

	mainWindow.webContents.on("will-navigate", (event, url) => {
		if (url !== mainWindow.webContents.getURL()) {
			event.preventDefault();
			openExternal(url);
		}
	});
}

// Register every safe action the renderer is allowed to request.
//
// IPC means "inter-process communication." HachiGen has two relevant processes:
//
// - Renderer process: the visible HTML/CSS/JS window in renderer/.
// - Main process: this file, which is allowed to use Node.js, Electron dialogs,
//   the clipboard, shell.openPath, filesystem code, child processes, and HachiManager.
//
// The renderer never imports manager.js directly. Instead the flow is:
//
// 1. renderer/app.js calls window.hachiGen.saveConfig(values).
// 2. preload.js maps that to ipcRenderer.invoke("manager:save-config", values).
// 3. ipcMain.handle("manager:save-config", ...) below receives the request here.
// 4. This main-process handler calls manager.writeConfiguration(values).
// 5. The returned value is sent back through the same promise to renderer/app.js.
//
// Each channel below is therefore part of HachiGen's private UI API. If a new
// button needs backend power, add a narrow channel here and expose only that
// specific capability in preload.js.
function registerIpc() {
	// State and install-path channels. These read or update the Hachi install
	// folder that every later operation uses as its root.
	ipcMain.handle("manager:get-state", () => manager.getState());
	ipcMain.handle("manager:get-diagnostics", () => manager.getDiagnostics());
	ipcMain.handle("manager:get-about-info", () => manager.getAboutInfo());

	ipcMain.handle("manager:choose-install-path", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Choose Hachi install folder",
			properties: ["openDirectory", "createDirectory"],
		});

		if (result.canceled || !result.filePaths.length) {
			return manager.getState();
		}

		await manager.setInstallPath(result.filePaths[0]);
		return manager.getState();
	});

	ipcMain.handle("manager:set-install-path", async (_event, installPath) => {
		await manager.setInstallPath(installPath);
		return manager.getState();
	});

	ipcMain.handle("manager:choose-ssh-key", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			filters: [
				{ name: "SSH private keys", extensions: ["key", "pem", "ppk"] },
				{ name: "All files", extensions: ["*"] },
			],
			properties: ["openFile"],
			title: "Choose SSH private key",
		});

		if (result.canceled || !result.filePaths.length) {
			return { ok: false, message: "SSH key selection canceled." };
		}

		return manager.validateSshKeyPath(result.filePaths[0]);
	});

	ipcMain.handle("manager:install-or-validate", () => manager.installOrValidate());
	ipcMain.handle("manager:validate-install", () => manager.validateInstall({ repair: true }));

	// Setup/configuration channels. Secrets are encrypted in HachiManager before
	// being written to disk; decrypted values are never returned to the renderer.
	ipcMain.handle("manager:read-config", () => manager.readActiveConfiguration());
	ipcMain.handle("manager:save-config", (_event, values) => manager.writeConfiguration(values));

	// Secret copy is handled in the main process because the renderer should not
	// receive plaintext secrets. The only renderer-visible result is a status
	// message saying the clipboard was populated temporarily.
	ipcMain.handle("manager:copy-env-secret", async (_event, field) => {
		const secret = await manager.readEnvSecretForCopy(field);

		clipboard.writeText(secret.value);
		scheduleClipboardClear(secret.value, secret.ttlMs);
		manager.log(`Secret protection: ${secret.field} copied to clipboard. Clipboard will be cleared in ${Math.round(secret.ttlMs / 1000)} seconds if unchanged.`);

		return {
			field: secret.field,
			message: `${secret.field} copied. Clipboard clears in ${Math.round(secret.ttlMs / 1000)} seconds if unchanged.`,
			ok: true,
			ttlMs: secret.ttlMs,
		};
	});

	// Remote-server channels. These update saved SSH settings or ask HachiManager
	// to run remote validation/actions through OpenSSH.
	ipcMain.handle("manager:save-remote-settings", (_event, values) => manager.saveRemoteSettings(values));
	ipcMain.handle("manager:set-runtime-target", (_event, target) => manager.setRuntimeTarget(target));
	ipcMain.handle("manager:test-remote-connection", () => manager.testRemoteConnection());

	// Update/runtime channels. These cover Git update checks, stashes, command
	// deployment, PM2 process control, and log/status reads.
	ipcMain.handle("manager:check-updates", () => manager.checkUpdates());
	ipcMain.handle("manager:check-version-updates", () => manager.checkVersionUpdates());
	ipcMain.handle("manager:check-hachigen-updates", () => manager.checkHachiGenUpdates());
	ipcMain.handle("manager:install-hachigen-update", () => installHachiGenUpdate());
	ipcMain.handle("manager:open-hachigen-release", () => {
		const releaseUrl = manager.hachiGenUpdateState?.releaseUrl || HELP_LINKS.releases;
		const opened = openExternal(releaseUrl);
		return {
			ok: opened,
			message: opened ? "Opened HachiGen releases." : "Blocked HachiGen release link.",
		};
	});
	ipcMain.handle("manager:apply-update", () => manager.applyUpdate());
	ipcMain.handle("manager:restore-stashed-changes", () => manager.restoreStashedChanges());
	ipcMain.handle("manager:delete-stashed-changes", () => manager.deleteStashedChanges());
	ipcMain.handle("manager:deploy-commands", () => manager.deployCommands());
	ipcMain.handle("manager:start-bot", () => manager.startBot());
	ipcMain.handle("manager:stop-bot", () => manager.stopBot());
	ipcMain.handle("manager:restart-bot", () => manager.restartBot());
	ipcMain.handle("manager:get-logs", () => manager.getLogs());
	ipcMain.handle("manager:get-pm2-status", () => manager.getPm2Status());
	ipcMain.handle("manager:record-renderer-event", (_event, payload) => manager.recordRendererEvent(payload));
	ipcMain.handle("manager:copy-diagnostic-info", () => copyDiagnosticInfo());
	ipcMain.handle("manager:export-support-bundle", () => exportSupportBundle());
	ipcMain.handle("manager:open-hachigen-log-folder", () => openHachiGenLogFolder());

	// Database viewer and maintenance channels. The renderer controls what the
	// user sees and confirms; HachiManager owns actual file/database mutations.
	ipcMain.handle("manager:read-database-table", (_event, tableName, sort) => manager.readDatabaseTable(tableName, sort));
	ipcMain.handle("manager:migrate-database", () => manager.migrateDatabase({ force: false }));
	ipcMain.handle("manager:force-migrate-database", () => manager.migrateDatabase({ force: true }));
	ipcMain.handle("manager:review-database-sanitation", () => manager.reviewDatabaseSanitation());

	ipcMain.handle("manager:backup-database", (_event, options = {}) => {
		// Confirmation is handled by the themed renderer modal. The backend only
		// performs the requested backup or reports that overwrite is needed.
		return manager.backupDatabase({ overwrite: Boolean(options.overwrite) });
	});

	ipcMain.handle("manager:choose-database-backup", async () => {
		// Restrict the file picker to HachiGen's backup folder. The manager still
		// validates the chosen path afterward in case the dialog returns odd input.
		const result = await dialog.showOpenDialog(mainWindow, {
			defaultPath: manager.getDatabaseBackupDir(),
			filters: [
				{ name: "SQLite backups", extensions: ["sqlite"] },
				{ name: "All files", extensions: ["*"] },
			],
			properties: ["openFile"],
			title: "Choose database backup",
		});

		if (result.canceled || !result.filePaths.length) {
			return { ok: false, message: "Database restore canceled." };
		}

		return {
			backupPath: result.filePaths[0],
			fileName: path.basename(result.filePaths[0]),
			ok: true,
			message: "Database backup selected.",
		};
	});

	ipcMain.handle("manager:restore-database", (_event, backupPath) => manager.restoreDatabaseFromBackup(backupPath));
	ipcMain.handle("manager:pull-remote-database", () => manager.pullRemoteDatabase());
	ipcMain.handle("manager:push-local-database-to-remote", () => manager.pushLocalDatabaseToRemote());

	ipcMain.handle("manager:apply-database-sanitation", (_event, actionIds) => manager.applyDatabaseSanitation(actionIds));

	// Database protection channels. These generate/verify keys, convert plaintext
	// databases, rotate active keys, and maintain encrypted backup metadata.
	ipcMain.handle("manager:prepare-database-protection", () => manager.prepareDatabaseProtection());
	ipcMain.handle("manager:verify-database-protection", () => manager.verifyDatabaseProtection());
	ipcMain.handle("manager:convert-database-encryption", () => manager.convertDatabaseEncryption());
	ipcMain.handle("manager:rotate-database-key", (_event, options = {}) => manager.rotateDatabaseKey({
		rotateBackups: Boolean(options.rotateBackups),
	}));
	ipcMain.handle("manager:rotate-database-backups", () => manager.rotateDatabaseBackups());
	ipcMain.handle("manager:export-database-key-backup", async () => {
		const result = await dialog.showSaveDialog(mainWindow, {
			defaultPath: "hachi-db-key-backup.key",
			filters: [
				{ name: "Key backup", extensions: ["key", "txt"] },
				{ name: "All files", extensions: ["*"] },
			],
			title: "Export database key backup",
		});

		if (result.canceled || !result.filePath) {
			return { ok: false, message: "Database key backup export canceled." };
		}

		return manager.exportDatabaseKeyBackup(result.filePath);
	});

	// OS integration channel. shell.openPath has to stay in the main process
	// because the renderer is intentionally sandboxed away from shell access.
	ipcMain.handle("manager:open-install-folder", async () => {
		const installPath = manager.getInstallPath();
		// shell.openPath returns an empty string when it succeeds.
		const result = await shell.openPath(installPath);
		return { ok: result === "", message: result || "Opened install folder." };
	});
}

// Once Electron is ready, decide the default Hachi install folder, create the
// backend manager, register IPC routes, and show the first window.
const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
	app.quit();
} else {
	app.on("second-instance", focusMainWindow);

	app.whenReady().then(() => {
		// In development, HachiGen is normally cloned beside Hachi. In the packaged
		// exe, the safest default is beside HachiGen.exe until the user picks Hachi.
		const defaultInstallPath = app.isPackaged ?
			path.dirname(process.execPath) :
			resolveDevelopmentInstallPath();

		manager = new HachiManager({
			managerRoot: __dirname,
			defaultInstallPath,
			userDataPath: app.getPath("userData"),
			sendEvent,
		});
		manager.startLogCleanup({ runImmediately: true });
		manager.initCrashHandlers();

		app.on("child-process-gone", (_event, details) => {
			recordProcessRecovery(`Electron child process exited: ${details.type || "unknown"} ${details.reason || "unknown"}.`, details);
		});

		registerIpc();
		Menu.setApplicationMenu(buildApplicationMenu());
		createWindow();

		app.on("activate", () => {
			// macOS convention: clicking the app icon should reopen a window.
			if (BrowserWindow.getAllWindows().length === 0) {
				createWindow();
			}
		});
	});
}

app.on("before-quit", () => {
	saveMainWindowState();

	if (manager) {
		manager.stopLogCleanup();
	}
});

app.on("window-all-closed", () => {
	// On macOS, apps often stay open after the last window closes.
	// Windows/Linux apps normally quit, so HachiGen follows that behavior.
	if (process.platform !== "darwin") {
		app.quit();
	}
});
