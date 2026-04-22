import { Service } from '@n8n/di';

import { BadRequestError } from '@/errors/response-errors/bad-request.error';

import type { ChatHubTool } from './chat-hub-tool.entity';
import { getSelectedPersonalAgentId } from './personal-agent-tool.utils';

@Service()
export class ChatHubAgentValidationService {
	validatePersonalAgentToolAssignments(
		agentId: string,
		tools: ChatHubTool[],
	): void {
		for (const tool of tools) {
			const selectedAgentId = getSelectedPersonalAgentId(tool.definition);

			if (selectedAgentId === agentId) {
				throw new BadRequestError(
					'A personal agent cannot be configured to call itself as a tool.',
				);
			}
		}
	}

	validatePersonalAgentToolUpdate(
		selectedAgentId: string | null,
		attachedAgentIds: string[],
	): void {
		if (!selectedAgentId) {
			return;
		}

		if (attachedAgentIds.includes(selectedAgentId)) {
			throw new BadRequestError(
				'A personal agent cannot be configured to call itself as a tool.',
			);
		}
	}
}
