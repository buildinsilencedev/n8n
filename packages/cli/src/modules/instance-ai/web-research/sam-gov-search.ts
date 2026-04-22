import type { WebSearchResponse } from '@n8n/instance-ai';

const SAM_GOV_SEARCH_URL = 'https://api.sam.gov/opportunities/v2/search';
const DAY_IN_MS = 24 * 60 * 60 * 1000;

interface SamGovOpportunity {
	title?: string;
	solicitationNumber?: string;
	uiLink?: string;
	description?: string;
	fullParentPathName?: string;
	postedDate?: string;
	responseDeadLine?: string;
	noticeId?: string;
}

interface SamGovSearchResponse {
	opportunitiesData?: SamGovOpportunity[];
}

function formatDate(value: Date): string {
	return new Intl.DateTimeFormat('en-US', {
		month: '2-digit',
		day: '2-digit',
		year: 'numeric',
		timeZone: 'UTC',
	}).format(value);
}

function buildSamGovUrl(opportunity: SamGovOpportunity, query: string): string {
	if (opportunity.uiLink) return opportunity.uiLink;
	if (opportunity.noticeId) {
		return `https://sam.gov/opp/${encodeURIComponent(opportunity.noticeId)}/view`;
	}
	return `https://sam.gov/search/?index=opp&page=1&sort=-modifiedDate&keyword=${encodeURIComponent(query)}`;
}

function buildSnippet(opportunity: SamGovOpportunity): string {
	const parts = [
		opportunity.solicitationNumber ? `Solicitation ${opportunity.solicitationNumber}` : undefined,
		opportunity.fullParentPathName,
		opportunity.postedDate ? `Posted ${opportunity.postedDate}` : undefined,
		opportunity.responseDeadLine ? `Response deadline ${opportunity.responseDeadLine}` : undefined,
		opportunity.description,
	];
	return parts.filter((value): value is string => Boolean(value)).join(' | ');
}

export async function samGovSearch(
	apiKey: string,
	query: string,
	options: {
		maxResults?: number;
		includeDomains?: string[];
		excludeDomains?: string[];
	},
): Promise<WebSearchResponse> {
	const postedTo = new Date();
	const postedFrom = new Date(postedTo.getTime() - 365 * DAY_IN_MS);
	const params = new URLSearchParams({
		api_key: apiKey,
		title: query,
		postedFrom: formatDate(postedFrom),
		postedTo: formatDate(postedTo),
		limit: String(options.maxResults ?? 5),
		offset: '0',
	});

	const response = await fetch(`${SAM_GOV_SEARCH_URL}?${params}`, {
		headers: {
			Accept: 'application/json',
		},
	});

	if (!response.ok) {
		throw new Error(`SAM.gov search failed: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as SamGovSearchResponse;

	return {
		query,
		results: (data.opportunitiesData ?? []).map((opportunity) => ({
			title: opportunity.title ?? opportunity.solicitationNumber ?? 'SAM.gov opportunity',
			url: buildSamGovUrl(opportunity, query),
			snippet: buildSnippet(opportunity),
		})),
	};
}
