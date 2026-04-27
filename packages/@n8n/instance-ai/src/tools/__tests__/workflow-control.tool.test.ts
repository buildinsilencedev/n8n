import type { WorkflowJSON } from '@n8n/workflow-sdk';

import type { InstanceAiContext } from '../../types';
import { createWorkflowControlTool } from '../workflow-control.tool';
import { getValidCredentialTypes } from '../workflows/setup-workflow.service';

jest.mock('../workflows/setup-workflow.service', () => ({
	getValidCredentialTypes: jest.fn(),
}));

function createWorkflowFixture(): WorkflowJSON {
	return {
		id: 'wf-1',
		name: 'Patch Test Workflow',
		nodes: [
			{
				id: 'node-telegram',
				name: 'Telegram Trigger',
				type: 'n8n-nodes-base.telegramTrigger',
				typeVersion: 1,
				position: [0, 0],
				parameters: {},
			},
			{
				id: 'node-agent',
				name: 'Agent',
				type: '@n8n/n8n-nodes-langchain.agent',
				typeVersion: 1,
				position: [260, 0],
				parameters: {},
			},
			{
				id: 'node-http',
				name: 'HTTP Request',
				type: 'n8n-nodes-base.httpRequest',
				typeVersion: 4,
				position: [520, 0],
				parameters: {
					url: 'https://example.com',
					authentication: 'predefinedCredentialType',
					nodeCredentialType: 'httpHeaderAuth',
				},
				credentials: {
					httpHeaderAuth: {
						id: 'cred-http',
						name: 'HTTP Header',
					},
				},
			},
			{
				id: 'node-gmail',
				name: 'Gmail',
				type: 'n8n-nodes-base.gmail',
				typeVersion: 2,
				position: [780, 0],
				parameters: {},
			},
		],
		connections: {
			'Telegram Trigger': {
				main: [
					[
						{
							node: 'Agent',
							type: 'main',
							index: 0,
						},
					],
				],
			},
			Agent: {
				main: [
					[
						{
							node: 'HTTP Request',
							type: 'main',
							index: 0,
						},
					],
				],
			},
			'HTTP Request': {
				main: [
					[
						{
							node: 'Gmail',
							type: 'main',
							index: 0,
						},
					],
				],
			},
		},
		settings: {},
	};
}

function createMockContext(workflow: WorkflowJSON): InstanceAiContext {
	const workflowClone = structuredClone(workflow);
	return {
		userId: 'user-1',
		workflowService: {
			list: jest.fn(),
			get: jest.fn(),
			getAsWorkflowJSON: jest.fn().mockResolvedValue(workflowClone),
			createFromWorkflowJSON: jest.fn(),
			updateFromWorkflowJSON: jest.fn().mockResolvedValue({
				id: workflow.id ?? 'wf-1',
				name: workflow.name ?? 'Patch Test Workflow',
				versionId: 'v1',
				activeVersionId: null,
				createdAt: '2026-01-01',
				updatedAt: '2026-01-01',
				nodes: [],
				connections: {},
			}),
			archive: jest.fn(),
			delete: jest.fn(),
			publish: jest.fn(),
			unpublish: jest.fn(),
		},
		executionService: {
			list: jest.fn(),
			run: jest.fn().mockResolvedValue({ executionId: 'exec-1', status: 'success' }),
			getStatus: jest.fn(),
			getResult: jest.fn(),
			stop: jest.fn(),
			getDebugInfo: jest.fn(),
			getNodeOutput: jest.fn(),
		},
		credentialService: {
			list: jest.fn(),
			get: jest.fn(),
			delete: jest.fn(),
			test: jest.fn(),
		},
		nodeService: {
			listAvailable: jest.fn(),
			getDescription: jest.fn(),
			listSearchable: jest.fn(),
		},
		dataTableService: {
			list: jest.fn(),
			create: jest.fn(),
			delete: jest.fn(),
			getSchema: jest.fn(),
			addColumn: jest.fn(),
			deleteColumn: jest.fn(),
			renameColumn: jest.fn(),
			queryRows: jest.fn(),
			insertRows: jest.fn(),
			updateRows: jest.fn(),
			deleteRows: jest.fn(),
		},
	} as unknown as InstanceAiContext;
}

function expectMutatingDiffShape(result: Record<string, unknown>) {
	expect(result).toEqual(
		expect.objectContaining({
			diff: expect.objectContaining({
				nodesAdded: expect.any(Array),
				nodesRemoved: expect.any(Array),
				nodesUpdated: expect.any(Array),
				connectionsAdded: expect.any(Array),
				connectionsRemoved: expect.any(Array),
			}),
		}),
	);
}

