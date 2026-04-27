import type { User } from '@n8n/db';
import z from 'zod';

type WorkflowWithTags = {
	id: string;
	name: string | null;
	tags?: Array<{ id: string; name: string }>;
};

import { USER_CALLED_MCP_TOOL_EVENT } from '../mcp.constants';
import type { ToolDefinition, UserCalledMCPToolEventPayload } from '../mcp.types';
import { executeWorkflow } from './execute-workflow.tool';

import type { McpService } from '@/modules/mcp/mcp.service';
import type { Telemetry } from '@/telemetry';
import type { WorkflowRunner } from '@/workflow-runner';
import type { WorkflowFinderService } from '@/workflows/workflow-finder.service';
import type { WorkflowService } from '@/workflows/workflow.service';

const AGENT_TOOL_TAG = 'n8n-ai-tool';

// ── list_workflow_tools ────────────────────────────────────────────────────────

const listInputSchema = {
	query: z.string().optional().describe('Filter by workflow name (partial match)'),
} satisfies z.ZodRawShape;

const listOutputSchema = {
	tools: z
		.array(
			z.object({
				id: z.string(),
				name: z.string().nullable(),
				tags: z.array(z.string()),
			}),
		)
		.describe(`Workflows tagged "${AGENT_TOOL_TAG}" available as agent tools`),
	count: z.number().int().min(0),
} satisfies z.ZodRawShape;

export const createListWorkflowToolsTool = (
	user: User,
	workflowService: WorkflowService,
	telemetry: Telemetry,
): ToolDefinition<typeof listInputSchema> => ({
	name: 'list_workflow_tools',
	config: {
		description:
			`List n8n workflows tagged "${AGENT_TOOL_TAG}" that are available as callable agent tools. ` +
			'Tag any workflow with this tag to make it appear here.',
		inputSchema: listInputSchema,
		outputSchema: listOutputSchema,
		annotations: {
			title: 'List Workflow Tools',
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
	},
	handler: async ({ query }: { query?: string }) => {
		const telemetryPayload: UserCalledMCPToolEventPayload = {
			user_id: user.id,
			tool_name: 'list_workflow_tools',
			parameters: { query },
		};

		try {
			const { workflows } = await workflowService.getMany(user, {
				take: 100,
				filter: {
					isArchived: false,
					tags: [AGENT_TOOL_TAG],
					...(query ? { query } : {}),
				},
				select: {
					id: true,
					name: true,
					tags: true,
				},
			});

			const tools = (workflows as unknown as WorkflowWithTags[]).map((wf) => ({
				id: wf.id,
				name: wf.name,
				tags: (wf.tags ?? []).map((t) => t.name),
			}));

			const output = { tools, count: tools.length };
			telemetryPayload.results = { success: true, data: { count: tools.length } };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			telemetryPayload.results = { success: false, error: errorMessage };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			const output = { tools: [], count: 0, error: errorMessage };
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
				isError: true,
			};
		}
	},
});

// ── call_workflow_tool ─────────────────────────────────────────────────────────

const callInputSchema = {
	workflow_id: z
		.string()
		.optional()
		.describe('Workflow ID (takes precedence over name). Use list_workflow_tools to find IDs.'),
	workflow_name: z
		.string()
		.optional()
		.describe(
			`Workflow name — case-insensitive. Only works for workflows tagged "${AGENT_TOOL_TAG}".`,
		),
	input: z
		.record(z.unknown())
		.optional()
		.describe('JSON data passed as the webhook POST body to the workflow'),
} satisfies z.ZodRawShape;

const callOutputSchema = {
	executionId: z.string().nullable(),
	status: z.enum(['started', 'error']),
	error: z.string().optional(),
} satisfies z.ZodRawShape;

