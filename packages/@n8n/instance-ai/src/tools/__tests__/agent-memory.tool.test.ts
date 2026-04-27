import type { InstanceAiContext } from '../../types';
import { createAgentMemoryTool } from '../agent-memory.tool';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MEMORY_TABLE = {
	id: 'mem-table-1',
	name: '__agent_memory',
	columns: [],
	createdAt: '2024-01-01',
	updatedAt: '2024-01-01',
};

const STORE_INPUT = {
	action: 'store' as const,
	entity_id: 'john@example.com',
	entity_type: 'lead',
	entity_name: 'John Smith',
	event_type: 'contacted',
	event_date: '2026-04-26',
	outcome: 'No reply',
	notes: 'Sent initial outreach email',
	next_action_date: '2026-05-03',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockContext(): InstanceAiContext {
	return {
		userId: 'user-1',
		workflowService: {} as InstanceAiContext['workflowService'],
		executionService: {} as InstanceAiContext['executionService'],
		nodeService: {} as InstanceAiContext['nodeService'],
		credentialService: {} as InstanceAiContext['credentialService'],
		dataTableService: {
			list: jest.fn().mockResolvedValue([MEMORY_TABLE]),
			getSchema: jest.fn().mockResolvedValue([]),
			queryRows: jest.fn().mockResolvedValue({ count: 0, data: [] }),
			create: jest.fn().mockResolvedValue(MEMORY_TABLE),
			delete: jest.fn().mockResolvedValue(undefined),
			addColumn: jest.fn().mockResolvedValue({}),
			deleteColumn: jest.fn().mockResolvedValue(undefined),
			renameColumn: jest.fn().mockResolvedValue(undefined),
			insertRows: jest
				.fn()
				.mockResolvedValue({
					insertedCount: 1,
					dataTableId: 'mem-table-1',
					tableName: '__agent_memory',
					projectId: 'proj-1',
				}),
			updateRows: jest
				.fn()
				.mockResolvedValue({
					updatedCount: 0,
					dataTableId: 'mem-table-1',
					tableName: '__agent_memory',
					projectId: 'proj-1',
				}),
			deleteRows: jest
				.fn()
				.mockResolvedValue({
					deletedCount: 0,
					dataTableId: 'mem-table-1',
					tableName: '__agent_memory',
					projectId: 'proj-1',
				}),
		},
		permissions: {},
	} as unknown as InstanceAiContext;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('agent-memory tool', () => {
	// ── Table initialization ───────────────────────────────────────────────────

	describe('table initialization', () => {
		it('should reuse existing table without calling create', async () => {
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			await tool.execute!(STORE_INPUT as never, {} as never);

			expect(context.dataTableService.list).toHaveBeenCalledTimes(1);
			expect(context.dataTableService.create).not.toHaveBeenCalled();
			expect(context.dataTableService.insertRows).toHaveBeenCalledWith(
				'mem-table-1',
				expect.any(Array),
			);
		});

		it('should create the table when not found', async () => {
			const context = createMockContext();
			(context.dataTableService.list as jest.Mock).mockResolvedValue([]);
			const tool = createAgentMemoryTool(context);

			await tool.execute!(STORE_INPUT as never, {} as never);

			expect(context.dataTableService.create).toHaveBeenCalledWith(
				'__agent_memory',
				expect.arrayContaining([
					expect.objectContaining({ name: 'entity_id', type: 'string' }),
					expect.objectContaining({ name: 'event_date', type: 'date' }),
					expect.objectContaining({ name: 'next_action_date', type: 'string' }),
				]),
			);
			expect(context.dataTableService.insertRows).toHaveBeenCalledWith(
				'mem-table-1',
				expect.any(Array),
			);
		});

		it('should retry list on DataTableNameConflictError', async () => {
			class DataTableNameConflictError extends Error {}
			const context = createMockContext();
			(context.dataTableService.list as jest.Mock)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([MEMORY_TABLE]);
			(context.dataTableService.create as jest.Mock).mockRejectedValue(
				new DataTableNameConflictError('conflict'),
			);
			const tool = createAgentMemoryTool(context);

			await tool.execute!(STORE_INPUT as never, {} as never);

			expect(context.dataTableService.list).toHaveBeenCalledTimes(2);
			expect(context.dataTableService.insertRows).toHaveBeenCalledWith(
				'mem-table-1',
				expect.any(Array),
			);
		});

		it('should return error when list throws', async () => {
			const context = createMockContext();
			(context.dataTableService.list as jest.Mock).mockRejectedValue(new Error('DB unavailable'));
			const tool = createAgentMemoryTool(context);

			const result = await tool.execute!(STORE_INPUT as never, {} as never);

			expect(result).toEqual({
				error: 'Could not initialize agent memory storage: DB unavailable',
			});
		});
	});

	// ── store ──────────────────────────────────────────────────────────────────

	describe('store action', () => {
		it('should insert a row with all fields from input', async () => {
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			const result = await tool.execute!(STORE_INPUT as never, {} as never);

			expect(context.dataTableService.insertRows).toHaveBeenCalledWith('mem-table-1', [
				{
					entity_id: 'john@example.com',
					entity_type: 'lead',
					entity_name: 'John Smith',
					event_type: 'contacted',
					event_date: '2026-04-26',
					outcome: 'No reply',
					notes: 'Sent initial outreach email',
					next_action_date: '2026-05-03',
				},
			]);
			expect(result).toEqual({ success: true });
		});

		it('should return failure when insertRows throws', async () => {
			const context = createMockContext();
			(context.dataTableService.insertRows as jest.Mock).mockRejectedValue(
				new Error('insert failed'),
			);
			const tool = createAgentMemoryTool(context);

			const result = await tool.execute!(STORE_INPUT as never, {} as never);

			expect(result).toEqual({ success: false, error: 'insert failed' });
		});
	});

	// ── recall ─────────────────────────────────────────────────────────────────

	describe('recall action', () => {
		it('should filter by entity_id with eq condition', async () => {
			const context = createMockContext();
			(context.dataTableService.queryRows as jest.Mock).mockResolvedValue({
				count: 1,
				data: [{ entity_id: 'john@example.com', event_type: 'contacted' }],
			});
			const tool = createAgentMemoryTool(context);

			const result = await tool.execute!(
				{ action: 'recall' as const, entity_id: 'john@example.com' } as never,
				{} as never,
			);

			expect(context.dataTableService.queryRows).toHaveBeenCalledWith('mem-table-1', {
				filter: {
					type: 'and',
					filters: [{ columnName: 'entity_id', condition: 'eq', value: 'john@example.com' }],
				},
				limit: 100,
			});
			expect(result).toEqual({
				events: [{ entity_id: 'john@example.com', event_type: 'contacted' }],
				count: 1,
			});
		});

		it('should filter by entity_name with like condition', async () => {
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			await tool.execute!({ action: 'recall' as const, entity_name: 'John' } as never, {} as never);

			expect(context.dataTableService.queryRows).toHaveBeenCalledWith('mem-table-1', {
				filter: {
					type: 'and',
					filters: [{ columnName: 'entity_name', condition: 'like', value: 'John' }],
				},
				limit: 100,
			});
		});

		it('should combine entity_id and entity_name with and filter', async () => {
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			await tool.execute!(
				{
					action: 'recall' as const,
					entity_id: 'john@example.com',
					entity_name: 'John',
				} as never,
				{} as never,
			);

			expect(context.dataTableService.queryRows).toHaveBeenCalledWith('mem-table-1', {
				filter: {
					type: 'and',
					filters: [
						{ columnName: 'entity_id', condition: 'eq', value: 'john@example.com' },
						{ columnName: 'entity_name', condition: 'like', value: 'John' },
					],
				},
				limit: 100,
			});
		});

		it('should query with no filter when neither id nor name is provided', async () => {
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			await tool.execute!({ action: 'recall' as const } as never, {} as never);

			expect(context.dataTableService.queryRows).toHaveBeenCalledWith('mem-table-1', {
				filter: undefined,
				limit: 100,
			});
		});
	});

	// ── search ─────────────────────────────────────────────────────────────────

	describe('search action', () => {
		it('should filter by from_date with gte condition', async () => {
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			await tool.execute!(
				{ action: 'search' as const, from_date: '2026-04-01' } as never,
				{} as never,
			);

			expect(context.dataTableService.queryRows).toHaveBeenCalledWith('mem-table-1', {
				filter: {
					type: 'and',
					filters: [{ columnName: 'event_date', condition: 'gte', value: '2026-04-01' }],
				},
				limit: 50,
			});
		});

		it('should combine from_date and to_date filters', async () => {
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			await tool.execute!(
				{ action: 'search' as const, from_date: '2026-04-01', to_date: '2026-04-30' } as never,
				{} as never,
			);

			const call = (context.dataTableService.queryRows as jest.Mock).mock.calls[0][1] as {
				filter: { filters: Array<{ columnName: string; condition: string; value: string }> };
			};
			expect(call.filter.filters).toContainEqual({
				columnName: 'event_date',
				condition: 'gte',
				value: '2026-04-01',
			});
			expect(call.filter.filters).toContainEqual({
				columnName: 'event_date',
				condition: 'lte',
				value: '2026-04-30',
			});
		});

		it('should filter by entity_type and event_type', async () => {
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			await tool.execute!(
				{ action: 'search' as const, entity_type: 'lead', event_type: 'contacted' } as never,
				{} as never,
			);

			const call = (context.dataTableService.queryRows as jest.Mock).mock.calls[0][1] as {
				filter: { filters: Array<{ columnName: string; condition: string; value: string }> };
			};
			expect(call.filter.filters).toContainEqual({
				columnName: 'entity_type',
				condition: 'eq',
				value: 'lead',
			});
			expect(call.filter.filters).toContainEqual({
				columnName: 'event_type',
				condition: 'eq',
				value: 'contacted',
			});
		});

		it('should pass custom limit', async () => {
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			await tool.execute!({ action: 'search' as const, limit: 10 } as never, {} as never);

			expect(context.dataTableService.queryRows).toHaveBeenCalledWith('mem-table-1', {
				filter: undefined,
				limit: 10,
			});
		});

		it('should default to limit 50 when not specified', async () => {
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			await tool.execute!({ action: 'search' as const } as never, {} as never);

			expect(context.dataTableService.queryRows).toHaveBeenCalledWith('mem-table-1', {
				filter: undefined,
				limit: 50,
			});
		});
	});

	// ── suggest-followup ───────────────────────────────────────────────────────

	describe('suggest-followup action', () => {
		it('should default as_of_date to today', async () => {
			const today = new Date().toISOString().slice(0, 10);
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			await tool.execute!({ action: 'suggest-followup' as const } as never, {} as never);

			const call = (context.dataTableService.queryRows as jest.Mock).mock.calls[0][1] as {
				filter: { filters: Array<{ columnName: string; condition: string; value: string }> };
			};
			expect(call.filter.filters).toContainEqual({
				columnName: 'next_action_date',
				condition: 'lte',
				value: today,
			});
		});

		it('should always guard against empty next_action_date strings', async () => {
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			await tool.execute!(
				{ action: 'suggest-followup' as const, as_of_date: '2026-04-26' } as never,
				{} as never,
			);

			const call = (context.dataTableService.queryRows as jest.Mock).mock.calls[0][1] as {
				filter: { filters: Array<{ columnName: string; condition: string; value: string }> };
			};
			expect(call.filter.filters).toContainEqual({
				columnName: 'next_action_date',
				condition: 'neq',
				value: '',
			});
		});

		it('should use custom as_of_date when provided', async () => {
			const context = createMockContext();
			const tool = createAgentMemoryTool(context);

			await tool.execute!(
				{ action: 'suggest-followup' as const, as_of_date: '2026-05-01' } as never,
				{} as never,
			);

			const call = (context.dataTableService.queryRows as jest.Mock).mock.calls[0][1] as {
				filter: { filters: Array<{ columnName: string; condition: string; value: string }> };
			};
			expect(call.filter.filters).toContainEqual({
				columnName: 'next_action_date',
				condition: 'lte',
				value: '2026-05-01',
			});
		});

		it('should return entities and count', async () => {
			const entities = [{ entity_name: 'Acme Corp', next_action_date: '2026-04-20' }];
			const context = createMockContext();
			(context.dataTableService.queryRows as jest.Mock).mockResolvedValue({
				count: 1,
				data: entities,
			});
			const tool = createAgentMemoryTool(context);

			const result = await tool.execute!(
				{ action: 'suggest-followup' as const } as never,
				{} as never,
			);

			expect(result).toEqual({ entities, count: 1 });
		});
	});
});
