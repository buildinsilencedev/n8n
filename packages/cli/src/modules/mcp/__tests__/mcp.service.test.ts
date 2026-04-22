import type { Logger } from '@n8n/backend-common';
import { mockInstance, mockLogger } from '@n8n/backend-test-utils';
import { ExecutionsConfig, GlobalConfig } from '@n8n/config';
import {
	ExecutionRepository,
	FolderRepository,
	ProjectRepository,
	SharedWorkflowRepository,
	User,
} from '@n8n/db';
import { InstanceSettings } from 'n8n-core';
import type { IRun } from 'n8n-workflow';
import { createEmptyRunExecutionData, ManualExecutionCancelledError } from 'n8n-workflow';

import { McpService, createExternalMcpVersion } from '../mcp.service';
import {
	CODE_BUILDER_SEARCH_NODES_TOOL,
	MCP_CREATE_WORKFLOW_FROM_CODE_TOOL,
	MCP_GET_SDK_REFERENCE_TOOL,
} from '../tools/workflow-builder/constants';
import { WorkflowBuilderToolsService } from '../tools/workflow-builder/workflow-builder-tools.service';

import { ActiveExecutions } from '@/active-executions';
<<<<<<< HEAD
import { N8N_VERSION } from '@/constants';
=======
import { CollaborationService } from '@/collaboration/collaboration.service';
>>>>>>> ff9d7d67561b4d668c0eeefbd9e3eb13de1610e5
import { CredentialsService } from '@/credentials/credentials.service';
import { ExecutionService } from '@/executions/execution.service';
import { LoadNodesAndCredentials } from '@/load-nodes-and-credentials';
import { DataTableProxyService } from '@/modules/data-table/data-table-proxy.service';
import { NodeTypes } from '@/node-types';
import { ProjectService } from '@/services/project.service.ee';
import { RoleService } from '@/services/role.service';
import { UrlService } from '@/services/url.service';
import { Telemetry } from '@/telemetry';
import { WorkflowRunner } from '@/workflow-runner';
import { WorkflowCreationService } from '@/workflows/workflow-creation.service';
import { WorkflowFinderService } from '@/workflows/workflow-finder.service';
import { WorkflowService } from '@/workflows/workflow.service';

