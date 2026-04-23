import {
	ProjectRelationRepository,
	Tenant,
	TenantMcpLink,
	TenantMcpLinkRepository,
	TenantRepository,
	User,
	UserRepository,
} from '@n8n/db';
import { Service } from '@n8n/di';
import { EntityManager, IsNull } from '@n8n/typeorm';
import { generateNanoId } from '@n8n/utils';
import { randomUUID } from 'crypto';
import { ApiKeyAudience, ensureError } from 'n8n-workflow';

import type { TenantMcpContext, UserWithContext } from './mcp.types';

import { ForbiddenError } from '@/errors/response-errors/forbidden.error';
import { NotFoundError } from '@/errors/response-errors/not-found.error';
import { JwtService } from '@/services/jwt.service';
import { UrlService } from '@/services/url.service';

const MCP_AUDIENCE: ApiKeyAudience = 'mcp-server-api';
const MCP_ISSUER = 'n8n';

export type TenantMcpLinkMetadata = {
	tenantId: string;
	projectId: string;
	url: string;
	active: boolean;
	createdAt?: Date;
	updatedAt?: Date;
	lastUsedAt?: Date | null;
	revokedAt?: Date | null;
	tokenPreview?: string;
	token?: string;
};

type TenantTokenPayload = {
	sub: string;
	iss: string;
	aud: string;
	jti: string;
	meta?: {
		isTenantMcp?: boolean;
		tenantId?: string;
		projectId?: string;
	};
};

@Service()
export class TenantMcpLinkService {
	constructor(
		private readonly tenantRepository: TenantRepository,
		private readonly tenantMcpLinkRepository: TenantMcpLinkRepository,
		private readonly projectRelationRepository: ProjectRelationRepository,
		private readonly userRepository: UserRepository,
		private readonly jwtService: JwtService,
		private readonly urlService: UrlService,
	) {}

	async ensureTenantForProject(
		projectId: string,
		name: string,
		createdByUserId: string | null,
		trx?: EntityManager,
	) {
		const manager = trx ?? this.tenantRepository.manager;
		const existing = await manager.findOne(Tenant, { where: { projectId } });
		if (existing) return existing;

		const tenant = manager.create(Tenant, {
			id: generateNanoId(),
			name,
			projectId,
			createdByUserId,
		});

		return await manager.save(Tenant, tenant);
	}

	async getLinkMetadata(user: User, tenantId: string): Promise<TenantMcpLinkMetadata> {
		const tenant = await this.getTenantForManager(user, tenantId);
		return await this.getMetadataForTenant(tenant);
	}

	async getLinkMetadataForProject(user: User, projectId: string): Promise<TenantMcpLinkMetadata> {
		const tenant = await this.getTenantForProjectManager(user, projectId);
		return await this.getMetadataForTenant(tenant);
	}

	private async getMetadataForTenant(tenant: Tenant): Promise<TenantMcpLinkMetadata> {
		const activeLink = await this.tenantMcpLinkRepository.findActiveByTenantId(tenant.id);

		return {
			tenantId: tenant.id,
			projectId: tenant.projectId,
			url: this.buildTenantMcpUrl(tenant.id),
			active: activeLink !== null,
			createdAt: activeLink?.createdAt,
			updatedAt: activeLink?.updatedAt,
			lastUsedAt: activeLink?.lastUsedAt,
			revokedAt: activeLink?.revokedAt,
			tokenPreview: activeLink ? `********${activeLink.jti.slice(-4)}` : undefined,
		};
	}

	async rotateLink(user: User, tenantId: string): Promise<TenantMcpLinkMetadata> {
		const tenant = await this.getTenantForManager(user, tenantId);
		return await this.rotateLinkForTenant(user, tenant);
	}

	async rotateLinkForProject(user: User, projectId: string): Promise<TenantMcpLinkMetadata> {
		const tenant = await this.getTenantForProjectManager(user, projectId);
		return await this.rotateLinkForTenant(user, tenant);
	}

