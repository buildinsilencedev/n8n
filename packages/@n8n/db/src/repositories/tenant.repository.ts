import { Service } from '@n8n/di';
import { DataSource, Repository } from '@n8n/typeorm';

import { Tenant } from '../entities';

@Service()
export class TenantRepository extends Repository<Tenant> {
	constructor(dataSource: DataSource) {
		super(Tenant, dataSource.manager);
	}
}
