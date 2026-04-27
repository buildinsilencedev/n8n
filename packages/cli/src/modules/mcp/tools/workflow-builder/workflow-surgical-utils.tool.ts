import type { ExecutionRepository, User } from '@n8n/db';
import { generateWorkflowCode } from '@n8n/workflow-sdk';
import type { IDataObject, INodeTypeDescription, IPinData, IRunData } from 'n8n-workflow';
import type { INode } from 'n8n-workflow';
import z from 'zod';

import { USER_CALLED_MCP_TOOL_EVENT } from '../../mcp.constants';
import type { ToolDefinition, UserCalledMCPToolEventPayload } from '../../mcp.types';
import { getMcpWorkflow } from '../workflow-validation.utils';
import { testWorkflow } from '../test-workflow.tool';

import type { ActiveExecutions } from '@/active-executions';
import type { NodeTypes } from '@/node-types';
import type { McpService } from '@/modules/mcp/mcp.service';
import type { Telemetry } from '@/telemetry';
import type { WorkflowFinderService } from '@/workflows/workflow-finder.service';
import type { WorkflowRunner } from '@/workflow-runner';

// ---------------------------------------------------------------------------
// Tool: get_workflow_as_sdk_code
// ---------------------------------------------------------------------------

const getWorkflowAsSdkCodeInput = {
	workflowId: z.string().describe('ID of the workflow to convert to TypeScript SDK code'),
} satisfies z.ZodRawShape;

export const createGetWorkflowAsSdkCodeTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	telemetry: Telemetry,
): ToolDefinition<typeof getWorkflowAsSdkCodeInput> => ({
	name: 'get_workflow_as_sdk_code',
	config: {
		description:
			'Convert an existing workflow to TypeScript n8n Workflow SDK code. Use this before modifying a workflow — it returns code you can edit and pass to update_workflow.',
		inputSchema: getWorkflowAsSdkCodeInput,
		annotations: { title: 'Get Workflow as SDK Code', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	},
	handler: async ({ workflowId }: { workflowId: string }) => {
		const telemetryPayload: UserCalledMCPToolEventPayload = { user_id: user.id, tool_name: 'get_workflow_as_sdk_code', parameters: { workflowId } };
		try {
			const workflow = await getMcpWorkflow(workflowId, user, ['workflow:read'], workflowFinderService);
			const workflowJson = {
				id: workflow.id,
				name: workflow.name,
				nodes: workflow.nodes ?? [],
				connections: workflow.connections ?? {},
				settings: workflow.settings ?? {},
				pinData: workflow.pinData,
			};
			const code = generateWorkflowCode(workflowJson as Parameters<typeof generateWorkflowCode>[0]);
			const output = { workflowId, name: workflow.name, code };
			telemetryPayload.results = { success: true };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);
			return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			telemetryPayload.results = { success: false, error: msg };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);
			return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], structuredContent: { error: msg }, isError: true };
		}
	},
});

// ---------------------------------------------------------------------------
// Tool: verify_workflow_credentials
// ---------------------------------------------------------------------------

const verifyCredentialsInput = {
	workflowId: z.string().describe('ID of the workflow to check'),
} satisfies z.ZodRawShape;

function getRequiredCredentialTypes(node: INode, nodeTypes: NodeTypes): string[] {
	try {
		const nodeType = nodeTypes.getByNameAndVersion(node.type, node.typeVersion);
		const desc = nodeType.description as INodeTypeDescription;
		return (desc.credentials ?? []).map((c) => c.name);
	} catch {
		return [];
	}
}

export const createVerifyWorkflowCredentialsTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	nodeTypes: NodeTypes,
	telemetry: Telemetry,
): ToolDefinition<typeof verifyCredentialsInput> => ({
	name: 'verify_workflow_credentials',
	config: {
		description:
			'List every node in the workflow that requires credentials, showing whether each required credential type is currently bound. Does not mutate the workflow.',
		inputSchema: verifyCredentialsInput,
		annotations: { title: 'Verify Workflow Credentials', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	},
	handler: async ({ workflowId }: { workflowId: string }) => {
		const telemetryPayload: UserCalledMCPToolEventPayload = { user_id: user.id, tool_name: 'verify_workflow_credentials', parameters: { workflowId } };
		try {
			const workflow = await getMcpWorkflow(workflowId, user, ['workflow:read'], workflowFinderService);
			const nodes = workflow.nodes ?? [];

			const result = nodes
				.filter((node) => getRequiredCredentialTypes(node, nodeTypes).length > 0)
				.map((node) => {
					const requiredTypes = getRequiredCredentialTypes(node, nodeTypes);
					const requiredCredentials = requiredTypes.map((credType) => {
						const bound = node.credentials?.[credType];
						return {
							credentialType: credType,
							bound: bound?.id !== undefined,
							...(bound?.id ? { credentialId: bound.id } : {}),
							...(bound?.name ? { credentialName: bound.name } : {}),
						};
					});
					return {
						nodeName: node.name,
						nodeType: node.type,
						requiredCredentials,
						allRequiredCredentialsBound: requiredCredentials.every((c) => c.bound),
					};
				});

			const output = {
				workflowId,
				nodes: result,
				totalCredentialRequiringNodes: result.length,
				fullyBoundNodes: result.filter((n) => n.allRequiredCredentialsBound).length,
			};

			telemetryPayload.results = { success: true, data: { nodeCount: result.length } };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);
			return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			telemetryPayload.results = { success: false, error: msg };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);
			return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], structuredContent: { error: msg }, isError: true };
		}
	},
});

// ---------------------------------------------------------------------------
// Tool: simulate_telegram_message
// ---------------------------------------------------------------------------

