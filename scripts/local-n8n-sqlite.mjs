#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith('--')) continue;
		const key = token.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			args[key] = 'true';
		} else {
			args[key] = next;
			i++;
		}
	}
	return args;
}

async function readEnvFile(envFile) {
	const content = await fs.readFile(envFile, 'utf8');
	const values = {};
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const [key, ...rest] = line.split('=');
		values[key] = rest.join('=');
	}
	return values;
}

function openDatabase(filename) {
	return new Promise((resolve, reject) => {
		const db = new sqlite3.Database(filename, (error) => {
			if (error) reject(error);
			else resolve(db);
		});
	});
}

function run(db, sql, params = []) {
	return new Promise((resolve, reject) => {
		db.run(sql, params, function onRun(error) {
			if (error) reject(error);
			else resolve(this);
		});
	});
}

function get(db, sql, params = []) {
	return new Promise((resolve, reject) => {
		db.get(sql, params, (error, row) => {
			if (error) reject(error);
			else resolve(row);
		});
	});
}

async function close(db) {
	return new Promise((resolve, reject) => {
		db.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

async function withDatabase(envFile, callback) {
	const env = await readEnvFile(envFile);
	const dbPath = env.DB_SQLITE_DATABASE;
	if (!dbPath) throw new Error(`DB_SQLITE_DATABASE is missing in ${envFile}`);

	const resolvedDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(path.dirname(envFile), dbPath);
	const db = await openDatabase(resolvedDbPath);
	try {
		return await callback(db);
	} finally {
		await close(db);
	}
}

async function upsertSetting(db, key, value) {
	await run(
		db,
		`INSERT INTO settings (key, value, loadOnStartup)
		 VALUES (?, ?, 1)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, loadOnStartup = excluded.loadOnStartup`,
		[key, value],
	);
}

async function commandSetSetting(args) {
	await withDatabase(args['env-file'], async (db) => {
		await upsertSetting(db, args.key, args.value);
	});
}

async function commandSetInstanceAiDefaults(args) {
	await withDatabase(args['env-file'], async (db) => {
		const user = args['user-email']
			? await get(db, 'SELECT id FROM user WHERE email = ? ORDER BY createdAt ASC LIMIT 1', [args['user-email']])
			: await get(db, 'SELECT id FROM user ORDER BY createdAt ASC LIMIT 1');
		if (!user) throw new Error('No n8n user found yet. Complete owner setup first.');

		const credential = await get(
			db,
			'SELECT id FROM credentials_entity WHERE name = ? AND type = ? ORDER BY createdAt ASC LIMIT 1',
			[args['credential-name'], args['credential-type'] ?? 'openRouterApi'],
		);
		if (!credential) {
			throw new Error(`Credential "${args['credential-name']}" (${args['credential-type'] ?? 'openRouterApi'}) was not found.`);
		}

		await upsertSetting(
			db,
			`instanceAi.preferences.${user.id}`,
			JSON.stringify({
				credentialId: credential.id,
				modelName: args['model-name'] ?? 'x-ai/grok-4.1-fast',
			}),
		);
	});
}

async function commandSetWorkflowMcpAccess(args) {
	await withDatabase(args['env-file'], async (db) => {
		const enabled = args.enabled !== 'false';
		const workflow = args['workflow-id']
			? await get(db, 'SELECT id, settings FROM workflow_entity WHERE id = ?', [args['workflow-id']])
			: await get(db, 'SELECT id, settings FROM workflow_entity WHERE name = ?', [args['workflow-name']]);

		if (!workflow) throw new Error('Workflow was not found.');

		const settings = workflow.settings ? JSON.parse(workflow.settings) : {};
		settings.availableInMCP = enabled;

		await run(db, 'UPDATE workflow_entity SET settings = ? WHERE id = ?', [
			JSON.stringify(settings),
			workflow.id,
		]);
	});
}

const args = parseArgs(process.argv.slice(2));
const command = args.command;

if (!command) {
	console.error('Missing --command');
	process.exit(1);
}

try {
	switch (command) {
		case 'set-setting':
			if (!args['env-file'] || !args.key || args.value === undefined) {
				throw new Error('set-setting requires --env-file, --key, and --value');
			}
			await commandSetSetting(args);
			break;
		case 'set-instance-ai-defaults':
			if (!args['env-file'] || !args['credential-name']) {
				throw new Error('set-instance-ai-defaults requires --env-file and --credential-name');
			}
			await commandSetInstanceAiDefaults(args);
			break;
		case 'set-workflow-mcp-access':
			if (!args['env-file'] || (!args['workflow-id'] && !args['workflow-name'])) {
				throw new Error(
					'set-workflow-mcp-access requires --env-file and either --workflow-id or --workflow-name',
				);
			}
			await commandSetWorkflowMcpAccess(args);
			break;
		default:
			throw new Error(`Unknown command: ${command}`);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
