import { createTool } from '@mastra/core/tools';

import { detectExternalAuthLink, wrapMcpToolsForExternalAuth } from '../external-auth-link';

function getExecute(tools = wrapMcpToolsForExternalAuth({ composio_auth: makeTool() })) {
	const tool = tools.composio_auth;
	if (!tool || !('execute' in tool) || typeof tool.execute !== 'function') {
		throw new Error('wrapped tool has no execute function');
	}
	return tool.execute.bind(tool) as (input: unknown, context: unknown) => Promise<unknown>;
}

function makeTool(result: unknown = successfulAuthLinkResult()) {
	return createTool({
		id: 'composio_auth',
		description: 'Call a Composio MCP tool',
		execute: async () => {
			await Promise.resolve();
			return result;
		},
	});
}

function makeContext(suspend = jest.fn(), resumeData?: { approved: boolean }) {
	return { agent: { suspend, resumeData } };
}

function successfulAuthLinkResult() {
	return {
		content: [{ type: 'text', text: 'Authenticate here' }],
		structuredContent: {
			redirect_url: 'https://connect.composio.dev/link/ln_123',
			toolkit: { slug: 'github' },
			connected_account_id: 'ca_123',
		},
	};
}

describe('detectExternalAuthLink', () => {
	it('detects structured Composio redirect URLs first', () => {
		expect(detectExternalAuthLink(successfulAuthLinkResult())).toEqual({
			authLink: {
				url: 'https://connect.composio.dev/link/ln_123',
				host: 'connect.composio.dev',
				provider: 'github',
				connectedAccountId: 'ca_123',
			},
		});
	});

	it('detects structured auth URLs at the result root', () => {
		expect(
			detectExternalAuthLink({
				redirectUrl: 'https://connect.composio.dev/link/ln_root',
				provider: 'github',
			}),
		).toEqual({
			authLink: {
				url: 'https://connect.composio.dev/link/ln_root',
				host: 'connect.composio.dev',
				provider: 'github',
			},
		});
	});

	it('detects clearly labeled text auth links', () => {
		expect(
			detectExternalAuthLink({
				content: [
					{
						type: 'text',
						text: 'Authentication link: https://connect.composio.dev/link/ln_456',
					},
				],
			}),
		).toEqual({
			authLink: {
				url: 'https://connect.composio.dev/link/ln_456',
				host: 'connect.composio.dev',
			},
		});
	});

	it('rejects non-HTTPS auth URLs', () => {
		expect(
			detectExternalAuthLink({
				structuredContent: { redirect_url: 'http://connect.composio.dev/link/ln_123' },
			}),
		).toEqual({ invalidUrl: 'http://connect.composio.dev/link/ln_123' });
	});
});

describe('wrapMcpToolsForExternalAuth', () => {
	it('suspends when a wrapped MCP tool returns an auth link', async () => {
		const suspend = jest.fn().mockResolvedValue(undefined);
		const execute = getExecute();

		await execute({}, makeContext(suspend));

		expect(suspend).toHaveBeenCalledWith(expect.objectContaining({
			inputType: 'external-auth',
			severity: 'info',
			message: 'Authenticate github to continue.',
			authLink: {
				url: 'https://connect.composio.dev/link/ln_123',
				host: 'connect.composio.dev',
				provider: 'github',
				connectedAccountId: 'ca_123',
			},
		}), undefined);
	});

	it('re-runs the tool when the user continues after authenticating', async () => {
		const result = { content: [{ type: 'text', text: 'success' }] };
		const execute = getExecute(wrapMcpToolsForExternalAuth({ composio_auth: makeTool(result) }));

		await expect(execute({}, makeContext(jest.fn(), { approved: true }))).resolves.toEqual(result);
	});

	it('returns a tool error when the user cancels authentication', async () => {
		const execute = getExecute();

		await expect(execute({}, makeContext(jest.fn(), { approved: false }))).resolves.toEqual({
			content: [{ type: 'text', text: 'Authentication was cancelled by the user' }],
			isError: true,
		});
	});

	it('returns a tool error for invalid auth links instead of suspending', async () => {
		const suspend = jest.fn();
		const execute = getExecute(
			wrapMcpToolsForExternalAuth({
				composio_auth: makeTool({
					content: [{ type: 'text', text: 'Authenticate here' }],
					structuredContent: { auth_url: 'http://connect.composio.dev/link/ln_123' },
				}),
			}),
		);

		await expect(execute({}, makeContext(suspend))).resolves.toEqual({
			content: [{ type: 'text', text: 'Authentication link was not secure or valid' }],
			isError: true,
		});
		expect(suspend).not.toHaveBeenCalled();
	});
});
