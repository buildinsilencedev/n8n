import { createTool } from '@mastra/core/tools';
import type { IDataObject, NodeJSON, WorkflowJSON } from '@n8n/workflow-sdk';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { sanitizeInputSchema } from '../agent/sanitize-mcp-schemas';
import type { InstanceAiContext } from '../types';
import { getValidCredentialTypes } from './workflows/setup-workflow.service';

interface WorkflowConnectionEntry {
	node: string;
	type?: string;
	index?: number;
}

type WorkflowConnections = Record<string, Record<string, Array<WorkflowConnectionEntry[] | null>>>;
type NamedNode = NodeJSON & { name: string };
type MutationExtra = Record<string, unknown> | undefined;

interface ConnectionDiffEntry {
	fromNode: string;
	toNode: string;
	outputIndex: number;
	inputIndex: number;
}

interface NodeDiffEntry {
	nodeName: string;
	changedFields: string[];
}

interface WorkflowControlDiff {
	nodesAdded: string[];
	nodesRemoved: string[];
	nodesUpdated: NodeDiffEntry[];
	connectionsAdded: ConnectionDiffEntry[];
	connectionsRemoved: ConnectionDiffEntry[];
}

type MutatingCommandName =
	| 'updateNode'
	| 'addNode'
	| 'deleteNode'
	| 'connectNodes'
	| 'disconnectNodes'
	| 'bindCredential'
	| 'addNormalizeAgentOutputNode'
	| 'addIsolatedHealthCheckTrigger';

const nodePatchSchema = z
	.object({
		parameters: z.record(z.unknown()).optional(),
		position: z.tuple([z.number(), z.number()]).optional(),
		disabled: z.boolean().optional(),
		notes: z.string().nullable().optional(),
		webhookId: z.string().optional(),
		typeVersion: z.number().optional(),
	})
	.strict();

const nodeSpecSchema = z
	.object({
		name: z.string().min(1).describe('Unique node name'),
		type: z.string().min(1).describe('Node type, e.g. n8n-nodes-base.httpRequest'),
		typeVersion: z.number().optional().describe('Node typeVersion'),
		position: z
			.tuple([z.number(), z.number()])
			.optional()
			.describe('Canvas position [x, y], defaults to [0, 0]'),
		parameters: z.record(z.unknown()).optional().describe('Node parameters'),
		disabled: z.boolean().optional(),
		notes: z.string().nullable().optional(),
		webhookId: z.string().optional(),
	})
	.strict();

const updateNodeCommand = z.object({
	command: z.literal('updateNode'),
	workflowId: z.string(),
	nodeName: z.string(),
	patch: nodePatchSchema,
});

const addNodeCommand = z.object({
	command: z.literal('addNode'),
	workflowId: z.string(),
	nodeSpec: nodeSpecSchema,
});

const deleteNodeCommand = z.object({
	command: z.literal('deleteNode'),
	workflowId: z.string(),
	nodeName: z.string(),
});

const connectNodesCommand = z.object({
	command: z.literal('connectNodes'),
	workflowId: z.string(),
	fromNode: z.string(),
	toNode: z.string(),
	outputIndex: z.number().int().min(0).optional(),
	inputIndex: z.number().int().min(0).optional(),
});

const disconnectNodesCommand = z.object({
	command: z.literal('disconnectNodes'),
	workflowId: z.string(),
	fromNode: z.string(),
	toNode: z.string(),
});

const verifyCredentialsCommand = z.object({
	command: z.literal('verifyCredentials'),
	workflowId: z.string(),
});

const bindCredentialCommand = z.object({
	command: z.literal('bindCredential'),
	workflowId: z.string(),
	nodeName: z.string(),
	credentialId: z.string(),
});

const simulateTelegramMessageCommand = z.object({
	command: z.literal('simulateTelegramMessage'),
	workflowId: z.string(),
	chatId: z.union([z.number(), z.string()]),
	text: z.string(),
});

const addNormalizeAgentOutputNodeCommand = z.object({
	command: z.literal('addNormalizeAgentOutputNode'),
	workflowId: z.string(),
	afterNodeName: z.string(),
});

