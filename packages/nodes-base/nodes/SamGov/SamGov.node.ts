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

interface SamGovSearchResponse extends IDataObject {
	entityData?: IDataObject[];
	entities?: IDataObject[];
	opportunitiesData?: IDataObject[];
}

const extractSamGovEntities = (response: SamGovSearchResponse): IDataObject[] => {
	if (Array.isArray(response.entityData)) {
		return response.entityData;
	}

	if (Array.isArray(response.entities)) {
		return response.entities;
	}

	return [];
};

const extractSamGovOpportunities = (response: SamGovSearchResponse): IDataObject[] => {
	if (Array.isArray(response.opportunitiesData)) {
		return response.opportunitiesData;
	}

	return [];
};

export class SamGov implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SAM.gov',
		name: 'samGov',
		icon: 'file:samGov.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Search SAM.gov entity registration records and contract opportunities',
		defaults: {
			name: 'SAM.gov',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'samGovApi',
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
						name: 'Search Entities',
						value: 'searchEntities',
						description: 'Search public entity registration data',
						action: 'Search entities',
					},
					{
						name: 'Search Opportunities',
						value: 'searchOpportunities',
						description: 'Search public contract opportunity notices',
						action: 'Search opportunities',
					},
				],
				default: 'searchEntities',
			},
			{
				displayName: 'Search Query',
				name: 'query',
				type: 'string',
				default: '',
				placeholder: 'cybersecurity',
				displayOptions: {
					show: {
						operation: ['searchEntities'],
					},
				},
				description: 'Keyword or phrase used to search entity records',
			},
			{
				displayName: 'Legal Business Name',
				name: 'legalBusinessName',
				type: 'string',
				default: '',
				placeholder: 'Example Corp',
				displayOptions: {
					show: {
						operation: ['searchEntities'],
					},
				},
				description: 'Exact or partial legal business name filter',
			},
			{
				displayName: 'UEI SAM',
				name: 'ueiSAM',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['searchEntities'],
					},
				},
				description: 'Unique Entity ID assigned in SAM.gov',
			},
			{
				displayName: 'CAGE Code',
				name: 'cageCode',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['searchEntities'],
					},
				},
				description: 'Commercial and Government Entity code filter',
			},
			{
				displayName: 'Page',
				name: 'page',
				type: 'number',
				default: 0,
				typeOptions: {
					minValue: 0,
				},
				displayOptions: {
					show: {
						operation: ['searchEntities'],
					},
				},
				description: 'Page number to request',
			},
			{
				displayName: 'Size',
				name: 'size',
				type: 'number',
				default: 10,
				typeOptions: {
					minValue: 1,
					maxValue: 10,
				},
				displayOptions: {
					show: {
						operation: ['searchEntities'],
					},
				},
				description: 'Number of records to return per page',
			},
			{
				displayName: 'Posted From',
				name: 'postedFrom',
				type: 'string',
				default: '',
				placeholder: '01/01/2026',
				displayOptions: {
					show: {
						operation: ['searchOpportunities'],
					},
				},
				description: 'Opportunity posted date from, in MM/DD/YYYY format',
			},
			{
				displayName: 'Posted To',
				name: 'postedTo',
				type: 'string',
				default: '',
				placeholder: '01/31/2026',
				displayOptions: {
					show: {
						operation: ['searchOpportunities'],
					},
				},
				description: 'Opportunity posted date to, in MM/DD/YYYY format',
			},
			{
				displayName: 'Title',
				name: 'opportunityTitle',
				type: 'string',
				default: '',
				placeholder: 'Cybersecurity support',
				displayOptions: {
					show: {
						operation: ['searchOpportunities'],
					},
				},
				description: 'Filter opportunities by title',
			},
			{
				displayName: 'Solicitation Number',
				name: 'solicitationNumber',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['searchOpportunities'],
					},
				},
				description: 'Filter opportunities by solicitation number',
			},
			{
				displayName: 'Notice ID',
				name: 'noticeId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['searchOpportunities'],
					},
				},
				description: 'Filter opportunities by notice ID',
			},
			{
				displayName: 'Procurement Type',
				name: 'procurementType',
				type: 'options',
				options: [
					{
						name: 'Award Notice',
						value: 'a',
					},
					{
						name: 'Combined Synopsis/Solicitation',
						value: 'k',
					},
					{
						name: 'Intent to Bundle Requirements (DoD-Funded)',
						value: 'i',
					},
					{
						name: 'Justification (J&A)',
						value: 'u',
					},
					{
						name: 'Pre-Solicitation',
						value: 'p',
					},
					{
						name: 'Sale of Surplus Property',
						value: 'g',
					},
					{
						name: 'Solicitation',
						value: 'o',
					},
					{
						name: 'Sources Sought',
						value: 'r',
					},
					{
						name: 'Special Notice',
						value: 's',
					},
				],
				default: '',
				displayOptions: {
					show: {
						operation: ['searchOpportunities'],
					},
				},
				description: 'Filter by procurement notice type',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 10,
				typeOptions: {
					minValue: 1,
					maxValue: 1000,
				},
				displayOptions: {
					show: {
						operation: ['searchOpportunities'],
					},
				},
				description: 'Max number of results to return',
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				default: 0,
				typeOptions: {
					minValue: 0,
				},
				displayOptions: {
					show: {
						operation: ['searchOpportunities'],
					},
				},
				description: 'Zero-based result offset',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Include Sections',
						name: 'includeSections',
						type: 'string',
						default: 'entityRegistration,coreData',
						displayOptions: {
							show: {
								'/operation': ['searchEntities'],
							},
						},
						description: 'Comma-separated sections to include in the response',
					},
					{
						displayName: 'Registration Status',
						name: 'registrationStatus',
						type: 'options',
						options: [
							{
								name: 'Active',
								value: 'A',
							},
							{
								name: 'Expired',
								value: 'E',
							},
						],
						default: 'A',
						displayOptions: {
							show: {
								'/operation': ['searchEntities'],
							},
						},
						description: 'Filter results by registration status',
					},
					{
						displayName: 'Classification Code',
						name: 'classificationCode',
						type: 'string',
						default: '',
						displayOptions: {
							show: {
								'/operation': ['searchOpportunities'],
							},
						},
						description: 'Filter opportunities by classification code',
					},
					{
						displayName: 'NAICS Code',
						name: 'naicsCode',
						type: 'string',
						default: '',
						displayOptions: {
							show: {
								'/operation': ['searchOpportunities'],
							},
						},
						description: 'Filter opportunities by NAICS code',
					},
					{
						displayName: 'Organization Code',
						name: 'organizationCode',
						type: 'string',
						default: '',
						displayOptions: {
							show: {
								'/operation': ['searchOpportunities'],
							},
						},
						description: 'Filter opportunities by associated organization code',
					},
					{
						displayName: 'Organization Name',
						name: 'organizationName',
						type: 'string',
						default: '',
						displayOptions: {
							show: {
								'/operation': ['searchOpportunities'],
							},
						},
						description: 'Filter opportunities by associated organization name',
					},
					{
						displayName: 'Place of Performance State',
						name: 'placeOfPerformanceState',
						type: 'string',
						default: '',
						placeholder: 'VA',
						displayOptions: {
							show: {
								'/operation': ['searchOpportunities'],
							},
						},
						description: 'Filter opportunities by place of performance state',
					},
					{
						displayName: 'Place of Performance ZIP',
						name: 'placeOfPerformanceZip',
						type: 'string',
						default: '',
						displayOptions: {
							show: {
								'/operation': ['searchOpportunities'],
							},
						},
						description: 'Filter opportunities by place of performance ZIP code',
					},
					{
						displayName: 'Response Deadline From',
						name: 'responseDeadlineFrom',
						type: 'string',
						default: '',
						placeholder: '02/01/2026',
						displayOptions: {
							show: {
								'/operation': ['searchOpportunities'],
							},
						},
						description: 'Filter opportunities by response deadline start date, in MM/DD/YYYY format',
					},
					{
						displayName: 'Response Deadline To',
						name: 'responseDeadlineTo',
						type: 'string',
						default: '',
						placeholder: '02/28/2026',
						displayOptions: {
							show: {
								'/operation': ['searchOpportunities'],
							},
						},
						description: 'Filter opportunities by response deadline end date, in MM/DD/YYYY format',
					},
					{
						displayName: 'Set-Aside Code',
						name: 'typeOfSetAside',
						type: 'string',
						default: '',
						placeholder: 'SBA',
						displayOptions: {
							show: {
								'/operation': ['searchOpportunities'],
							},
						},
						description: 'Filter opportunities by set-aside code',
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
				const options = this.getNodeParameter('options', i, {}) as IDataObject;

				const requestOptions: IHttpRequestOptions = {
					method: 'GET',
					url: '',
					qs: {},
					json: true,
				};

				if (operation === 'searchEntities') {
					const query = this.getNodeParameter('query', i) as string;
					const legalBusinessName = this.getNodeParameter('legalBusinessName', i) as string;
					const ueiSAM = this.getNodeParameter('ueiSAM', i) as string;
					const cageCode = this.getNodeParameter('cageCode', i) as string;
					const page = this.getNodeParameter('page', i) as number;
					const size = this.getNodeParameter('size', i) as number;

					if (![query, legalBusinessName, ueiSAM, cageCode].some((value) => value.length > 0)) {
						throw new NodeOperationError(
							this.getNode(),
							'Provide at least one search field: Search Query, Legal Business Name, UEI SAM, or CAGE Code.',
							{ itemIndex: i },
						);
					}

					requestOptions.url = 'https://api.sam.gov/entity-information/v4/entities';
					requestOptions.qs = {
						page,
						size,
					};

					if (query.length > 0) {
						requestOptions.qs.q = query;
					}

					if (legalBusinessName.length > 0) {
						requestOptions.qs.legalBusinessName = legalBusinessName;
					}

					if (ueiSAM.length > 0) {
						requestOptions.qs.ueiSAM = ueiSAM;
					}

					if (cageCode.length > 0) {
						requestOptions.qs.cageCode = cageCode;
					}

					const includeSections = options.includeSections;
					if (typeof includeSections === 'string' && includeSections.length > 0) {
						requestOptions.qs.includeSections = includeSections;
					}

					const registrationStatus = options.registrationStatus;
					if (typeof registrationStatus === 'string' && registrationStatus.length > 0) {
						requestOptions.qs.registrationStatus = registrationStatus;
					}
				} else if (operation === 'searchOpportunities') {
					const postedFrom = this.getNodeParameter('postedFrom', i) as string;
					const postedTo = this.getNodeParameter('postedTo', i) as string;
					const opportunityTitle = this.getNodeParameter('opportunityTitle', i) as string;
					const solicitationNumber = this.getNodeParameter('solicitationNumber', i) as string;
					const noticeId = this.getNodeParameter('noticeId', i) as string;
					const procurementType = this.getNodeParameter('procurementType', i) as string;
					const limit = this.getNodeParameter('limit', i) as number;
					const offset = this.getNodeParameter('offset', i) as number;

					if (postedFrom.length === 0 || postedTo.length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'Posted From and Posted To are required for SAM.gov opportunity searches.',
							{ itemIndex: i },
						);
					}

					requestOptions.url = 'https://api.sam.gov/opportunities/v2/search';
					requestOptions.qs = {
						postedFrom,
						postedTo,
						limit,
						offset,
					};

					if (opportunityTitle.length > 0) {
						requestOptions.qs.title = opportunityTitle;
					}

					if (solicitationNumber.length > 0) {
						requestOptions.qs.solnum = solicitationNumber;
					}

					if (noticeId.length > 0) {
						requestOptions.qs.noticeid = noticeId;
					}

					if (procurementType.length > 0) {
						requestOptions.qs.ptype = procurementType;
					}

					const classificationCode = options.classificationCode;
					if (typeof classificationCode === 'string' && classificationCode.length > 0) {
						requestOptions.qs.ccode = classificationCode;
					}

					const naicsCode = options.naicsCode;
					if (typeof naicsCode === 'string' && naicsCode.length > 0) {
						requestOptions.qs.ncode = naicsCode;
					}

					const organizationCode = options.organizationCode;
					if (typeof organizationCode === 'string' && organizationCode.length > 0) {
						requestOptions.qs.organizationCode = organizationCode;
					}

					const organizationName = options.organizationName;
					if (typeof organizationName === 'string' && organizationName.length > 0) {
						requestOptions.qs.organizationName = organizationName;
					}

					const placeOfPerformanceState = options.placeOfPerformanceState;
					if (
						typeof placeOfPerformanceState === 'string' &&
						placeOfPerformanceState.length > 0
					) {
						requestOptions.qs.state = placeOfPerformanceState;
					}

					const placeOfPerformanceZip = options.placeOfPerformanceZip;
					if (typeof placeOfPerformanceZip === 'string' && placeOfPerformanceZip.length > 0) {
						requestOptions.qs.zip = placeOfPerformanceZip;
					}

					const responseDeadlineFrom = options.responseDeadlineFrom;
					if (typeof responseDeadlineFrom === 'string' && responseDeadlineFrom.length > 0) {
						requestOptions.qs.rdlfrom = responseDeadlineFrom;
					}

					const responseDeadlineTo = options.responseDeadlineTo;
					if (typeof responseDeadlineTo === 'string' && responseDeadlineTo.length > 0) {
						requestOptions.qs.rdlto = responseDeadlineTo;
					}

					const typeOfSetAside = options.typeOfSetAside;
					if (typeof typeOfSetAside === 'string' && typeOfSetAside.length > 0) {
						requestOptions.qs.typeOfSetAside = typeOfSetAside;
					}
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported operation: ${operation}`, {
						itemIndex: i,
					});
				}

				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'samGovApi',
					requestOptions,
				)) as SamGovSearchResponse;

				const results =
					operation === 'searchEntities'
						? extractSamGovEntities(response)
						: extractSamGovOpportunities(response);

				if (results.length === 0) {
					continue;
				}

				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(results),
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
