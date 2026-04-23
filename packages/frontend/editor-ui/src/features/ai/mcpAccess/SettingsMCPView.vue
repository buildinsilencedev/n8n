<script setup lang="ts">
import { useDocumentTitle } from '@/app/composables/useDocumentTitle';
import { useToast } from '@/app/composables/useToast';
import type { WorkflowListItem } from '@/Interface';
import { useI18n } from '@n8n/i18n';
import { computed, onMounted, ref } from 'vue';
import { useMCPStore } from '@/features/ai/mcpAccess/mcp.store';
import { useUsersStore } from '@/features/settings/users/users.store';
import { useUIStore } from '@/app/stores/ui.store';
import CopyInput from '@/app/components/CopyInput.vue';
import {
	LOADING_INDICATOR_TIMEOUT,
	MCP_CONNECT_WORKFLOWS_MODAL_KEY,
	MCP_DOCS_PAGE_URL,
} from '@/features/ai/mcpAccess/mcp.constants';
import { useProjectsStore } from '@/features/collaboration/projects/projects.store';
import MCPEmptyState from '@/features/ai/mcpAccess/components/MCPEmptyState.vue';
import MCpHeaderActions from '@/features/ai/mcpAccess/components/header/MCPHeaderActions.vue';
import WorkflowsTable from '@/features/ai/mcpAccess/components/tabs/WorkflowsTable.vue';
import OAuthClientsTable from '@/features/ai/mcpAccess/components/tabs/OAuthClientsTable.vue';
import {
	N8nHeading,
	N8nTabs,
	N8nTooltip,
	N8nButton,
	N8nInputLabel,
	N8nText,
	N8nLink,
	N8nNotice,
	N8nPreviewTag,
} from '@n8n/design-system';
import type { TabOptions } from '@n8n/design-system';
import { useMcp } from '@/features/ai/mcpAccess/composables/useMcp';
import type { OAuthClientResponseDto } from '@n8n/api-types';
import { useTelemetry } from '@/app/composables/useTelemetry';
import { WORKFLOW_DESCRIPTION_MODAL_KEY } from '@/app/constants';

type MCPTabs = 'workflows' | 'oauth';

const i18n = useI18n();
const toast = useToast();
const documentTitle = useDocumentTitle();
const mcp = useMcp();
const telemetry = useTelemetry();

const mcpStore = useMCPStore();
const usersStore = useUsersStore();
const uiStore = useUIStore();
const projectsStore = useProjectsStore();

const mcpStatusLoading = ref(false);
const selectedTab = ref<MCPTabs>('workflows');

const tabs = ref<Array<TabOptions<MCPTabs>>>([
	{
		label: i18n.baseText('settings.mcp.tabs.workflows'),
		value: 'workflows',
	},
	{
		label: i18n.baseText('settings.mcp.tabs.oauth'),
		value: 'oauth',
	},
]);

const workflowsLoading = ref(false);
const availableWorkflows = ref<WorkflowListItem[]>([]);

const oAuthClientsLoading = ref(false);
const connectedOAuthClients = ref<OAuthClientResponseDto[]>([]);

const selectedTenantProjectId = ref('');
const tenantLinkLoading = ref(false);
const tenantLinkRotating = ref(false);
const revealedTenantToken = ref<string | null>(null);

const isOwner = computed(() => usersStore.isInstanceOwner);
const isAdmin = computed(() => usersStore.isAdmin);

const canToggleMCP = computed(() => isOwner.value || isAdmin.value);

const showConnectWorkflowsButton = computed(() => {
	return selectedTab.value === 'workflows' && availableWorkflows.value.length > 0;
});

const tenantProjects = computed(() =>
	projectsStore.availableProjects.filter((project) =>
		['project:admin', 'project:personalOwner'].includes(project.role),
	),
);

const selectedTenantProject = computed(() =>
	tenantProjects.value.find((project) => project.id === selectedTenantProjectId.value),
);

const selectedTenantLink = computed(() =>
	selectedTenantProjectId.value ? mcpStore.tenantMcpLinks[selectedTenantProjectId.value] : null,
);

const tenantTokenValue = computed(
	() =>
		revealedTenantToken.value ??
		selectedTenantLink.value?.tokenPreview ??
		i18n.baseText('settings.mcp.tenants.token.empty'),
);

