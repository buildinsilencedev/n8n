import * as createOperation from '../../actions/authConfig/create.operation';
import * as getManyOperation from '../../actions/authConfig/getMany.operation';
import * as transport from '../../transport';
import { createMockExecuteFunctions } from './helpers';

describe('Composio auth config operations', () => {
	afterEach(() => jest.restoreAllMocks());

	it('creates a Composio-managed auth config', async () => {
		jest.spyOn(transport, 'apiRequest').mockResolvedValue({
			toolkit: { slug: 'github' },
			auth_config: { id: 'ac_123', auth_scheme: 'oauth2', is_composio_managed: true },
		});

		const executeFunctions = createMockExecuteFunctions({
			toolkitForAuthConfigCreate: {
				value: 'github',
			},
		});

		const result = await createOperation.execute.call(executeFunctions, 0);

		expect(transport.apiRequest).toHaveBeenCalledWith(
			'POST',
			'/auth_configs',
			expect.objectContaining({
				toolkit: { slug: 'github' },
				auth_config: expect.objectContaining({
					type: 'use_composio_managed_auth',
				}),
			}),
			{},
			'v3',
		);
		expect(result[0].json).toEqual({
			toolkit: { slug: 'github' },
			auth_config: { id: 'ac_123', auth_scheme: 'oauth2', is_composio_managed: true },
		});
	});

	it('lists auth configs filtered by toolkit', async () => {
		jest.spyOn(transport, 'apiRequest').mockResolvedValue({
			items: [{ id: 'ac_123', auth_scheme: 'oauth2', toolkit: { slug: 'github' } }],
		});

		const executeFunctions = createMockExecuteFunctions({
			toolkitFilterAuthConfigs: {
				value: 'github',
			},
			authConfigSearch: '',
			authConfigShowDisabled: false,
			returnAllAuthConfigs: false,
			limitAuthConfigs: 25,
		});

		const result = await getManyOperation.execute.call(executeFunctions, 0);

		expect(transport.apiRequest).toHaveBeenCalledWith(
			'GET',
			'/auth_configs',
			{},
			expect.objectContaining({
				toolkit_slug: 'github',
				is_composio_managed: 'true',
				limit: 25,
			}),
			'v3.1',
		);
		expect(result[0].json).toEqual({
			id: 'ac_123',
			auth_scheme: 'oauth2',
			toolkit: { slug: 'github' },
		});
	});
});