const simulateTelegramInput = {
	workflowId: z.string().describe('ID of the workflow that has a Telegram Trigger node'),
	chatId: z.union([z.number(), z.string()]).describe('Telegram chat ID (number or string)'),
	text: z.string().describe('Message text to simulate'),
} satisfies z.ZodRawShape;

function buildTelegramPayload(chatId: number, text: string): IDataObject {
	const now = Date.now();
	return {
		update_id: now,
		message: {
			message_id: Math.floor(now / 1000),
			from: { id: chatId, is_bot: false, first_name: 'Test', username: 'test_user' },
			chat: { id: chatId, type: 'private' },
			date: Math.floor(now / 1000),
			text,
		},
	};
}

export const createSimulateTelegramMessageTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	activeExecutions: ActiveExecutions,
	workflowRunner: WorkflowRunner,
	nodeTypes: NodeTypes,
	telemetry: Telemetry,
	mcpService: McpService,
): ToolDefinition<typeof simulateTelegramInput> => ({
	name: 'simulate_telegram_message',
	config: {
		description:
			'Simulate a Telegram message arriving at a Telegram Trigger node and execute the workflow in test mode. Returns the execution status.',
		inputSchema: simulateTelegramInput,
		annotations: { title: 'Simulate Telegram Message', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
	},
	handler: async ({ workflowId, chatId, text }: { workflowId: string; chatId: number | string; text: string }) => {
		const telemetryPayload: UserCalledMCPToolEventPayload = { user_id: user.id, tool_name: 'simulate_telegram_message', parameters: { workflowId } };
		try {
			const workflow = await getMcpWorkflow(workflowId, user, ['workflow:execute'], workflowFinderService);
			const telegramTrigger = (workflow.nodes ?? []).find(
				(n) => n.type === 'n8n-nodes-base.telegramTrigger' || n.type.includes('telegramTrigger'),
			);

			if (!telegramTrigger) {
				const output = { success: false, error: 'No Telegram Trigger node found in workflow' };
				return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output, isError: true };
			}

			const numericChatId = typeof chatId === 'number' ? chatId : (Number(chatId) || 0);
			const payload = buildTelegramPayload(numericChatId, text);

			const pinData = { [telegramTrigger.name]: [{ json: payload }] } as IPinData;
			const execution = await testWorkflow(
				user,
				workflowFinderService,
				activeExecutions,
				workflowRunner,
				nodeTypes,
				mcpService,
				workflowId,
				pinData,
				telegramTrigger.name,
			);

			const output = { workflowId, triggerNodeName: telegramTrigger.name, simulatedPayload: payload, execution };
			telemetryPayload.results = { success: execution.status === 'success' };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);
			return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			telemetryPayload.results = { success: false, error: msg };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);
			return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], structuredContent: { error: msg }, isError: true };
		}
	},
});

// ---------------------------------------------------------------------------
// Tool: summarize_execution_error
// ---------------------------------------------------------------------------

const summarizeExecutionErrorInput = {
	workflowId: z.string().describe('ID of the workflow the execution belongs to'),
	executionId: z.string().describe('ID of the failed execution to analyze'),
} satisfies z.ZodRawShape;

export const createSummarizeExecutionErrorTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	executionRepository: ExecutionRepository,
	telemetry: Telemetry,
): ToolDefinition<typeof summarizeExecutionErrorInput> => ({
	name: 'summarize_execution_error',
	config: {
		description:
			'Analyze a failed workflow execution and return a structured error summary: which node failed, what the error was, and the execution trace up to the failure point.',
		inputSchema: summarizeExecutionErrorInput,
		annotations: { title: 'Summarize Execution Error', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	},
	handler: async ({ workflowId, executionId }: { workflowId: string; executionId: string }) => {
		const telemetryPayload: UserCalledMCPToolEventPayload = { user_id: user.id, tool_name: 'summarize_execution_error', parameters: { workflowId, executionId } };
		try {
			await getMcpWorkflow(workflowId, user, ['workflow:read'], workflowFinderService);

			const execution = await executionRepository.findWithUnflattenedData(executionId, [workflowId]);
			if (!execution) {
				const output = { error: `Execution "${executionId}" not found` };
				return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output, isError: true };
			}

			const runData = (execution.data?.resultData?.runData ?? {}) as IRunData;
			const lastNodeErrors: Array<{ nodeName: string; error: string }> = [];
			const nodeTrace: Array<{ nodeName: string; status: 'success' | 'error' }> = [];

			for (const [nodeName, nodeRunDataArr] of Object.entries(runData)) {
				const lastRun = nodeRunDataArr[nodeRunDataArr.length - 1];
				if (!lastRun) continue;

				const hasError = lastRun.error != null;
				nodeTrace.push({ nodeName, status: hasError ? 'error' : 'success' });

				if (hasError) {
					const errorMessage =
						typeof lastRun.error === 'object' && lastRun.error !== null
							? ((lastRun.error as { message?: string }).message ?? JSON.stringify(lastRun.error))
							: String(lastRun.error);
					lastNodeErrors.push({ nodeName, error: errorMessage });
				}
			}

			const failedNode = lastNodeErrors[0] ?? null;
			const output = {
				executionId,
				workflowId,
				status: execution.status,
				startedAt: execution.startedAt,
				stoppedAt: execution.stoppedAt,
				failedNode,
				additionalErrors: lastNodeErrors.slice(1),
				nodeTrace,
				errorCount: lastNodeErrors.length,
			};

			telemetryPayload.results = { success: true, data: { status: execution.status } };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);
			return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			telemetryPayload.results = { success: false, error: msg };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);
			return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], structuredContent: { error: msg }, isError: true };
		}
	},
});
