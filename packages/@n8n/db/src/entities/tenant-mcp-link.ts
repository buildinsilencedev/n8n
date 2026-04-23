import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from '@n8n/typeorm';

import { DateTimeColumn, WithTimestampsAndStringId } from './abstract-entity';
import { Project } from './project';
import { Tenant } from './tenant';
import { User } from './user';

@Entity()
export class TenantMcpLink extends WithTimestampsAndStringId {
	@Column({ type: 'varchar', length: 36 })
	tenantId: string;

	@ManyToOne('Tenant', 'mcpLinks', { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'tenantId' })
	tenant: Relation<Tenant>;

	@Column({ type: 'varchar', length: 36 })
	projectId: string;

	@ManyToOne('Project', { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'projectId' })
	project: Relation<Project>;

	@Column({ type: 'varchar', length: 36, nullable: true })
	createdByUserId: string | null;

	@ManyToOne('User', { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'createdByUserId' })
	createdByUser?: Relation<User>;

	@Index({ unique: true })
	@Column({ type: 'varchar', length: 36 })
	jti: string;

	@DateTimeColumn({ nullable: true })
	lastUsedAt: Date | null;

	@DateTimeColumn({ nullable: true })
	revokedAt: Date | null;
}
