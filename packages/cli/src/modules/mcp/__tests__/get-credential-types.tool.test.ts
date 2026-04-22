import { mockInstance } from '@n8n/backend-test-utils';
import { User } from '@n8n/db';

import { createGetCredentialTypesTool } from '../tools/get-credential-types.tool';

import { LoadNodesAndCredentials } from '@/load-nodes-and-credentials';
import { Telemetry } from '@/telemetry';

describe('get-credential-types MCP tool', () => {
	const user = Object.assign(new User(), { id: 'user-1' });

	const createMocks = () => {
		const loadNodesAndCredentials = mockInstance(LoadNodesAndCredentials, {
			collectTypes: jest.fn().mockResolvedValue({
				nodes: [],
				credentials: [
					{ name: 'googleMapsApi', displayName: 'Google Maps API', extends: ['httpRequestAuth'] },
					{ name: 'samGovApi', displayName: 'SAM.gov API', extends: [] },
				],
			}),
		});
		const telemetry = mockInstance(Telemetry, { track: jest.fn() });
		return { loadNodesAndCredentials, telemetry };
	};

	const callHandler = async (
		tool: ReturnType<typeof createGetCredentialTypesTool>,
		args: { query?: string; limit?: number },
	) =>
		await tool.handler(
			{
				query: args.query as string,
				limit: args.limit as number,
			},
			{} as never,
		);

	test('returns installed credential types', async () => {
		const { loadNodesAndCredentials, telemetry } = createMocks();
		const tool = createGetCredentialTypesTool(user, loadNodesAndCredentials, telemetry);

		const result = await callHandler(tool, {});

		expect(result.structuredContent).toEqual({
			data: [
				{
					name: 'googleMapsApi',
					displayName: 'Google Maps API',
					extends: ['httpRequestAuth'],
				},
				{
					name: 'samGovApi',
					displayName: 'SAM.gov API',
					extends: [],
				},
			],
			count: 2,
		});
	});

	test('filters installed credential types by query', async () => {
		const { loadNodesAndCredentials, telemetry } = createMocks();
		const tool = createGetCredentialTypesTool(user, loadNodesAndCredentials, telemetry);

		const result = await callHandler(tool, { query: 'sam' });

		expect(result.structuredContent).toEqual({
			data: [
				{
					name: 'samGovApi',
					displayName: 'SAM.gov API',
					extends: [],
				},
			],
			count: 1,
		});
	});
});
