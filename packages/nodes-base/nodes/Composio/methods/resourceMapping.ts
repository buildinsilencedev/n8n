import type { ILoadOptionsFunctions, ResourceMapperFields } from 'n8n-workflow';

import {
	getConnectedAccountInitiationFields,
	getParameterValue,
	toResourceMapperField,
	toolSchemaToResourceMapperFields,
} from '../helpers';
import { apiRequest } from '../transport';
import type { ComposioAuthConfig, ComposioToolSchema, ComposioToolkit } from '../types';

export async function getConnectedAccountFields(
	this: ILoadOptionsFunctions,
): Promise<ResourceMapperFields> {
	const toolkitSlug = getParameterValue<string>(this, ['toolkitForConnectedAccountCreate'], {
		extractValue: true,
	});
	const authConfigId = getParameterValue<string>(this, ['authConfigForConnectedAccountCreate'], {
		extractValue: true,
	});

	if (!toolkitSlug || !authConfigId) return { fields: [] };

	const [toolkit, authConfig] = (await Promise.all([
		apiRequest.call(this, 'GET', `/toolkits/${toolkitSlug}`, {}, { version: 'latest' }, 'v3.1'),
		apiRequest.call(this, 'GET', `/auth_configs/${authConfigId}`, {}, {}, 'v3.1'),
	])) as [ComposioToolkit, ComposioAuthConfig];

	const fields = getConnectedAccountInitiationFields(toolkit, authConfig.auth_scheme).map(
		(field) => toResourceMapperField(field),
	);

	return { fields };
}

export async function getToolParameters(
	this: ILoadOptionsFunctions,
): Promise<ResourceMapperFields> {
	const toolSlug = getParameterValue<string>(this, ['toolForExecute'], {
		extractValue: true,
	});

	if (!toolSlug) return { fields: [] };

	const tool = (await apiRequest.call(
		this,
		'GET',
		`/tools/${toolSlug}`,
		{},
		{
			toolkit_versions: 'latest',
		},
		'v3.1',
	)) as ComposioToolSchema;

	return {
		fields: toolSchemaToResourceMapperFields(tool),
	};
}
