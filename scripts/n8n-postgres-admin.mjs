#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

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

function mergeEnv(fileValues = {}) {
	return {
		...process.env,
		...fileValues,
	};
}

function quoteIdentifier(identifier) {
	return `"${String(identifier).replace(/"/g, '""')}"`;
}

function tableName(env, baseName) {
	return `${env.DB_TABLE_PREFIX ?? ''}${baseName}`;
}

function qualifiedTable(env, baseName) {
	const schema = env.DB_POSTGRESDB_SCHEMA || 'public';
	return `${quoteIdentifier(schema)}.${quoteIdentifier(tableName(env, baseName))}`;
}

function parseSsl(env) {
	if (env.DB_POSTGRESDB_SSL_ENABLED !== 'true') return undefined;

	return {
		ca: env.DB_POSTGRESDB_SSL_CA || undefined,
		cert: env.DB_POSTGRESDB_SSL_CERT || undefined,
		key: env.DB_POSTGRESDB_SSL_KEY || undefined,
		rejectUnauthorized: env.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED !== 'false',
	};
}

function getConnectionConfig(env) {
	if (env.DATABASE_URL) {
		return {
			connectionString: env.DATABASE_URL,
			ssl: parseSsl(env),
		};
	}

	return {
		host: env.DB_POSTGRESDB_HOST,
		port: Number(env.DB_POSTGRESDB_PORT || 5432),
		database: env.DB_POSTGRESDB_DATABASE,
		user: env.DB_POSTGRESDB_USER,
		password: env.DB_POSTGRESDB_PASSWORD,
		ssl: parseSsl(env),
	};
}

function parseMaybeJson(value) {
	if (value == null) return {};
	if (typeof value === 'object') return value;
	try {
		return JSON.parse(value);
	} catch {
		return {};
	}
}

async function withClient(args, callback) {
	const fileValues = args['env-file'] ? await readEnvFile(args['env-file']) : {};
	const env = mergeEnv(fileValues);
	const client = new pg.Client(getConnectionConfig(env));
	await client.connect();
	try {
		return await callback(client, env);
	} finally {
		await client.end();
	}
}

async function upsertSetting(client, env, key, value) {
	await client.query(
		`INSERT INTO ${qualifiedTable(env, 'settings')} ("key", "value", "loadOnStartup")
		 VALUES ($1, $2, true)
		 ON CONFLICT ("key")
		 DO UPDATE SET "value" = EXCLUDED."value", "loadOnStartup" = EXCLUDED."loadOnStartup"`,
		[key, value],
	);
}

async function commandSetSetting(args) {
	await withClient(args, async (client, env) => {
		await upsertSetting(client, env, args.key, args.value);
	});
}

async function commandSetInstanceAiDefaults(args) {
	await withClient(args, async (client, env) => {
		const userTable = qualifiedTable(env, 'user');
		const credentialsTable = qualifiedTable(env, 'credentials_entity');

		const userResult = args['user-email']
			? await client.query(
					`SELECT "id"
					 FROM ${userTable}
					 WHERE "email" = $1
					 ORDER BY "createdAt" ASC
					 LIMIT 1`,
					[args['user-email'].toLowerCase()],
				)
			: await client.query(
					`SELECT "id"
					 FROM ${userTable}
					 ORDER BY "createdAt" ASC
					 LIMIT 1`,
				);

		if (userResult.rowCount === 0) {
			throw new Error('No n8n user found yet. Complete owner setup first.');
		}

		const credentialType = args['credential-type'] ?? 'openRouterApi';
		const credentialResult = await client.query(
			`SELECT "id"
			 FROM ${credentialsTable}
			 WHERE "name" = $1 AND "type" = $2
			 ORDER BY "createdAt" ASC
			 LIMIT 1`,
			[args['credential-name'], credentialType],
		);

		if (credentialResult.rowCount === 0) {
			throw new Error(
				`Credential "${args['credential-name']}" (${credentialType}) was not found.`,
			);
		}

		await upsertSetting(
			client,
			env,
			`instanceAi.preferences.${userResult.rows[0].id}`,
			JSON.stringify({
				credentialId: credentialResult.rows[0].id,
				modelName: args['model-name'] ?? 'x-ai/grok-4.1-fast',
			}),
		);
	});
}

async function commandSetWorkflowMcpAccess(args) {
	await withClient(args, async (client, env) => {
		const workflowTable = qualifiedTable(env, 'workflow_entity');
		const workflowResult = args['workflow-id']
			? await client.query(
					`SELECT "id", "settings"
					 FROM ${workflowTable}
					 WHERE "id" = $1`,
					[args['workflow-id']],
				)
			: await client.query(
					`SELECT "id", "settings"
					 FROM ${workflowTable}
					 WHERE "name" = $1`,
					[args['workflow-name']],
				);

		if (workflowResult.rowCount === 0) {
			throw new Error('Workflow was not found.');
		}

		const enabled = args.enabled !== 'false';
		const workflowSettings = parseMaybeJson(workflowResult.rows[0].settings);
		workflowSettings.availableInMCP = enabled;

		await client.query(
			`UPDATE ${workflowTable}
			 SET "settings" = $1::json
			 WHERE "id" = $2`,
			[JSON.stringify(workflowSettings), workflowResult.rows[0].id],
		);
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
			if (!args.key || args.value === undefined) {
				throw new Error('set-setting requires --key and --value');
			}
			await commandSetSetting(args);
			break;
		case 'set-instance-ai-defaults':
			if (!args['credential-name']) {
				throw new Error('set-instance-ai-defaults requires --credential-name');
			}
			await commandSetInstanceAiDefaults(args);
			break;
		case 'set-workflow-mcp-access':
			if (!args['workflow-id'] && !args['workflow-name']) {
				throw new Error(
					'set-workflow-mcp-access requires either --workflow-id or --workflow-name',
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
