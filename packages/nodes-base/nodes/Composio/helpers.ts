import type {
	FieldType,
	IDataObject,
	INodePropertyOptions,
	ILoadOptionsFunctions,
	IExecuteFunctions,
	ResourceMapperField,
} from 'n8n-workflow';
import { NodeOperationError, jsonParse } from 'n8n-workflow';

import type {
	ComposioToolSchema,
	ComposioToolkit,
	ComposioToolkitAuthMode,
	ComposioToolkitField,
} from './types';

type ParameterAccessor = ILoadOptionsFunctions | IExecuteFunctions;

const STRING_TYPES = new Set(['string', 'email', 'url', 'phone', 'password', 'secret']);
const NUMBER_TYPES = new Set(['number', 'integer', 'float']);
const DATE_TYPES = new Set(['date', 'datetime', 'date-time']);

export function getParameterValue<T>(
	context: ParameterAccessor,
	parameterNames: string[],
	options?: { extractValue?: boolean },
): T | undefined {
	for (const parameterName of parameterNames) {
		const value = context.getNodeParameter(parameterName, undefined, undefined, {
			extractValue: options?.extractValue,
		}) as T | undefined;

		if (value !== undefined && value !== null && value !== '') return value;
	}

	return undefined;
}

export function toCommaSeparatedArray(values?: string[]): string | undefined {
	if (!values || values.length === 0) return undefined;

	return values.join(',');
}

export function toBooleanString(value: boolean): 'true' | 'false' {
	return value ? 'true' : 'false';
}

export function mapComposioTypeToFieldType(
	type?: string,
	enumValues?: Array<string | number>,
): FieldType {
	if (enumValues && enumValues.length > 0) return 'options';
	if (!type) return 'string';

	const normalizedType = type.toLowerCase();

	if (STRING_TYPES.has(normalizedType)) return 'string';
	if (NUMBER_TYPES.has(normalizedType)) return 'number';
	if (normalizedType === 'boolean') return 'boolean';
	if (normalizedType === 'array') return 'array';
	if (normalizedType === 'object' || normalizedType === 'json') return 'object';
	if (DATE_TYPES.has(normalizedType)) return 'dateTime';

	return 'string';
}

export function toOptions(enumValues?: Array<string | number>): INodePropertyOptions[] | undefined {
	if (!enumValues || enumValues.length === 0) return undefined;

	return enumValues.map((value) => ({
		name: formatOptionLabel(value),
		value,
	}));
}

function formatOptionLabel(value: string | number): string {
	if (typeof value !== 'string') return String(value);

	return value
		.replace(/[_-]+/g, ' ')
		.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getConnectedAccountInitiationFields(
	toolkit: ComposioToolkit,
	authScheme: string,
): ComposioToolkitField[] {
	const authMode = toolkit.auth_config_details?.find((mode) => {
		return normalizeAuthScheme(mode.mode) === normalizeAuthScheme(authScheme);
	});

	if (!authMode?.fields?.connected_account_initiation) return [];

	return [
		...(authMode.fields.connected_account_initiation.required ?? []),
		...(authMode.fields.connected_account_initiation.optional ?? []),
	];
}

export function getAuthModeDetails(
	toolkit: ComposioToolkit,
	authScheme: string,
): ComposioToolkitAuthMode | undefined {
	return toolkit.auth_config_details?.find((mode) => {
		return normalizeAuthScheme(mode.mode) === normalizeAuthScheme(authScheme);
	});
}

export function normalizeAuthScheme(authScheme: string): string {
	return authScheme.toLowerCase().replace(/[-\s]/g, '_');
}

export function toComposioAuthScheme(authScheme: string): string {
	const normalized = normalizeAuthScheme(authScheme);

	switch (normalized) {
		case 'oauth1':
			return 'OAUTH1';
		case 'oauth2':
			return 'OAUTH2';
		case 'api_key':
		case 'apikey':
			return 'API_KEY';
		case 'basic':
		case 'basic_auth':
			return 'BASIC_AUTH';
		case 'bearer':
		case 'bearer_token':
			return 'BEARER_TOKEN';
		default:
			return authScheme.toUpperCase();
	}
}

export function toResourceMapperField(
	field: ComposioToolkitField,
): ResourceMapperField {
	const fieldType = mapComposioTypeToFieldType(field.type, field.enum);

	return {
		id: field.name,
		displayName: field.displayName ?? field.name,
		required: Boolean(field.required),
		defaultMatch: false,
		canBeUsedToMatch: false,
		display: true,
		type: fieldType,
		options: toOptions(field.enum),
	};
}

export function toolSchemaToResourceMapperFields(tool: ComposioToolSchema): ResourceMapperField[] {
	return Object.entries(tool.input_parameters ?? {})
		.map(([name, schema]) => ({
			id: name,
			displayName: name,
			required: Boolean(schema.required),
			defaultMatch: false,
			canBeUsedToMatch: false,
			display: true,
			type: mapComposioTypeToFieldType(schema.type, schema.enum),
			options: toOptions(schema.enum),
		}))
		.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function omitEmptyValues(data: IDataObject): IDataObject {
	return Object.fromEntries(
		Object.entries(data).filter(([, value]) => {
			if (value === undefined || value === null) return false;
			if (typeof value === 'string') return value !== '';
			if (Array.isArray(value)) return value.length > 0;

			return true;
		}),
	);
}

export function parseJsonObjectParameter(
	context: IExecuteFunctions,
	parameterName: string,
	itemIndex: number,
	errorMessage: string,
): IDataObject {
	const value = context.getNodeParameter(parameterName, itemIndex, {}) as IDataObject | string;

	if (typeof value !== 'string') {
		if (Array.isArray(value) || typeof value !== 'object' || value === null) {
			throw new NodeOperationError(context.getNode(), errorMessage, {
				itemIndex,
			});
		}

		return value;
	}

	let parsedValue: unknown;

	try {
		parsedValue = jsonParse(value);
	} catch (error) {
		throw new NodeOperationError(context.getNode(), errorMessage, {
			itemIndex,
		});
	}

	if (Array.isArray(parsedValue) || typeof parsedValue !== 'object' || parsedValue === null) {
		throw new NodeOperationError(context.getNode(), errorMessage, {
			itemIndex,
		});
	}

	return parsedValue as IDataObject;
}