const addIsolatedHealthCheckTriggerCommand = z.object({
	command: z.literal('addIsolatedHealthCheckTrigger'),
	workflowId: z.string(),
});

const inputSchema = sanitizeInputSchema(
	z.discriminatedUnion('command', [
		updateNodeCommand,
		addNodeCommand,
		deleteNodeCommand,
		connectNodesCommand,
		disconnectNodesCommand,
		verifyCredentialsCommand,
		bindCredentialCommand,
		simulateTelegramMessageCommand,
		addNormalizeAgentOutputNodeCommand,
		addIsolatedHealthCheckTriggerCommand,
	]),
);

type Input = z.infer<typeof inputSchema>;

function createEmptyDiff(): WorkflowControlDiff {
	return {
		nodesAdded: [],
		nodesRemoved: [],
		nodesUpdated: [],
		connectionsAdded: [],
		connectionsRemoved: [],
	};
}

function hasDiff(diff: WorkflowControlDiff): boolean {
	return (
		diff.nodesAdded.length > 0 ||
		diff.nodesRemoved.length > 0 ||
		diff.nodesUpdated.length > 0 ||
		diff.connectionsAdded.length > 0 ||
		diff.connectionsRemoved.length > 0
	);
}

function getConnections(workflow: WorkflowJSON): WorkflowConnections {
	if (!workflow.connections || typeof workflow.connections !== 'object') {
		workflow.connections = {};
	}
	return workflow.connections as WorkflowConnections;
}

function findNode(workflow: WorkflowJSON, nodeName: string): NamedNode | undefined {
	return workflow.nodes.find((node): node is NamedNode => node.name === nodeName);
}

function getMainOutputSlots(
	connections: WorkflowConnections,
	sourceNodeName: string,
	create = false,
): Array<WorkflowConnectionEntry[] | null> {
	const sourceConnections = connections[sourceNodeName];
	if (!sourceConnections) {
		if (!create) return [];
		connections[sourceNodeName] = { main: [] };
		return connections[sourceNodeName].main;
	}

	const existingMain = sourceConnections.main;
	if (!existingMain) {
		if (!create) return [];
		sourceConnections.main = [];
	}

	return sourceConnections.main ?? [];
}

function ensureMainOutputSlot(
	connections: WorkflowConnections,
	sourceNodeName: string,
	outputIndex: number,
): WorkflowConnectionEntry[] {
	const outputs = getMainOutputSlots(connections, sourceNodeName, true);
	while (outputs.length <= outputIndex) {
		outputs.push(null);
	}
	const slot = outputs[outputIndex];
	if (slot === null) {
		outputs[outputIndex] = [];
	}
	return (outputs[outputIndex] ??= []);
}

function cleanupSourceConnections(
	connections: WorkflowConnections,
	sourceNodeName: string,
): void {
	const sourceConnections = connections[sourceNodeName];
	if (!sourceConnections) return;

	for (const [connectionType, outputs] of Object.entries(sourceConnections)) {
		const normalizedOutputs = outputs.map((slot) => {
			if (slot === null || slot.length === 0) return null;
			return slot;
		});
		const hasAny = normalizedOutputs.some((slot) => slot !== null && slot.length > 0);
		if (!hasAny) {
			delete sourceConnections[connectionType];
		} else {
			sourceConnections[connectionType] = normalizedOutputs;
		}
	}

	if (Object.keys(sourceConnections).length === 0) {
		delete connections[sourceNodeName];
	}
}

function addMainConnection(
	connections: WorkflowConnections,
	fromNode: string,
	toNode: string,
	outputIndex: number,
	inputIndex: number,
	diff: WorkflowControlDiff,
): void {
	const outputSlot = ensureMainOutputSlot(connections, fromNode, outputIndex);
	const alreadyConnected = outputSlot.some(
		(entry) => entry.node === toNode && (entry.index ?? 0) === inputIndex,
	);
	if (alreadyConnected) return;

	outputSlot.push({
		node: toNode,
		type: 'main',
		index: inputIndex,
	});
	diff.connectionsAdded.push({
		fromNode,
		toNode,
		outputIndex,
		inputIndex,
	});
}

