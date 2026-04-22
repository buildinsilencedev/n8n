import type { InstanceAiSwarmConfig } from '../types';

export function shouldUseSwarm(
	input: string,
	config: InstanceAiSwarmConfig | undefined,
	options?: { researchMode?: boolean; hasAttachments?: boolean },
): boolean {
	if (!config?.enabled || config.mode !== 'auto' || options?.hasAttachments) {
		return false;
	}

	if (config.maxWorkers < 2) {
		return false;
	}

	if (options?.researchMode) {
		return true;
	}

	const normalized = input.toLowerCase();
	const complexitySignals = [
		'workflow',
		'build',
		'research',
		'compare',
		'analyze',
		'plan',
		'refactor',
		'multi-step',
		'parallel',
		'several',
		'multiple',
		'mcp',
	];
	const matchedSignals = complexitySignals.filter((signal) => normalized.includes(signal)).length;

	return input.length > 280 || matchedSignals >= 2;
}
