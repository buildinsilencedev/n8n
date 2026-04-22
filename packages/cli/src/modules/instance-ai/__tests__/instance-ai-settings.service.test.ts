import type { InstanceAiConfig } from '@n8n/config';
import type { SettingsRepository, User } from '@n8n/db';
import { mock } from 'jest-mock-extended';

import { UnprocessableRequestError } from '@/errors/response-errors/unprocessable.error';
import type { AiService } from '@/services/ai.service';
import type { CredentialsFinderService } from '@/credentials/credentials-finder.service';
import type { CredentialsService } from '@/credentials/credentials.service';

import { InstanceAiSettingsService } from '../instance-ai-settings.service';

describe('InstanceAiSettingsService', () => {
	const globalConfig = mock<{ instanceAi: InstanceAiConfig }>({
		instanceAi: {
			lastMessages: 10,
			model: 'openai/gpt-4',
			modelUrl: '',
			modelApiKey: '',
			embedderModel: '',
			semanticRecallTopK: 5,
			subAgentMaxSteps: 10,
			swarmEnabled: true,
			swarmMaxWorkers: 10,
			swarmBudgetMode: 'soft_cap',
			swarmMaxEstimatedCostUsd: null,
			swarmMaxPromptTokens: null,
			browserMcp: false,
			mcpServers: '',
			sandboxEnabled: false,
			sandboxProvider: '',
			sandboxImage: '',
			sandboxTimeout: 60,
			localGatewayDisabled: false,
		} as unknown as InstanceAiConfig,
	});
	const settingsRepository = mock<SettingsRepository>();
	const aiService = mock<AiService>();
	const credentialsService = mock<CredentialsService>();
	const credentialsFinderService = mock<CredentialsFinderService>();

	let service: InstanceAiSettingsService;

	beforeEach(() => {
		jest.clearAllMocks();
		service = new InstanceAiSettingsService(
			globalConfig as never,
			settingsRepository,
			aiService,
			credentialsService,
			credentialsFinderService,
		);
	});

	describe('updateAdminSettings', () => {
		it('should reject with 422 when proxy is enabled and request contains proxy-managed admin fields', async () => {
			aiService.isProxyEnabled.mockReturnValue(true);

			await expect(
				service.updateAdminSettings({
					sandboxEnabled: true,
					lastMessages: 50,
				}),
			).rejects.toThrow(UnprocessableRequestError);
		});

		it('should include offending field names in the error message', async () => {
			aiService.isProxyEnabled.mockReturnValue(true);

			await expect(
				service.updateAdminSettings({
					sandboxEnabled: true,
					daytonaCredentialId: 'cred-1',
				}),
			).rejects.toThrow(/sandboxEnabled.*daytonaCredentialId|daytonaCredentialId.*sandboxEnabled/);
		});

		it('should allow non-proxy-managed fields when proxy is enabled', async () => {
			aiService.isProxyEnabled.mockReturnValue(true);
			settingsRepository.upsert.mockResolvedValue(undefined as never);

			await expect(service.updateAdminSettings({ lastMessages: 50 })).resolves.toBeDefined();
		});

		it('should allow proxy-managed fields when proxy is disabled', async () => {
			aiService.isProxyEnabled.mockReturnValue(false);
			settingsRepository.upsert.mockResolvedValue(undefined as never);

			await expect(service.updateAdminSettings({ sandboxEnabled: true })).resolves.toBeDefined();
		});

		it('should persist swarm settings in admin responses', async () => {
			aiService.isProxyEnabled.mockReturnValue(false);
			settingsRepository.upsert.mockResolvedValue(undefined as never);

			const result = await service.updateAdminSettings({
				swarmEnabled: true,
				swarmMaxWorkers: 6,
				swarmBudgetMode: 'soft_cap',
				swarmMaxEstimatedCostUsd: 0.15,
				swarmMaxPromptTokens: 4000,
			});

			expect(result.swarmEnabled).toBe(true);
			expect(result.swarmMaxWorkers).toBe(6);
			expect(result.swarmBudgetMode).toBe('soft_cap');
			expect(result.swarmMaxEstimatedCostUsd).toBe(0.15);
			expect(result.swarmMaxPromptTokens).toBe(4000);
		});
	});

	describe('updateUserPreferences', () => {
		const user = mock<User>({ id: 'user-1' });

		it('should reject with 422 when proxy is enabled and request contains proxy-managed preference fields', async () => {
			aiService.isProxyEnabled.mockReturnValue(true);

			await expect(service.updateUserPreferences(user, { credentialId: 'cred-1' })).rejects.toThrow(
				UnprocessableRequestError,
			);
		});

		it('should include offending field names in the error message', async () => {
			aiService.isProxyEnabled.mockReturnValue(true);

			await expect(
				service.updateUserPreferences(user, {
					credentialId: 'cred-1',
					modelName: 'gpt-4',
				}),
			).rejects.toThrow(/credentialId.*modelName|modelName.*credentialId/);
		});

		it('should allow non-proxy-managed fields when proxy is enabled', async () => {
			aiService.isProxyEnabled.mockReturnValue(true);
			settingsRepository.upsert.mockResolvedValue(undefined as never);

			await expect(
				service.updateUserPreferences(user, { localGatewayDisabled: true }),
			).resolves.toBeDefined();
		});

		it('should persist swarm mode in user preferences', async () => {
			aiService.isProxyEnabled.mockReturnValue(false);
			settingsRepository.upsert.mockResolvedValue(undefined as never);

			const result = await service.updateUserPreferences(user, { swarmMode: 'off' });

			expect(result.swarmMode).toBe('off');
		});
	});

	describe('search credentials', () => {
		const user = mock<User>({ id: 'user-1' });

		it('lists Google Maps and SAM.gov credentials as service credentials', async () => {
			aiService.isProxyEnabled.mockReturnValue(false);
			credentialsFinderService.findCredentialsForUser.mockResolvedValue([
				{ id: 'cred-1', name: 'Maps', type: 'googleMapsApi' },
				{ id: 'cred-2', name: 'SAM', type: 'samGovApi' },
				{ id: 'cred-3', name: 'Ignored', type: 'openAiApi' },
			] as never);

			await expect(service.listServiceCredentials(user)).resolves.toEqual([
				{ id: 'cred-1', name: 'Maps', type: 'googleMapsApi', provider: 'googleMapsApi' },
				{ id: 'cred-2', name: 'SAM', type: 'samGovApi', provider: 'samGovApi' },
			]);
		});

		it('resolves a Google Maps search credential', async () => {
			settingsRepository.upsert.mockResolvedValue(undefined as never);
			aiService.isProxyEnabled.mockReturnValue(false);
			await service.updateAdminSettings({ searchCredentialId: 'cred-1' });
			credentialsFinderService.findCredentialForUser.mockResolvedValue({
				id: 'cred-1',
				name: 'Maps',
				type: 'googleMapsApi',
			} as never);
			credentialsService.decrypt.mockReturnValue({ apiKey: 'maps-key' } as never);

			await expect(service.resolveSearchConfig(user)).resolves.toEqual({
				provider: 'googleMaps',
				apiKey: 'maps-key',
			});
		});

		it('resolves a SAM.gov search credential', async () => {
			settingsRepository.upsert.mockResolvedValue(undefined as never);
			aiService.isProxyEnabled.mockReturnValue(false);
			await service.updateAdminSettings({ searchCredentialId: 'cred-2' });
			credentialsFinderService.findCredentialForUser.mockResolvedValue({
				id: 'cred-2',
				name: 'SAM',
				type: 'samGovApi',
			} as never);
			credentialsService.decrypt.mockReturnValue({ apiKey: 'sam-key' } as never);

			await expect(service.resolveSearchConfig(user)).resolves.toEqual({
				provider: 'samGov',
				apiKey: 'sam-key',
			});
		});
	});
});
