#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = require(path.join(projectRoot, "package.json"));
const installerName = `HachiGen-Setup-${packageJson.version}.exe`;
const sourcePath = path.join(projectRoot, "dist", installerName);
const targetPath = path.join(projectRoot, installerName);

if (!fs.existsSync(sourcePath)) {
	console.error(`Installer not found: ${sourcePath}`);
	console.error("Run npm run dist or npm run dist:installer first.");
	process.exit(1);
}

// Keep a root-level copy because cloned users should see the installer without
// knowing Electron Builder's dist folder convention.
fs.copyFileSync(sourcePath, targetPath);
// Leave only the current version at the root so cloned users do not see stale
// installer choices after a release bump.
for (const entry of fs.readdirSync(projectRoot)) {
	if (/^HachiGen-Setup-.+\.exe$/u.test(entry) && entry !== installerName) {
		fs.unlinkSync(path.join(projectRoot, entry));
	}
}
console.log(`Root installer ready: ${targetPath}`);
