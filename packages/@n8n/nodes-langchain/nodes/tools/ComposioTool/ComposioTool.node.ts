import { DynamicStructuredTool } from '@langchain/core/tools';
import type { JSONSchema7, JSONSchema7Definition, JSONSchema7TypeName } from 'json-schema';
import { StructuredToolkit } from 'n8n-core';
import {
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodeListSearchItems,
	type INodeListSearchResult,
	NodeConnectionTypes,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	NodeOperationError,
	type SupplyData,
	nodeNameToToolName,
} from 'n8n-workflow';

import { getConnectionHintNoticeField, logWrapper } from '@n8n/ai-utilities';

import { convertJsonSchemaToZod } from '../../../utils/schemaParsing';
import type {
	ComposioConnectedAccount,
	ComposioListResponse,
	ComposioToolSchema,
} from 'n8n-nodes-base/dist/nodes/Composio/types';
import { searchToolkits } from 'n8n-nodes-base/dist/nodes/Composio/methods/listSearch';
import {
	apiRequest,
	apiRequestAllItems,
} from 'n8n-nodes-base/dist/nodes/Composio/transport/index';

type ComposioToolIncludeMode = 'all' | 'selected' | 'except';

const TOOL_SEARCH_LIMIT = 100;
const CONNECTED_ACCOUNT_SEARCH_LIMIT = 100;

function getSanitizedToolName(nodeName: string, toolSlug: string): string {
	return nodeNameToToolName(`${nodeName}_${toolSlug}`);
}

function getToolkitSlug(
	ctx: ILoadOptionsFunctions | ISupplyDataFunctions | IExecuteFunctions,
	itemIndex: number,
): string {
	const toolkitSlug = ctx.getNodeParameter('toolkit', itemIndex, '', {
		extractValue: true,
	}) as string;

	if (!toolkitSlug) {
		throw new NodeOperationError(ctx.getNode(), 'Select a Composio toolkit first.', {
			itemIndex,
		});
	}

	return toolkitSlug;
}

async function getToolkitTools(
	ctx: ILoadOptionsFunctions | ISupplyDataFunctions | IExecuteFunctions,
	itemIndex: number,
): Promise<ComposioToolSchema[]> {
	const toolkitSlug = getToolkitSlug(ctx, itemIndex);

	return (await apiRequestAllItems.call(
		ctx as unknown as ILoadOptionsFunctions,
		'GET',
		'/tools',
		{
			toolkit_slug: toolkitSlug,
			query: '',
			toolkit_versions: 'latest',
			limit: TOOL_SEARCH_LIMIT,
		},
		'v3.1',
	)) as ComposioToolSchema[];
}

function filterTools(
	tools: ComposioToolSchema[],
	mode: ComposioToolIncludeMode,
	selectedTools: string[],
	excludedTools: string[],
): ComposioToolSchema[] {
	if (mode === 'selected') {
		return tools.filter((tool) => selectedTools.includes(tool.slug));
	}

	if (mode === 'except') {
		return tools.filter((tool) => !excludedTools.includes(tool.slug));
	}

	return tools;
}

function buildToolSchema(tool: ComposioToolSchema) {
	const properties = Object.fromEntries(
		Object.entries(tool.input_parameters ?? {}).map(
			([name, definition]) =>
				[
					name,
					{
						type: (definition.type ?? 'string') as JSONSchema7TypeName,
						description: definition.description,
						enum: definition.enum,
					} satisfies JSONSchema7,
				] satisfies [string, JSONSchema7Definition],
		),
	);

	const required = Object.entries(tool.input_parameters ?? {})
		.filter(([, definition]) => definition.required)
		.map(([name]) => name);

	return convertJsonSchemaToZod({
		type: 'object',
		properties,
		required,
		additionalProperties: false,
	});
}

