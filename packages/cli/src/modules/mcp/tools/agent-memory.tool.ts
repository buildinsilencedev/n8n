import type { DataTableFilter } from '@n8n/api-types';
import type { User } from '@n8n/db';
import z from 'zod';

import { USER_CALLED_MCP_TOOL_EVENT } from '../mcp.constants';
import type { ToolDefinition, UserCalledMCPToolEventPayload } from '../mcp.types';

import type { DataTableUserOperations } from '@/modules/data-table/data-table-proxy.service';
import type { Telemetry } from '@/telemetry';

const AGENT_MEMORY_TABLE_NAME = '__agent_memory';

const AGENT_MEMORY_COLUMNS = [
	{ name: 'entity_id', type: 'string' as const },
	{ name: 'entity_type', type: 'string' as const },
	{ name: 'entity_name', type: 'string' as const },
	{ name: 'event_type', type: 'string' as const },
	{ name: 'event_date', type: 'date' as const },
	{ name: 'outcome', type: 'string' as const },
	{ name: 'notes', type: 'string' as const },
	{ name: 'next_action_date', type: 'string' as const },
];

async function findMemoryTable(
	dataTableOps: DataTableUserOperations,
): Promise<{ id: string; projectId: string } | null> {
	const result = await dataTableOps.getManyAndCount({
		take: 5,
		filter: { name: AGENT_MEMORY_TABLE_NAME },
	});
	const table = result.data.find((t) => t.name === AGENT_MEMORY_TABLE_NAME);
	return table ? { id: table.id, projectId: table.projectId } : null;
}

async function findOrCreateMemoryTable(
	dataTableOps: DataTableUserOperations,
	projectId: string,
): Promise<{ id: string; projectId: string }> {
	const existing = await findMemoryTable(dataTableOps);
	if (existing) return existing;

	try {
		const created = await dataTableOps.createDataTable(projectId, {
			name: AGENT_MEMORY_TABLE_NAME,
			columns: AGENT_MEMORY_COLUMNS,
		});
		return { id: created.id, projectId: created.projectId };
	} catch {
		// Concurrent creation — retry the lookup once
		const retry = await findMemoryTable(dataTableOps);
		if (retry) return retry;
		throw new Error('Failed to create agent memory table');
	}
}

// ── store ──────────────────────────────────────────────────────────────────────

const storeInputSchema = {
	project_id: z
		.string()
		.optional()
		.describe(
			'Project ID for the agent memory table. Required on first use to create the table. Use search_projects to find it.',
		),
	entity_id: z
		.string()
		.describe('Stable unique identifier for the entity (e.g. email, domain, lead ID)'),
	entity_type: z.string().describe('Entity category, e.g. "lead", "company", "contact"'),
	entity_name: z.string().describe('Human-readable entity name'),
	event_type: z
		.string()
		.describe('Event category (e.g. "contacted", "replied", "declined", "meeting_scheduled")'),
	event_date: z.string().describe('ISO 8601 date (YYYY-MM-DD) when the event occurred'),
	outcome: z.string().describe('Result of the interaction'),
	notes: z.string().describe('Additional context or free-form notes'),
	next_action_date: z
		.string()
		.describe('ISO 8601 date (YYYY-MM-DD) for next follow-up, or empty string if none scheduled'),
} satisfies z.ZodRawShape;

const storeOutputSchema = {
	success: z.boolean(),
	error: z.string().optional(),
} satisfies z.ZodRawShape;

export const createAgentMemoryStoreTool = (
	user: User,
	dataTableOps: DataTableUserOperations,
	telemetry: Telemetry,
): ToolDefinition<typeof storeInputSchema> => ({
	name: 'agent_memory_store',
	config: {
		description:
			'Store a CRM interaction event for an entity in persistent agent memory. ' +
			'The __agent_memory table is created automatically on first call (requires project_id). ' +
			'Subsequent calls auto-discover the table — project_id is not needed once it exists.',
		inputSchema: storeInputSchema,
		outputSchema: storeOutputSchema,
		annotations: {
			title: 'Agent Memory: Store Event',
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false,
		},
	},
	handler: async ({
		project_id,
		entity_id,
		entity_type,
		entity_name,
		event_type,
		event_date,
		outcome,
		notes,
		next_action_date,
	}: {
		project_id?: string;
		entity_id: string;
		entity_type: string;
		entity_name: string;
		event_type: string;
		event_date: string;
		outcome: string;
		notes: string;
		next_action_date: string;
	}) => {
		const telemetryPayload: UserCalledMCPToolEventPayload = {
			user_id: user.id,
			tool_name: 'agent_memory_store',
			parameters: { entity_type, event_type },
		};

		try {
			let tableRef: { id: string; projectId: string };

			if (project_id) {
				tableRef = await findOrCreateMemoryTable(dataTableOps, project_id);
			} else {
				const found = await findMemoryTable(dataTableOps);
				if (!found) {
					const output = {
						success: false,
						error:
							'Agent memory table not found. Provide project_id on first call to create it. ' +
							'Use search_projects to find your project ID.',
					};
					return {
						content: [{ type: 'text' as const, text: JSON.stringify(output) }],
						structuredContent: output,
						isError: true,
					};
				}
				tableRef = found;
			}

			await dataTableOps.insertRows(
				tableRef.id,
				tableRef.projectId,
				[
					{
						entity_id,
						entity_type,
						entity_name,
						event_type,
						event_date,
						outcome,
						notes,
						next_action_date,
					},
				],
				'count',
			);

			const output = { success: true };
			telemetryPayload.results = { success: true };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			telemetryPayload.results = { success: false, error: errorMessage };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			const output = { success: false, error: errorMessage };
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
				isError: true,
			};
		}
	},
});