const onTabSelected = async (tab: MCPTabs) => {
	selectedTab.value = tab;
	if (tab === 'workflows' && availableWorkflows.value.length === 0) {
		await fetchAvailableWorkflows();
	} else if (tab === 'oauth' && connectedOAuthClients.value.length === 0) {
		await fetchoAuthCLients();
		telemetry.track('User clicked connected clients tab');
	}
};

const onToggleMCPAccess = async (enabled: boolean) => {
	try {
		mcpStatusLoading.value = true;
		const updated = await mcpStore.setMcpAccessEnabled(enabled);
		if (updated) {
			await fetchTenantLink();
			await fetchAvailableWorkflows();
			await fetchoAuthCLients();
		} else {
			workflowsLoading.value = false;
		}
		mcp.trackUserToggledMcpAccess(enabled);
	} catch (error) {
		toast.showError(error, i18n.baseText('settings.mcp.toggle.error'));
	} finally {
		mcpStatusLoading.value = false;
		workflowsLoading.value = false;
	}
};

const onToggleWorkflowMCPAccess = async (workflowId: string, isEnabled: boolean) => {
	try {
		await mcpStore.toggleWorkflowMcpAccess(workflowId, isEnabled);
		if (isEnabled) {
			await fetchAvailableWorkflows();
		} else {
			availableWorkflows.value = availableWorkflows.value.filter((w) => w.id !== workflowId);
		}
	} catch (error) {
		toast.showError(error, i18n.baseText('workflowSettings.toggleMCP.error.title'));
		throw error;
	}
};

const onUpdateDescription = (workflow: WorkflowListItem) => {
	uiStore.openModalWithData({
		name: WORKFLOW_DESCRIPTION_MODAL_KEY,
		data: {
			workflowId: workflow.id,
			workflowDescription: workflow.description ?? '',
			onSave: (updatedDescription: string | null) => {
				const index = availableWorkflows.value.findIndex((w) => w.id === workflow.id);
				if (index !== -1) {
					availableWorkflows.value[index] = {
						...availableWorkflows.value[index],
						description: updatedDescription ?? undefined,
					};
				}
			},
		},
	});
};

const onTableRefresh = async () => {
	if (selectedTab.value === 'workflows') {
		await fetchAvailableWorkflows();
	} else if (selectedTab.value === 'oauth') {
		await fetchoAuthCLients();
	}
};

const fetchTenantLink = async () => {
	if (!selectedTenantProjectId.value) return;

	try {
		tenantLinkLoading.value = true;
		revealedTenantToken.value = null;
		await mcpStore.getTenantMcpLink(selectedTenantProjectId.value);
	} catch (error) {
		toast.showError(error, i18n.baseText('settings.mcp.tenants.fetch.error'));
	} finally {
		setTimeout(() => {
			tenantLinkLoading.value = false;
		}, LOADING_INDICATOR_TIMEOUT);
	}
};

const onTenantProjectSelected = async (event: Event) => {
	const target = event.target;
	if (!(target instanceof HTMLSelectElement)) return;

	selectedTenantProjectId.value = target.value;
	await fetchTenantLink();
};

const rotateTenantLink = async () => {
	if (!selectedTenantProjectId.value) return;

	try {
		tenantLinkRotating.value = true;
		const link = await mcpStore.generateNewTenantMcpLink(selectedTenantProjectId.value);
		revealedTenantToken.value = link.token ?? null;
		toast.showMessage({
			type: 'success',
			title: i18n.baseText('settings.mcp.tenants.rotate.success.title'),
			message: i18n.baseText('settings.mcp.tenants.rotate.success.message'),
		});
	} catch (error) {
		toast.showError(error, i18n.baseText('settings.mcp.tenants.rotate.error'));
	} finally {
		setTimeout(() => {
			tenantLinkRotating.value = false;
		}, LOADING_INDICATOR_TIMEOUT);
	}
};

const fetchAvailableWorkflows = async () => {
	workflowsLoading.value = true;
	try {
		const workflows = await mcpStore.fetchWorkflowsAvailableForMCP(1, 200);
		availableWorkflows.value = workflows;
	} catch (error) {
		toast.showError(error, i18n.baseText('workflows.list.error.fetching'));
	} finally {
		setTimeout(() => {
			workflowsLoading.value = false;
		}, LOADING_INDICATOR_TIMEOUT);
	}
};

const onRefreshWorkflows = async () => {
	await fetchAvailableWorkflows();
};

