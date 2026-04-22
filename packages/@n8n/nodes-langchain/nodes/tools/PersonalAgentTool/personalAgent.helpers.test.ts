import type { DataSource } from '@n8n/typeorm';
import { Container } from '@n8n/di';
import type { ILoadOptionsFunctions, INode, ISupplyDataFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	executePersonalAgent,
	rejectNestedPersonalAgentDelegation,
	searchPersonalAgents,
	PERSONAL_AGENT_TOOL_NODE_TYPE,
} from './personalAgent.helpers';

type QueryBuilderMock = {
	select: jest.Mock;
	addSelect: jest.Mock;
	from: jest.Mock;
	where: jest.Mock;
	andWhere: jest.Mock;
	orderBy: jest.Mock;
	limit: jest.Mock;
	offset: jest.Mock;
	innerJoin: jest.Mock;
	getRawMany: jest.Mock;
	getRawOne: jest.Mock;
};

function createQueryBuilderMock(): QueryBuilderMock {
	const builder = {
		select: jest.fn(),
		addSelect: jest.fn(),
		from: jest.fn(),
		where: jest.fn(),
		andWhere: jest.fn(),
		orderBy: jest.fn(),
		limit: jest.fn(),
		offset: jest.fn(),
		innerJoin: jest.fn(),
		getRawMany: jest.fn(),
		getRawOne: jest.fn(),
	} as QueryBuilderMock;

	for (const method of [
		'select',
		'addSelect',
		'from',
		'where',
		'andWhere',
		'orderBy',
		'limit',
		'offset',
		'innerJoin',
	] as const) {
		builder[method].mockReturnValue(builder);
	}

	return builder;
}

describe('personalAgent.helpers', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('should search personal agents using the current user id', async () => {
		const queryBuilder = createQueryBuilderMock();
		queryBuilder.getRawMany.mockResolvedValue([
			{ id: 'agent-1', name: 'Research Agent', description: 'Finds answers' },
		]);

		jest.spyOn(Container, 'get').mockReturnValue({
			createQueryBuilder: () => queryBuilder,
		} as unknown as DataSource);

		const result = await searchPersonalAgents.call(
			{
				getNode: jest.fn(() => ({ name: 'Personal Agent Tool' }) as INode),
				additionalData: { userId: 'user-1' },
			} as unknown as ILoadOptionsFunctions,
			'research',
		);

		expect(queryBuilder.where).toHaveBeenCalledWith('agent.ownerId = :userId', { userId: 'user-1' });
		expect(result.results).toEqual([
			{
				name: 'Research Agent',
				value: 'agent-1',
				description: 'Finds answers',
			},
		]);
	});

	it('should execute a selected personal agent and return its final text', async () => {
		const agentQueryBuilder = createQueryBuilderMock();
		agentQueryBuilder.getRawOne.mockResolvedValue({
			id: 'agent-1',
			name: 'Research Agent',
			description: 'Finds answers',
			systemPrompt: 'Always be concise.',
			credentialId: 'cred-1',
			provider: 'openai',
			model: 'gpt-4.1-mini',
		});
		const toolsQueryBuilder = createQueryBuilderMock();
		toolsQueryBuilder.getRawMany.mockResolvedValue([
			{
				definition: {
					id: 'tool-1',
					name: 'Calculator',
					type: '@n8n/n8n-nodes-langchain.toolCalculator',
					typeVersion: 1,
					position: [0, 0],
					parameters: {},
				},
			},
		]);

		jest
			.spyOn(Container, 'get')
			.mockReturnValue({
				createQueryBuilder: jest
					.fn()
					.mockReturnValueOnce(agentQueryBuilder)
					.mockReturnValueOnce(toolsQueryBuilder),
			} as unknown as DataSource);

		const executeWorkflow = jest.fn().mockResolvedValue({
			data: [[{ json: { output: 'Delegated answer' } }]],
		});
		const getNodeParameter = jest.fn(
			(name: string, _index: number, defaultValue?: unknown, options?: { extractValue?: boolean }) => {
				if (name === 'agentId') {
					return options?.extractValue ? 'agent-1' : { value: 'agent-1' };
				}
				return defaultValue;
			},
		);

		const ctx = {
			getNode: jest.fn(
				() =>
					({
						name: 'Delegate Agent',
						type: PERSONAL_AGENT_TOOL_NODE_TYPE,
						typeVersion: 1,
						parameters: {},
					}) as INode,
			),
			getNodeParameter,
			additionalData: { userId: 'user-1' },
			executeWorkflow,
		} as unknown as ISupplyDataFunctions;

		await expect(executePersonalAgent(ctx, 0, 'Summarize this')).resolves.toBe('Delegated answer');
		expect(executeWorkflow).toHaveBeenCalled();
	});

	it('should reject a second nested personal-agent delegation hop', async () => {
		const ctx = {
			getNode: jest.fn(
				() =>
					({
						name: 'Delegate Agent',
						type: PERSONAL_AGENT_TOOL_NODE_TYPE,
						typeVersion: 1,
						parameters: {},
					}) as INode,
			),
		} as unknown as ISupplyDataFunctions;

		expect(() =>
			rejectNestedPersonalAgentDelegation(ctx, 0, [
				{
					id: 'tool-1',
					name: 'Nested Delegate',
					type: PERSONAL_AGENT_TOOL_NODE_TYPE,
					typeVersion: 1,
					position: [0, 0],
					parameters: { agentId: { value: 'agent-2' } },
				},
			]),
		).toThrow(NodeOperationError);
	});
});