describe('workflow-control tool', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getValidCredentialTypes as jest.Mock).mockResolvedValue(new Set<string>());
	});

	it('updateNode patches only target fields and preserves node id/credentials', async () => {
		const workflow = createWorkflowFixture();
		const context = createMockContext(workflow);
		const tool = createWorkflowControlTool(context);

		const result = (await tool.execute!(
			{
				command: 'updateNode',
				workflowId: 'wf-1',
				nodeName: 'HTTP Request',
				patch: {
					parameters: {
						url: 'https://api.example.com',
					},
				},
			},
			{} as never,
		)) as Record<string, unknown>;

		expectMutatingDiffShape(result);
		expect(context.workflowService.updateFromWorkflowJSON).toHaveBeenCalledTimes(1);
		const updated = (context.workflowService.updateFromWorkflowJSON as jest.Mock).mock.calls[0][1] as WorkflowJSON;
		const node = updated.nodes.find((n) => n.name === 'HTTP Request');
		expect(node?.id).toBe('node-http');
		expect(node?.credentials).toEqual({
			httpHeaderAuth: {
				id: 'cred-http',
				name: 'HTTP Header',
			},
		});
		expect(node?.parameters).toMatchObject({
			url: 'https://api.example.com',
		});
	});

	it('addNode adds one node and deleteNode removes node plus related connections', async () => {
		const addContext = createMockContext(createWorkflowFixture());
		const addTool = createWorkflowControlTool(addContext);

		const addResult = (await addTool.execute!(
			{
				command: 'addNode',
				workflowId: 'wf-1',
				nodeSpec: {
					name: 'Transform',
					type: 'n8n-nodes-base.code',
					typeVersion: 2,
					position: [100, 100],
					parameters: {
						jsCode: 'return [{ json: { ok: true } }];',
					},
				},
			},
			{} as never,
		)) as Record<string, unknown>;

		expectMutatingDiffShape(addResult);
		expect(addResult.diff).toMatchObject({
			nodesAdded: ['Transform'],
			nodesRemoved: [],
		});

		const deleteContext = createMockContext(createWorkflowFixture());
		const deleteTool = createWorkflowControlTool(deleteContext);
		const deleteResult = (await deleteTool.execute!(
			{
				command: 'deleteNode',
				workflowId: 'wf-1',
				nodeName: 'Agent',
			},
			{} as never,
		)) as Record<string, unknown>;

		expectMutatingDiffShape(deleteResult);
		expect(deleteResult.diff).toMatchObject({
			nodesRemoved: ['Agent'],
		});
		expect((deleteResult.diff as { connectionsRemoved: unknown[] }).connectionsRemoved.length).toBeGreaterThan(
			0,
		);
	});

	it('connectNodes and disconnectNodes support default and explicit indices', async () => {
		const context = createMockContext(createWorkflowFixture());
		const tool = createWorkflowControlTool(context);

		const connectDefault = (await tool.execute!(
			{
				command: 'connectNodes',
				workflowId: 'wf-1',
				fromNode: 'Agent',
				toNode: 'Gmail',
			},
			{} as never,
		)) as Record<string, unknown>;
		expectMutatingDiffShape(connectDefault);
		expect(connectDefault.diff).toMatchObject({
			connectionsAdded: [
				{
					fromNode: 'Agent',
					toNode: 'Gmail',
					outputIndex: 0,
					inputIndex: 0,
				},
			],
		});

		const connectExplicit = (await tool.execute!(
			{
				command: 'connectNodes',
				workflowId: 'wf-1',
				fromNode: 'Telegram Trigger',
				toNode: 'HTTP Request',
				outputIndex: 1,
				inputIndex: 2,
			},
			{} as never,
		)) as Record<string, unknown>;
		expectMutatingDiffShape(connectExplicit);
		expect(connectExplicit.diff).toMatchObject({
			connectionsAdded: [
				{
					fromNode: 'Telegram Trigger',
					toNode: 'HTTP Request',
					outputIndex: 1,
					inputIndex: 2,
				},
			],
		});

		const disconnect = (await tool.execute!(
			{
				command: 'disconnectNodes',
				workflowId: 'wf-1',
				fromNode: 'Agent',
				toNode: 'HTTP Request',
			},
			{} as never,
		)) as Record<string, unknown>;
		expectMutatingDiffShape(disconnect);
		expect((disconnect.diff as { connectionsRemoved: unknown[] }).connectionsRemoved.length).toBeGreaterThan(
			0,
		);
	});

	it('verifyCredentials lists required credential nodes with bound status', async () => {
		const context = createMockContext(createWorkflowFixture());
		const tool = createWorkflowControlTool(context);

		(getValidCredentialTypes as jest.Mock).mockImplementation((_ctx, node) => {
			if (node.name === 'HTTP Request') {
				return new Set(['httpHeaderAuth']);
			}
			if (node.name === 'Gmail') {
				return new Set(['gmailOAuth2']);
			}
			return new Set();
		});

		const result = (await tool.execute!(
			{
				command: 'verifyCredentials',
				workflowId: 'wf-1',
			},
			{} as never,
		)) as {
			nodes: Array<{
				nodeName: string;
				requiredCredentials: Array<{ credentialType: string; bound: boolean }>;
			}>;
		};

		expect(result.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					nodeName: 'HTTP Request',
					requiredCredentials: [
						expect.objectContaining({
							credentialType: 'httpHeaderAuth',
							bound: true,
						}),
					],
				}),
				expect.objectContaining({
					nodeName: 'Gmail',
					requiredCredentials: [
						expect.objectContaining({
							credentialType: 'gmailOAuth2',
							bound: false,
						}),
					],
				}),
			]),
		);
	});

	it('bindCredential binds compatible credential type and rejects incompatible binds', async () => {
		const compatibleContext = createMockContext(createWorkflowFixture());
		(compatibleContext.credentialService.get as jest.Mock).mockResolvedValue({
			id: 'cred-new-http',
			name: 'HTTP Header 2',
			type: 'httpHeaderAuth',
		});
		(getValidCredentialTypes as jest.Mock).mockResolvedValue(new Set(['httpHeaderAuth']));
		const compatibleTool = createWorkflowControlTool(compatibleContext);

		const successResult = (await compatibleTool.execute!(
			{
				command: 'bindCredential',
				workflowId: 'wf-1',
				nodeName: 'HTTP Request',
				credentialId: 'cred-new-http',
			},
			{} as never,
		)) as Record<string, unknown>;

		expectMutatingDiffShape(successResult);
		expect(successResult.applied).toBe(true);

		const incompatibleContext = createMockContext(createWorkflowFixture());
		(incompatibleContext.credentialService.get as jest.Mock).mockResolvedValue({
			id: 'cred-gmail',
			name: 'Gmail OAuth',
			type: 'gmailOAuth2',
		});
		(getValidCredentialTypes as jest.Mock).mockResolvedValue(new Set(['httpHeaderAuth']));
		const incompatibleTool = createWorkflowControlTool(incompatibleContext);

		const rejectResult = (await incompatibleTool.execute!(
			{
				command: 'bindCredential',
				workflowId: 'wf-1',
				nodeName: 'HTTP Request',
				credentialId: 'cred-gmail',
			},
			{} as never,
		)) as Record<string, unknown>;

		expectMutatingDiffShape(rejectResult);
		expect(rejectResult.applied).toBe(false);
		expect(rejectResult.error).toEqual(expect.stringContaining('not compatible'));
	});

	it('simulateTelegramMessage builds Telegram-shaped payload and runs from Telegram Trigger', async () => {
		const context = createMockContext(createWorkflowFixture());
		const tool = createWorkflowControlTool(context);

		await tool.execute!(
			{
				command: 'simulateTelegramMessage',
				workflowId: 'wf-1',
				chatId: 12345,
				text: 'hello',
			},
			{} as never,
		);

		expect(context.executionService.run).toHaveBeenCalledTimes(1);
		const [workflowId, payload, options] = (context.executionService.run as jest.Mock).mock.calls[0];
		expect(workflowId).toBe('wf-1');
		expect(options).toEqual({ triggerNodeName: 'Telegram Trigger' });
		expect(payload).toEqual(
			expect.objectContaining({
				update_id: expect.any(Number),
				message: expect.objectContaining({
					message_id: expect.any(Number),
					text: 'hello',
					chat: expect.objectContaining({
						id: 12345,
					}),
					from: expect.objectContaining({
						id: 12345,
					}),
					date: expect.any(Number),
				}),
			}),
		);
	});

	it('addNormalizeAgentOutputNode inserts code node and rewires after target node', async () => {
		const context = createMockContext(createWorkflowFixture());
		const tool = createWorkflowControlTool(context);

		const result = (await tool.execute!(
			{
				command: 'addNormalizeAgentOutputNode',
				workflowId: 'wf-1',
				afterNodeName: 'Agent',
			},
			{} as never,
		)) as Record<string, unknown>;

		expectMutatingDiffShape(result);
		const updated = (context.workflowService.updateFromWorkflowJSON as jest.Mock).mock.calls[0][1] as WorkflowJSON;
		const normalizeNode = updated.nodes.find(
			(node) =>
				node.type === 'n8n-nodes-base.code' &&
				typeof node.name === 'string' &&
				node.name.includes('Normalize Agent Output'),
		);
		expect(normalizeNode).toBeDefined();
		expect(normalizeNode?.parameters).toMatchObject({
			jsCode: 'return [{ json: $json.output || $json }];',
		});

		const agentMain = (updated.connections as Record<string, { main?: Array<Array<{ node: string }> | null> }>)['Agent']
			.main ?? [];
		expect(agentMain[0]).toEqual([
			expect.objectContaining({
				node: normalizeNode?.name,
			}),
		]);

		const normalizeMain =
			(updated.connections as Record<string, { main?: Array<Array<{ node: string }> | null> }>)[
				normalizeNode?.name ?? ''
			]?.main ?? [];
		expect(normalizeMain[0]).toEqual([
			expect.objectContaining({
				node: 'HTTP Request',
			}),
		]);
	});

	it('addIsolatedHealthCheckTrigger creates isolated branch and avoids banned connections', async () => {
		const context = createMockContext(createWorkflowFixture());
		const tool = createWorkflowControlTool(context);

		const result = (await tool.execute!(
			{
				command: 'addIsolatedHealthCheckTrigger',
				workflowId: 'wf-1',
			},
			{} as never,
		)) as Record<string, unknown>;

		expectMutatingDiffShape(result);
		expect(result.healthConnectionTouchesBannedNode).toBe(false);

		const updated = (context.workflowService.updateFromWorkflowJSON as jest.Mock).mock.calls[0][1] as WorkflowJSON;
		const newNodes = updated.nodes.filter(
			(node) => node.name === result.triggerNodeName || node.name === result.outputNodeName,
		);
		expect(newNodes).toHaveLength(2);

		const triggerNode = newNodes.find((node) => node.name === result.triggerNodeName);
		const outputNode = newNodes.find((node) => node.name === result.outputNodeName);
		expect(triggerNode?.type).toBe('n8n-nodes-base.webhook');
		expect(outputNode?.type).toBe('n8n-nodes-base.code');

		const triggerConns = (updated.connections as Record<string, { main?: Array<Array<{ node: string }> | null> }>)[
			result.triggerNodeName as string
		]?.main ?? [];
		expect(triggerConns[0]).toEqual([
			expect.objectContaining({
				node: result.outputNodeName,
			}),
		]);
	});

	it('returns diff structure for every mutating command', async () => {
		const scenarios: Array<{
			input: Record<string, unknown>;
			setup?: (context: InstanceAiContext) => void;
		}> = [
			{
				input: {
					command: 'updateNode',
					workflowId: 'wf-1',
					nodeName: 'Agent',
					patch: { disabled: true },
				},
			},
			{
				input: {
					command: 'addNode',
					workflowId: 'wf-1',
					nodeSpec: {
						name: 'Tmp Node',
						type: 'n8n-nodes-base.code',
						parameters: { jsCode: 'return [{ json: {} }];' },
					},
				},
			},
			{
				input: {
					command: 'deleteNode',
					workflowId: 'wf-1',
					nodeName: 'Gmail',
				},
			},
			{
				input: {
					command: 'connectNodes',
					workflowId: 'wf-1',
					fromNode: 'Agent',
					toNode: 'Gmail',
				},
			},
			{
				input: {
					command: 'disconnectNodes',
					workflowId: 'wf-1',
					fromNode: 'Agent',
					toNode: 'HTTP Request',
				},
			},
			{
				input: {
					command: 'bindCredential',
					workflowId: 'wf-1',
					nodeName: 'HTTP Request',
					credentialId: 'cred-http-new',
				},
				setup: (context) => {
					(context.credentialService.get as jest.Mock).mockResolvedValue({
						id: 'cred-http-new',
						name: 'HTTP New',
						type: 'httpHeaderAuth',
					});
					(getValidCredentialTypes as jest.Mock).mockResolvedValue(new Set(['httpHeaderAuth']));
				},
			},
			{
				input: {
					command: 'addNormalizeAgentOutputNode',
					workflowId: 'wf-1',
					afterNodeName: 'Agent',
				},
			},
			{
				input: {
					command: 'addIsolatedHealthCheckTrigger',
					workflowId: 'wf-1',
				},
			},
		];

		for (const scenario of scenarios) {
			const context = createMockContext(createWorkflowFixture());
			scenario.setup?.(context);
			const tool = createWorkflowControlTool(context);
			const result = (await tool.execute!(scenario.input as never, {} as never)) as Record<string, unknown>;
			expectMutatingDiffShape(result);
		}
	});
});
