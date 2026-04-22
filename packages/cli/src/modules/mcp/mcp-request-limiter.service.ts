import { Time } from '@n8n/constants';
import { Service } from '@n8n/di';

interface McpRequestCounter {
	windowStartedAt: number;
	requestCount: number;
	toolCallCount: number;
	inFlight: number;
}

const MCP_REQUEST_WINDOW_MS = Time.minutes.toMilliseconds;
const MAX_REQUESTS_PER_WINDOW = 120;
const MAX_TOOL_CALLS_PER_WINDOW = 60;
const MAX_IN_FLIGHT_REQUESTS_PER_USER = 8;

@Service()
export class McpRequestLimiterService {
	private readonly counters = new Map<string, McpRequestCounter>();

	acquire(userId: string, isToolCall: boolean, now = Date.now()): { ok: true } | { ok: false; reason: string } {
		const counter = this.getCounter(userId, now);

		if (counter.inFlight >= MAX_IN_FLIGHT_REQUESTS_PER_USER) {
			return { ok: false, reason: 'Too many concurrent MCP requests for this user' };
		}

		if (counter.requestCount >= MAX_REQUESTS_PER_WINDOW) {
			return { ok: false, reason: 'MCP request rate limit exceeded for this user' };
		}

		if (isToolCall && counter.toolCallCount >= MAX_TOOL_CALLS_PER_WINDOW) {
			return { ok: false, reason: 'MCP tool call rate limit exceeded for this user' };
		}

		counter.requestCount += 1;
		counter.inFlight += 1;

		if (isToolCall) {
			counter.toolCallCount += 1;
		}

		return { ok: true };
	}

	release(userId: string, now = Date.now()): void {
		const counter = this.counters.get(userId);
		if (!counter) return;

		counter.inFlight = Math.max(0, counter.inFlight - 1);

		if (counter.inFlight === 0 && now - counter.windowStartedAt >= MCP_REQUEST_WINDOW_MS) {
			this.counters.delete(userId);
		}
	}

	private getCounter(userId: string, now: number): McpRequestCounter {
		const existing = this.counters.get(userId);

		if (!existing || now - existing.windowStartedAt >= MCP_REQUEST_WINDOW_MS) {
			const freshCounter: McpRequestCounter = {
				windowStartedAt: now,
				requestCount: 0,
				toolCallCount: 0,
				inFlight: 0,
			};
			this.counters.set(userId, freshCounter);
			return freshCounter;
		}

		return existing;
	}
}
