import type { INode } from 'n8n-workflow';

export const PERSONAL_AGENT_TOOL_NODE_TYPE = '@n8n/n8n-nodes-langchain.personalAgentTool';

type ResourceLocatorLike =
	| string
	| {
			value?: string;
	  };

function isResourceLocatorLike(value: unknown): value is Exclude<ResourceLocatorLike, string> {
	return typeof value === 'object' && value !== null;
}

export function getSelectedPersonalAgentId(definition: Pick<INode, 'type' | 'parameters'>): string | null {
	if (definition.type !== PERSONAL_AGENT_TOOL_NODE_TYPE) {
		return null;
	}

	const rawValue = definition.parameters?.agentId as ResourceLocatorLike | undefined;

	if (typeof rawValue === 'string') {
		return rawValue || null;
	}

	if (isResourceLocatorLike(rawValue) && typeof rawValue.value === 'string' && rawValue.value) {
		return rawValue.value;
	}

	return null;
}
