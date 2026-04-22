import type { INodeProperties } from 'n8n-workflow';

import * as execute from './execute.operation';

export { execute };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['tool'],
			},
		},
		options: [
			{
				name: 'Execute',
				value: 'execute',
				action: 'Execute a tool',
				description: 'Execute a Composio tool against a connected account',
			},
		],
		default: 'execute',
	},
	...execute.description,
];