function removeMatchingMainConnections(
	connections: WorkflowConnections,
	fromNode: string,
	toNode: string,
	diff: WorkflowControlDiff,
): void {
	const outputs = getMainOutputSlots(connections, fromNode);
	if (outputs.length === 0) return;

	for (let outputIndex = 0; outputIndex < outputs.length; outputIndex++) {
		const slot = outputs[outputIndex];
		if (!slot || slot.length === 0) continue;

		const retained: WorkflowConnectionEntry[] = [];
		for (const entry of slot) {
			if (entry.node === toNode) {
				diff.connectionsRemoved.push({
					fromNode,
					toNode,
					outputIndex,
					inputIndex: entry.index ?? 0,
				});
				continue;
			}
			retained.push(entry);
		}

		outputs[outputIndex] = retained.length > 0 ? retained : null;
	}

	cleanupSourceConnections(connections, fromNode);
}

function removeNodeConnections(
	connections: WorkflowConnections,
	nodeName: string,
	diff: WorkflowControlDiff,
): void {
	const outgoing = connections[nodeName];
	if (outgoing) {
		const mainOutputs = outgoing.main ?? [];
		for (let outputIndex = 0; outputIndex < mainOutputs.length; outputIndex++) {
			const slot = mainOutputs[outputIndex];
			if (!slot) continue;
			for (const entry of slot) {
				diff.connectionsRemoved.push({
					fromNode: nodeName,
					toNode: entry.node,
					outputIndex,
					inputIndex: entry.index ?? 0,
				});
			}
		}
		delete connections[nodeName];
	}

	for (const [sourceNodeName, sourceConnections] of Object.entries(connections)) {
		for (const outputs of Object.values(sourceConnections)) {
			for (let outputIndex = 0; outputIndex < outputs.length; outputIndex++) {
				const slot = outputs[outputIndex];
				if (!slot || slot.length === 0) continue;

				const retained: WorkflowConnectionEntry[] = [];
				for (const entry of slot) {
					if (entry.node === nodeName) {
						diff.connectionsRemoved.push({
							fromNode: sourceNodeName,
							toNode: nodeName,
							outputIndex,
							inputIndex: entry.index ?? 0,
						});
						continue;
					}
					retained.push(entry);
				}
				outputs[outputIndex] = retained.length > 0 ? retained : null;
			}
		}

		cleanupSourceConnections(connections, sourceNodeName);
	}
}

function uniqueNodeName(workflow: WorkflowJSON, baseName: string): string {
	const taken = new Set(workflow.nodes.map((node) => node.name));
	if (!taken.has(baseName)) return baseName;

	let suffix = 2;
	while (taken.has(`${baseName} ${String(suffix)}`)) {
		suffix++;
	}
	return `${baseName} ${String(suffix)}`;
}

function normalizeDataArrayItem(value: unknown): string | number | boolean | object | IDataObject | null {
	if (value === null) return null;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'object') return value;
	return null;
}

function normalizeDataValue(value: unknown): IDataObject[string] {
	if (value === null || value === undefined) return value;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => normalizeDataArrayItem(item));
	}
	if (typeof value === 'object') {
		return value;
	}
	return undefined;
}

function normalizeParameters(parameters: Record<string, unknown> | undefined): IDataObject {
	const normalized: IDataObject = {};
	if (!parameters) return normalized;
	for (const [key, value] of Object.entries(parameters)) {
		normalized[key] = normalizeDataValue(value);
	}
	return normalized;
}

function normalizeNodeForAdd(
	workflow: WorkflowJSON,
	nodeSpec: z.infer<typeof nodeSpecSchema>,
): NamedNode {
	const node: NamedNode = {
		id: randomUUID(),
		name: nodeSpec.name,
		type: nodeSpec.type,
		typeVersion: nodeSpec.typeVersion ?? 1,
		position: nodeSpec.position ?? [0, 0],
		parameters: normalizeParameters(nodeSpec.parameters),
	};

	if (nodeSpec.disabled !== undefined) {
		node.disabled = nodeSpec.disabled;
	}
	if (nodeSpec.notes !== undefined) {
		node.notes = nodeSpec.notes ?? undefined;
	}
	if (nodeSpec.webhookId) {
		node.webhookId = nodeSpec.webhookId;
	}

	if (node.type === 'n8n-nodes-base.webhook' && !node.webhookId) {
		node.webhookId = randomUUID();
	}

	if (!findNode(workflow, node.name)) {
		return node;
	}

	const uniqueName = uniqueNodeName(workflow, node.name);
	return {
		...node,
		name: uniqueName,
	};
}

