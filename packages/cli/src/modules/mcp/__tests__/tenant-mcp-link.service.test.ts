import {
	ProjectRelationRepository,
	TenantMcpLinkRepository,
	TenantRepository,
	type TenantMcpLink,
	type User,
	UserRepository,
} from '@n8n/db';
import { mock } from 'jest-mock-extended';
import type { InstanceSettings } from 'n8n-core';

import { JwtService } from '@/services/jwt.service';
import { UrlService } from '@/services/url.service';

import { TenantMcpLinkService } from '../tenant-mcp-link.service';

const instanceSettings = mock<InstanceSettings>({ encryptionKey: 'test-key' });
const jwtService = new JwtService(instanceSettings, mock());

describe('TenantMcpLinkService', () => {
	let tenantRepository: jest.Mocked<TenantRepository>;
	let tenantMcpLinkRepository: jest.Mocked<TenantMcpLinkRepository>;
	let projectRelationRepository: jest.Mocked<ProjectRelationRepository>;
	let userRepository: jest.Mocked<UserRepository>;
	let service: TenantMcpLinkService;

	const createTenantToken = (overrides: Record<string, unknown> = {}) =>
		jwtService.sign({
			sub: 'user-123',
			iss: 'n8n',
			aud: 'mcp-server-api',
			jti: 'jti-123',
			meta: {
				isTenantMcp: true,
				tenantId: 'tenant-123',
				projectId: 'project-123',
			},
			...overrides,
		});

	const mockValidLink = () => {
		const user = mock<User>({ id: 'user-123' });
		const activeLink = mock<TenantMcpLink>({
			id: 'link-123',
			tenantId: 'tenant-123',
			projectId: 'project-123',
			jti: 'jti-123',
		});

		tenantMcpLinkRepository.findActiveByJti.mockResolvedValue(activeLink);
		userRepository.findOne.mockResolvedValue(user);
		projectRelationRepository.exists.mockResolvedValue(true);

		return { activeLink, user };
	};

	beforeEach(() => {
		tenantRepository = mock<TenantRepository>();
		tenantMcpLinkRepository = mock<TenantMcpLinkRepository>();
		projectRelationRepository = mock<ProjectRelationRepository>();
		userRepository = mock<UserRepository>();

		service = new TenantMcpLinkService(
			tenantRepository,
			tenantMcpLinkRepository,
			projectRelationRepository,
			userRepository,
			jwtService,
			mock<UrlService>(),
		);
	});

	it('validates tenant token without route tenant and returns tenant context', async () => {
		const { user } = mockValidLink();
		const token = createTenantToken();

		const result = await service.verifyTenantToken(token);

		expect(result).toEqual({
			user,
			tenantMcp: {
				tenantId: 'tenant-123',
				projectId: 'project-123',
				linkId: 'link-123',
			},
		});
		expect(tenantMcpLinkRepository.update).toHaveBeenCalledWith('link-123', {
			lastUsedAt: expect.any(Date),
		});
	});

	it('validates tenant token with matching route tenant', async () => {
		const { user } = mockValidLink();
		const token = createTenantToken();

		const result = await service.verifyTenantToken(token, 'tenant-123');

		expect(result).toEqual({
			user,
			tenantMcp: {
				tenantId: 'tenant-123',
				projectId: 'project-123',
				linkId: 'link-123',
			},
		});
	});

	it('rejects tenant token when route tenant does not match', async () => {
		const token = createTenantToken();

		const result = await service.verifyTenantToken(token, 'other-tenant');

		expect(result).toEqual({
			user: null,
			context: { reason: 'invalid_token', auth_type: 'api_key' },
		});
		expect(tenantMcpLinkRepository.findActiveByJti).not.toHaveBeenCalled();
	});

	it('rejects invalid tenant token metadata', async () => {
		const token = createTenantToken({ meta: { isTenantMcp: false } });

		const result = await service.verifyTenantToken(token);

		expect(result).toEqual({
			user: null,
			context: { reason: 'invalid_token', auth_type: 'api_key' },
		});
	});

	it('rejects token without an active link', async () => {
		const token = createTenantToken();

		tenantMcpLinkRepository.findActiveByJti.mockResolvedValue(null);

		const result = await service.verifyTenantToken(token);

		expect(result).toEqual({
			user: null,
			context: { reason: 'token_not_found_in_db', auth_type: 'api_key' },
		});
	});

	it('rejects token when active link does not match token scope', async () => {
		const token = createTenantToken();
		const activeLink = mock<TenantMcpLink>({
			id: 'link-123',
			tenantId: 'tenant-123',
			projectId: 'other-project',
			jti: 'jti-123',
		});

		tenantMcpLinkRepository.findActiveByJti.mockResolvedValue(activeLink);

		const result = await service.verifyTenantToken(token);

		expect(result).toEqual({
			user: null,
			context: { reason: 'token_not_found_in_db', auth_type: 'api_key' },
		});
	});

	it('rejects token when user no longer exists', async () => {
		const token = createTenantToken();
		const activeLink = mock<TenantMcpLink>({
			id: 'link-123',
			tenantId: 'tenant-123',
			projectId: 'project-123',
			jti: 'jti-123',
		});

		tenantMcpLinkRepository.findActiveByJti.mockResolvedValue(activeLink);
		userRepository.findOne.mockResolvedValue(null);

		const result = await service.verifyTenantToken(token);

		expect(result).toEqual({
			user: null,
			context: { reason: 'user_not_found', auth_type: 'api_key' },
		});
	});

	it('rejects token when user no longer has project access', async () => {
		const token = createTenantToken();
		mockValidLink();
		projectRelationRepository.exists.mockResolvedValue(false);

		const result = await service.verifyTenantToken(token);

		expect(result).toEqual({
			user: null,
			context: { reason: 'user_not_found', auth_type: 'api_key' },
		});
	});
});
