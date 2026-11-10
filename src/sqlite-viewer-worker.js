const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

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

function readRequest() {
	return new Promise((resolve, reject) => {
		let input = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", chunk => {
			input += chunk;
		});
		process.stdin.on("end", () => resolve(JSON.parse(input || "{}")));
		process.stdin.on("error", reject);
	});
}

async function openDatabase(root, dbPath) {
	// Newer Node releases bundle SQLite. Older supported bot installs can use
	// their own SQLite driver; HachiGen does not copy native binaries over SSH.
	let DatabaseSync;
	try {
		({ DatabaseSync } = require("node:sqlite"));
	} catch {
		// Node 20 and early Node 22 releases do not expose node:sqlite.
	}
	if (DatabaseSync) {
		const database = new DatabaseSync(dbPath, { readOnly: true });
		return {
			all: (sql, params = []) => database.prepare(sql).all(...params),
			close: () => database.close(),
			exec: sql => database.exec(sql),
			get: (sql, params = []) => database.prepare(sql).get(...params),
		};
	}
	const requireBot = createRequire(path.join(root, "package.json"));
	for (const packageName of ["better-sqlite3", "better-sqlite3-multiple-ciphers"]) {
		let Driver;
		try {
			Driver = requireBot(packageName);
		} catch (error) {
			if (error.code !== "MODULE_NOT_FOUND" || !error.message.includes(`'${packageName}'`)) {
				throw error;
			}
			continue;
		}
		const database = new Driver(dbPath, { fileMustExist: true, readonly: true });
		return {
			all: (sql, params = []) => database.prepare(sql).all(...params),
			close: () => database.close(),
			exec: sql => database.exec(sql),
			get: (sql, params = []) => database.prepare(sql).get(...params),
		};
	}
	let sqlite3;
	try {
		sqlite3 = requireBot("sqlite3");
	} catch (error) {
		if (error.code !== "MODULE_NOT_FOUND" || !error.message.includes("'sqlite3'")) {
			throw error;
		}
		throw new Error("Generic database viewing and snapshots require Node.js 22.13 or newer, or a SQLite driver installed by this bot.");
	}
	const database = await new Promise((resolve, reject) => {
		const connection = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, error =>
			error ? reject(error) : resolve(connection));
	});
	return {
		all: (sql, params = []) => new Promise((resolve, reject) => {
			database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
		}),
		close: () => new Promise((resolve, reject) => {
			database.close(error => error ? reject(error) : resolve());
		}),
		exec: sql => new Promise((resolve, reject) => {
			database.exec(sql, error => error ? reject(error) : resolve());
		}),
		get: (sql, params = []) => new Promise((resolve, reject) => {
			database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
		}),
	};
}

async function main() {
	// SSH can expose stdin as a temporarily non-blocking handle on Windows.
	// Stream it asynchronously instead of using readFileSync(0), which can throw EAGAIN.
	const request = await readRequest();
	const root = path.resolve(request.root || ".");
	const dbPath = path.resolve(root, request.dbPath || "");
	const relative = path.relative(root, dbPath);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(dbPath)) {
		throw new Error("Database path is missing or outside the deployment root.");
	}
	const database = await openDatabase(root, dbPath);
	try {
		if (request.action === "snapshot") {
			await database.exec("BEGIN");
			try {
				// A read transaction holds a SHARED lock while the main file is
				// copied. This is safe only for rollback-journal databases.
				await database.get("SELECT name FROM sqlite_master LIMIT 1");
				const journalMode = String((await database.get("PRAGMA journal_mode"))?.journal_mode || "").toLowerCase();
				if (!["delete", "truncate", "persist"].includes(journalMode)) {
					throw new Error(`A consistent byte-preserving snapshot is unavailable in ${journalMode || "unknown"} journal mode.`);
				}
				const content = fs.readFileSync(dbPath);
				process.stdout.write(JSON.stringify({ bytes: content.length, content: content.toString("base64"), journalMode, ok: true }));
			} finally {
				await database.exec("ROLLBACK");
			}
			return;
		}
		const tables = await database.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
		const metadata = [];
		for (const { name } of tables) {
			const columns = (await database.all(`PRAGMA table_info(${quoteIdentifier(name)})`)).map(column => String(column.name));
			const count = Number((await database.get(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`))?.count || 0);
			metadata.push({ columns, name: String(name), rowCount: count });
		}
		const names = metadata.map(table => table.name);
		const selectedTable = names.includes(request.table) ? request.table : names[0] || "";
		const selected = metadata.find(table => table.name === selectedTable);
		const sortColumn = selected?.columns.includes(request.sort?.column) ? request.sort.column : "";
		const sortDirection = ["asc", "desc"].includes(request.sort?.direction) ? request.sort.direction : "";
		const order = sortColumn && sortDirection ? ` ORDER BY ${quoteIdentifier(sortColumn)} ${sortDirection.toUpperCase()}` : "";
		const rows = selectedTable ? await database.all(`SELECT * FROM ${quoteIdentifier(selectedTable)}${order} LIMIT ?`, [VIEW_ROW_LIMIT]) : [];
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
		await database.close();
	}
}

main().catch(error => {
	process.stdout.write(JSON.stringify({ error: error.message, ok: false }));
});
