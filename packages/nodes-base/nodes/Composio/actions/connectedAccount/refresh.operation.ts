import { NodeApiError, type IExecuteFunctions, type INodeExecutionData, type INodeProperties, type JsonObject } from 'n8n-workflow';

import { apiRequest } from '../../transport';

export const description: INodeProperties[] = [
	{
		displayName: 'Toolkit',
		name: 'toolkitFilterConnectedAccountRefresh',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
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
				operation: ['refresh'],
			},
		},
	},
	{
		displayName: 'Auth Config',
		name: 'authConfigFilterConnectedAccountRefresh',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		typeOptions: {
			loadOptionsDependsOn: ['toolkitFilterConnectedAccountRefresh.value'],
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
				operation: ['refresh'],
			},
		},
	},
	{
		displayName: 'User ID',
		name: 'connectedAccountUserIdForRefresh',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['refresh'],
			},
		},
	},
	{
		displayName: 'Connected Account',
		name: 'connectedAccountForRefresh',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		typeOptions: {
			loadOptionsDependsOn: [
				'toolkitFilterConnectedAccountRefresh.value',
				'authConfigFilterConnectedAccountRefresh.value',
				'connectedAccountUserIdForRefresh',
			],
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
				resource: ['connectedAccount'],
				operation: ['refresh'],
			},
		},
	},
];

export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const connectedAccountId = this.getNodeParameter('connectedAccountForRefresh', itemIndex, '', {
		extractValue: true,
	}) as string;

	try {
		const response = await apiRequest.call(
			this,
			'POST',
			`/connected_accounts/${connectedAccountId}/refresh`,
			{},
			{},
			'v3.1',
		);

		return this.helpers.returnJsonArray(response as JsonObject);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}
}
