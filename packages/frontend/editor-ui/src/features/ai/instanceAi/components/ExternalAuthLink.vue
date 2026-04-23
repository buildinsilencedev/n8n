<script lang="ts" setup>
import { N8nButton, N8nCard, N8nText } from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import type { ExternalAuthLink } from '@n8n/api-types';
import { computed, ref } from 'vue';

import { useInstanceAiStore } from '../instanceAi.store';
import ConfirmationFooter from './ConfirmationFooter.vue';
import ConfirmationPreview from './ConfirmationPreview.vue';

const props = defineProps<{
	requestId: string;
	authLink: ExternalAuthLink;
	message: string;
}>();

const i18n = useI18n();
const store = useInstanceAiStore();
const isSubmitting = ref(false);

const providerLabel = computed(() => props.authLink.provider ?? props.authLink.host);

async function continueAfterAuth() {
	if (isSubmitting.value) return;
	isSubmitting.value = true;
	const success = await store.confirmAction(props.requestId, true);
	if (success) {
		store.resolveConfirmation(props.requestId, 'approved');
	}
	isSubmitting.value = false;
}

async function cancelAuth() {
	if (isSubmitting.value) return;
	isSubmitting.value = true;
	const success = await store.confirmAction(props.requestId, false);
	if (success) {
		store.resolveConfirmation(props.requestId, 'denied');
	}
	isSubmitting.value = false;
}
</script>

<template>
	<N8nCard :class="$style.root" data-test-id="instance-ai-external-auth-card">
		<div :class="$style.body">
			<N8nText tag="div" size="medium" bold>
				{{
					i18n.baseText('instanceAi.externalAuth.prompt', {
						interpolate: { provider: providerLabel },
					})
				}}
			</N8nText>
			<ConfirmationPreview>{{ props.message }}</ConfirmationPreview>
			<N8nText tag="div" size="small" color="text-light">
				{{
					i18n.baseText('instanceAi.externalAuth.host', {
						interpolate: { host: props.authLink.host },
					})
				}}
			</N8nText>
		</div>

		<ConfirmationFooter>
			<N8nButton
				variant="outline"
				size="medium"
				:disabled="isSubmitting"
				data-test-id="external-auth-cancel"
				@click="cancelAuth"
			>
				{{ i18n.baseText('instanceAi.externalAuth.cancel') }}
			</N8nButton>
			<N8nButton
				variant="outline"
				size="medium"
				:href="props.authLink.url"
				target="_blank"
				rel="noopener noreferrer"
				data-test-id="external-auth-open"
			>
				{{ i18n.baseText('instanceAi.externalAuth.open') }}
			</N8nButton>
			<N8nButton
				variant="solid"
				size="medium"
				:disabled="isSubmitting"
				data-test-id="external-auth-continue"
				@click="continueAfterAuth"
			>
				{{ i18n.baseText('instanceAi.externalAuth.continue') }}
			</N8nButton>
		</ConfirmationFooter>
	</N8nCard>
</template>

<style lang="scss" module>
.root {
	background-color: var(--color--background--light-3);
}

.body {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--2xs);
}
</style>
