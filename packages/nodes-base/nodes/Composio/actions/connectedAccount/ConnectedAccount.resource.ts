import type { INodeProperties } from 'n8n-workflow';

import * as create from './create.operation';
import * as getMany from './getMany.operation';
import * as refresh from './refresh.operation';

export { create, getMany, refresh };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['connectedAccount'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a connected account',
				description: 'Initiate a Composio connected-account flow',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get connected accounts',
				description: 'List connected accounts',
			},
			{
				name: 'Refresh',
				value: 'refresh',
				action: 'Refresh a connected account',
				description: 'Refresh a connected account authentication state',
			},
		],
		default: 'create',
	},
	...create.description,
	...getMany.description,
	...refresh.description,
];
