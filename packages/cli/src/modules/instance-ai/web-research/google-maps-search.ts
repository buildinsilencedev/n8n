import type { WebSearchResponse } from '@n8n/instance-ai';

const GOOGLE_MAPS_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_MAPS_FIELD_MASK = [
	'places.displayName',
	'places.formattedAddress',
	'places.googleMapsUri',
	'places.websiteUri',
	'places.rating',
	'places.userRatingCount',
	'places.businessStatus',
	'places.primaryTypeDisplayName',
].join(',');

interface GoogleMapsPlaceText {
	text?: string;
}

interface GoogleMapsPlace {
	displayName?: GoogleMapsPlaceText;
	formattedAddress?: string;
	googleMapsUri?: string;
	websiteUri?: string;
	rating?: number;
	userRatingCount?: number;
	businessStatus?: string;
	primaryTypeDisplayName?: GoogleMapsPlaceText;
}

interface GoogleMapsSearchResponse {
	places?: GoogleMapsPlace[];
}

function buildSnippet(place: GoogleMapsPlace): string {
	const parts = [
		place.primaryTypeDisplayName?.text,
		place.formattedAddress,
		place.rating !== undefined
			? `Rating ${place.rating}${place.userRatingCount ? ` (${place.userRatingCount})` : ''}`
			: undefined,
		place.businessStatus,
	];
	return parts.filter((value): value is string => Boolean(value)).join(' | ');
}

function buildFallbackUrl(query: string, place: GoogleMapsPlace): string {
	const lookup = [place.displayName?.text, place.formattedAddress, query]
		.filter((value): value is string => Boolean(value))
		.join(' ');
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lookup)}`;
}

export async function googleMapsSearch(
	apiKey: string,
	query: string,
	options: {
		maxResults?: number;
		includeDomains?: string[];
		excludeDomains?: string[];
	},
): Promise<WebSearchResponse> {
	const response = await fetch(GOOGLE_MAPS_SEARCH_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Goog-Api-Key': apiKey,
			'X-Goog-FieldMask': GOOGLE_MAPS_FIELD_MASK,
		},
		body: JSON.stringify({
			textQuery: query,
			pageSize: options.maxResults ?? 5,
		}),
	});

	if (!response.ok) {
		throw new Error(`Google Maps search failed: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as GoogleMapsSearchResponse;

	return {
		query,
		results: (data.places ?? []).map((place) => ({
			title: place.displayName?.text ?? place.formattedAddress ?? 'Google Maps result',
			url: place.websiteUri ?? place.googleMapsUri ?? buildFallbackUrl(query, place),
			snippet: buildSnippet(place),
		})),
	};
}
