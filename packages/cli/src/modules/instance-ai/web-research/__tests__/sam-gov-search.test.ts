import { samGovSearch } from '../sam-gov-search';

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
	mockFetch.mockReset();
});

const MOCK_SAM_GOV_RESPONSE = {
	opportunitiesData: [
		{
			title: 'Automation platform support',
			solicitationNumber: 'N8N-001',
			uiLink: 'https://sam.gov/opp/example/view',
			fullParentPathName: 'General Services Administration',
			postedDate: '04/01/2026',
			responseDeadLine: '05/01/2026',
			description: 'Support automation platform implementation.',
			noticeId: 'abc123',
		},
	],
};

describe('samGovSearch', () => {
	it('sends the expected opportunities request', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => MOCK_SAM_GOV_RESPONSE,
		});

		await samGovSearch('sam-key', 'automation platform', { maxResults: 7 });

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('https://api.sam.gov/opportunities/v2/search?');
		const parsed = new URL(url);
		expect(parsed.searchParams.get('api_key')).toBe('sam-key');
		expect(parsed.searchParams.get('title')).toBe('automation platform');
		expect(parsed.searchParams.get('limit')).toBe('7');
		expect(parsed.searchParams.get('postedFrom')).toBeTruthy();
		expect(parsed.searchParams.get('postedTo')).toBeTruthy();
		expect(init.headers).toEqual(
			expect.objectContaining({
				Accept: 'application/json',
			}),
		);
	});

	it('maps opportunities into search results', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => MOCK_SAM_GOV_RESPONSE,
		});

		const result = await samGovSearch('sam-key', 'automation platform', {});

		expect(result).toEqual({
			query: 'automation platform',
			results: [
				{
					title: 'Automation platform support',
					url: 'https://sam.gov/opp/example/view',
					snippet:
						'Solicitation N8N-001 | General Services Administration | Posted 04/01/2026 | Response deadline 05/01/2026 | Support automation platform implementation.',
				},
			],
		});
	});

	it('builds a fallback notice URL when uiLink is missing', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({
				opportunitiesData: [{ noticeId: 'notice-123', title: 'Automation platform support' }],
			}),
		});

		const result = await samGovSearch('sam-key', 'automation platform', {});

		expect(result.results[0].url).toBe('https://sam.gov/opp/notice-123/view');
	});

	it('throws on non-OK responses', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 429,
			statusText: 'Too Many Requests',
		});

		await expect(samGovSearch('sam-key', 'automation platform', {})).rejects.toThrow(
			'SAM.gov search failed: 429 Too Many Requests',
		);
	});
});
