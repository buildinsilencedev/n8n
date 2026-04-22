import type { User } from '@n8n/db';
import z from 'zod';

import { USER_CALLED_MCP_TOOL_EVENT } from '../mcp.constants';
import type { ToolDefinition, UserCalledMCPToolEventPayload } from '../mcp.types';
import { createLimitSchema } from './schemas';

import type { CredentialsService } from '@/credentials/credentials.service';
import type { Telemetry } from '@/telemetry';

const MAX_RESULTS = 100;

const projectSummarySchema = z.object({
	id: z.string().describe('The project ID'),
	name: z.string().describe('The project name'),
	type: z.enum(['personal', 'team']).describe("The project type: 'personal' or 'team'"),
});

const inputSchema = {
	query: z
		.string()
		.optional()
		.describe('Filter credentials by credential name, type, or project name (case-insensitive)'),
	type: z
		.string()
		.optional()
		.describe('Optional credential type filter, for example "googleMapsApi" or "samGovApi"'),
	workflowId: z
		.string()
		.optional()
		.describe(
			'Optional workflow ID. When provided, only credentials the current user can use in that workflow are returned.',
		),
	projectId: z
		.string()
		.optional()
		.describe(
			'Optional project ID. When provided, only credentials the current user can use in workflows owned by that project are returned.',
		),
	limit: createLimitSchema(MAX_RESULTS),
} satisfies z.ZodRawShape;

const outputSchema = {
	data: z
		.array(
			z.object({
				id: z.string().describe('The unique identifier of the credential'),
				name: z.string().describe('The credential display name'),
				type: z.string().describe('The credential type name'),
				homeProject: projectSummarySchema
					.nullable()
					.describe('The project that owns this credential, when available'),
				sharedWithProjects: z
					.array(projectSummarySchema)
					.describe('Projects this credential is additionally shared with'),
				isManaged: z.boolean().describe('Whether this credential is managed by n8n'),
				isGlobal: z.boolean().describe('Whether this credential is global'),
				isResolvable: z
					.boolean()
					.describe('Whether this credential can resolve values dynamically at runtime'),
				usableInContext: z
					.boolean()
					.optional()
					.describe(
						'Whether the credential is usable in the requested workflow or project context. Omitted when no context was provided.',
					),
			}),
		)
		.describe('Safe credential metadata. Secret values are never included.'),
	count: z.number().int().min(0).describe('Total number of matching credentials'),
} satisfies z.ZodRawShape;

type ProjectSummary = z.infer<typeof projectSummarySchema>;

type SafeCredentialRecord = {
	id: string;
	name: string;
	type: string;
	homeProject: ProjectSummary | null;
	sharedWithProjects: ProjectSummary[];
	isManaged: boolean;
	isGlobal: boolean;
	isResolvable: boolean;
	usableInContext?: boolean;
};

function toProjectSummary(value: unknown): ProjectSummary | null {
	if (typeof value !== 'object' || value === null) {
		return null;
	}

	const maybeProject = value;
	if (
		!('id' in maybeProject) ||
		typeof maybeProject.id !== 'string' ||
		!('name' in maybeProject) ||
		typeof maybeProject.name !== 'string' ||
		!('type' in maybeProject) ||
		(maybeProject.type !== 'personal' && maybeProject.type !== 'team')
	) {
		return null;
	}

	return {
		id: maybeProject.id,
		name: maybeProject.name,
		type: maybeProject.type,
	};
}

function toSharedProjects(value: unknown): ProjectSummary[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((project) => toProjectSummary(project))
		.filter((project): project is ProjectSummary => project !== null);
}

function matchesCredentialQuery(credential: SafeCredentialRecord, normalizedQuery: string): boolean {
	if (normalizedQuery.length === 0) {
		return true;
	}

	const haystacks = [
		credential.name,
		credential.type,
		credential.homeProject?.name ?? '',
		...credential.sharedWithProjects.map((project) => project.name),
	];

	return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export const createSearchCredentialsTool = (
	user: User,
	credentialsService: CredentialsService,
	telemetry: Telemetry,
): ToolDefinition<typeof inputSchema> => ({
	name: 'search_credentials',
	config: {
		description:
			'Search readable credentials visible to the current user. Returns safe metadata only: IDs, names, types, and project ownership/sharing details.',
		inputSchema,
		outputSchema,
		annotations: {
			title: 'Search Credentials',
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
	},
	handler: async ({
		query,
		type,
		workflowId,
		projectId,
		limit = MAX_RESULTS,
	}: {
		query?: string;
		type?: string;
		workflowId?: string;
		projectId?: string;
		limit?: number;
	}) => {
		const telemetryPayload: UserCalledMCPToolEventPayload = {
			user_id: user.id,
			tool_name: 'search_credentials',
			parameters: { query, type, workflowId, projectId, limit },
		};

		if (workflowId && projectId) {
			const errorMessage = 'Provide either workflowId or projectId, not both.';
			telemetryPayload.results = { success: false, error: errorMessage };
			telemetry.track(USER_CALLED_MCP_TOOL_EVENT, telemetryPayload);

			return {
				content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }) }],
				structuredContent: { error: errorMessage },
				isError: true,
			};
		}

		try {
			const accessibleCredentials = await credentialsService.getMany(user, { includeGlobal: true });
			const usableCredentials =
				workflowId !== undefined
					? await credentialsService.getCredentialsAUserCanUseInAWorkflow(user, { workflowId })
					: projectId !== undefined
						? await credentialsService.getCredentialsAUserCanUseInAWorkflow(user, { projectId })
						: null;

			const usableCredentialIds = usableCredentials ? new Set(usableCredentials.map((cred) => cred.id)) : null;
			const normalizedQuery = query?.trim().toLowerCase() ?? '';
			const normalizedType = type?.trim().toLowerCase();

			const filteredCredentials = accessibleCredentials
				.map(
					(credential): SafeCredentialRecord => ({
						id: credential.id,
						name: credential.name,
						type: credential.type,
						homeProject:
							'homeProject' in credential ? toProjectSummary(credential.homeProject) : null,
						sharedWithProjects:
							'sharedWithProjects' in credential
								? toSharedProjects(credential.sharedWithProjects)
								: [],
						isManaged: credential.isManaged,
						isGlobal: credential.isGlobal,
						isResolvable: credential.isResolvable ?? false,
						...(usableCredentialIds
							? { usableInContext: usableCredentialIds.has(credential.id) }
							: {}),
					}),
				)
				.filter((credential) =>
					normalizedType ? credential.type.toLowerCase() === normalizedType : true,
				)
				.filter((credential) => matchesCredentialQuery(credential, normalizedQuery))
				.filter((credential) =>
					usableCredentialIds ? credential.usableInContext === true : true,
				);

			const data = filteredCredentials.slice(0, Math.min(Math.max(limit, 1), MAX_RESULTS));

			const output = {
				data,
				count: filteredCredentials.length,
			};

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
