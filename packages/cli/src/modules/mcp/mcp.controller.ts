import { Logger } from '@n8n/backend-common';
import { AuthenticatedRequest } from '@n8n/db';
import { Head, Options, Post, RootLevelController } from '@n8n/decorators';
import { Container } from '@n8n/di';
import type { Request, Response } from 'express';
import { ErrorReporter } from 'n8n-core';

import { Telemetry } from '@/telemetry';

import { McpServerMiddlewareService } from './mcp-server-middleware.service';
import {
	USER_CONNECTED_TO_MCP_EVENT,
	MCP_ACCESS_DISABLED_ERROR_MESSAGE,
	INTERNAL_SERVER_ERROR_MESSAGE,
	UNAUTHORIZED_ERROR_MESSAGE,
} from './mcp.constants';
import { McpService } from './mcp.service';
import { McpRequestLimiterService } from './mcp-request-limiter.service';
import { McpSettingsService } from './mcp.settings.service';
import { isJSONRPCRequest } from './mcp.typeguards';
import type { McpRequestContext, UserConnectedToMCPEventPayload } from './mcp.types';
import { getClientInfo } from './mcp.utils';

export type FlushableResponse = Response & { flush: () => void };

const getAuthMiddleware = () => Container.get(McpServerMiddlewareService).getAuthMiddleware();

@RootLevelController('/mcp-server')
export class McpController {
	constructor(
		private readonly errorReporter: ErrorReporter,
		private readonly mcpService: McpService,
		private readonly mcpRequestLimiterService: McpRequestLimiterService,
		private readonly mcpSettingsService: McpSettingsService,
		private readonly telemetry: Telemetry,
		private readonly logger: Logger,
	) {}

	private setCorsHeaders(req: Request, res: Response) {
		const origin = req.header('origin');
		if (!origin || !this.isAllowedCorsOrigin(origin)) {
			return;
		}

		res.header('Vary', 'Origin');
		res.header('Access-Control-Allow-Origin', origin);
		res.header('Access-Control-Allow-Methods', 'POST, HEAD, OPTIONS');
		res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
		res.header('Access-Control-Max-Age', '86400');
	}

	private isAllowedCorsOrigin(origin: string): boolean {
		try {
			const parsedOrigin = new URL(origin);
			return (
				parsedOrigin.protocol === 'https:' ||
				(parsedOrigin.protocol === 'http:' &&
					['localhost', '127.0.0.1'].includes(parsedOrigin.hostname))
			);
		} catch {
			return false;
		}
	}

	private getRequestMetadata(body: unknown) {
		if (Array.isArray(body)) {
			return { isBatch: true, batchSize: body.length };
		}

		if (isJSONRPCRequest(body)) {
			return {
				isBatch: false,
				method: body.method,
				requestId: body.id ?? null,
			};
		}

		return { isBatch: false, method: undefined, requestId: null };
	}

	@Options('/http', {
		skipAuth: true,
		usesTemplates: true,
		ipRateLimit: { limit: 100 },
	})
	handlePreflight(req: Request, res: Response) {
		this.setCorsHeaders(req, res);
		res.status(204).end();
	}

	@Options('/tenant/:tenantId/http', {
		skipAuth: true,
		usesTemplates: true,
		ipRateLimit: { limit: 100 },
	})
	handleTenantPreflight(req: Request, res: Response) {
		this.setCorsHeaders(req, res);
		res.status(204).end();
	}

	/**
	 * HEAD endpoint for authentication scheme discovery
	 * Per RFC 6750 Section 3, returns 401 with WWW-Authenticate header
	 * This allows MCP clients to probe the endpoint and discover Bearer token authentication
	 */
	@Head('/http', {
		skipAuth: true,
		usesTemplates: true,
	})
	async discoverAuthSchemeHead(req: Request, res: Response) {
		this.setCorsHeaders(req, res);
		res.header('WWW-Authenticate', 'Bearer realm="n8n MCP Server"');
		res.status(401).end();
	}

	@Head('/tenant/:tenantId/http', {
		skipAuth: true,
		usesTemplates: true,
	})
	async discoverTenantAuthSchemeHead(req: Request, res: Response) {
		this.setCorsHeaders(req, res);
		res.header('WWW-Authenticate', 'Bearer realm="n8n MCP Server"');
		res.status(401).end();
	}

