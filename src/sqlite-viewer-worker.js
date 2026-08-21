const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const VIEW_ROW_LIMIT = 200;

function quoteIdentifier(value) {
	return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

function jsonValue(value) {
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (value instanceof Uint8Array) {
		return `[binary ${value.byteLength} bytes]`;
	}
	return value;
}

function main() {
	const request = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
	const root = path.resolve(request.root || ".");
	const dbPath = path.resolve(root, request.dbPath || "");
	const relative = path.relative(root, dbPath);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(dbPath)) {
		throw new Error("Database path is missing or outside the deployment root.");
	}
	const database = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
		const metadata = tables.map(({ name }) => {
			const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all().map(column => String(column.name));
			const count = Number(database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get().count || 0);
			return { columns, name: String(name), rowCount: count };
		});
		const names = metadata.map(table => table.name);
		const selectedTable = names.includes(request.table) ? request.table : names[0] || "";
		const selected = metadata.find(table => table.name === selectedTable);
		const sortColumn = selected?.columns.includes(request.sort?.column) ? request.sort.column : "";
		const sortDirection = ["asc", "desc"].includes(request.sort?.direction) ? request.sort.direction : "";
		const order = sortColumn && sortDirection ? ` ORDER BY ${quoteIdentifier(sortColumn)} ${sortDirection.toUpperCase()}` : "";
		const rows = selectedTable ? database.prepare(`SELECT * FROM ${quoteIdentifier(selectedTable)}${order} LIMIT ?`).all(VIEW_ROW_LIMIT) : [];
		process.stdout.write(JSON.stringify({
			columns: selected?.columns || [],
			limit: VIEW_ROW_LIMIT,
			ok: true,
			rows: rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, jsonValue(value)]))),
			selectedTable,
			sortColumn,
			sortDirection,
			tables: metadata,
			totalRows: selected?.rowCount || 0,
		}));
	} finally {
		database.close();
	}
}

try {
	main();
} catch (error) {
	process.stdout.write(JSON.stringify({ error: error.message, ok: false }));
}
