import { StructuredToolkit } from 'n8n-core';
import type { ILoadOptionsFunctions, INode, ISupplyDataFunctions } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { ComposioTool, searchComposioConnectedAccounts } from './ComposioTool.node';

import { apiRequest, apiRequestAllItems } from 'n8n-nodes-base/dist/nodes/Composio/transport/index';

jest.mock('n8n-nodes-base/dist/nodes/Composio/transport/index', () => ({
	apiRequest: jest.fn(),
	apiRequestAllItems: jest.fn(),
}));

const mockedApiRequest = jest.mocked(apiRequest);
const mockedApiRequestAllItems = jest.mocked(apiRequestAllItems);

describe('ComposioTool', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	it('should expose itself as an AI Tool node with no inputs', () => {
		const node = new ComposioTool();

		expect(node.description.inputs).toEqual([]);
		expect(node.description.outputs).toEqual([
			{ type: NodeConnectionTypes.AiTool, displayName: 'Tools' },
		]);
	});

	it('should build a toolkit from the selected Composio tools and execute them', async () => {
		mockedApiRequestAllItems.mockResolvedValue([
			{
				slug: 'GITHUB_CREATE_ISSUE',
				name: 'Create issue',
				description: 'Create a GitHub issue',
				input_parameters: {
					owner: { type: 'string', required: true },
					repo: { type: 'string', required: true },
				},
				version: '20250905_00',
			},
		]);
		mockedApiRequest.mockResolvedValue({ ok: true, issueUrl: 'https://github.com/octo/repo/issues/1' });

		const node = new ComposioTool();
		const getNodeParameter = jest.fn(
			(name: string, _index: number, defaultValue?: unknown, options?: { extractValue?: boolean }) => {
				if (name === 'toolkit' && options?.extractValue) {
					return 'github';
				}
				if (name === 'connectedAccountId' && options?.extractValue) {
					return 'ca_123';
				}

				const parameters: Record<string, unknown> = {
					toolkit: { value: 'github' },
					include: 'all',
					selectedTools: [],
					excludedTools: [],
					connectedAccountId: { value: 'ca_123' },
					userId: 'user_123',
				};

				return parameters[name] ?? defaultValue;
			},
		);
		const supplyDataResult = await node.supplyData.call(
			{
				getNode: jest.fn(
					() =>
						({
							name: 'Composio Tool',
						}) as INode,
				),
				addInputData: jest.fn(() => ({ index: 0 })),
				addOutputData: jest.fn(),
				logAiEvent: jest.fn(),
				logger: {
					debug: jest.fn(),
					error: jest.fn(),
				},
				getNodeParameter,
			} as unknown as ISupplyDataFunctions,
			0,
		);

		expect(supplyDataResult.response).toBeInstanceOf(StructuredToolkit);
		const tools = (supplyDataResult.response as StructuredToolkit).getTools();
		expect(tools).toHaveLength(1);

		const result = await tools[0].invoke({ owner: 'octo', repo: 'repo' });

		expect(result).toContain('issueUrl');
		expect(mockedApiRequest).toHaveBeenCalledWith(
			'POST',
			'/tools/execute/GITHUB_CREATE_ISSUE',
			{
				connected_account_id: 'ca_123',
				user_id: 'user_123',
				arguments: { owner: 'octo', repo: 'repo' },
				version: '20250905_00',
			},
			{},
			'v3',
		);
	});

	it('should search connected accounts using the new node parameters', async () => {
		mockedApiRequest.mockResolvedValue({
			items: [
				{
					id: 'ca_123',
					status: 'ACTIVE',
					toolkit: { slug: 'github' },
				},
			],
			next_cursor: 'next-page',
		});

		const result = await searchComposioConnectedAccounts.call(
			{
				getNode: jest.fn(
					() =>
						({
							name: 'Composio Tool',
						}) as INode,
				),
				getNodeParameter: jest.fn(
					(
						name: string,
						_index: number,
						defaultValue?: unknown,
						options?: { extractValue?: boolean },
					) => {
						if (name === 'toolkit' && options?.extractValue) {
							return 'github';
						}
						if (name === 'userId') {
							return 'user_123';
						}
						return defaultValue;
					},
				),
			} as unknown as ILoadOptionsFunctions,
			'ca_',
			'cursor_1',
		);

		expect(mockedApiRequest).toHaveBeenCalledWith(
			'GET',
			'/connected_accounts',
			{},
			{
				toolkit_slugs: 'github',
				user_ids: 'user_123',
				limit: 100,
				cursor: 'cursor_1',
			},
			'v3.1',
		);
		expect(result.paginationToken).toBe('next-page');
		expect(result.results).toHaveLength(1);
		expect(result.results[0]?.name).toBe('github (ca_123)');
		expect(result.results[0]?.value).toBe('ca_123');
		expect(result.results[0]?.description).toBe('ACTIVE');
	});
});
