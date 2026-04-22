import { NodeApiError, type IDataObject, type IExecuteFunctions, type INodeExecutionData, type INodeProperties, type JsonObject } from 'n8n-workflow';

import { omitEmptyValues, parseJsonObjectParameter, toComposioAuthScheme } from '../../helpers';
import { apiRequest } from '../../transport';
import type { ComposioAuthConfig } from '../../types';

export const description: INodeProperties[] = [
	{
		displayName: 'Toolkit',
		name: 'toolkitForConnectedAccountCreate',
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
				resource: ['connectedAccount'],
				operation: ['create'],
			},
		},
	},
	{
		displayName: 'Auth Config',
		name: 'authConfigForConnectedAccountCreate',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		typeOptions: {
			loadOptionsDependsOn: ['toolkitForConnectedAccountCreate.value'],
		},
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select an auth config...',
				typeOptions: {
					searchListMethod: 'searchAuthConfigs',
					searchable: true,
					searchFilterRequired: false,
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. ac_12345',
			},
		],
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['create'],
			},
		},
	},
	{
		displayName: 'User ID',
		name: 'connectedAccountUserId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['create'],
			},
		},
	},
	{
		displayName: 'Input Mode',
		name: 'connectedAccountInputMode',
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
				description: 'Provide connection values as a JSON object',
			},
		],
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['create'],
			},
		},
	},
	{
		displayName: 'Connection Fields',
		name: 'connectedAccountParameters',
		type: 'resourceMapper',
		default: {
			mappingMode: 'defineBelow',
			value: null,
		},
		noDataExpression: true,
		typeOptions: {
			loadOptionsDependsOn: [
				'toolkitForConnectedAccountCreate.value',
				'authConfigForConnectedAccountCreate.value',
			],
			resourceMapper: {
				resourceMapperMethod: 'getConnectedAccountFields',
				mode: 'add',
				fieldWords: {
					singular: 'field',
					plural: 'fields',
				},
				addAllFields: true,
				supportAutoMap: false,
			},
		},
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['create'],
				connectedAccountInputMode: ['manual'],
			},
		},
	},
	{
		displayName: 'Connection Fields JSON',
		name: 'connectedAccountParametersJson',
		type: 'json',
		default: '{\n  "api_key": "value"\n}',
		typeOptions: {
			rows: 5,
		},
		validateType: 'object',
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['create'],
				connectedAccountInputMode: ['json'],
			},
		},
	},
	{
		displayName: 'Allow Multiple',
		name: 'connectedAccountAllowMultiple',
		type: 'boolean',
		default: false,
		description: 'Whether to allow multiple accounts for the same toolkit and user',
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['create'],
			},
		},
	},
	{
		displayName: 'Callback URL',
		name: 'connectedAccountCallbackUrl',
		type: 'string',
		default: '',
		placeholder: 'https://example.com/callback',
		description: 'Optional redirect destination after a hosted OAuth flow completes',
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['create'],
			},
		},
	},
	{
		displayName: 'Validate Credentials',
		name: 'connectedAccountValidateCredentials',
		type: 'boolean',
		default: false,
		description: 'Whether to validate API-key credentials when the toolkit supports it',
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['create'],
			},
		},
	},
];

export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const authConfigId = this.getNodeParameter('authConfigForConnectedAccountCreate', itemIndex, '', {
		extractValue: true,
	}) as string;
	const userId = this.getNodeParameter('connectedAccountUserId', itemIndex, '') as string;
	const inputMode = this.getNodeParameter('connectedAccountInputMode', itemIndex, 'manual') as
		| 'manual'
		| 'json';
	const allowMultiple = this.getNodeParameter(
		'connectedAccountAllowMultiple',
		itemIndex,
		false,
	) as boolean;
	const callbackUrl = this.getNodeParameter('connectedAccountCallbackUrl', itemIndex, '') as string;
	const validateCredentials = this.getNodeParameter(
		'connectedAccountValidateCredentials',
		itemIndex,
		false,
	) as boolean;

	const parameters =
		inputMode === 'json'
			? parseJsonObjectParameter(
					this,
					'connectedAccountParametersJson',
					itemIndex,
					'Connection Fields JSON must be a valid JSON object',
				)
			: ((this.getNodeParameter('connectedAccountParameters.value', itemIndex, {}) as IDataObject) ?? {});

	try {
		const authConfig = (await apiRequest.call(
			this,
			'GET',
			`/auth_configs/${authConfigId}`,
			{},
			{},
			'v3.1',
		)) as ComposioAuthConfig;

		const requestBody: IDataObject = {
			auth_config: {
				id: authConfigId,
			},
			connection: {
				user_id: userId,
				allow_multiple: allowMultiple,
			},
			validate_credentials: validateCredentials,
		};

		if (callbackUrl) {
			(requestBody.connection as IDataObject).callback_url = callbackUrl;
		}

		const connectionConfig: IDataObject = {
			auth_scheme: toComposioAuthScheme(authConfig.auth_scheme),
		};

		const cleanedParameters = omitEmptyValues(parameters);
		if (Object.keys(cleanedParameters).length > 0) {
			connectionConfig.val = cleanedParameters;
		}

		(requestBody.connection as IDataObject).config = connectionConfig;

		const response = await apiRequest.call(
			this,
			'POST',
			'/connected_accounts',
			requestBody,
			{},
			'v3',
		);

		return this.helpers.returnJsonArray(response as JsonObject);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}
}
