import { WorkflowEntity } from '@n8n/db';
import type { User } from '@n8n/db';
import type { IConnections, INode, INodeParameters } from 'n8n-workflow';
import { randomUUID } from 'node:crypto';
import z from 'zod';

import { USER_CALLED_MCP_TOOL_EVENT } from '../../mcp.constants';
import type { ToolDefinition, UserCalledMCPToolEventPayload } from '../../mcp.types';
import { getMcpWorkflow } from '../workflow-validation.utils';

import type { CollaborationService } from '@/collaboration/collaboration.service';
import type { Telemetry } from '@/telemetry';
import type { WorkflowFinderService } from '@/workflows/workflow-finder.service';
import type { WorkflowService } from '@/workflows/workflow.service';

// ---------------------------------------------------------------------------
// Internal types and helpers
// ---------------------------------------------------------------------------

type ConnectionEntry = { node: string; type: string; index: number };
type ConnectionSlots = Array<ConnectionEntry[] | null>;
type NodeConns = { [connectionType: string]: ConnectionSlots };
type Connections = Record<string, NodeConns>;

interface PatchDiff {
	nodesAdded: string[];
	nodesRemoved: string[];
	nodesUpdated: Array<{ nodeName: string; changedFields: string[] }>;
	connectionsAdded: Array<{ fromNode: string; toNode: string; outputIndex: number; inputIndex: number }>;
	connectionsRemoved: Array<{ fromNode: string; toNode: string; outputIndex: number; inputIndex: number }>;
}

function emptyDiff(): PatchDiff {
	return { nodesAdded: [], nodesRemoved: [], nodesUpdated: [], connectionsAdded: [], connectionsRemoved: [] };
}

function hasDiff(diff: PatchDiff): boolean {
	return (
		diff.nodesAdded.length > 0 ||
		diff.nodesRemoved.length > 0 ||
		diff.nodesUpdated.length > 0 ||
		diff.connectionsAdded.length > 0 ||
		diff.connectionsRemoved.length > 0
	);
}

function asConns(raw: IConnections | Record<string, unknown>): Connections {
	return raw as unknown as Connections;
}

function findNode(nodes: INode[], name: string): INode | undefined {
	return nodes.find((n) => n.name === name);
}

function uniqueName(nodes: INode[], base: string): string {
	const taken = new Set(nodes.map((n) => n.name));
	if (!taken.has(base)) return base;
	let i = 2;
	while (taken.has(`${base} ${String(i)}`)) i++;
	return `${base} ${String(i)}`;
}

function ensureSlot(conns: Connections, fromNode: string, outputIndex: number): ConnectionEntry[] {
	if (!conns[fromNode]) conns[fromNode] = { main: [] };
	if (!conns[fromNode].main) conns[fromNode].main = [];
	const slots = conns[fromNode].main;
	while (slots.length <= outputIndex) slots.push(null);
	if (slots[outputIndex] === null) slots[outputIndex] = [];
	return (slots[outputIndex] ??= []);
}

function addConn(
	conns: Connections,
	fromNode: string,
	toNode: string,
	outputIndex: number,
	inputIndex: number,
	diff: PatchDiff,
): void {
	const slot = ensureSlot(conns, fromNode, outputIndex);
	if (slot.some((e) => e.node === toNode && e.index === inputIndex)) return;
	slot.push({ node: toNode, type: 'main', index: inputIndex });
	diff.connectionsAdded.push({ fromNode, toNode, outputIndex, inputIndex });
}

function removeConnsBetween(
	conns: Connections,
	fromNode: string,
	toNode: string,
	diff: PatchDiff,
): void {
	const nc = conns[fromNode];
	if (!nc?.main) return;
	for (let oi = 0; oi < nc.main.length; oi++) {
		const slot = nc.main[oi];
		if (!slot) continue;
		const kept: ConnectionEntry[] = [];
		for (const e of slot) {
			if (e.node === toNode) {
				diff.connectionsRemoved.push({ fromNode, toNode, outputIndex: oi, inputIndex: e.index });
			} else {
				kept.push(e);
			}
		}
		nc.main[oi] = kept.length > 0 ? kept : null;
	}
	pruneNode(conns, fromNode);
}

