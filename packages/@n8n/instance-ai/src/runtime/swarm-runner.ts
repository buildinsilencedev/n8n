import { Agent } from '@mastra/core/agent';
import type { ToolsInput } from '@mastra/core/agent';
import { nanoid } from 'nanoid';

import { registerWithMastra } from '../agent/register-with-mastra';
import { createSubAgent } from '../agent/sub-agent-factory';
import { consumeStreamWithHitl } from '../stream/consume-with-hitl';
import type { InstanceAiSwarmConfig, OrchestrationContext } from '../types';
import type { StreamRunResult } from './stream-runner';
import { shouldUseSwarm } from './swarm-utils';

const SWARM_COST_PER_1K_TOKENS_USD = 0.002;
const SWARM_COORDINATOR_MAX_STEPS = 8;
const SWARM_WORKER_MAX_STEPS = 20;
const SWARM_SYNTHESIZER_MAX_STEPS = 12;
const SWARM_BATCH_SIZE = 3;
const MAX_SWARM_WORKERS = 10;

interface SwarmWorkerPlan {
	title: string;
	role: string;
	briefing: string;
}

interface SwarmPlan {
	synthesisGoal: string;
	workers: SwarmWorkerPlan[];
}

interface SwarmSubAgentResult {
	text: string;
	usage: {
		inputTokens: number;
		estimatedCostUsd: number;
	};
}

function estimateTokenCount(value: string): number {
	return Math.max(1, Math.ceil(value.length / 4));
}

function estimateCostUsd(inputTokens: number): number {
	return Number(((inputTokens / 1000) * SWARM_COST_PER_1K_TOKENS_USD).toFixed(6));
}

function roundCost(value: number): number {
	return Number(value.toFixed(6));
}

function selectWorkerCount(input: string, config: InstanceAiSwarmConfig): number {
	const signalCount = [
		'workflow',
		'research',
		'compare',
		'analyze',
		'build',
		'refine',
		'mcp',
	].filter((signal) => input.toLowerCase().includes(signal)).length;

	const lengthScore = Math.min(4, Math.ceil(input.length / 300));
	const requested = Math.max(2, signalCount + lengthScore);
	return Math.min(Math.max(1, config.maxWorkers), MAX_SWARM_WORKERS, requested);
}

function buildFallbackPlan(input: string, workerCount: number): SwarmPlan {
	const workers: SwarmWorkerPlan[] = [];
	for (let index = 0; index < workerCount; index++) {
		const role =
			index === 0
				? 'solution-architect'
				: index === workerCount - 1
					? 'risk-reviewer'
					: `execution-specialist-${index + 1}`;
		const title =
			index === 0
				? 'Architecture pass'
				: index === workerCount - 1
					? 'Risk pass'
					: `Implementation pass ${index + 1}`;
		workers.push({
			title,
			role,
			briefing: [
				`Original task: ${input}`,
				index === 0
					? 'Focus on breaking the task into a practical solution shape, key steps, and likely tool usage.'
					: index === workerCount - 1
						? 'Focus on failure modes, missing steps, validation gaps, and edge cases.'
						: 'Focus on producing a strong concrete solution path from a different angle than the other workers.',
				'Return concise structured findings the synthesizer can merge into one final response.',
			].join('\n\n'),
		});
	}

	return {
		synthesisGoal: 'Merge the worker findings into one clear final answer with the strongest combined plan.',
		workers,
	};
}

function stripMarkdownFences(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed.startsWith('```')) {
		return trimmed;
	}
	return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function parsePlannerResult(raw: string, fallback: SwarmPlan, maxWorkers: number): SwarmPlan {
	try {
		const parsed = JSON.parse(stripMarkdownFences(raw)) as Partial<SwarmPlan>;
		const workers = Array.isArray(parsed.workers)
			? parsed.workers
					.filter(
						(worker): worker is SwarmWorkerPlan =>
							typeof worker?.title === 'string' &&
							typeof worker?.role === 'string' &&
							typeof worker?.briefing === 'string',
					)
					.slice(0, Math.max(1, Math.min(maxWorkers, MAX_SWARM_WORKERS)))
			: [];

		if (workers.length < 2) {
			return fallback;
		}

		return {
			synthesisGoal:
				typeof parsed.synthesisGoal === 'string' && parsed.synthesisGoal.trim().length > 0
					? parsed.synthesisGoal
					: fallback.synthesisGoal,
			workers,
		};
	} catch {
		return fallback;
	}
}

