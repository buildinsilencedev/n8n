import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

interface GoogleMapsTextSearchResponse extends IDataObject {
	places?: IDataObject[];
	nextPageToken?: string;
}

export class GoogleMaps implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Google Maps',
		name: 'googleMaps',
		icon: 'file:googleMaps.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Search for places with the Google Maps Places API',
		defaults: {
			name: 'Google Maps',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'googleMapsApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Search Places',
						value: 'searchText',
						description: 'Search for places using a text query',
						action: 'Search for places',
					},
				],
				default: 'searchText',
			},
			{
				displayName: 'Search Query',
				name: 'textQuery',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'coffee shops in Brooklyn',
				displayOptions: {
					show: {
						operation: ['searchText'],
					},
				},
				description: 'Natural-language query used to find places',
			},
			{
				displayName: 'Max Results',
				name: 'pageSize',
				type: 'number',
				default: 10,
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						operation: ['searchText'],
					},
				},
				description: 'Maximum number of places to return',
			},
			{
				displayName: 'Response Fields',
				name: 'fieldMask',
				type: 'string',
				default:
					'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.location,nextPageToken',
				displayOptions: {
					show: {
						operation: ['searchText'],
					},
				},
				description: 'Comma-separated response fields returned by the Places API',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						operation: ['searchText'],
					},
				},
				options: [
					{
						displayName: 'Included Type',
						name: 'includedType',
						type: 'string',
						default: '',
						placeholder: 'restaurant',
						description: 'Restrict results to a supported place type',
					},
					{
						displayName: 'Language Code',
						name: 'languageCode',
						type: 'string',
						default: '',
						placeholder: 'en',
						description: 'Language used for the response, for example en',
					},
					{
						displayName: 'Open Now',
						name: 'openNow',
						type: 'boolean',
						default: false,
						description: 'Whether to only return places that are open right now',
					},
					{
						displayName: 'Page Token',
						name: 'pageToken',
						type: 'string',
						typeOptions: {
							password: true,
						},
						default: '',
						description: 'Pagination token from a previous response',
					},
					{
						displayName: 'Region Code',
						name: 'regionCode',
						type: 'string',
						default: '',
						placeholder: 'us',
						description: 'CLDR region code used to format and bias results',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;

				if (operation !== 'searchText') {
					throw new NodeOperationError(this.getNode(), `Unsupported operation: ${operation}`, {
						itemIndex: i,
					});
				}

				const textQuery = this.getNodeParameter('textQuery', i) as string;
				const pageSize = this.getNodeParameter('pageSize', i) as number;
				const fieldMask = this.getNodeParameter('fieldMask', i) as string;
				const options = this.getNodeParameter('options', i, {}) as IDataObject;

				const body: IDataObject = {
					textQuery,
					pageSize,
				};

				const includedType = options.includedType;
				if (typeof includedType === 'string' && includedType.length > 0) {
					body.includedType = includedType;
				}

				const languageCode = options.languageCode;
				if (typeof languageCode === 'string' && languageCode.length > 0) {
					body.languageCode = languageCode;
				}

				const regionCode = options.regionCode;
				if (typeof regionCode === 'string' && regionCode.length > 0) {
					body.regionCode = regionCode;
				}

				const pageToken = options.pageToken;
				if (typeof pageToken === 'string' && pageToken.length > 0) {
					body.pageToken = pageToken;
				}

				const openNow = options.openNow;
				if (typeof openNow === 'boolean' && openNow) {
					body.openNow = openNow;
				}

				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: 'https://places.googleapis.com/v1/places:searchText',
					body,
					headers: {
						'Content-Type': 'application/json',
						'X-Goog-FieldMask': fieldMask,
					},
					json: true,
				};

				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'googleMapsApi',
					requestOptions,
				)) as GoogleMapsTextSearchResponse;

				const places = Array.isArray(response.places) ? response.places : [];
				if (places.length === 0) {
					continue;
				}

				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(places),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					const message = error instanceof Error ? error.message : String(error);
					returnData.push({ json: { error: message } });
					continue;
				}

				if (error instanceof NodeOperationError) {
					throw error;
				}

				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
