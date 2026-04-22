import { Container } from '@n8n/di';
import { DataSource } from '@n8n/typeorm';
import { v4 as uuidv4 } from 'uuid';
import type {
	IConnections,
	IExecuteFunctions,
	IExecuteWorkflowInfo,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
	INodeListSearchResult,
	INodeTypeNameVersion,
	ISupplyDataFunctions,
} from 'n8n-workflow';
import {
	jsonParse,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';

import { ensureUserId } from '../../vector_store/shared/userScoped';

export const PERSONAL_AGENT_TOOL_NODE_TYPE = '@n8n/n8n-nodes-langchain.personalAgentTool';

const PERSONAL_AGENT_SEARCH_LIMIT = 50;
const EXECUTE_WORKFLOW_TRIGGER_NODE_TYPE = 'n8n-nodes-base.executeWorkflowTrigger';
const AGENT_NODE_TYPE = '@n8n/n8n-nodes-langchain.agent';

type ChatHubLLMProvider =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'azureOpenAi'
	| 'azureEntraId'
	| 'ollama'
	| 'awsBedrock'
	| 'vercelAiGateway'
	| 'xAiGrok'
	| 'groq'
	| 'openRouter'
	| 'deepSeek'
	| 'cohere'
	| 'mistralCloud';

type PersonalAgentRecord = {
	id: string;
	name: string;
	description: string | null;
	systemPrompt: string;
	credentialId: string | null;
	provider: ChatHubLLMProvider;
	model: string;
};

const PROVIDER_CREDENTIAL_TYPE_MAP: Record<ChatHubLLMProvider, string> = {
	openai: 'openAiApi',
	anthropic: 'anthropicApi',
	google: 'googlePalmApi',
	ollama: 'ollamaApi',
	azureOpenAi: 'azureOpenAiApi',
	azureEntraId: 'azureEntraCognitiveServicesOAuth2Api',
	awsBedrock: 'aws',
	vercelAiGateway: 'vercelAiGatewayApi',
	xAiGrok: 'xAiApi',
	groq: 'groqApi',
	openRouter: 'openRouterApi',
	deepSeek: 'deepSeekApi',
	cohere: 'cohereApi',
	mistralCloud: 'mistralCloudApi',
};

const PROVIDER_NODE_TYPE_MAP: Record<ChatHubLLMProvider, INodeTypeNameVersion> = {
	openai: {
		name: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
		version: 1.3,
	},
	anthropic: {
		name: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
		version: 1.3,
	},
	google: {
		name: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
		version: 1.2,
	},
	ollama: {
		name: '@n8n/n8n-nodes-langchain.lmChatOllama',
		version: 1,
	},
	azureOpenAi: {
		name: '@n8n/n8n-nodes-langchain.lmChatAzureOpenAi',
		version: 1,
	},
	azureEntraId: {
		name: '@n8n/n8n-nodes-langchain.lmChatAzureOpenAi',
		version: 1,
	},
	awsBedrock: {
		name: '@n8n/n8n-nodes-langchain.lmChatAwsBedrock',
		version: 1.1,
	},
	vercelAiGateway: {
		name: '@n8n/n8n-nodes-langchain.lmChatVercelAiGateway',
		version: 1,
	},
	xAiGrok: {
		name: '@n8n/n8n-nodes-langchain.lmChatXAiGrok',
		version: 1,
	},
	groq: {
		name: '@n8n/n8n-nodes-langchain.lmChatGroq',
		version: 1,
	},
	openRouter: {
		name: '@n8n/n8n-nodes-langchain.lmChatOpenRouter',
		version: 1,
	},
	deepSeek: {
		name: '@n8n/n8n-nodes-langchain.lmChatDeepSeek',
		version: 1,
	},
	cohere: {
		name: '@n8n/n8n-nodes-langchain.lmChatCohere',
		version: 1,
	},
	mistralCloud: {
		name: '@n8n/n8n-nodes-langchain.lmChatMistralCloud',
		version: 1,
	},
};

function getDataSource(): DataSource {
	return Container.get(DataSource);
}

function parseDefinition(definition: unknown): INode {
	if (typeof definition === 'string') {
		return jsonParse<INode>(definition);
	}

	return definition as INode;
}

function cloneNodeDefinition(node: INode, position: [number, number]): INode {
	const clonedNode = jsonParse<INode>(JSON.stringify(node));
	return {
		...clonedNode,
		id: uuidv4(),
		position,
	};
}

export async function searchPersonalAgents(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const userId = ensureUserId(this);
	const offset = Number.parseInt(paginationToken ?? '0', 10) || 0;
	const normalizedFilter = filter?.trim().toLowerCase();
	const dataSource = getDataSource();

	const query = dataSource
		.createQueryBuilder()
		.select('agent.id', 'id')
		.addSelect('agent.name', 'name')
		.addSelect('agent.description', 'description')
		.from('chat_hub_agents', 'agent')
		.where('agent.ownerId = :userId', { userId })
		.orderBy('agent.createdAt', 'DESC')
		.limit(PERSONAL_AGENT_SEARCH_LIMIT + 1)
		.offset(offset);

	if (normalizedFilter) {
		query.andWhere('(LOWER(agent.name) LIKE :filter OR LOWER(COALESCE(agent.description, \'\')) LIKE :filter)', {
			filter: `%${normalizedFilter}%`,
		});
	}

	const rows = await query.getRawMany<{ id: string; name: string; description: string | null }>();
	const pagedRows = rows.slice(0, PERSONAL_AGENT_SEARCH_LIMIT);

	return {
		results: pagedRows.map((row) => ({
			name: row.name,
			value: row.id,
			description: row.description ?? undefined,
		})),
		paginationToken:
			rows.length > PERSONAL_AGENT_SEARCH_LIMIT
				? String(offset + PERSONAL_AGENT_SEARCH_LIMIT)
				: undefined,
	};
}

export async function getPersonalAgent(
	userId: string,
	agentId: string,
): Promise<PersonalAgentRecord | null> {
	const dataSource = getDataSource();

	return (await dataSource
		.createQueryBuilder()
		.select('agent.id', 'id')
		.addSelect('agent.name', 'name')
		.addSelect('agent.description', 'description')
		.addSelect('agent.systemPrompt', 'systemPrompt')
		.addSelect('agent.credentialId', 'credentialId')
		.addSelect('agent.provider', 'provider')
		.addSelect('agent.model', 'model')
		.from('chat_hub_agents', 'agent')
		.where('agent.id = :agentId', { agentId })
		.andWhere('agent.ownerId = :userId', { userId })
		.getRawOne<PersonalAgentRecord>()) ?? null;
}

export async function getPersonalAgentToolDefinitions(
	userId: string,
	agentId: string,
): Promise<INode[]> {
	const dataSource = getDataSource();
	const rows = await dataSource
		.createQueryBuilder()
		.select('tool.definition', 'definition')
		.from('chat_hub_tools', 'tool')
		.innerJoin('chat_hub_agent_tools', 'agentTool', 'agentTool.toolId = tool.id')
		.where('agentTool.agentId = :agentId', { agentId })
		.andWhere('tool.ownerId = :userId', { userId })
		.orderBy('tool.createdAt', 'ASC')
		.getRawMany<{ definition: unknown }>();

	return rows.map((row) => parseDefinition(row.definition));
}

export function getSelectedAgentId(
	ctx: ILoadOptionsFunctions | ISupplyDataFunctions | IExecuteFunctions,
	itemIndex: number,
): string {
	const agentId = ctx.getNodeParameter('agentId', itemIndex, '', {
		extractValue: true,
	}) as string;

	if (!agentId) {
		throw new NodeOperationError(ctx.getNode(), 'Select a personal agent first.', { itemIndex });
	}

	return agentId;
}

function buildSystemMessage(agent: PersonalAgentRecord): string {
	return [
		`You are the "${agent.name}" personal agent, running inside an n8n tool call.`,
		'Complete the delegated task and return the final answer directly.',
		agent.description?.trim() ? `## Role\n\n${agent.description.trim()}` : '',
		agent.systemPrompt?.trim() ? `## Instructions\n\n${agent.systemPrompt.trim()}` : '',
	]
		.filter((section) => section.trim().length > 0)
		.join('\n\n');
}

function buildAgentNode(agent: PersonalAgentRecord): INode {
	return {
		parameters: {
			promptType: 'define',
			text: '={{ $json.chatInput ?? $json.input ?? $json.query ?? $json.prompt ?? $json.text ?? $json.message ?? "" }}',
			options: {
				systemMessage: buildSystemMessage(agent),
			},
		},
		type: AGENT_NODE_TYPE,
		typeVersion: 3,
		position: [260, 0],
		id: uuidv4(),
		name: agent.name,
	};
}

function buildModelNode(agent: PersonalAgentRecord): INode {
	if (!agent.credentialId) {
		throw new NodeOperationError(
			{ name: 'Personal Agent Tool', parameters: {}, type: PERSONAL_AGENT_TOOL_NODE_TYPE, typeVersion: 1, position: [0, 0], id: uuidv4() } as INode,
			'The selected personal agent is missing its configured model credential.',
		);
	}

	const credentialType = PROVIDER_CREDENTIAL_TYPE_MAP[agent.provider];
	const nodeType = PROVIDER_NODE_TYPE_MAP[agent.provider];

	const common: INode = {
		parameters: {
			options: {},
		},
		type: nodeType.name,
		typeVersion: nodeType.version,
		position: [260, 260],
		id: uuidv4(),
		name: 'Chat Model',
		credentials: {
			[credentialType]: {
				id: agent.credentialId,
				name: credentialType,
			},
		},
	};

	switch (agent.provider) {
		case 'openai':
		case 'anthropic':
		case 'google':
			return {
				...common,
				parameters: {
					model: { __rl: true, mode: 'id', value: agent.model },
					options: {},
				},
			};
		default:
			return {
				...common,
				parameters: {
					model: agent.model,
					options: {},
				},
			};
	}
}

export function buildPersonalAgentWorkflow(
	agent: PersonalAgentRecord,
	toolDefinitions: INode[],
): IExecuteWorkflowInfo {
	const now = new Date();

	const triggerNode: INode = {
		parameters: {
			inputSource: 'passthrough',
		},
		type: EXECUTE_WORKFLOW_TRIGGER_NODE_TYPE,
		typeVersion: 1.1,
		position: [-40, 0],
		id: uuidv4(),
		name: 'Execute Workflow Trigger',
	};
	const agentNode = buildAgentNode(agent);
	const modelNode = buildModelNode(agent);
	const clonedToolNodes = toolDefinitions.map((tool, index) =>
		cloneNodeDefinition(tool, [260, 420 + index * 160]),
	);

	const connections: IConnections = {
		[triggerNode.name]: {
			[NodeConnectionTypes.Main]: [
				[
					{
						node: agentNode.name,
						type: NodeConnectionTypes.Main,
						index: 0,
					},
				],
			],
		},
		[modelNode.name]: {
			[NodeConnectionTypes.AiLanguageModel]: [
				[
					{
						node: agentNode.name,
						type: NodeConnectionTypes.AiLanguageModel,
						index: 0,
					},
				],
			],
		},
	};

	for (const toolNode of clonedToolNodes) {
		connections[toolNode.name] = {
			[NodeConnectionTypes.AiTool]: [
				[
					{
						node: agentNode.name,
						type: NodeConnectionTypes.AiTool,
						index: 0,
					},
				],
			],
		};
	}

	return {
		code: {
			id: uuidv4(),
			name: `${agent.name} Tool Execution`,
			active: false,
			isArchived: true,
			createdAt: now,
			updatedAt: now,
			nodes: [triggerNode, agentNode, modelNode, ...clonedToolNodes],
			connections,
			pinData: {},
			versionId: uuidv4(),
			activeVersionId: null,
			settings: {
				executionOrder: 'v1',
			},
		},
	};
}

function extractOutputText(value: unknown): string {
	if (typeof value === 'string') {
		try {
			const parsed = jsonParse<unknown>(value);
			return extractOutputText(parsed);
		} catch {
			return value;
		}
	}

	if (Array.isArray(value)) {
		return value.map((entry) => extractOutputText(entry)).join('\n').trim();
	}

	if (typeof value !== 'object' || value === null) {
		return String(value);
	}

	const record = value as Record<string, unknown>;

	for (const key of ['text', 'output', 'result', 'response']) {
		if (key in record) {
			return extractOutputText(record[key]);
		}
	}

	return JSON.stringify(record, null, 2);
}

export function rejectNestedPersonalAgentDelegation(
	ctx: ISupplyDataFunctions | IExecuteFunctions,
	itemIndex: number,
	toolDefinitions: INode[],
): void {
	if (toolDefinitions.some((tool) => tool.type === PERSONAL_AGENT_TOOL_NODE_TYPE)) {
		throw new NodeOperationError(
			ctx.getNode(),
			'This personal agent cannot delegate to another personal agent in the current execution.',
			{ itemIndex },
		);
	}
}

export async function executePersonalAgent(
	ctx: ISupplyDataFunctions | IExecuteFunctions,
	itemIndex: number,
	input: string,
): Promise<string> {
	const userId = ensureUserId(ctx, itemIndex);
	const agentId = getSelectedAgentId(ctx, itemIndex);
	const agent = await getPersonalAgent(userId, agentId);

	if (!agent) {
		throw new NodeOperationError(
			ctx.getNode(),
			'The selected personal agent was not found or is no longer available.',
			{ itemIndex },
		);
	}

	if (!agent.credentialId) {
		throw new NodeOperationError(
			ctx.getNode(),
			'The selected personal agent is missing its configured model credential.',
			{ itemIndex },
		);
	}

	const toolDefinitions = await getPersonalAgentToolDefinitions(userId, agentId);
	rejectNestedPersonalAgentDelegation(ctx, itemIndex, toolDefinitions);

	const workflowInfo = buildPersonalAgentWorkflow(agent, toolDefinitions);
	const executionInput: INodeExecutionData[] = [
		{
			json: {
				input,
				query: input,
				prompt: input,
				text: input,
				message: input,
				chatInput: input,
			},
		},
	];

	let executionResult;
	try {
		executionResult = await ctx.executeWorkflow(workflowInfo, executionInput);
	} catch (error) {
		throw new NodeOperationError(ctx.getNode(), error as Error, { itemIndex });
	}

	const firstResult = executionResult.data?.[0]?.[0]?.json;

	if (!firstResult) {
		throw new NodeOperationError(
			ctx.getNode(),
			'The selected personal agent did not return a result.',
			{ itemIndex },
		);
	}

	return extractOutputText(firstResult.output ?? firstResult.response ?? firstResult.result ?? firstResult);
}
