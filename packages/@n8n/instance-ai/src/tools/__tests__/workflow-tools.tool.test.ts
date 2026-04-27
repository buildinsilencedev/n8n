import type { InstanceAiContext } from '../../types';
import { createWorkflowToolsTool } from '../workflow-tools.tool';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TOOL_WORKFLOW = {
	id: 'wf-1',
	name: 'Send Welcome Email',
	tags: ['n8n-ai-tool'],
	versionId: 'v1',
	activeVersionId: 'v1',
	createdAt: '2024-01-01',
	updatedAt: '2024-01-01',
};

const NON_TOOL_WORKFLOW = {
	id: 'wf-2',
	name: 'Internal Sync',
	tags: ['internal'],
	versionId: 'v1',
	activeVersionId: 'v1',
	createdAt: '2024-01-01',
	updatedAt: '2024-01-01',
};

const UNTAGGED_WORKFLOW = {
	id: 'wf-3',
	name: 'Untagged Workflow',
	versionId: 'v1',
	activeVersionId: 'v1',
	createdAt: '2024-01-01',
	updatedAt: '2024-01-01',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockContext(): InstanceAiContext {
	return {
		userId: 'user-1',
		workflowService: {
			list: jest.fn().mockResolvedValue([TOOL_WORKFLOW, NON_TOOL_WORKFLOW]),
			get: jest.fn(),
			getAsWorkflowJSON: jest.fn(),
			createFromWorkflowJSON: jest.fn(),
			updateFromWorkflowJSON: jest.fn(),
			archive: jest.fn(),
			delete: jest.fn(),
			publish: jest.fn(),
			unpublish: jest.fn(),
		},
		executionService: {
			list: jest.fn().mockResolvedValue([]),
			run: jest
				.fn()
				.mockResolvedValue({ executionId: 'exec-1', status: 'success', data: { result: 'ok' } }),
			getStatus: jest.fn(),
			getResult: jest.fn(),
			stop: jest.fn(),
			getDebugInfo: jest.fn(),
			getNodeOutput: jest.fn(),
		},
		nodeService: {} as InstanceAiContext['nodeService'],
		credentialService: {} as InstanceAiContext['credentialService'],
		dataTableService: {} as InstanceAiContext['dataTableService'],
		permissions: {},
	} as unknown as InstanceAiContext;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('workflow-tools tool', () => {
	// ── list ──────────────────────────────────────────────────────────────────

	describe('list action', () => {
		it('should return only workflows tagged n8n-ai-tool', async () => {
			const context = createMockContext();
			const tool = createWorkflowToolsTool(context);

			const result = await tool.execute!({ action: 'list' as const } as never, {} as never);

			expect(result).toEqual({
				tools: [{ id: 'wf-1', name: 'Send Welcome Email', tags: ['n8n-ai-tool'] }],
				count: 1,
			});
		});

		it('should return empty array when no workflows are tagged', async () => {
			const context = createMockContext();
			(context.workflowService.list as jest.Mock).mockResolvedValue([
				NON_TOOL_WORKFLOW,
				UNTAGGED_WORKFLOW,
			]);
			const tool = createWorkflowToolsTool(context);

			const result = await tool.execute!({ action: 'list' as const } as never, {} as never);

			expect(result).toEqual({ tools: [], count: 0 });
		});

		it('should handle workflows with no tags field', async () => {
			const context = createMockContext();
			(context.workflowService.list as jest.Mock).mockResolvedValue([UNTAGGED_WORKFLOW]);
			const tool = createWorkflowToolsTool(context);

			const result = await tool.execute!({ action: 'list' as const } as never, {} as never);

			expect(result).toEqual({ tools: [], count: 0 });
		});

		it('should call workflowService.list with no arguments', async () => {
			const context = createMockContext();
			const tool = createWorkflowToolsTool(context);

			await tool.execute!({ action: 'list' as const } as never, {} as never);

			expect(context.workflowService.list).toHaveBeenCalledWith();
		});
	});

	// ── call by workflow_id ────────────────────────────────────────────────────

	describe('call action — by workflow_id', () => {
		it('should pass workflow_id directly to executionService.run', async () => {
			const context = createMockContext();
			const tool = createWorkflowToolsTool(context);

			await tool.execute!(
				{ action: 'call' as const, workflow_id: 'wf-1', input: { name: 'test' } } as never,
				{} as never,
			);

			expect(context.executionService.run).toHaveBeenCalledWith(
				'wf-1',
				{ name: 'test' },
				{ timeout: 60000 },
			);
		});

		it('should return success result with executionId and data', async () => {
			const context = createMockContext();
			const tool = createWorkflowToolsTool(context);

			const result = await tool.execute!(
				{ action: 'call' as const, workflow_id: 'wf-1' } as never,
				{} as never,
			);

			expect(result).toEqual({
				success: true,
				executionId: 'exec-1',
				status: 'success',
				data: { result: 'ok' },
			});
		});

		it('should return failure when execution status is error', async () => {
			const context = createMockContext();
			(context.executionService.run as jest.Mock).mockResolvedValue({
				executionId: 'exec-2',
				status: 'error',
				error: 'Workflow node failed',
			});
			const tool = createWorkflowToolsTool(context);

			const result = await tool.execute!(
				{ action: 'call' as const, workflow_id: 'wf-1' } as never,
				{} as never,
			);

			expect(result).toEqual({
				success: false,
				executionId: 'exec-2',
				status: 'error',
				error: 'Workflow node failed',
			});
		});

		it('should return failure with default error message when error field is absent', async () => {
			const context = createMockContext();
			(context.executionService.run as jest.Mock).mockResolvedValue({
				executionId: 'exec-2',
				status: 'error',
			});
			const tool = createWorkflowToolsTool(context);

			const result = await tool.execute!(
				{ action: 'call' as const, workflow_id: 'wf-1' } as never,
				{} as never,
			);

			expect(result).toMatchObject({ success: false, error: 'Workflow execution failed' });
		});

		it('should return failure for unexpected execution status', async () => {
			const context = createMockContext();
			(context.executionService.run as jest.Mock).mockResolvedValue({
				executionId: 'exec-3',
				status: 'waiting',
			});
			const tool = createWorkflowToolsTool(context);

			const result = await tool.execute!(
				{ action: 'call' as const, workflow_id: 'wf-1' } as never,
				{} as never,
			);

			expect(result).toEqual({
				success: false,
				executionId: 'exec-3',
				status: 'waiting',
				error: 'Workflow ended in unexpected state: waiting',
			});
		});

		it('should use custom timeout when provided', async () => {
			const context = createMockContext();
			const tool = createWorkflowToolsTool(context);

			await tool.execute!(
				{ action: 'call' as const, workflow_id: 'wf-1', timeout: 120000 } as never,
				{} as never,
			);

			expect(context.executionService.run).toHaveBeenCalledWith('wf-1', undefined, {
				timeout: 120000,
			});
		});

		it('should default timeout to 60000 when not specified', async () => {
			const context = createMockContext();
			const tool = createWorkflowToolsTool(context);

			await tool.execute!({ action: 'call' as const, workflow_id: 'wf-1' } as never, {} as never);

			expect(context.executionService.run).toHaveBeenCalledWith('wf-1', undefined, {
				timeout: 60000,
			});
		});
	});

	// ── call by workflow_name ──────────────────────────────────────────────────

	describe('call action — by workflow_name', () => {
		it('should resolve by exact name match (case-insensitive)', async () => {
			const context = createMockContext();
			(context.workflowService.list as jest.Mock).mockResolvedValue([
				TOOL_WORKFLOW,
				NON_TOOL_WORKFLOW,
			]);
			const tool = createWorkflowToolsTool(context);

			await tool.execute!(
				{ action: 'call' as const, workflow_name: 'send welcome email' } as never,
				{} as never,
			);

			expect(context.workflowService.list).toHaveBeenCalledWith({
				query: 'send welcome email',
			});
			expect(context.executionService.run).toHaveBeenCalledWith('wf-1', undefined, {
				timeout: 60000,
			});
		});

		it('should resolve by partial name match when no exact match exists', async () => {
			const context = createMockContext();
			(context.workflowService.list as jest.Mock).mockResolvedValue([TOOL_WORKFLOW]);
			const tool = createWorkflowToolsTool(context);

			await tool.execute!(
				{ action: 'call' as const, workflow_name: 'welcome' } as never,
				{} as never,
			);

			expect(context.executionService.run).toHaveBeenCalledWith('wf-1', undefined, {
				timeout: 60000,
			});
		});

		it('should return ambiguous error when multiple tagged workflows partially match', async () => {
			const second = { ...TOOL_WORKFLOW, id: 'wf-99', name: 'Send Welcome Newsletter' };
			const context = createMockContext();
			(context.workflowService.list as jest.Mock).mockResolvedValue([TOOL_WORKFLOW, second]);
			const tool = createWorkflowToolsTool(context);

			const result = await tool.execute!(
				{ action: 'call' as const, workflow_name: 'welcome' } as never,
				{} as never,
			);

			expect(result).toMatchObject({
				success: false,
				error: expect.stringContaining('Ambiguous'),
			});
			expect(context.executionService.run).not.toHaveBeenCalled();
		});

		it('should return not-found error when no tagged workflow matches', async () => {
			const context = createMockContext();
			(context.workflowService.list as jest.Mock).mockResolvedValue([NON_TOOL_WORKFLOW]);
			const tool = createWorkflowToolsTool(context);

			const result = await tool.execute!(
				{ action: 'call' as const, workflow_name: 'Send Welcome Email' } as never,
				{} as never,
			);

			expect(result).toMatchObject({
				success: false,
				error: expect.stringContaining('No workflow'),
			});
			expect(context.executionService.run).not.toHaveBeenCalled();
		});
	});

	// ── call validation ────────────────────────────────────────────────────────

	describe('call action — validation', () => {
		it('should return error when neither workflow_id nor workflow_name is provided', async () => {
			const context = createMockContext();
			const tool = createWorkflowToolsTool(context);

			const result = await tool.execute!({ action: 'call' as const } as never, {} as never);

			expect(result).toEqual({
				success: false,
				error: 'Either workflow_id or workflow_name must be provided.',
			});
			expect(context.executionService.run).not.toHaveBeenCalled();
		});
	});
});