	@Post('/http', {
		ipRateLimit: { limit: 100 },
		middlewares: [getAuthMiddleware()],
		skipAuth: true,
		usesTemplates: true,
	})
	async build(req: AuthenticatedRequest, res: FlushableResponse) {
		await this.handleMcpRequest(req, res);
	}

	@Post('/tenant/:tenantId/http', {
		ipRateLimit: { limit: 100 },
		middlewares: [getAuthMiddleware()],
		skipAuth: true,
		usesTemplates: true,
	})
	async buildTenant(req: AuthenticatedRequest, res: FlushableResponse) {
		if (!(req as AuthenticatedRequest & McpRequestContext).tenantMcp) {
			res.status(401).send({ message: UNAUTHORIZED_ERROR_MESSAGE });
			return;
		}
		await this.handleMcpRequest(req, res);
	}

	private async handleMcpRequest(req: AuthenticatedRequest, res: FlushableResponse) {
		this.setCorsHeaders(req, res);

		const body = req.body;
		const requestMetadata = this.getRequestMetadata(body);
		this.logger.debug('MCP request received', {
			userId: req.user.id,
			...requestMetadata,
		});
		const isInitializationRequest = isJSONRPCRequest(body) ? body.method === 'initialize' : false;
		const isToolCallRequest =
			isJSONRPCRequest(body) &&
			typeof body.method === 'string' &&
			['tools/call', 'toolCall'].includes(body.method);
		const clientInfo = getClientInfo(req);

		const telemetryPayload: Partial<UserConnectedToMCPEventPayload> = {
			user_id: req.user.id,
			client_name: clientInfo?.name,
			client_version: clientInfo?.version,
		};

		// Deny if MCP access is disabled
		const enabled = await this.mcpSettingsService.getEnabled();

		if (!enabled) {
			if (isInitializationRequest) {
				this.trackConnectionEvent({
					...telemetryPayload,
					mcp_connection_status: 'error',
					error: MCP_ACCESS_DISABLED_ERROR_MESSAGE,
				});
			}
			// Return 403 Forbidden
			res.status(403).json({ message: MCP_ACCESS_DISABLED_ERROR_MESSAGE });
			return;
		}

		const rateLimitResult = this.mcpRequestLimiterService.acquire(req.user.id, isToolCallRequest);
		if (!rateLimitResult.ok) {
			this.logger.warn('Rejected MCP request because of rate limiting', {
				userId: req.user.id,
				reason: rateLimitResult.reason,
				...requestMetadata,
			});
			res.status(429).json({
				jsonrpc: '2.0',
				error: {
					code: -32001,
					message: rateLimitResult.reason,
				},
				id: isJSONRPCRequest(body) ? body.id ?? null : null,
			});
			return;
		}
		// In stateless mode, create a new instance of transport and server for each request
		// to ensure complete isolation. A single instance would cause request ID collisions
		// when multiple clients connect concurrently.
		try {
			const { StreamableHTTPServerTransport } = await import(
				'@modelcontextprotocol/sdk/server/streamableHttp.js'
			);
			const server = await this.mcpService.getServer(
				req.user,
				(req as AuthenticatedRequest & McpRequestContext).tenantMcp
					? { tenantMcp: (req as AuthenticatedRequest & McpRequestContext).tenantMcp }
					: undefined,
			);
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
			});
			res.on('close', () => {
				void transport.close();
				void server.close();
			});
			await server.connect(transport);
			await transport.handleRequest(req, res, req.body);
			if (isInitializationRequest) {
				this.trackConnectionEvent({
					...telemetryPayload,
					mcp_connection_status: 'success',
				});
			}
		} catch (error) {
			this.errorReporter.error(error);
			if (isInitializationRequest) {
				this.trackConnectionEvent({
					...telemetryPayload,
					mcp_connection_status: 'error',
					error: error instanceof Error ? error.message : String(error),
				});
			}
			// Return JSON-RPC error response
			if (!res.headersSent) {
				res.status(500).json({
					jsonrpc: '2.0',
					error: {
						code: -32603,
						message: INTERNAL_SERVER_ERROR_MESSAGE,
					},
					id: null,
				});
			}
		} finally {
			this.mcpRequestLimiterService.release(req.user.id);
		}
	}

	private trackConnectionEvent(payload: UserConnectedToMCPEventPayload) {
		this.telemetry.track(USER_CONNECTED_TO_MCP_EVENT, payload);
	}
}
