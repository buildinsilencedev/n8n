import * as executeOperation from '../../actions/tool/execute.operation';
import * as transport from '../../transport';
import { createMockExecuteFunctions } from './helpers';

describe('Composio tool execution', () => {
	afterEach(() => jest.restoreAllMocks());

	it('executes a tool with connected account, user, and arguments', async () => {
		jest.spyOn(transport, 'apiRequest').mockResolvedValue({
			successful: true,
			data: {
				id: 1,
			},
		});

		const executeFunctions = createMockExecuteFunctions({
			toolForExecute: {
				value: 'GITHUB_CREATE_ISSUE',
			},
			connectedAccountForToolExecute: {
				value: 'ca_123',
			},
			toolUserId: 'user_123',
			toolInputMode: 'manual',
			toolParameters: {
				value: {
					repo_name: 'octocat/Hello-World',
					title: 'Test issue',
				},
			},
			toolVersion: '20250905_00',
		});

		const result = await executeOperation.execute.call(executeFunctions, 0);

		expect(transport.apiRequest).toHaveBeenCalledWith(
			'POST',
			'/tools/execute/GITHUB_CREATE_ISSUE',
			{
				connected_account_id: 'ca_123',
				user_id: 'user_123',
				arguments: {
					repo_name: 'octocat/Hello-World',
					title: 'Test issue',
				},
				version: '20250905_00',
			},
			{},
			'v3',
		);
		expect(result[0].json).toEqual({
			successful: true,
			data: {
				id: 1,
			},
		});
	});
});