function parseChatId(chatId: string | number): number {
	if (typeof chatId === 'number') return chatId;
	const parsed = Number(chatId);
	if (!Number.isFinite(parsed)) return 0;
	return parsed;
}

function isTelegramTriggerNode(node: NodeJSON): boolean {
	return node.type === 'n8n-nodes-base.telegramTrigger' || node.type.includes('telegramTrigger');
}

function createMutatingResult(
	command: MutatingCommandName,
	workflowId: string,
	diff: WorkflowControlDiff,
	applied: boolean,
	extra?: Record<string, unknown>,
) {
	return {
		command,
		workflowId,
		diff,
		applied,
		...(extra ?? {}),
	};
}

async function applyMutation(
	context: InstanceAiContext,
	workflowId: string,
	command: MutatingCommandName,
	mutate: (workflow: WorkflowJSON, diff: WorkflowControlDiff) => MutationExtra | Promise<MutationExtra>,
) {
	const workflow = await context.workflowService.getAsWorkflowJSON(workflowId);
	const diff = createEmptyDiff();
	const extra = (await mutate(workflow, diff)) ?? {};
	if ('error' in extra && typeof extra.error === 'string') {
		return createMutatingResult(command, workflowId, diff, false, extra);
	}

	if (!hasDiff(diff)) {
		return createMutatingResult(command, workflowId, diff, false, {
			noChanges: true,
			...extra,
		});
	}

	await context.workflowService.updateFromWorkflowJSON(workflowId, workflow);
	return createMutatingResult(command, workflowId, diff, true, extra);
}

async function handleUpdateNode(context: InstanceAiContext, input: z.infer<typeof updateNodeCommand>) {
	return await applyMutation(context, input.workflowId, input.command, (workflow, diff) => {
		const node = findNode(workflow, input.nodeName);
		if (!node) {
			return { error: `Node "${input.nodeName}" not found` };
		}

		const changedFields: string[] = [];
		if (input.patch.parameters) {
			const mergedParameters: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(node.parameters ?? {})) {
				mergedParameters[key] = value;
			}
			for (const [key, value] of Object.entries(input.patch.parameters)) {
				mergedParameters[key] = value;
			}
			node.parameters = normalizeParameters(mergedParameters);
			for (const key of Object.keys(input.patch.parameters)) {
				changedFields.push(`parameters.${key}`);
			}
		}

		if (input.patch.position) {
			node.position = input.patch.position;
			changedFields.push('position');
		}

		if (input.patch.disabled !== undefined) {
			node.disabled = input.patch.disabled;
			changedFields.push('disabled');
		}

		if (input.patch.notes !== undefined) {
			node.notes = input.patch.notes ?? undefined;
			changedFields.push('notes');
		}

		if (input.patch.webhookId !== undefined) {
			node.webhookId = input.patch.webhookId;
			changedFields.push('webhookId');
		}

		if (input.patch.typeVersion !== undefined) {
			node.typeVersion = input.patch.typeVersion;
			changedFields.push('typeVersion');
		}

		if (changedFields.length > 0) {
		diff.nodesUpdated.push({
				nodeName: node.name,
				changedFields,
			});
		}
		return undefined;
	});
}

async function handleAddNode(context: InstanceAiContext, input: z.infer<typeof addNodeCommand>) {
	return await applyMutation(context, input.workflowId, input.command, (workflow, diff) => {
		if (findNode(workflow, input.nodeSpec.name)) {
			return { error: `Node "${input.nodeSpec.name}" already exists` };
		}

		const node = normalizeNodeForAdd(workflow, input.nodeSpec);
		workflow.nodes.push(node);
		diff.nodesAdded.push(node.name);
		return { nodeName: node.name };
	});
}

