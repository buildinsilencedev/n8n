import { NodeApiError, type IExecuteFunctions, type INodeExecutionData, type INodeProperties, type JsonObject } from 'n8n-workflow';

import { apiRequest } from '../../transport';

export const description: INodeProperties[] = [
	{
		displayName: 'Toolkit',
		name: 'toolkitForAuthConfigCreate',
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
				resource: ['authConfig'],
				operation: ['create'],
			},
		},
	},
];

export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const toolkitSlug = this.getNodeParameter('toolkitForAuthConfigCreate', itemIndex, '', {
		extractValue: true,
	}) as string;

	try {
		const response = await apiRequest.call(
			this,
			'POST',
			'/auth_configs',
			{
				toolkit: {
					slug: toolkitSlug,
				},
				auth_config: {
					type: 'use_composio_managed_auth',
					credentials: {},
					restrict_to_following_tools: [],
				},
			},
			{},
			'v3',
		);

		return this.helpers.returnJsonArray(response as JsonObject);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}
}
