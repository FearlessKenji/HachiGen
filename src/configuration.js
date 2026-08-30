const fs = require("node:fs");

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

function parseDotEnvContent(content) {
	const values = {};
	for (const line of String(content || "").split(/\r?\n/u)) {
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
	return fs.existsSync(filePath) ? parseDotEnvContent(fs.readFileSync(filePath, "utf8")) : {};
}

function formatEnvValue(value) {
	return JSON.stringify(String(value || ""));
}

function updateDotEnvContent(content, values) {
	const pending = new Map(Object.entries(values));
	const output = [];
	for (const line of String(content || "").split(/\r?\n/u)) {
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

module.exports = {
	flattenConfigValues,
	formatEnvValue,
	isSensitiveConfigKey,
	parseDotEnv,
	parseDotEnvContent,
	setConfigValue,
	updateDotEnvContent,
};