describe('McpService', () => {
	let activeExecutions: ActiveExecutions;
	let executionsConfig: ExecutionsConfig;
	let instanceSettings: InstanceSettings;
	let logger: Logger;

	const createMcpService = (options?: {
		builderEnabled?: boolean;
		workflowBuilderToolsService?: WorkflowBuilderToolsService;
		executionsMode?: 'regular' | 'queue';
	}) => {
		const executionsConfigOverride = options?.executionsMode
			? mockInstance(ExecutionsConfig, { mode: options.executionsMode })
			: executionsConfig;

		return new McpService(
			logger,
			executionsConfigOverride,
			instanceSettings,
			mockInstance(WorkflowFinderService),
			mockInstance(WorkflowService),
			mockInstance(UrlService),
			mockInstance(CredentialsService),
			mockInstance(LoadNodesAndCredentials),
			activeExecutions,
			mockInstance(GlobalConfig, {
				endpoints: {
					webhook: '/webhook',
					webhookTest: '/webhook-test',
					mcpBuilderEnabled: options?.builderEnabled ?? false,
				},
			}),
			mockInstance(Telemetry),
			mockInstance(WorkflowRunner),
			mockInstance(RoleService),
			mockInstance(ProjectService),
			options?.workflowBuilderToolsService ?? mockInstance(WorkflowBuilderToolsService),
			mockInstance(WorkflowCreationService),
			mockInstance(NodeTypes),
			mockInstance(ProjectRepository),
			mockInstance(FolderRepository),
			mockInstance(SharedWorkflowRepository),
			mockInstance(ExecutionRepository),
			mockInstance(ExecutionService),
			mockInstance(DataTableProxyService),
		);
	};

	beforeEach(() => {
		activeExecutions = mockInstance(ActiveExecutions);
		executionsConfig = mockInstance(ExecutionsConfig, {
			mode: 'regular',
		});
		instanceSettings = mockInstance(InstanceSettings, {
			hostId: 'test-host-id',
		});
		logger = mockLogger();
<<<<<<< HEAD
=======

		mcpService = new McpService(
			logger,
			executionsConfig,
			instanceSettings,
			mockInstance(WorkflowFinderService),
			mockInstance(WorkflowService),
			mockInstance(UrlService),
			mockInstance(CredentialsService),
			activeExecutions,
			mockInstance(GlobalConfig, {
				endpoints: { webhook: '/webhook', webhookTest: '/webhook-test' },
			}),
			mockInstance(Telemetry),
			mockInstance(WorkflowRunner),
			mockInstance(RoleService),
			mockInstance(ProjectService),
			mockInstance(WorkflowBuilderToolsService),
			mockInstance(WorkflowCreationService),
			mockInstance(NodeTypes),
			mockInstance(ProjectRepository),
			mockInstance(FolderRepository),
			mockInstance(SharedWorkflowRepository),
			mockInstance(ExecutionRepository),
			mockInstance(ExecutionService),
			mockInstance(DataTableProxyService),
			mockInstance(CollaborationService),
		);
>>>>>>> ff9d7d67561b4d668c0eeefbd9e3eb13de1610e5
	});

	describe('Queue Mode Detection', () => {
		it('should return false for isQueueMode when mode is regular', () => {
			const mcpService = createMcpService();
			expect(mcpService.isQueueMode).toBe(false);
		});

		it('should return true for isQueueMode when mode is queue', () => {
<<<<<<< HEAD
			const queueMcpService = createMcpService({ executionsMode: 'queue' });
=======
			// Create a new service with queue mode enabled
			const queueExecutionsConfig = mockInstance(ExecutionsConfig, {
				mode: 'queue',
			});

			const queueMcpService = new McpService(
				mockLogger(),
				queueExecutionsConfig,
				instanceSettings,
				mockInstance(WorkflowFinderService),
				mockInstance(WorkflowService),
				mockInstance(UrlService),
				mockInstance(CredentialsService),
				activeExecutions,
				mockInstance(GlobalConfig, {
					endpoints: { webhook: '/webhook', webhookTest: '/webhook-test' },
				}),
				mockInstance(Telemetry),
				mockInstance(WorkflowRunner),
				mockInstance(RoleService),
				mockInstance(ProjectService),
				mockInstance(WorkflowBuilderToolsService),
				mockInstance(WorkflowCreationService),
				mockInstance(NodeTypes),
				mockInstance(ProjectRepository),
				mockInstance(FolderRepository),
				mockInstance(SharedWorkflowRepository),
				mockInstance(ExecutionRepository),
				mockInstance(ExecutionService),
				mockInstance(DataTableProxyService),
				mockInstance(CollaborationService),
			);

>>>>>>> ff9d7d67561b4d668c0eeefbd9e3eb13de1610e5
			expect(queueMcpService.isQueueMode).toBe(true);
		});
	});

	describe('Pending Response Management', () => {
		let mcpService: McpService;

		beforeEach(() => {
			mcpService = createMcpService();
		});

		describe('createPendingResponse', () => {
			it('should create a pending response with a deferred promise', () => {
				const executionId = 'exec-123';
				const deferred = mcpService.createPendingResponse(executionId);

				expect(deferred).toBeDefined();
				expect(deferred.promise).toBeInstanceOf(Promise);
				expect(deferred.resolve).toBeInstanceOf(Function);
				expect(deferred.reject).toBeInstanceOf(Function);
				expect(mcpService.pendingExecutionCount).toBe(1);
			});

			it('should track multiple pending responses', () => {
				mcpService.createPendingResponse('exec-1');
				mcpService.createPendingResponse('exec-2');
				mcpService.createPendingResponse('exec-3');

				expect(mcpService.pendingExecutionCount).toBe(3);
			});
		});

		describe('handleWorkerResponse', () => {
			it('should resolve pending promise with run data', async () => {
				const executionId = 'exec-456';
				const deferred = mcpService.createPendingResponse(executionId);

				const runData: IRun = {
					status: 'success',
					mode: 'trigger',
					startedAt: new Date(),
					finished: true,
					storedAt: 'db',
					data: createEmptyRunExecutionData(),
				};

				mcpService.handleWorkerResponse(executionId, runData);

				const result = await deferred.promise;
				expect(result).toBe(runData);
				expect(mcpService.pendingExecutionCount).toBe(0);
			});

			it('should resolve pending promise with undefined for failed execution', async () => {
				const executionId = 'exec-789';
				const deferred = mcpService.createPendingResponse(executionId);

				mcpService.handleWorkerResponse(executionId, undefined);

				const result = await deferred.promise;
				expect(result).toBeUndefined();
				expect(mcpService.pendingExecutionCount).toBe(0);
			});

			it('should ignore responses for unknown executions and log warning', () => {
				mcpService.handleWorkerResponse('unknown-exec', undefined);
				expect(mcpService.pendingExecutionCount).toBe(0);
				expect(logger.warn).toHaveBeenCalledWith('Received MCP response for unknown execution', {
					executionId: 'unknown-exec',
				});
			});
		});

		describe('removePendingResponse', () => {
			it('should remove a pending response and log debug message', () => {
				const executionId = 'exec-remove';
				mcpService.createPendingResponse(executionId);
				expect(mcpService.pendingExecutionCount).toBe(1);

				mcpService.removePendingResponse(executionId);
				expect(mcpService.pendingExecutionCount).toBe(0);
				expect(logger.debug).toHaveBeenCalledWith('Removed pending MCP response', { executionId });
			});

			it('should handle removing non-existent response gracefully without logging', () => {
				mcpService.removePendingResponse('non-existent');
				expect(mcpService.pendingExecutionCount).toBe(0);
				expect(logger.debug).not.toHaveBeenCalledWith(
					'Removed pending MCP response',
					expect.anything(),
				);
			});
		});

		describe('cancelPendingExecution', () => {
			it('should reject pending promise with cancellation error', async () => {
				const executionId = 'exec-cancel';
				const deferred = mcpService.createPendingResponse(executionId);

				const errorPromise = deferred.promise.catch((error) => error);

				mcpService.cancelPendingExecution(executionId, 'User cancelled');

				const error = await errorPromise;
				expect(error).toBeInstanceOf(ManualExecutionCancelledError);
				expect(mcpService.pendingExecutionCount).toBe(0);
			});

			it('should attempt to stop active execution', async () => {
				const executionId = 'exec-active';
				const deferred = mcpService.createPendingResponse(executionId);
				(activeExecutions.has as jest.Mock).mockReturnValue(true);

				deferred.promise.catch(() => {});

				mcpService.cancelPendingExecution(executionId);

				expect(activeExecutions.stopExecution).toHaveBeenCalledWith(
					executionId,
					expect.any(ManualExecutionCancelledError),
				);
			});

			it('should handle cancelling non-existent execution gracefully', () => {
				mcpService.cancelPendingExecution('non-existent');
			});
		});

		describe('cancelAllPendingExecutions', () => {
			it('should cancel all pending executions', async () => {
				const deferred1 = mcpService.createPendingResponse('exec-1');
				const deferred2 = mcpService.createPendingResponse('exec-2');
				const deferred3 = mcpService.createPendingResponse('exec-3');

				const errorPromise1 = deferred1.promise.catch((error) => error);
				const errorPromise2 = deferred2.promise.catch((error) => error);
				const errorPromise3 = deferred3.promise.catch((error) => error);

				expect(mcpService.pendingExecutionCount).toBe(3);

				mcpService.cancelAllPendingExecutions('Shutdown');

				expect(mcpService.pendingExecutionCount).toBe(0);

				const error1 = await errorPromise1;
				const error2 = await errorPromise2;
				const error3 = await errorPromise3;

				expect(error1).toBeInstanceOf(ManualExecutionCancelledError);
				expect(error2).toBeInstanceOf(ManualExecutionCancelledError);
				expect(error3).toBeInstanceOf(ManualExecutionCancelledError);
			});
		});
	});

	describe('external tool registry', () => {
		const user = Object.assign(new User(), { id: 'user-1' });

		it('includes credential tools when builder mode is disabled', async () => {
			const workflowBuilderToolsService = mockInstance(WorkflowBuilderToolsService);
			const mcpService = createMcpService({
				builderEnabled: false,
				workflowBuilderToolsService,
			});

			await expect(mcpService.getExternalToolNames(user)).resolves.toEqual(
				expect.arrayContaining(['search_credentials', 'get_credential_types']),
			);
			await expect(mcpService.getExternalToolNames(user)).resolves.not.toEqual(
				expect.arrayContaining([
					CODE_BUILDER_SEARCH_NODES_TOOL.toolName,
					MCP_CREATE_WORKFLOW_FROM_CODE_TOOL.toolName,
				]),
			);
			expect(workflowBuilderToolsService.initialize).not.toHaveBeenCalled();
		});

		it('includes builder and credential tools when builder mode is enabled', async () => {
			const workflowBuilderToolsService = mockInstance(WorkflowBuilderToolsService);
			const mcpService = createMcpService({
				builderEnabled: true,
				workflowBuilderToolsService,
			});

			await expect(mcpService.getExternalToolNames(user)).resolves.toEqual(
				expect.arrayContaining([
					'search_credentials',
					'get_credential_types',
					CODE_BUILDER_SEARCH_NODES_TOOL.toolName,
					MCP_CREATE_WORKFLOW_FROM_CODE_TOOL.toolName,
					MCP_GET_SDK_REFERENCE_TOOL.toolName,
				]),
			);
			expect(workflowBuilderToolsService.initialize).toHaveBeenCalled();
		});

		it('creates an MCP server with registered tools', async () => {
			const mcpService = createMcpService();
			const server = await mcpService.getServer(user);

			expect(server).toBeDefined();
			expect(typeof server.connect).toBe('function');
			expect(typeof server.close).toBe('function');
			expect(typeof server.registerTool).toBe('function');
		});
	});

	describe('versioning', () => {
		const user = Object.assign(new User(), { id: 'user-1' });

<<<<<<< HEAD
		it('creates the same version for the same tool set regardless of order', () => {
			expect(createExternalMcpVersion('2.16.0', ['b', 'a'])).toBe(
				createExternalMcpVersion('2.16.0', ['a', 'b']),
=======
			const service = new McpService(
				mockLogger(),
				executionsConfig,
				instanceSettings,
				mockInstance(WorkflowFinderService),
				mockInstance(WorkflowService),
				mockInstance(UrlService),
				mockInstance(CredentialsService),
				activeExecutions,
				mockInstance(GlobalConfig, {
					endpoints: {
						webhook: '/webhook',
						webhookTest: '/webhook-test',
						mcpBuilderEnabled: false,
					},
				}),
				mockInstance(Telemetry),
				mockInstance(WorkflowRunner),
				mockInstance(RoleService),
				mockInstance(ProjectService),
				workflowBuilderToolsService,
				mockInstance(WorkflowCreationService),
				mockInstance(NodeTypes),
				mockInstance(ProjectRepository),
				mockInstance(FolderRepository),
				mockInstance(SharedWorkflowRepository),
				mockInstance(ExecutionRepository),
				mockInstance(ExecutionService),
				mockInstance(DataTableProxyService),
				mockInstance(CollaborationService),
>>>>>>> ff9d7d67561b4d668c0eeefbd9e3eb13de1610e5
			);
		});

<<<<<<< HEAD
		it('creates different versions when the tool set changes', () => {
			expect(createExternalMcpVersion('2.16.0', ['a', 'b'])).not.toBe(
				createExternalMcpVersion('2.16.0', ['a', 'b', 'c']),
=======
		it('should register builder tools when mcpBuilderEnabled is true', async () => {
			const user = Object.assign(new User(), { id: 'user-1' });
			const workflowBuilderToolsService = mockInstance(WorkflowBuilderToolsService);

			const service = new McpService(
				mockLogger(),
				executionsConfig,
				instanceSettings,
				mockInstance(WorkflowFinderService),
				mockInstance(WorkflowService),
				mockInstance(UrlService),
				mockInstance(CredentialsService),
				activeExecutions,
				mockInstance(GlobalConfig, {
					endpoints: {
						webhook: '/webhook',
						webhookTest: '/webhook-test',
						mcpBuilderEnabled: true,
					},
				}),
				mockInstance(Telemetry),
				mockInstance(WorkflowRunner),
				mockInstance(RoleService),
				mockInstance(ProjectService),
				workflowBuilderToolsService,
				mockInstance(WorkflowCreationService),
				mockInstance(NodeTypes),
				mockInstance(ProjectRepository),
				mockInstance(FolderRepository),
				mockInstance(SharedWorkflowRepository),
				mockInstance(ExecutionRepository),
				mockInstance(ExecutionService),
				mockInstance(DataTableProxyService),
				mockInstance(CollaborationService),
>>>>>>> ff9d7d67561b4d668c0eeefbd9e3eb13de1610e5
			);
		});

		it('changes the advertised version when builder mode changes', async () => {
			const disabledService = createMcpService({ builderEnabled: false });
			const enabledService = createMcpService({ builderEnabled: true });

			const disabledVersion = await disabledService.getAdvertisedMcpVersion(user);
			const enabledVersion = await enabledService.getAdvertisedMcpVersion(user);

			expect(disabledVersion).toMatch(new RegExp(`^${N8N_VERSION.replace('.', '\\.')}`));
			expect(enabledVersion).toMatch(new RegExp(`^${N8N_VERSION.replace('.', '\\.')}`));
			expect(disabledVersion).not.toBe(enabledVersion);
		});
	});
});