function removeAllConns(conns: Connections, nodeName: string, diff: PatchDiff): void {
	const out = conns[nodeName];
	if (out?.main) {
		for (let oi = 0; oi < out.main.length; oi++) {
			const slot = out.main[oi];
			if (!slot) continue;
			for (const e of slot) {
				diff.connectionsRemoved.push({ fromNode: nodeName, toNode: e.node, outputIndex: oi, inputIndex: e.index });
			}
		}
		delete conns[nodeName];
	}
	for (const [src, srcConns] of Object.entries(conns)) {
		if (!srcConns.main) continue;
		for (let oi = 0; oi < srcConns.main.length; oi++) {
			const slot = srcConns.main[oi];
			if (!slot) continue;
			const kept: ConnectionEntry[] = [];
			for (const e of slot) {
				if (e.node === nodeName) {
					diff.connectionsRemoved.push({ fromNode: src, toNode: nodeName, outputIndex: oi, inputIndex: e.index });
				} else {
					kept.push(e);
				}
			}
			srcConns.main[oi] = kept.length > 0 ? kept : null;
		}
		pruneNode(conns, src);
	}
}

function pruneNode(conns: Connections, nodeName: string): void {
	const nc = conns[nodeName];
	if (!nc) return;
	for (const [type, slots] of Object.entries(nc)) {
		if (slots.every((s) => s === null || s.length === 0)) delete nc[type];
	}
	if (Object.keys(nc).length === 0) delete conns[nodeName];
}

async function applyPatch(
	user: User,
	workflowFinderService: WorkflowFinderService,
	workflowService: WorkflowService,
	collaborationService: CollaborationService,
	workflowId: string,
	mutate: (nodes: INode[], conns: Connections, diff: PatchDiff) => string | undefined,
): Promise<{ applied: boolean; diff: PatchDiff; error?: string; noChanges?: boolean }> {
	const workflow = await getMcpWorkflow(workflowId, user, ['workflow:update'], workflowFinderService);
	const nodes: INode[] = structuredClone(workflow.nodes ?? []);
	const conns: Connections = structuredClone(asConns(workflow.connections ?? {}));
	const diff = emptyDiff();

	const errorMsg = mutate(nodes, conns, diff);
	if (errorMsg !== undefined) return { applied: false, diff, error: errorMsg };
	if (!hasDiff(diff)) return { applied: false, diff, noChanges: true };

	const updateData = new WorkflowEntity();
	Object.assign(updateData, { nodes, connections: conns as unknown as IConnections });
	await workflowService.update(user, updateData, workflowId, { source: 'n8n-mcp' });
	void collaborationService.broadcastWorkflowUpdate(workflowId, user.id).catch(() => {});

	return { applied: true, diff };
}

function toolError(msg: string) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
		structuredContent: { error: msg },
		isError: true as const,
	};
}

// ---------------------------------------------------------------------------
// Tool: update_node
// ---------------------------------------------------------------------------

const updateNodeSchema = {
	workflowId: z.string().describe('ID of the workflow'),
	nodeName: z.string().describe('Exact name of the node to patch'),
	patch: z.object({
		parameters: z.record(z.unknown()).optional().describe('Merged into existing parameters (partial update)'),
		position: z.tuple([z.number(), z.number()]).optional().describe('New [x, y] canvas position'),
		disabled: z.boolean().optional(),
		notes: z.string().nullable().optional(),
		typeVersion: z.number().optional(),
	}).describe('Fields to update — only provided fields are changed'),
} satisfies z.ZodRawShape;

