#!/usr/bin/env node
import { constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skills = ['graymatter-onboarding', 'graymatter-memory', 'graymatter-context'];

export const bundleFiles = [
  ['claude-plugin/.claude-plugin/plugin.json', '.claude-plugin/plugin.json'],
  ['claude-plugin/.claude-plugin/marketplace.json', '.claude-plugin/marketplace.json'],
  ['claude-plugin/.mcp.json', '.mcp.json'],
  ['claude-plugin/README.md', 'README.md'],
  ['LICENSE', 'LICENSE'],
  ['claude-plugin/assets/icon.png', 'assets/icon.png'],
  ['assets/composer-icon.svg', 'assets/icon.svg'],
  ...skills.map(name => [`skills/${name}/SKILL.md`, `skills/${name}/SKILL.md`])
];

function contained(root, path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel);
}

function canonicalOutputPath(path) {
  let ancestor = path;
  const missing = [];
  while (true) {
    try {
      return resolve(realpathSync(ancestor), ...missing.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
      missing.push(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
}

export function buildClaudePlugin({ sourceRoot = repositoryRoot, out } = {}) {
  const root = realpathSync(sourceRoot);
  const inputs = bundleFiles.map(([source, destination]) => {
    const input = join(root, source);
    let segment = root;
    for (const name of source.split('/')) {
      segment = join(segment, name);
      if (lstatSync(segment).isSymbolicLink()) throw new Error(`Symlink is not allowed in the bundle: ${source}`);
    }
    if (!contained(root, realpathSync(input)) || !statSync(input).isFile()) {
      throw new Error(`Bundle input must be a regular file inside the source: ${source}`);
    }
    return { input, destination };
  });

  const requestedOutput = out ? resolve(out) : mkdtempSync(join(tmpdir(), 'graymatter-claude-plugin-'));
  try {
    if (lstatSync(requestedOutput).isSymbolicLink()) throw new Error('The bundle output must not be a symlink.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const output = canonicalOutputPath(requestedOutput);
  if (contained(root, output)) throw new Error('Build outside the source checkout to keep release files separate.');
  try {
    if (readdirSync(output).length) throw new Error('The bundle output must be absent or empty; existing files are never overwritten.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  mkdirSync(output, { recursive: true });
  if (realpathSync(output) !== output || contained(root, realpathSync(output))) {
    throw new Error('The bundle output location changed during creation.');
  }
  for (const { input, destination } of inputs) {
    const target = join(output, destination);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(input, target, constants.COPYFILE_EXCL);
  }
  return {
    pluginRoot: output,
    files: inputs.map(({ destination }) => destination),
    bytes: inputs.reduce((sum, { input }) => sum + statSync(input).size, 0)
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out' || !args[1])) {
    process.stderr.write('Usage: node scripts/package-claude-plugin.mjs [--out NEW_EMPTY_DIRECTORY]\n');
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(buildClaudePlugin({ out: args[1] }), null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`Claude plugin packaging failed: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
