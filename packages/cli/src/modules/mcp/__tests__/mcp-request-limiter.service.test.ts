import { McpRequestLimiterService } from '../mcp-request-limiter.service';

describe('McpRequestLimiterService', () => {
	let service: McpRequestLimiterService;

	beforeEach(() => {
		service = new McpRequestLimiterService();
	});

	it('allows requests within the configured limits', () => {
		expect(service.acquire('user-1', false)).toEqual({ ok: true });
		service.release('user-1');
		expect(service.acquire('user-1', true)).toEqual({ ok: true });
	});

	it('rejects when too many concurrent requests are in flight for one user', () => {
		for (let index = 0; index < 8; index++) {
			expect(service.acquire('user-1', false)).toEqual({ ok: true });
		}

		expect(service.acquire('user-1', false)).toEqual({
			ok: false,
			reason: 'Too many concurrent MCP requests for this user',
		});
	});

	it('rejects excessive tool calls within the rate-limit window', () => {
		for (let index = 0; index < 60; index++) {
			expect(service.acquire('user-1', true, 1_000)).toEqual({ ok: true });
			service.release('user-1', 1_000);
		}

		expect(service.acquire('user-1', true, 1_000)).toEqual({
			ok: false,
			reason: 'MCP tool call rate limit exceeded for this user',
		});
	});
});
