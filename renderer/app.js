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
	security: "Security",
	setup: "Hachi",
	updates: "Updates",
	database: "Database",
	logs: "Logs",
	testing: "Testing",
	diagnostics: "Diagnostics",
};
const ONBOARDING_DISMISSED_KEY = "hachigen:onboarding-dismissed:v1";
const SELECTED_BOT_KEY = "hachigen:selected-bot:v1";
const HACHI_BOT_ID = "hachi";
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
	flask: [
		["path", { d: "M10 2v7.3L4.5 19a2 2 0 0 0 1.74 3h11.52a2 2 0 0 0 1.74-3L14 9.3V2" }],
		["path", { d: "M8.5 2h7" }],
		["path", { d: "M6.5 17h11" }],
	],
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
	testing: "flask",
	remote: "remote",
	setup: "settings",
	updates: "download",
};
const ACTION_ICONS = {
	"activate-fleet-deployment": "check",
	"add-fleet-deployment": "package",
	"add-fleet-server": "remote",
	"apply-sanitize": "shieldCheck",
	"audit-fleet-security": "shieldCheck",
	"about-close": "square",
	"backup-database": "archive",
	"database-transfer-backup": "archive",
	"database-transfer-close": "square",
	"database-transfer-pull": "download",
	"database-transfer-push": "upload",
	"database-transfer-restore": "restore",
	browse: "folder",
	"browse-fleet-ssh-key": "folder",
	"browse-ssh-key": "folder",
	"cancel-fleet-server-edit": "square",
	"check-hachigen-update": "download",
	"check-all-updates": "download",
	"check-updates": "download",
	"clear-hachigen-logs": "trash",
	"clear-pm2-logs": "trash",
	"copy-diagnostic-info": "copy",
	"copy-secret": "copy",
	"copy-testing-secret": "copy",
	"delete-stash": "trash",
	"delete-testing-profile": "trash",
	deploy: "send",
	"edit-fleet-server": "settings",
	"encrypt-fleet-database": "shieldCheck",
	"export-database-key-backup": "key",
	"export-support-bundle": "package",
	"fleet-edit-credentials": "key",
	"force-migrate-database": "database",
	"generate-database-key": "key",
	"hachigen-update-close": "square",
	"hachigen-update-start": "download",
	"install-validate": "wrench",
	"install-bot-definition": "package",
	"list-fleet-backups": "archive",
	"migrate-database": "database",
	"new-testing-profile": "flask",
	"open-folder": "folder",
	"open-hachigen-log-folder": "logs",
	"open-hachigen-release": "external",
	"prune-fleet-backups": "trash",
	"prune-fleet-logs": "trash",
	"show-about": "clipboard",
	refresh: "refresh",
	"refresh-database-viewer": "refresh",
	"refresh-diagnostics": "refresh",
	"refresh-fleet": "refresh",
	"refresh-testing-run": "refresh",
	restart: "restore",
	"restore-database": "restore",
	"restore-stash": "restore",
	"reapprove-fleet-deployment": "shieldCheck",
	"reapprove-testing-profile": "shieldCheck",
	"remove-bot-definition": "trash",
	"remove-fleet-deployment": "trash",
	"remove-fleet-server": "trash",
	"reset-testing-commands": "restore",
	"rotate-database-backups": "restore",
	"sanitize-database": "shieldCheck",
	"save-path": "save",
	"save-fleet-policies": "save",
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
	"start-testing-bot": "play",
	stop: "square",
	"stop-testing-bot": "square",
	"test-remote": "search",
	update: "download",
	"update-hachi": "download",
	validate: "check",
	"verify-database-protection": "shieldCheck",
	"choose-fleet-bot-folder": "folder",
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
let databaseSource = "production";
let forceMigrationUnlocked = false;
let confirmationResolve = null;
let lastConfig = null;
let hachiGenUpdateWizard = null;
let setupGuidePrimaryAction = "show-setup";
let setupGuideOpen = false;
let setupGuideAutoShown = false;
let diagnosticsState = null;
let fleetState = null;
let fleetOverviewRequestId = 0;
let externalDatabaseProtectionStatus = "unknown";
let selectedBotId = window.localStorage.getItem(SELECTED_BOT_KEY) || HACHI_BOT_ID;
let externalConfiguration = null;
let fleetBackupState = [];
let testingProfiles = [];
let selectedTestingProfileId = null;
let testingRuns = [];

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

function configureSecretCopyButton(button, copyable, unavailableTitle = "No saved value") {
	if (!button) {
		return;
	}

	button.disabled = !copyable;
	button.title = copyable ? "Copy saved value to clipboard for 60 seconds" : unavailableTitle;
	decorateControlIcon(button, "copy");
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

// Hachi and Fleet-backed bots render into the same status-card contract.
// Backend adapters supply the values; this helper owns the shared UI treatment.
function renderStatusCard(prefix, status) {
	setText(`#${prefix}Status`, status.label);
	setText(`#${prefix}Detail`, status.detail);
	setDot(`#${prefix}Dot`, status.dot);
}

function renderCheckList(selector, checks) {
	const container = $(selector);

	if (!container) {
		return;
	}

	container.replaceChildren(...checks.map(([label, ok, detail]) => {
		const item = document.createElement("div");
		item.className = "check-item";
		const dot = document.createElement("span");
		dot.className = `dot ${ok ? "good" : "warn"}`;
		const text = document.createElement("span");
		const strong = document.createElement("strong");
		strong.textContent = label;
		text.append(strong, `: ${detail}`);
		item.append(dot, text);
		return item;
	}));
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
	if (repository?.error) {
		return "Repo: Unavailable";
	}
	if (!repository?.isGit) {
		return "Repo: Not a Git checkout";
	}

	return `Repo: ${shortRemoteUrl(repository.originUrl)}`;
}

function repositoryBranchLabel(repository) {
	if (repository?.error) {
		return "Branch: Unavailable";
	}
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
	setText("#viewTitle", activeView === "setup" ? selectedBotName() : (viewTitles[activeView] || "HachiGen"));
	updateLogPolling();
}

// Change tabs by updating activeView, then redraw view visibility. Opening
// Logs or Database also fetches fresh data so those panels are useful immediately.
function showView(viewName) {
	activeView = viewName;
	renderViews();

	if (activeView === "setup") {
		const load = selectedBotId === HACHI_BOT_ID ? refreshConfig() : loadExternalConfiguration();
		load.catch(error => toast(error.message || "Configuration refresh failed.", "error", { label: "Configuration" }));
	}

	if (activeView === "logs") {
		refreshLogs().catch(error => recordRendererEvent("error", error.message || String(error), { label: "Refresh logs" }));
	}

	if (activeView === "testing") {
		Promise.all([refreshFleet(), refreshTestingProfiles()])
			.then(() => renderTestingRunner())
			.catch(error => toast(error.message || "Testing refresh failed.", "error", { label: "Testing" }));
	}

	if (activeView === "database" && !databaseView) {
		prepareDatabaseViewer().catch(error => toast(error.message || "Database sources could not be loaded.", "error", { label: "Database viewer" }));
	}

	if (activeView === "diagnostics" && selectedBotId === HACHI_BOT_ID) {
		loadDiagnostics().catch(error => {
			toast(error.message || "Diagnostics refresh failed.", "error", { label: "Diagnostics" });
		});
	}

	if (activeView === "fleet") {
		refreshFleet().catch(error => toast(error.message || "Fleet refresh failed.", "error", { label: "Fleet" }));
	} else if (selectedBotId !== HACHI_BOT_ID && ["dashboard", "setup", "updates", "database", "diagnostics"].includes(activeView)) {
		refreshFleetOverview().catch(error => {
			toast(error.message || "Bot refresh failed.", "error", { label: selectedBotName() });
		});
	}
}

function selectedFleetDeployment() {
	const deployments = fleetState?.deployments || [];
	const legacySelection = deployments.find(deployment => deployment.id === selectedBotId);
	const botTypeId = legacySelection?.botTypeId || selectedBotId;
	const activeId = fleetState?.activeDeploymentByBotType?.[botTypeId];
	return deployments.find(deployment => deployment.id === activeId && deployment.botTypeId === botTypeId) ||
		legacySelection ||
		deployments.find(deployment => deployment.botTypeId === botTypeId && fleetState.servers.find(server => server.id === deployment.serverId)?.connection?.type === "local") ||
		deployments.find(deployment => deployment.botTypeId === botTypeId) ||
		null;
}

function selectedBotName() {
	return selectedBotId === HACHI_BOT_ID ? "Hachi" : (selectedFleetDeployment()?.name || "Bot");
}

function renderExternalRemote(deployment) {
	const relatedDeployments = (fleetState?.deployments || []).filter(item => item.botTypeId === deployment.botTypeId);
	const remoteDeployment = relatedDeployments.find(item => fleetState.servers.find(server => server.id === item.serverId)?.connection?.type === "ssh");
	const currentServer = fleetState?.servers?.find(item => item.id === deployment.serverId);
	const remoteServer = currentServer?.connection?.type === "ssh" ? currentServer :
		fleetState?.servers?.find(item => item.id === remoteDeployment?.serverId) ||
		fleetState?.servers?.find(item => item.connection?.type === "ssh");
	const connection = remoteServer?.connection || {};
	const activeRemote = currentServer?.connection?.type === "ssh";
	const portMode = Number(connection.port || 22) === 22 ? "default" : "custom";
	setElementText($("#saveRemoteSettingsButton"), "Save Remote");
	setText("#remotePathLabel", `Remote ${deployment.name} path`);
	setText("#remoteMeta", remoteServer ? `Ready: ${connection.username}@${connection.host}` : "Not configured");
	setInputValue("#remoteHostInput", connection.host || "");
	setInputValue("#remoteUsernameInput", connection.username || "");
	setInputValue("#remoteSshKeyInput", connection.sshKeyPath || "");
	setInputValue("#remotePortInput", connection.port || 22);
	setInputValue("#remotePathInput", (activeRemote ? deployment.installPath : remoteDeployment?.installPath) || "");
	setInputValue("#remotePm2Input", (activeRemote ? deployment.pm2Name : remoteDeployment?.pm2Name) || deployment.pm2Name || "");
	const targetRadio = $(`input[name="runtimeTarget"][value="${activeRemote ? "remote" : "local"}"]`);
	if (targetRadio) targetRadio.checked = true;
	const portRadio = $(`input[name="remotePortMode"][value="${portMode}"]`);
	if (portRadio) portRadio.checked = true;
	updateRemotePortMode();
	setText("#remotePreviewTarget", remoteServer ? `${connection.username}@${connection.host}` : "Not configured");
	setText("#remotePreviewPort", `${connection.port || 22}${portMode === "default" ? " (default)" : ""}`);
	setText("#remotePreviewPath", (activeRemote ? deployment.installPath : remoteDeployment?.installPath) || "Not configured");
	setText("#remotePreviewPm2", (activeRemote ? deployment.pm2Name : remoteDeployment?.pm2Name) || deployment.pm2Name || "Not configured");
	setText("#remotePreviewLastTest", "Not tested");
	setText("#remoteTestOutput", remoteServer ? "No remote test has run yet." : "Enter the remote connection details, then test or save them.");
}

function renderSelectedBotContext() {
	const external = selectedBotId !== HACHI_BOT_ID && Boolean(selectedFleetDeployment());
	const deployment = selectedFleetDeployment();
	const server = fleetState?.servers?.find(item => item.id === deployment?.serverId);
	document.body.classList.toggle("external-bot-selected", external);
	setElementText($("#botViewNav"), external ? deployment.name : "Hachi");
	setText("#dashboardBotCardLabel", external ? deployment.name : "Hachi");
	setText("#dashboardBotUpdateLabel", external ? deployment.name : "Hachi");
	setText("#diagnosticsBotLabel", external ? deployment.name : "Hachi");
	setText("#diagnosticsBotUpdateLabel", external ? deployment.name : "Hachi");
	setText("#dashboardTargetButton", external ? "Bot Settings" : "Remote Settings");
	setText("#dashboardValidateButton", external ? "Check Health" : "Validate Install");
	setText("#runtimeLocationMeta", external ? "Choose the active installation or attach a saved remote connection" : "Choose whether Hachi runs locally or through a saved remote connection");
	setElementText($("#installValidateButton"), external ? "Validate Install" : "Install / Validate");
	setElementText($("#browseInstallButton"), external ? "Open Folder" : "Browse");
	if ($("#browseInstallButton")) $("#browseInstallButton").dataset.action = external ? "open-folder" : "browse";
	if ($("#installPathInput")) $("#installPathInput").readOnly = external;
	if ($("#saveInstallPathButton")) $("#saveInstallPathButton").hidden = external;
	if ($("#hachiConfigurationFields")) $("#hachiConfigurationFields").hidden = external;
	if ($("#externalConfigurationFields")) $("#externalConfigurationFields").hidden = !external;
	if ($("#externalConfigurationMeta")) $("#externalConfigurationMeta").hidden = !external;
	if (!external) setDisabled("#saveConfigurationButton", false);
	if ($("#manageBotCredentialsButton")) {
		const definition = fleetState?.botTypes?.find(item => item.id === deployment?.botTypeId);
		$("#manageBotCredentialsButton").hidden = !external || !canManageFleetCredentials(deployment, definition);
		$("#reapproveBotProfileButton").hidden = !external || deployment.definitionFingerprint === definition?.fingerprint;
	}
	if ($("#dashboardGuideButton")) $("#dashboardGuideButton").hidden = external;
	if ($("#hachiDatabaseActions")) $("#hachiDatabaseActions").hidden = false;
	if ($("#hachiProtectionActions")) $("#hachiProtectionActions").hidden = false;
	if ($("#fleetLogMaintenancePanel")) $("#fleetLogMaintenancePanel").hidden = !external;
	if (external) {
		setInputValue("#installPathInput", deployment.installPath);
		renderExternalDatabaseBackups([]);
		renderExternalRemote(deployment);
		setDisabled("#openFolderButton", server?.connection?.type !== "local");
		setDisabled("#browseInstallButton", server?.connection?.type !== "local");
		if ($("#testingDeploymentSelect")) $("#testingDeploymentSelect").value = deployment.id;
	} else if (state) {
		setElementText($("#saveRemoteSettingsButton"), "Save Remote");
		setText("#remotePathLabel", "Remote Hachi path");
		setDisabled("#openFolderButton", state.runtimeTarget === "remote");
		setDisabled("#browseInstallButton", state.runtimeTarget === "remote");
	}
	renderViews();
	renderFleetSecurityCapabilities();
	if (external) void loadExternalConfiguration().catch(error => setText("#externalConfigurationMessage", error.message));
}

function renderExternalDashboard(overview) {
	if (!overview || selectedBotId === HACHI_BOT_ID) return;
	const runtime = overview.health?.runtime;
	const repository = overview.repository || {};
	const security = overview.security || {};
	const databaseStatus = security.database?.status || (security.error ? "error" : "unknown");
	renderStatusCard("bot", {
		detail: runtime?.message || overview.health?.error || "Runtime status unavailable",
		dot: runtime?.status === "online" ? "good" : runtime?.status === "error" ? "bad" : "warn",
		label: readableStatus(runtime?.status || "Unknown"),
	});
	renderStatusCard("install", {
		detail: overview.deployment?.installPath || "No install path",
		dot: overview.health?.installFound ? "good" : "bad",
		label: overview.health?.installFound ? "Found" : "Missing",
	});
	renderStatusCard("update", {
		detail: repository.error || repository.message || repository.branch || "Repository status",
		dot: repository.error ? "bad" : repository.dirty || repository.updateAvailable ? "warn" : "good",
		label: repository.error ? "Unavailable" : repository.dirty ? "Local changes" : repository.updateAvailable ? "Available" : "Current",
	});
	const deployable = Boolean(overview.deployment?.capabilities?.discordCommands);
	renderStatusCard("deploy", {
		detail: deployable ? "Discord command deployment available" : "No command profile",
		dot: deployable ? "good" : "muted",
		label: deployable ? "Ready" : "Not configured",
	});
	renderStatusCard("dashboardDatabase", {
		detail: security.error || security.database?.message || "Database status unavailable",
		dot: ["protected", "not-applicable"].includes(databaseStatus) ? "good" : databaseStatus === "encrypted-unverified" ? "warn" : "bad",
		label: readableStatus(databaseStatus),
	});
	renderExternalDatabase(overview);
	renderExternalUpdates(overview);
	setText("#runtimeMeta", runtime?.message || `${overview.deployment?.pm2Name || "Bot"} process`);
	setText("#dashboardTargetMode", overview.server?.type === "ssh" ? "Remote" : "Local");
	setText("#dashboardTargetLocation", overview.deployment?.installPath || "Not set");
	setText("#dashboardHachiUpdate", repository.message || "Not checked");
	setText("#sidebarInstallPath", shortPath(overview.deployment?.installPath || ""));
	setText("#sidebarRepoRemote", repository.remote || overview.deployment?.repository?.url || "Repo not checked");
	setText("#sidebarRepoBranch", repository.branch || "Branch not checked");
	setText("#sidebarStatusText", overview.health?.installFound ? "Installed" : "Missing");
	setDot("#sidebarStatusDot", overview.health?.installFound ? "good" : "bad");
	setText("#diagnosticsMeta", `${selectedBotName()} deployment overview`);
	setText("#diagnosticsHachiVersion", overview.deployment?.definitionVersion || overview.deployment?.botTypeId || "Profile managed");
	setText("#diagnosticsRuntimeTarget", overview.server?.type === "ssh" ? "Remote" : "Local");
	setText("#diagnosticsPm2Status", readableStatus(runtime?.status || "Unknown"));
	setText("#diagnosticsHachiUpdate", repository.error ? "Unavailable" : repository.updateAvailable ? "Update available" : "Current");
	setText("#diagnosticsSummaryOutput", JSON.stringify({
		database: security.database || null,
		deployment: overview.deployment,
		health: overview.health,
		repository: overview.repository,
		server: overview.server,
	}, null, 2));
	renderCheckList("#installChecks", [
		["Project files", Boolean(overview.health?.installFound), overview.health?.installFound ? "Found" : "Missing"],
		["Git checkout", repository.isGit !== false && !repository.error, repository.error || repository.message || "Available"],
		["Repository origin", repository.originMatches !== false, repository.originMatches === false ? "Does not match profile" : "Matches profile"],
		["Runtime profile", Boolean(overview.deployment?.capabilities?.pm2), overview.deployment?.capabilities?.pm2 ? "PM2 available" : "No PM2 adapter"],
		["Testing", Boolean(selectedFleetDeployment()?.testCommandsAvailable), selectedFleetDeployment()?.testCommandsAvailable ? "Test command deployment available" : "Runtime testing only"],
	]);
}

function renderExternalUpdates(overview) {
	const repository = overview?.repository || {};
	const name = selectedBotName();
	setText("#combinedUpdatesMeta", `${name} and HachiGen update status`);
	setText("#selectedBotUpdateName", name);
	setText("#updatesMeta", repository.message || (repository.error ? "Unavailable" : "Repository status loaded"));
	setText("#hachiCurrentVersion", repository.branch || "Unknown branch");
	setText("#hachiAvailableVersion", repository.updateAvailable ? (repository.targetBranch || "Update available") : "Current");
	setText("#updateMessage", repository.error || (repository.dirty ? "Local changes must be handled before updating." : repository.updateAvailable ? "An update is available." : "Repository is current."));
	setElementText($("#hachiUpdateButton"), `Update ${name}`);
	setDisabled("#hachiUpdateButton", Boolean(repository.error || repository.dirty || !repository.updateAvailable));
	setDisabled("#selectedBotDeployButton", !overview?.deployment?.capabilities?.discordCommands);
	if ($("#savedChangesPanel")) $("#savedChangesPanel").hidden = true;
}

function renderExternalDatabase(overview) {
	const database = overview?.security?.database || {};
	const status = database.status || (overview?.security?.error ? "error" : "unknown");
	const exists = !["missing", "not-applicable", "unknown", "error"].includes(status);
	const protectedDatabase = status === "protected";
	const unverified = status === "encrypted-unverified";
	externalDatabaseProtectionStatus = status;
	setText("#databaseMeta", status === "not-applicable" ? "No database declared by this Bot Profile" : `${selectedBotName()} database`);
	setText("#databaseMessage", overview?.security?.error || database.message || "Run Verify to refresh database protection status.");
	setText("#databaseStatus", exists ? "Found" : status === "not-applicable" ? "Not configured" : "Missing");
	setText("#databasePath", database.path || "Not declared");
	setText("#databaseSize", formatFileSize(database.size || 0));
	setText("#databaseModified", "Not reported");
	setText("#databaseAuditStatus", readableStatus(status));
	setText("#databaseProtectionMeta", "Protection is verified through the bot's approved profile");
	setDot("#databaseProtectionDot", protectedDatabase ? "good" : unverified ? "warn" : status === "not-applicable" ? "muted" : "bad");
	setText("#databaseProtectionStatus", readableStatus(status));
	setText("#databaseProtectionDetail", database.message || "Protection status unavailable");
	setText("#databaseProtectionKeyFile", "Managed by bot");
	setText("#databaseProtectionRecommendedPath", "Profile adapter");
	setText("#databaseProtectionDatabaseFile", database.path || "Not declared");
	setText("#databaseProtectionDriver", protectedDatabase ? "Verified by bot" : "Not verified");
	setText("#databaseProtectionCipherTest", database.verified ? "Passed" : "Not run");
	setText("#databaseProtectionRuntime", overview?.health?.runtime?.status || "Unknown");
	setText("#databaseProtectionChecked", formatDateTime(overview?.security?.checkedAt));
	setText("#databaseProtectionMessage", overview?.security?.error || "");
	setText("#databaseSanitizeSummary", "Sanitation is not supported by this Bot Profile.");
	renderSimpleList("#databaseSanitizeList", [], "A bot-specific sanitation adapter is required.", () => document.createElement("li"));
}

function renderTestingDatabaseState(view) {
	const database = view?.database || {};
	const encrypted = Boolean(database.encryptedLikely);
	const exists = database.status !== "missing";
	setText("#databaseMeta", `Test: ${view?.source?.profileName || "Testing identity"}`);
	setText("#databaseMessage", database.detail || "Testing database status unavailable.");
	setText("#databaseStatus", exists ? "Found" : "Missing");
	setText("#databasePath", database.path || "Not found");
	setText("#databaseSize", formatFileSize(database.size || 0));
	setText("#databaseModified", "Not reported");
	setText("#databaseAuditStatus", database.label || readableStatus(database.status));
	setText("#databaseProtectionMeta", "Isolated testing database protection");
	setDot("#databaseProtectionDot", encrypted ? "good" : database.status === "plaintext" ? "warn" : "muted");
	setText("#databaseProtectionStatus", encrypted ? "Encrypted" : database.label || "Not encrypted");
	setText("#databaseProtectionDetail", database.detail || "Protection status unavailable.");
	setText("#databaseProtectionKeyFile", encrypted ? "OS-protected testing profile" : "Created when Encrypt Data is approved");
	setText("#databaseProtectionRecommendedPath", "Testing identity profile");
	setText("#databaseProtectionDatabaseFile", database.path || "Not found");
	setText("#databaseProtectionDriver", "Approved bot adapter");
	setText("#databaseProtectionCipherTest", encrypted ? "Passed by Data Viewer" : "Not run");
	setText("#databaseProtectionRuntime", encrypted ? "Encrypted on next test start" : "Plain SQLite testing mode");
	setText("#databaseProtectionChecked", formatDateTime(new Date().toISOString()));
	setText("#databaseProtectionMessage", encrypted ? "The production database and key are not used." : "Stop the test bot, then use Encrypt Data when ready.");
}

function renderExternalDatabaseBackups(backups = []) {
	fleetBackupState = backups;
	setText("#databaseBackupSummary", backups.length ? `${pluralize(backups.length, "encrypted backup")} available.` : "No encrypted backups found.");
	renderSimpleList("#databaseBackupList", backups, "No backups yet.", backup => {
		const item = document.createElement("li");
		item.className = "update-list-row";
		const file = document.createElement("code");
		file.textContent = backup.backupId;
		const detail = document.createElement("span");
		detail.textContent = `${formatDateTime(backup.createdAt)} | Encrypted`;
		item.append(file, detail);
		return item;
	});
	if (backups[0] && $("#fleetBackupIdInput") && !$("#fleetBackupIdInput").value) {
		$("#fleetBackupIdInput").value = backups[0].backupId;
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
	if (scan?.error) {
		return { label: "Unavailable", dot: "warn", detail: "Connection could not be reached" };
	}

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

	if (database?.error) {
		return { label: "Unavailable", dot: "warn", detail: "Connection could not be reached" };
	}

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
			actionLabel: usingRemote ? "Open Remote" : "Open Hachi",
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
			actionLabel: "Open Hachi",
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
	if (!scan) {
		return;
	}

	const checks = [
		["Project files", scan.projectFound, scan.missingFiles.length ? scan.missingFiles.join(", ") : "Found"],
		["Configuration", scan.configurationReady, scan.configurationReady ? "Ready" : scan.configurationMissing.join(", ")],
		["Node modules", scan.hasNodeModules, scan.hasNodeModules ? "Installed" : "Not installed yet"],
		["Dependencies", scan.dependenciesReady !== false, scan.dependenciesReady === false ? (scan.missingDependencies || []).join(", ") || "Missing packages" : "Ready"],
		["Git checkout", scan.hasGit, scan.hasGit ? "Available" : "Manual update mode"],
	];

	renderCheckList("#installChecks", checks);
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
			configureSecretCopyButton(copyButton, protection?.copyable, "Save an encrypted value before copying");
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

	setText("#selectedBotUpdateName", "Hachi");
	setText("#combinedUpdatesMeta", "Hachi and HachiGen update status");
	setText("#updatesMeta", updateMetaLabel(state?.updates, state?.repository));
	setText("#hachiCurrentVersion", hachiCurrentVersionLabel());
	setText("#hachiAvailableVersion", hachiAvailableVersionLabel());
	setText("#updateMessage", hachiStatusMessage());
	setDisabled("#hachiUpdateButton", !canUpdate);
	setElementText($("#hachiUpdateButton"), "Update Hachi");
	setDisabled("#selectedBotDeployButton", !state?.scan?.configurationReady);
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
		const sourceLabel = view.source?.type === "testing" ? `Test: ${view.source.profileName}` : "Production";
		setText(
			"#databaseViewerMeta",
			`${sourceLabel} · ${selectedTable}: showing ${shownCount} of ${pluralize(view.totalRows || 0, "row")}.`,
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
	const external = selectedBotId !== HACHI_BOT_ID;
	if (external) {
		const backups = fleetBackupState || [];
		showSharedModal({
			actions: [
				{ action: "database-transfer-close", label: "Close", variant: "secondary" },
				{ action: "database-transfer-backup", label: "Backup Current", variant: "info" },
				{ action: "database-transfer-restore", disabled: !backups.length, label: "Restore Latest", variant: "warning" },
				{ action: "prune-fleet-backups", label: "Rotate Backups", variant: "secondary" },
			],
			content: [
				createModalSummary(`Back up or restore the ${selectedBotName()} database without leaving HachiGen.`),
				createModalDetails(["Backups are encrypted by HachiGen.", "Restore Latest uses the newest backup shown on this Database page."]),
			],
			meta: `${selectedBotName()} database`,
			title: "Backup / Transfer Database",
		});
		return;
	}
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
	if (selectedBotId !== HACHI_BOT_ID) {
		runAction("Backup database", async () => {
			const result = await api.backupFleetDatabase(selectedBotId);
			fleetBackupState = await api.listFleetBackups(selectedBotId);
			renderExternalDatabaseBackups(fleetBackupState);
			return result;
		});
		return;
	}
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
	if (selectedBotId !== HACHI_BOT_ID) {
		const latest = fleetBackupState?.[0];
		if (!latest) {
			toast("No backup is available to restore.", "error", { label: "Restore database" });
			return;
		}
		runAction("Inspect database backup", () => api.inspectFleetDatabaseRestore(selectedBotId, latest.backupId), { toast: false })
			.then(async inspection => {
				if (!inspection) {
					return;
				}
				const plaintextTransition = Boolean(inspection.disablesEncryption);
				const confirmed = await showConfirmModal({
					confirmText: plaintextTransition ? "Restore as Plaintext" : "Restore",
					details: plaintextTransition ? [
						"The selected backup is plaintext, while the current database is encrypted.",
						"HachiGen will disable database encryption in the bot's runtime configuration after restoring it.",
						"The current encrypted database and its key material will be retained for recovery.",
						"Data written after the selected backup was created will be lost.",
					] : [
						`Backup protection: ${inspection.backupProtection}`,
						"The current database will be retained as an encrypted recovery backup.",
					],
					meta: plaintextTransition ? "Encryption will be disabled" : "Database safety confirmation",
					summary: plaintextTransition ?
						`Restore the latest ${selectedBotName()} backup and return its database to plaintext?` :
						`Restore the latest ${selectedBotName()} database backup?`,
					title: plaintextTransition ? "Restore plaintext database?" : "Restore database backup?",
					variant: "danger",
				});
				if (!confirmed) {
					return;
				}
				runAction("Restore database", async () => {
					const result = await api.restoreFleetDatabaseBackup(selectedBotId, latest.backupId, {
						allowPlaintextTransition: plaintextTransition,
					});
					databaseView = null;
					await refreshFleetOverview();
					await refreshCurrentDatabaseViewer();
					return result;
				});
			});
		return;
	}
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

function renderDatabaseSourceOptions() {
	const select = $("#databaseSourceSelect");
	if (!select) return;
	const options = [{ id: "production", name: "Production" }, ...testingProfiles.map(profile => ({
		id: `testing:${profile.id}`,
		name: `Test: ${profile.name}`,
	}))];
	replaceSelectOptions("#databaseSourceSelect", options, item => item.name);
	if (!options.some(item => item.id === databaseSource)) databaseSource = "production";
	select.value = databaseSource;
}

async function prepareDatabaseViewer() {
	testingProfiles = await api.getTestingProfiles();
	renderDatabaseSourceOptions();
	const productionAvailable = selectedBotId !== HACHI_BOT_ID || state?.database?.exists;
	if (databaseSource !== "production" || productionAvailable) {
		return loadDatabaseViewer();
	}
	renderDatabaseViewer(null);
	return null;
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
		const external = selectedBotId !== HACHI_BOT_ID;
		const testingProfileId = databaseSource.startsWith("testing:") ? databaseSource.slice("testing:".length) : "";
		let result;
		if (testingProfileId) {
			result = await api.readTestingDatabaseTable(selectedBotId, testingProfileId, selectedTable, sort);
		} else {
			result = external ?
				await api.readFleetDatabaseTable(selectedBotId, selectedTable, sort) :
				await api.readDatabaseTable(selectedTable, sort);
			result.source = { type: "production" };
		}
		setDatabaseSort({
			column: result.sortColumn || "",
			direction: result.sortDirection || "",
		});
		setDatabaseView(result);
		if (testingProfileId) renderTestingDatabaseState(result);
		renderFleetSecurityCapabilities();
		if (!external && !testingProfileId) {
			renderDatabase(result.database);
		}
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
	if (databaseSource === "production" && selectedBotId === HACHI_BOT_ID && !state?.database?.exists) {
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
	else if (items.length) select.value = items[0].id;
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
			decorateControlIcon(button, iconNameForControl(button));
			row.append(button);
		}
		entry.append(row);
	}
	return entry;
}

function fleetEmpty(message) {
	const empty = document.createElement("div");
	empty.className = "empty-state";
	empty.textContent = message;
	return empty;
}

function canManageFleetCredentials(deployment, definition) {
	return Boolean(
		definition?.source === "external" &&
		definition.credentials?.mode === "adapter" &&
		definition.commands?.credentialsWrite &&
		deployment?.approvedCapabilities?.secretEncryption,
	);
}

function showFleetCredentialModal(deploymentId) {
	const deployment = fleetState?.deployments?.find(item => item.id === deploymentId);
	const definition = fleetState?.botTypes?.find(item => item.id === deployment?.botTypeId);
	const template = $("#fleetCredentialFormTemplate");
	if (!deployment || !canManageFleetCredentials(deployment, definition) || !template) {
		toast("This bot manages its own credentials.", "error");
		return;
	}
	const form = template.content.firstElementChild.cloneNode(true);
	form.dataset.deploymentId = deployment.id;
	showSharedModal({
		actions: [
			{ action: "fleet-credentials-cancel", label: "Cancel", variant: "secondary" },
			{ action: "fleet-credentials-save", label: "Save Securely", variant: "primary" },
		],
		content: [form],
		meta: `Saved only through ${definition.displayName}'s approved encrypted-storage writer`,
		title: `${deployment.name} credentials`,
	});
}

function renderFleet(nextFleet) {
	fleetState = nextFleet || state?.fleet || null;
	if (!fleetState) return;
	const serverList = $("#fleetServerList");
	const deploymentList = $("#fleetDeploymentList");
	const botTypeList = $("#fleetBotTypeList");
	// Fleet is reserved for optional bots; the built-in runtime keeps its existing dedicated controls.
	const supportedBotTypes = fleetState.botTypes.filter(type => type.source === "external");
	const supportedTypeIds = new Set(supportedBotTypes.map(type => type.id));
	const managedDeployments = fleetState.deployments.filter(deployment => supportedTypeIds.has(deployment.botTypeId));
	serverList?.replaceChildren(...fleetState.servers.map(server => fleetEntry(
		server.name,
		server.connection.type === "local" ?
			`Local · ${managedDeployments.filter(deployment => deployment.serverId === server.id).length} bot(s)` :
			`${server.connection.username}@${server.connection.host}:${server.connection.port} · ${managedDeployments.filter(deployment => deployment.serverId === server.id).length} bot(s)`,
		server.id === "local" ? [] : [
			{ action: "edit-fleet-server", id: server.id, label: "Edit", kind: "info" },
			{ action: "remove-fleet-server", id: server.id, label: "Remove" },
		],
	)));
	deploymentList?.replaceChildren(...(managedDeployments.length ? managedDeployments.map(deployment => {
		const server = fleetState.servers.find(item => item.id === deployment.serverId);
		const type = supportedBotTypes.find(item => item.id === deployment.botTypeId);
		const active = deployment.id === fleetState.activeDeploymentByBotType?.[deployment.botTypeId];
		return fleetEntry(
			`${deployment.name}${active ? " · Active" : ""}`,
			`${type?.displayName || deployment.botTypeId} · ${server?.name || deployment.serverId} · ${deployment.environment} · ${deployment.installPath}`,
			[
				...(!active ? [{ action: "activate-fleet-deployment", id: deployment.id, label: "Select", kind: "info" }] : []),
				{ action: "remove-fleet-deployment", id: deployment.id, label: "Remove" },
			],
		);
	}) : [fleetEmpty("No additional bots have been added.")]));
	botTypeList?.replaceChildren(...(supportedBotTypes.length ? supportedBotTypes.map(type => fleetEntry(
		type.displayName,
		`Credentials: ${type.credentials?.mode === "adapter" ? "approved secure writer" : "managed by bot"} · ${Object.entries(type.capabilities || {}).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "status only"}`,
		[{ action: "remove-bot-definition", id: type.id, label: "Remove" }],
	)) : [fleetEmpty("No bot profiles have been added yet.")]));
	const logicalDeployments = [...new Set(managedDeployments.map(item => item.botTypeId))].map(botTypeId => {
		const deployments = managedDeployments.filter(item => item.botTypeId === botTypeId);
		const activeId = fleetState.activeDeploymentByBotType?.[botTypeId];
		const deployment = deployments.find(item => item.id === activeId) || deployments.find(item => fleetState.servers.find(server => server.id === item.serverId)?.connection?.type === "local") || deployments[0];
		return { id: botTypeId, name: deployment.name };
	});
	const botChoices = [{ id: HACHI_BOT_ID, name: "Hachi" }, ...logicalDeployments];
	const legacySelection = managedDeployments.find(item => item.id === selectedBotId);
	if (legacySelection) {
		selectedBotId = legacySelection.botTypeId;
		window.localStorage.setItem(SELECTED_BOT_KEY, selectedBotId);
	}
	replaceSelectOptions("#globalBotSelect", botChoices, item => item.name);
	if (!botChoices.some(item => item.id === selectedBotId)) selectedBotId = HACHI_BOT_ID;
	$("#globalBotSelect").value = selectedBotId;
	setDisabled("#addFleetBotButton", !fleetState.servers.length);
	setText("#fleetDefinitionErrors", fleetState.botDefinitionErrors?.length ? fleetState.botDefinitionErrors.map(item => `${item.fileName}: ${item.message}`).join("\n") : "");
	renderFleetSecurityCapabilities();
	renderSelectedBotContext();
}

function readableStatus(value) {
	const text = String(value || "Unknown").replace(/-/gu, " ");
	return `${text[0].toUpperCase()}${text.slice(1)}`;
}

function renderFleetOverview(overview = null) {
	if (!overview) {
		for (const prefix of ["#fleetRuntime", "#fleetConnection", "#fleetRepository", "#fleetDeployment", "#fleetOverviewSecurity"]) setDot(`${prefix}Dot`, "muted");
		setText("#fleetBotCardLabel", "Bot");
		setText("#fleetRuntimeStatus", "No bot selected");
		setText("#fleetRuntimeDetail", "Add or select an additional bot");
		setText("#fleetConnectionStatus", "Not selected");
		setText("#fleetConnectionDetail", "Deployment location");
		setText("#fleetRepositoryStatus", "Not checked");
		setText("#fleetRepositoryDetail", "Git status");
		setText("#fleetDeploymentStatus", "Not checked");
		setText("#fleetDeploymentDetail", "Discord commands");
		setText("#fleetOverviewSecurityStatus", "Not checked");
		setText("#fleetOverviewSecurityDetail", "Database protection");
		return;
	}
	const runtime = overview.health?.runtime;
	const runtimeGood = runtime?.status === "online";
	const runtimeBad = overview.health?.error || ["error", "pm2-missing"].includes(runtime?.status);
	setText("#fleetBotCardLabel", overview.deployment?.name || "Bot");
	setDot("#fleetRuntimeDot", runtimeGood ? "good" : runtimeBad ? "bad" : "warn");
	setText("#fleetRuntimeStatus", readableStatus(runtime?.status || (overview.health?.error ? "Unavailable" : "Unknown")));
	setText("#fleetRuntimeDetail", runtime?.message || overview.health?.error || "Runtime status unavailable");
	setDot("#fleetConnectionDot", overview.health?.installFound ? "good" : "bad");
	setText("#fleetConnectionStatus", overview.health?.installFound ? "Found" : "Missing");
	setText("#fleetConnectionDetail", `${overview.server?.type === "ssh" ? "Remote" : "Local"} · ${overview.deployment?.installPath || "No path"}`);
	const repository = overview.repository || {};
	const repositoryBad = repository.error || repository.isGit === false || repository.originMatches === false;
	setDot("#fleetRepositoryDot", repositoryBad ? "bad" : repository.dirty ? "warn" : "good");
	setText("#fleetRepositoryStatus", repositoryBad ? "Needs attention" : repository.dirty ? "Local changes" : "Clean");
	setText("#fleetRepositoryDetail", repository.error || repository.message || `${repository.branch || "Unknown branch"} · ${repository.targetBranch || "No target"}`);
	const deployable = overview.deployment?.capabilities?.discordCommands;
	setDot("#fleetDeploymentDot", deployable ? "good" : "muted");
	setText("#fleetDeploymentStatus", deployable ? "Ready" : "Not configured");
	setText("#fleetDeploymentDetail", deployable ? "Discord command deployment available" : "No command deployment profile");
	const security = overview.security || {};
	const databaseStatus = security.database?.status || (security.error ? "error" : "unknown");
	setDot("#fleetOverviewSecurityDot", ["protected", "not-applicable"].includes(databaseStatus) ? "good" : databaseStatus === "encrypted-unverified" ? "warn" : "bad");
	setText("#fleetOverviewSecurityStatus", readableStatus(databaseStatus));
	setText("#fleetOverviewSecurityDetail", security.error || security.database?.message || "Security status unavailable");
}

async function refreshFleetOverview() {
	const deploymentId = selectedBotId === HACHI_BOT_ID ? "" : selectedBotId;
	const requestId = ++fleetOverviewRequestId;
	if (!deploymentId) {
		renderFleetOverview(null);
		return null;
	}
	const overview = await api.getFleetDeploymentOverview(deploymentId);
	if (requestId === fleetOverviewRequestId && deploymentId === selectedBotId) {
		renderFleetOverview(overview);
		renderExternalDashboard(overview);
		if (activeView === "database" && overview.deployment?.capabilities?.backups) {
			const backups = await api.listFleetBackups(deploymentId);
			if (requestId === fleetOverviewRequestId && deploymentId === selectedBotId) renderExternalDatabaseBackups(backups);
		}
	}
	return overview;
}

function renderFleetSecurityCapabilities() {
	const deployment = selectedFleetDeployment();
	const definition = fleetState?.botTypes?.find(item => item.id === deployment?.botTypeId);
	const capabilities = definition?.source === "native" ? definition.capabilities : (deployment?.approvedCapabilities || {});
	const external = selectedBotId !== HACHI_BOT_ID;
	setDisabled("#migrateDatabaseButton", external);
	setDisabled("#forceMigrateDatabaseButton", external);
	setDisabled("#sanitizeDatabaseButton", external);
	setDisabled("#databaseKeyActionButton", external && !capabilities?.databaseEncryption);
	setDisabled("#exportDatabaseKeyBackupButton", external && !["protected", "encrypted-unverified"].includes(externalDatabaseProtectionStatus));
	setDisabled("#rotateDatabaseBackupsButton", external && !capabilities?.backups);
	if (external) {
		const testingSource = databaseSource.startsWith("testing:");
		const testingEncrypted = Boolean(databaseView?.database?.encryptedLikely);
		const productionEncrypted = ["protected", "encrypted-unverified"].includes(externalDatabaseProtectionStatus);
		const productionCanRotate = Boolean(definition?.commands?.databaseRotate);
		$("#databaseKeyActionButton").dataset.action = testingSource ? "protect-testing-database" : productionEncrypted ? "rotate-fleet-database-key" : "encrypt-fleet-database";
		$("#rotateDatabaseBackupsButton").dataset.action = "rotate-fleet-backups";
		$("#verifyDatabaseProtectionButton").dataset.action = "audit-fleet-security";
		setElementText($("#databaseKeyActionButton"), testingSource ? (testingEncrypted ? "Rotate Key" : "Encrypt Data") : productionEncrypted ? "Rotate Key" : "Encrypt Database");
		setDisabled("#databaseKeyActionButton", !capabilities?.databaseEncryption || (!testingSource && productionEncrypted && !productionCanRotate));
	} else {
		$("#databaseKeyActionButton").dataset.action = "generate-database-key";
		$("#rotateDatabaseBackupsButton").dataset.action = "rotate-database-backups";
		$("#verifyDatabaseProtectionButton").dataset.action = "verify-database-protection";
	}
	setDisabled("#fleetPruneLogsButton", !capabilities?.logs);
}

function renderTestingProfileEditor(profile = null) {
	const form = $("#testingProfileForm");
	if (!form) return;
	selectedTestingProfileId = profile?.id || null;
	form.reset();
	form.elements.id.value = profile?.id || "";
	form.elements.name.value = profile?.name || "";
	form.elements.guildIds.value = (profile?.guildIds || []).join(", ");
	form.elements.isDefault.checked = profile?.isDefault === true;
	setText("#testingProfileFormTitle", profile ? profile.name : "New Identity");
	setDisabled("#deleteTestingProfileButton", !profile);
	for (const button of form.querySelectorAll('[data-action="copy-testing-secret"]')) {
		const field = button.dataset.secretField;
		configureSecretCopyButton(button, profile?.hasValues?.[field]);
	}
}

function renderTestingProfiles(profiles) {
	testingProfiles = Array.isArray(profiles) ? profiles : [];
	const list = $("#testingProfileList");
	if (list) {
		list.replaceChildren(...(testingProfiles.length ? testingProfiles.map(profile => fleetEntry(
			`${profile.name}${profile.isDefault ? " · Default" : ""}`,
			`${profile.hasValues?.TOKEN && profile.hasValues?.clientId ? "Ready" : "Incomplete"} · ${(profile.guildIds || []).length} test guild(s)`,
			[{ action: "edit-testing-profile", id: profile.id, label: "Edit", kind: "info" }],
		)) : [fleetEmpty("No testing identities saved.")]));
	}
	const selected = testingProfiles.find(profile => profile.id === selectedTestingProfileId);
	if (selectedTestingProfileId && !selected) renderTestingProfileEditor(null);
	else if (selected) renderTestingProfileEditor(selected);
	renderTestingRunner();
}

function renderTestingRunner(runs = testingRuns) {
	testingRuns = Array.isArray(runs) ? runs : [];
	const deployments = (fleetState?.deployments || []).filter(deployment => {
		const server = fleetState.servers.find(item => item.id === deployment.serverId);
		return server?.connection?.type === "local";
	});
	replaceSelectOptions("#testingDeploymentSelect", deployments, deployment => deployment.name);
	const contextualDeployment = selectedBotId === HACHI_BOT_ID ? deployments.find(deployment => {
		const definition = fleetState?.botTypes?.find(type => type.id === deployment.botTypeId);
		return definition?.source === "native";
	}) : deployments.find(deployment => deployment.botTypeId === selectedBotId);
	if (contextualDeployment && $("#testingDeploymentSelect")) $("#testingDeploymentSelect").value = contextualDeployment.id;
	replaceSelectOptions("#testingIdentitySelect", testingProfiles, profile => `${profile.name}${profile.isDefault ? " · Default" : ""}`);
	const deploymentId = $("#testingDeploymentSelect")?.value || "";
	const deployment = deployments.find(item => item.id === deploymentId);
	const definition = fleetState?.botTypes?.find(item => item.id === deployment?.botTypeId);
	const approvalChanged = definition?.source === "external" && deployment?.definitionFingerprint !== definition?.fingerprint;
	const runState = testingRuns.find(run => run.deploymentId === deploymentId);
	const running = ["running", "starting", "stopping"].includes(runState?.status);
	if ($("#reapproveTestingProfileButton")) $("#reapproveTestingProfileButton").hidden = !approvalChanged;
	setDisabled("#startTestingBotButton", !deploymentId || !$("#testingIdentitySelect")?.value || running);
	setDisabled("#stopTestingBotButton", !running);
	setDisabled("#resetTestingCommandsButton", !deploymentId || !$("#testingIdentitySelect")?.value || !deployment?.testCommandsAvailable);
	setText("#testingRunOutput", runState ?
		`Status: ${runState.status}${runState.exitCode === null ? "" : ` · Exit code: ${runState.exitCode}`}${runState.databasePath ? `\nTest database: ${runState.databasePath}` : ""}\n${runState.output || "No process output yet."}` :
		"Select a local bot and testing identity.");
}

async function refreshTestingProfiles() {
	const [profiles, runs] = await Promise.all([api.getTestingProfiles(), api.getTestingRuns()]);
	renderTestingProfiles(profiles);
	renderTestingRunner(runs);
}

async function handleTestingProfileSubmit(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const values = Object.fromEntries(new window.FormData(form));
	values.isDefault = Boolean(form.elements.isDefault.checked);
	const result = await runAction("Save testing identity", () => api.saveTestingProfile(values));
	if (!result) return;
	renderTestingProfiles(result.profiles);
	const saved = result.profiles.find(profile => profile.id === values.id) ||
		result.profiles.find(profile => profile.name === values.name);
	renderTestingProfileEditor(saved || null);
}

async function refreshFleet() {
	const fleet = await api.getFleet();
	renderFleet(fleet);
	return fleet;
}

async function refreshCurrentView() {
	if (selectedBotId !== HACHI_BOT_ID && ["dashboard", "setup", "updates", "database", "diagnostics"].includes(activeView)) {
		await refreshFleetOverview();
		return { message: `${selectedBotName()} refreshed.` };
	}
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
		return { message: "Hachi refreshed." };
	}

	if (activeView === "testing") {
		await refreshTestingProfiles();
		return { message: "Testing identities refreshed." };
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
	// Dashboard status cards.
	renderStatusCard("bot", bot);
	renderStatusCard("install", install);
	renderStatusCard("update", updates);
	renderStatusCard("deploy", {
		detail: scan.configurationReady ? "Global and guild commands" : "Save configuration first",
		dot: scan.configurationReady ? "good" : "warn",
		label: scan.configurationReady ? "Ready" : "Needs config",
	});
	renderStatusCard("dashboardDatabase", database);

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
	if (selectedBotId === HACHI_BOT_ID && installInput && document.activeElement !== installInput) {
		installInput.value = state.runtimeTarget === "remote" ? state.scan?.installPath || "" : state.installPath || "";
	}

	if (selectedBotId === HACHI_BOT_ID) renderInstallChecks(scan);
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
	if (selectedBotId !== HACHI_BOT_ID) {
		const result = await api.getFleetDeploymentLogs(selectedBotId, 300);
		setLogText("pm2Logs", result.logs || "No bot logs returned.");
		setText("#eventLogs", `Showing ${selectedBotName()} runtime logs. HachiGen activity remains available in Diagnostics.`);
		return;
	}
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
	if (selectedBotId !== HACHI_BOT_ID) {
		return;
	}
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
		// Additional bots must refresh through their selected deployment adapter.
		// Pulling native state here would repaint Hachi over the external bot view.
		if (selectedBotId === HACHI_BOT_ID) {
			await refreshState();
		} else {
			await refreshFleetOverview();
		}
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
		if (selectedBotId === HACHI_BOT_ID) {
			renderStashedChanges(state?.updates);
			renderHachiUpdateSummary();
			renderHachiGenUpdate(state?.hachiGenUpdate);
			renderDatabase(state?.database);
		} else if (databaseSource.startsWith("testing:") && databaseView) {
			renderTestingDatabaseState(databaseView);
		}
		renderDatabaseViewer(databaseView);
		renderFleetSecurityCapabilities();
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

	if (event.target.id === "databaseSourceSelect") {
		databaseSource = event.target.value || "production";
		databaseView = null;
		setDatabaseSort({ column: "", direction: "" });
		loadDatabaseViewer();
	}

	if (event.target.name === "remotePortMode") {
		updateRemotePortMode();
	}


	if (event.target.id === "globalBotSelect") {
		selectedBotId = event.target.value || HACHI_BOT_ID;
		window.localStorage.setItem(SELECTED_BOT_KEY, selectedBotId);
		databaseView = null;
		databaseSource = "production";
		renderDatabaseSourceOptions();
		renderSelectedBotContext();
		if (selectedBotId === HACHI_BOT_ID) {
			// The initial state may be only the lightweight startup snapshot. Fetch
			// native details when Hachi becomes selected instead of rendering stale
			// data left by the previously selected additional bot.
			refreshState().catch(error => toast(error.message || "Hachi status refresh failed.", "error"));
		} else {
			if ($("#testingDeploymentSelect")) $("#testingDeploymentSelect").value = selectedFleetDeployment()?.id || "";
			renderTestingRunner();
			refreshFleetOverview().catch(error => toast(error.message || "Bot status refresh failed.", "error"));
			loadExternalConfiguration().catch(error => setText("#externalConfigurationMessage", error.message));
			if (activeView === "logs") refreshLogs();
		}
	}
	if (["testingDeploymentSelect", "testingIdentitySelect"].includes(event.target.id)) {
		renderTestingRunner();
	}

	if (event.target.name === "runtimeTarget") {
		const nextTarget = event.target.value === "remote" ? "remote" : "local";
		const externalDeployment = selectedBotId !== HACHI_BOT_ID ? selectedFleetDeployment() : null;
		if (externalDeployment) {
			const matchingDeployment = (fleetState?.deployments || []).find(deployment => {
				const server = fleetState.servers.find(item => item.id === deployment.serverId);
				return deployment.botTypeId === externalDeployment.botTypeId && (server?.connection?.type === "ssh" ? "remote" : "local") === nextTarget;
			});
			if (matchingDeployment) {
				// Installation-bound data must never survive a local/remote switch.
				databaseView = null;
				sanitizeReport = null;
				fleetBackupState = [];
				renderDatabaseViewer(null);
				api.setActiveFleetDeployment(matchingDeployment.id)
					.then(async fleet => {
						renderFleet(fleet);
						await refreshFleetOverview();
						await loadExternalConfiguration();
						if (activeView === "database") await loadDatabaseViewer();
						if (activeView === "logs") await refreshLogs();
					})
					.catch(error => toast(error.message, "error"));
			}
			return;
		}

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

function renderExternalConfiguration(configuration) {
	externalConfiguration = configuration;
	const files = configuration?.files || [];
	setText("#externalConfigurationMeta", files.length ? "" : "No supported .env, JSON, or YAML configuration detected");
	setDisabled("#saveConfigurationButton", !files.length);
	const container = $("#externalConfigurationFields");
	if (!container) return;
	const elements = [];
	for (const file of files) {
		for (const field of file.fields) {
			const label = document.createElement("label");
			label.className = "field";
			const title = document.createElement("span");
			title.textContent = field.key;
			const input = document.createElement("input");
			input.dataset.configKey = field.key;
			input.dataset.configPath = file.path;
			input.type = field.sensitive ? "password" : "text";
			input.placeholder = field.sensitive ? (field.hasValue ? "Sensitive value saved — enter to replace" : "Enter sensitive value") : "";
			input.value = field.sensitive ? "" : String(field.value);
			if (field.type === "number") input.type = "number";
			label.append(title);
			if (field.sensitive) {
				const row = document.createElement("div");
				row.className = "secret-field-row";
				const copy = document.createElement("button");
				copy.className = "button secondary compact";
				copy.type = "button";
				copy.dataset.action = "copy-secret";
				copy.dataset.configKey = field.key;
				copy.dataset.configPath = file.path;
				copy.textContent = "Copy";
				configureSecretCopyButton(copy, field.hasValue);
				row.append(input, copy);
				label.append(row);
			} else {
				label.append(input);
			}
			elements.push(label);
		}
	}
	container.replaceChildren(...elements);
}

async function loadExternalConfiguration() {
	if (selectedBotId === HACHI_BOT_ID) return;
	renderExternalConfiguration(await api.getFleetDeploymentConfiguration(selectedBotId));
}

async function saveExternalConfiguration(deployment) {
	const files = externalConfiguration?.files || [];
	let result = externalConfiguration;
	for (const file of files) {
		const fields = file.fields.map(field => {
			const input = [...$all("#externalConfigurationFields input")].find(item => item.dataset.configPath === file.path && item.dataset.configKey === field.key);
			return { key: field.key, value: input?.value ?? "" };
		});
		result = await api.saveFleetDeploymentConfiguration(deployment.id, { fields, hash: file.hash, path: file.path });
	}
	renderExternalConfiguration(result);
	return { message: "Bot configuration saved." };
}

async function saveExternalRemoteSettings(deployment) {
	const settings = readRemoteForm();
	if (!settings.host.trim() || !settings.username.trim() || !settings.sshKeyPath.trim() || !settings.remotePath.trim()) {
		throw new Error("Host, username, SSH private key, and remote bot path are required.");
	}
	const port = settings.portMode === "custom" ? Number.parseInt(settings.port, 10) : 22;
	let fleet = fleetState || await api.getFleet();
	let server = fleet.servers.find(item => item.connection?.type === "ssh" &&
		item.connection.host.toLowerCase() === settings.host.trim().toLowerCase() &&
		item.connection.username === settings.username.trim() &&
		Number(item.connection.port) === port);
	if (!server) {
		fleet = await api.addFleetServer({
			connection: { host: settings.host, port, sshKeyPath: settings.sshKeyPath, type: "ssh", username: settings.username },
			name: settings.host.trim(),
		});
		server = fleet.servers.find(item => item.connection?.type === "ssh" &&
			item.connection.host.toLowerCase() === settings.host.trim().toLowerCase() &&
			item.connection.username === settings.username.trim() &&
			Number(item.connection.port) === port);
	}
	if (!server) throw new Error("Remote connection could not be resolved.");
	// A matching endpoint is a shared server-level record. Do not silently use
	// its old private key when the form contains a different one.
	if (String(server.connection.sshKeyPath || "").trim().toLowerCase() !== settings.sshKeyPath.trim().toLowerCase()) {
		throw new Error(`The saved ${server.name} connection uses a different SSH key. Update that Fleet connection before attaching this installation.`);
	}
	const existing = fleet.deployments.find(item => item.botTypeId === deployment.botTypeId && item.serverId === server.id && item.installPath === settings.remotePath.trim());
	if (existing) {
		renderFleet(await api.setActiveFleetDeployment(existing.id));
		return { message: "Remote installation is already configured." };
	}
	fleet = await api.addFleetDeployment({
		botTypeId: deployment.botTypeId,
		environment: "production",
		installPath: settings.remotePath.trim(),
		name: deployment.name,
		pm2Name: settings.pm2Name.trim() || deployment.pm2Name,
		serverId: server.id,
	});
	const remoteDeployment = fleet.deployments.find(item => item.botTypeId === deployment.botTypeId && item.serverId === server.id && item.installPath === settings.remotePath.trim());
	if (remoteDeployment) {
		fleet = await api.setActiveFleetDeployment(remoteDeployment.id);
	}
	renderFleet(fleet);
	return { message: "Remote settings saved." };
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
	const externalDeployment = selectedBotId !== HACHI_BOT_ID ? selectedFleetDeployment() : null;
	if (action === "show-setup") {
		showView("setup");
		return;
	}

	if (action === "show-remote") {
		showView("setup");
		window.requestAnimationFrame(() => $("#remoteConnectionPanel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
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

	if (externalDeployment && ["install-validate", "validate"].includes(action)) {
		runAction(`Check ${externalDeployment.name} health`, () => api.checkFleetDeploymentHealth(externalDeployment.id));
		return;
	}

	if (externalDeployment && action === "start") {
		runAction(`Start ${externalDeployment.name}`, () => api.controlFleetDeployment(externalDeployment.id, "start"));
		return;
	}

	if (externalDeployment && action === "deploy") {
		runAction(`Deploy ${externalDeployment.name} commands`, () => api.deployFleetDiscordCommands(externalDeployment.id));
		return;
	}

	if (externalDeployment && action === "update") {
		showView("updates");
		return;
	}

	if (externalDeployment && action === "check-updates") {
		showView("updates");
		runAction(`Check ${externalDeployment.name} updates`, () => api.getFleetRepositoryStatus(externalDeployment.id, { fetch: true }));
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
	const externalDeployment = selectedBotId !== HACHI_BOT_ID ? selectedFleetDeployment() : null;
	if (externalDeployment && action === "save-remote-settings") {
		runAction("Save remote settings", () => saveExternalRemoteSettings(externalDeployment));
		return;
	}
	if (externalDeployment && action === "test-remote") {
		setText("#remoteTestOutput", "Testing remote connection...");
		runAction("Test remote connection", () => api.testFleetRemoteConnection(readRemoteForm()), { toast: false })
			.then(result => {
				if (!result) return;
				setText("#remoteTestOutput", formatRemoteTestOutput(result));
				setText("#remotePreviewLastTest", `${result.ok ? "Passed" : "Failed"} ${formatDateTime(result.checkedAt)} - ${result.message}`);
				toast(result.message, result.ok ? "info" : "error", { label: "Test remote connection" });
			});
		return;
	}
	// Shared controls operate on the selected logical bot. Hachi keeps its native
	// workflow; additional bots cross the IPC boundary only through Fleet APIs.
	if (externalDeployment && ["start", "stop", "restart"].includes(action)) {
		const operation = action;
		runAction(`${operation} ${externalDeployment.name}`, async () => {
			const result = await api.controlFleetDeployment(externalDeployment.id, operation);
			await refreshFleetOverview();
			return result;
		});
		return;
	}

	if (externalDeployment && action === "deploy") {
		runAction(`Deploy ${externalDeployment.name} commands`, () => api.deployFleetDiscordCommands(externalDeployment.id));
		return;
	}

	if (externalDeployment && action === "check-all-updates") {
		runAction(`Check ${externalDeployment.name} updates`, async () => {
			const result = await api.getFleetRepositoryStatus(externalDeployment.id, { fetch: true });
			await refreshFleetOverview();
			return result;
		});
		return;
	}

	if (externalDeployment && ["validate", "install-validate"].includes(action)) {
		runAction(`Check ${externalDeployment.name} health`, async () => {
			const result = await api.checkFleetDeploymentHealth(externalDeployment.id);
			await refreshFleetOverview();
			return result;
		});
		return;
	}

	if (externalDeployment && ["update", "update-hachi"].includes(action)) {
		showConfirmModal({
			confirmText: "Update",
			meta: "Transactional bot update",
			summary: `Update ${externalDeployment.name}, validate it, and roll back automatically if the update fails?`,
			title: `Update ${externalDeployment.name}?`,
		}).then(confirmed => {
			if (!confirmed) return;
			runAction(`Update ${externalDeployment.name}`, async () => {
				const result = await api.updateFleetDeployment(externalDeployment.id);
				await refreshFleetOverview();
				return result;
			});
		});
		return;
	}

	if (action === "new-testing-profile") {
		renderTestingProfileEditor(null);
		$("#testingProfileForm input[name=\"name\"]")?.focus();
		return;
	}

	if (action === "edit-testing-profile") {
		renderTestingProfileEditor(testingProfiles.find(profile => profile.id === button.dataset.itemId) || null);
		return;
	}

	if (action === "copy-testing-secret") {
		if (!selectedTestingProfileId) return;
		runAction("Copy testing credential", () => api.copyTestingSecret(selectedTestingProfileId, button.dataset.secretField));
		return;
	}

	if (action === "delete-testing-profile") {
		if (!selectedTestingProfileId) return;
		const profile = testingProfiles.find(item => item.id === selectedTestingProfileId);
		showConfirmModal({
			confirmText: "Delete Identity",
			meta: "This removes its locally protected credentials",
			summary: `${profile?.name || "This testing identity"} will be permanently removed from this computer.`,
			title: "Delete testing identity?",
			variant: "danger",
		}).then(confirmed => {
			if (!confirmed) return;
			runAction("Delete testing identity", () => api.deleteTestingProfile(selectedTestingProfileId)).then(result => {
				if (!result) return;
				renderTestingProfiles(result.profiles);
				renderTestingProfileEditor(null);
			});
		});
		return;
	}

	if (action === "refresh-testing-run") {
		runAction("Refresh testing process", async () => {
			await refreshFleet();
			return refreshTestingProfiles();
		});
		return;
	}

	if (action === "reapprove-testing-profile") {
		const deploymentId = $("#testingDeploymentSelect")?.value;
		const deployment = fleetState?.deployments?.find(item => item.id === deploymentId);
		const definition = fleetState?.botTypes?.find(item => item.id === deployment?.botTypeId);
		showConfirmModal({
			confirmText: "Validate & Approve",
			details: [
				`Local repository: ${deployment?.installPath || "Not found"}`,
				`Requested capabilities: ${Object.entries(definition?.capabilities || {}).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "Status only"}`,
			],
			meta: "Local testing profile review",
			summary: "HachiGen will validate the local source repository before approving the changed bot profile for testing.",
			title: `Reapprove ${deployment?.name || "bot"} for testing?`,
			variant: "warning",
		}).then(confirmed => {
			if (!confirmed || !deployment) return;
			runAction("Reapprove local testing profile", async () => {
				renderFleet(await api.reapproveFleetDeployment(deployment.id));
				renderTestingRunner();
				return { message: "Local testing profile validated and reapproved." };
			});
		});
		return;
	}

	if (action === "start-testing-bot") {
		const deploymentId = $("#testingDeploymentSelect")?.value;
		const botTypeId = fleetState?.deployments?.find(item => item.id === deploymentId)?.botTypeId || selectedBotId;
		const profileId = $("#testingIdentitySelect")?.value;
		runAction("Start testing bot", () => api.startTestingBot(botTypeId, profileId)).then(result => {
			if (result) renderTestingRunner(result.runs);
		});
		return;
	}

	if (action === "stop-testing-bot") {
		const deploymentId = $("#testingDeploymentSelect")?.value;
		const botTypeId = fleetState?.deployments?.find(item => item.id === deploymentId)?.botTypeId || selectedBotId;
		runAction("Stop testing bot", () => api.stopTestingBot(botTypeId)).then(result => {
			if (result) renderTestingRunner(result.runs);
		});
		return;
	}

	if (action === "reset-testing-commands") {
		const deploymentId = $("#testingDeploymentSelect")?.value;
		const botTypeId = fleetState?.deployments?.find(item => item.id === deploymentId)?.botTypeId || selectedBotId;
		const profileId = $("#testingIdentitySelect")?.value;
		const deployment = fleetState?.deployments?.find(item => item.id === deploymentId);
		const profile = testingProfiles.find(item => item.id === profileId);
		showConfirmModal({
			confirmText: "Delete & Redeploy",
			details: [
				"All global commands owned by the selected test application will be deleted.",
				"Guild commands will be deleted from its current guilds, then the selected bot's approved deployment scripts will run with test credentials.",
				"Production credentials and production commands are not used.",
			],
			meta: `${deployment?.name || "Selected bot"} · ${profile?.name || "Selected test identity"}`,
			summary: "Reset commands registered to this shared testing application?",
			title: "Reset test commands?",
			variant: "warning",
		}).then(confirmed => {
			if (!confirmed) return;
			runAction("Reset test commands", () => api.resetTestingCommands(botTypeId, profileId)).then(result => {
				if (result) setText("#testingRunOutput", result.message || "Test commands reset.");
			});
		});
		return;
	}

	if (action === "refresh-fleet") {
		runAction("Refresh fleet", refreshFleet);
		return;
	}

	if (action === "add-fleet-server") {
		const form = $("#fleetServerForm");
		const values = Object.fromEntries(new window.FormData(form));
		const serverId = values.serverId;
		runAction(serverId ? "Update server" : "Add server", async () => {
			const payload = {
				name: values.name,
				connection: { type: values.type, host: values.host, username: values.username, port: values.port, sshKeyPath: values.sshKeyPath },
			};
			const fleet = serverId ? await api.updateFleetServer(serverId, payload) : await api.addFleetServer(payload);
			renderFleet(fleet);
			form.reset();
			setText("#saveFleetServerButton", "Add Server");
			$("#cancelFleetServerEditButton").hidden = true;
			return { message: serverId ? "Server updated." : "Server added." };
		});
		return;
	}

	if (action === "edit-fleet-server") {
		const server = fleetState?.servers?.find(item => item.id === button.dataset.itemId);
		const form = $("#fleetServerForm");
		if (!server || !form || server.connection.type !== "ssh") return;
		form.elements.serverId.value = server.id;
		form.elements.name.value = server.name;
		form.elements.type.value = server.connection.type;
		form.elements.host.value = server.connection.host;
		form.elements.username.value = server.connection.username;
		form.elements.port.value = server.connection.port;
		form.elements.sshKeyPath.value = server.connection.sshKeyPath;
		setText("#saveFleetServerButton", "Update Server");
		$("#cancelFleetServerEditButton").hidden = false;
		form.scrollIntoView({ behavior: "smooth", block: "center" });
		return;
	}

	if (action === "cancel-fleet-server-edit") {
		const form = $("#fleetServerForm");
		form?.reset();
		setText("#saveFleetServerButton", "Add Server");
		$("#cancelFleetServerEditButton").hidden = true;
		return;
	}

	if (action === "choose-fleet-bot-folder") {
		runAction("Choose bot folder", () => api.chooseFleetBotFolder(), { toast: false }).then(result => {
			if (!result || result.canceled) return;
			const input = $("#fleetDeploymentForm input[name=\"installPath\"]");
			if (input) input.value = result.path;
		});
		return;
	}

	if (action === "browse-fleet-ssh-key") {
		// Reuse Hachi's validated private-key picker without saving Hachi's remote settings.
		runAction("Choose Fleet SSH key", () => api.chooseSshKey(), { toast: false })
			.then(result => {
				if (result?.ok) {
					const input = $("#fleetServerForm input[name=\"sshKeyPath\"]");
					if (input) input.value = result.sshKeyPath;
					toast(result.message || "SSH key selected.");
				} else if (result?.message) {
					toast(result.message);
				}
			});
		return;
	}

	if (action === "install-bot-definition") {
		const form = $("#botDefinitionForm");
		const definitionText = form.elements.definition.value;
		runAction("Review bot support", () => api.previewExternalBotDefinition(definitionText), { toast: false }).then(preview => {
			if (!preview) return;
			const permissions = preview.capabilities.length ? preview.capabilities.join(", ") : "Observe only";
			showConfirmModal({
				title: `Add support for ${preview.displayName}?`,
				meta: "Bot support permission review",
				summary: `Repository: ${preview.repository.url}\nBranch: ${preview.repository.branch}\nCredentials: ${preview.credentialsMode}\nRequested capabilities: ${permissions}\nCommands: ${preview.commands.join(", ") || "None"}`,
				confirmText: "Approve & Add",
			}).then(confirmed => {
				if (!confirmed) return;
				runAction("Add bot support", async () => {
					const fleet = await api.installExternalBotDefinition(definitionText);
					renderFleet(fleet);
					form.reset();
					return { message: `Support for ${preview.displayName} was added.` };
				});
			});
		});
		return;
	}

	if (action === "remove-bot-definition") {
		runAction("Remove bot support", async () => {
			const fleet = await api.removeExternalBotDefinition(button.dataset.itemId);
			renderFleet(fleet);
			return { message: "Bot support removed." };
		});
		return;
	}

	if (action === "add-fleet-deployment") {
		const form = $("#fleetDeploymentForm");
		const values = Object.fromEntries(new window.FormData(form));
		// Onboarding always starts from the permanent local connection. Remote
		// deployments are attached only after HachiGen has a reviewed local profile.
		values.serverId = "local";
		runAction("Inspect bot", () => api.inspectFleetBotCandidate(values), { toast: false }).then(candidate => {
			if (!candidate) return;
			const definition = candidate.definition;
			const capabilities = Object.entries(definition.capabilities).filter(([, enabled]) => enabled).map(([name]) => name);
			showConfirmModal({
				confirmText: "Create Profile & Add Bot",
				details: [
					`Repository: ${definition.repository.url}`,
					`Branch: ${definition.repository.branch}`,
					`Ecosystem: ${candidate.detected.ecosystemFound ? definition.runtime.ecosystemFile : "Not detected"}`,
					`Capabilities: ${capabilities.join(", ") || "Status only"}`,
					...candidate.warnings,
				],
				meta: "Review the automatically generated production profile",
				summary: `${definition.displayName} was inspected without changing its repository. HachiGen will save this profile under Profiles/Bots.`,
				title: `Add ${definition.displayName}?`,
			}).then(confirmed => {
				if (!confirmed) return;
				runAction("Add bot", async () => {
					const currentFleet = fleetState || await api.getFleet();
					let nextFleet = currentFleet;
					if (!currentFleet.botTypes.some(type => type.id === definition.id)) {
						nextFleet = await api.installExternalBotDefinition(JSON.stringify(definition));
					}
					const fleet = await api.addFleetDeployment({
						botTypeId: definition.id,
						environment: "production",
						installPath: candidate.installPath,
						name: values.name || definition.displayName,
						pm2Name: values.pm2Name || definition.runtime.pm2Name,
						serverId: candidate.serverId,
					});
					renderFleet(fleet || nextFleet);
					form.reset();
					return { ...(fleet || nextFleet), message: "Production bot added." };
				});
			});
		});
		return;
	}

	if (action === "fleet-edit-credentials") {
		showFleetCredentialModal(button.dataset.itemId || selectedBotId);
		return;
	}

	if (action === "reapprove-fleet-deployment") {
		const deployment = selectedFleetDeployment();
		const definition = fleetState?.botTypes?.find(item => item.id === deployment?.botTypeId);
		const capabilities = Object.entries(definition?.capabilities || {}).filter(([, enabled]) => enabled).map(([name]) => name);
		showConfirmModal({
			confirmText: "Validate & Approve",
			details: [
				`Repository: ${definition?.repository?.url || "Not declared"}`,
				`Branch: ${deployment?.repositoryBranch || definition?.repository?.branch || "Not declared"}`,
				`Requested capabilities: ${capabilities.join(", ") || "Status only"}`,
			],
			meta: "Changed Bot Profile permission review",
			summary: "HachiGen will validate this installation before replacing its previous capability snapshot.",
			title: `Reapprove ${deployment?.name || "bot"}?`,
			variant: "warning",
		}).then(confirmed => {
			if (!confirmed) return;
			runAction("Reapprove bot profile", async () => {
				const fleet = await api.reapproveFleetDeployment(deployment.id);
				renderFleet(fleet);
				return { message: "Bot Profile validated and reapproved." };
			});
		});
		return;
	}

	if (action === "fleet-credentials-cancel") {
		closeSharedModal();
		return;
	}

	if (action === "fleet-credentials-save") {
		const form = $("#fleetCredentialModalForm");
		if (!form?.reportValidity()) return;
		const values = Object.fromEntries(new window.FormData(form));
		values.allowConcurrent = Boolean(form.elements.allowConcurrent.checked);
		runAction("Save bot credentials", async () => {
			const fleet = await api.saveFleetDeploymentCredentials(form.dataset.deploymentId, values);
			renderFleet(fleet);
			return { message: "Credentials encrypted in the bot folder." };
		}).then(result => {
			if (result) closeSharedModal();
		});
		return;
	}

	if (["audit-fleet-security", "encrypt-fleet-database", "rotate-fleet-database-key"].includes(action)) {
		const deploymentId = selectedBotId;
		const execute = async () => {
			const result = action === "audit-fleet-security" ?
				await api.auditFleetDeploymentSecurity(deploymentId) : action === "rotate-fleet-database-key" ?
					await api.rotateFleetDatabaseKey(deploymentId) :
					await api.encryptFleetDatabase(deploymentId);
			setText("#fleetLogMaintenanceOutput", JSON.stringify(result, null, 2));
			return { message: result.message || "Security operation completed." };
		};
		if (action === "audit-fleet-security") {
			runAction("Fleet security", execute);
		} else {
			const rotating = action === "rotate-fleet-database-key";
			showConfirmModal({
				title: rotating ? "Rotate deployment database key?" : "Encrypt deployment database?",
				meta: "Database safety confirmation",
				summary: rotating ?
					"The bot will stop, create a safety backup, atomically rekey its encrypted database, update its existing key store, and verify access." :
					"HachiGen will stop the selected deployment and retain or create a recovery copy. Verify the selected deployment before continuing.",
				confirmText: rotating ? "Rotate Key" : "Encrypt",
				variant: "danger",
			}).then(confirmed => {
				if (confirmed) runAction("Fleet database security", execute);
			});
		}
		return;
	}

	if (action === "protect-testing-database") {
		const profileId = databaseSource.startsWith("testing:") ? databaseSource.slice("testing:".length) : "";
		const encrypted = Boolean(databaseView?.database?.encryptedLikely);
		if (!profileId) return;
		showConfirmModal({
			title: encrypted ? "Rotate testing database key?" : "Encrypt testing database?",
			meta: "Isolated testing data only",
			summary: encrypted ?
				"HachiGen will back up the selected testing database, rotate its protected key, and verify access." :
				"HachiGen will back up and encrypt only the selected testing database. Production data and keys are not used.",
			confirmText: encrypted ? "Rotate Key" : "Encrypt Data",
			variant: "warning",
		}).then(confirmed => {
			if (!confirmed) return;
			runAction(encrypted ? "Rotate testing database key" : "Encrypt testing database", () =>
				api.protectTestingDatabase(selectedBotId, profileId)).then(result => {
				if (result?.ok) refreshCurrentDatabaseViewer();
			});
		});
		return;
	}

	if (["save-fleet-policies", "list-fleet-backups", "prune-fleet-backups", "prune-fleet-logs"].includes(action)) {
		const deploymentId = selectedBotId;
		if (action === "prune-fleet-backups") closeSharedModal();
		runAction("Fleet retention", async () => {
			let result;
			if (action === "save-fleet-policies") {
				result = await api.setFleetDeploymentPolicies(deploymentId, {
					backupRetention: $("#fleetBackupRetentionInput")?.value || selectedFleetDeployment()?.policies?.backupRetention || 14,
					autoBackupHours: $("#fleetAutoBackupHoursInput")?.value || selectedFleetDeployment()?.policies?.autoBackupHours || 0,
					logRetentionDays: $("#fleetLogRetentionInput").value,
					requireEncryptedDatabase: true,
				});
				renderFleet(result);
			} else if (action === "list-fleet-backups") {
				result = await api.listFleetBackups(deploymentId);
				renderExternalDatabaseBackups(result);
			}
			else if (action === "prune-fleet-backups") result = await api.pruneFleetBackups(deploymentId);
			else result = await api.pruneFleetLogs(deploymentId);
			setText("#fleetLogMaintenanceOutput", JSON.stringify(result, null, 2));
			if (["list-fleet-backups", "prune-fleet-backups"].includes(action)) {
				fleetBackupState = await api.listFleetBackups(deploymentId);
				renderExternalDatabaseBackups(fleetBackupState);
			}
			return { message: "Retention operation completed." };
		});
		return;
	}

	if (action === "activate-fleet-deployment") {
		runAction("Select deployment", async () => {
			const deployment = fleetState?.deployments?.find(item => item.id === button.dataset.itemId);
			const fleet = await api.setActiveFleetDeployment(button.dataset.itemId);
			if (deployment) {
				selectedBotId = deployment.botTypeId;
				window.localStorage.setItem(SELECTED_BOT_KEY, selectedBotId);
				databaseView = null;
				fleetBackupState = [];
			}
			renderFleet(fleet);
			return { message: "Active deployment changed." };
		});
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
		runAction("Refresh diagnostics", selectedBotId === HACHI_BOT_ID ? loadDiagnostics : refreshFleetOverview);
		return;
	}

	if (action === "copy-diagnostic-info") {
		runAction("Copy diagnostic info", () => api.copyDiagnosticInfo(selectedBotId === HACHI_BOT_ID ? "" : selectedBotId));
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
		if (externalDeployment) {
			runAction("Copy sensitive configuration", () => api.copyFleetConfigurationSecret(externalDeployment.id, button.dataset.configPath, button.dataset.configKey));
			return;
		}

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
		// Dashboard shortcut to the Hachi page.
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

	if (action === "rotate-fleet-backups") {
		showConfirmModal({
			confirmText: "Rotate Backups",
			details: [
				"Each HachiGen-managed backup will receive a new independent encryption key.",
				"Backup contents and retention are unchanged.",
				"A failed vault or file commit restores the previous protected key.",
			],
			meta: "Selected bot backup key maintenance",
			summary: "Rotate encryption keys for this installation's managed backups?",
			title: "Rotate database backup keys?",
			variant: "warning",
		}).then(confirmed => {
			if (confirmed) runAction("Rotate database backups", () => api.rotateFleetBackupKeys(selectedBotId));
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

			runAction("Export database key backup", () => api.exportDatabaseKeyBackup(selectedBotId === HACHI_BOT_ID ? "" : selectedBotId));
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
		runAction("Refresh", () => (externalDeployment ? refreshFleetOverview() : refreshState()).then(() => ({ message: "State refreshed." })));
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
		runAction("Open folder", () => externalDeployment ? api.openFleetDeploymentFolder(externalDeployment.id) : api.openInstallFolder());
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
	const externalDeployment = selectedBotId !== HACHI_BOT_ID ? selectedFleetDeployment() : null;
	if (externalDeployment) {
		runAction("Save bot configuration", () => saveExternalConfiguration(externalDeployment));
		return;
	}
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
	$("#testingProfileForm")?.addEventListener("submit", handleTestingProfileSubmit);

	api.onEvent(event => {
		// Live backend events arrive here while commands are running.
		handleHachiGenUpdateWizardEvent(event);
		appendEvent(event);
	});

	api.onMenuAction(handleMenuAction);

	// First render uses only manager-owned local state. Expensive bot, Git, SSH,
	// database, configuration, log, and testing reads follow the selected context.
	renderViews();
	const startupState = await api.getStartupState();
	state = startupState;
	renderFleet(startupState.fleet);
	if (selectedBotId === HACHI_BOT_ID) {
		await refreshState();
		setTimeout(() => checkUpdatesOnStartup(), 1200);
	} else {
		await refreshFleetOverview();
	}
}

// Packaged smoke mode calls this after the page loads. It exercises shared
// navigation and verifies the controls needed by the selected-bot workflows.
window.__runHachiGenUiSmoke = () => {
	const checks = [
		["global bot selector", Boolean($("#globalBotSelect"))],
		["shared configuration form", Boolean($("#configForm") && $("#externalConfigurationFields"))],
		["local runtime target", Boolean($('input[name="runtimeTarget"][value="local"]'))],
		["remote runtime target", Boolean($('input[name="runtimeTarget"][value="remote"]'))],
		["remote save and test", Boolean($("#saveRemoteSettingsButton") && $("#testRemoteButton"))],
		["testing selectors", Boolean($("#testingIdentitySelect") && $("#testingDeploymentSelect"))],
		["testing process controls", Boolean($('[data-action="start-testing-bot"]') && $('[data-action="stop-testing-bot"]'))],
	];
	for (const view of ["dashboard", "setup", "fleet", "testing"]) {
		showView(view);
		checks.push([`${view} navigation`, Boolean($(`[data-view-panel="${view}"]`)?.classList.contains("active"))]);
	}
	showView("dashboard");
	const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
	return { checks: checks.length, failures, ok: failures.length === 0 };
};

init();
