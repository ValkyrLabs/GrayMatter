#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readStoredToken } from './gm-auth.mjs';
import { authState } from './gm-mcp-launcher.mjs';

const thor_scriptDir = dirname(fileURLToPath(import.meta.url));
const thor_root = resolve(thor_scriptDir, '..');
const thor_apiBase = (process.env.VALKYR_API_BASE || 'https://api-0.valkyrlabs.com/v1').replace(/\/$/u, '');

function thor_stage(thor_message) {
  process.stdout.write(`${thor_message}\n`);
}

function thor_run(thor_command, thor_args, thor_options = {}) {
  return spawnSync(thor_command, thor_args, {
    cwd: thor_root,
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(thor_command),
    timeout: 120000,
    ...thor_options
  });
}

function thor_commandOnPath(thor_name) {
  const thor_extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const thor_directory of (process.env.PATH || '').split(delimiter)) {
    for (const thor_extension of thor_extensions) {
      const thor_candidate = join(thor_directory, process.platform === 'win32' ? `${thor_name}${thor_extension}` : thor_name);
      if (existsSync(thor_candidate)) return thor_candidate;
    }
  }
  return '';
}

function thor_findCodex() {
  const thor_candidates = [
    process.env.CODEX_CLI,
    process.env.CODEX_CLI_FALLBACK,
    thor_commandOnPath('codex'),
    process.platform === 'darwin' ? '/Applications/ChatGPT.app/Contents/Resources/codex' : '',
    process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'ChatGPT', 'resources', 'codex.exe') : '',
    process.platform === 'win32' && process.env.ProgramFiles ? join(process.env.ProgramFiles, 'ChatGPT', 'resources', 'codex.exe') : ''
  ].filter(Boolean);
  return thor_candidates.find((thor_candidate) => {
    if (!existsSync(thor_candidate)) return false;
    const thor_probe = thor_run(thor_candidate, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    return thor_probe.status === 0;
  }) || '';
}

function thor_normalizePath(thor_path) {
  try {
    const thor_real = realpathSync.native(thor_path);
    return process.platform === 'win32' ? thor_real.toLowerCase() : thor_real;
  } catch {
    return process.platform === 'win32' ? resolve(thor_path).toLowerCase() : resolve(thor_path);
  }
}

function thor_codex(thor_cli, thor_args, thor_label) {
  const thor_result = thor_run(thor_cli, thor_args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (thor_result.status !== 0) {
    const thor_detail = (thor_result.stderr || thor_result.stdout || '').trim();
    throw new Error(`${thor_label} failed.${thor_detail ? ` ${thor_detail}` : ''}`);
  }
  return (thor_result.stdout || '').trim();
}

function thor_installCodexPlugin(thor_cli) {
  const thor_marketplacePath = join(thor_root, '.agents', 'plugins', 'marketplace.json');
  if (!existsSync(thor_marketplacePath)) return false;
  const thor_marketplace = JSON.parse(readFileSync(thor_marketplacePath, 'utf8'));
  const thor_marketplaceName = thor_marketplace.name;
  let thor_marketplaces = [];
  try {
    const thor_listing = JSON.parse(thor_codex(thor_cli, ['plugin', 'marketplace', 'list', '--json'], 'Checking Codex marketplaces'));
    thor_marketplaces = thor_listing.marketplaces || [];
  } catch {
    // Older Codex builds can still install after adding the marketplace directly.
  }
  const thor_named = thor_marketplaces.find((thor_item) => thor_item.name === thor_marketplaceName);
  const thor_matchingRoot = thor_marketplaces.find((thor_item) => thor_normalizePath(thor_item.root) === thor_normalizePath(thor_root));
  if (!thor_matchingRoot && !thor_named) {
    thor_codex(thor_cli, ['plugin', 'marketplace', 'add', thor_root, '--json'], 'Adding the GrayMatter marketplace');
  } else if (thor_named && thor_normalizePath(thor_named.root) !== thor_normalizePath(thor_root)) {
    if (thor_named.marketplaceSource?.sourceType === 'git') {
      thor_codex(thor_cli, ['plugin', 'marketplace', 'upgrade', thor_marketplaceName, '--json'], 'Updating the GrayMatter marketplace');
    } else {
      throw new Error(`Codex already has a different local marketplace named ${thor_marketplaceName}. Remove that stale binding, then rerun this installer.`);
    }
  }
  thor_codex(thor_cli, ['plugin', 'add', `graymatter@${thor_marketplaceName}`, '--json'], 'Installing the GrayMatter plugin');
  return true;
}

async function main() {
  const thor_major = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(thor_major) || thor_major < 20) throw new Error('GrayMatter requires Node.js 20 or newer. Download it from https://nodejs.org/ and rerun this installer.');

  thor_stage('downloading plugin');
  if (process.env.GRAYMATTER_INSTALL_SKIP_CODEX !== '1') {
    const thor_codexCli = thor_findCodex();
    if (thor_codexCli) thor_installCodexPlugin(thor_codexCli);
    else if (process.env.GRAYMATTER_REQUIRE_CODEX === '1') throw new Error('Codex was not found. Install the Codex app, then rerun this installer.');
  }

  thor_stage('performing signup/login');
  if (process.env.GRAYMATTER_INSTALL_SKIP_AUTH !== '1') {
    let thor_token = readStoredToken();
    let thor_state = await authState(thor_token, thor_apiBase);
    if (thor_state === 'missing' || thor_state === 'invalid') {
      const thor_auth = thor_run(process.execPath, [join(thor_scriptDir, 'gm-auth.mjs'), 'keychain'], { stdio: 'inherit' });
      if (thor_auth.status !== 0) throw new Error('GrayMatter sign-in did not complete.');
      thor_token = readStoredToken();
      thor_state = await authState(thor_token, thor_apiBase);
    }
    thor_stage('authenticating');
    if (thor_state === 'missing' || thor_state === 'invalid') throw new Error('GrayMatter could not verify the saved session.');
  } else {
    thor_stage('authenticating');
  }

  for (const thor_file of [join(thor_scriptDir, 'gm-auth.mjs'), join(thor_scriptDir, 'gm-mcp-launcher.mjs'), join(thor_root, 'mcp-server', 'index.js')]) {
    const thor_check = thor_run(process.execPath, ['--check', thor_file]);
    if (thor_check.status !== 0) throw new Error(`GrayMatter runtime validation failed for ${thor_file}.`);
  }
  thor_stage('GrayMatter plugin ready');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((thor_error) => {
    process.stderr.write(`GrayMatter installation failed: ${thor_error.message}\n`);
    process.exitCode = 4;
  });
}
