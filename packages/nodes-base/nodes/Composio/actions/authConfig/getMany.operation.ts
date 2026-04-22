import { NodeApiError, type IDataObject, type IExecuteFunctions, type INodeExecutionData, type INodeProperties, type JsonObject } from 'n8n-workflow';

import { toBooleanString } from '../../helpers';
import { apiRequest, apiRequestAllItems } from '../../transport';
import type { ComposioAuthConfig } from '../../types';

export const description: INodeProperties[] = [
	{
		displayName: 'Toolkit',
		name: 'toolkitFilterAuthConfigs',
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
				resource: ['authConfig'],
				operation: ['getMany'],
			},
		},
	},
	{
		displayName: 'Search',
		name: 'authConfigSearch',
		type: 'string',
		default: '',
		placeholder: 'Filter by name or ID',
		displayOptions: {
			show: {
				resource: ['authConfig'],
				operation: ['getMany'],
			},
		},
	},
	{
		displayName: 'Show Disabled',
		name: 'authConfigShowDisabled',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['authConfig'],
				operation: ['getMany'],
			},
		},
	},
	{
		displayName: 'Return All',
		name: 'returnAllAuthConfigs',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['authConfig'],
				operation: ['getMany'],
			},
		},
	},
	{
		displayName: 'Limit',
		name: 'limitAuthConfigs',
		type: 'number',
		typeOptions: {
			minValue: 1,
			maxValue: 1000,
		},
		default: 50,
		displayOptions: {
			show: {
				resource: ['authConfig'],
				operation: ['getMany'],
				returnAllAuthConfigs: [false],
			},
		},
	},
];

export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const toolkitSlug = this.getNodeParameter('toolkitFilterAuthConfigs', itemIndex, '', {
		extractValue: true,
	}) as string;
	const search = this.getNodeParameter('authConfigSearch', itemIndex, '') as string;
	const showDisabled = this.getNodeParameter('authConfigShowDisabled', itemIndex, false) as boolean;
	const returnAll = this.getNodeParameter('returnAllAuthConfigs', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limitAuthConfigs', itemIndex, 50) as number;

	const query: IDataObject = {
		is_composio_managed: toBooleanString(true),
		toolkit_slug: toolkitSlug || undefined,
		search: search || undefined,
		show_disabled: showDisabled,
		limit,
	};

	try {
		const items = returnAll
			? await apiRequestAllItems.call(this, 'GET', '/auth_configs', query, 'v3.1')
			: (((await apiRequest.call(this, 'GET', '/auth_configs', {}, query, 'v3.1')) as {
					items: ComposioAuthConfig[];
				}).items ?? []);

		return this.helpers.returnJsonArray(items as JsonObject[]);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}
}
