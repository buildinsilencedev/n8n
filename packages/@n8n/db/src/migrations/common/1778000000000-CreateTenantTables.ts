import { generateNanoId } from '@n8n/utils';

import type { MigrationContext, ReversibleMigration } from '../migration-types';

type ProjectRow = {
	id: string;
	name: string;
	creatorId: string | null;
};

export class CreateTenantTables1778000000000 implements ReversibleMigration {
	async up({ schemaBuilder: { createTable, column, createIndex }, runQuery }: MigrationContext) {
		await createTable('tenant').withColumns(
			column('id').varchar(36).primary.notNull,
			column('name').varchar(255).notNull,
			column('projectId').varchar(36).notNull,
			column('createdByUserId').varchar(36),
		).withTimestamps;

		await createTable('tenant_mcp_link').withColumns(
			column('id').varchar(36).primary.notNull,
			column('tenantId').varchar(36).notNull,
			column('projectId').varchar(36).notNull,
			column('createdByUserId').varchar(36),
			column('jti').varchar(36).notNull,
			column('lastUsedAt').timestampTimezone(),
			column('revokedAt').timestampTimezone(),
		).withTimestamps;

		await createIndex('tenant', ['projectId'], true);
		await createIndex('tenant_mcp_link', ['tenantId']);
		await createIndex('tenant_mcp_link', ['projectId']);
		await createIndex('tenant_mcp_link', ['jti'], true);

		const projects = await runQuery<ProjectRow[]>(
			'SELECT id, name, "creatorId" as "creatorId" FROM project',
		);

		for (const project of projects) {
			await runQuery(
				'INSERT INTO tenant (id, name, "projectId", "createdByUserId", "createdAt", "updatedAt") VALUES (:id, :name, :projectId, :createdByUserId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
				{
					id: generateNanoId(),
					name: project.name,
					projectId: project.id,
					createdByUserId: project.creatorId,
				},
			);
		}
	}

	async down({ schemaBuilder: { dropTable } }: MigrationContext) {
		await dropTable('tenant_mcp_link');
		await dropTable('tenant');
	}
}