async function handleDeleteNode(context: InstanceAiContext, input: z.infer<typeof deleteNodeCommand>) {
	return await applyMutation(context, input.workflowId, input.command, (workflow, diff) => {
		const nodeIndex = workflow.nodes.findIndex((node) => node.name === input.nodeName);
		if (nodeIndex === -1) {
			return { error: `Node "${input.nodeName}" not found` };
		}

		workflow.nodes.splice(nodeIndex, 1);
		diff.nodesRemoved.push(input.nodeName);

		const connections = getConnections(workflow);
		removeNodeConnections(connections, input.nodeName, diff);
		return undefined;
	});
}

async function handleConnectNodes(context: InstanceAiContext, input: z.infer<typeof connectNodesCommand>) {
	return await applyMutation(context, input.workflowId, input.command, (workflow, diff) => {
		const sourceNode = findNode(workflow, input.fromNode);
		if (!sourceNode) {
			return { error: `Source node "${input.fromNode}" not found` };
		}
		const targetNode = findNode(workflow, input.toNode);
		if (!targetNode) {
			return { error: `Target node "${input.toNode}" not found` };
		}

		const outputIndex = input.outputIndex ?? 0;
		const inputIndex = input.inputIndex ?? 0;
		const connections = getConnections(workflow);
		addMainConnection(connections, input.fromNode, input.toNode, outputIndex, inputIndex, diff);
		return undefined;
	});
}

async function handleDisconnectNodes(
	context: InstanceAiContext,
	input: z.infer<typeof disconnectNodesCommand>,
) {
	return await applyMutation(context, input.workflowId, input.command, (workflow, diff) => {
		const sourceNode = findNode(workflow, input.fromNode);
		if (!sourceNode) {
			return { error: `Source node "${input.fromNode}" not found` };
		}
		const targetNode = findNode(workflow, input.toNode);
		if (!targetNode) {
			return { error: `Target node "${input.toNode}" not found` };
		}

		const connections = getConnections(workflow);
		removeMatchingMainConnections(connections, input.fromNode, input.toNode, diff);
		return undefined;
	});
}

async function handleVerifyCredentials(
	context: InstanceAiContext,
	input: z.infer<typeof verifyCredentialsCommand>,
) {
	const workflow = await context.workflowService.getAsWorkflowJSON(input.workflowId);
	const nodesWithCredentialNeeds: Array<{
		nodeName: string;
		nodeType: string;
		requiredCredentials: Array<{
			credentialType: string;
			bound: boolean;
			credentialId?: string;
			credentialName?: string;
		}>;
		allRequiredCredentialsBound: boolean;
	}> = [];

	for (const node of workflow.nodes) {
		if (!node.name) continue;
		const requiredTypes = [...(await getValidCredentialTypes(context, node))];
		if (requiredTypes.length === 0) continue;

		const requiredCredentials = requiredTypes.map((credentialType) => {
			const boundCredential = node.credentials?.[credentialType];
			return {
				credentialType,
				bound: boundCredential?.id !== undefined,
				...(boundCredential?.id ? { credentialId: boundCredential.id } : {}),
				...(boundCredential?.name ? { credentialName: boundCredential.name } : {}),
			};
		});

		nodesWithCredentialNeeds.push({
			nodeName: node.name,
			nodeType: node.type,
			requiredCredentials,
			allRequiredCredentialsBound: requiredCredentials.every((entry) => entry.bound),
		});
	}

	return {
		command: input.command,
		workflowId: input.workflowId,
		nodes: nodesWithCredentialNeeds,
		totalCredentialRequiringNodes: nodesWithCredentialNeeds.length,
		fullyBoundNodes: nodesWithCredentialNeeds.filter((n) => n.allRequiredCredentialsBound).length,
	};
}