export const createUpdateNodeTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	workflowService: WorkflowService,
	collaborationService: CollaborationService,
	telemetry: Telemetry,
): ToolDefinition<typeof updateNodeSchema> => ({
	name: 'update_node',
	config: {
		description:
			'Patch a single workflow node by name. Only specified fields are changed — node ID and credentials are always preserved.',
		inputSchema: updateNodeSchema,
		annotations: { title: 'Update Node', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	},
	handler: async ({ workflowId, nodeName, patch }: {
		workflowId: string;
		nodeName: string;
		patch: { parameters?: Record<string, unknown>; position?: [number, number]; disabled?: boolean; notes?: string | null; typeVersion?: number };
	}) => {
		const tel: UserCalledMCPToolEventPayload = { user_id: user.id, tool_name: 'update_node', parameters: { workflowId, nodeName } };
		try {
			const result = await applyPatch(user, workflowFinderService, workflowService, collaborationService, workflowId, (nodes, _conns, diff) => {
				const node = findNode(nodes, nodeName);
				if (!node) return `Node "${nodeName}" not found`;
				const changed: string[] = [];
				if (patch.parameters) {
					node.parameters = { ...(node.parameters ?? {}), ...patch.parameters } as INodeParameters;
					changed.push(...Object.keys(patch.parameters).map((k) => `parameters.${k}`));
				}
				if (patch.position !== undefined) { node.position = patch.position; changed.push('position'); }
				if (patch.disabled !== undefined) { node.disabled = patch.disabled; changed.push('disabled'); }
				if (patch.notes !== undefined) { node.notes = patch.notes ?? undefined; changed.push('notes'); }
				if (patch.typeVersion !== undefined) { node.typeVersion = patch.typeVersion; changed.push('typeVersion'); }
				if (changed.length > 0) diff.nodesUpdated.push({ nodeName, changedFields: changed });
				return undefined;
			});
			tel.results = { success: result.applied };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			tel.results = { success: false, error: msg };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return toolError(msg);
		}
	},
});

// ---------------------------------------------------------------------------
// Tool: add_node
// ---------------------------------------------------------------------------

const addNodeSchema = {
	workflowId: z.string().describe('ID of the workflow'),
	nodeSpec: z.object({
		name: z.string().min(1).describe('Unique node name (auto-suffixed if taken)'),
		type: z.string().min(1).describe('Node type e.g. n8n-nodes-base.httpRequest'),
		typeVersion: z.number().optional().describe('Node typeVersion (defaults to 1)'),
		position: z.tuple([z.number(), z.number()]).optional().describe('Canvas [x, y] (defaults to [0, 0])'),
		parameters: z.record(z.unknown()).optional(),
		disabled: z.boolean().optional(),
	}),
} satisfies z.ZodRawShape;

export const createAddNodeMcpTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	workflowService: WorkflowService,
	collaborationService: CollaborationService,
	telemetry: Telemetry,
): ToolDefinition<typeof addNodeSchema> => ({
	name: 'add_node',
	config: {
		description: 'Add a new node to a workflow. If the name is already taken, a unique suffix is appended.',
		inputSchema: addNodeSchema,
		annotations: { title: 'Add Node', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
	},
	handler: async ({ workflowId, nodeSpec }: {
		workflowId: string;
		nodeSpec: { name: string; type: string; typeVersion?: number; position?: [number, number]; parameters?: Record<string, unknown>; disabled?: boolean };
	}) => {
		const tel: UserCalledMCPToolEventPayload = { user_id: user.id, tool_name: 'add_node', parameters: { workflowId, nodeType: nodeSpec.type } };
		try {
			let addedName = '';
			const result = await applyPatch(user, workflowFinderService, workflowService, collaborationService, workflowId, (nodes, _conns, diff) => {
				const name = uniqueName(nodes, nodeSpec.name);
				const node: INode = {
					id: randomUUID(),
					name,
					type: nodeSpec.type,
					typeVersion: nodeSpec.typeVersion ?? 1,
					position: nodeSpec.position ?? [0, 0],
					parameters: (nodeSpec.parameters ?? {}) as INodeParameters,
					...(nodeSpec.disabled !== undefined ? { disabled: nodeSpec.disabled } : {}),
				};
				nodes.push(node);
				diff.nodesAdded.push(name);
				addedName = name;
				return undefined;
			});
			const output = { ...result, nodeName: addedName };
			tel.results = { success: result.applied };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			tel.results = { success: false, error: msg };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return toolError(msg);
		}
	},
});

// ---------------------------------------------------------------------------
// Tool: delete_node
// ---------------------------------------------------------------------------

const deleteNodeSchema = {
	workflowId: z.string().describe('ID of the workflow'),
	nodeName: z.string().describe('Exact name of the node to delete'),
} satisfies z.ZodRawShape;

export const createDeleteNodeTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	workflowService: WorkflowService,
	collaborationService: CollaborationService,
	telemetry: Telemetry,
): ToolDefinition<typeof deleteNodeSchema> => ({
	name: 'delete_node',
	config: {
		description: 'Delete a node from a workflow and remove all connections to/from it.',
		inputSchema: deleteNodeSchema,
		annotations: { title: 'Delete Node', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
	},
	handler: async ({ workflowId, nodeName }: { workflowId: string; nodeName: string }) => {
		const tel: UserCalledMCPToolEventPayload = { user_id: user.id, tool_name: 'delete_node', parameters: { workflowId, nodeName } };
		try {
			const result = await applyPatch(user, workflowFinderService, workflowService, collaborationService, workflowId, (nodes, conns, diff) => {
				const idx = nodes.findIndex((n) => n.name === nodeName);
				if (idx === -1) return `Node "${nodeName}" not found`;
				nodes.splice(idx, 1);
				diff.nodesRemoved.push(nodeName);
				removeAllConns(conns, nodeName, diff);
				return undefined;
			});
			tel.results = { success: result.applied };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			tel.results = { success: false, error: msg };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return toolError(msg);
		}
	},
});

// ---------------------------------------------------------------------------
// Tool: connect_nodes
// ---------------------------------------------------------------------------

const connectNodesSchema = {
	workflowId: z.string().describe('ID of the workflow'),
	fromNode: z.string().describe('Source node name'),
	toNode: z.string().describe('Target node name'),
	outputIndex: z.number().int().min(0).optional().describe('Output slot index (default 0)'),
	inputIndex: z.number().int().min(0).optional().describe('Input slot index (default 0)'),
} satisfies z.ZodRawShape;

export const createConnectNodesTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	workflowService: WorkflowService,
	collaborationService: CollaborationService,
	telemetry: Telemetry,
): ToolDefinition<typeof connectNodesSchema> => ({
	name: 'connect_nodes',
	config: {
		description: 'Create a connection between two nodes. Duplicate connections are silently ignored.',
		inputSchema: connectNodesSchema,
		annotations: { title: 'Connect Nodes', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	},
	handler: async ({ workflowId, fromNode, toNode, outputIndex, inputIndex }: {
		workflowId: string; fromNode: string; toNode: string; outputIndex?: number; inputIndex?: number;
	}) => {
		const tel: UserCalledMCPToolEventPayload = { user_id: user.id, tool_name: 'connect_nodes', parameters: { workflowId, fromNode, toNode } };
		try {
			const result = await applyPatch(user, workflowFinderService, workflowService, collaborationService, workflowId, (nodes, conns, diff) => {
				if (!findNode(nodes, fromNode)) return `Node "${fromNode}" not found`;
				if (!findNode(nodes, toNode)) return `Node "${toNode}" not found`;
				addConn(conns, fromNode, toNode, outputIndex ?? 0, inputIndex ?? 0, diff);
				return undefined;
			});
			tel.results = { success: result.applied };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			tel.results = { success: false, error: msg };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return toolError(msg);
		}
	},
});

// ---------------------------------------------------------------------------
// Tool: disconnect_nodes
// ---------------------------------------------------------------------------

const disconnectNodesSchema = {
	workflowId: z.string().describe('ID of the workflow'),
	fromNode: z.string().describe('Source node name'),
	toNode: z.string().describe('Target node name'),
} satisfies z.ZodRawShape;

export const createDisconnectNodesTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	workflowService: WorkflowService,
	collaborationService: CollaborationService,
	telemetry: Telemetry,
): ToolDefinition<typeof disconnectNodesSchema> => ({
	name: 'disconnect_nodes',
	config: {
		description: 'Remove all connections from one node to another.',
		inputSchema: disconnectNodesSchema,
		annotations: { title: 'Disconnect Nodes', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
	},
	handler: async ({ workflowId, fromNode, toNode }: { workflowId: string; fromNode: string; toNode: string }) => {
		const tel: UserCalledMCPToolEventPayload = { user_id: user.id, tool_name: 'disconnect_nodes', parameters: { workflowId, fromNode, toNode } };
		try {
			const result = await applyPatch(user, workflowFinderService, workflowService, collaborationService, workflowId, (nodes, conns, diff) => {
				if (!findNode(nodes, fromNode)) return `Node "${fromNode}" not found`;
				if (!findNode(nodes, toNode)) return `Node "${toNode}" not found`;
				removeConnsBetween(conns, fromNode, toNode, diff);
				return undefined;
			});
			tel.results = { success: result.applied };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			tel.results = { success: false, error: msg };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return toolError(msg);
		}
	},
});

// ---------------------------------------------------------------------------
// Tool: add_normalize_agent_output_node
// ---------------------------------------------------------------------------

const addNormalizeSchema = {
	workflowId: z.string().describe('ID of the workflow'),
	afterNodeName: z.string().describe('Insert normalizer directly after this node, rewiring its existing outputs'),
} satisfies z.ZodRawShape;

export const createAddNormalizeAgentOutputNodeTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	workflowService: WorkflowService,
	collaborationService: CollaborationService,
	telemetry: Telemetry,
): ToolDefinition<typeof addNormalizeSchema> => ({
	name: 'add_normalize_agent_output_node',
	config: {
		description:
			'Insert a Code node after a node that normalizes AI/agent output with `return [{ json: $json.output || $json }];`. Previous downstream connections are rewired through the normalizer.',
		inputSchema: addNormalizeSchema,
		annotations: { title: 'Add Normalize Agent Output Node', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
	},
	handler: async ({ workflowId, afterNodeName }: { workflowId: string; afterNodeName: string }) => {
		const tel: UserCalledMCPToolEventPayload = { user_id: user.id, tool_name: 'add_normalize_agent_output_node', parameters: { workflowId, afterNodeName } };
		try {
			let insertedNodeName = '';
			const result = await applyPatch(user, workflowFinderService, workflowService, collaborationService, workflowId, (nodes, conns, diff) => {
				const after = findNode(nodes, afterNodeName);
				if (!after) return `Node "${afterNodeName}" not found`;

				const normName = uniqueName(nodes, 'Normalize Agent Output');
				const normNode: INode = {
					id: randomUUID(),
					name: normName,
					type: 'n8n-nodes-base.code',
					typeVersion: 2,
					position: [after.position[0] + 260, after.position[1]],
					parameters: { jsCode: 'return [{ json: $json.output || $json }];' } as INodeParameters,
				};
				nodes.push(normNode);
				diff.nodesAdded.push(normName);
				insertedNodeName = normName;

				const existingSlots = conns[afterNodeName]?.main ?? [];
				const prevTargets: Array<{ node: string; index: number; outputIndex: number }> = [];
				for (let oi = 0; oi < existingSlots.length; oi++) {
					const slot = existingSlots[oi];
					if (!slot) continue;
					for (const e of slot) {
						prevTargets.push({ node: e.node, index: e.index, outputIndex: oi });
						diff.connectionsRemoved.push({ fromNode: afterNodeName, toNode: e.node, outputIndex: oi, inputIndex: e.index });
					}
				}

				if (conns[afterNodeName]) conns[afterNodeName].main = [];
				addConn(conns, afterNodeName, normName, 0, 0, diff);
				for (const t of prevTargets) {
					addConn(conns, normName, t.node, 0, t.index, diff);
				}
				return undefined;
			});
			const output = { ...result, insertedNodeName };
			tel.results = { success: result.applied };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			tel.results = { success: false, error: msg };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return toolError(msg);
		}
	},
});

// ---------------------------------------------------------------------------
// Tool: patch_workflow_safe
// ---------------------------------------------------------------------------

const patchOpSchema = z.discriminatedUnion('op', [
	z.object({
		op: z.literal('updateNode'),
		nodeName: z.string(),
		patch: z.object({
			parameters: z.record(z.unknown()).optional(),
			disabled: z.boolean().optional(),
			notes: z.string().nullable().optional(),
		}),
	}),
	z.object({
		op: z.literal('connectNodes'),
		fromNode: z.string(),
		toNode: z.string(),
		outputIndex: z.number().int().min(0).optional(),
		inputIndex: z.number().int().min(0).optional(),
	}),
	z.object({
		op: z.literal('disconnectNodes'),
		fromNode: z.string(),
		toNode: z.string(),
	}),
]);

const patchWorkflowSafeSchema = {
	workflowId: z.string().describe('ID of the workflow'),
	operations: z.array(patchOpSchema).min(1).describe(
		'Atomic operations to apply in order. Supported ops: updateNode, connectNodes, disconnectNodes.',
	),
} satisfies z.ZodRawShape;

type PatchOp = z.infer<typeof patchOpSchema>;

export const createPatchWorkflowSafeTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	workflowService: WorkflowService,
	collaborationService: CollaborationService,
	telemetry: Telemetry,
): ToolDefinition<typeof patchWorkflowSafeSchema> => ({
	name: 'patch_workflow_safe',
	config: {
		description:
			'Apply multiple targeted patches atomically in a single save — all succeed or none are saved. Supports: updateNode, connectNodes, disconnectNodes.',
		inputSchema: patchWorkflowSafeSchema,
		annotations: { title: 'Patch Workflow Safe', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
	},
	handler: async ({ workflowId, operations }: { workflowId: string; operations: PatchOp[] }) => {
		const tel: UserCalledMCPToolEventPayload = { user_id: user.id, tool_name: 'patch_workflow_safe', parameters: { workflowId, opCount: operations.length } };
		try {
			const result = await applyPatch(user, workflowFinderService, workflowService, collaborationService, workflowId, (nodes, conns, diff) => {
				for (const op of operations) {
					if (op.op === 'updateNode') {
						const node = findNode(nodes, op.nodeName);
						if (!node) return `Node "${op.nodeName}" not found`;
						const changed: string[] = [];
						if (op.patch.parameters) {
							node.parameters = { ...(node.parameters ?? {}), ...op.patch.parameters } as INodeParameters;
							changed.push(...Object.keys(op.patch.parameters).map((k) => `parameters.${k}`));
						}
						if (op.patch.disabled !== undefined) { node.disabled = op.patch.disabled; changed.push('disabled'); }
						if (op.patch.notes !== undefined) { node.notes = op.patch.notes ?? undefined; changed.push('notes'); }
						if (changed.length > 0) diff.nodesUpdated.push({ nodeName: op.nodeName, changedFields: changed });
					} else if (op.op === 'connectNodes') {
						if (!findNode(nodes, op.fromNode)) return `Node "${op.fromNode}" not found`;
						if (!findNode(nodes, op.toNode)) return `Node "${op.toNode}" not found`;
						addConn(conns, op.fromNode, op.toNode, op.outputIndex ?? 0, op.inputIndex ?? 0, diff);
					} else {
						removeConnsBetween(conns, op.fromNode, op.toNode, diff);
					}
				}
				return undefined;
			});
			tel.results = { success: result.applied };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			tel.results = { success: false, error: msg };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, tel);
			return toolError(msg);
		}
	},
});
