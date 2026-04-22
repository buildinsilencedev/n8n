import { DynamicTool } from '@langchain/core/tools';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import {
	NodeConnectionTypes,
	NodeOperationError,
	nodeNameToToolName,
} from 'n8n-workflow';

import { getConnectionHintNoticeField, logWrapper } from '@n8n/ai-utilities';

import {
	executePersonalAgent,
	getPersonalAgent,
	getSelectedAgentId,
	searchPersonalAgents,
} from './personalAgent.helpers';
import { ensureUserId } from '../../vector_store/shared/userScoped';

function getDelegationInput(item: INodeExecutionData): string {
	const candidate =
		item.json.input ??
		item.json.query ??
		item.json.prompt ??
		item.json.text ??
		item.json.message ??
		item.json.chatInput;

	if (typeof candidate === 'string' && candidate.trim()) {
		return candidate;
	}

	return JSON.stringify(item.json);
}

export class PersonalAgentTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Personal Agent Tool',
		name: 'personalAgentTool',
		icon: 'fa:robot',
		group: ['transform'],
		version: 1,
		description: 'Delegate a task to one of your personal agents',
		defaults: {
			name: 'Personal Agent Tool',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Tools'],
				Tools: ['Recommended Tools'],
			},
		},
		inputs: [],
		outputs: [{ type: NodeConnectionTypes.AiTool, displayName: 'Tool' }],
		properties: [
			getConnectionHintNoticeField([NodeConnectionTypes.AiAgent]),
			{
				displayName: 'Personal Agent',
				name: 'agentId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						placeholder: 'Select a personal agent...',
						typeOptions: {
							searchListMethod: 'searchPersonalAgents',
							searchable: true,
							searchFilterRequired: false,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 'e.g. 7f4b5b7d-7e4d-4e2f-aedf-8d82105b2fd0',
					},
				],
			},
		],
	};

	methods = {
		listSearch: {
			searchPersonalAgents,
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const userId = ensureUserId(this, itemIndex);
		const agentId = getSelectedAgentId(this, itemIndex);
		const agent = await getPersonalAgent(userId, agentId);

		if (!agent) {
			throw new NodeOperationError(
				this.getNode(),
				'The selected personal agent was not found or is no longer available.',
				{ itemIndex },
			);
		}

		const tool = new DynamicTool({
			name: nodeNameToToolName(this.getNode()),
			description: agent.description?.trim()
				? `Delegate the current task to the personal agent "${agent.name}". ${agent.description.trim()}`
				: `Delegate the current task to the personal agent "${agent.name}".`,
			func: async (input) => await executePersonalAgent(this, itemIndex, String(input)),
		});

		return {
			response: logWrapper(tool, this),
		};
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const responseData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const response = await executePersonalAgent(this, itemIndex, getDelegationInput(items[itemIndex]));

			responseData.push({
				json: {
					response,
				},
				pairedItem: {
					item: itemIndex,
				},
			});
		}

		return [responseData];
	}
}
