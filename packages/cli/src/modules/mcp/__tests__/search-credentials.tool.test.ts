import { mockInstance } from '@n8n/backend-test-utils';
import { User } from '@n8n/db';

import { createSearchCredentialsTool } from '../tools/search-credentials.tool';

import { CredentialsService } from '@/credentials/credentials.service';
import { Telemetry } from '@/telemetry';

describe('search-credentials MCP tool', () => {
	const user = Object.assign(new User(), { id: 'user-1' });

	const accessibleCredentials = [
		{
			id: 'cred-1',
			name: 'Google Maps',
			type: 'googleMapsApi',
			isManaged: false,
			isGlobal: false,
			isResolvable: false,
			homeProject: { id: 'proj-1', name: 'Team Alpha', type: 'team' },
			sharedWithProjects: [],
		},
		{
			id: 'cred-2',
			name: 'SAM.gov',
			type: 'samGovApi',
			isManaged: false,
			isGlobal: false,
			isResolvable: false,
			homeProject: { id: 'proj-2', name: 'Personal', type: 'personal' },
			sharedWithProjects: [{ id: 'proj-3', name: 'Ops', type: 'team' }],
		},
	];

	const createMocks = () => {
		const credentialsService = mockInstance(CredentialsService, {
			getMany: jest.fn().mockResolvedValue(accessibleCredentials),
			getCredentialsAUserCanUseInAWorkflow: jest
				.fn()
				.mockResolvedValue([{ id: 'cred-2', name: 'SAM.gov', type: 'samGovApi' }]),
		});
		const telemetry = mockInstance(Telemetry, { track: jest.fn() });
		return { credentialsService, telemetry };
	};

	const callHandler = async (
		tool: ReturnType<typeof createSearchCredentialsTool>,
		args: {
			query?: string;
			type?: string;
			workflowId?: string;
			projectId?: string;
			limit?: number;
		},
	) =>
		await tool.handler(
			{
				query: args.query as string,
				type: args.type as string,
				workflowId: args.workflowId as string,
				projectId: args.projectId as string,
				limit: args.limit as number,
			},
			{} as never,
		);

	test('returns safe metadata for accessible credentials', async () => {
		const { credentialsService, telemetry } = createMocks();
		const tool = createSearchCredentialsTool(user, credentialsService, telemetry);

		const result = await callHandler(tool, {});

		expect(result.structuredContent).toEqual({
			data: [
				{
					id: 'cred-1',
					name: 'Google Maps',
					type: 'googleMapsApi',
					homeProject: { id: 'proj-1', name: 'Team Alpha', type: 'team' },
					sharedWithProjects: [],
					isManaged: false,
					isGlobal: false,
					isResolvable: false,
				},
				{
					id: 'cred-2',
					name: 'SAM.gov',
					type: 'samGovApi',
					homeProject: { id: 'proj-2', name: 'Personal', type: 'personal' },
					sharedWithProjects: [{ id: 'proj-3', name: 'Ops', type: 'team' }],
					isManaged: false,
					isGlobal: false,
					isResolvable: false,
				},
			],
			count: 2,
		});
	});

	test('filters by workflow context using only usable credentials', async () => {
		const { credentialsService, telemetry } = createMocks();
		const tool = createSearchCredentialsTool(user, credentialsService, telemetry);

		const result = await callHandler(tool, { workflowId: 'wf-1' });

		expect(credentialsService.getCredentialsAUserCanUseInAWorkflow).toHaveBeenCalledWith(user, {
			workflowId: 'wf-1',
		});
		expect(result.structuredContent).toEqual({
			data: [
				{
					id: 'cred-2',
					name: 'SAM.gov',
					type: 'samGovApi',
					homeProject: { id: 'proj-2', name: 'Personal', type: 'personal' },
					sharedWithProjects: [{ id: 'proj-3', name: 'Ops', type: 'team' }],
					isManaged: false,
					isGlobal: false,
					isResolvable: false,
					usableInContext: true,
				},
			],
			count: 1,
		});
	});

	test('filters by query and type', async () => {
		const { credentialsService, telemetry } = createMocks();
		const tool = createSearchCredentialsTool(user, credentialsService, telemetry);

		const result = await callHandler(tool, { query: 'maps', type: 'googleMapsApi' });

		expect(result.structuredContent).toEqual({
			data: [
				{
					id: 'cred-1',
					name: 'Google Maps',
					type: 'googleMapsApi',
					homeProject: { id: 'proj-1', name: 'Team Alpha', type: 'team' },
					sharedWithProjects: [],
					isManaged: false,
					isGlobal: false,
					isResolvable: false,
				},
			],
			count: 1,
		});
	});

	test('returns an error when both workflowId and projectId are provided', async () => {
		const { credentialsService, telemetry } = createMocks();
		const tool = createSearchCredentialsTool(user, credentialsService, telemetry);

		const result = await callHandler(tool, {
			workflowId: 'wf-1',
			projectId: 'proj-1',
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toEqual({
			error: 'Provide either workflowId or projectId, not both.',
		});
	});
});