// ── recall ─────────────────────────────────────────────────────────────────────

const recallInputSchema = {
	entity_id: z
		.string()
		.optional()
		.describe('Stable unique identifier for the entity (e.g. email, domain, lead ID)'),
	entity_name: z.string().optional().describe('Human-readable entity name (partial match)'),
} satisfies z.ZodRawShape;

const eventsOutputSchema = {
	events: z.array(z.record(z.unknown())).describe('Matching interaction events'),
	count: z.number().int().min(0),
	error: z.string().optional(),
} satisfies z.ZodRawShape;

export const createAgentMemoryRecallTool = (
	user: User,
	dataTableOps: DataTableUserOperations,
	telemetry: Telemetry,
): ToolDefinition<typeof recallInputSchema> => ({
	name: 'agent_memory_recall',
	config: {
		description:
			'Retrieve all recorded interaction events for a specific entity from agent memory. ' +
			'Filter by entity_id (exact) or entity_name (partial). Returns empty if no memory table exists yet.',
		inputSchema: recallInputSchema,
		outputSchema: eventsOutputSchema,
		annotations: {
			title: 'Agent Memory: Recall Entity',
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
	},
	handler: async ({ entity_id, entity_name }: { entity_id?: string; entity_name?: string }) => {
		const telemetryPayload: UserCalledMCPToolEventPayload = {
			user_id: user.id,
			tool_name: 'agent_memory_recall',
			parameters: { hasEntityId: !!entity_id, hasEntityName: !!entity_name },
		};

		try {
			const tableRef = await findMemoryTable(dataTableOps);
			if (!tableRef) {
				const output = { events: [], count: 0 };
				telemetryPayload.results = { success: true, data: { count: 0 } };
				telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(output) }],
					structuredContent: output,
				};
			}

			const conditions: DataTableFilter['filters'] = [];
			if (entity_id) {
				conditions.push({ columnName: 'entity_id', condition: 'eq', value: entity_id });
			}
			if (entity_name) {
				conditions.push({ columnName: 'entity_name', condition: 'like', value: entity_name });
			}

			const filter: DataTableFilter | undefined =
				conditions.length > 0 ? { type: 'and', filters: conditions } : undefined;

			const result = await dataTableOps.getManyRowsAndCount(tableRef.id, tableRef.projectId, {
				filter,
				take: 100,
			});

			const output = { events: result.data, count: result.count };
			telemetryPayload.results = { success: true, data: { count: result.count } };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			telemetryPayload.results = { success: false, error: errorMessage };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			const output = { events: [], count: 0, error: errorMessage };
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
				isError: true,
			};
		}
	},
});

// ── search ─────────────────────────────────────────────────────────────────────

const searchInputSchema = {
	entity_type: z.string().optional().describe('Entity category, e.g. "lead", "company", "contact"'),
	event_type: z
		.string()
		.optional()
		.describe('Event category (e.g. "contacted", "replied", "declined", "meeting_scheduled")'),
	from_date: z
		.string()
		.optional()
		.describe('ISO date (YYYY-MM-DD) — include events on or after this date'),
	to_date: z
		.string()
		.optional()
		.describe('ISO date (YYYY-MM-DD) — include events on or before this date'),
	limit: z
		.number()
		.int()
		.positive()
		.max(100)
		.optional()
		.describe('Max results to return (default 50)'),
} satisfies z.ZodRawShape;

