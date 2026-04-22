import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';

export class ComposioApi implements ICredentialType {
	name = 'composioApi';

	displayName = 'Composio API';

	documentationUrl = 'composio';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Your Composio project API key',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://backend.composio.dev/api/v3.1',
			url: '/toolkits',
		},
	};

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		requestOptions.headers ??= {};
		requestOptions.headers['x-api-key'] = credentials.apiKey as string;

		return requestOptions;
	}
}
