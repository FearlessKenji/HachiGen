#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const executableCandidates = [
	process.env.HACHIGEN_PACKAGED_EXE,
	path.join(projectRoot, "dist", "win-unpacked", "HachiGen.exe"),
	path.join(projectRoot, "dist", "HachiGen.exe"),
].filter(Boolean);
const executablePath = executableCandidates.find(candidate => fs.existsSync(candidate));
const timeoutMs = Number(process.env.HACHIGEN_UI_SMOKE_TIMEOUT_MS) || 30000;
const resultPath = path.join(os.tmpdir(), `hachigen-ui-smoke-${process.pid}.json`);

if (!executablePath) {
	console.error("Packaged UI smoke test could not find HachiGen.exe.");
	console.error("Set HACHIGEN_PACKAGED_EXE or run npm run dist first.");
	process.exit(1);
}

const child = childProcess.spawn(executablePath, [], {
	env: {
		...process.env,
		HACHIGEN_UI_SMOKE: "1",
		HACHIGEN_UI_SMOKE_RESULT: resultPath,
	},
	stdio: ["ignore", "pipe", "pipe"],
	windowsHide: true,
});
let output = "";
let finished = false;

const timeout = setTimeout(() => {
	if (finished) {
		return;
	}

	finished = true;
	child.kill("SIGKILL");
	console.error(`Packaged UI smoke test timed out after ${timeoutMs} ms.`);
	console.error(output.trim());
	process.exit(1);
}, timeoutMs);

child.stdout.on("data", chunk => {
	output += chunk.toString();
});

child.stderr.on("data", chunk => {
	output += chunk.toString();
});

child.on("error", error => {
	if (finished) {
		return;
	}

	finished = true;
	clearTimeout(timeout);
	console.error(`Packaged UI smoke test failed to launch: ${error.message}`);
	process.exit(1);
});

child.on("close", code => {
	if (finished) {
		return;
	}

	finished = true;
	clearTimeout(timeout);

	if (code !== 0) {
		console.error(`Packaged UI smoke test exited with code ${code}.`);
		console.error(output.trim());
		process.exit(code || 1);
	}
	const result = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, "utf8")) : null;
	fs.rmSync(resultPath, { force: true });
	if (!result?.ok) {
		console.error("Packaged UI smoke exited without completing renderer workflow checks.");
		console.error(result?.failures?.join("; ") || output.trim());
		process.exit(1);
	}

	console.log(`Packaged UI smoke test passed: ${path.basename(executablePath)} completed ${result.checks} renderer workflow checks.`);
});