	private async rotateLinkForTenant(user: User, tenant: Tenant): Promise<TenantMcpLinkMetadata> {
		const { link, token } = await this.tenantMcpLinkRepository.manager.transaction(async (trx) => {
			await trx.update(
				TenantMcpLink,
				{ tenantId: tenant.id, revokedAt: IsNull() },
				{ revokedAt: new Date() },
			);

			const jti = randomUUID();
			const token = this.jwtService.sign({
				sub: user.id,
				iss: MCP_ISSUER,
				aud: MCP_AUDIENCE,
				jti,
				meta: {
					isTenantMcp: true,
					tenantId: tenant.id,
					projectId: tenant.projectId,
				},
			});

			const link = trx.create(TenantMcpLink, {
				id: generateNanoId(),
				tenantId: tenant.id,
				projectId: tenant.projectId,
				createdByUserId: user.id,
				jti,
				lastUsedAt: null,
				revokedAt: null,
			});

			return { token, link: await trx.save(TenantMcpLink, link) };
		});

		return {
			tenantId: tenant.id,
			projectId: tenant.projectId,
			url: this.buildTenantMcpUrl(tenant.id),
			active: true,
			createdAt: link.createdAt,
			updatedAt: link.updatedAt,
			lastUsedAt: link.lastUsedAt,
			revokedAt: link.revokedAt,
			tokenPreview: `********${link.jti.slice(-4)}`,
			token,
		};
	}

	async verifyTenantToken(token: string, routeTenantId?: string): Promise<UserWithContext> {
		try {
			const decoded = this.jwtService.verify<TenantTokenPayload>(token, {
				issuer: MCP_ISSUER,
				audience: MCP_AUDIENCE,
			});

			if (decoded.meta?.isTenantMcp !== true || !decoded.meta.tenantId || !decoded.meta.projectId) {
				return { user: null, context: { reason: 'invalid_token', auth_type: 'api_key' } };
			}

			if (routeTenantId && routeTenantId !== decoded.meta.tenantId) {
				return { user: null, context: { reason: 'invalid_token', auth_type: 'api_key' } };
			}

			const activeLink = await this.tenantMcpLinkRepository.findActiveByJti(decoded.jti);
			if (
				!activeLink ||
				activeLink.tenantId !== decoded.meta.tenantId ||
				activeLink.projectId !== decoded.meta.projectId
			) {
				return { user: null, context: { reason: 'token_not_found_in_db', auth_type: 'api_key' } };
			}

			const user = await this.userRepository.findOne({
				where: { id: decoded.sub },
				relations: ['role'],
			});
			if (!user) {
				return { user: null, context: { reason: 'user_not_found', auth_type: 'api_key' } };
			}

			const stillHasProjectAccess = await this.projectRelationRepository.exists({
				where: {
					userId: user.id,
					projectId: decoded.meta.projectId,
				},
			});
			if (!stillHasProjectAccess) {
				return { user: null, context: { reason: 'user_not_found', auth_type: 'api_key' } };
			}

			await this.tenantMcpLinkRepository.update(activeLink.id, { lastUsedAt: new Date() });

			const tenantMcp: TenantMcpContext = {
				tenantId: decoded.meta.tenantId,
				projectId: decoded.meta.projectId,
				linkId: activeLink.id,
			};

			return { user, tenantMcp };
		} catch (error) {
			const errorForSure = ensureError(error);
			return {
				user: null,
				context: {
					reason: errorForSure.name === 'JsonWebTokenError' ? 'invalid_token' : 'unknown_error',
					auth_type: 'api_key',
					error_details: errorForSure.message,
				},
			};
		}
	}

	buildTenantMcpUrl(tenantId: string) {
		return `${this.urlService.getInstanceBaseUrl().replace(/\/$/, '')}/mcp-server/tenant/${encodeURIComponent(tenantId)}/http`;
	}

	private async getTenantForManager(user: User, tenantId: string) {
		const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });
		if (!tenant) throw new NotFoundError('Tenant not found');

		await this.ensureUserCanManageTenantProject(user, tenant.projectId);

		return tenant;
	}

	private async getTenantForProjectManager(user: User, projectId: string) {
		const tenant = await this.tenantRepository.findOne({ where: { projectId } });
		if (!tenant) throw new NotFoundError('Tenant not found');

		await this.ensureUserCanManageTenantProject(user, projectId);

		return tenant;
	}

	private async ensureUserCanManageTenantProject(user: User, projectId: string) {
		const relation = await this.projectRelationRepository.findOne({
			where: {
				userId: user.id,
				projectId,
			},
			relations: ['role'],
		});

		if (!relation || !['project:admin', 'project:personalOwner'].includes(relation.role.slug)) {
			throw new ForbiddenError('You do not have permission to manage this tenant MCP link');
		}
	}
}
