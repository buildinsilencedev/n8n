import type { INodeProperties } from 'n8n-workflow';

import * as create from './create.operation';
import * as getMany from './getMany.operation';

export { create, getMany };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['authConfig'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create an auth config',
				description: 'Create a Composio-managed auth config for a toolkit',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get auth configs',
				description: 'List Composio-managed auth configs',
			},
		],
		default: 'create',
	},
	...create.description,
	...getMany.description,
];