const fetchoAuthCLients = async () => {
	try {
		oAuthClientsLoading.value = true;
		const clients = await mcpStore.getAllOAuthClients();
		connectedOAuthClients.value = clients;
	} catch (error) {
		toast.showError(error, i18n.baseText('settings.mcp.error.fetching.oAuthClients'));
	} finally {
		setTimeout(() => {
			oAuthClientsLoading.value = false;
		}, LOADING_INDICATOR_TIMEOUT);
	}
};

const revokeClientAccess = async (client: OAuthClientResponseDto) => {
	try {
		await mcpStore.removeOAuthClient(client.id);
		connectedOAuthClients.value = connectedOAuthClients.value.filter((c) => c.id !== client.id);
		toast.showMessage({
			type: 'success',
			title: i18n.baseText('settings.mcp.oAuthClients.revoke.success.title'),
			message: i18n.baseText('settings.mcp.oAuthClients.revoke.success.message', {
				interpolate: { name: client.name },
			}),
		});
	} catch (error) {
		toast.showError(error, i18n.baseText('settings.mcp.oAuthClients.revoke.error'));
	}
};

const openConnectWorkflowsModal = () => {
	uiStore.openModalWithData({
		name: MCP_CONNECT_WORKFLOWS_MODAL_KEY,
		data: {
			onEnableMcpAccess: async (workflowId: string) => {
				await onToggleWorkflowMCPAccess(workflowId, true);
			},
		},
	});
	telemetry.track('User clicked connect workflows from mcp settings');
};

onMounted(async () => {
	documentTitle.set(i18n.baseText('settings.mcp'));
	await projectsStore.getAvailableProjects();
	selectedTenantProjectId.value = tenantProjects.value[0]?.id ?? '';
	if (!mcpStore.mcpAccessEnabled) {
		return;
	}
	await fetchTenantLink();
	await fetchAvailableWorkflows();
});
</script>
<template>
	<div :class="$style.container">
		<header :class="$style['main-header']" data-test-id="mcp-settings-header">
			<div :class="$style.headings">
				<div :class="$style['heading-row']">
					<N8nHeading size="2xlarge">{{ i18n.baseText('settings.mcp') }}</N8nHeading>
					<N8nTooltip :content="i18n.baseText('settings.mcp.preview.tooltip')">
						<N8nPreviewTag size="medium" />
					</N8nTooltip>
				</div>
				<div v-show="mcpStore.mcpAccessEnabled" data-test-id="mcp-settings-description">
					<N8nText size="small" color="text-light">
						{{ i18n.baseText('settings.mcp.description') }}.
					</N8nText>
					<N8nLink
						:href="MCP_DOCS_PAGE_URL"
						target="_blank"
						rel="noopener noreferrer"
						size="small"
						data-test-id="mcp-docs-link"
					>
						{{ i18n.baseText('generic.learnMore') }}
					</N8nLink>
				</div>
			</div>
			<MCpHeaderActions
				:access-enabled="mcpStore.mcpAccessEnabled"
				:toggle-disabled="!canToggleMCP"
				:loading="mcpStatusLoading"
				@disable-mcp-access="onToggleMCPAccess(!mcpStore.mcpAccessEnabled)"
			/>
		</header>
		<MCPEmptyState
			v-if="!mcpStore.mcpAccessEnabled"
			:disabled="!canToggleMCP"
			:loading="mcpStatusLoading"
			@turn-on-mcp="onToggleMCPAccess(true)"
		/>
		<div
			v-if="mcpStore.mcpAccessEnabled"
			:class="$style.container"
			data-test-id="mcp-enabled-section"
		>
			<section
				v-if="tenantProjects.length > 0"
				:class="$style['tenant-link']"
				data-test-id="mcp-tenant-link-settings"
			>
				<div :class="$style['tenant-header']">
					<div>
						<N8nHeading size="medium">
							{{ i18n.baseText('settings.mcp.tenants.title') }}
						</N8nHeading>
						<N8nText size="small" color="text-light">
							{{ i18n.baseText('settings.mcp.tenants.description') }}
						</N8nText>
					</div>
					<N8nButton
						size="small"
						icon="refresh-cw"
						:label="i18n.baseText('settings.mcp.tenants.rotate')"
						:loading="tenantLinkRotating"
						:disabled="!selectedTenantProjectId || tenantLinkLoading"
						data-test-id="mcp-tenant-link-rotate"
						@click="rotateTenantLink"
					/>
				</div>
				<div :class="$style['tenant-grid']">
					<N8nInputLabel :label="i18n.baseText('settings.mcp.tenants.project')">
						<select
							:class="$style['project-select']"
							:value="selectedTenantProjectId"
							data-test-id="mcp-tenant-project-select"
							@change="onTenantProjectSelected"
						>
							<option v-for="project in tenantProjects" :key="project.id" :value="project.id">
								{{ project.name }}
							</option>
						</select>
					</N8nInputLabel>
					<CopyInput
						:label="i18n.baseText('settings.mcp.tenants.endpoint')"
						:value="selectedTenantLink?.url ?? ''"
						:disable-copy="tenantLinkLoading || !selectedTenantLink?.url"
						:toast-message="selectedTenantProject?.name ?? undefined"
						size="large"
					/>
					<CopyInput
						:label="i18n.baseText('settings.mcp.tenants.token')"
						:value="tenantTokenValue"
						:disable-copy="!revealedTenantToken"
						:redact-value="true"
						size="large"
					/>
				</div>
				<N8nNotice v-if="revealedTenantToken" theme="warning">
					{{ i18n.baseText('settings.mcp.tenants.token.notice') }}
				</N8nNotice>
			</section>
			<header :class="$style['tabs-header']">
				<N8nTabs :model-value="selectedTab" :options="tabs" @update:model-value="onTabSelected" />
				<div :class="$style.actions">
					<N8nButton
						variant="solid"
						v-if="showConnectWorkflowsButton"
						:label="i18n.baseText('settings.mcp.connectWorkflows')"
						data-test-id="mcp-connect-workflows-header-button"
						size="small"
						@click="openConnectWorkflowsModal"
					/>
					<N8nTooltip :content="i18n.baseText('settings.mcp.refresh.tooltip')">
						<N8nButton
							variant="subtle"
							iconOnly
							data-test-id="mcp-workflows-refresh-button"
							size="small"
							icon="refresh-cw"
							@click="onTableRefresh"
						/>
					</N8nTooltip>
				</div>
			</header>
			<main>
				<WorkflowsTable
					v-if="selectedTab === 'workflows'"
					:data-test-id="'mcp-workflow-table'"
					:workflows="availableWorkflows"
					:loading="workflowsLoading"
					@remove-mcp-access="(workflow) => onToggleWorkflowMCPAccess(workflow.id, false)"
					@connect-workflows="openConnectWorkflowsModal"
					@update-description="onUpdateDescription"
					@refresh="onRefreshWorkflows"
				/>
				<OAuthClientsTable
					v-else-if="selectedTab === 'oauth'"
					:data-test-id="'mcp-oauth-clients-table'"
					:clients="connectedOAuthClients"
					:loading="oAuthClientsLoading"
					@revoke-client="revokeClientAccess"
					@refresh="onTableRefresh"
				/>
			</main>
		</div>
	</div>