async function executeComposioTool(
	ctx: ISupplyDataFunctions | IExecuteFunctions,
	itemIndex: number,
	tool: ComposioToolSchema,
	argumentsPayload: IDataObject,
): Promise<IDataObject> {
	const connectedAccountId = ctx.getNodeParameter('connectedAccountId', itemIndex, '', {
		extractValue: true,
	}) as string;
	const userId = ctx.getNodeParameter('userId', itemIndex, '') as string;

	if (!connectedAccountId) {
		throw new NodeOperationError(ctx.getNode(), 'Select a connected account for this Composio tool.', {
			itemIndex,
		});
	}

	if (!userId) {
		throw new NodeOperationError(ctx.getNode(), 'User ID is required for Composio tool execution.', {
			itemIndex,
		});
	}

	try {
		return (await apiRequest.call(
			ctx as unknown as IExecuteFunctions,
			'POST',
			`/tools/execute/${tool.slug}`,
			{
				connected_account_id: connectedAccountId,
				user_id: userId,
				arguments: argumentsPayload,
				version: tool.version || undefined,
			},
			{},
			'v3',
		)) as IDataObject;
	} catch (error) {
		throw new NodeOperationError(ctx.getNode(), error as Error, { itemIndex });
	}
}

async function getSelectedTools(
	ctx: ISupplyDataFunctions | IExecuteFunctions,
	itemIndex: number,
): Promise<ComposioToolSchema[]> {
	const tools = await getToolkitTools(ctx, itemIndex);
	const include = ctx.getNodeParameter('include', itemIndex, 'all') as ComposioToolIncludeMode;
	const selectedTools = ctx.getNodeParameter('selectedTools', itemIndex, []) as string[];
	const excludedTools = ctx.getNodeParameter('excludedTools', itemIndex, []) as string[];

	const filteredTools = filterTools(tools, include, selectedTools, excludedTools);

	if (filteredTools.length === 0) {
		throw new NodeOperationError(ctx.getNode(), 'No Composio tools are available with the current selection.', {
			itemIndex,
		});
	}

	return filteredTools;
}

function stringifyToolResult(result: IDataObject): string {
	return JSON.stringify(result, null, 2);
}

function getInputArguments(item: INodeExecutionData): IDataObject {
	const { tool: _toolName, ...toolArguments } = item.json;
	return toolArguments;
}

export async function loadToolkitTools(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const tools = await getToolkitTools(this, 0);

	return tools.map((tool) => ({
		name: tool.slug,
		value: tool.slug,
		description: tool.description ?? tool.name,
	}));
}

export async function searchComposioConnectedAccounts(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const toolkitSlug = getToolkitSlug(this, 0);
	const userId = this.getNodeParameter('userId', 0) as string;

	const response = (await apiRequest.call(
		this as unknown as IExecuteFunctions,
		'GET',
		'/connected_accounts',
		{},
		{
			toolkit_slugs: toolkitSlug,
			user_ids: userId || undefined,
			limit: CONNECTED_ACCOUNT_SEARCH_LIMIT,
			cursor: paginationToken,
		},
		'v3.1',
	)) as ComposioListResponse<ComposioConnectedAccount>;

	const normalizedFilter = filter?.trim().toLowerCase();
	const filteredItems = response.items.filter((account) => {
		if (!normalizedFilter) {
			return true;
		}

		return (
			account.id.toLowerCase().includes(normalizedFilter) ||
			account.toolkit?.slug?.toLowerCase().includes(normalizedFilter) ||
			account.status?.toLowerCase().includes(normalizedFilter)
		);
	});

	const results: INodeListSearchItems[] = filteredItems.map((account) => ({
		name: `${account.toolkit?.slug ?? 'account'} (${account.id})`,
		value: account.id,
		description: account.status,
	}));

	return {
		results,
		paginationToken: response.next_cursor ?? undefined,
	};
}

