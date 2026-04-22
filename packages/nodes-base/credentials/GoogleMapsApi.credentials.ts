import type {
	IAuthenticateGeneric,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class GoogleMapsApi implements ICredentialType {
	name = 'googleMapsApi';

	displayName = 'Google Maps API';

	documentationUrl = 'googlemaps';

	icon: Icon = 'file:icons/Google.svg';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-Goog-Api-Key': '={{$credentials.apiKey}}',
			},
		},
	};
}