async function handleBindCredential(context: InstanceAiContext, input: z.infer<typeof bindCredentialCommand>) {
	return await applyMutation(context, input.workflowId, input.command, async (workflow, diff) => {
		const node = findNode(workflow, input.nodeName);
		if (!node) {
			return { error: `Node "${input.nodeName}" not found` };
		}

		const credential = await context.credentialService.get(input.credentialId);
		if (!credential) {
			return { error: `Credential "${input.credentialId}" not found` };
		}

		const requiredTypes = await getValidCredentialTypes(context, node);
		if (!requiredTypes.has(credential.type)) {
			return {
				error: `Credential type "${credential.type}" is not compatible with node "${node.name}". Required types: ${[...requiredTypes].join(', ') || 'none'}`,
			};
		}

		node.credentials = {
			...(node.credentials ?? {}),
			[credential.type]: { id: credential.id, name: credential.name },
		};

		diff.nodesUpdated.push({
			nodeName: node.name,
			changedFields: [`credentials.${credential.type}`],
		});
		return {
			nodeName: node.name,
			credentialType: credential.type,
			credentialId: credential.id,
		};
	});
}

async function handleSimulateTelegramMessage(
	context: InstanceAiContext,
	input: z.infer<typeof simulateTelegramMessageCommand>,
) {
	const workflow = await context.workflowService.getAsWorkflowJSON(input.workflowId);
	const telegramTrigger = workflow.nodes.find(
		(node): node is NamedNode => isTelegramTriggerNode(node) && !!node.name,
	);
	if (!telegramTrigger) {
		return {
			command: input.command,
			workflowId: input.workflowId,
			success: false,
			error: 'No Telegram Trigger node found in workflow',
		};
	}

	const now = Date.now();
	const chatId = parseChatId(input.chatId);
	const payload = {
		update_id: now,
		message: {
			message_id: Math.floor(now / 1000),
			from: {
				id: chatId,
				is_bot: false,
				first_name: 'Instance',
				username: 'instance_ai',
			},
			chat: {
				id: chatId,
				type: 'private',
			},
			date: Math.floor(now / 1000),
			text: input.text,
		},
	};

	const execution = await context.executionService.run(input.workflowId, payload, {
		triggerNodeName: telegramTrigger.name,
	});

	return {
		command: input.command,
		workflowId: input.workflowId,
		triggerNodeName: telegramTrigger.name,
		payload,
		execution,
	};
}

async function handleAddNormalizeAgentOutputNode(
	context: InstanceAiContext,
	input: z.infer<typeof addNormalizeAgentOutputNodeCommand>,
) {
	return await applyMutation(context, input.workflowId, input.command, (workflow, diff) => {
		const afterNode = findNode(workflow, input.afterNodeName);
		if (!afterNode) {
			return { error: `Node "${input.afterNodeName}" not found` };
		}

		const normalizeNodeName = uniqueNodeName(workflow, 'Normalize Agent Output');
		const normalizeNode: NamedNode = {
			id: randomUUID(),
			name: normalizeNodeName,
			type: 'n8n-nodes-base.code',
			typeVersion: 2,
			position: [afterNode.position[0] + 260, afterNode.position[1]],
			parameters: {
				jsCode: 'return [{ json: $json.output || $json }];',
			},
		};
		workflow.nodes.push(normalizeNode);
		diff.nodesAdded.push(normalizeNode.name);

		const connections = getConnections(workflow);
		const existingOutputs = getMainOutputSlots(connections, afterNode.name);
		const previousTargets: Array<{ node: string; index: number; outputIndex: number }> = [];

		for (let outputIndex = 0; outputIndex < existingOutputs.length; outputIndex++) {
			const slot = existingOutputs[outputIndex];
			if (!slot) continue;
			for (const entry of slot) {
				previousTargets.push({
					node: entry.node,
					index: entry.index ?? 0,
					outputIndex,
				});
				diff.connectionsRemoved.push({
					fromNode: afterNode.name,
					toNode: entry.node,
					outputIndex,
					inputIndex: entry.index ?? 0,
				});
			}
		}

		const sourceConnections: WorkflowConnections[string] = connections[afterNode.name] ?? {};
		sourceConnections.main = [];
		connections[afterNode.name] = sourceConnections;

		addMainConnection(connections, afterNode.name, normalizeNode.name, 0, 0, diff);

		for (const target of previousTargets) {
			addMainConnection(connections, normalizeNode.name, target.node, 0, target.index, diff);
		}

		return {
			insertedNodeName: normalizeNode.name,
			rewiredAfterNode: afterNode.name,
		};
	});
}

