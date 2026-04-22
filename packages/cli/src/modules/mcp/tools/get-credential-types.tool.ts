import type { User } from '@n8n/db';
import z from 'zod';

import { USER_CALLED_MCP_TOOL_EVENT } from '../mcp.constants';
import type { ToolDefinition, UserCalledMCPToolEventPayload } from '../mcp.types';
import { createLimitSchema } from './schemas';

import type { LoadNodesAndCredentials } from '@/load-nodes-and-credentials';
import type { Telemetry } from '@/telemetry';

const MAX_RESULTS = 200;

const inputSchema = {
	query: z
		.string()
		.optional()
		.describe('Optional case-insensitive search across credential type name and display name'),
	limit: createLimitSchema(MAX_RESULTS),
} satisfies z.ZodRawShape;

const outputSchema = {
	data: z
		.array(
			z.object({
				name: z.string().describe('Credential type name, for example "googleMapsApi"'),
				displayName: z.string().describe('Human-readable credential type name'),
				extends: z
					.array(z.string())
					.optional()
					.describe('Base credential types this credential extends, if any'),
			}),
		)
		.describe('Installed credential types available on this n8n instance'),
	count: z.number().int().min(0).describe('Total number of matching credential types'),
} satisfies z.ZodRawShape;

export const createGetCredentialTypesTool = (
	user: User,
	loadNodesAndCredentials: LoadNodesAndCredentials,
	telemetry: Telemetry,
): ToolDefinition<typeof inputSchema> => ({
	name: 'get_credential_types',
	config: {
		description:
			'List installed credential types available on this n8n instance. Use this to discover types such as googleMapsApi or samGovApi.',
		inputSchema,
		outputSchema,
		annotations: {
			title: 'Get Credential Types',
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
	},
	handler: async ({
		query,
		limit = MAX_RESULTS,
	}: {
		query?: string;
		limit?: number;
	}) => {
		const telemetryPayload: UserCalledMCPToolEventPayload = {
			user_id: user.id,
			tool_name: 'get_credential_types',
			parameters: { query, limit },
		};

		try {
			const { credentials } = await loadNodesAndCredentials.collectTypes();
			const normalizedQuery = query?.trim().toLowerCase() ?? '';
			const matchingCredentialTypes = credentials
				.filter((credentialType) => {
					if (normalizedQuery.length === 0) {
						return true;
					}

					return (
						credentialType.name.toLowerCase().includes(normalizedQuery) ||
						credentialType.displayName.toLowerCase().includes(normalizedQuery)
					);
				});

			const data = matchingCredentialTypes
				.map((credentialType) => ({
					name: credentialType.name,
					displayName: credentialType.displayName,
					extends: credentialType.extends,
				}))
				.slice(0, Math.min(Math.max(limit, 1), MAX_RESULTS));

			const output = { data, count: matchingCredentialTypes.length };

			telemetryPayload.results = {
				success: true,
				data: { count: output.count },
			};
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			return {
				content: [{ type: 'text', text: JSON.stringify(output) }],
				structuredContent: output,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			telemetryPayload.results = { success: false, error: errorMessage };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			return {
				content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }) }],
				structuredContent: { error: errorMessage },
				isError: true,
			};
		}
	},
});
