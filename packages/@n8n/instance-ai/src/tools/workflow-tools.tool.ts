/**
 * Discover and call n8n workflows tagged "n8n-ai-tool" as first-class agent capabilities.
 * Users add the tag to any workflow to make it a callable agent tool.
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { sanitizeInputSchema } from '../agent/sanitize-mcp-schemas';
import type { InstanceAiContext, WorkflowSummary } from '../types';

const AGENT_TOOL_TAG = 'n8n-ai-tool';

// ── Action schemas ─────────────────────────────────────────────────────────────

const listAction = z.object({
	action: z
		.literal('list')
		.describe(`List all workflows tagged "${AGENT_TOOL_TAG}" that are available as agent tools`),
});

const callAction = z.object({
	action: z.literal('call').describe(`Execute a workflow tagged "${AGENT_TOOL_TAG}" by name or ID`),
	workflow_id: z
		.string()
		.optional()
		.describe('Workflow ID (takes precedence over name if both are provided)'),
	workflow_name: z
		.string()
		.optional()
		.describe('Workflow name — used to locate the workflow when ID is not known'),
	input: z.record(z.unknown()).optional().describe('JSON data passed as input to the workflow'),
	timeout: z
		.number()
		.int()
		.min(1000)
		.max(600000)
		.optional()
		.describe('Max wait time in ms (default 60000). Increase for slow workflows.'),
});

const allActions = [listAction, callAction] as const;
type FullInput = z.infer<z.ZodDiscriminatedUnion<'action', typeof allActions>>;

// ── Helpers ────────────────────────────────────────────────────────────────────

function isTaggedAsTool(workflow: WorkflowSummary): boolean {
	return workflow.tags?.includes(AGENT_TOOL_TAG) ?? false;
}

async function resolveWorkflowTool(
	context: InstanceAiContext,
	workflowId: string | undefined,
	workflowName: string | undefined,
): Promise<{ id: string; name: string } | { error: string }> {
	if (workflowId) {
		return { id: workflowId, name: workflowId };
	}
	if (!workflowName) {
		return { error: 'Either workflow_id or workflow_name must be provided.' };
	}

	const workflows = await context.workflowService.list({ query: workflowName });
	const tagged = workflows.filter(isTaggedAsTool);
	const nameLower = workflowName.toLowerCase();

	// Exact match first
	const exact = tagged.filter((wf) => wf.name.toLowerCase() === nameLower);
	if (exact.length === 1) return { id: exact[0].id, name: exact[0].name };
	if (exact.length > 1) {
		return {
			error: `Ambiguous workflow name "${workflowName}": found ${exact.length} matching tagged workflows. Use workflow_id instead.`,
		};
	}

	// Partial match fallback
	const partial = tagged.filter((wf) => wf.name.toLowerCase().includes(nameLower));
	if (partial.length === 1) return { id: partial[0].id, name: partial[0].name };
	if (partial.length > 1) {
		return {
			error: `Ambiguous workflow name "${workflowName}": found ${partial.length} partially matching tagged workflows. Use workflow_id instead.`,
		};
	}

	return {
		error: `No workflow named "${workflowName}" with tag "${AGENT_TOOL_TAG}" found. Use the "list" action to see available workflow tools.`,
	};
}

// ── Handlers ───────────────────────────────────────────────────────────────────

async function handleList(
	context: InstanceAiContext,
): Promise<{ tools: Array<{ id: string; name: string; tags: string[] }>; count: number }> {
	const workflows = await context.workflowService.list();
	const tagged = workflows.filter(isTaggedAsTool);
	return {
		tools: tagged.map((wf) => ({ id: wf.id, name: wf.name, tags: wf.tags ?? [] })),
		count: tagged.length,
	};
}

async function handleCall(
	context: InstanceAiContext,
	input: Extract<FullInput, { action: 'call' }>,
): Promise<{
	success: boolean;
	executionId?: string;
	status?: string;
	data?: Record<string, unknown>;
	error?: string;
}> {
	const resolved = await resolveWorkflowTool(context, input.workflow_id, input.workflow_name);
	if ('error' in resolved) {
		return { success: false, error: resolved.error };
	}

	const result = await context.executionService.run(resolved.id, input.input, {
		timeout: input.timeout ?? 60_000,
	});

	if (result.status === 'success') {
		return {
			success: true,
			executionId: result.executionId,
			status: result.status,
			data: result.data,
		};
	}

	if (result.status === 'error') {
		return {
			success: false,
			executionId: result.executionId,
			status: result.status,
			error: result.error ?? 'Workflow execution failed',
		};
	}

	return {
		success: false,
		executionId: result.executionId,
		status: result.status,
		error: `Workflow ended in unexpected state: ${result.status}`,
	};
}

// ── Tool factory ───────────────────────────────────────────────────────────────

export function createWorkflowToolsTool(context: InstanceAiContext) {
	const inputSchema = sanitizeInputSchema(z.discriminatedUnion('action', [...allActions]));

	return createTool({
		id: 'workflow-tools',
		description:
			`Discover and call n8n workflows tagged "${AGENT_TOOL_TAG}" as agent capabilities. ` +
			'Use "list" to see available workflow tools, then "call" to execute one by name or ID. ' +
			'Results are returned synchronously — the agent waits for the workflow to complete. ' +
			'Tag any workflow with "n8n-ai-tool" to make it callable by agents.',
		inputSchema,
		execute: async (input: FullInput) => {
			switch (input.action) {
				case 'list':
					return await handleList(context);
				case 'call':
					return await handleCall(context, input);
			}
		},
	});
}
