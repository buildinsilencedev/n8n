import * as createOperation from '../../actions/connectedAccount/create.operation';
import * as getManyOperation from '../../actions/connectedAccount/getMany.operation';
import * as refreshOperation from '../../actions/connectedAccount/refresh.operation';
import * as transport from '../../transport';
import { createMockExecuteFunctions } from './helpers';

describe('Composio connected account operations', () => {
	afterEach(() => jest.restoreAllMocks());

	it('creates a connected account with immediate auth data', async () => {
		const apiRequestMock = jest.spyOn(transport, 'apiRequest');
		apiRequestMock
			.mockResolvedValueOnce({
				id: 'ac_123',
				auth_scheme: 'api_key',
			})
			.mockResolvedValueOnce({
				id: 'ca_123',
				status: 'ACTIVE',
			});

		const executeFunctions = createMockExecuteFunctions({
			authConfigForConnectedAccountCreate: {
				value: 'ac_123',
			},
			connectedAccountUserId: 'user_123',
			connectedAccountInputMode: 'manual',
			connectedAccountParameters: {
				value: {
					generic_api_key: 'secret',
				},
			},
			connectedAccountAllowMultiple: false,
			connectedAccountCallbackUrl: '',
			connectedAccountValidateCredentials: true,
		});

		const result = await createOperation.execute.call(executeFunctions, 0);

		expect(apiRequestMock).toHaveBeenNthCalledWith(
			2,
			'POST',
			'/connected_accounts',
			expect.objectContaining({
				auth_config: { id: 'ac_123' },
				connection: expect.objectContaining({
					user_id: 'user_123',
					config: {
						auth_scheme: 'API_KEY',
						val: { generic_api_key: 'secret' },
					},
				}),
				validate_credentials: true,
			}),
			{},
			'v3',
		);
		expect(result[0].json).toEqual({
			id: 'ca_123',
			status: 'ACTIVE',
		});
	});

	it('returns redirect details for OAuth-style connected account creation', async () => {
		const apiRequestMock = jest.spyOn(transport, 'apiRequest');
		apiRequestMock
			.mockResolvedValueOnce({
				id: 'ac_123',
				auth_scheme: 'oauth2',
			})
			.mockResolvedValueOnce({
				id: 'ca_123',
				status: 'INITIALIZING',
				redirect_url: 'https://connect.composio.dev/link/ln_123',
			});

		const executeFunctions = createMockExecuteFunctions({
			authConfigForConnectedAccountCreate: {
				value: 'ac_123',
			},
			connectedAccountUserId: 'user_123',
			connectedAccountInputMode: 'manual',
			connectedAccountParameters: {
				value: {},
			},
			connectedAccountAllowMultiple: false,
			connectedAccountCallbackUrl: 'https://example.com/callback',
			connectedAccountValidateCredentials: false,
		});

		const result = await createOperation.execute.call(executeFunctions, 0);

		expect(apiRequestMock).toHaveBeenNthCalledWith(
			2,
			'POST',
			'/connected_accounts',
			expect.objectContaining({
				connection: expect.objectContaining({
					callback_url: 'https://example.com/callback',
					config: {
						auth_scheme: 'OAUTH2',
					},
				}),
			}),
			{},
			'v3',
		);
		expect(result[0].json).toEqual({
			id: 'ca_123',
			status: 'INITIALIZING',
			redirect_url: 'https://connect.composio.dev/link/ln_123',
		});
	});

	it('lists connected accounts using toolkit and user filters', async () => {
		jest.spyOn(transport, 'apiRequest').mockResolvedValue({
			items: [{ id: 'ca_123', status: 'ACTIVE', toolkit: { slug: 'github' } }],
		});

		const executeFunctions = createMockExecuteFunctions({
			toolkitFilterConnectedAccounts: {
				value: 'github',
			},
			authConfigFilterConnectedAccounts: {
				value: 'ac_123',
			},
			connectedAccountUserIdFilter: 'user_123',
			connectedAccountStatuses: 'ACTIVE',
			returnAllConnectedAccounts: false,
			limitConnectedAccounts: 10,
		});

		const result = await getManyOperation.execute.call(executeFunctions, 0);

		expect(transport.apiRequest).toHaveBeenCalledWith(
			'GET',
			'/connected_accounts',
			{},
			expect.objectContaining({
				toolkit_slugs: 'github',
				auth_config_ids: 'ac_123',
				user_ids: 'user_123',
				statuses: 'ACTIVE',
			}),
			'v3.1',
		);
		expect(result[0].json).toEqual({
			id: 'ca_123',
			status: 'ACTIVE',
			toolkit: { slug: 'github' },
		});
	});

	it('refreshes a connected account', async () => {
		jest.spyOn(transport, 'apiRequest').mockResolvedValue({
			id: 'ca_123',
			status: 'ACTIVE',
		});

		const executeFunctions = createMockExecuteFunctions({
			connectedAccountForRefresh: {
				value: 'ca_123',
			},
		});

		const result = await refreshOperation.execute.call(executeFunctions, 0);

		expect(transport.apiRequest).toHaveBeenCalledWith(
			'POST',
			'/connected_accounts/ca_123/refresh',
			{},
			{},
			'v3.1',
		);
		expect(result[0].json).toEqual({
			id: 'ca_123',
			status: 'ACTIVE',
		});
	});
});
