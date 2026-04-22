import type { ICredentialDataDecryptedObject, IHttpRequestOptions } from 'n8n-workflow';

import { ComposioApi } from '../ComposioApi.credentials';

describe('ComposioApi Credential', () => {
	const composioApi = new ComposioApi();

	it('should have the expected credential metadata', () => {
		expect(composioApi.name).toBe('composioApi');
		expect(composioApi.displayName).toBe('Composio API');
		expect(composioApi.documentationUrl).toBe('composio');
		expect(composioApi.properties).toHaveLength(1);
		expect(composioApi.test.request.baseURL).toBe('https://backend.composio.dev/api/v3.1');
		expect(composioApi.test.request.url).toBe('/toolkits');
	});

	it('should add the x-api-key header', async () => {
		const credentials: ICredentialDataDecryptedObject = {
			apiKey: 'cmp_test_key',
		};

		const requestOptions: IHttpRequestOptions = {
			headers: {},
			url: '/toolkits',
			baseURL: 'https://backend.composio.dev/api/v3.1',
		};

		const result = await composioApi.authenticate(credentials, requestOptions);

		expect(result.headers).toEqual({
			'x-api-key': 'cmp_test_key',
		});
	});

	it('should preserve existing headers', async () => {
		const credentials: ICredentialDataDecryptedObject = {
			apiKey: 'cmp_test_key',
		};

		const requestOptions: IHttpRequestOptions = {
			headers: {
				'Content-Type': 'application/json',
			},
			url: '/toolkits',
			baseURL: 'https://backend.composio.dev/api/v3.1',
		};

		const result = await composioApi.authenticate(credentials, requestOptions);

		expect(result.headers).toEqual({
			'Content-Type': 'application/json',
			'x-api-key': 'cmp_test_key',
		});
	});
});
