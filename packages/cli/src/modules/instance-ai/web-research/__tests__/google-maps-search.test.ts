import { googleMapsSearch } from '../google-maps-search';

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
	mockFetch.mockReset();
});

const MOCK_GOOGLE_MAPS_RESPONSE = {
	places: [
		{
			displayName: { text: 'n8n HQ' },
			formattedAddress: '123 Automation Ave, Berlin, Germany',
			googleMapsUri: 'https://maps.google.com/?cid=123',
			websiteUri: 'https://n8n.io',
			rating: 4.8,
			userRatingCount: 321,
			businessStatus: 'OPERATIONAL',
			primaryTypeDisplayName: { text: 'Software company' },
		},
	],
};

describe('googleMapsSearch', () => {
	it('sends the expected Places Text Search request', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => MOCK_GOOGLE_MAPS_RESPONSE,
		});

		await googleMapsSearch('gmaps-key', 'n8n berlin', { maxResults: 3 });

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual(
			expect.objectContaining({
				'Content-Type': 'application/json',
				'X-Goog-Api-Key': 'gmaps-key',
			}),
		);
		expect(init.body).toBe(JSON.stringify({ textQuery: 'n8n berlin', pageSize: 3 }));
	});

	it('maps places into search results', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => MOCK_GOOGLE_MAPS_RESPONSE,
		});

		const result = await googleMapsSearch('gmaps-key', 'n8n berlin', {});

		expect(result).toEqual({
			query: 'n8n berlin',
			results: [
				{
					title: 'n8n HQ',
					url: 'https://n8n.io',
					snippet:
						'Software company | 123 Automation Ave, Berlin, Germany | Rating 4.8 (321) | OPERATIONAL',
				},
			],
		});
	});

	it('falls back to a Google Maps URL when no canonical URL is returned', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({
				places: [{ formattedAddress: 'Berlin, Germany' }],
			}),
		});

		const result = await googleMapsSearch('gmaps-key', 'n8n berlin', {});

		expect(result.results[0].url).toContain('https://www.google.com/maps/search/?api=1&query=');
	});

	it('throws on non-OK responses', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 403,
			statusText: 'Forbidden',
		});

		await expect(googleMapsSearch('gmaps-key', 'n8n berlin', {})).rejects.toThrow(
			'Google Maps search failed: 403 Forbidden',
		);
	});
});