function hasBannedConnectionTarget(
	workflow: WorkflowJSON,
	sourceNodeName: string,
	targetNodeName: string,
): boolean {
	const sourceNode = findNode(workflow, sourceNodeName);
	const targetNode = findNode(workflow, targetNodeName);
	if (!sourceNode || !targetNode) return false;

	const bannedFragments = ['telegram', 'gmail', 'hunter', 'langchain', 'ai'];
	const sourceType = sourceNode.type.toLowerCase();
	const targetType = targetNode.type.toLowerCase();

	return bannedFragments.some(
		(fragment) => sourceType.includes(fragment) || targetType.includes(fragment),
	);
}

async function handleAddIsolatedHealthCheckTrigger(
	context: InstanceAiContext,
	input: z.infer<typeof addIsolatedHealthCheckTriggerCommand>,
) {
	return await applyMutation(context, input.workflowId, input.command, (workflow, diff) => {
		const triggerNodeName = uniqueNodeName(workflow, 'Health Check Trigger');
		const outputNodeName = uniqueNodeName(workflow, 'Health Output');
		const now = Date.now();

		const triggerNode: NodeJSON = {
			id: randomUUID(),
			name: triggerNodeName,
			type: 'n8n-nodes-base.webhook',
			typeVersion: 2,
			position: [0, 300],
			webhookId: randomUUID(),
			parameters: {
				httpMethod: 'GET',
				path: `instance-ai-health-${String(now)}`,
				responseMode: 'onReceived',
			},
		};

		const outputNode: NodeJSON = {
			id: randomUUID(),
			name: outputNodeName,
			type: 'n8n-nodes-base.code',
			typeVersion: 2,
			position: [280, 300],
			parameters: {
				jsCode: "return [{ json: { status: 'ok' } }];",
			},
		};

		workflow.nodes.push(triggerNode, outputNode);
		diff.nodesAdded.push(triggerNodeName, outputNodeName);

		const connections = getConnections(workflow);
		addMainConnection(connections, triggerNodeName, outputNodeName, 0, 0, diff);

		const healthConnectionTouchesBannedNode = hasBannedConnectionTarget(
			workflow,
			triggerNodeName,
			outputNodeName,
		);

		return {
			triggerNodeName,
			outputNodeName,
			isolated: true,
			healthConnectionTouchesBannedNode,
		};
	});
}

function withMutationError(result: Awaited<ReturnType<typeof applyMutation>>) {
	if ('error' in result && typeof result.error === 'string') {
		return {
			...result,
			applied: false,
		};
	}
	return result;
}

export function createWorkflowControlTool(context: InstanceAiContext) {
	return createTool({
		id: 'workflow-control',
		description:
			'Patch-first workflow control for safe node-level edits, connection changes, credential checks, credential binding, Telegram simulation, and health/normalization branch insertion.',
		inputSchema,
		execute: async (input: Input) => {
			switch (input.command) {
				case 'updateNode':
					return withMutationError(await handleUpdateNode(context, input));
				case 'addNode':
					return withMutationError(await handleAddNode(context, input));
				case 'deleteNode':
					return withMutationError(await handleDeleteNode(context, input));
				case 'connectNodes':
					return withMutationError(await handleConnectNodes(context, input));
				case 'disconnectNodes':
					return withMutationError(await handleDisconnectNodes(context, input));
				case 'verifyCredentials':
					return await handleVerifyCredentials(context, input);
				case 'bindCredential':
					return withMutationError(await handleBindCredential(context, input));
				case 'simulateTelegramMessage':
					return await handleSimulateTelegramMessage(context, input);
				case 'addNormalizeAgentOutputNode':
					return withMutationError(await handleAddNormalizeAgentOutputNode(context, input));
				case 'addIsolatedHealthCheckTrigger':
					return withMutationError(await handleAddIsolatedHealthCheckTrigger(context, input));
			}
		},
	});
}