</template>

<style lang="scss" module>
.container {
	display: flex;
	flex-direction: column;
}

.main-header {
	display: flex;
	justify-content: space-between;
	margin-bottom: var(--spacing--xl);

	@media (max-width: 820px) {
		flex-direction: column;
		align-items: flex-start;
		gap: var(--spacing--2xs);
	}
}

.headings {
	display: flex;
	flex-direction: column;
	min-height: 60px;
}

.heading-row {
	display: flex;
	align-items: center;
	gap: var(--spacing--2xs);
	margin-bottom: var(--spacing--5xs);
}

.tabs-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
}

.tenant-link {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--sm);
	padding-bottom: var(--spacing--xl);
	margin-bottom: var(--spacing--xl);
	border-bottom: var(--border);
}

.tenant-header {
	display: flex;
	justify-content: space-between;
	gap: var(--spacing--md);
	align-items: flex-start;

	@media (max-width: 820px) {
		flex-direction: column;
	}
}

.tenant-grid {
	display: grid;
	grid-template-columns: minmax(180px, 240px) minmax(240px, 1fr) minmax(240px, 1fr);
	gap: var(--spacing--sm);
	align-items: end;

	@media (max-width: 980px) {
		grid-template-columns: 1fr;
	}
}

.project-select {
	width: 100%;
	min-height: 40px;
	padding: 0 var(--spacing--xs);
	color: var(--color--text);
	background: var(--color--background--xlight);
	border: var(--border);
	border-radius: var(--radius);
}

.actions {
	display: flex;
	gap: var(--spacing--2xs);
}
</style>
