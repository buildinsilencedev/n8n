import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	IPollFunctions,
	IRequestOptions,
} from 'n8n-workflow';

import type { ComposioApiVersion } from '../types';

const BASE_URL = 'https://backend.composio.dev/api';

type RequestFunctions = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

export async function apiRequest(
	this: RequestFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	query: IDataObject = {},
	apiVersion: ComposioApiVersion = 'v3.1',
	options: Partial<IRequestOptions> = {},
) {
	const requestOptions: IRequestOptions = {
		method,
		uri: `${BASE_URL}/${apiVersion}${endpoint}`,
		qs: query,
		body,
		json: true,
	};

	if (Object.keys(body).length === 0) delete requestOptions.body;

	Object.assign(requestOptions, options);

	return await this.helpers.requestWithAuthentication.call(this, 'composioApi', requestOptions);
}

export async function apiRequestAllItems<T extends IDataObject>(
	this: RequestFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	query: IDataObject = {},
	apiVersion: ComposioApiVersion = 'v3.1',
	itemsKey = 'items',
): Promise<T[]> {
	const returnData: T[] = [];
	let cursor: string | null | undefined = query.cursor as string | null | undefined;

	do {
		const response = (await apiRequest.call(
			this,
			method,
			endpoint,
			{},
			{
				...query,
				cursor,
			},
			apiVersion,
		)) as IDataObject;

		const items = (response[itemsKey] as T[] | undefined) ?? [];
		returnData.push(...items);
		cursor = (response.next_cursor as string | null | undefined) ?? undefined;
	} while (cursor);

	return returnData;
}