export class ComposioTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Composio Tool',
		name: 'composioTool',
		icon: 'file:composio.svg',
		group: ['transform'],
		version: 1,
		description: 'Expose Composio actions as AI tools',
		defaults: {
			name: 'Composio Tool',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Tools'],
				Tools: ['Recommended Tools'],
			},
		},
		inputs: [],
		outputs: [{ type: NodeConnectionTypes.AiTool, displayName: 'Tools' }],
		credentials: [
			{
				name: 'composioApi',
				required: true,
			},
		],
		properties: [
			getConnectionHintNoticeField([NodeConnectionTypes.AiAgent]),
			{
				displayName: 'Toolkit',
				name: 'toolkit',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						placeholder: 'Select a toolkit...',
						typeOptions: {
							searchListMethod: 'searchToolkits',
							searchable: true,
							searchFilterRequired: false,
						},
					},
					{
						displayName: 'Slug',
						name: 'id',
						type: 'string',
						placeholder: 'e.g. github',
					},
				],
			},
			{
				displayName: 'User ID',
				name: 'userId',
				type: 'string',
				default: '',
				required: true,
				description: 'The Composio user ID whose connected account should be used',
			},
			{
				displayName: 'Connected Account',
				name: 'connectedAccountId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				typeOptions: {
					loadOptionsDependsOn: ['toolkit.value', 'userId'],
				},
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						placeholder: 'Select a connected account...',
						typeOptions: {
							searchListMethod: 'searchComposioConnectedAccounts',
							searchable: true,
							searchFilterRequired: false,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 'e.g. ca_12345',
					},
				],
			},
			{
				displayName: 'Tools to Include',
				name: 'include',
				type: 'options',
				default: 'all',
				options: [
					{
						name: 'All',
						value: 'all',
					},
					{
						name: 'Selected',
						value: 'selected',
					},
					{
						name: 'All Except',
						value: 'except',
					},
				],
			},
			{
				displayName: 'Selected Tool Names or IDs',
				name: 'selectedTools',
				type: 'multiOptions',
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: {
					loadOptionsMethod: 'loadToolkitTools',
					loadOptionsDependsOn: ['toolkit.value'],
				},
				displayOptions: {
					show: {
						include: ['selected'],
					},
				},
			},
			{
				displayName: 'Excluded Tool Names or IDs',
				name: 'excludedTools',
				type: 'multiOptions',
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: {
					loadOptionsMethod: 'loadToolkitTools',
					loadOptionsDependsOn: ['toolkit.value'],
				},
				displayOptions: {
					show: {
						include: ['except'],
					},
				},
			},
		],
	};

	methods = {
		listSearch: {
			searchToolkits,
			searchComposioConnectedAccounts,
		},
		loadOptions: {
			loadToolkitTools,
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const selectedTools = await getSelectedTools(this, itemIndex);
		const nodeName = this.getNode().name;

		const tools = selectedTools.map((tool) =>
			logWrapper(
				new DynamicStructuredTool({
					name: getSanitizedToolName(nodeName, tool.slug),
					description: tool.description ?? tool.name,
					schema: buildToolSchema(tool),
					func: async (toolArguments) =>
						stringifyToolResult(
							await executeComposioTool(this, itemIndex, tool, toolArguments as IDataObject),
						),
				}),
				this,
			),
		);

		return {
			response: new StructuredToolkit(tools),
		};
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const responseData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const selectedTools = await getSelectedTools(this, itemIndex);
			const toolsByName = new Map<string, ComposioToolSchema>(
				selectedTools.map((tool) => [getSanitizedToolName(this.getNode().name, tool.slug), tool]),
			);

			const rawToolName = items[itemIndex].json.tool;
			const toolName = typeof rawToolName === 'string' ? rawToolName : null;

			if (!toolName || !toolsByName.has(toolName)) {
				throw new NodeOperationError(
					this.getNode(),
					'Tool name not found in the current Composio Tool selection.',
					{ itemIndex },
				);
			}

			const result = await executeComposioTool(
				this,
				itemIndex,
				toolsByName.get(toolName)!,
				getInputArguments(items[itemIndex]),
			);

			responseData.push({
				json: {
					response: result,
				},
				pairedItem: {
					item: itemIndex,
				},
			});
		}

		return [responseData];
	}
}
