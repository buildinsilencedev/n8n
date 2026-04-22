import type { Logger } from '@n8n/backend-common';
import * as fs from 'fs/promises';
import path from 'path';

import type { LoadNodesAndCredentials } from '@/load-nodes-and-credentials';

const NODE_DEFINITION_DIR_CANDIDATES = ['dist/node-definitions', 'node-definitions'];

export async function resolveInstalledNodeDefinitionDirs(
	loadNodesAndCredentials: LoadNodesAndCredentials,
	logger?: Logger,
): Promise<string[]> {
	const dirs: string[] = [];
	const seen = new Set<string>();

	for (const loader of Object.values(loadNodesAndCredentials.loaders ?? {})) {
		const directory = loader.directory;
		if (typeof directory !== 'string' || directory.length === 0) {
			continue;
		}

		for (const relativePath of NODE_DEFINITION_DIR_CANDIDATES) {
			const candidate = path.join(directory, relativePath);
			if (seen.has(candidate)) {
				continue;
			}

			try {
				await fs.access(candidate);
				dirs.push(candidate);
				seen.add(candidate);
				break;
			} catch (error) {
				logger?.debug('Could not resolve node definitions directory', {
					directory,
					candidate,
					error,
				});
			}
		}
	}

	return dirs;
}