function buildCoordinatorPrompt(input: string, workerCount: number): string {
	return [
		'You are planning a swarm execution for a parent agent.',
		`Create exactly ${workerCount} worker briefs unless the task is obviously smaller, but never return fewer than 2 workers.`,
		'Respond with raw JSON only and no markdown.',
		'Schema:',
		JSON.stringify({
			synthesisGoal: 'string',
			workers: [{ title: 'string', role: 'string', briefing: 'string' }],
		}),
		`Task: ${input}`,
		'Each worker should attack the problem from a complementary angle and avoid duplicating the others.',
	].join('\n\n');
}

function buildSynthesizerPrompt(input: string, synthesisGoal: string, workerOutputs: string[]): string {
	const serializedOutputs = workerOutputs
		.map((output, index) => `Worker ${index + 1}:\n${output}`)
		.join('\n\n');

	return [
		'You are synthesizing a swarm run for a parent agent.',
		`Original task:\n${input}`,
		`Synthesis goal:\n${synthesisGoal}`,
		'Merge the worker outputs into one strong final answer.',
		'Prefer concrete decisions, remove duplication, and keep the response cohesive.',
		serializedOutputs,
	].join('\n\n');
}

function buildWorkerTools(context: OrchestrationContext): ToolsInput {
	const forbiddenToolNames = new Set(['plan', 'create-tasks', 'delegate']);
	return Object.fromEntries(
		Object.entries({
			...context.domainTools,
			...(context.mcpTools ?? {}),
		}).filter(([name]) => !forbiddenToolNames.has(name)),
	);
}

function getBudgetLimit(workerCount: number, config: InstanceAiSwarmConfig): number {
	return Math.min(Math.max(1, config.maxWorkers), MAX_SWARM_WORKERS, workerCount);
}

function shouldStopLaunchingWorkers(
	config: InstanceAiSwarmConfig,
	currentEstimate: { inputTokens: number; estimatedCostUsd: number },
): boolean {
	if (config.maxPromptTokens !== null && currentEstimate.inputTokens > config.maxPromptTokens) {
		return true;
	}

	if (
		config.maxEstimatedCostUsd !== null &&
		currentEstimate.estimatedCostUsd > config.maxEstimatedCostUsd
	) {
		return true;
	}

	return false;
}

