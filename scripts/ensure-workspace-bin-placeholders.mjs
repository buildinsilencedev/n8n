#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const packagesRoot = path.join(repoRoot, 'packages');

async function walk(dir) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const results = [];

	for (const entry of entries) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...(await walk(fullPath)));
		} else if (entry.isFile() && entry.name === 'package.json') {
			results.push(fullPath);
		}
	}

	return results;
}

function normalizeBins(binField) {
	if (!binField) return [];
	if (typeof binField === 'string') return [binField];
	return Object.values(binField).filter((value) => typeof value === 'string');
}

function makePlaceholderContents(relativeTarget) {
	return `#!/usr/bin/env node
console.error(${JSON.stringify(
	`Temporary placeholder for ${relativeTarget}. Run the package build before executing this bin.`,
)});
process.exit(1);
`;
}

async function ensurePlaceholder(packageJsonPath) {
	const packageDir = path.dirname(packageJsonPath);
	const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
	const binTargets = normalizeBins(packageJson.bin);
	let created = 0;

	for (const target of binTargets) {
		if (!target.endsWith('.js') && !target.endsWith('.cjs') && !target.endsWith('.mjs')) continue;

		const absoluteTarget = path.join(packageDir, target);
		try {
			await fs.access(absoluteTarget);
			continue;
		} catch {
			// Missing target, create a stub so pnpm can link the workspace bin on Windows.
		}

		await fs.mkdir(path.dirname(absoluteTarget), { recursive: true });
		await fs.writeFile(absoluteTarget, makePlaceholderContents(path.relative(repoRoot, absoluteTarget)));
		created++;
	}

	return created;
}

const packageJsonPaths = await walk(packagesRoot);
let createdCount = 0;

for (const packageJsonPath of packageJsonPaths) {
	createdCount += await ensurePlaceholder(packageJsonPath);
}

if (createdCount > 0) {
	console.log(`Created ${createdCount} temporary workspace bin placeholder(s).`);
} else {
	console.log('No workspace bin placeholders were needed.');
}
