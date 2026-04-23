import { Logger } from '@n8n/backend-common';
import { type AuthenticatedRequest } from '@n8n/db';
import { Container } from '@n8n/di';
import type { Request } from 'express';
import { mock, mockDeep } from 'jest-mock-extended';

// eslint-disable-next-line import-x/order
import { McpServerMiddlewareService } from '../mcp-server-middleware.service';

const mockAuthMiddleware = jest.fn().mockImplementation(async (_req, _res, next) => {
	next();
});
const mcpServerMiddlewareService = mockDeep<McpServerMiddlewareService>();
mcpServerMiddlewareService.getAuthMiddleware.mockReturnValue(mockAuthMiddleware);

// We need to mock the service before importing the controller as it's used in the middleware
Container.set(McpServerMiddlewareService, mcpServerMiddlewareService);

import { McpController, type FlushableResponse } from '../mcp.controller';
import { McpRequestLimiterService } from '../mcp-request-limiter.service';
import { McpService } from '../mcp.service';
import { McpSettingsService } from '../mcp.settings.service';
import type { TenantMcpContext } from '../mcp.types';

jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => {
	const StreamableHTTPServerTransport = jest.fn().mockImplementation((_opts) => ({
		handleRequest: jest.fn().mockResolvedValue(undefined),
		close: jest.fn().mockResolvedValue(undefined),
	}));
	return { StreamableHTTPServerTransport };
});

const createReq = (
	overrides: Partial<AuthenticatedRequest & { tenantMcp?: TenantMcpContext }> = {},
): AuthenticatedRequest =>
	({
		user: { id: 'user-1' },
		body: {},
		header: jest.fn().mockReturnValue(undefined),
		...overrides,
	}) as unknown as AuthenticatedRequest;

const createRes = (): FlushableResponse => {
	const res = mock<FlushableResponse>();
	res.status.mockReturnThis();
	res.json.mockReturnThis();
	res.send.mockReturnThis();
	return res;
};

const createMcpServer = () => ({
	connect: jest.fn().mockResolvedValue(undefined),
	close: jest.fn().mockResolvedValue(undefined),
});

describe('McpController', () => {
	let controller: McpController;
	const logger = mock<Logger>();
	const mcpService = { getServer: jest.fn() } as unknown as McpService;
	const mcpRequestLimiterService = { acquire: jest.fn(), release: jest.fn() } as unknown as McpRequestLimiterService;
	const mcpSettingsService = { getEnabled: jest.fn() } as unknown as McpSettingsService;

	beforeEach(() => {
		jest.clearAllMocks();

		Container.set(Logger, logger);
		Container.set(McpService, mcpService);
		Container.set(McpRequestLimiterService, mcpRequestLimiterService);
		Container.set(McpSettingsService, mcpSettingsService);

		controller = Container.get(McpController);
		(mcpRequestLimiterService.acquire as jest.Mock).mockReturnValue({ ok: true });
	});

	test('returns 403 if MCP access is disabled', async () => {
		(mcpSettingsService.getEnabled as jest.Mock).mockResolvedValue(false);
		const res = createRes();
		await controller.build(createReq(), res);
		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ message: 'MCP access is disabled' });
		expect(mcpService.getServer as unknown as jest.Mock).not.toHaveBeenCalled();
	});

	test('creates mcp server if MCP access is enabled', async () => {
		(mcpSettingsService.getEnabled as jest.Mock).mockResolvedValue(true);
		(mcpService.getServer as unknown as jest.Mock).mockReturnValue(createMcpServer());
		const res = createRes();
		await controller.build(createReq(), res);
		expect(mcpService.getServer as unknown as jest.Mock).toHaveBeenCalled();
	});

	test('passes tenant context from base endpoint to MCP server', async () => {
		const tenantMcp: TenantMcpContext = {
			tenantId: 'tenant-123',
			projectId: 'project-123',
			linkId: 'link-123',
		};

		(mcpSettingsService.getEnabled as jest.Mock).mockResolvedValue(true);
		(mcpService.getServer as unknown as jest.Mock).mockReturnValue(createMcpServer());

		const res = createRes();
		await controller.build(createReq({ tenantMcp }), res);

		expect(mcpService.getServer as unknown as jest.Mock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'user-1' }),
			{ tenantMcp },
		);
	});

	test('returns 401 from tenant endpoint if tenant context is missing', async () => {
		(mcpSettingsService.getEnabled as jest.Mock).mockResolvedValue(true);

		const res = createRes();
		await controller.buildTenant(createReq(), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.send).toHaveBeenCalledWith({ message: 'Unauthorized' });
		expect(mcpService.getServer as unknown as jest.Mock).not.toHaveBeenCalled();
	});

	test('passes tenant context from tenant endpoint to MCP server', async () => {
		const tenantMcp: TenantMcpContext = {
			tenantId: 'tenant-123',
			projectId: 'project-123',
			linkId: 'link-123',
		};

		(mcpSettingsService.getEnabled as jest.Mock).mockResolvedValue(true);
		(mcpService.getServer as unknown as jest.Mock).mockReturnValue(createMcpServer());

		const res = createRes();
		await controller.buildTenant(createReq({ tenantMcp }), res);

		expect(mcpService.getServer as unknown as jest.Mock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'user-1' }),
			{ tenantMcp },
		);
	});

	test('HEAD /http returns 401 with WWW-Authenticate header for auth scheme discovery', async () => {
		const req = { header: jest.fn().mockReturnValue(undefined) } as unknown as Request;
		const res = createRes();
		res.header = jest.fn().mockReturnThis();
		res.end = jest.fn().mockReturnThis();

		await controller.discoverAuthSchemeHead(req, res);

		expect(res.header).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer realm="n8n MCP Server"');
		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.end).toHaveBeenCalled();
	});

	test('returns 429 when the MCP rate limiter rejects the request', async () => {
		(mcpSettingsService.getEnabled as jest.Mock).mockResolvedValue(true);
		(mcpRequestLimiterService.acquire as jest.Mock).mockReturnValue({
			ok: false,
			reason: 'MCP request rate limit exceeded for this user',
		});

		const res = createRes();
		await controller.build(
			createReq({
				body: { jsonrpc: '2.0', id: 'req-1', method: 'initialize', params: {} },
			}),
			res,
		);

		expect(res.status).toHaveBeenCalledWith(429);
		expect(res.json).toHaveBeenCalledWith({
			jsonrpc: '2.0',
			error: {
				code: -32001,
				message: 'MCP request rate limit exceeded for this user',
			},
			id: 'req-1',
		});
		expect(mcpService.getServer as unknown as jest.Mock).not.toHaveBeenCalled();
	});
});
