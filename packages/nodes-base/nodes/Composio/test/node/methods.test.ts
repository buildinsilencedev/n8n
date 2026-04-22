import * as listSearch from '../../methods/listSearch';
import * as resourceMapping from '../../methods/resourceMapping';
import * as transport from '../../transport';
import { createMockLoadOptionsFunctions } from './helpers';

describe('Composio node dynamic methods', () => {
	afterEach(() => jest.restoreAllMocks());

	it('returns toolkit search results', async () => {
		jest.spyOn(transport, 'apiRequest').mockResolvedValue({
			items: [{ slug: 'github', name: 'GitHub', auth_guide_url: 'https://docs.example/github' }],
			next_cursor: 'cursor_1',
		});

		const loadOptionsFunctions = createMockLoadOptionsFunctions({});
		const result = await listSearch.searchToolkits.call(loadOptionsFunctions, 'git');

		expect(result).toEqual({
			results: [
				{
					name: 'GitHub',
					value: 'github',
					description: undefined,
					url: 'https://docs.example/github',
				},
			],
			paginationToken: 'cursor_1',
		});
	});

	it('returns tool search results scoped to the selected toolkit', async () => {
		jest.spyOn(transport, 'apiRequest').mockResolvedValue({
			items: [{ slug: 'GITHUB_CREATE_ISSUE', name: 'GitHub Issues', description: 'Create issue' }],
			next_cursor: null,
		});

		const loadOptionsFunctions = createMockLoadOptionsFunctions({
			toolkitForToolExecute: {
				value: 'github',
			},
			toolUserId: 'user_123',
		});
		const result = await listSearch.searchTools.call(loadOptionsFunctions, 'issue');

		expect(transport.apiRequest).toHaveBeenCalledWith(
			'GET',
			'/tools',
			{},
			expect.objectContaining({
				toolkit_slug: 'github',
				query: 'issue',
				toolkit_versions: 'latest',
			}),
			'v3.1',
		);
		expect(result.results[0]).toEqual({
			name: 'GITHUB_CREATE_ISSUE',
			value: 'GITHUB_CREATE_ISSUE',
			description: 'Create issue',
			url: 'https://docs.composio.dev/toolkits/github',
		});
	});

	it('maps tool schema fields into resource mapper fields', async () => {
		jest.spyOn(transport, 'apiRequest').mockResolvedValue({
			slug: 'GITHUB_CREATE_ISSUE',
			input_parameters: {
				title: { type: 'string', required: true },
				labels: { type: 'array', required: false },
				state: { type: 'string', enum: ['open', 'closed'] },
			},
		});

		const loadOptionsFunctions = createMockLoadOptionsFunctions({
			toolForExecute: {
				value: 'GITHUB_CREATE_ISSUE',
			},
		});
		const result = await resourceMapping.getToolParameters.call(loadOptionsFunctions);

		expect(result.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: 'title',
					type: 'string',
					required: true,
				}),
				expect.objectContaining({
					id: 'labels',
					type: 'array',
				}),
				expect.objectContaining({
					id: 'state',
					type: 'options',
					options: [
						{ name: 'Open', value: 'open' },
						{ name: 'Closed', value: 'closed' },
					],
				}),
			]),
		);
	});

	it('maps connected account initiation fields and coerces unsupported types safely', async () => {
		const apiRequestMock = jest.spyOn(transport, 'apiRequest');
		apiRequestMock
			.mockResolvedValueOnce({
				slug: 'github',
				auth_config_details: [
					{
						mode: 'api_key',
						fields: {
							connected_account_initiation: {
								required: [
									{
										displayName: 'Api Key',
										name: 'generic_api_key',
										default: '',
										type: 'string',
										required: true,
									},
								],
								optional: [
									{
										displayName: 'Custom Payload',
										name: 'custom_payload',
										default: '',
										type: 'unknown-custom-type',
									},
								],
							},
						},
					},
				],
			})
			.mockResolvedValueOnce({
				id: 'ac_123',
				auth_scheme: 'api_key',
			});

		const loadOptionsFunctions = createMockLoadOptionsFunctions({
			toolkitForConnectedAccountCreate: {
				value: 'github',
			},
			authConfigForConnectedAccountCreate: {
				value: 'ac_123',
			},
		});
		const result = await resourceMapping.getConnectedAccountFields.call(loadOptionsFunctions);

		expect(result.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: 'generic_api_key',
					type: 'string',
					required: true,
				}),
				expect.objectContaining({
					id: 'custom_payload',
					type: 'string',
				}),
			]),
		);
	});
});
