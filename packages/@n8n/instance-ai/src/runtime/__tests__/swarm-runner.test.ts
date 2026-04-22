import { shouldUseSwarm } from '../swarm-utils';

describe('shouldUseSwarm', () => {
	const config = {
		enabled: true,
		mode: 'auto' as const,
		maxWorkers: 10,
		budgetMode: 'soft_cap' as const,
		maxEstimatedCostUsd: null,
		maxPromptTokens: null,
	};

	it('returns false when swarm mode is disabled', () => {
		expect(
			shouldUseSwarm('Build a workflow for me', {
				...config,
				mode: 'off',
			}),
		).toBe(false);
	});

	it('returns true for research mode requests', () => {
		expect(shouldUseSwarm('Summarize the findings', config, { researchMode: true })).toBe(true);
	});

	it('returns false for short trivial prompts', () => {
		expect(shouldUseSwarm('Hi', config)).toBe(false);
	});

	it('returns true for complex workflow planning prompts', () => {
		expect(
			shouldUseSwarm(
				'Build a workflow, compare approaches, and analyze how the MCP builder should coordinate several steps.',
				config,
			),
		).toBe(true);
	});
});