export const createCallWorkflowToolTool = (
	user: User,
	workflowService: WorkflowService,
	workflowFinderService: WorkflowFinderService,
	workflowRunner: WorkflowRunner,
	mcpService: McpService,
	telemetry: Telemetry,
): ToolDefinition<typeof callInputSchema> => ({
	name: 'call_workflow_tool',
	config: {
		description:
			`Execute an n8n workflow tagged "${AGENT_TOOL_TAG}" by ID or name. ` +
			'Results are returned asynchronously via the execution ID. ' +
			'The workflow must have a supported trigger (Webhook, Chat, Manual, or Schedule).',
		inputSchema: callInputSchema,
		outputSchema: callOutputSchema,
		annotations: {
			title: 'Call Workflow Tool',
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: true,
		},
	},
	handler: async ({
		workflow_id,
		workflow_name,
		input,
	}: {
		workflow_id?: string;
		workflow_name?: string;
		input?: Record<string, unknown>;
	}) => {
		const telemetryPayload: UserCalledMCPToolEventPayload = {
			user_id: user.id,
			tool_name: 'call_workflow_tool',
			parameters: { hasId: !!workflow_id, hasName: !!workflow_name },
		};

		try {
			if (!workflow_id && !workflow_name) {
				const output = {
					executionId: null,
					status: 'error' as const,
					error: 'Either workflow_id or workflow_name must be provided.',
				};
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(output) }],
					structuredContent: output,
				};
			}

			let resolvedId = workflow_id;

			if (!resolvedId && workflow_name) {
				const { workflows } = await workflowService.getMany(user, {
					take: 20,
					filter: {
						isArchived: false,
						tags: [AGENT_TOOL_TAG],
						query: workflow_name,
					},
					select: { id: true, name: true, tags: true },
				});

				const nameLower = workflow_name.toLowerCase();
				const allEntities = workflows as unknown as WorkflowWithTags[];

				const exact = allEntities.filter((wf) => wf.name?.toLowerCase() === nameLower);
				if (exact.length === 1) {
					resolvedId = exact[0].id;
				} else if (exact.length > 1) {
					const output = {
						executionId: null,
						status: 'error' as const,
						error: `Ambiguous: ${exact.length} workflows named "${workflow_name}" with tag "${AGENT_TOOL_TAG}". Use workflow_id instead.`,
					};
					return {
						content: [{ type: 'text' as const, text: JSON.stringify(output) }],
						structuredContent: output,
					};
				} else {
					const partial = allEntities.filter((wf: WorkflowWithTags) =>
						wf.name?.toLowerCase().includes(nameLower),
					);
					if (partial.length === 1) {
						resolvedId = partial[0].id;
					} else if (partial.length > 1) {
						const output = {
							executionId: null,
							status: 'error' as const,
							error: `Ambiguous: ${partial.length} workflows partially match "${workflow_name}". Use workflow_id or a more specific name.`,
						};
						return {
							content: [{ type: 'text' as const, text: JSON.stringify(output) }],
							structuredContent: output,
						};
					} else {
						const output = {
							executionId: null,
							status: 'error' as const,
							error: `No workflow named "${workflow_name}" with tag "${AGENT_TOOL_TAG}" found. Use list_workflow_tools to see available tools.`,
						};
						return {
							content: [{ type: 'text' as const, text: JSON.stringify(output) }],
							structuredContent: output,
						};
					}
				}
			}

			const executionInputs = input
				? {
						type: 'webhook' as const,
						webhookData: { method: 'POST' as const, body: input },
					}
				: undefined;

			const result = await executeWorkflow(
				user,
				workflowFinderService,
				workflowRunner,
				mcpService,
				resolvedId!,
				executionInputs,
			);

			telemetryPayload.results = {
				success: result.status !== 'error',
				data: { executionId: result.executionId, status: result.status },
			};
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result) }],
				structuredContent: result,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			telemetryPayload.results = { success: false, error: errorMessage };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			const output = { executionId: null, status: 'error' as const, error: errorMessage };
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
			};
		}
	},
});
