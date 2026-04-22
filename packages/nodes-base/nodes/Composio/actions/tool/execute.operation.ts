import { NodeApiError, type IDataObject, type IExecuteFunctions, type INodeExecutionData, type INodeProperties, type JsonObject } from 'n8n-workflow';

import { parseJsonObjectParameter } from '../../helpers';
import { apiRequest } from '../../transport';

export const description: INodeProperties[] = [
	{
		displayName: 'Toolkit',
		name: 'toolkitForToolExecute',
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
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
			},
		},
	},
	{
		displayName: 'User ID',
		name: 'toolUserId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
			},
		},
	},
	{
		displayName: 'Connected Account',
		name: 'connectedAccountForToolExecute',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		typeOptions: {
			loadOptionsDependsOn: ['toolkitForToolExecute.value', 'toolUserId'],
		},
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a connected account...',
				typeOptions: {
					searchListMethod: 'searchConnectedAccounts',
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
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
			},
		},
	},
	{
		displayName: 'Tool',
		name: 'toolForExecute',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		typeOptions: {
			loadOptionsDependsOn: ['toolkitForToolExecute.value', 'toolUserId'],
		},
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a tool...',
				typeOptions: {
					searchListMethod: 'searchTools',
					searchable: true,
					searchFilterRequired: false,
				},
			},
			{
				displayName: 'Slug',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. GITHUB_CREATE_ISSUE',
			},
		],
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
			},
		},
	},
	{
		displayName: 'Input Mode',
		name: 'toolInputMode',
		type: 'options',
		default: 'manual',
		options: [
			{
				name: 'Manual',
				value: 'manual',
				description: 'Use schema-driven fields below',
			},
			{
				name: 'JSON',
				value: 'json',
				description: 'Provide tool arguments as a JSON object',
			},
		],
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
			},
		},
	},
	{
		displayName: 'Tool Parameters',
		name: 'toolParameters',
		type: 'resourceMapper',
		default: {
			mappingMode: 'defineBelow',
			value: null,
		},
		noDataExpression: true,
		typeOptions: {
			loadOptionsDependsOn: ['toolForExecute.value'],
			resourceMapper: {
				resourceMapperMethod: 'getToolParameters',
				mode: 'add',
				fieldWords: {
					singular: 'parameter',
					plural: 'parameters',
				},
				addAllFields: true,
				supportAutoMap: false,
			},
		},
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
				toolInputMode: ['manual'],
			},
		},
	},
	{
		displayName: 'Tool Parameters JSON',
		name: 'toolParametersJson',
		type: 'json',
		default: '{\n  "owner": "octocat",\n  "repo": "Hello-World"\n}',
		typeOptions: {
			rows: 5,
		},
		validateType: 'object',
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
				toolInputMode: ['json'],
			},
		},
	},
	{
		displayName: 'Tool Version',
		name: 'toolVersion',
		type: 'string',
		default: '',
		placeholder: 'e.g. 20250905_00',
		description: 'Optional pinned version. Leave empty to use latest.',
		displayOptions: {
			show: {
				resource: ['tool'],
				operation: ['execute'],
			},
		},
	},
];

export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const toolSlug = this.getNodeParameter('toolForExecute', itemIndex, '', {
		extractValue: true,
	}) as string;
	const connectedAccountId = this.getNodeParameter(
		'connectedAccountForToolExecute',
		itemIndex,
		'',
		{
			extractValue: true,
		},
	) as string;
	const userId = this.getNodeParameter('toolUserId', itemIndex, '') as string;
	const inputMode = this.getNodeParameter('toolInputMode', itemIndex, 'manual') as 'manual' | 'json';
	const toolVersion = this.getNodeParameter('toolVersion', itemIndex, '') as string;

	const parameters =
		inputMode === 'json'
			? parseJsonObjectParameter(
					this,
					'toolParametersJson',
					itemIndex,
					'Tool Parameters JSON must be a valid JSON object',
				)
			: ((this.getNodeParameter('toolParameters.value', itemIndex, {}) as IDataObject) ?? {});

	try {
		const response = await apiRequest.call(
			this,
			'POST',
			`/tools/execute/${toolSlug}`,
			{
				connected_account_id: connectedAccountId,
				user_id: userId,
				arguments: parameters,
				version: toolVersion || undefined,
			},
			{},
			'v3',
		);

		return this.helpers.returnJsonArray(response as JsonObject);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}
}
