import { BadRequestError } from '@/errors/response-errors/bad-request.error';

import { ChatHubAgentValidationService } from '../chat-hub-agent-validation.service';
import type { ChatHubTool } from '../chat-hub-tool.entity';

describe('ChatHubAgentValidationService', () => {
	const service = new ChatHubAgentValidationService();

	it('should reject a personal agent selecting itself as a tool', () => {
		expect(() =>
			service.validatePersonalAgentToolAssignments('agent-1', [
				{
					definition: {
						type: '@n8n/n8n-nodes-langchain.personalAgentTool',
						parameters: {
							agentId: { value: 'agent-1' },
						},
					},
				} as ChatHubTool,
			]),
		).toThrow(BadRequestError);
	});

	it('should reject updating a tool into a self-reference for an attached agent', () => {
		expect(() =>
			service.validatePersonalAgentToolUpdate('agent-1', ['agent-1', 'agent-2']),
		).toThrow(BadRequestError);
	});

	it('should allow different personal-agent targets', () => {
		expect(() =>
			service.validatePersonalAgentToolAssignments('agent-1', [
				{
					definition: {
						type: '@n8n/n8n-nodes-langchain.personalAgentTool',
						parameters: {
							agentId: { value: 'agent-2' },
						},
					},
				} as ChatHubTool,
			]),
		).not.toThrow();
	});
});