async function runSwarmSubAgent(
	context: OrchestrationContext,
	options: {
		parentId: string;
		agentId: string;
		role: string;
		title: string;
		subtitle: string;
		goal: string;
		instructions: string;
		briefing: string;
		tools: ToolsInput;
		maxSteps: number;
		swarm: {
			groupId: string;
			role: 'coordinator' | 'worker' | 'synthesizer';
			workerIndex?: number;
			workerCount?: number;
		};
		kind?: 'delegate' | 'planner';
		publishCompletion?: boolean;
	}): Promise<SwarmSubAgentResult> {
		context.eventBus.publish(context.threadId, {
			type: 'agent-spawned',
			runId: context.runId,
			agentId: options.agentId,
			payload: {
				parentId: options.parentId,
				role: options.role,
				tools: Object.keys(options.tools),
				kind: options.kind,
				title: options.title,
				subtitle: options.subtitle,
				goal: options.goal,
				swarm: options.swarm,
			},
		});

		try {
			const subAgent =
				Object.keys(options.tools).length === 0
					? new Agent({
							id: options.agentId,
							name: options.title,
							instructions: {
								role: 'system' as const,
								content: options.instructions,
								providerOptions: {
									anthropic: { cacheControl: { type: 'ephemeral' } },
								},
							},
							model: context.modelId,
							tools: {},
						})
					: createSubAgent({
							agentId: options.agentId,
							role: options.role,
							instructions: options.instructions,
							tools: options.tools,
							modelId: context.modelId,
						});

			registerWithMastra(options.agentId, subAgent, context.storage);

			const stream = await subAgent.stream(options.briefing, {
				maxSteps: options.maxSteps,
				abortSignal: context.abortSignal,
				providerOptions: {
					anthropic: { cacheControl: { type: 'ephemeral' } },
				},
			});

			const consumed = await consumeStreamWithHitl({
				agent: subAgent,
				stream,
				runId: context.runId,
				agentId: options.agentId,
				eventBus: context.eventBus,
				logger: context.logger,
				threadId: context.threadId,
				abortSignal: context.abortSignal,
				waitForConfirmation: context.waitForConfirmation,
				maxSteps: options.maxSteps,
			});
			const text = await consumed.text;
			const inputTokens = estimateTokenCount(options.briefing);
			const estimatedCostUsd = estimateCostUsd(inputTokens);

			if (options.publishCompletion !== false) {
				context.eventBus.publish(context.threadId, {
					type: 'agent-completed',
					runId: context.runId,
					agentId: options.agentId,
					payload: {
						role: options.role,
						result: text,
						usage: {
							inputTokens,
							totalTokens: inputTokens,
							estimatedCostUsd,
						},
					},
				});
			}

			return {
				text,
				usage: {
					inputTokens,
					estimatedCostUsd,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			context.eventBus.publish(context.threadId, {
				type: 'agent-completed',
				runId: context.runId,
				agentId: options.agentId,
				payload: {
					role: options.role,
					result: '',
					error: message,
				},
			});
			throw error;
		}
	}

export async function runSwarmAgentRun(
	input: string,
	context: OrchestrationContext,
): Promise<StreamRunResult | null> {
	const swarmConfig = context.swarm;
	if (!shouldUseSwarm(input, swarmConfig, { researchMode: context.researchMode })) {
		return null;
	}

	if (!swarmConfig || !context.waitForConfirmation) {
		return null;
	}

	const groupId = `swarm-${nanoid(8)}`;
	const coordinatorId = `agent-swarm-coordinator-${nanoid(6)}`;
	const synthesizerId = `agent-swarm-synthesizer-${nanoid(6)}`;
	const desiredWorkerCount = getBudgetLimit(selectWorkerCount(input, swarmConfig), swarmConfig);
	const fallbackPlan = buildFallbackPlan(input, desiredWorkerCount);

	context.eventBus.publish(context.threadId, {
		type: 'status',
		runId: context.runId,
		agentId: context.orchestratorAgentId,
		payload: { message: `Launching swarm with up to ${desiredWorkerCount} workers...` },
	});

	const coordinator = await runSwarmSubAgent(context, {
		parentId: context.orchestratorAgentId,
		agentId: coordinatorId,
		role: 'swarm-coordinator',
		title: 'Swarm planner',
		subtitle: 'Breaking the task into worker briefs',
		goal: input,
		instructions:
			'Return strict JSON only. Break the task into complementary worker briefs for a swarm execution.',
		briefing: buildCoordinatorPrompt(input, desiredWorkerCount),
		tools: {},
		maxSteps: SWARM_COORDINATOR_MAX_STEPS,
		swarm: {
			groupId,
			role: 'coordinator',
			workerCount: desiredWorkerCount,
		},
		kind: 'planner',
		publishCompletion: false,
	});

	const plan = parsePlannerResult(coordinator.text, fallbackPlan, desiredWorkerCount);
	const workerTools = buildWorkerTools(context);
	const workerPlans = plan.workers.slice(0, desiredWorkerCount);
	const workerResults: Array<{ text: string; usage: SwarmSubAgentResult['usage'] }> = [];
	let aggregateInputTokens = coordinator.usage.inputTokens;
	let aggregateEstimatedCostUsd = coordinator.usage.estimatedCostUsd;

	workerLoop: for (let index = 0; index < workerPlans.length; index += SWARM_BATCH_SIZE) {
		const batch = workerPlans.slice(index, index + SWARM_BATCH_SIZE);
		const batchResults = await Promise.all(
			batch.map(async (worker, batchIndex) => {
				const workerIndex = index + batchIndex + 1;
				const agentId = `agent-swarm-worker-${workerIndex}-${nanoid(4)}`;
				try {
					return await runSwarmSubAgent(context, {
						parentId: coordinatorId,
						agentId,
						role: worker.role,
						title: worker.title,
						subtitle: `Worker ${workerIndex} of ${workerPlans.length}`,
						goal: worker.briefing,
						instructions:
							'Use the provided tools as needed. Work independently and return structured findings the synthesizer can merge.',
						briefing: worker.briefing,
						tools: workerTools,
						maxSteps: Math.min(context.subAgentMaxSteps, SWARM_WORKER_MAX_STEPS),
						swarm: {
							groupId,
							role: 'worker',
							workerIndex,
							workerCount: workerPlans.length,
						},
						kind: 'delegate',
					});
				} catch {
					return null;
				}
			}),
		);

		for (const result of batchResults) {
			if (!result) {
				continue;
			}
			workerResults.push(result);
			aggregateInputTokens += result.usage.inputTokens;
			aggregateEstimatedCostUsd += result.usage.estimatedCostUsd;
		}

		if (
			shouldStopLaunchingWorkers(swarmConfig, {
				inputTokens: aggregateInputTokens,
				estimatedCostUsd: aggregateEstimatedCostUsd,
			})
		) {
			break workerLoop;
		}
	}

	if (workerResults.length === 0) {
		throw new Error('Swarm workers did not produce any successful results');
	}

	const synthesizer = await runSwarmSubAgent(context, {
		parentId: coordinatorId,
		agentId: synthesizerId,
		role: 'swarm-synthesizer',
		title: 'Synthesizing worker results',
		subtitle: `${workerResults.length} worker result${workerResults.length === 1 ? '' : 's'}`,
		goal: plan.synthesisGoal,
		instructions:
			'Combine the worker outputs into one cohesive final answer for the parent agent.',
		briefing: buildSynthesizerPrompt(
			input,
			plan.synthesisGoal,
			workerResults.map((worker) => worker.text),
		),
		tools: {},
		maxSteps: SWARM_SYNTHESIZER_MAX_STEPS,
		swarm: {
			groupId,
			role: 'synthesizer',
			workerCount: workerResults.length,
		},
		kind: 'delegate',
	});

	aggregateInputTokens += synthesizer.usage.inputTokens;
	aggregateEstimatedCostUsd += synthesizer.usage.estimatedCostUsd;

	context.eventBus.publish(context.threadId, {
		type: 'agent-completed',
		runId: context.runId,
		agentId: coordinatorId,
		payload: {
			role: 'swarm-coordinator',
			result: `Completed ${workerResults.length} worker(s) and synthesized the result.`,
			usage: {
				inputTokens: aggregateInputTokens,
				totalTokens: aggregateInputTokens,
				estimatedCostUsd: roundCost(aggregateEstimatedCostUsd),
				completedWorkers: workerResults.length,
			},
		},
	});

	context.eventBus.publish(context.threadId, {
		type: 'status',
		runId: context.runId,
		agentId: context.orchestratorAgentId,
		payload: { message: '' },
	});
	context.eventBus.publish(context.threadId, {
		type: 'text-delta',
		runId: context.runId,
		agentId: context.orchestratorAgentId,
		payload: { text: synthesizer.text },
	});

	return {
		status: 'completed',
		mastraRunId: groupId,
		text: Promise.resolve(synthesizer.text),
	};
}
