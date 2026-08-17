// HachiGen renderer controller.
//
// This file owns browser-window state only. It never reads files or runs shell
// commands directly; every privileged action goes through window.hachiGen, which
// preload.js maps to IPC handlers in the Electron main process.
const api = window.hachiGen;

// renderer/app.js runs inside the visible HachiGen window.
// It reads state from the backend, updates text/classes in index.html,
// and turns button clicks into calls to window.hachiGen from preload.js.

// Human-readable titles for each sidebar view.
const viewTitles = {
	dashboard: "Dashboard",
	fleet: "Fleet",
	credentials: "Credentials",
	security: "Security",
	setup: "Setup",
	remote: "Remote",
	updates: "Updates",
	database: "Database",
	logs: "Logs",
	diagnostics: "Diagnostics",
};
const ONBOARDING_DISMISSED_KEY = "hachigen:onboarding-dismissed:v1";
// Inline Lucide SVG shapes. Keeping these here avoids extra asset files or runtime packages.
const ICON_PATHS = {
	archive: [
		["rect", { height: "5", rx: "1", width: "20", x: "2", y: "3" }],
		["path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" }],
		["path", { d: "M10 12h4" }],
	],
	check: [["path", { d: "M20 6 9 17l-5-5" }]],
	clipboard: [
		["rect", { height: "4", rx: "1", ry: "1", width: "8", x: "8", y: "2" }],
		["path", { d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" }],
	],
	copy: [
		["rect", { height: "14", rx: "2", ry: "2", width: "14", x: "8", y: "8" }],
		["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }],
	],
	database: [
		["ellipse", { cx: "12", cy: "5", rx: "9", ry: "3" }],
		["path", { d: "M3 5V19A9 3 0 0 0 21 19V5" }],
		["path", { d: "M3 12A9 3 0 0 0 21 12" }],
	],
	download: [
		["path", { d: "M12 15V3" }],
		["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
		["path", { d: "m7 10 5 5 5-5" }],
	],
	external: [
		["path", { d: "M15 3h6v6" }],
		["path", { d: "M10 14 21 3" }],
		["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }],
	],
	folder: [["path", { d: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" }]],
	key: [
		["path", { d: "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" }],
		["circle", { cx: "16.5", cy: "7.5", fill: "currentColor", r: ".5" }],
	],
	layoutDashboard: [
		["rect", { height: "9", rx: "1", width: "7", x: "3", y: "3" }],
		["rect", { height: "5", rx: "1", width: "7", x: "14", y: "3" }],
		["rect", { height: "9", rx: "1", width: "7", x: "14", y: "12" }],
		["rect", { height: "5", rx: "1", width: "7", x: "3", y: "16" }],
	],
	logs: [
		["path", { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" }],
		["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }],
		["path", { d: "M10 9H8" }],
		["path", { d: "M16 13H8" }],
		["path", { d: "M16 17H8" }],
	],
	package: [
		["path", { d: "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" }],
		["path", { d: "M12 22V12" }],
		["polyline", { points: "3.29 7 12 12 20.71 7" }],
		["path", { d: "m7.5 4.27 9 5.15" }],
	],
	play: [["path", { d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" }]],
	refresh: [
		["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }],
		["path", { d: "M21 3v5h-5" }],
		["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }],
		["path", { d: "M8 16H3v5" }],
	],
	remote: [
		["rect", { height: "8", rx: "2", ry: "2", width: "20", x: "2", y: "2" }],
		["rect", { height: "8", rx: "2", ry: "2", width: "20", x: "2", y: "14" }],
		["line", { x1: "6", x2: "6.01", y1: "6", y2: "6" }],
		["line", { x1: "6", x2: "6.01", y1: "18", y2: "18" }],
	],
	restore: [
		["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }],
		["path", { d: "M3 3v5h5" }],
	],
	save: [
		["path", { d: "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" }],
		["path", { d: "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" }],
		["path", { d: "M7 3v4a1 1 0 0 0 1 1h7" }],
	],
	search: [
		["path", { d: "m21 21-4.34-4.34" }],
		["circle", { cx: "11", cy: "11", r: "8" }],
	],
	send: [
		["path", { d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" }],
		["path", { d: "m21.854 2.147-10.94 10.939" }],
	],
	settings: [
		["path", { d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" }],
		["circle", { cx: "12", cy: "12", r: "3" }],
	],
	shield: [["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }]],
	shieldCheck: [
		["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }],
		["path", { d: "m9 12 2 2 4-4" }],
	],
	square: [["rect", { height: "18", rx: "2", width: "18", x: "3", y: "3" }]],
	trash: [
		["path", { d: "M10 11v6" }],
		["path", { d: "M14 11v6" }],
		["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
		["path", { d: "M3 6h18" }],
		["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
	],
	upload: [
		["path", { d: "M12 3v12" }],
		["path", { d: "m17 8-5-5-5 5" }],
		["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
	],
	wrench: [["path", { d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" }]],
};
const VIEW_ICONS = {
	dashboard: "layoutDashboard",
	fleet: "remote",
	credentials: "key",
	security: "shieldCheck",
	database: "database",
	diagnostics: "shieldCheck",
	logs: "logs",
	remote: "remote",
	setup: "settings",
	updates: "download",
};
const ACTION_ICONS = {
	"apply-sanitize": "shieldCheck",
	"about-close": "square",
	"backup-database": "archive",
	"database-transfer-backup": "archive",
	"database-transfer-close": "square",
	"database-transfer-pull": "download",
	"database-transfer-push": "upload",
	"database-transfer-restore": "restore",
	browse: "folder",
	"browse-ssh-key": "folder",
	"check-hachigen-update": "download",
	"check-all-updates": "download",
	"check-updates": "download",
	"clear-hachigen-logs": "trash",
	"clear-pm2-logs": "trash",
	"copy-diagnostic-info": "copy",
	"copy-secret": "copy",
	"delete-stash": "trash",
	deploy: "send",
	"export-database-key-backup": "key",
	"export-support-bundle": "package",
	"force-migrate-database": "database",
	"generate-database-key": "key",
	"hachigen-update-close": "square",
	"hachigen-update-start": "download",
	"install-validate": "wrench",
	"migrate-database": "database",
	"open-folder": "folder",
	"open-hachigen-log-folder": "logs",
	"open-hachigen-release": "external",
	"show-about": "clipboard",
	refresh: "refresh",
	"refresh-database-viewer": "refresh",
	"refresh-diagnostics": "refresh",
	restart: "restore",
	"restore-database": "restore",
	"restore-stash": "restore",
	"rotate-database-backups": "restore",
	"save-path": "save",
	"save-remote-settings": "save",
	"setup-guide-close": "square",
	"setup-guide-primary": "check",
	"show-database": "database",
	"show-diagnostics": "shieldCheck",
	"show-logs": "logs",
	"show-remote": "remote",
	"show-setup": "settings",
	"show-setup-guide": "check",
	"show-updates": "download",
	"start": "play",
	stop: "square",
	"test-remote": "search",
	update: "download",
	"update-hachi": "download",
	validate: "check",
	"verify-database-protection": "shieldCheck",
};
const ABOUT_LINKS = {
	changelog: "https://github.com/FearlessKenji/HachiGen/blob/main/CHANGELOG.md",
	patchNotes: "https://github.com/FearlessKenji/HachiGen/blob/main/docs/patch-notes.md",
	readme: "https://github.com/FearlessKenji/HachiGen#readme",
	releases: "https://github.com/FearlessKenji/HachiGen/releases",
};

// These names must match the input "name" attributes in index.html and the
// ENV_FIELDS/CONFIG_FIELDS lists in src/manager.js.
const configFields = [
	"TOKEN",
	"clientId",
	"guildIds",
	"botOwners",
	"twitchClientId",
	"twitchSecret",
	"kickClientId",
	"kickSecret",
	"twitchCron",
	"kickCron",
	"birthdayCron",
	"statusCron",
	"authCron",
];
const envConfigFields = [
	"TOKEN",
	"clientId",
	"twitchClientId",
	"twitchSecret",
	"kickClientId",
	"kickSecret",
];

// Shared UI state. Keeping these values here avoids reading the DOM to figure
// out what the app is currently showing.
//
// state: latest backend snapshot from manager.getState().
// activeView: sidebar view currently visible.
// busy: global action lock that disables buttons during backend work.
// logPollTimer/pm2LogBaseline: live log polling and "clear visible logs" offset.
// pendingLogText/activeLogSelectionElementId: delayed log-pane redraws while text is selected.
// sanitizeReport: last database sanitation review/apply result.
// databaseView/databaseSort/databaseViewerLoading: table preview state.
// forceMigrationUnlocked: one-session flag for the dangerous migration button.
// confirmationResolve: current modal promise resolver.
// lastConfig: latest Setup config metadata, used to restore copy-button state.
// hachiGenUpdateWizard: active self-update wizard state while the modal is open.
// setupGuidePrimaryAction/setupGuideOpen: current setup-guide modal routing.
// diagnosticsState: latest full diagnostics payload shown on the Diagnostics tab.
let state = null;
let hachiVersionUpdate = null;
let activeView = "dashboard";
let busy = false;
let logPollTimer = null;
let pm2LogBaseline = null;
let lastPm2LogText = "";
let hachiGenLogHistoryHidden = false;
let activeLogSelectionElementId = "";
let logSelectionResumeTimer = null;
const pendingLogText = {
	eventLogs: null,
	pm2Logs: null,
};
let sanitizeReport = null;
let databaseView = null;
let databaseViewerLoading = false;
let databaseSort = { column: "", direction: "" };
let forceMigrationUnlocked = false;
let confirmationResolve = null;
let lastConfig = null;
let hachiGenUpdateWizard = null;
let setupGuidePrimaryAction = "show-setup";
let setupGuideOpen = false;
let setupGuideAutoShown = false;
let diagnosticsState = null;
let fleetState = null;

function setDatabaseView(nextView) {
	// Keep database viewer state assignment outside async loader internals.
	// This avoids noisy race-condition lint warnings while staying explicit.
	databaseView = nextView;
}

function setDatabaseViewerLoading(nextLoading) {
	// This flag lets the UI disable viewer controls during a table load.
	databaseViewerLoading = nextLoading;
}

function setDatabaseSort(nextSort) {
	// Keep sort-state writes explicit and lint-friendly around async loads.
	databaseSort = nextSort;
}

// Tiny DOM helpers. They centralize common document lookups so the rest of
// this file can read like UI intent instead of repeated querySelector calls.
function $(selector) {
	return document.querySelector(selector);
}

function $all(selector) {
	return Array.from(document.querySelectorAll(selector));
}

function createIcon(iconName) {
	const paths = ICON_PATHS[iconName];

	if (!paths) {
		return null;
	}

	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.classList.add("ui-icon");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("focusable", "false");
	svg.setAttribute("viewBox", "0 0 24 24");

	for (const shape of paths) {
		const [tagName, attrs] = Array.isArray(shape) ? shape : ["path", { d: shape }];
		const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);

		for (const [name, value] of Object.entries(attrs)) {
			element.setAttribute(name, value);
		}

		svg.append(element);
	}

	return svg;
}

function setElementText(element, value) {
	if (element?.tagName === "BUTTON") {
		const icon = element.querySelector(".ui-icon")?.cloneNode(true);
		element.textContent = "";

		if (icon) {
			element.append(icon);
		}

		element.append(document.createTextNode(value ?? ""));
		return;
	}

	if (element) {
		element.textContent = value ?? "";
	}
}

function decorateControlIcon(element, iconName) {
	if (!element || !iconName || element.querySelector(".ui-icon")) {
		return;
	}

	const icon = createIcon(iconName);

	if (icon) {
		element.prepend(icon);
	}
}

function iconNameForControl(element) {
	if (!element) {
		return "";
	}

	if (element.dataset.view) {
		return VIEW_ICONS[element.dataset.view] || "";
	}

	return ACTION_ICONS[element.dataset.action] || "";
}

function decorateStaticIcons(root = document) {
	root.querySelectorAll("button[data-action], button[data-view]").forEach(button => {
		decorateControlIcon(button, iconNameForControl(button));
	});
}

// Safely update text when an element exists. Missing elements are ignored so
// one renderer function can update several views without crashing off-screen tabs.
function setText(selector, value) {
	const element = $(selector);

	setElementText(element, value);
}

function selectedTextTouchesElement(element) {
	const selection = window.getSelection();

	if (!element || !selection || selection.isCollapsed || selection.rangeCount === 0) {
		return false;
	}

	for (let index = 0; index < selection.rangeCount; index += 1) {
		const range = selection.getRangeAt(index);

		try {
			if (range.intersectsNode(element)) {
				return true;
			}
		} catch {
			return element.contains(selection.anchorNode) || element.contains(selection.focusNode);
		}
	}

	return false;
}

function isLogSelectionActive(element) {
	return Boolean(element && (activeLogSelectionElementId === element.id || selectedTextTouchesElement(element)));
}

function applyLogText(element, text, scrollToBottom = false) {
	element.textContent = text ?? "";

	if (scrollToBottom) {
		element.scrollTop = element.scrollHeight;
	}
}

function setLogText(logElementId, text, options = {}) {
	const element = $(`#${logElementId}`);

	if (!element) {
		return;
	}

	if (isLogSelectionActive(element)) {
		pendingLogText[logElementId] = {
			scrollToBottom: Boolean(options.scrollToBottom),
			text: text ?? "",
		};
		return;
	}

	pendingLogText[logElementId] = null;
	applyLogText(element, text, Boolean(options.scrollToBottom));
}

function currentOrPendingLogText(logElementId) {
	const pending = pendingLogText[logElementId];

	if (pending) {
		return pending.text;
	}

	const element = $(`#${logElementId}`);
	return element?.textContent || "";
}

function flushPendingLogText() {
	for (const [logElementId, pending] of Object.entries(pendingLogText)) {
		const element = $(`#${logElementId}`);

		if (!pending || !element || isLogSelectionActive(element)) {
			continue;
		}

		pendingLogText[logElementId] = null;
		applyLogText(element, pending.text, pending.scrollToBottom);
	}
}

function schedulePendingLogFlush() {
	if (logSelectionResumeTimer) {
		clearTimeout(logSelectionResumeTimer);
	}

	logSelectionResumeTimer = setTimeout(() => {
		logSelectionResumeTimer = null;
		flushPendingLogText();
	}, 120);
}

function clearLogText(logElementId) {
	pendingLogText[logElementId] = null;
	setText(`#${logElementId}`, "");
}

function setInputValue(selector, value) {
	const element = $(selector);

	if (element && document.activeElement !== element) {
		element.value = value ?? "";
	}
}

// Replace a status dot's classes with the current health class. The color is
// defined in CSS, so JavaScript only decides the state, not the styling.
function setDot(selector, status) {
	const element = $(selector);

	if (!element) {
		return;
	}

	element.className = `dot ${status || "muted"}`;
}

// Enable or disable a single button by selector. This is mainly used for
// buttons whose availability depends on backend state, such as stash actions.
function setDisabled(selector, disabled) {
	const element = $(selector);

	if (element) {
		element.disabled = disabled;
	}
}

// Convert PM2's byte count into a compact memory label for the runtime card.
function formatBytes(bytes) {
	if (!bytes) {
		return "0 MB";
	}

	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatFileSize(bytes) {
	if (!bytes) {
		return "0 B";
	}

	const units = ["B", "KB", "MB", "GB"];
	let value = Number(bytes) || 0;
	let unitIndex = 0;

	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}

	return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

// Convert machine-ish statuses like "not-registered" into readable UI text.
function formatStatusLabel(status) {
	const text = String(status || "Unknown").trim();

	if (!text) {
		return "Unknown";
	}

	return text
		.split(/[-_\s]+/)
		.map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join(" ");
}

// Shorten long install paths for the sidebar while keeping the most useful
// right-hand portion visible, which usually contains the project folder name.
function shortPath(filePath) {
	if (!filePath) {
		return "Not set";
	}

	if (filePath.length <= 44) {
		return filePath;
	}

	return `...${filePath.slice(-41)}`;
}

function shortRemoteUrl(remoteUrl) {
	if (!remoteUrl) {
		return "origin not set";
	}

	const text = String(remoteUrl).trim().replace(/\.git$/u, "");
	const githubMatch = text.match(/github\.com[:/](.+)$/u);
	const label = githubMatch ? githubMatch[1] : text;

	if (label.length <= 36) {
		return label;
	}

	return `...${label.slice(-33)}`;
}

function repositoryRemoteLabel(repository) {
	if (!repository?.isGit) {
		return "Repo: Not a Git checkout";
	}

	return `Repo: ${shortRemoteUrl(repository.originUrl)}`;
}

function repositoryBranchLabel(repository) {
	if (!repository?.isGit) {
		return "Branch: Not available";
	}

	return `Branch: ${repository.currentBranch || "Unknown"}`;
}

function updateTargetLabel(updates) {
	return updates?.updateTarget || state?.repository?.updateTarget || "origin/main";
}

// Update panels report check context only; app/version identity lives in About
// and troubleshooting details live in Diagnostics.
function updateMetaLabel(updates, repository) {
	if (!updates?.checkedAt) {
		return repository?.isGit ?
			`Branch: ${repository.currentBranch || "Unknown"} | Target: ${repository.updateTarget || "origin/main"}` :
			"Not checked";
	}

	const checkedAt = new Date(updates.checkedAt).toLocaleString();
	const branch = updates.currentBranch || repository?.currentBranch || "Unknown";
	const target = updateTargetLabel(updates);
	return `Last checked: ${checkedAt} | Branch: ${branch} | Target: ${target}`;
}

function hachiGenUpdateMetaLabel(update) {
	if (!update?.checkedAt) {
		return "Not checked";
	}

	const checkedAt = new Date(update.checkedAt).toLocaleString();
	const assetSize = update.assetSize ? ` | Download size: ${formatFileSize(update.assetSize)}` : "";

	return `Last checked: ${checkedAt}${assetSize}`;
}

function updateSummaryText(update) {
	if (!update || update.status === "unchecked") {
		return "Not checked";
	}

	if (update.status === "available" || update.updateAvailable || update.canInstall) {
		return "Update available";
	}

	if (update.status === "current") {
		return "Current";
	}

	if (update.status === "error") {
		return "Needs attention";
	}

	return formatStatusLabel(update.status || "checked");
}

function hachiCurrentVersionLabel() {
	return hachiVersionUpdate?.currentVersion || state?.scan?.packageVersion || "Unknown";
}

function hachiAvailableVersionLabel() {
	if (!hachiVersionUpdate) {
		if (state?.updates?.available) {
			return "Available";
		}

		if (state?.updates?.status === "current") {
			return "None";
		}

		return "Not checked";
	}

	if (hachiVersionUpdate.updateAvailable) {
		return hachiVersionUpdate.repositoryVersion || "Available";
	}

	return hachiVersionUpdate.repositoryVersion || "None";
}

function hachiStatusMessage() {
	if (hachiVersionUpdate?.message) {
		return hachiVersionUpdate.message;
	}

	return state?.updates?.message || "Check for Hachi updates.";
}

function hachiDashboardUpdateLabel() {
	const current = hachiCurrentVersionLabel();

	if (hachiVersionUpdate?.updateAvailable) {
		return `${current} -> ${hachiVersionUpdate.repositoryVersion || "available"}`;
	}

	return updateSummaryText(state?.updates);
}

function hachiGenCurrentVersionLabel(update = state?.hachiGenUpdate) {
	return update?.currentVersion || state?.hachiGenVersion || "Unknown";
}

function hachiGenAvailableVersionLabel(update = state?.hachiGenUpdate) {
	if (!update?.checkedAt) {
		return "Not checked";
	}

	if (update.updateAvailable || update.canInstall) {
		return update.latestTag || "Available";
	}

	return update.latestTag || "None";
}

function hachiGenDashboardUpdateLabel(update = state?.hachiGenUpdate) {
	const current = hachiGenCurrentVersionLabel(update);

	if (update?.updateAvailable || update?.canInstall) {
		return `${current} -> ${update.latestTag || "available"}`;
	}

	return updateSummaryText(update);
}

function dashboardTargetModeLabel(nextState) {
	return nextState?.runtimeTarget === "remote" ? "Remote server" : "Local";
}

function dashboardTargetLocationLabel(nextState) {
	if (nextState?.runtimeTarget === "remote") {
		const settings = nextState?.remote?.settings || {};
		const host = settings.host ? `${settings.username || "user"}@${settings.host}` : "Remote not configured";
		return settings.remotePath ? `${host}:${settings.remotePath}` : host;
	}

	return nextState?.installPath || "Not set";
}

function dashboardActivitySummary(events = []) {
	const visibleEvents = [...events].reverse().filter(event => event?.uiVisible !== false);
	const lastError = visibleEvents.find(event => event.type === "error");
	const latest = lastError || visibleEvents[0];

	if (!latest) {
		return "No recent activity loaded.";
	}

	const prefix = lastError ? "Last error" : "Latest";
	const time = latest.time ? new Date(latest.time).toLocaleTimeString() : "recently";
	return `${prefix} ${time}: ${latest.message || "Activity recorded."}`;
}

// Disable action buttons while a backend action is running. Sidebar navigation
// stays enabled so the user can keep reading status/logs during long work.
function setBusy(nextBusy) {
	busy = nextBusy;
	$all("button:not([data-view])").forEach(button => {
		button.disabled = busy;
	});
}

function rendererLogMessage(message, fallback = "HachiGen event recorded without a message.") {
	// UI-generated errors may include exception text from many places. Redact the
	// common secret shapes before showing a fallback log entry in the renderer.
	return String(message || fallback)
		.replace(/((?:TOKEN|clientId|twitchClientId|twitchSecret|kickClientId|kickSecret|HACHI_DB_KEY|HACHI_SECRETS_KEY)=)(?:"[^"]*"|'[^']*'|\S+)/giu, "$1[redacted]")
		.replace(/(client(?:ID|Id|id|Secret)|token|secret)(["':=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/giu, "$1$2[redacted]");
}

function readableErrorMessage(error, fallback = "Unexpected HachiGen error.") {
	return rendererLogMessage(error?.message || error, fallback)
		.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/u, "")
		.replace(/^ShellError:\s*/u, "");
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function actionErrorMessage(label, error) {
	const reason = readableErrorMessage(error, `${label} failed.`);

	if (new RegExp(`^${escapeRegExp(label)}\\b`, "iu").test(reason) || (label === "Update" && /\bupdate failed\b/iu.test(reason))) {
		return reason;
	}

	return `${label} failed: ${reason}`;
}

function recordRendererEvent(type, message, details = {}) {
	// Send renderer-only events to the backend operation log. main.js will echo
	// the saved event back through api.onEvent(), so the visible Logs panel and
	// the actual HachiGen event history stay in sync.
	const safeMessage = rendererLogMessage(message, type === "error" ? "Unexpected HachiGen error." : "HachiGen event recorded.");

	if (!api.recordRendererEvent) {
		appendEvent({
			type,
			message: safeMessage,
			details,
			time: new Date().toISOString(),
		});
		return;
	}

	api.recordRendererEvent({
		type,
		message: safeMessage,
		details,
	}).catch(error => {
		// If the IPC bridge itself failed, still leave something visible in the
		// current window instead of letting the error disappear.
		appendEvent({
			type: "error",
			message: `Could not write HachiGen event log: ${rendererLogMessage(error.message || error)} Original event: ${safeMessage}`,
			time: new Date().toISOString(),
		});
	});
}

// Show a small temporary message in the bottom-right corner. Error toasts also
// write to the backend event log so the popup is never the only record.
function toast(message, type = "info", options = {}) {
	const text = rendererLogMessage(message, type === "error" ? "Unexpected HachiGen error." : "");

	if (type === "error" && options.log !== false) {
		recordRendererEvent("error", text, {
			label: options.label || "UI error",
		});
	}

	const region = $("#toastRegion");
	const item = document.createElement("div");
	item.className = `toast ${type}`;
	item.textContent = text;
	region.append(item);
	setTimeout(() => item.remove(), 4200);
}

// Convert a backend event object into one readable log line for the HachiGen
// log window. Shell output keeps its stdout/stderr/command prefix.
function eventLine(event) {
	const time = event.time ? new Date(event.time).toLocaleTimeString() : new Date().toLocaleTimeString();
	const streamLabels = {
		command: "Command",
		stderr: "Notice",
		stdout: "Output",
	};
	const typeLabels = {
		error: "Error",
		log: "HachiGen",
		shell: "Shell",
	};
	const prefix = event.type === "shell" && event.details?.stream ?
		streamLabels[event.details.stream] || "Shell" :
		typeLabels[event.type] || event.type;
	return `[${time}] ${prefix}: ${event.message}`;
}

// Append one live HachiGen event to the visible log window and keep only the
// newest lines so long installs do not make the UI sluggish.
function appendEvent(event) {
	const output = $("#eventLogs");

	if (!output) {
		return;
	}

	const currentText = currentOrPendingLogText("eventLogs");
	const current = currentText === "No manager activity yet." ? "" : currentText;
	const nextText = `${current}${current ? "\n" : ""}${eventLine(event)}`.split("\n").slice(-220).join("\n");

	setLogText("eventLogs", nextText, { scrollToBottom: true });
}

// Apply the current tab selection to the sidebar and content panels. This is
// also where log polling starts or stops after view changes.
function renderViews() {
	$all(".nav-item").forEach(button => {
		button.classList.toggle("active", button.dataset.view === activeView);
	});
	$all("[data-view-panel]").forEach(panel => {
		panel.classList.toggle("active", panel.dataset.viewPanel === activeView);
	});
	setText("#viewTitle", viewTitles[activeView] || "HachiGen");
	updateLogPolling();
}

// Change tabs by updating activeView, then redraw view visibility. Opening
// Logs or Database also fetches fresh data so those panels are useful immediately.
function showView(viewName) {
	activeView = viewName;
	renderViews();

	if (activeView === "logs") {
		refreshLogs();
	}

	if (activeView === "database" && state?.database?.exists && !databaseView) {
		loadDatabaseViewer();
	}

	if (activeView === "diagnostics") {
		loadDiagnostics().catch(error => {
			toast(error.message || "Diagnostics refresh failed.", "error", { label: "Diagnostics" });
		});
	}
}

function handleLogSelectionPointerDown(event) {
	const logOutput = event.target.closest?.("#pm2Logs, #eventLogs");
	activeLogSelectionElementId = logOutput?.id || "";

	if (!logOutput) {
		schedulePendingLogFlush();
	}
}

function handleLogSelectionPointerUp() {
	if (!activeLogSelectionElementId) {
		return;
	}

	activeLogSelectionElementId = "";
	schedulePendingLogFlush();
}

function handleLogSelectionChange() {
	schedulePendingLogFlush();
}

function installRendererDiagnosticsHooks() {
	window.addEventListener("error", event => {
		recordRendererEvent("error", event.message || "Renderer error.", {
			filename: event.filename || "",
			label: "Renderer error",
			lineno: event.lineno || 0,
			source: "renderer",
		});
	});

	window.addEventListener("unhandledrejection", event => {
		const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || "Unhandled rejection.");
		recordRendererEvent("error", reason, {
			label: "Unhandled renderer promise rejection",
			source: "renderer",
		});
	});
}

function installHealth(scan) {
	// Translate quickScan() output into the three values the Dashboard needs:
	// a label, a dot color, and a short detail line.
	if (!scan?.projectFound) {
		return { label: "Missing", dot: "bad", detail: "Project files incomplete" };
	}

	if (!scan.configurationReady) {
		return { label: "Needs config", dot: "warn", detail: `${scan.configurationMissing.length} config fields missing` };
	}

	if (!scan.hasNodeModules) {
		return { label: "Needs deps", dot: "warn", detail: "Dependencies install during validation or start" };
	}

	if (scan.dependenciesReady === false) {
		return { label: "Needs deps", dot: "warn", detail: `${scan.missingDependencies?.length || 0} package dependencies missing` };
	}

	return { label: "Validated", dot: "good", detail: "Project files and config found" };
}

function updateHealth(updates) {
	// Translate the backend update state into a compact Dashboard summary.
	// Detailed commit/file lists are rendered separately on the Updates tab.
	if (!updates || updates.status === "unchecked") {
		return { label: "Not checked", dot: "warn", detail: "Checking on startup" };
	}

	if (updates.status === "available") {
		return {
			label: "Updates available",
			dot: "warn",
			detail: updates.blocked ? "Local changes will be stashed" : "Ready to update",
		};
	}

	if (updates.status === "current") {
		return { label: "Current", dot: "good", detail: "No update found" };
	}

	if (updates.status === "branch_current") {
		return { label: "Branch differs", dot: "info", detail: `Files match ${updateTargetLabel(updates)}` };
	}

	if (updates.status === "history_current") {
		return { label: "History differs", dot: "info", detail: `Files match ${updateTargetLabel(updates)}` };
	}

	if (updates.status === "branch_mismatch") {
		return {
			label: "Manual update",
			dot: "warn",
			detail: updates.committedFilesMatchTarget ? "Local changes found" : `On ${updates.currentBranch || "another branch"}`,
		};
	}

	if (updates.status === "not_git") {
		return { label: "Manual", dot: "warn", detail: "Not a Git checkout" };
	}

	return { label: "Review", dot: "warn", detail: updates.message || "Update state needs review" };
}

function databaseHealth(database) {
	// Database audit status comes from database/dbAudit.js. Keep this small
	// mapping here so the Dashboard can gracefully handle missing audit data.
	const audit = database?.audit;

	if (!database?.exists) {
		return { label: "Not Created", dot: "muted", detail: "No database found" };
	}

	if (!audit) {
		return { label: "Checking", dot: "info", detail: "Audit not loaded" };
	}

	return {
		detail: audit.detail || "Schema status loaded",
		dot: audit.dot || "warn",
		label: audit.label || "Review",
	};
}

function botHealth(pm2) {
	// Translate PM2 process data into a Dashboard status. HachiGen treats a
	// missing or unregistered PM2 process as Stopped rather than an app crash.
	if (pm2?.target === "remote" && pm2.status === "remote-error") {
		return { label: "Remote Error", dot: "bad", detail: pm2.message || "Remote PM2 status unavailable" };
	}

	if (!pm2?.installed) {
		return {
			label: "PM2 missing",
			dot: "warn",
			detail: pm2?.target === "remote" ? pm2.message || "Remote PM2 is unavailable" : "PM2 installs during validation or start",
		};
	}

	if (!pm2.registered) {
		return { label: "Stopped", dot: "bad", detail: pm2.message || "Hachi is not registered" };
	}

	if (pm2.status === "online") {
		const prefix = pm2.target === "remote" ? "Remote " : "";
		return { label: "Online", dot: "good", detail: `${prefix}PID ${pm2.pid || "n/a"} | ${formatBytes(pm2.memory)}` };
	}

	if (pm2.status === "stopped") {
		return { label: "Stopped", dot: "bad", detail: pm2.message || "Hachi is stopped." };
	}

	if (pm2.status === "errored") {
		return { label: "Errored", dot: "bad", detail: pm2.message || "PM2 reported an error" };
	}

	return { label: formatStatusLabel(pm2.status), dot: "warn", detail: pm2.message || "PM2 status loaded" };
}

function setupStepStatus(done, current) {
	if (done) {
		return "done";
	}

	return current ? "current" : "waiting";
}

const UPDATE_SETUP_READY_STATUSES = new Set(["current", "branch_current", "history_current", "branch_mismatch", "diverged", "not_git"]);

function updateSetupStepStatus(nextState, configurationReady) {
	const updateStatus = nextState?.updates?.status || "unchecked";
	const updateAvailable = Boolean(nextState?.updates?.available);
	const updatesReady = Boolean(configurationReady && nextState?.updates && !updateAvailable && UPDATE_SETUP_READY_STATUSES.has(updateStatus));

	if (!configurationReady) {
		return {
			action: "check-updates",
			actionLabel: "Check Updates",
			detail: "Save configuration before checking updates.",
			done: false,
			dot: "info",
			label: "Check updates",
		};
	}

	if (updateAvailable) {
		return {
			action: "show-updates",
			actionLabel: "View Updates",
			detail: nextState.updates.message || "A Hachi update is available.",
			done: false,
			dot: "warn",
			label: "Review updates",
		};
	}

	if (updateStatus === "unchecked") {
		return {
			action: "check-updates",
			actionLabel: "Check Updates",
			detail: "Check updates before starting Hachi.",
			done: false,
			dot: "info",
			label: "Check updates",
		};
	}

	if (updateStatus === "error") {
		return {
			action: "check-updates",
			actionLabel: "Check Updates",
			detail: nextState.updates?.message || "Update check needs attention.",
			done: false,
			dot: "bad",
			label: "Check updates",
		};
	}

	if (!updatesReady) {
		return {
			action: "show-updates",
			actionLabel: "View Updates",
			detail: nextState.updates?.message || "Update check needs attention.",
			done: false,
			dot: "warn",
			label: "Review updates",
		};
	}

	return {
		action: "show-updates",
		actionLabel: "Open Updates",
		detail: nextState.updates?.message || "Updates checked.",
		done: true,
		dot: "good",
		label: "Check updates",
	};
}

function setupProgress(nextState) {
	const scan = nextState?.scan || {};
	const remote = nextState?.remote || {};
	const usingRemote = nextState?.runtimeTarget === "remote";
	const remoteConfigured = !usingRemote || remote.configured;
	const installReady = Boolean(remoteConfigured && scan.projectFound);
	const dependenciesReady = Boolean(installReady && scan.hasNodeModules && scan.dependenciesReady !== false);
	const configurationReady = Boolean(installReady && scan.configurationReady);
	const updateStep = updateSetupStepStatus(nextState, configurationReady);
	const botOnline = nextState?.pm2?.status === "online";
	const steps = [
		{
			action: usingRemote && !remote.configured ? "show-remote" : "show-setup",
			actionLabel: usingRemote ? "Open Remote" : "Open Setup",
			detail: usingRemote && !remote.configured ?
				remote.errors?.[0] || "Remote connection details are not saved yet." :
				installReady ? "Hachi project files were found." : "Select or install a Hachi folder.",
			done: installReady,
			id: "install",
			label: usingRemote ? "Connect to Hachi" : "Find Hachi install",
		},
		{
			action: "install-validate",
			actionLabel: "Install / Validate",
			detail: dependenciesReady ?
				"Required packages are available." :
				"Install or repair dependencies before starting Hachi.",
			done: dependenciesReady,
			id: "dependencies",
			label: "Validate dependencies",
		},
		{
			action: "show-setup",
			actionLabel: "Open Setup",
			detail: configurationReady ?
				"Required configuration fields are saved." :
				`${scan.configurationMissing?.length || 0} required configuration fields need values.`,
			done: configurationReady,
			id: "configuration",
			label: "Save configuration",
		},
		{
			...updateStep,
			id: "updates",
		},
		{
			action: "start",
			actionLabel: "Start Hachi",
			detail: botOnline ? "Hachi is online." : nextState?.pm2?.message || "Start Hachi after updates are checked.",
			done: botOnline,
			id: "runtime",
			label: "Start runtime",
		},
	];
	const currentIndex = steps.findIndex(step => !step.done);

	return {
		complete: currentIndex === -1,
		currentStep: currentIndex === -1 ? null : steps[currentIndex],
		steps: steps.map((step, index) => ({
			...step,
			status: setupStepStatus(step.done, index === currentIndex),
		})),
	};
}

function setupRecommendation(nextState) {
	const progress = setupProgress(nextState);

	if (!progress.complete) {
		const step = progress.currentStep;
		return {
			action: step.action,
			actionLabel: step.actionLabel,
			detail: step.detail,
			dot: step.dot || (step.id === "install" ? "warn" : "info"),
			id: step.id,
			setupIncomplete: true,
			title: step.label,
		};
	}

	if (nextState?.database?.audit?.migrationAvailable) {
		return {
			action: "show-database",
			actionLabel: "Open Database",
			detail: nextState.database.audit.detail || "Database schema can be migrated safely.",
			dot: "warn",
			id: "database-migration",
			setupIncomplete: false,
			title: "Review database",
		};
	}

	if (nextState?.database?.audit?.forceMigrationAvailable) {
		return {
			action: "show-database",
			actionLabel: "Open Database",
			detail: nextState.database.audit.detail || "Database schema needs review before Hachi continues.",
			dot: "bad",
			id: "database-force-migration",
			setupIncomplete: false,
			title: "Database attention needed",
		};
	}

	if (nextState?.updates?.available) {
		return {
			action: "show-updates",
			actionLabel: "View Updates",
			detail: nextState.updates.message || "A Hachi update is available.",
			dot: "warn",
			id: "updates",
			setupIncomplete: false,
			title: "Review available update",
		};
	}

	if (!nextState?.updates || nextState.updates.status === "unchecked") {
		return {
			action: "show-updates",
			actionLabel: "Check Updates",
			detail: "No Hachi update check has run yet.",
			dot: "info",
			id: "check-updates",
			setupIncomplete: false,
			title: "Check for updates",
		};
	}

	return {
		action: "show-logs",
		actionLabel: "Open Logs",
		detail: nextState?.pm2?.message || "Hachi is ready. Logs are available if you want to watch runtime output.",
		dot: "good",
		id: "ready",
		setupIncomplete: false,
		title: "Hachi is ready",
	};
}

function onboardingDismissed() {
	try {
		return window.localStorage?.getItem(ONBOARDING_DISMISSED_KEY) === "true";
	} catch {
		return false;
	}
}

function dismissOnboardingGuide() {
	try {
		window.localStorage?.setItem(ONBOARDING_DISMISSED_KEY, "true");
	} catch {
		// Ignore storage errors; the guide can still close for this session.
	}
}

function renderInstallChecks(scan) {
	// Convert quickScan() output into the checklist under Setup -> Install.
	// Each row answers one setup question: are project files, config, packages,
	// and Git present enough for HachiGen to manage this folder?
	const container = $("#installChecks");

	if (!container || !scan) {
		return;
	}

	const checks = [
		["Project files", scan.projectFound, scan.missingFiles.length ? scan.missingFiles.join(", ") : "Found"],
		["Configuration", scan.configurationReady, scan.configurationReady ? "Ready" : scan.configurationMissing.join(", ")],
		["Node modules", scan.hasNodeModules, scan.hasNodeModules ? "Installed" : "Not installed yet"],
		["Dependencies", scan.dependenciesReady !== false, scan.dependenciesReady === false ? (scan.missingDependencies || []).join(", ") || "Missing packages" : "Ready"],
		["Git checkout", scan.hasGit, scan.hasGit ? "Available" : "Manual update mode"],
	];

	container.innerHTML = "";

	for (const [label, ok, detail] of checks) {
		const item = document.createElement("div");
		item.className = "check-item";

		const dot = document.createElement("span");
		dot.className = `dot ${ok ? "good" : "warn"}`;
		item.append(dot);

		const text = document.createElement("span");
		const strong = document.createElement("strong");
		strong.textContent = label;
		text.append(strong, `: ${detail}`);
		item.append(text);

		container.append(item);
	}
}

function renderConfig(config) {
	// Copy saved config values into the Setup form. The input names match
	// configFields, so this can fill both .env and config.json fields together.
	const form = $("#configForm");

	if (!form || !config?.values) {
		return;
	}

	lastConfig = config;

	for (const field of configFields) {
		const input = form.elements[field];
		const protection = config.envProtection?.fields?.[field];

		if (input) {
			if (protection?.hasValue) {
				input.value = "";
				input.placeholder = protection.encrypted ? "Encrypted value saved" : "Saved value will be encrypted on save";
				input.dataset.protectedValue = "true";
			} else {
				input.value = config.values[field] || "";
				input.placeholder = "";
				delete input.dataset.protectedValue;
			}
		}

		if (envConfigFields.includes(field)) {
			const copyButton = form.querySelector(`[data-action="copy-secret"][data-secret-field="${field}"]`);

			if (copyButton) {
				copyButton.disabled = !protection?.copyable;
				copyButton.title = protection?.copyable ?
					"Copy saved value to clipboard for 60 seconds" :
					"Save an encrypted value before copying";
			}
		}
	}
}

function selectedRemotePortMode() {
	return $("input[name=\"remotePortMode\"]:checked")?.value === "custom" ? "custom" : "default";
}

function updateRemotePortMode() {
	const portInput = $("#remotePortInput");

	if (portInput) {
		portInput.disabled = selectedRemotePortMode() !== "custom";
	}
}

function readRemoteForm() {
	return {
		host: $("#remoteHostInput")?.value || "",
		username: $("#remoteUsernameInput")?.value || "",
		sshKeyPath: $("#remoteSshKeyInput")?.value || "",
		portMode: selectedRemotePortMode(),
		port: $("#remotePortInput")?.value || "22",
		remotePath: $("#remotePathInput")?.value || "",
		pm2Name: $("#remotePm2Input")?.value || "Hachi",
	};
}

function renderRemote(remote, runtimeTarget = "local") {
	const settings = remote?.settings || {};
	const portMode = settings.portMode === "custom" ? "custom" : "default";
	const target = settings.host ? `${settings.username || "user"}@${settings.host}` : "Not configured";
	const portLabel = portMode === "custom" ? String(settings.port || "") : "22 (default)";
	const errors = remote?.errors || [];
	const lastTest = remote?.lastTest;
	const lastTestLabel = lastTest?.checkedAt ?
		`${lastTest.ok ? "Passed" : "Failed"} ${formatDateTime(lastTest.checkedAt)}${lastTest.message ? ` - ${lastTest.message}` : ""}` :
		"Not tested";

	setInputValue("#remoteHostInput", settings.host || "");
	setInputValue("#remoteUsernameInput", settings.username || "");
	setInputValue("#remoteSshKeyInput", settings.sshKeyPath || "");
	setInputValue("#remotePortInput", settings.port || 22);
	setInputValue("#remotePathInput", settings.remotePath || "");
	setInputValue("#remotePm2Input", settings.pm2Name || "Hachi");

	$all("input[name=\"remotePortMode\"]").forEach(input => {
		input.checked = input.value === portMode;
	});
	$all("input[name=\"runtimeTarget\"]").forEach(input => {
		input.checked = input.value === runtimeTarget;
	});
	updateRemotePortMode();

	setText("#remoteMeta", remote?.configured ? `Ready: ${target}` : errors[0] || "Not configured");
	setText("#remotePreviewTarget", target);
	setText("#remotePreviewPort", portLabel);
	setText("#remotePreviewPath", settings.remotePath || "Not configured");
	setText("#remotePreviewPm2", settings.pm2Name || "Hachi");
	setText("#remotePreviewLastTest", lastTestLabel);
}

function formatRemoteTestOutput(result) {
	const lines = [
		`Status: ${result.ok ? "Validated" : "Failed"}`,
		`Checked: ${formatDateTime(result.checkedAt)}`,
		`Exit code: ${result.code}`,
	];
	const stdout = String(result.stdout || "").trim();
	const stderr = String(result.stderr || "").trim();

	if (stdout) {
		lines.push(`stdout:\n${stdout}`);
	}

	if (stderr) {
		lines.push(`stderr:\n${stderr}`);
	}

	return lines.join("\n\n");
}

function pluralize(count, singular, plural = `${singular}s`) {
	// Format simple count labels such as "1 file" vs "2 files".
	return `${count} ${count === 1 ? singular : plural}`;
}

function renderSimpleList(selector, items, emptyText, renderItem) {
	// Clear and rebuild a list from data. Callers provide renderItem so the
	// same helper can render commits, empty states, or other simple rows.
	const list = $(selector);

	if (!list) {
		return;
	}

	list.innerHTML = "";

	if (!items.length) {
		const item = document.createElement("li");
		item.className = "update-list-empty";
		item.textContent = emptyText;
		list.append(item);
		return;
	}

	for (const entry of items) {
		list.append(renderItem(entry));
	}
}

function renderGroupedChangesList(selector, changes, emptyText) {
	// Group Git file changes by label, such as New, Modified, and Deleted.
	// The Local changes and Stashed changes panels share this layout so both
	// panels explain file status the same way.
	const list = $(selector);

	if (!list) {
		return;
	}

	if (!changes.length) {
		renderSimpleList(selector, [], emptyText, () => document.createElement("li"));
		return;
	}

	const groups = new Map();
	const groupOrder = ["New", "Modified", "Added", "Deleted", "Renamed", "Copied", "Conflict", "Changed"];

	for (const change of changes) {
		// Build a map such as { Modified: [file1, file2], New: [file3] }.
		if (!groups.has(change.label)) {
			groups.set(change.label, []);
		}

		groups.get(change.label).push(change);
	}

	list.innerHTML = "";

	for (const labelName of groupOrder) {
		const group = groups.get(labelName);

		if (!group?.length) {
			continue;
		}

		const groupItem = document.createElement("li");
		groupItem.className = "local-change-group";

		const heading = document.createElement("div");
		heading.className = "local-change-heading";

		const label = document.createElement("span");
		// CSS colors the label chip based on the change type.
		label.className = `change-label change-label-${labelName.toLowerCase()}`;
		label.textContent = labelName;
		heading.append(label);

		const count = document.createElement("span");
		count.textContent = pluralize(group.length, "file");
		heading.append(count);
		groupItem.append(heading);

		const fileList = document.createElement("ul");
		fileList.className = "local-change-files";

		for (const change of group) {
			const fileItem = document.createElement("li");
			fileItem.textContent = change.path;
			fileList.append(fileItem);
		}

		groupItem.append(fileList);
		list.append(groupItem);
	}
}

function renderStashedChanges(updates) {
	// Render the active HachiGen-created stash and enable Restore/Delete only
	// when there is actually a saved stash available.
	const stash = updates?.stash || null;
	const changes = stash?.changes || [];
	const panel = $("#savedChangesPanel");

	if (panel) {
		panel.hidden = !stash;
	}

	setDisabled("#restoreChangesButton", !stash);
	setDisabled("#deleteChangesButton", !stash);

	if (!stash) {
		setText("#stashSummary", "No saved HachiGen stash. If local changes exist during update, HachiGen will save them here first.");
		renderGroupedChangesList("#stashChangesList", [], "No stashed changes.");
		return;
	}

	const created = stash.createdAt ? new Date(stash.createdAt).toLocaleString() : "unknown time";
	setText(
		"#stashSummary",
		`Saved changes are available to restore from ${stash.ref}. Created ${created}. Restore applies them and keeps the stash until you delete it.`,
	);
	renderGroupedChangesList("#stashChangesList", changes, "No file list available for this stash.");
}

function renderHachiUpdateSummary() {
	const canUpdate = Boolean(state?.updates?.available);

	setText("#updatesMeta", updateMetaLabel(state?.updates, state?.repository));
	setText("#hachiCurrentVersion", hachiCurrentVersionLabel());
	setText("#hachiAvailableVersion", hachiAvailableVersionLabel());
	setText("#updateMessage", hachiStatusMessage());
	setDisabled("#hachiUpdateButton", !canUpdate);
}

function renderHachiGenUpdate(update) {
	// HachiGen updates come from GitHub release assets rather than the Hachi Git
	// checkout, so the page keeps its install action separate from check-all.
	const updateButton = $("#checkHachiGenUpdateButton");
	const canUpdate = Boolean(update?.canInstall);

	setText("#hachigenUpdateMeta", hachiGenUpdateMetaLabel(update));
	setText("#hachigenUpdateMessage", update?.message || "Check for HachiGen updates.");
	setText("#hachigenCurrentVersion", hachiGenCurrentVersionLabel(update));
	setText("#hachigenAvailableVersion", hachiGenAvailableVersionLabel(update));

	if (updateButton) {
		updateButton.className = "button primary";
		updateButton.disabled = !canUpdate;
		setElementText(updateButton, "Update HachiGen");
	}
}

function diagnosticSnapshotFromState(nextState) {
	return {
		app: {
			hachiGenVersion: nextState?.hachiGenVersion || "",
		},
		generatedAt: new Date().toISOString(),
		paths: {
			installPath: nextState?.installPath || "",
		},
		pm2: {
			message: nextState?.pm2?.message || "",
			status: nextState?.pm2?.status || "unknown",
			target: nextState?.pm2?.target || nextState?.runtimeTarget || "local",
		},
		recovery: diagnosticsState?.recovery || {
			crashCount: 0,
			recentCrashEvents: [],
		},
		repository: nextState?.repository || {},
		scan: nextState?.scan || {},
		settings: {
			runtimeTarget: nextState?.runtimeTarget || "local",
		},
		updates: {
			hachi: nextState?.updates || {},
			hachiGen: nextState?.hachiGenUpdate || {},
		},
	};
}

function updateStateLabel(update) {
	const status = update?.status || "unchecked";
	const message = update?.message || "";

	if (message) {
		return `${formatStatusLabel(status)}: ${message}`;
	}

	return formatStatusLabel(status);
}

function updateVerificationLabel(verification) {
	if (!verification?.sha256) {
		return "No downloaded update verified yet";
	}

	return `SHA-256 ${verification.sha256.slice(0, 12)}... | ${formatFileSize(verification.bytes)}`;
}

function renderDiagnostics(diagnostics = diagnosticsState || diagnosticSnapshotFromState(state)) {
	const runtimeTarget = diagnostics?.settings?.runtimeTarget || diagnostics?.pm2?.target || state?.runtimeTarget || "unknown";
	const recoveryEvents = diagnostics?.recovery?.recentCrashEvents || [];
	const lastRecoveryEvent = recoveryEvents[recoveryEvents.length - 1];
	const summary = [
		`Generated: ${diagnostics?.generatedAt || "Not loaded"}`,
		`Install: ${diagnostics?.paths?.installPath || "Unknown"}`,
		`Repository: ${diagnostics?.repository?.currentBranch || "unknown"} -> ${diagnostics?.repository?.updateTarget || "origin/main"}`,
		`Missing config: ${(diagnostics?.scan?.configurationMissing || []).join(", ") || "none"}`,
		`Missing packages: ${(diagnostics?.scan?.missingDependencies || []).join(", ") || "none"}`,
	].join("\n");

	setText("#diagnosticsMeta", diagnostics?.generatedAt ? `Last refreshed ${formatDateTime(diagnostics.generatedAt)}` : "Diagnostics have not been refreshed yet.");
	setText("#diagnosticsHachiGenVersion", diagnostics?.app?.hachiGenVersion || state?.hachiGenVersion || "Unknown");
	setText("#diagnosticsHachiVersion", diagnostics?.scan?.packageVersion || "Unknown");
	setText("#diagnosticsRuntimeTarget", formatStatusLabel(runtimeTarget));
	setText("#diagnosticsPm2Status", updateStateLabel(diagnostics?.pm2));
	setText("#diagnosticsHachiUpdate", updateStateLabel(diagnostics?.updates?.hachi));
	setText("#diagnosticsHachiGenUpdate", updateStateLabel(diagnostics?.updates?.hachiGen));
	setText("#diagnosticsUpdateVerification", updateVerificationLabel(diagnostics?.updates?.hachiGen?.verification));
	setText("#diagnosticsCrashLog", diagnostics?.recovery?.crashLog?.exists ? "Available" : "No crash log");
	setText("#diagnosticsCrashCount", String(diagnostics?.recovery?.crashCount || 0));
	setText("#diagnosticsRecoveryEvent", lastRecoveryEvent ? `${formatDateTime(lastRecoveryEvent.time)} | ${lastRecoveryEvent.message}` : "No recovery events");
	setText("#diagnosticsSummaryOutput", summary);
}

async function loadDiagnostics() {
	const diagnostics = await api.getDiagnostics();
	diagnosticsState = diagnostics;
	renderDiagnostics(diagnostics);
	return diagnostics;
}

function createSetupGuideSteps(progress) {
	const list = document.createElement("div");
	list.className = "setup-guide-steps";

	for (const step of progress.steps) {
		const item = document.createElement("div");
		item.className = `setup-guide-step ${step.status}`;

		const marker = document.createElement("span");
		marker.className = "setup-guide-marker";
		item.append(marker);

		const body = document.createElement("span");
		body.className = "setup-guide-step-body";

		const title = document.createElement("strong");
		title.textContent = step.label;
		body.append(title);

		const detail = document.createElement("span");
		detail.textContent = step.detail;
		body.append(detail);

		item.append(body);
		list.append(item);
	}

	return list;
}

function createAboutDetails(info) {
	const list = document.createElement("dl");
	list.className = "detail-list about-details";

	for (const [label, value] of [
		["HachiGen", info?.hachiGenVersion || state?.hachiGenVersion || "Unknown"],
		["Hachi", info?.hachiVersion || state?.scan?.packageVersion || "Unknown"],
		["Updates", info?.updateChannel || "Stable releases"],
		["User Data", info?.paths?.userDataPath || "Unknown"],
		["Logs", info?.paths?.logFolder || "Unknown"],
		["Settings", info?.paths?.settingsPath || "Unknown"],
	]) {
		const wrapper = document.createElement("div");
		const term = document.createElement("dt");
		const description = document.createElement("dd");

		term.textContent = label;
		description.textContent = value;
		wrapper.append(term, description);
		list.append(wrapper);
	}

	return list;
}

function createAboutLinks() {
	const wrapper = document.createElement("div");
	wrapper.className = "about-links";

	for (const [label, href] of [
		["README", ABOUT_LINKS.readme],
		["Release Notes", ABOUT_LINKS.patchNotes],
		["Changelog", ABOUT_LINKS.changelog],
		["Releases", ABOUT_LINKS.releases],
	]) {
		const link = document.createElement("a");

		link.href = href;
		link.rel = "noreferrer";
		link.target = "_blank";
		link.textContent = label;
		wrapper.append(link);
	}

	return wrapper;
}

function createReleaseNotesList(notes = []) {
	const list = document.createElement("ul");
	list.className = "modal-details about-release-notes";

	if (!notes.length) {
		const item = document.createElement("li");

		item.textContent = "No bundled release notes were found for this build.";
		list.append(item);
		return list;
	}

	for (const note of notes) {
		const item = document.createElement("li");

		item.textContent = note;
		list.append(item);
	}

	return list;
}

async function showAboutModal() {
	let info = null;

	try {
		info = await api.getAboutInfo();
	} catch (error) {
		recordRendererEvent("error", `About info failed: ${readableErrorMessage(error)}`, {
			label: "About HachiGen",
		});
	}

	showSharedModal({
		actions: [
			{ action: "show-diagnostics", label: "Diagnostics", variant: "info" },
			{ action: "about-close", label: "Close", variant: "primary" },
		],
		content: [
			createModalSummary("HachiGen is the desktop manager for Hachi. Releases are unsigned by choice; use the published SHA-256 checksums to verify downloads."),
			createAboutDetails(info || {}),
			createAboutLinks(),
			createModalSummary("Bundled release notes"),
			createReleaseNotesList(info?.releaseNotes || []),
		],
		meta: `HachiGen ${info?.hachiGenVersion || state?.hachiGenVersion || "Unknown"}`,
		title: "About HachiGen",
	});
}

function showSetupGuideModal() {
	const progress = setupProgress(state);
	const recommendation = setupRecommendation(state);
	const doneCount = progress.steps.filter(step => step.done).length;
	const summary = createModalSummary(progress.complete ?
		"Hachi setup is complete." :
		"Finish the current setup checks to get Hachi running.");

	setupGuidePrimaryAction = recommendation.action;
	setupGuideOpen = showSharedModal({
		actions: [
			{ action: "setup-guide-close", label: progress.complete ? "Close" : "Not Now", variant: "secondary" },
			{ action: "setup-guide-primary", label: recommendation.actionLabel, variant: progress.complete ? "primary" : "warning" },
		],
		content: [summary, createSetupGuideSteps(progress)],
		meta: progress.complete ? "Ready" : `${doneCount} of ${progress.steps.length} complete`,
		title: "Hachi setup guide",
	});
}

function closeSetupGuideModal({ dismiss = false } = {}) {
	setupGuideOpen = false;

	if (dismiss) {
		dismissOnboardingGuide();
	}

	closeSharedModal();
}

function maybeShowSetupGuide() {
	const modal = $("#sharedModal");

	if (setupGuideAutoShown || setupGuideOpen || onboardingDismissed() || setupProgress(state).complete || (modal && !modal.hidden)) {
		return;
	}

	setupGuideAutoShown = true;
	showSetupGuideModal();
}

function runSetupGuidePrimaryAction() {
	const action = setupGuidePrimaryAction || "show-setup";
	closeSetupGuideModal();
	runInlineAction(action);
}

function formatDateTime(value) {
	// Convert an ISO timestamp into local time for compact status rows.
	if (!value) {
		return "Unknown";
	}

	return new Date(value).toLocaleString();
}

function describeProtectionItem(item) {
	if (!item) {
		return "Not checked";
	}

	const version = item.version ? ` ${item.version}` : "";
	return `${item.label || "Not Verified"}${version}: ${item.detail || "No detail available."}`;
}

function renderDatabaseProtection(protection) {
	const sourceLabel = protection?.source === "remote" ? "Remote" : "Local";
	const keyFile = protection?.configuredKeyFile || (protection?.directKeyConfigured ? "Direct key configured" : "Not configured");
	const recommended = protection?.locations?.recommended?.path || "Not resolved";
	const detail = protection?.detail || "No protection state loaded.";
	const keyReady = [`key-ready`, `direct-key`].includes(protection?.status);
	const databaseFile = protection?.databaseFile;
	const driver = protection?.driver;
	const cipherTest = protection?.cipherTest;
	const runtime = protection?.runtime;
	const databasePlain = databaseFile?.status === "plaintext";
	const databaseEncrypted = Boolean(databaseFile?.encryptedLikely);
	const keyActionLabel = keyReady ? "Rotate Key" : "Generate Key";
	let message = "Generate a key so Hachi can create or use encrypted databases.";

	if (databaseEncrypted) {
		message = "Database is encrypted. Keep the key backup somewhere protected.";
	} else if (databaseFile?.status === "missing" && keyReady) {
		message = "No database exists yet. Hachi will create an encrypted database on first start.";
	} else if (databaseFile?.status === "invalid") {
		message = "Database file could not be opened with the configured key. Restore a valid encrypted backup.";
	} else if (databasePlain && keyReady) {
		message = "Plaintext database detected. HachiGen will convert it during validation/start, or Hachi will refuse to start.";
	} else if (keyReady) {
		message = "Key and runtime are ready.";
	}

	if (cipherTest) {
		message = `${cipherTest.label || "Cipher Test"}: ${cipherTest.detail || "No detail available."}`;
	}

	setText("#databaseProtectionMeta", `${sourceLabel} key management`);
	setDot("#databaseProtectionDot", protection?.dot || "muted");
	setText("#databaseProtectionStatus", protection?.label || "Checking");
	setText("#databaseProtectionDetail", detail);
	setText("#databaseProtectionKeyFile", keyFile);
	setText("#databaseProtectionRecommendedPath", recommended);
	setText("#databaseProtectionDatabaseFile", describeProtectionItem(databaseFile));
	setText("#databaseProtectionDriver", describeProtectionItem(driver));
	setText("#databaseProtectionCipherTest", describeProtectionItem(cipherTest));
	setText("#databaseProtectionRuntime", describeProtectionItem(runtime));
	setText("#databaseProtectionChecked", protection?.updatedAt ? formatDateTime(protection.updatedAt) : "Not checked");
	setText("#databaseProtectionMessage", message);
	setText("#databaseKeyActionButton", keyActionLabel);
	setDisabled("#exportDatabaseKeyBackupButton", !keyReady);
}

function databaseBackupProtectionSummary(backups) {
	const counts = {
		current: 0,
		invalid: 0,
		older: 0,
		plaintext: 0,
		unverified: 0,
	};

	for (const backup of backups) {
		const status = backup?.protection?.status;

		if (status === "current-key") {
			counts.current += 1;
		} else if (status === "older-key" || status === "tracked-key") {
			counts.older += 1;
		} else if (status === "plaintext") {
			counts.plaintext += 1;
		} else if (status === "invalid") {
			counts.invalid += 1;
		} else {
			counts.unverified += 1;
		}
	}

	const parts = [];

	if (counts.current) {
		parts.push(`${counts.current} current`);
	}

	if (counts.older) {
		parts.push(`${counts.older} older-key`);
	}

	if (counts.plaintext) {
		parts.push(`${counts.plaintext} plaintext`);
	}

	if (counts.invalid) {
		parts.push(`${counts.invalid} invalid`);
	}

	if (counts.unverified) {
		parts.push(`${counts.unverified} not verified`);
	}

	return parts.length ? `Protection: ${parts.join(", ")}.` : "";
}

function databaseBackupProtectionLabel(backup) {
	const protection = backup?.protection;

	if (!protection) {
		return "Protection not verified";
	}

	const preview = protection.keyFingerprintPreview &&
		["older-key", "tracked-key"].includes(protection.status) ?
		` ${protection.keyFingerprintPreview}` :
		"";

	return `${protection.label || "Protection not verified"}${preview}`;
}

function renderDatabase(database) {
	// Render database file status and known backups. Database actions handle
	// their own shared confirmation prompts before changing files.
	// This function only paints the current known state; it never touches files.
	const exists = Boolean(database?.exists);
	const backups = database?.backups || [];
	const audit = database?.audit;
	const sourcePrefix = database?.source === "remote" ? "Remote " : "";
	const keyReady = ["key-ready", "direct-key"].includes(database?.protection?.status);
	const backupSummary = databaseBackupProtectionSummary(backups);

	setText("#databaseMeta", exists ? `${sourcePrefix}SQLite database ${audit?.label || "ready"}` : `No ${sourcePrefix.toLowerCase()}database found`);
	setText("#databaseMessage", exists ? audit?.detail || "Maintenance actions create safety backups before risky changes." : "Start Hachi once to create the database.");
	setText("#databaseStatus", exists ? "Found" : "Missing");
	setText("#databasePath", database?.path || "Not found");
	setText("#databaseSize", database?.sizeLabel || "0 B");
	setText("#databaseModified", formatDateTime(database?.modifiedAt));
	setText("#databaseAuditStatus", audit ? `${audit.label}: ${audit.detail}` : "Not checked");
	setDisabled("#migrateDatabaseButton", !audit?.migrationAvailable);
	setDisabled("#forceMigrateDatabaseButton", !(audit?.forceMigrationAvailable || forceMigrationUnlocked));
	setDisabled("#rotateDatabaseBackupsButton", !keyReady || !backups.length);
	renderDatabaseProtection(database?.protection);

	const latest = database?.latestBackup;
	setText(
		"#databaseBackupSummary",
		latest ?
			`${pluralize(backups.length, "backup")} available. Latest: ${latest.file}. ${backupSummary}` :
			"No database backups found.",
	);

	renderSimpleList("#databaseBackupList", backups.slice(0, 8), "No backups yet.", backup => {
		// Show a compact newest-first backup list. The full path is kept in the
		// backend; the UI only needs filename, size, and modified time.
		const item = document.createElement("li");
		item.className = "update-list-row";

		const file = document.createElement("code");
		file.textContent = backup.file;
		item.append(file);

		const detail = document.createElement("span");
		detail.textContent = `${backup.sizeLabel} | ${formatDateTime(backup.modifiedAt)} | ${databaseBackupProtectionLabel(backup)}`;
		item.append(detail);
		return item;
	});
}

function formatDatabaseValue(value) {
	// Database cells can be null, numbers, strings, or occasionally binary data.
	// Convert everything to readable text while making null values obvious.
	if (value === null || value === undefined) {
		return "NULL";
	}

	if (typeof value === "object") {
		return JSON.stringify(value);
	}

	return String(value);
}

function renderDatabaseViewer(view) {
	// Render the read-only table viewer. The backend chooses and validates the
	// table; this function only updates the dropdown and table element.
	const select = $("#databaseTableSelect");
	const table = $("#databaseViewerTable");
	const tables = view?.tables || [];
	const selectedTable = view?.selectedTable || "";
	const columns = view?.columns || [];
	const rows = view?.rows || [];
	const activeSortColumn = view?.sortColumn || "";
	const activeSortDirection = view?.sortDirection || "";

	if (select) {
		select.innerHTML = "";

		if (!tables.length) {
			const option = document.createElement("option");
			option.textContent = "No tables";
			option.value = "";
			select.append(option);
		} else {
			for (const tableInfo of tables) {
				const option = document.createElement("option");
				option.textContent = `${tableInfo.name} (${pluralize(tableInfo.rowCount, "row")})`;
				option.value = tableInfo.name;
				select.append(option);
			}
		}

		select.value = selectedTable;
		select.disabled = databaseViewerLoading || !tables.length;
	}

	setDisabled("#refreshDatabaseViewerButton", databaseViewerLoading || !tables.length);

	if (!view) {
		setText("#databaseViewerMeta", "No table loaded.");
	} else if (!selectedTable) {
		setText("#databaseViewerMeta", "No database tables found.");
	} else {
		const shownCount = Math.min(rows.length, view.totalRows || rows.length);
		setText(
			"#databaseViewerMeta",
			`${selectedTable}: showing ${shownCount} of ${pluralize(view.totalRows || 0, "row")}.`,
		);
	}

	if (!table) {
		return;
	}

	table.innerHTML = "";

	if (!view || !selectedTable) {
		const body = document.createElement("tbody");
		const row = document.createElement("tr");
		const cell = document.createElement("td");
		cell.textContent = "No table loaded.";
		row.append(cell);
		body.append(row);
		table.append(body);
		return;
	}

	const head = document.createElement("thead");
	const headRow = document.createElement("tr");

	for (const column of columns) {
		const cell = document.createElement("th");
		const button = document.createElement("button");
		button.className = "database-sort-button";
		button.dataset.action = "sort-database-column";
		button.dataset.column = column;
		button.textContent = activeSortColumn === column ?
			`${column} ${activeSortDirection === "desc" ? "↓" : "↑"}` :
			column;
		cell.append(button);
		headRow.append(cell);
	}

	head.append(headRow);
	table.append(head);

	const body = document.createElement("tbody");

	if (!rows.length) {
		const row = document.createElement("tr");
		const cell = document.createElement("td");
		cell.colSpan = Math.max(columns.length, 1);
		cell.textContent = "This table is empty.";
		row.append(cell);
		body.append(row);
	} else {
		for (const rowData of rows) {
			const row = document.createElement("tr");

			for (const column of columns) {
				const cell = document.createElement("td");
				cell.textContent = formatDatabaseValue(rowData[column]);
				row.append(cell);
			}

			body.append(row);
		}
	}

	table.append(body);
}

function severityRank(severity) {
	// Sort sanitation findings from most urgent to least urgent.
	const ranks = {
		critical: 0,
		warning: 1,
		info: 2,
	};

	return ranks[severity] ?? 3;
}

function renderSanitizeSummary(report) {
	// Keep the Database tab's small review panel synchronized with the latest
	// modal report so users can close the modal without losing the result.
	// The modal has the full details; this panel is just a quick reminder.
	const summary = report?.summary;
	const findings = report?.findings || [];

	if (!summary) {
		setText("#databaseSanitizeSummary", "No review has run yet.");
		renderSimpleList("#databaseSanitizeList", [], "Run Sanitize to review the database.", () => document.createElement("li"));
		return;
	}

	if (!findings.length) {
		setText("#databaseSanitizeSummary", "Database review found no issues.");
		renderSimpleList("#databaseSanitizeList", [], "No sanitation findings.", () => document.createElement("li"));
		return;
	}

	setText(
		"#databaseSanitizeSummary",
		`${pluralize(summary.findingCount, "finding")} found. ${pluralize(summary.cleanableCount, "group")} can be cleaned.`,
	);

	renderSimpleList("#databaseSanitizeList", findings.slice(0, 6), "No sanitation findings.", finding => {
		// Use the same colored label pattern as the Updates page so severity is
		// easy to scan: critical/red, warning/yellow, info/blue.
		const item = document.createElement("li");
		item.className = "update-list-row";

		const label = document.createElement("span");
		label.className = `change-label change-label-${finding.severity || "info"}`;
		label.textContent = finding.severity || "info";
		item.append(label);

		const detail = document.createElement("span");
		detail.textContent = `${finding.title} (${finding.count})`;
		item.append(detail);
		return item;
	});
}

function createModalSummary(text) {
	// Modal summaries use the same spacing and text color no matter which
	// feature opened the shared popup.
	const summary = document.createElement("div");
	summary.className = "modal-summary";
	summary.textContent = text || "";
	return summary;
}

function createModalDetails(details) {
	// Confirmation prompts show their supporting notes as one consistent list.
	const list = document.createElement("ul");
	list.className = "modal-details";

	for (const detail of details) {
		const item = document.createElement("li");
		item.textContent = detail;
		list.append(item);
	}

	return list;
}

function createModalCheckbox({ checked = false, description = "", id = "modalCheckbox", label = "" } = {}) {
	const wrapper = document.createElement("label");
	wrapper.className = "modal-choice";

	const input = document.createElement("input");
	input.checked = Boolean(checked);
	input.id = id;
	input.type = "checkbox";
	wrapper.append(input);

	const body = document.createElement("span");
	body.className = "modal-choice-body";

	const title = document.createElement("strong");
	title.textContent = label || "Enable option";
	body.append(title);

	if (description) {
		const detail = document.createElement("span");
		detail.textContent = description;
		body.append(detail);
	}

	wrapper.append(body);
	return wrapper;
}

function createModalButton({ action, disabled = false, id, label, variant = "secondary" }) {
	// The shared modal footer is rebuilt each time the popup opens. Buttons use
	// the same data-action event routing as the rest of HachiGen.
	const button = document.createElement("button");
	button.className = `button ${variant}`;
	button.disabled = disabled;
	button.textContent = label;
	button.type = "button";

	if (action) {
		button.dataset.action = action;
	}

	if (id) {
		button.id = id;
	}

	decorateControlIcon(button, iconNameForControl(button));
	return button;
}

function showSharedModal({ actions = [], content = [], meta, title }) {
	// This is the one modal frame used for both review popups and confirmations.
	// Callers provide the title, body nodes, and footer buttons they need.
	const modal = $("#sharedModal");
	const body = $("#sharedModalBody");
	const footer = $("#sharedModalActions");

	if (!modal || !body || !footer) {
		return false;
	}

	setText("#sharedModalTitle", title || "Review");
	setText("#sharedModalMeta", meta || "Review loaded");

	body.replaceChildren(...content.filter(Boolean));
	footer.replaceChildren(...actions.map(createModalButton));
	modal.hidden = false;
	return true;
}

function closeSharedModal() {
	// Close the one shared popup and clear its dynamic body/footer content.
	const modal = $("#sharedModal");
	const body = $("#sharedModalBody");
	const footer = $("#sharedModalActions");

	if (modal) {
		modal.hidden = true;
	}

	if (body) {
		body.replaceChildren();
	}

	if (footer) {
		footer.replaceChildren();
	}
}

function renderSanitizeModal(report, selectedActionIds = null) {
	// Build the review popup. Cleanable findings get checkboxes; schema and
	// review-only findings are shown for awareness but cannot be auto-cleaned.
	// Nothing is changed by opening this modal. Cleanup only starts when the
	// user clicks Clean Selected and confirms the themed HachiGen prompt.
	sanitizeReport = report;

	const findings = [...(report?.findings || [])].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
	const cleanableCount = findings.filter(finding => finding.cleanable).length;
	const selectedActions = selectedActionIds ? new Set(selectedActionIds) : null;
	const summary = createModalSummary(
		findings.length ?
			`${pluralize(findings.length, "finding")} found. ${pluralize(cleanableCount, "cleanable group")} selected by default.` :
			"No database issues found.",
	);
	const findingsContainer = document.createElement("div");
	findingsContainer.className = "sanitize-findings";

	if (!findings.length) {
		const empty = document.createElement("div");
		empty.className = "sanitize-empty";
		empty.textContent = "No sanitation findings.";
		findingsContainer.append(empty);
	} else {
		for (const finding of findings) {
			const item = document.createElement("label");
			item.className = `sanitize-finding sanitize-${finding.severity || "info"}`;

			if (finding.cleanable) {
				// Cleanable findings are checked by default because the review has
				// already limited them to conservative, database-only fixes.
				const checkbox = document.createElement("input");
				checkbox.type = "checkbox";
				checkbox.checked = selectedActions ? selectedActions.has(finding.id) : true;
				checkbox.value = finding.id;
				checkbox.dataset.cleanAction = finding.id;
				item.append(checkbox);
			} else {
				// Non-cleanable findings still appear in the modal, but without a
				// checkbox. These are issues the user should review manually.
				const spacer = document.createElement("span");
				spacer.className = "sanitize-spacer";
				item.append(spacer);
			}

			const body = document.createElement("span");
			body.className = "sanitize-finding-body";

			const title = document.createElement("strong");
			title.textContent = `${finding.title} (${finding.count})`;
			body.append(title);

			const description = document.createElement("span");
			description.textContent = finding.description;
			body.append(description);

			item.append(body);
			findingsContainer.append(item);
		}
	}

	renderSanitizeSummary(report);
	showSharedModal({
		actions: [
			{ action: "sanitize-close", label: "Cancel", variant: "secondary" },
			{
				action: "apply-sanitize",
				disabled: cleanableCount === 0,
				id: "applySanitizeButton",
				label: "Clean Selected",
				variant: "warning",
			},
		],
		content: [summary, findingsContainer],
		meta: `Reviewed ${formatDateTime(report?.reviewedAt)}`,
		title: "Database sanitation review",
	});
}

function hideSanitizeModal() {
	// Close the review popup without discarding the summary shown on the tab.
	closeSharedModal();
}

function selectedSanitizeActionIds() {
	// Read the checked cleanup actions from the review popup.
	return $all("[data-clean-action]:checked").map(input => input.value);
}

function migrationIssuesForMode(force) {
	// Safe migration shows safe issues. Force migration also shows destructive
	// issues so the warning is specific instead of vague.
	const audit = state?.database?.audit;

	if (!audit) {
		return [];
	}

	return force ?
		[...(audit.forceIssues || []), ...(audit.safeIssues || [])] :
		audit.safeIssues || [];
}

function databaseMigrationDetails(force) {
	// Build the detail rows shown in the shared confirmation modal. The audit
	// messages come from database/dbAudit.js and are read-only until confirmed.
	const issues = migrationIssuesForMode(force);

	if (!issues.length) {
		const emptyMessage = force ?
			"No destructive issues are currently reported." :
			"No safe migration issues are currently reported.";

		return [emptyMessage];
	}

	return issues.map(issue => issue.message || issue.id || "Database schema issue");
}

function confirmDatabaseMigration(force) {
	// Migration uses the same confirmation template as backup, restore, and
	// sanitation so all yes/no prompts look and behave consistently.
	showConfirmModal({
		confirmText: force ? "Force Migrate" : "Migrate",
		details: databaseMigrationDetails(force),
		meta: force ? "Destructive migration confirmation" : "Safe migration confirmation",
		summary: force ?
			"HachiGen will create a backup first, then force the database into the current Hachi schema. Extra columns may be dropped." :
			"HachiGen will create a backup first and stop if destructive changes are required.",
		title: force ? "Force database migration" : "Database migration",
		variant: force ? "danger" : "warning",
	}).then(confirmed => {
		if (!confirmed) {
			toast(force ? "Force database migration canceled." : "Database migration canceled.");
			return;
		}

		runAction(force ? "Force migrate database" : "Migrate database", () => force ? api.forceMigrateDatabase() : api.migrateDatabase())
			.then(result => {
				if (result?.ok) {
					forceMigrationUnlocked = false;
					databaseView = null;
					setDatabaseSort({ column: "", direction: "" });
					refreshCurrentDatabaseViewer();
				} else if (!force) {
					forceMigrationUnlocked = true;
					renderDatabase(state?.database);
				}
			});
	});
}

function databaseTransferRemoteLabel() {
	const settings = state?.remote?.settings || {};
	const host = settings.host ? `${settings.username || "user"}@${settings.host}` : "remote profile";
	return settings.remotePath ? `${host}:${settings.remotePath}` : host;
}

function localDatabasePathLabel() {
	if (state?.installPath) {
		return `${state.installPath}\\database\\database.sqlite`;
	}

	return state?.database?.source === "local" && state?.database?.path ?
		state.database.path :
		"selected local Hachi database";
}

function remoteDatabasePathLabel(relativePath = "database/database.sqlite") {
	return `${databaseTransferRemoteLabel()}/${relativePath}`;
}

function createModalProgress(status = "working") {
	const wrapper = document.createElement("div");
	wrapper.className = `modal-progress modal-progress-${status}`;
	const bar = document.createElement("span");
	wrapper.append(bar);
	return wrapper;
}

function showDatabaseTransferStatus({ details = [], meta, status = "working", summary, title }) {
	showSharedModal({
		actions: [
			{
				action: "database-transfer-close",
				disabled: status === "working",
				label: status === "working" ? "Working..." : "Close",
				variant: status === "error" ? "warning" : "primary",
			},
		],
		content: [
			createModalProgress(status),
			createModalSummary(summary),
			createModalDetails(details),
		],
		meta,
		title,
	});
}

function databaseTransferResultDetails(result, fallbackDetails = []) {
	const details = [...fallbackDetails];

	if (result?.bytes) {
		details.push(`Transferred: ${formatFileSize(result.bytes)}.`);
	}

	if (result?.localPath) {
		details.push(`Local file: ${result.localPath}`);
	}

	if (result?.remotePath) {
		details.push(`Remote file: ${remoteDatabasePathLabel(result.remotePath)}`);
	}

	if (result?.targetPath) {
		details.push(`Restored to: ${result.targetPath}`);
	}

	if (result?.safetyBackup) {
		details.push(`Safety backup: ${result.safetyBackup}`);
	}

	if (result?.transform) {
		const transformLabel = result.transform === "rekeyed" ?
			"Re-encrypted with the destination database key." :
			result.transform === "encrypted" ?
				"Encrypted with the destination database key." :
				result.transform === "verified" ?
					"Verified with the destination database key." :
					"Copied without changing encryption.";
		details.push(`Transfer encryption: ${transformLabel}`);
	}

	return details;
}

async function runDatabaseTransferAction({ action, details, label, successSummary, title, workingSummary }) {
	showDatabaseTransferStatus({
		details,
		meta: "Transfer running",
		status: "working",
		summary: workingSummary,
		title,
	});

	const result = await runAction(label, action, { returnError: true, toast: false });

	if (result?.ok) {
		databaseView = null;
		refreshCurrentDatabaseViewer();
		showDatabaseTransferStatus({
			details: databaseTransferResultDetails(result, details),
			meta: "Transfer complete",
			status: "complete",
			summary: result.message || successSummary,
			title,
		});
		return result;
	}

	showDatabaseTransferStatus({
		details,
		meta: "Transfer needs attention",
		status: "error",
		summary: result?.message || `${label} failed.`,
		title,
	});
	return result;
}

function showDatabaseBackupTransferModal() {
	const remoteConfigured = Boolean(state?.remote?.configured);
	const activeRemote = state?.runtimeTarget === "remote";
	const currentSource = activeRemote ? "remote" : "local";
	const summary = createModalSummary("Back up, restore, or move the Hachi database without leaving HachiGen.");
	const details = createModalDetails([
		`Current database view: ${currentSource}.`,
		`Local database: ${localDatabasePathLabel()}.`,
		remoteConfigured ? `Remote database: ${remoteDatabasePathLabel()}.` : "Remote database: remote profile is not configured.",
		"Pull moves the configured remote database into the selected local Hachi folder.",
		"Push moves the selected local database to the configured remote Hachi folder.",
		"Encrypted transfers are re-encrypted with the destination database key; keys are not copied between installs.",
		"Transfer actions create a backup on the destination side before replacing an existing database.",
	]);

	showSharedModal({
		actions: [
			{ action: "database-transfer-close", label: "Close", variant: "secondary" },
			{
				action: "database-transfer-backup",
				disabled: !state?.database?.exists,
				label: "Backup Current",
				variant: "info",
			},
			{
				action: "database-transfer-restore",
				disabled: activeRemote,
				label: "Restore Backup",
				variant: "warning",
			},
			{
				action: "database-transfer-pull",
				disabled: !remoteConfigured,
				label: "Pull From Remote",
				variant: "primary",
			},
			{
				action: "database-transfer-push",
				disabled: !remoteConfigured,
				label: "Push To Remote",
				variant: "warning",
			},
		],
		content: [summary, details],
		meta: remoteConfigured ? `Remote: ${databaseTransferRemoteLabel()}` : "Remote profile is not configured",
		title: "Backup / Transfer Database",
	});
}

function runDatabaseBackupFlow() {
	// Make a dated copy of database/database.sqlite in manager/backups.
	// If today's backup already exists, ask with the themed confirmation modal.
	runAction("Backup database", () => api.backupDatabase(), { toast: false })
		.then(async result => {
			if (!result) {
				return;
			}

			if (result.needsOverwrite) {
				const confirmed = await showConfirmModal({
					confirmText: "Overwrite",
					details: ["The existing backup file will be replaced.", "Manual restore backups are not affected."],
					meta: "Database backup already exists",
					summary: `${result.fileName} already exists. Overwrite today's database backup?`,
					title: "Overwrite database backup?",
					variant: "warning",
				});

				if (!confirmed) {
					toast("Database backup canceled.");
					return;
				}

				await runAction("Overwrite database backup", () => api.backupDatabase({ overwrite: true }));
				return;
			}

			toast(result.message || "Database backup created.");
		});
}

function runDatabaseRestoreFlow() {
	// Let the native picker choose a backup, then use a themed confirmation
	// before the backend replaces the current database file.
	runAction("Choose database backup", () => api.chooseDatabaseBackup(), { toast: false })
		.then(async selection => {
			if (!selection?.ok) {
				if (selection?.message) {
					toast(selection.message);
				}
				return;
			}

			const confirmed = await showConfirmModal({
				confirmText: "Restore",
				details: [
					`Selected backup: ${selection.fileName}`,
					`Destination: ${localDatabasePathLabel()}`,
					"HachiGen will create a pre-restore safety backup first.",
					"Stop Hachi before restoring if it is currently running.",
				],
				meta: "Database restore confirmation",
				summary: "The current local database will be overwritten with the selected backup.",
				title: "Restore this database backup?",
				variant: "warning",
			});

			if (!confirmed) {
				toast("Database restore canceled.");
				return;
			}

			const details = [
				`Selected backup: ${selection.fileName}`,
				`Destination: ${localDatabasePathLabel()}`,
				"Pre-restore safety backup is created before replacement when a database exists.",
			];
			showDatabaseTransferStatus({
				details,
				meta: "Restore running",
				status: "working",
				summary: "Restoring the selected local database backup...",
				title: "Restore database backup",
			});
			const result = await runAction("Restore database", () => api.restoreDatabase(selection.backupPath), { returnError: true, toast: false });

			if (result?.ok) {
				databaseView = null;
				refreshCurrentDatabaseViewer();
				showDatabaseTransferStatus({
					details: databaseTransferResultDetails(result, details),
					meta: "Restore complete",
					status: "complete",
					summary: result.message || "Database backup restored.",
					title: "Restore database backup",
				});
			} else {
				showDatabaseTransferStatus({
					details,
					meta: "Restore needs attention",
					status: "error",
					summary: result?.message || "Restore database failed.",
					title: "Restore database backup",
				});
			}
		});
}

function runDatabasePullFlow() {
	const details = [
		`Remote source: ${remoteDatabasePathLabel()}`,
		`Local destination: ${localDatabasePathLabel()}`,
		"HachiGen will re-encrypt the transferred copy with the local database key.",
		"HachiGen will create a local pre-pull backup if a local database already exists.",
		"Stop local and remote Hachi before transferring if either is currently running.",
	];

	showConfirmModal({
		confirmText: "Pull Database",
		details,
		meta: "Remote to local database transfer",
		summary: "Pull the remote database into the selected local Hachi folder?",
		title: "Pull database from remote?",
		variant: "warning",
	}).then(async confirmed => {
		if (!confirmed) {
			toast("Database pull canceled.");
			return;
		}

		await runDatabaseTransferAction({
			action: () => api.pullRemoteDatabase(),
			details,
			label: "Pull database from remote",
			successSummary: "Remote database pulled to the selected local Hachi folder.",
			title: "Pull database from remote",
			workingSummary: "Pulling the remote database into the selected local Hachi folder...",
		});
	});
}

function runDatabasePushFlow() {
	const details = [
		`Local source: ${localDatabasePathLabel()}`,
		`Remote destination: ${remoteDatabasePathLabel()}`,
		"HachiGen will re-encrypt the transferred copy with the remote database key.",
		"HachiGen will create a remote pre-push backup if a remote database already exists.",
		"Stop local and remote Hachi before transferring if either is currently running.",
	];

	showConfirmModal({
		confirmText: "Push Database",
		details,
		meta: "Local to remote database transfer",
		summary: "Push the selected local database to the configured remote Hachi folder?",
		title: "Push database to remote?",
		variant: "warning",
	}).then(async confirmed => {
		if (!confirmed) {
			toast("Database push canceled.");
			return;
		}

		await runDatabaseTransferAction({
			action: () => api.pushLocalDatabaseToRemote(),
			details,
			label: "Push database to remote",
			successSummary: "Selected local database pushed to the configured remote Hachi folder.",
			title: "Push database to remote",
			workingSummary: "Pushing the selected local database to the configured remote Hachi folder...",
		});
	});
}

function closeConfirmModal(confirmed) {
	// Resolve the promise created by showConfirmModal(). This keeps each caller
	// free to decide what happens after the themed confirmation closes.
	const resolve = confirmationResolve;
	confirmationResolve = null;

	closeSharedModal();

	if (resolve) {
		resolve(confirmed);
	}
}

function showConfirmModal({ checkbox = null, confirmText = "Confirm", details = [], meta, summary, title, variant = "warning" }) {
	// Shared themed confirmation modal for every yes/no action. File/folder
	// pickers still remain native Windows dialogs.
	return new Promise(resolve => {
		const checkboxNode = checkbox ? createModalCheckbox(checkbox) : null;
		const checkboxInput = checkboxNode?.querySelector("input") || null;
		confirmationResolve = confirmed => {
			if (!checkbox) {
				resolve(confirmed);
				return;
			}

			resolve({
				checked: Boolean(checkboxInput?.checked),
				confirmed,
			});
		};
		const opened = showSharedModal({
			actions: [
				{ action: "confirm-cancel", label: "Cancel", variant: "secondary" },
				{ action: "confirm-accept", label: confirmText, variant },
			],
			content: [createModalSummary(summary), createModalDetails(details), checkboxNode],
			meta: meta || "Review the action before continuing",
			title: title || "Confirm action",
		});

		if (!opened) {
			confirmationResolve = null;
			resolve(false);
		}
	});
}

const hachiGenUpdateWizardSteps = [
	{ id: "check", label: "Check release" },
	{ id: "download", label: "Download HachiGen.exe" },
	{ id: "prepare", label: "Prepare installer" },
	{ id: "install", label: "Stage replacement" },
	{ id: "restart", label: "Restart HachiGen" },
	{ id: "open", label: "Open release download" },
];

function hachiGenUpdateWizardStepIndex(stage) {
	return Math.max(0, hachiGenUpdateWizardSteps.findIndex(step => step.id === stage));
}

function hachiGenUpdateWizardVisibleSteps(stage) {
	return stage === "open" ?
		hachiGenUpdateWizardSteps.filter(step => ["check", "open"].includes(step.id)) :
		hachiGenUpdateWizardSteps.filter(step => step.id !== "open");
}

function hachiGenUpdateWizardStepClass(step, wizard) {
	const activeIndex = hachiGenUpdateWizardStepIndex(wizard.stage);
	const stepIndex = hachiGenUpdateWizardStepIndex(step.id);

	if (wizard.status === "error" && step.id === wizard.stage) {
		return "update-wizard-step error";
	}

	if (wizard.status === "complete" || stepIndex < activeIndex) {
		return "update-wizard-step done";
	}

	if (step.id === wizard.stage) {
		return "update-wizard-step active";
	}

	return "update-wizard-step";
}

function renderHachiGenUpdateWizardFooter() {
	const footer = $("#sharedModalActions");

	if (!footer || !hachiGenUpdateWizard) {
		return;
	}

	if (hachiGenUpdateWizard.running) {
		footer.replaceChildren(createModalButton({
			disabled: true,
			label: "Updating...",
			variant: "primary",
		}));
		return;
	}

	if (hachiGenUpdateWizard.status === "error" || hachiGenUpdateWizard.status === "complete") {
		footer.replaceChildren(createModalButton({
			action: "hachigen-update-close",
			label: "Close",
			variant: "primary",
		}));
		return;
	}

	footer.replaceChildren(
		createModalButton({ action: "hachigen-update-close", label: "Cancel", variant: "secondary" }),
		createModalButton({ action: "hachigen-update-start", label: "Update", variant: "primary" }),
	);
}

function renderHachiGenUpdateWizard() {
	if (!hachiGenUpdateWizard) {
		return;
	}

	const progress = Math.max(0, Math.min(100, Number(hachiGenUpdateWizard.progress) || 0));
	const progressBar = $("#hachigenUpdateWizardProgressBar");
	const progressText = $("#hachigenUpdateWizardProgressText");
	const message = $("#hachigenUpdateWizardMessage");
	const steps = $("#hachigenUpdateWizardSteps");

	setText("#sharedModalMeta", hachiGenUpdateWizard.status === "error" ? "Update needs attention" : "HachiGen self-update");

	if (progressBar) {
		progressBar.style.width = `${progress}%`;
	}

	if (progressText) {
		progressText.textContent = `${progress}%`;
	}

	if (message) {
		message.textContent = hachiGenUpdateWizard.message;
	}

	if (steps) {
		steps.replaceChildren(...hachiGenUpdateWizardVisibleSteps(hachiGenUpdateWizard.stage).map(step => {
			const item = document.createElement("li");
			item.className = hachiGenUpdateWizardStepClass(step, hachiGenUpdateWizard);

			const marker = document.createElement("span");
			marker.className = "update-wizard-marker";
			item.append(marker);

			const label = document.createElement("span");
			label.textContent = step.label;
			item.append(label);
			return item;
		}));
	}

	renderHachiGenUpdateWizardFooter();
}

function showHachiGenUpdateWizard() {
	const update = state?.hachiGenUpdate || {};
	const latestVersion = String(update.latestTag || "").replace(/^hachigen-v/u, "") || "the latest version";
	const assetSize = update.assetSize ? ` Asset size: ${formatFileSize(update.assetSize)}.` : "";
	const summary = createModalSummary(`Update HachiGen to Version ${latestVersion}.${assetSize}`);
	const wizard = document.createElement("div");
	const progress = document.createElement("div");
	const progressBar = document.createElement("div");
	const progressText = document.createElement("div");
	const message = document.createElement("div");
	const steps = document.createElement("ol");
	const note = document.createElement("div");

	hachiGenUpdateWizard = {
		message: "Ready to update HachiGen.",
		progress: 0,
		running: false,
		stage: "check",
		status: "ready",
	};

	wizard.className = "update-wizard";
	progress.className = "update-wizard-progress";
	progressBar.className = "update-wizard-progress-bar";
	progressBar.id = "hachigenUpdateWizardProgressBar";
	progressText.className = "update-wizard-progress-text";
	progressText.id = "hachigenUpdateWizardProgressText";
	progress.append(progressBar, progressText);

	message.className = "update-wizard-message";
	message.id = "hachigenUpdateWizardMessage";
	steps.className = "update-wizard-steps";
	steps.id = "hachigenUpdateWizardSteps";
	note.className = "update-wizard-note";
	note.textContent = "HachiGen will close and reopen after the update. Development builds open the release download instead.";

	wizard.append(summary, progress, message, steps, note);
	showSharedModal({
		actions: [],
		content: [wizard],
		meta: "HachiGen self-update",
		title: "HachiGen Update",
	});
	renderHachiGenUpdateWizard();
}

function closeHachiGenUpdateWizard() {
	if (hachiGenUpdateWizard?.running) {
		return;
	}

	hachiGenUpdateWizard = null;
	closeSharedModal();
}

async function startHachiGenUpdateWizard() {
	if (!hachiGenUpdateWizard || hachiGenUpdateWizard.running) {
		return;
	}

	hachiGenUpdateWizard = {
		...hachiGenUpdateWizard,
		message: "Starting HachiGen update...",
		progress: 4,
		running: true,
		stage: "check",
		status: "running",
	};
	renderHachiGenUpdateWizard();
	setBusy(true);

	try {
		const result = await api.installHachiGenUpdate();
		hachiGenUpdateWizard = {
			...hachiGenUpdateWizard,
			message: result?.message || "HachiGen update started.",
			progress: 100,
			running: false,
			stage: result?.message?.includes("Opened") ? "open" : "restart",
			status: "complete",
		};
		await refreshState();
		toast(result?.message || "HachiGen update started.");
	} catch (error) {
		hachiGenUpdateWizard = {
			...hachiGenUpdateWizard,
			message: actionErrorMessage("HachiGen update", error),
			running: false,
			status: "error",
		};
		toast(hachiGenUpdateWizard.message, "error", { label: "HachiGen update" });
	} finally {
		setBusy(false);
		renderHachiGenUpdateWizard();
		renderHachiGenUpdate(state?.hachiGenUpdate);
	}
}

function handleHachiGenUpdateWizardEvent(event) {
	if (!hachiGenUpdateWizard || event.area !== "hachigen-update") {
		return;
	}

	const details = event.details || {};
	const progress = details.progress === undefined ? hachiGenUpdateWizard.progress : details.progress;

	hachiGenUpdateWizard = {
		...hachiGenUpdateWizard,
		message: event.message || hachiGenUpdateWizard.message,
		progress,
		stage: details.stage || hachiGenUpdateWizard.stage,
		status: details.status || hachiGenUpdateWizard.status,
	};
	renderHachiGenUpdateWizard();
}

async function loadDatabaseViewer(tableName = "", sort = databaseSort) {
	// Load one table preview for the read-only Database viewer. This avoids the
	// shared runAction() wrapper so table changes feel quiet and immediate.
	if (databaseViewerLoading) {
		return null;
	}

	const selectedTable = tableName || $("#databaseTableSelect")?.value || databaseView?.selectedTable || "";
	setDatabaseViewerLoading(true);
	setText("#databaseViewerMeta", "Loading table data...");
	renderDatabaseViewer(databaseView);

	try {
		const result = await api.readDatabaseTable(selectedTable, sort);
		setDatabaseSort({
			column: result.sortColumn || "",
			direction: result.sortDirection || "",
		});
		setDatabaseView(result);
		renderDatabase(result.database);
		renderDatabaseViewer(result);
		return result;
	} catch (error) {
		const message = actionErrorMessage("Database viewer", error);
		setText("#databaseViewerMeta", message);
		toast(message, "error", { label: "Database viewer" });
		return null;
	} finally {
		setDatabaseViewerLoading(false);
		renderDatabaseViewer(databaseView);
	}
}

function refreshCurrentDatabaseViewer() {
	// The viewer caches the last table payload for fast redraws. After database
	// maintenance actions, reload that payload so stale IDs/rows are not shown as
	// if they still exist.
	if (!state?.database?.exists) {
		databaseView = null;
		renderDatabaseViewer(null);
		return Promise.resolve(null);
	}

	return loadDatabaseViewer(databaseView?.selectedTable || $("#databaseTableSelect")?.value || "", databaseSort);
}

function replaceSelectOptions(selector, items, labelForItem) {
	const select = $(selector);
	if (!select) return;
	const selected = select.value;
	select.replaceChildren(...items.map(item => {
		const option = document.createElement("option");
		option.value = item.id;
		option.textContent = labelForItem(item);
		return option;
	}));
	if (items.some(item => item.id === selected)) select.value = selected;
}

function fleetEntry(title, meta, actions = []) {
	const entry = document.createElement("div");
	entry.className = "fleet-entry";
	const main = document.createElement("div");
	main.className = "fleet-entry-main";
	const heading = document.createElement("div");
	heading.className = "fleet-entry-title";
	heading.textContent = title;
	const detail = document.createElement("div");
	detail.className = "fleet-entry-meta";
	detail.textContent = meta;
	main.append(heading, detail);
	entry.append(main);
	if (actions.length) {
		const row = document.createElement("div");
		row.className = "button-row";
		for (const action of actions) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = `button compact ${action.kind || "secondary"}`;
			button.dataset.action = action.action;
			button.dataset.itemId = action.id;
			button.textContent = action.label;
			row.append(button);
		}
		entry.append(row);
	}
	return entry;
}

function renderFleet(nextFleet) {
	fleetState = nextFleet || state?.fleet || null;
	if (!fleetState) return;
	const serverList = $("#fleetServerList");
	const deploymentList = $("#fleetDeploymentList");
	const botTypeList = $("#fleetBotTypeList");
	serverList?.replaceChildren(...fleetState.servers.map(server => fleetEntry(
		server.name,
		server.connection.type === "local" ? `Local · ${server.deploymentCount} deployment(s)` : `${server.connection.username}@${server.connection.host}:${server.connection.port} · ${server.deploymentCount} deployment(s)`,
		server.id === "local" ? [] : [{ action: "remove-fleet-server", id: server.id, label: "Remove" }],
	)));
	deploymentList?.replaceChildren(...fleetState.deployments.map(deployment => {
		const server = fleetState.servers.find(item => item.id === deployment.serverId);
		const type = fleetState.botTypes.find(item => item.id === deployment.botTypeId);
		const active = deployment.id === fleetState.activeDeploymentId;
		return fleetEntry(
			`${deployment.name}${active ? " · Active" : ""}`,
			`${type?.displayName || deployment.botTypeId} · ${server?.name || deployment.serverId} · ${deployment.environment} · ${deployment.installPath}`,
			[
				...(!active ? [{ action: "activate-fleet-deployment", id: deployment.id, label: "Select", kind: "info" }] : []),
				{ action: "fleet-runtime-start", id: deployment.id, label: "Start", kind: "primary" },
				{ action: "fleet-runtime-stop", id: deployment.id, label: "Stop" },
				{ action: "fleet-runtime-restart", id: deployment.id, label: "Restart" },
				{ action: "fleet-runtime-health", id: deployment.id, label: "Health", kind: "info" },
				{ action: "fleet-runtime-logs", id: deployment.id, label: "Logs" },
				{ action: "fleet-repository-check", id: deployment.id, label: "Updates", kind: "info" },
				{ action: "fleet-deploy-commands", id: deployment.id, label: "Deploy" },
				{ action: "remove-fleet-deployment", id: deployment.id, label: "Remove" },
			],
		);
	}));
	botTypeList?.replaceChildren(...fleetState.botTypes.map(type => fleetEntry(
		type.displayName,
		`${type.source === "native" ? "Native" : "External"} · ${Object.entries(type.capabilities || {}).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "runtime definition"}`,
		type.source === "external" ? [{ action: "remove-bot-definition", id: type.id, label: "Remove" }] : [],
	)));
	replaceSelectOptions("#fleetServerSelect", fleetState.servers, item => item.name);
	replaceSelectOptions("#fleetBotTypeSelect", fleetState.botTypes, item => `${item.displayName}${item.source === "native" ? " (native)" : " (external)"}`);
	replaceSelectOptions("#credentialDeploymentSelect", fleetState.deployments, item => item.name);
	replaceSelectOptions("#securityDeploymentSelect", fleetState.deployments, item => item.name);
	const credentialOptions = [{ id: "", name: "No credential profile" }, ...fleetState.credentialProfiles];
	replaceSelectOptions("#credentialProfileSelect", credentialOptions, item => item.name);
	const profileList = $("#credentialProfileList");
	profileList?.replaceChildren(...(fleetState.credentialProfiles.length ? fleetState.credentialProfiles.map(profile => {
		const assigned = fleetState.deployments.filter(item => item.credentialProfileId === profile.id).map(item => item.name);
		return fleetEntry(
			profile.name,
			`${profile.environment} · Application ${profile.clientId} · fingerprint ${profile.tokenFingerprint} · ${assigned.length ? `Assigned: ${assigned.join(", ")}` : "Unassigned"}`,
			[{ action: "remove-credential-profile", id: profile.id, label: "Remove" }],
		);
	}) : [fleetEntry("No profiles", "Add an encrypted Discord credential profile to begin.")]));
	setText("#fleetDefinitionErrors", fleetState.botDefinitionErrors?.length ? fleetState.botDefinitionErrors.map(item => `${item.fileName}: ${item.message}`).join("\n") : "");
}

async function refreshFleet() {
	const fleet = await api.getFleet();
	renderFleet(fleet);
	return fleet;
}

async function refreshCurrentView() {
	if (activeView === "fleet") {
		await refreshFleet();
		return { message: "Fleet refreshed." };
	}
	if (activeView === "database") {
		await refreshCurrentDatabaseViewer();
		return { message: "Database view refreshed." };
	}

	if (activeView === "logs") {
		await refreshLogs();
		return { message: "Logs refreshed." };
	}

	if (activeView === "setup") {
		await refreshConfig();
		return { message: "Setup refreshed." };
	}

	if (activeView === "diagnostics") {
		await loadDiagnostics();
		return { message: "Diagnostics refreshed." };
	}

	await refreshState();
	return { message: "Current view refreshed." };
}

function renderState(nextState) {
	// Main redraw function for the app. It takes one backend state object and
	// updates every status card, path label, update list, and setup checklist.
	state = nextState;

	const scan = state.scan;
	const install = installHealth(scan);
	const bot = botHealth(state.pm2);
	const updates = updateHealth(state.updates);
	const database = databaseHealth(state.database);

	// Sidebar.
	setText("#sidebarInstallPath", shortPath(state.installPath));
	setText("#sidebarRepoRemote", repositoryRemoteLabel(state.repository));
	setText("#sidebarRepoBranch", repositoryBranchLabel(state.repository));
	setText("#sidebarStatusText", install.label);
	setDot("#sidebarStatusDot", install.dot);
	const fleetDeploymentCount = state.fleet?.deployments?.length || 0;
	const fleetDefinitionErrorCount = state.fleet?.botDefinitionErrors?.length || 0;
	setText("#fleetStatus", fleetDefinitionErrorCount ? "Needs attention" : `${fleetDeploymentCount} deployment${fleetDeploymentCount === 1 ? "" : "s"}`);
	setText("#fleetDetail", `${state.fleet?.servers?.length || 0} server(s) · ${state.fleet?.credentialProfiles?.length || 0} credential profile(s)`);
	setDot("#fleetDot", fleetDefinitionErrorCount ? "warn" : "good");

	// Dashboard status cards.
	setText("#botStatus", bot.label);
	setText("#botDetail", bot.detail);
	setDot("#botDot", bot.dot);

	setText("#installStatus", install.label);
	setText("#installDetail", install.detail);
	setDot("#installDot", install.dot);

	setText("#updateStatus", updates.label);
	setText("#updateDetail", updates.detail);
	setDot("#updateDot", updates.dot);

	setText("#deployStatus", scan.configurationReady ? "Ready" : "Needs config");
	setText("#deployDetail", scan.configurationReady ? "Global and guild commands" : "Save configuration first");
	setDot("#deployDot", scan.configurationReady ? "good" : "warn");

	setText("#dashboardDatabaseStatus", database.label);
	setText("#dashboardDatabaseDetail", database.detail);
	setDot("#dashboardDatabaseDot", database.dot);

	// Dashboard/panel metadata.
	setText("#runtimeMeta", state.pm2?.message || (state.runtimeTarget === "remote" ? "Remote PM2 process: Hachi" : "PM2 process: Hachi"));
	setText("#dashboardTargetMode", dashboardTargetModeLabel(state));
	setText("#dashboardTargetLocation", dashboardTargetLocationLabel(state));
	setText("#dashboardHachiUpdate", hachiDashboardUpdateLabel());
	setText("#dashboardHachiGenUpdate", hachiGenDashboardUpdateLabel(state.hachiGenUpdate));
	setText("#dashboardActivitySummary", dashboardActivitySummary(state.recentEvents));
	setText("#combinedUpdatesMeta", state.updates?.checkedAt || state.hachiGenUpdate?.checkedAt ? "Last check loaded" : "No update check has run yet");
	setDisabled("#openFolderButton", state.runtimeTarget === "remote");
	setDisabled("#browseInstallButton", state.runtimeTarget === "remote");
	setDisabled("#saveInstallPathButton", state.runtimeTarget === "remote");
	renderHachiUpdateSummary();
	renderStashedChanges(state.updates);
	renderHachiGenUpdate(state.hachiGenUpdate);
	renderDiagnostics(diagnosticsState || diagnosticSnapshotFromState(state));
	if (!state.database?.audit?.migrationAvailable && !state.database?.audit?.forceMigrationAvailable) {
		forceMigrationUnlocked = false;
	}
	renderDatabase(state.database);
	renderDatabaseViewer(databaseView);
	renderSanitizeSummary(sanitizeReport);
	renderRemote(state.remote, state.runtimeTarget);
	renderFleet(state.fleet);

	if (!state.database?.exists) {
		databaseView = null;
		renderDatabaseViewer(null);
	} else if (activeView === "database" && !databaseView && !databaseViewerLoading) {
		loadDatabaseViewer();
	}

	const installInput = $("#installPathInput");

	// Do not overwrite the user's typing while the install path input has focus.
	if (installInput && document.activeElement !== installInput) {
		installInput.value = state.runtimeTarget === "remote" ? state.scan?.installPath || "" : state.installPath || "";
	}

	renderInstallChecks(scan);
	maybeShowSetupGuide();
}

async function refreshState() {
	// Ask the backend for fresh scan/update/PM2 state, then redraw the UI.
	renderState(await api.getState());
}

async function refreshConfig() {
	// Load .env and config/config.json values into the Setup form.
	renderConfig(await api.readConfig());
}

async function refreshLogs() {
	// Refresh visible log snapshots. updateLogPolling calls this repeatedly
	// while Logs is open so the panel feels close to real time.
	const logs = await api.getLogs();
	const pm2Text = logs.pm2 || logs.local || "No logs found.";
	lastPm2LogText = pm2Text;

	if (pm2LogBaseline !== null) {
		// Clearing PM2 logs only clears the visible window. The baseline lets
		// future refreshes show new lines without deleting real PM2 logs.
		setLogText("pm2Logs", pm2Text.startsWith(pm2LogBaseline) ? pm2Text.slice(pm2LogBaseline.length).trimStart() : "");
	} else {
		setLogText("pm2Logs", pm2Text);
	}

	if (!hachiGenLogHistoryHidden && logs.events?.length) {
		// Same idea for HachiGen logs: clearing hides old visible history only.
		setLogText("eventLogs", logs.events.map(eventLine).join("\n"));
	}
}

function updateLogPolling() {
	// Start polling logs only while the Logs tab is visible, and stop polling
	// when the user leaves it so background work stays light.
	if (activeView === "logs" && !logPollTimer) {
		logPollTimer = setInterval(() => {
			refreshLogs().catch(error => {
				// Polling runs in the background, so log the failure without a
				// repeating popup if the Logs panel cannot refresh.
				recordRendererEvent("error", `Log refresh failed: ${error.message || error}`, {
					label: "Refresh logs",
				});
			});
		}, 5000);
		return;
	}

	if (activeView !== "logs" && logPollTimer) {
		clearInterval(logPollTimer);
		logPollTimer = null;
	}
}

async function checkUpdatesOnStartup() {
	// Check updates after the first render. Doing this in the background lets
	// the window open before Git/network work has finished.
	try {
		await api.checkUpdates();
		await refreshState();
	} catch (error) {
		recordRendererEvent("error", `Startup update check failed: ${error.message || error}`, {
			label: "Startup update check",
		});
	}
}

function clearPm2LogWindow() {
	// Clear only the PM2 text currently visible in HachiGen. The baseline keeps
	// future polling from immediately repopulating the old lines.
	pm2LogBaseline = lastPm2LogText || $("#pm2Logs")?.textContent || "";
	clearLogText("pm2Logs");
	toast("PM2 log window cleared.");
}

function clearHachiGenLogWindow() {
	// Hide the currently visible HachiGen event history. The in-memory event log
	// still exists so future actions can keep appending new events.
	hachiGenLogHistoryHidden = true;
	clearLogText("eventLogs");
	toast("HachiGen log window cleared.");
}

async function runAction(label, action, options = {}) {
	// Shared wrapper for button actions. It prevents double-click races, runs
	// the backend action, refreshes state afterward, and routes errors to both
	// a toast and the HachiGen log.
	if (busy) {
		return;
	}

	setBusy(true);

	try {
		const result = await action();
		// Most actions can affect several panels, so redraw state afterward.
		await refreshState();
		if (options.toast !== false) {
			toast(result?.message || `${label} complete.`);
		}
		return result;
	} catch (error) {
		const message = actionErrorMessage(label, error);
		toast(message, "error", { label });
		if (options.returnError) {
			return {
				message,
				ok: false,
			};
		}
		return null;
	} finally {
		setBusy(false);
		// Buttons may have been disabled while busy; re-apply stash-specific
		// and database-specific enable/disable rules after restoring button state.
		renderStashedChanges(state?.updates);
		renderHachiUpdateSummary();
		renderHachiGenUpdate(state?.hachiGenUpdate);
		renderDatabase(state?.database);
		renderDatabaseViewer(databaseView);
		renderConfig(lastConfig);
		setDisabled("#openFolderButton", state?.runtimeTarget === "remote");
		setDisabled("#browseInstallButton", state?.runtimeTarget === "remote");
		setDisabled("#saveInstallPathButton", state?.runtimeTarget === "remote");
	}
}

async function runCombinedUpdateCheck() {
	await runAction("Check updates", async () => {
		const hachiVersion = await api.checkVersionUpdates();
		hachiVersionUpdate = hachiVersion;
		const hachi = await api.checkUpdates();
		const hachiGen = await api.checkHachiGenUpdates();

		return {
			hachi,
			hachiGen,
			hachiVersion,
			message: "Update check complete.",
			ok: true,
		};
	});
}

function localChangeReviewDetails(changes = []) {
	const visibleChanges = changes.slice(0, 30).map(change => change.description || `${change.label || "Changed"}: ${change.path || change.raw || "unknown file"}`);
	const hiddenCount = Math.max(0, changes.length - visibleChanges.length);

	if (hiddenCount) {
		visibleChanges.push(`${pluralize(hiddenCount, "more file")} not shown.`);
	}

	return [
		"HachiGen will save these changes to a recoverable stash before updating Hachi.",
		"After updating, the saved changes panel will let you restore or delete that stash.",
		...visibleChanges,
	];
}

function runHachiUpdateFlow() {
	if (!state?.updates?.available) {
		runCombinedUpdateCheck();
		return;
	}

	const changes = state.updates.localChangeDetails || [];

	if (!changes.length) {
		runAction("Update Hachi", () => api.applyUpdate());
		return;
	}

	showConfirmModal({
		confirmText: "Save Changes and Update",
		details: localChangeReviewDetails(changes),
		meta: `${pluralize(changes.length, "changed file")} found`,
		summary: "Hachi has local changes that need to be saved before updating.",
		title: "Save local changes before updating?",
		variant: "warning",
	}).then(confirmed => {
		if (!confirmed) {
			toast("Hachi update canceled.");
			return;
		}

		runAction("Update Hachi", () => api.applyUpdate());
	});
}

function readConfigForm() {
	// Read every configured input from the Setup form and return a plain object
	// that writeConfiguration() can split between .env and config.json.
	const form = $("#configForm");
	const values = {};

	for (const field of configFields) {
		values[field] = form.elements[field]?.value || "";
	}

	return values;
}

function handleNav(event) {
	// Handle sidebar tab clicks. Buttons declare their target with data-view,
	// so HTML controls navigation without hard-coding IDs here.
	const button = event.target.closest("[data-view]");

	if (!button) {
		return;
	}

	showView(button.dataset.view);
}

function handleChange(event) {
	// The Database table dropdown is intentionally read-only; changing it only
	// asks the backend for a new preview of another table.
	const tableSelect = event.target.closest("#databaseTableSelect");

	if (tableSelect) {
		setDatabaseSort({ column: "", direction: "" });
		loadDatabaseViewer(tableSelect.value);
	}

	if (event.target.name === "remotePortMode") {
		updateRemotePortMode();
	}

	if (event.target.name === "runtimeTarget") {
		const nextTarget = event.target.value === "remote" ? "remote" : "local";

		runAction("Set runtime target", () => api.setRuntimeTarget(nextTarget))
			.then(async result => {
				if (!result) {
					renderRemote(state?.remote, state?.runtimeTarget);
					return;
				}

				databaseView = null;
				sanitizeReport = null;
				await refreshConfig();
				if (activeView === "database" && state?.database?.exists) {
					loadDatabaseViewer();
				}
			});
	}
}

function handleMenuAction(payload = {}) {
	const action = payload.action || "";

	if (action === "show-view") {
		showView(payload.view || "dashboard");
		return;
	}

	if (action === "show-about") {
		showAboutModal();
		return;
	}

	if (action === "refresh-current-view") {
		runAction("Refresh current view", refreshCurrentView);
		return;
	}

	if (action === "check-version-updates") {
		showView("updates");
		runCombinedUpdateCheck();
		return;
	}

	if (action === "open-folder") {
		runAction("Open folder", () => api.openInstallFolder());
	}
}

function runInlineAction(action) {
	if (action === "show-setup") {
		showView("setup");
		return;
	}

	if (action === "show-remote") {
		showView("remote");
		return;
	}

	if (action === "show-updates") {
		showView("updates");
		return;
	}

	if (action === "show-database") {
		showView("database");
		return;
	}

	if (action === "show-logs") {
		showView("logs");
		return;
	}

	if (action === "show-diagnostics") {
		showView("diagnostics");
		return;
	}

	if (action === "install-validate") {
		runAction("Install / Validate", () => api.installOrValidate());
		return;
	}

	if (action === "validate") {
		runAction("Validate install", () => api.validateInstall());
		return;
	}

	if (action === "start") {
		runAction("Start Hachi", () => api.startBot());
		return;
	}

	if (action === "deploy") {
		runAction("Deploy commands", () => api.deployCommands());
		return;
	}

	if (action === "update") {
		runHachiUpdateFlow();
		return;
	}

	if (action === "check-updates") {
		showView("updates");
		runCombinedUpdateCheck();
		return;
	}

	toast("No setup action is available yet.", "error", { label: "Setup guide" });
}

function handleAction(event) {
	// Route every non-form button click by its data-action value. This keeps
	// index.html declarative: adding a button usually means adding one case here.
	const button = event.target.closest("[data-action]");

	if (!button) {
		return;
	}

	const action = button.dataset.action;

	if (action === "refresh-fleet") {
		runAction("Refresh fleet", refreshFleet);
		return;
	}

	if (action === "add-fleet-server") {
		const form = $("#fleetServerForm");
		const values = Object.fromEntries(new window.FormData(form));
		runAction("Add server", async () => {
			const fleet = await api.addFleetServer({
				name: values.name,
				connection: { type: values.type, host: values.host, username: values.username, port: values.port, sshKeyPath: values.sshKeyPath },
			});
			renderFleet(fleet);
			form.reset();
			return { message: "Server added." };
		});
		return;
	}

	if (action === "install-bot-definition") {
		const form = $("#botDefinitionForm");
		runAction("Install bot definition", async () => {
			const fleet = await api.installExternalBotDefinition(form.elements.definition.value);
			renderFleet(fleet);
			form.reset();
			return { message: "External bot definition installed." };
		});
		return;
	}

	if (action === "remove-bot-definition") {
		runAction("Remove bot definition", async () => {
			const fleet = await api.removeExternalBotDefinition(button.dataset.itemId);
			renderFleet(fleet);
			return { message: "External bot definition removed." };
		});
		return;
	}

	if (action === "add-fleet-deployment") {
		const form = $("#fleetDeploymentForm");
		const values = Object.fromEntries(new window.FormData(form));
		runAction("Add deployment", async () => {
			const fleet = await api.addFleetDeployment(values);
			renderFleet(fleet);
			form.reset();
			return { message: "Deployment added." };
		});
		return;
	}

	if (action === "add-credential-profile") {
		const form = $("#credentialProfileForm");
		const values = Object.fromEntries(new window.FormData(form));
		values.allowConcurrent = Boolean(form.elements.allowConcurrent.checked);
		runAction("Save credential profile", async () => {
			const fleet = await api.addCredentialProfile(values);
			renderFleet(fleet);
			form.reset();
			return { message: "Credential profile encrypted and saved." };
		});
		return;
	}

	if (action === "assign-credential-profile") {
		runAction("Assign credential profile", async () => {
			const fleet = await api.assignCredentialProfile($("#credentialDeploymentSelect").value, $("#credentialProfileSelect").value);
			renderFleet(fleet);
			return { message: "Credential assignment saved." };
		});
		return;
	}

	if (action === "remove-credential-profile") {
		showConfirmModal({
			title: "Remove credential profile?",
			meta: "Encrypted credential deletion",
			summary: "The encrypted vault record will be deleted. Assigned profiles must be unassigned first.",
			confirmText: "Remove",
			variant: "danger",
		}).then(confirmed => {
			if (!confirmed) return;
			runAction("Remove credential profile", async () => {
				const fleet = await api.removeCredentialProfile(button.dataset.itemId);
				renderFleet(fleet);
				return { message: "Credential profile removed." };
			});
		});
		return;
	}

	if (["audit-fleet-security", "backup-fleet-database", "encrypt-fleet-database", "restore-fleet-database"].includes(action)) {
		const deploymentId = $("#securityDeploymentSelect").value;
		const execute = async () => {
			let result;
			if (action === "audit-fleet-security") result = await api.auditFleetDeploymentSecurity(deploymentId);
			else if (action === "backup-fleet-database") result = await api.backupFleetDatabase(deploymentId);
			else if (action === "encrypt-fleet-database") result = await api.encryptFleetDatabase(deploymentId);
			else result = await api.restoreFleetDatabaseBackup(deploymentId, $("#fleetBackupIdInput").value);
			setText("#fleetSecurityOutput", JSON.stringify(result, null, 2));
			if (result.backupId) $("#fleetBackupIdInput").value = result.backupId;
			return { message: result.message || "Security operation completed." };
		};
		if (action === "audit-fleet-security" || action === "backup-fleet-database") {
			runAction("Fleet security", execute);
		} else {
			showConfirmModal({
				title: action === "encrypt-fleet-database" ? "Encrypt deployment database?" : "Restore deployment database?",
				meta: "Database safety confirmation",
				summary: "HachiGen will stop the selected deployment and retain or create a recovery copy. Verify the selected deployment before continuing.",
				confirmText: action === "encrypt-fleet-database" ? "Encrypt" : "Restore",
				variant: "danger",
			}).then(confirmed => {
				if (confirmed) runAction("Fleet database security", execute);
			});
		}
		return;
	}

	if (["save-fleet-policies", "list-fleet-backups", "prune-fleet-backups", "prune-fleet-logs"].includes(action)) {
		const deploymentId = $("#securityDeploymentSelect").value;
		runAction("Fleet retention", async () => {
			let result;
			if (action === "save-fleet-policies") {
				result = await api.setFleetDeploymentPolicies(deploymentId, {
					backupRetention: $("#fleetBackupRetentionInput").value,
					autoBackupHours: $("#fleetAutoBackupHoursInput").value,
					logRetentionDays: $("#fleetLogRetentionInput").value,
					requireEncryptedDatabase: true,
				});
				renderFleet(result);
			} else if (action === "list-fleet-backups") result = await api.listFleetBackups(deploymentId);
			else if (action === "prune-fleet-backups") result = await api.pruneFleetBackups(deploymentId);
			else result = await api.pruneFleetLogs(deploymentId);
			setText("#fleetSecurityOutput", JSON.stringify(result, null, 2));
			return { message: "Retention operation completed." };
		});
		return;
	}

	if (action === "activate-fleet-deployment") {
		runAction("Select deployment", async () => {
			const fleet = await api.setActiveFleetDeployment(button.dataset.itemId);
			renderFleet(fleet);
			return { message: "Active deployment changed." };
		});
		return;
	}

	if (action.startsWith("fleet-runtime-")) {
		const operation = action.slice("fleet-runtime-".length);
		const deploymentId = button.dataset.itemId;
		runAction(`Fleet ${operation}`, async () => {
			let result;
			if (["start", "stop", "restart"].includes(operation)) result = await api.controlFleetDeployment(deploymentId, operation);
			else if (operation === "health") result = await api.checkFleetDeploymentHealth(deploymentId);
			else result = await api.getFleetDeploymentLogs(deploymentId, 240);
			setText("#fleetDeploymentOutput", operation === "logs" ? (result.logs || "No logs returned.") : JSON.stringify(result, null, 2));
			return { message: `${operation[0].toUpperCase()}${operation.slice(1)} completed.` };
		});
		return;
	}

	if (action === "fleet-repository-check" || action === "fleet-deploy-commands") {
		const deploymentId = button.dataset.itemId;
		if (action === "fleet-repository-check") {
			runAction("Check deployment updates", async () => {
				const result = await api.getFleetRepositoryStatus(deploymentId, { fetch: true });
				setText("#fleetDeploymentOutput", JSON.stringify(result, null, 2));
				return result;
			}).then(result => {
				if (!result?.updateAvailable) return;
				showConfirmModal({
					title: "Update deployment?",
					meta: "Transactional fleet update",
					summary: "HachiGen will create an encrypted database backup when applicable, stop the bot, update, validate, restart, and roll back on failure.",
					confirmText: "Update",
				}).then(confirmed => {
					if (!confirmed) return;
					runAction("Update deployment", async () => {
						const updated = await api.updateFleetDeployment(deploymentId);
						setText("#fleetDeploymentOutput", JSON.stringify(updated, null, 2));
						return updated;
					});
				});
			});
		} else {
			runAction("Deploy Discord commands", async () => {
				const result = await api.deployFleetDiscordCommands(deploymentId);
				setText("#fleetDeploymentOutput", JSON.stringify(result, null, 2));
				return result;
			});
		}
		return;
	}

	if (action === "remove-fleet-server" || action === "remove-fleet-deployment") {
		showConfirmModal({
			title: action === "remove-fleet-server" ? "Remove server?" : "Remove deployment?",
			meta: "Fleet configuration change",
			summary: "This removes HachiGen's registry entry. It does not delete bot files or stop processes.",
			confirmText: "Remove",
			variant: "danger",
		}).then(confirmed => {
			if (!confirmed) return;
			runAction("Remove fleet entry", async () => {
				const fleet = action === "remove-fleet-server" ? await api.removeFleetServer(button.dataset.itemId) : await api.removeFleetDeployment(button.dataset.itemId);
				renderFleet(fleet);
				return { message: "Fleet entry removed." };
			});
		});
		return;
	}

	if (action === "show-setup-guide") {
		showSetupGuideModal();
		return;
	}

	if (action === "show-fleet") {
		showView("fleet");
		return;
	}

	if (action === "show-about") {
		showAboutModal();
		return;
	}

	if (action === "about-close") {
		closeSharedModal();
		return;
	}

	if (action === "setup-guide-close") {
		closeSetupGuideModal({ dismiss: true });
		return;
	}

	if (action === "setup-guide-primary") {
		runSetupGuidePrimaryAction();
		return;
	}

	if (action === "show-remote" || action === "show-logs" || action === "show-diagnostics" || action === "check-updates") {
		runInlineAction(action);
		return;
	}

	if (action === "check-all-updates") {
		showView("updates");
		runCombinedUpdateCheck();
		return;
	}

	if (action === "refresh-diagnostics") {
		runAction("Refresh diagnostics", loadDiagnostics);
		return;
	}

	if (action === "copy-diagnostic-info") {
		runAction("Copy diagnostic info", () => api.copyDiagnosticInfo());
		return;
	}

	if (action === "export-support-bundle") {
		runAction("Export diagnostics bundle", async () => {
			const result = await api.exportSupportBundle();

			if (result?.ok) {
				diagnosticsState = result.diagnostics || diagnosticsState;
				renderDiagnostics(diagnosticsState);
				setText("#supportBundleSummary", result.bundlePath || result.message || "Diagnostics bundle exported.");
			}

			return result;
		});
		return;
	}

	if (action === "open-hachigen-log-folder") {
		runAction("Open HachiGen log folder", () => api.openHachiGenLogFolder());
		return;
	}

	if (action === "browse") {
		// Open the native folder picker, then redraw because the install path changed.
		runAction("Choose install path", async () => {
			const result = await api.chooseInstallPath();
			renderState(result);
			await refreshConfig();
			return { message: "Install path selected." };
		});
		return;
	}

	if (action === "save-path") {
		// Save whatever the user typed into the install path text field.
		runAction("Save path", async () => api.setInstallPath($("#installPathInput").value));
		return;
	}

	if (action === "copy-secret") {
		const field = button.dataset.secretField || "";

		runAction("Copy saved value", () => api.copyEnvSecret(field), { toast: false })
			.then(result => {
				if (result?.message) {
					toast(result.message);
				}
			});
		return;
	}

	if (action === "browse-ssh-key") {
		// Pick a private key without saving it until the user chooses Save/Test.
		runAction("Choose SSH key", () => api.chooseSshKey(), { toast: false })
			.then(result => {
				if (result?.ok) {
					setInputValue("#remoteSshKeyInput", result.sshKeyPath);
					toast(result.message || "SSH key selected.");
				} else if (result?.message) {
					toast(result.message);
				}
			});
		return;
	}

	if (action === "save-remote-settings") {
		runAction("Save remote settings", () => api.saveRemoteSettings(readRemoteForm()));
		return;
	}

	if (action === "test-remote") {
		setText("#remoteTestOutput", "Testing remote connection...");
		runAction("Test remote connection", async () => {
			await api.saveRemoteSettings(readRemoteForm());
			return api.testRemoteConnection();
		}, { toast: false })
			.then(result => {
				if (!result) {
					setText("#remoteTestOutput", "Remote test failed. Check HachiGen logs for details.");
					return;
				}

				setText("#remoteTestOutput", formatRemoteTestOutput(result));
				toast(result.message, result.ok ? "info" : "error", { label: "Test remote connection" });
			});
		return;
	}

	if (action === "install-validate") {
		// Setup page's main action: install if needed, then validate/repair.
		runAction("Install / Validate", () => api.installOrValidate());
		return;
	}

	if (action === "validate") {
		// Dashboard quick validation. It can repair missing dependencies.
		runAction("Validate install", () => api.validateInstall());
		return;
	}

	if (action === "update") {
		runHachiUpdateFlow();
		return;
	}

	if (action === "update-hachi") {
		runHachiUpdateFlow();
		return;
	}

	if (action === "check-hachigen-update") {
		if (state?.hachiGenUpdate?.canInstall) {
			showHachiGenUpdateWizard();
			return;
		}

		runAction("Check HachiGen updates", () => api.checkHachiGenUpdates());
		return;
	}

	if (action === "hachigen-update-start") {
		startHachiGenUpdateWizard();
		return;
	}

	if (action === "hachigen-update-close") {
		closeHachiGenUpdateWizard();
		return;
	}

	if (action === "open-hachigen-release") {
		runAction("Open HachiGen releases", () => api.openHachiGenRelease());
		return;
	}

	if (action === "restore-stash") {
		// Apply the active HachiGen stash without deleting it.
		runAction("Restore changes", () => api.restoreStashedChanges());
		return;
	}

	if (action === "delete-stash") {
		// Permanently drop the active HachiGen stash.
		runAction("Delete changes", () => api.deleteStashedChanges());
		return;
	}

	if (action === "show-setup") {
		// Dashboard shortcut to the Setup tab.
		showView("setup");
		return;
	}

	if (action === "show-updates") {
		// Dashboard shortcut to the Updates tab.
		showView("updates");
		return;
	}

	if (action === "show-database") {
		// Dashboard shortcut to the Database tab.
		showView("database");
		return;
	}

	if (action === "sort-database-column") {
		// Clicking a viewer column toggles ascending/descending sort in SQLite.
		const column = button.dataset.column || "";
		const direction = databaseSort.column === column && databaseSort.direction === "asc" ? "desc" : "asc";
		setDatabaseSort({ column, direction });
		loadDatabaseViewer(databaseView?.selectedTable, databaseSort);
		return;
	}

	if (action === "generate-database-key") {
		const protection = state?.database?.protection;
		const keyReady = [`key-ready`, `direct-key`].includes(protection?.status);

		if (!keyReady) {
			runAction("Generate database key", () => api.prepareDatabaseProtection());
			return;
		}

		showConfirmModal({
			checkbox: {
				checked: false,
				description: "Rekey encrypted backups that use the current key and encrypt plaintext backups while HachiGen still has both keys.",
				id: "rotateDatabaseBackupsWithKey",
				label: "Also rotate existing backups",
			},
			confirmText: "Rotate Key",
			details: [
				"HachiGen will create a safety backup before changing the key.",
				"The encrypted database will be rekeyed and verified before the key file is replaced.",
				"Backups that require an even older key will be skipped and reported.",
				"Stop Hachi before rotating the key so the database is not in use.",
			],
			meta: "Database key rotation",
			summary: "Rotate the database encryption key?",
			title: "Rotate database key?",
			variant: "warning",
		}).then(result => {
			if (!result?.confirmed) {
				toast("Database key rotation canceled.");
				return;
			}

			runAction("Rotate database key", () => api.rotateDatabaseKey({ rotateBackups: result.checked }))
				.then(actionResult => {
					if (actionResult?.ok) {
						refreshCurrentDatabaseViewer();
					}
				});
		});
		return;
	}

	if (action === "rotate-database-backups") {
		showConfirmModal({
			confirmText: "Rotate Backups",
			details: [
				"Plaintext backups will be encrypted with the current database key.",
				"Encrypted backups that already use the current key will be verified and tagged.",
				"Backups that need an older key will be skipped; keep old key backups if you still need those restore points.",
			],
			meta: "Database backup key maintenance",
			summary: "Rotate backup encryption to the current database key where possible?",
			title: "Rotate database backups?",
			variant: "warning",
		}).then(confirmed => {
			if (!confirmed) {
				toast("Database backup rotation canceled.");
				return;
			}

			runAction("Rotate database backups", () => api.rotateDatabaseBackups());
		});
		return;
	}

	if (action === "verify-database-protection") {
		runAction("Verify database protection", () => api.verifyDatabaseProtection());
		return;
	}

	if (action === "export-database-key-backup") {
		showConfirmModal({
			confirmText: "Export Key",
			details: [
				"This writes a copy of the database key to a file you choose.",
				"Anyone with this key and the encrypted database can decrypt it.",
				"Store the backup in a password manager, offline drive, or another protected location.",
			],
			meta: "Database key recovery",
			summary: "Export a recovery copy of the database key?",
			title: "Export database key backup?",
			variant: "warning",
		}).then(confirmed => {
			if (!confirmed) {
				toast("Database key backup export canceled.");
				return;
			}

			runAction("Export database key backup", () => api.exportDatabaseKeyBackup());
		});
		return;
	}

	if (action === "backup-database") {
		showDatabaseBackupTransferModal();
		return;
	}

	if (action === "restore-database") {
		runDatabaseRestoreFlow();
		return;
	}

	if (action === "database-transfer-close") {
		closeSharedModal();
		return;
	}

	if (action === "database-transfer-backup") {
		closeSharedModal();
		runDatabaseBackupFlow();
		return;
	}

	if (action === "database-transfer-restore") {
		closeSharedModal();
		runDatabaseRestoreFlow();
		return;
	}

	if (action === "database-transfer-pull") {
		closeSharedModal();
		runDatabasePullFlow();
		return;
	}

	if (action === "database-transfer-push") {
		closeSharedModal();
		runDatabasePushFlow();
		return;
	}

	if (action === "refresh-database-viewer") {
		// Reload the selected table without changing any database rows.
		loadDatabaseViewer(databaseView?.selectedTable, databaseSort);
		return;
	}

	if (action === "migrate-database") {
		// Safe migration confirms through the shared HachiGen prompt.
		confirmDatabaseMigration(false);
		return;
	}

	if (action === "force-migrate-database") {
		// Force migration confirms through the same prompt with danger styling.
		confirmDatabaseMigration(true);
		return;
	}

	if (action === "confirm-cancel") {
		closeConfirmModal(false);
		return;
	}

	if (action === "confirm-accept") {
		closeConfirmModal(true);
		return;
	}

	if (action === "sanitize-database") {
		// Review the database first. The modal explains what can be cleaned
		// before anything is changed on disk.
		// The review result is saved so the Database tab can keep showing it.
		runAction("Sanitize database", () => api.reviewDatabaseSanitation())
			.then(result => {
				if (result?.ok) {
					renderSanitizeModal(result);
					refreshCurrentDatabaseViewer();
				}
			});
		return;
	}

	if (action === "sanitize-close") {
		hideSanitizeModal();
		return;
	}

	if (action === "apply-sanitize") {
		// Collect only the checked items from the modal. Unchecked findings stay
		// untouched, even if they are technically cleanable.
		const actionIds = selectedSanitizeActionIds();

		if (!actionIds.length) {
			toast("No cleanable database findings selected.", "error", { label: "Database sanitation" });
			return;
		}

		showConfirmModal({
			confirmText: "Clean Selected",
			details: [
				`${pluralize(actionIds.length, "database issue group")} selected.`,
				"HachiGen will create a backup before changing the database.",
			],
			meta: "Database sanitation confirmation",
			summary: "Clean the selected database issue groups?",
			title: "Confirm database sanitation",
			variant: "warning",
		}).then(confirmed => {
			if (!confirmed) {
				// The shared modal temporarily swaps the review for this final
				// confirmation, so restore the review when the user backs out.
				renderSanitizeModal(sanitizeReport, actionIds);
				toast("Database sanitation canceled.");
				return;
			}

			// Cleanup creates a pre-sanitize backup before running selected fixes.
			runAction("Clean database", () => api.applyDatabaseSanitation(actionIds))
				.then(result => {
					if (result?.ok) {
						hideSanitizeModal();
						sanitizeReport = result;
						renderSanitizeSummary(result);
						refreshCurrentDatabaseViewer();
					}
				});
		});
		return;
	}

	if (action === "deploy") {
		runAction("Deploy commands", () => api.deployCommands());
		return;
	}

	if (action === "start") {
		runAction("Start Hachi", () => api.startBot());
		return;
	}

	if (action === "stop") {
		runAction("Stop Hachi", () => api.stopBot());
		return;
	}

	if (action === "restart") {
		runAction("Restart Hachi", () => api.restartBot());
		return;
	}

	if (action === "refresh") {
		// Manual state refresh without changing anything.
		runAction("Refresh", () => refreshState().then(() => ({ message: "State refreshed." })));
		return;
	}

	if (action === "refresh-logs") {
		// Kept for compatibility if a refresh-logs button is reintroduced later.
		runAction("Refresh logs", () => refreshLogs().then(() => ({ message: "Logs refreshed." })));
		return;
	}

	if (action === "clear-pm2-logs") {
		clearPm2LogWindow();
		return;
	}

	if (action === "clear-hachigen-logs") {
		clearHachiGenLogWindow();
		return;
	}

	if (action === "open-folder") {
		// Opens the selected install folder in File Explorer.
		runAction("Open folder", () => api.openInstallFolder());
	}
}

function handleKeyboardAction(event) {
	if (event.key !== "Enter" && event.key !== " ") {
		return;
	}

	const actionTarget = event.target.closest?.(".status-card-action[data-action]");

	if (!actionTarget) {
		return;
	}

	event.preventDefault();
	actionTarget.click();
}

function handleConfigSubmit(event) {
	// Save Config is a real form submit, so prevent page reload and send the
	// collected field values to the backend writer.
	event.preventDefault();
	runAction("Save configuration", async () => {
		const config = await api.saveConfig(readConfigForm());
		renderConfig(config);
		return { message: "Configuration saved." };
	});
}

async function init() {
	// Wire up event listeners, perform the first data load, and then begin the
	// background startup update check.
	installRendererDiagnosticsHooks();
	decorateStaticIcons();
	document.addEventListener("click", handleNav);
	document.addEventListener("click", handleAction);
	document.addEventListener("keydown", handleKeyboardAction);
	document.addEventListener("change", handleChange);
	document.addEventListener("mousedown", handleLogSelectionPointerDown);
	document.addEventListener("mouseup", handleLogSelectionPointerUp);
	document.addEventListener("selectionchange", handleLogSelectionChange);
	$("#configForm").addEventListener("submit", handleConfigSubmit);

	api.onEvent(event => {
		// Live backend events arrive here while commands are running.
		handleHachiGenUpdateWizardEvent(event);
		appendEvent(event);
	});

	api.onMenuAction(handleMenuAction);

	// First render: show static view state, then fetch dynamic backend data.
	renderViews();
	await refreshState();
	await refreshConfig();
	await refreshLogs();
	checkUpdatesOnStartup();
}

init();
