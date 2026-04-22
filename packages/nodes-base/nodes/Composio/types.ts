import type { IDataObject } from 'n8n-workflow';

export type ComposioApiVersion = 'v3' | 'v3.1';

export type ComposioToolkitField = {
	name: string;
	displayName?: string;
	default?: string | number | boolean | null;
	type?: string;
	description?: string;
	required?: boolean;
	legacy_template_name?: string;
	enum?: Array<string | number>;
};

export type ComposioToolkitAuthMode = {
	mode: string;
	name?: string;
	fields?: {
		auth_config_creation?: {
			required?: ComposioToolkitField[];
			optional?: ComposioToolkitField[];
		};
		connected_account_initiation?: {
			required?: ComposioToolkitField[];
			optional?: ComposioToolkitField[];
		};
	};
	auth_hint_url?: string;
};

export type ComposioToolkit = {
	slug: string;
	name: string;
	auth_schemes?: string[];
	composio_managed_auth_schemes?: string[];
	auth_guide_url?: string;
	auth_config_details?: ComposioToolkitAuthMode[];
	meta?: {
		logo?: string;
		description?: string;
	};
};

export type ComposioListResponse<T> = {
	items: T[];
	next_cursor?: string | null;
	total_pages?: number;
	current_page?: number;
	total_items?: number;
};

export type ComposioAuthConfig = {
	id: string;
	name?: string;
	auth_scheme: string;
	is_composio_managed?: boolean;
	toolkit?: {
		slug: string;
		logo?: string;
		auth_guide_url?: string;
		auth_hint_url?: string;
	};
	expected_input_fields?: IDataObject[];
};

export type ComposioConnectedAccount = {
	id: string;
	status?: string;
	auth_config?: {
		id: string;
		auth_scheme?: string;
	};
	toolkit?: {
		slug: string;
		name?: string;
	};
};

export type ComposioToolSchema = {
	slug: string;
	name: string;
	description?: string;
	toolkit?: {
		slug: string;
		name?: string;
		logo?: string;
	};
	input_parameters?: Record<
		string,
		{
			type?: string;
			description?: string;
			required?: boolean;
			enum?: Array<string | number>;
			examples?: unknown[];
		}
	>;
	version?: string;
	available_versions?: string[];
};
