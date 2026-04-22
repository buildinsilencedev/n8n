import { NodeApiError, type IDataObject, type IExecuteFunctions, type INodeExecutionData, type INodeProperties, type JsonObject } from 'n8n-workflow';

import { apiRequest, apiRequestAllItems } from '../../transport';
import type { ComposioConnectedAccount } from '../../types';

export const description: INodeProperties[] = [
	{
		displayName: 'Toolkit',
		name: 'toolkitFilterConnectedAccounts',
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
				operation: ['getMany'],
			},
		},
	},
	{
		displayName: 'Auth Config',
		name: 'authConfigFilterConnectedAccounts',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		typeOptions: {
			loadOptionsDependsOn: ['toolkitFilterConnectedAccounts.value'],
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
				operation: ['getMany'],
			},
		},
	},
	{
		displayName: 'User ID',
		name: 'connectedAccountUserIdFilter',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['getMany'],
			},
		},
	},
	{
		displayName: 'Statuses',
		name: 'connectedAccountStatuses',
		type: 'string',
		default: '',
		placeholder: 'ACTIVE,INITIALIZING',
		description: 'Optional comma-separated list of statuses to filter by',
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['getMany'],
			},
		},
	},
	{
		displayName: 'Return All',
		name: 'returnAllConnectedAccounts',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['getMany'],
			},
		},
	},
	{
		displayName: 'Limit',
		name: 'limitConnectedAccounts',
		type: 'number',
		typeOptions: {
			minValue: 1,
			maxValue: 1000,
		},
		default: 50,
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
				operation: ['getMany'],
				returnAllConnectedAccounts: [false],
			},
		},
	},
];

export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const toolkitSlug = this.getNodeParameter('toolkitFilterConnectedAccounts', itemIndex, '', {
		extractValue: true,
	}) as string;
	const authConfigId = this.getNodeParameter('authConfigFilterConnectedAccounts', itemIndex, '', {
		extractValue: true,
	}) as string;
	const userId = this.getNodeParameter('connectedAccountUserIdFilter', itemIndex, '') as string;
	const statuses = this.getNodeParameter('connectedAccountStatuses', itemIndex, '') as string;
	const returnAll = this.getNodeParameter('returnAllConnectedAccounts', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limitConnectedAccounts', itemIndex, 50) as number;

	const query: IDataObject = {
		toolkit_slugs: toolkitSlug || undefined,
		auth_config_ids: authConfigId || undefined,
		user_ids: userId || undefined,
		statuses: statuses || undefined,
		limit,
	};

	try {
		const items = returnAll
			? await apiRequestAllItems.call(this, 'GET', '/connected_accounts', query, 'v3.1')
			: (((await apiRequest.call(this, 'GET', '/connected_accounts', {}, query, 'v3.1')) as {
					items: ComposioConnectedAccount[];
				}).items ?? []);

		return this.helpers.returnJsonArray(items as JsonObject[]);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}
}
