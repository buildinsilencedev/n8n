import type { ToolsInput } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import type { ToolAction, ToolExecutionContext } from '@mastra/core/tools';
import type { ExternalAuthLink, McpToolCallResult } from '@n8n/api-types';
import { nanoid } from 'nanoid';
import { z } from 'zod';

const AUTH_URL_FIELDS = new Set([
	'redirect_url',
	'redirectUrl',
	'auth_url',
	'authUrl',
	'authLink',
	'auth_link',
	'connect_url',
	'connectUrl',
]);

const PROVIDER_FIELDS = ['provider', 'appName', 'app_name', 'toolkitSlug', 'toolkit_slug'];
const CONNECTED_ACCOUNT_FIELDS = ['connectedAccountId', 'connected_account_id', 'id'];
const EXPIRES_AT_FIELDS = ['expiresAt', 'expires_at', 'expiration', 'expires'];

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
}

const httpsUrlSchema = z.string().url().refine(isHttpsUrl, {
	message: 'Expected HTTPS URL',
});

const externalAuthSuspendSchema = z.object({
	requestId: z.string(),
	message: z.string(),
	severity: z.literal('info'),
	inputType: z.literal('external-auth'),
	authLink: z.object({
		url: httpsUrlSchema,
		host: z.string(),
		provider: z.string().optional(),
		expiresAt: z.string().optional(),
		connectedAccountId: z.string().optional(),
	}),
});

const externalAuthResumeSchema = z.object({
	approved: z.boolean(),
});

type ExternalAuthResume = z.infer<typeof externalAuthResumeSchema>;
type ExternalAuthSuspend = z.infer<typeof externalAuthSuspendSchema>;
type AuthDetection = { authLink: ExternalAuthLink } | { invalidUrl: string };
type ExecutableTool = ToolAction<
	unknown,
	unknown,
	ExternalAuthSuspend,
	ExternalAuthResume,
	ToolExecutionContext<ExternalAuthSuspend, ExternalAuthResume>
>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, fields: string[]): string | undefined {
	for (const field of fields) {
		const value = record[field];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return undefined;
}

function providerFromRecord(record: Record<string, unknown>): string | undefined {
	const direct = stringField(record, PROVIDER_FIELDS);
	if (direct) return direct;

	const toolkit = record.toolkit;
	if (isRecord(toolkit)) {
		return stringField(toolkit, ['name', 'slug']);
	}

	return undefined;
}

function parseAuthLink(rawUrl: string, record?: Record<string, unknown>): AuthDetection {
	try {
		const url = new URL(rawUrl);
		if (url.protocol !== 'https:') return { invalidUrl: rawUrl };

		const authLink: ExternalAuthLink = {
			url: url.toString(),
			host: url.host,
		};
		if (record) {
			const provider = providerFromRecord(record);
			if (provider) authLink.provider = provider;
			const expiresAt = stringField(record, EXPIRES_AT_FIELDS);
			if (expiresAt) authLink.expiresAt = expiresAt;
			const connectedAccountId = stringField(record, CONNECTED_ACCOUNT_FIELDS);
			if (connectedAccountId) authLink.connectedAccountId = connectedAccountId;
		}

		return {
			authLink,
		};
	} catch {
		return { invalidUrl: rawUrl };
	}
}

function inspectStructuredValue(value: unknown): AuthDetection | null {
	if (Array.isArray(value)) {
		for (const item of value) {
			const result = inspectStructuredValue(item);
			if (result) return result;
		}
		return null;
	}

	if (!isRecord(value)) return null;

	for (const field of AUTH_URL_FIELDS) {
		const candidate = value[field];
		if (typeof candidate === 'string' && candidate.trim()) {
			return parseAuthLink(candidate.trim(), value);
		}
	}

	for (const nested of Object.values(value)) {
		const result = inspectStructuredValue(nested);
		if (result) return result;
	}

	return null;
}

function getTextContent(result: unknown): string {
	if (!isRecord(result) || !Array.isArray(result.content)) return '';

	return result.content
		.map((block) => {
			if (!isRecord(block)) return '';
			return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
		})
		.filter(Boolean)
		.join('\n');
}

function inspectJsonText(text: string): AuthDetection | null {
	try {
		return inspectStructuredValue(JSON.parse(text) as unknown);
	} catch {
		return null;
	}
}

function inspectAuthText(text: string): AuthDetection | null {
	const parsedJson = inspectJsonText(text);
	if (parsedJson) return parsedJson;

	const authLike =
		/(authentication|authenticate|auth|connect|redirect).{0,48}(link|url)/i.test(text) ||
		/(redirect_url|redirectUrl|auth_url|authLink|connect_url)/.test(text);
	if (!authLike) return null;

	const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/);
	if (!urlMatch) return null;

	return parseAuthLink(urlMatch[0].replace(/[),.;\]]+$/, ''));
}

export function detectExternalAuthLink(result: unknown): AuthDetection | null {
	if (!isRecord(result)) return null;

	const structured = inspectStructuredValue(result.structuredContent);
	if (structured) return structured;

	const rootStructured = inspectStructuredValue(result);
	if (rootStructured) return rootStructured;

	const text = getTextContent(result);
	if (!text) return null;

	return inspectAuthText(text);
}

function isExecutableTool(tool: unknown): tool is ExecutableTool {
	return (
		isRecord(tool) &&
		typeof tool.id === 'string' &&
		typeof tool.description === 'string' &&
		typeof tool.execute === 'function'
	);
}

function authErrorResult(message: string): McpToolCallResult {
	return {
		content: [{ type: 'text', text: message }],
		isError: true,
	};
}

function authMessage(authLink: ExternalAuthLink): string {
	const provider = authLink.provider ?? authLink.host;
	return `Authenticate ${provider} to continue.`;
}

function wrapToolForExternalAuth(tool: ExecutableTool): ExecutableTool {
	return createTool({
		id: tool.id,
		description: tool.description,
		inputSchema: tool.inputSchema,
		outputSchema: tool.outputSchema,
		suspendSchema: externalAuthSuspendSchema,
		resumeSchema: externalAuthResumeSchema,
		providerOptions: tool.providerOptions,
		toModelOutput: tool.toModelOutput,
		inputExamples: tool.inputExamples,
		mcp: tool.mcp,
		execute: async (input, context) => {
			const resumeData = context?.agent?.resumeData;

			if (resumeData && !resumeData.approved) {
				return authErrorResult('Authentication was cancelled by the user');
			}

			const result = await tool.execute?.(input, context);
			const detection = detectExternalAuthLink(result);
			if (!detection) return result;

			if ('invalidUrl' in detection) {
				return authErrorResult('Authentication link was not secure or valid');
			}

			const suspend = context?.agent?.suspend;
			if (!suspend) return result;

			await suspend({
				requestId: nanoid(),
				message: authMessage(detection.authLink),
				severity: 'info',
				inputType: 'external-auth',
				authLink: detection.authLink,
			});

			return result;
		},
	}) as ExecutableTool;
}

export function wrapMcpToolsForExternalAuth(tools: ToolsInput): ToolsInput {
	return Object.fromEntries(
		Object.entries(tools).map(([name, tool]) => {
			const candidate: unknown = tool;
			return [name, isExecutableTool(candidate) ? wrapToolForExternalAuth(candidate) : tool];
		}),
	) as ToolsInput;
}
