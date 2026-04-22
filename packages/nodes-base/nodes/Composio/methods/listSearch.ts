import type {
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
} from 'n8n-workflow';

import { getParameterValue, normalizeAuthScheme, toBooleanString } from '../helpers';
import { apiRequest } from '../transport';
import type {
	ComposioAuthConfig,
	ComposioConnectedAccount,
	ComposioListResponse,
	ComposioToolSchema,
	ComposioToolkit,
} from '../types';

const SEARCH_LIMIT = 100;

export async function searchToolkits(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const response = (await apiRequest.call(
		this,
		'GET',
		'/toolkits',
		{},
		{
			search: filter ?? '',
			sort_by: 'alphabetically',
			include_deprecated: false,
			limit: SEARCH_LIMIT,
			cursor: paginationToken,
		},
		'v3.1',
	)) as ComposioListResponse<ComposioToolkit>;

	const results: INodeListSearchItems[] = response.items.map((toolkit) => ({
		name: toolkit.name,
		value: toolkit.slug,
		description: toolkit.meta?.description,
		url: toolkit.auth_guide_url,
	}));

	return {
		results,
		paginationToken: response.next_cursor ?? undefined,
	};
}

export async function searchAuthConfigs(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const toolkitSlug = getParameterValue<string>(
		this,
		['toolkitForConnectedAccountCreate', 'toolkitFilterAuthConfigs', 'toolkitFilterConnectedAccounts'],
		{ extractValue: true },
	);

	const response = (await apiRequest.call(
		this,
		'GET',
		'/auth_configs',
		{},
		{
			is_composio_managed: toBooleanString(true),
			toolkit_slug: toolkitSlug,
			search: filter ?? '',
			show_disabled: true,
			limit: SEARCH_LIMIT,
			cursor: paginationToken,
		},
		'v3.1',
	)) as ComposioListResponse<ComposioAuthConfig>;

	const results: INodeListSearchItems[] = response.items.map((authConfig) => ({
		name: authConfig.name ?? `${authConfig.toolkit?.slug ?? 'Toolkit'} (${authConfig.id})`,
		value: authConfig.id,
		description: normalizeAuthScheme(authConfig.auth_scheme),
		url: authConfig.toolkit?.auth_guide_url,
	}));

	return {
		results,
		paginationToken: response.next_cursor ?? undefined,
	};
}

export async function searchConnectedAccounts(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const toolkitSlug = getParameterValue<string>(
		this,
		[
			'toolkitFilterConnectedAccounts',
			'toolkitFilterConnectedAccountRefresh',
			'toolkitForToolExecute',
		],
		{ extractValue: true },
	);
	const authConfigId = getParameterValue<string>(
		this,
		['authConfigFilterConnectedAccounts', 'authConfigFilterConnectedAccountRefresh'],
		{ extractValue: true },
	);
	const userId = getParameterValue<string>(this, [
		'connectedAccountUserIdFilter',
		'connectedAccountUserIdForRefresh',
		'toolUserId',
	]);
	const statusFilter = getParameterValue<string>(this, ['connectedAccountStatuses']);

	const response = (await apiRequest.call(
		this,
		'GET',
		'/connected_accounts',
		{},
		{
			toolkit_slugs: toolkitSlug ? toolkitSlug : undefined,
			auth_config_ids: authConfigId ? authConfigId : undefined,
			user_ids: userId ? userId : undefined,
			statuses: statusFilter ? statusFilter : undefined,
			limit: SEARCH_LIMIT,
			cursor: paginationToken,
		},
		'v3.1',
	)) as ComposioListResponse<ComposioConnectedAccount>;

	const filteredItems = response.items.filter((account) => {
		if (!filter) return true;

		const normalizedFilter = filter.toLowerCase();
		return (
			account.id.toLowerCase().includes(normalizedFilter) ||
			account.toolkit?.slug?.toLowerCase().includes(normalizedFilter) ||
			account.status?.toLowerCase().includes(normalizedFilter)
		);
	});

	const results: INodeListSearchItems[] = filteredItems.map((account) => ({
		name: `${account.toolkit?.slug ?? 'account'} (${account.id})`,
		value: account.id,
		description: account.status,
	}));

	return {
		results,
		paginationToken: response.next_cursor ?? undefined,
	};
}

export async function searchTools(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const toolkitSlug = getParameterValue<string>(this, ['toolkitForToolExecute'], {
		extractValue: true,
	});

	const response = (await apiRequest.call(
		this,
		'GET',
		'/tools',
		{},
		{
			toolkit_slug: toolkitSlug,
			query: filter ?? '',
			toolkit_versions: 'latest',
			limit: SEARCH_LIMIT,
			cursor: paginationToken,
		},
		'v3.1',
	)) as ComposioListResponse<ComposioToolSchema>;

	const results: INodeListSearchItems[] = response.items.map((tool) => ({
		name: tool.slug,
		value: tool.slug,
		description: tool.description ?? tool.name,
		url: toolkitSlug ? `https://docs.composio.dev/toolkits/${toolkitSlug}` : undefined,
	}));

	return {
		results,
		paginationToken: response.next_cursor ?? undefined,
	};
}
