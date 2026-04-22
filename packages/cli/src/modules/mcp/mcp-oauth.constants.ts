const LEGACY_TOOL_SCOPES = ['tool:listWorkflows', 'tool:getWorkflowDetails'] as const;

/**
 * `mcp:tools` is the generic scope expected by many MCP OAuth clients for full tool access.
 * We keep the legacy tool-specific scopes for backward compatibility with existing clients.
 */
export const SUPPORTED_SCOPES = ['mcp:tools', ...LEGACY_TOOL_SCOPES];

