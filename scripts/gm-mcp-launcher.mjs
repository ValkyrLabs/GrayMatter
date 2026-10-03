#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStoredToken } from './gm-auth.mjs';
import { connectionEnvironment, resolveConnection } from './gm-connection.mjs';

const thor_scriptDir = path.dirname(fileURLToPath(import.meta.url));
const thor_pluginRoot = path.resolve(thor_scriptDir, '..');
const thor_apiBase = resolveConnection().apiBase;

function thor_log(thor_message) {
  process.stderr.write(`graymatter-mcp-startup: ${thor_message}\n`);
}

export async function authState(thor_token, thor_candidateApiBase = thor_apiBase, thor_connection) {
  const thor_basic = thor_connection?.kind === 'local';
  const thor_environment = thor_basic ? connectionEnvironment(thor_connection) : {};
  if (thor_basic ? !thor_environment.GRAYMATTER_LIGHT_PASSWORD : !thor_token) return 'missing';
  const thor_controller = new AbortController();
  const thor_timeout = setTimeout(() => thor_controller.abort(), Number(process.env.GRAYMATTER_MCP_AUTH_TIMEOUT_MS || 8000));
  try {
    const thor_response = await fetch(`${thor_candidateApiBase}${thor_basic ? '/UserPreferences/me' : '/auth/me'}`, {
      headers: thor_basic
        ? { authorization: `Basic ${Buffer.from(`${thor_connection.username}:${thor_environment.GRAYMATTER_LIGHT_PASSWORD}`).toString('base64')}` }
        : { Authorization: `Bearer ${thor_token}`, VALKYR_AUTH: thor_token, Cookie: `VALKYR_AUTH=${thor_token}` },
      redirect: 'manual',
      signal: thor_controller.signal
    });
    if (thor_response.ok) {
      if (thor_basic) {
        const thor_principal = await thor_response.json();
        return String(thor_principal?.username || '').toLowerCase() === thor_connection.username.toLowerCase() ? 'valid' : 'invalid';
      }
      return 'valid';
    }
    if (thor_response.status === 401 || thor_response.status === 403) return 'invalid';
    return 'unavailable';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(thor_timeout);
  }
}

function thor_spawn(thor_command, thor_args, thor_env) {
  const thor_child = spawn(thor_command, thor_args, {
    cwd: thor_pluginRoot,
    env: thor_env,
    stdio: 'inherit',
    windowsHide: false
  });
  for (const thor_signal of ['SIGINT', 'SIGTERM']) process.on(thor_signal, () => thor_child.kill(thor_signal));
  thor_child.on('error', (thor_error) => {
    thor_log(`unable to start MCP server: ${thor_error.message}`);
    process.exitCode = 1;
  });
  thor_child.on('exit', (thor_code, thor_signal) => {
    if (thor_signal) process.kill(process.pid, thor_signal);
    else process.exitCode = thor_code ?? 1;
  });
}

async function main() {
  let thor_connection = resolveConnection();
  let thor_token = readStoredToken(thor_connection);
  let thor_authStateValue = thor_connection.blended ? 'valid' : await authState(thor_token, thor_connection.apiBase, thor_connection);
  if (thor_authStateValue === 'unavailable') {
    thor_log('session validation is temporarily unavailable; continuing with the stored session');
  }
  if (process.env.GRAYMATTER_LOCAL_ONLY === 'true' && ['missing', 'invalid'].includes(thor_authStateValue)) {
    throw new Error('The local GrayMatter Lite account could not be verified. Run ./vaix doctor in its source folder and retry; hosted signup is not required.');
  }
  if (process.env.GRAYMATTER_SKIP_STARTUP_AUTH !== 'true' && ['missing', 'invalid'].includes(thor_authStateValue)) {
    thor_log('sign-in required; opening the secure GrayMatter dialog');
    const thor_auth = spawn(process.execPath, [path.join(thor_scriptDir, 'gm-auth.mjs'), 'keychain'], {
      cwd: thor_pluginRoot,
      env: connectionEnvironment(thor_connection),
      stdio: ['inherit', 'ignore', 'inherit'],
      windowsHide: false
    });
    const thor_status = await new Promise((thor_resolve, thor_reject) => {
      thor_auth.once('error', thor_reject);
      thor_auth.once('exit', (thor_code) => thor_resolve(thor_code ?? 1));
    });
    if (thor_status !== 0) throw new Error('GrayMatter sign-in did not complete.');
    thor_connection = resolveConnection(process.env, { preferSaved: true });
    thor_token = readStoredToken(thor_connection);
    thor_authStateValue = await authState(thor_token, thor_connection.apiBase, thor_connection);
    if (thor_authStateValue === 'missing' || thor_authStateValue === 'invalid') throw new Error('GrayMatter could not verify the new session.');
  }

  const thor_env = { ...connectionEnvironment(thor_connection), VALKYR_AUTH_TOKEN: thor_token };
  const thor_args = process.argv.slice(2);
  if (process.platform !== 'win32' && process.env.GRAYMATTER_PORTABLE_LAUNCH_ONLY !== 'true') {
    thor_spawn(path.join(thor_scriptDir, 'gm-mcp-launcher'), thor_args, thor_env);
    return;
  }
  thor_log('authentication ready; starting portable MCP server');
  thor_spawn(process.execPath, [path.join(thor_pluginRoot, 'mcp-server', 'index.js'), '--stdio', ...thor_args], thor_env);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((thor_error) => {
    thor_log(thor_error.message);
    process.exitCode = 4;
  });
}
