import { NodeConnectionTypes } from 'n8n-workflow';
import type { IExecuteFunctions, INodeType, INodeTypeDescription } from 'n8n-workflow';

import * as authConfig from './actions/authConfig/AuthConfig.resource';
import * as connectedAccount from './actions/connectedAccount/ConnectedAccount.resource';
import { router } from './actions/router';
import * as tool from './actions/tool/Tool.resource';
import {
	searchAuthConfigs,
	searchConnectedAccounts,
	searchToolkits,
	searchTools,
} from './methods/listSearch';
import { getConnectedAccountFields, getToolParameters } from './methods/resourceMapping';

export class Composio implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Composio',
		name: 'composio',
		icon: 'file:composio.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Work with Composio auth configs, connected accounts, and tools',
		defaults: {
			name: 'Composio',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'composioApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Auth Config',
						value: 'authConfig',
					},
					{
						name: 'Connected Account',
						value: 'connectedAccount',
					},
					{
						name: 'Tool',
						value: 'tool',
					},
				],
				default: 'tool',
			},
			...authConfig.description,
			...connectedAccount.description,
			...tool.description,
		],
	};

	methods = {
		listSearch: {
			searchToolkits,
			searchAuthConfigs,
			searchConnectedAccounts,
			searchTools,
		},
		resourceMapping: {
			getConnectedAccountFields,
			getToolParameters,
		},
	};

	async execute(this: IExecuteFunctions) {
		return await router.call(this);
	}
}