export const createAgentMemorySearchTool = (
	user: User,
	dataTableOps: DataTableUserOperations,
	telemetry: Telemetry,
): ToolDefinition<typeof searchInputSchema> => ({
	name: 'agent_memory_search',
	config: {
		description:
			'Search agent memory events by date range, entity type, or event type. ' +
			'All filters are optional and combined with AND logic.',
		inputSchema: searchInputSchema,
		outputSchema: eventsOutputSchema,
		annotations: {
			title: 'Agent Memory: Search Events',
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
	},
	handler: async ({
		entity_type,
		event_type,
		from_date,
		to_date,
		limit = 50,
	}: {
		entity_type?: string;
		event_type?: string;
		from_date?: string;
		to_date?: string;
		limit?: number;
	}) => {
		const telemetryPayload: UserCalledMCPToolEventPayload = {
			user_id: user.id,
			tool_name: 'agent_memory_search',
			parameters: { entity_type, event_type, from_date, to_date, limit },
		};

		try {
			const tableRef = await findMemoryTable(dataTableOps);
			if (!tableRef) {
				const output = { events: [], count: 0 };
				telemetryPayload.results = { success: true, data: { count: 0 } };
				telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(output) }],
					structuredContent: output,
				};
			}

			const conditions: DataTableFilter['filters'] = [];
			if (entity_type) {
				conditions.push({ columnName: 'entity_type', condition: 'eq', value: entity_type });
			}
			if (event_type) {
				conditions.push({ columnName: 'event_type', condition: 'eq', value: event_type });
			}
			if (from_date) {
				conditions.push({ columnName: 'event_date', condition: 'gte', value: from_date });
			}
			if (to_date) {
				conditions.push({ columnName: 'event_date', condition: 'lte', value: to_date });
			}

			const filter: DataTableFilter | undefined =
				conditions.length > 0 ? { type: 'and', filters: conditions } : undefined;

			const result = await dataTableOps.getManyRowsAndCount(tableRef.id, tableRef.projectId, {
				filter,
				take: Math.min(limit, 100),
			});

			const output = { events: result.data, count: result.count };
			telemetryPayload.results = { success: true, data: { count: result.count } };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			telemetryPayload.results = { success: false, error: errorMessage };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			const output = { events: [], count: 0, error: errorMessage };
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
				isError: true,
			};
		}
	},
});

// ── suggest-followup ───────────────────────────────────────────────────────────

const suggestFollowupInputSchema = {
	as_of_date: z
		.string()
		.optional()
		.describe('Reference date in ISO format (YYYY-MM-DD). Defaults to today.'),
	limit: z
		.number()
		.int()
		.positive()
		.max(100)
		.optional()
		.describe('Max results to return (default 50)'),
} satisfies z.ZodRawShape;

const entitiesOutputSchema = {
	entities: z.array(z.record(z.unknown())).describe('Entities with overdue follow-ups'),
	count: z.number().int().min(0),
	error: z.string().optional(),
} satisfies z.ZodRawShape;

export const createAgentMemorySuggestFollowupTool = (
	user: User,
	dataTableOps: DataTableUserOperations,
	telemetry: Telemetry,
): ToolDefinition<typeof suggestFollowupInputSchema> => ({
	name: 'agent_memory_suggest_followup',
	config: {
		description:
			'List entities whose next follow-up date is today or earlier. ' +
			'Use this to find leads or contacts that need attention.',
		inputSchema: suggestFollowupInputSchema,
		outputSchema: entitiesOutputSchema,
		annotations: {
			title: 'Agent Memory: Suggest Follow-ups',
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
	},
	handler: async ({ as_of_date, limit = 50 }: { as_of_date?: string; limit?: number }) => {
		const telemetryPayload: UserCalledMCPToolEventPayload = {
			user_id: user.id,
			tool_name: 'agent_memory_suggest_followup',
			parameters: { as_of_date, limit },
		};

		try {
			const tableRef = await findMemoryTable(dataTableOps);
			if (!tableRef) {
				const output = { entities: [], count: 0 };
				telemetryPayload.results = { success: true, data: { count: 0 } };
				telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(output) }],
					structuredContent: output,
				};
			}

			const asOfDate = as_of_date ?? new Date().toISOString().slice(0, 10);
			const filter: DataTableFilter = {
				type: 'and',
				filters: [
					{ columnName: 'next_action_date', condition: 'lte', value: asOfDate },
					{ columnName: 'next_action_date', condition: 'neq', value: '' },
				],
			};

			const result = await dataTableOps.getManyRowsAndCount(tableRef.id, tableRef.projectId, {
				filter,
				take: Math.min(limit, 100),
			});

			const output = { entities: result.data, count: result.count };
			telemetryPayload.results = { success: true, data: { count: result.count } };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			telemetryPayload.results = { success: false, error: errorMessage };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			const output = { entities: [], count: 0, error: errorMessage };
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
				isError: true,
			};
		}
	},
});
