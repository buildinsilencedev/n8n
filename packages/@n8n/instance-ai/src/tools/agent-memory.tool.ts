/**
 * Cross-conversation CRM-style entity memory backed by a dedicated data table.
 * Auto-creates the `__agent_memory` table on first use. No HITL — internal bookkeeping.
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { sanitizeInputSchema } from '../agent/sanitize-mcp-schemas';
import type { DataTableFilterInput, DataTableSummary, InstanceAiContext } from '../types';

const AGENT_MEMORY_TABLE_NAME = '__agent_memory';

const AGENT_MEMORY_COLUMNS = [
	{ name: 'entity_id', type: 'string' as const },
	{ name: 'entity_type', type: 'string' as const },
	{ name: 'entity_name', type: 'string' as const },
	{ name: 'event_type', type: 'string' as const },
	{ name: 'event_date', type: 'date' as const },
	{ name: 'outcome', type: 'string' as const },
	{ name: 'notes', type: 'string' as const },
	// string (not date) so empty string is a valid "no follow-up" sentinel
	{ name: 'next_action_date', type: 'string' as const },
] as const;

function isNameConflictError(error: unknown): boolean {
	let current: unknown = error;
	while (current instanceof Error) {
		if (current.constructor.name === 'DataTableNameConflictError') return true;
		current = (current as Error & { cause?: unknown }).cause;
	}
	return false;
}

async function findOrCreateMemoryTable(
	context: InstanceAiContext,
): Promise<{ tableId: string } | { error: string }> {
	try {
		const tables = await context.dataTableService.list();
		const existing = tables.find((t: DataTableSummary) => t.name === AGENT_MEMORY_TABLE_NAME);
		if (existing) return { tableId: existing.id };

		try {
			const created = await context.dataTableService.create(AGENT_MEMORY_TABLE_NAME, [
				...AGENT_MEMORY_COLUMNS,
			]);
			return { tableId: created.id };
		} catch (createError) {
			if (isNameConflictError(createError)) {
				// Race condition — another call created the table first, retry
				const retryTables = await context.dataTableService.list();
				const retryExisting = retryTables.find(
					(t: DataTableSummary) => t.name === AGENT_MEMORY_TABLE_NAME,
				);
				if (retryExisting) return { tableId: retryExisting.id };
			}
			throw createError;
		}
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

// ── Shared field schemas ───────────────────────────────────────────────────────
// Descriptions must be identical across every action that uses the same field name,
// because sanitizeInputSchema rejects description mismatches in discriminated unions.

const entityIdField = z
	.string()
	.describe('Stable unique identifier for the entity (e.g. email, domain, lead ID)');
const entityNameField = z.string().describe('Human-readable entity name');
const entityTypeField = z.string().describe('Entity category, e.g. "lead", "company", "contact"');
const eventTypeField = z
	.string()
	.describe('Event category (e.g. "contacted", "replied", "declined", "meeting_scheduled")');
const limitField = z
	.number()
	.int()
	.positive()
	.max(100)
	.describe('Max results to return (default 50)');

// ── Action schemas ─────────────────────────────────────────────────────────────

const storeAction = z.object({
	action: z.literal('store').describe('Record a new interaction event for an entity'),
	entity_id: entityIdField,
	entity_type: entityTypeField,
	entity_name: entityNameField,
	event_type: eventTypeField,
	event_date: z.string().describe('ISO 8601 date (YYYY-MM-DD) when the event occurred'),
	outcome: z.string().describe('Result of the interaction'),
	notes: z.string().describe('Additional context or free-form notes'),
	next_action_date: z
		.string()
		.describe('ISO 8601 date (YYYY-MM-DD) for next follow-up, or empty string if none scheduled'),
});

const recallAction = z.object({
	action: z.literal('recall').describe('Retrieve all recorded events for a specific entity'),
	entity_id: entityIdField.optional(),
	entity_name: entityNameField.optional(),
});

const searchAction = z.object({
	action: z.literal('search').describe('Search events by date range, entity type, or event type'),
	entity_type: entityTypeField.optional(),
	event_type: eventTypeField.optional(),
	from_date: z.string().optional().describe('ISO date — include events on or after this date'),
	to_date: z.string().optional().describe('ISO date — include events on or before this date'),
	limit: limitField.optional(),
});

const suggestFollowupAction = z.object({
	action: z
		.literal('suggest-followup')
		.describe('List entities whose next_action_date is today or earlier (follow-ups due)'),
	as_of_date: z
		.string()
		.optional()
		.describe('Reference date in ISO format (YYYY-MM-DD). Defaults to today.'),
	limit: limitField.optional(),
});

const allActions = [storeAction, recallAction, searchAction, suggestFollowupAction] as const;
type FullInput = z.infer<z.ZodDiscriminatedUnion<'action', typeof allActions>>;

// ── Handlers ───────────────────────────────────────────────────────────────────

async function handleStore(
	context: InstanceAiContext,
	tableId: string,
	input: Extract<FullInput, { action: 'store' }>,
): Promise<{ success: boolean; error?: string }> {
	try {
		await context.dataTableService.insertRows(tableId, [
			{
				entity_id: input.entity_id,
				entity_type: input.entity_type,
				entity_name: input.entity_name,
				event_type: input.event_type,
				event_date: input.event_date,
				outcome: input.outcome,
				notes: input.notes,
				next_action_date: input.next_action_date,
			},
		]);
		return { success: true };
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
}

async function handleRecall(
	context: InstanceAiContext,
	tableId: string,
	input: Extract<FullInput, { action: 'recall' }>,
): Promise<{ events: Array<Record<string, unknown>>; count: number }> {
	const conditions: DataTableFilterInput['filters'] = [];
	if (input.entity_id) {
		conditions.push({ columnName: 'entity_id', condition: 'eq', value: input.entity_id });
	}
	if (input.entity_name) {
		conditions.push({ columnName: 'entity_name', condition: 'like', value: input.entity_name });
	}

	const filter: DataTableFilterInput | undefined =
		conditions.length > 0 ? { type: 'and', filters: conditions } : undefined;

	const result = await context.dataTableService.queryRows(tableId, { filter, limit: 100 });
	return { events: result.data, count: result.count };
}

async function handleSearch(
	context: InstanceAiContext,
	tableId: string,
	input: Extract<FullInput, { action: 'search' }>,
): Promise<{ events: Array<Record<string, unknown>>; count: number }> {
	const conditions: DataTableFilterInput['filters'] = [];
	if (input.entity_type) {
		conditions.push({ columnName: 'entity_type', condition: 'eq', value: input.entity_type });
	}
	if (input.event_type) {
		conditions.push({ columnName: 'event_type', condition: 'eq', value: input.event_type });
	}
	if (input.from_date) {
		conditions.push({ columnName: 'event_date', condition: 'gte', value: input.from_date });
	}
	if (input.to_date) {
		conditions.push({ columnName: 'event_date', condition: 'lte', value: input.to_date });
	}

	const filter: DataTableFilterInput | undefined =
		conditions.length > 0 ? { type: 'and', filters: conditions } : undefined;

	const result = await context.dataTableService.queryRows(tableId, {
		filter,
		limit: input.limit ?? 50,
	});
	return { events: result.data, count: result.count };
}

async function handleSuggestFollowup(
	context: InstanceAiContext,
	tableId: string,
	input: Extract<FullInput, { action: 'suggest-followup' }>,
): Promise<{ entities: Array<Record<string, unknown>>; count: number }> {
	const asOfDate = input.as_of_date ?? new Date().toISOString().slice(0, 10);
	const filter: DataTableFilterInput = {
		type: 'and',
		filters: [
			{ columnName: 'next_action_date', condition: 'lte', value: asOfDate },
			{ columnName: 'next_action_date', condition: 'neq', value: '' },
		],
	};

	const result = await context.dataTableService.queryRows(tableId, {
		filter,
		limit: input.limit ?? 50,
	});
	return { entities: result.data, count: result.count };
}

// ── Tool factory ───────────────────────────────────────────────────────────────

export function createAgentMemoryTool(context: InstanceAiContext) {
	const inputSchema = sanitizeInputSchema(z.discriminatedUnion('action', [...allActions]));

	return createTool({
		id: 'agent-memory',
		description:
			'Cross-conversation CRM-style entity memory. Store and recall interaction events ' +
			'(contacted, replied, declined, etc.) for leads, companies, or contacts. ' +
			'Persists across conversations. ' +
			'Use "store" to record events, "recall" to look up an entity\'s history, ' +
			'"search" to filter by date/type, and "suggest-followup" to find entities due for follow-up.',
		inputSchema,
		execute: async (input: FullInput) => {
			const tableResult = await findOrCreateMemoryTable(context);
			if ('error' in tableResult) {
				return { error: `Could not initialize agent memory storage: ${tableResult.error}` };
			}
			const { tableId } = tableResult;

			switch (input.action) {
				case 'store':
					return await handleStore(context, tableId, input);
				case 'recall':
					return await handleRecall(context, tableId, input);
				case 'search':
					return await handleSearch(context, tableId, input);
				case 'suggest-followup':
					return await handleSuggestFollowup(context, tableId, input);
			}
		},
	});
}
