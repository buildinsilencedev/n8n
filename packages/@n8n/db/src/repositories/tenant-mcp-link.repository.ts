import { Service } from '@n8n/di';
import { DataSource, IsNull, Repository } from '@n8n/typeorm';

import { TenantMcpLink } from '../entities';

@Service()
export class TenantMcpLinkRepository extends Repository<TenantMcpLink> {
	constructor(dataSource: DataSource) {
		super(TenantMcpLink, dataSource.manager);
	}

	async findActiveByTenantId(tenantId: string) {
		return await this.findOne({
			where: {
				tenantId,
				revokedAt: IsNull(),
			},
			order: {
				createdAt: 'DESC',
			},
		});
	}

	async findActiveByJti(jti: string) {
		return await this.findOne({
			where: {
				jti,
				revokedAt: IsNull(),
			},
			relations: ['tenant'],
		});
	}
}
