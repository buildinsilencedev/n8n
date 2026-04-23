import { Column, Entity, JoinColumn, ManyToOne, OneToMany, Relation } from '@n8n/typeorm';

import { WithTimestampsAndStringId } from './abstract-entity';
import { Project } from './project';
import type { TenantMcpLink } from './tenant-mcp-link';
import { User } from './user';

@Entity()
export class Tenant extends WithTimestampsAndStringId {
	@Column({ length: 255 })
	name: string;

	@Column({ type: 'varchar', length: 36, unique: true })
	projectId: string;

	@ManyToOne('Project', { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'projectId' })
	project: Relation<Project>;

	@Column({ type: 'varchar', length: 36, nullable: true })
	createdByUserId: string | null;

	@ManyToOne('User', { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'createdByUserId' })
	createdByUser?: Relation<User>;

	@OneToMany('TenantMcpLink', 'tenant')
	mcpLinks: TenantMcpLink[];
}
