#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const thor_scriptDir = path.dirname(fileURLToPath(import.meta.url));
const thor_apiBase = (process.env.VALKYR_API_BASE || 'https://api-0.valkyrlabs.com/v1').replace(/\/$/u, '');
const thor_loginPath = process.env.GRAYMATTER_LOGIN_PATH || '/auth/login';
const thor_loginUrl = `${thor_apiBase}/${thor_loginPath.replace(/^\//u, '')}`;
const thor_service = process.env.VALKYR_KEYCHAIN_SERVICE || 'VALKYR_AUTH';
const thor_usernameService = process.env.VALKYR_USERNAME_KEYCHAIN_SERVICE || `${thor_service}_USERNAME`;
const thor_legacyPasswordService = process.env.VALKYR_PASSWORD_KEYCHAIN_SERVICE || `${thor_service}_PASSWORD`;
const thor_signupUrl = process.env.VALKYR_HUMAN_SIGNUP_URL || 'https://valkyrlabs.com/graymatter/activate';
const thor_platform = process.env.GRAYMATTER_TEST_PLATFORM || process.platform;
const thor_windowsHelper = path.join(thor_scriptDir, 'gm-windows-credential.ps1');

function thor_run(thor_command, thor_args, thor_options = {}) {
  return spawnSync(thor_command, thor_args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: Number(process.env.GRAYMATTER_AUTH_HELPER_TIMEOUT_MS || 120000),
    ...thor_options
  });
}

function thor_powershellArgs(thor_action, thor_extra = []) {
  return ['-NoLogo', '-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', thor_windowsHelper, '-Action', thor_action, ...thor_extra];
}

function thor_windowsHelperCall(thor_action, thor_extra = [], thor_input = '') {
  const thor_shell = process.env.GRAYMATTER_POWERSHELL || 'powershell.exe';
  const thor_result = thor_run(thor_shell, thor_powershellArgs(thor_action, thor_extra), {
    input: thor_input,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (thor_result.status !== 0) {
    const thor_message = (thor_result.stderr || '').trim();
    throw new Error(thor_message || `Windows credential helper failed (${thor_action}).`);
  }
  return (thor_result.stdout || '').trim();
}

function thor_credentialTarget(thor_candidateService, thor_account) {
  return `GrayMatter:${thor_candidateService}:${thor_account}`;
}

export function readCredential(thor_candidateService, thor_account = 'default') {
  try {
    if (thor_platform === 'darwin') {
      const thor_result = thor_run('security', ['find-generic-password', '-a', thor_account, '-s', thor_candidateService, '-w'], {
        stdio: ['ignore', 'pipe', 'ignore']
      });
      return thor_result.status === 0 ? (thor_result.stdout || '').trim() : '';
    }
    if (thor_platform === 'win32') {
      return thor_windowsHelperCall('Read', ['-Target', thor_credentialTarget(thor_candidateService, thor_account)]);
    }
    const thor_result = thor_run('secret-tool', ['lookup', 'service', thor_candidateService, 'account', thor_account], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return thor_result.status === 0 ? (thor_result.stdout || '').trim() : '';
  } catch {
    return '';
  }
}

function writeCredential(thor_candidateService, thor_account, thor_value) {
  if (!thor_value) return;
  if (thor_platform === 'darwin') {
    const thor_result = thor_run('security', ['add-generic-password', '-U', '-a', thor_account, '-s', thor_candidateService, '-w', thor_value], {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    if (thor_result.status !== 0) throw new Error('Unable to save the GrayMatter session in macOS Keychain.');
    return;
  }
  if (thor_platform === 'win32') {
    thor_windowsHelperCall('Write', ['-Target', thor_credentialTarget(thor_candidateService, thor_account), '-UserName', thor_account], thor_value);
    return;
  }
  const thor_result = thor_run('secret-tool', ['store', '--label=GrayMatter session', 'service', thor_candidateService, 'account', thor_account], {
    input: thor_value,
    stdio: ['pipe', 'ignore', 'pipe']
  });
  if (thor_result.status !== 0) throw new Error('No supported credential vault is available. Install secret-tool or use VALKYR_AUTH_TOKEN for this session.');
}

function deleteCredential(thor_candidateService, thor_account) {
  try {
    if (thor_platform === 'darwin') {
      thor_run('security', ['delete-generic-password', '-a', thor_account, '-s', thor_candidateService], { stdio: 'ignore' });
    } else if (thor_platform === 'win32') {
      thor_windowsHelperCall('Delete', ['-Target', thor_credentialTarget(thor_candidateService, thor_account)]);
    } else {
      thor_run('secret-tool', ['clear', 'service', thor_candidateService, 'account', thor_account], { stdio: 'ignore' });
    }
  } catch {
    // Legacy password cleanup is best effort; a failed cleanup must not erase the new session.
  }
}

export function readStoredToken() {
  const thor_envToken = process.env.VALKYR_AUTH_TOKEN || process.env.VALKYR_JWT_SESSION || process.env.VALKYR_AUTH || '';
  if (thor_envToken) return thor_envToken.trim();
  const thor_username = process.env.GRAYMATTER_USERNAME || process.env.VALKYR_USERNAME || readCredential(thor_usernameService, 'default');
  for (const thor_account of [...new Set([thor_username, 'default'].filter(Boolean))]) {
    for (const thor_candidateService of [...new Set([thor_service, 'VALKYR_AUTH', 'openclaw-valkyrai-admin-jwtSession'])]) {
      const thor_token = readCredential(thor_candidateService, thor_account);
      if (thor_token) return thor_token;
    }
  }
  return '';
}

function promptMac(thor_defaultUsername = '') {
  const thor_usernameScript = `
set signupUrl to system attribute "GRAYMATTER_SIGNUP_URL"
set defaultUsername to system attribute "GRAYMATTER_DEFAULT_USERNAME"
repeat
  set promptResult to display dialog "Sign in to GrayMatter. New here? Choose Create Account, finish signup in your browser, then return here." default answer defaultUsername buttons {"Cancel", "Create Account", "Sign In"} default button "Sign In" cancel button "Cancel" with title "GrayMatter Sign In"
  if button returned of promptResult is "Create Account" then
    open location signupUrl
  else
    return text returned of promptResult
  end if
end repeat`;
  const thor_usernameResult = thor_run('osascript', [], {
    input: thor_usernameScript,
    env: { ...process.env, GRAYMATTER_SIGNUP_URL: thor_signupUrl, GRAYMATTER_DEFAULT_USERNAME: thor_defaultUsername },
    stdio: ['pipe', 'pipe', 'ignore']
  });
  if (thor_usernameResult.status !== 0) throw new Error('GrayMatter sign-in was cancelled.');
  const thor_username = (thor_usernameResult.stdout || '').trim();
  if (!thor_username) throw new Error('A GrayMatter username is required.');

  const thor_passwordScript = `
set userName to system attribute "GRAYMATTER_PROMPT_USERNAME"
return text returned of (display dialog "Password for " & userName default answer "" with hidden answer buttons {"Cancel", "Sign In"} default button "Sign In" cancel button "Cancel" with title "GrayMatter Sign In")`;
  const thor_passwordResult = thor_run('osascript', [], {
    input: thor_passwordScript,
    env: { ...process.env, GRAYMATTER_PROMPT_USERNAME: thor_username },
    stdio: ['pipe', 'pipe', 'ignore']
  });
  if (thor_passwordResult.status !== 0) throw new Error('GrayMatter sign-in was cancelled.');
  return { username: thor_username, password: (thor_passwordResult.stdout || '').trim() };
}

function promptWindows(thor_defaultUsername = '') {
  const thor_output = thor_windowsHelperCall('Prompt', ['-SignupUrl', thor_signupUrl, '-DefaultUsername', thor_defaultUsername]);
  try {
    return JSON.parse(thor_output);
  } catch {
    throw new Error('The Windows sign-in dialog returned an invalid response.');
  }
}

function promptTerminal() {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(`Interactive sign-in is unavailable. Create an account at ${thor_signupUrl}, then rerun GrayMatter from a desktop session.`);
  }
  return new Promise((thor_resolve, thor_reject) => {
    const thor_interface = readline.createInterface({ input: process.stdin, output: process.stderr });
    thor_interface.question('GrayMatter username: ', (thor_username) => {
      thor_interface.close();
      if (!thor_username.trim()) return thor_reject(new Error('A GrayMatter username is required.'));
      process.stderr.write('GrayMatter password: ');
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      let thor_password = '';
      const thor_onData = (thor_key) => {
        if (thor_key === '\r' || thor_key === '\n') {
          process.stdin.off('data', thor_onData);
          process.stdin.setRawMode?.(false);
          process.stderr.write('\n');
          thor_resolve({ username: thor_username.trim(), password: thor_password });
        } else if (thor_key === '\u0003') {
          process.stdin.setRawMode?.(false);
          thor_reject(new Error('GrayMatter sign-in was cancelled.'));
        } else if (thor_key === '\u007f') {
          thor_password = thor_password.slice(0, -1);
        } else {
          thor_password += thor_key;
        }
      };
      process.stdin.on('data', thor_onData);
    });
  });
}

async function collectCredentials() {
  const thor_username = process.env.GRAYMATTER_USERNAME || process.env.VALKYR_USERNAME || readCredential(thor_usernameService, 'default');
  const thor_password = process.env.GRAYMATTER_PASSWORD || process.env.VALKYR_PASSWORD || '';
  if (thor_username && thor_password) return { username: thor_username, password: thor_password };
  if (process.env.GRAYMATTER_TEST_DIALOG_JSON) return JSON.parse(process.env.GRAYMATTER_TEST_DIALOG_JSON);
  if (thor_platform === 'darwin') return promptMac(thor_username);
  if (thor_platform === 'win32') return promptWindows(thor_username);
  return promptTerminal();
}

function sessionFromResponse(thor_body, thor_headers) {
  let thor_json = {};
  try { thor_json = thor_body ? JSON.parse(thor_body) : {}; } catch { /* Some deployments return only a cookie. */ }
  const thor_bodyToken = thor_json.VALKYR_AUTH || thor_json?.data?.VALKYR_AUTH || thor_json.token || thor_json.session || thor_json.jwt || thor_json.jwtSession || thor_json?.data?.jwtSession;
  let thor_token = thor_bodyToken ? String(thor_bodyToken) : '';
  const thor_cookieHeader = thor_headers.get('set-cookie') || '';
  const thor_xsrfToken = thor_json.xsrfToken || thor_json?.data?.xsrfToken || thor_cookieHeader.match(/XSRF-TOKEN=([^;,\s]+)/iu)?.[1] || '';
  for (const thor_headerName of ['valkyr_auth', 'authorization', 'set-cookie']) {
    if (thor_token) break;
    const thor_header = thor_headers.get(thor_headerName) || '';
    const thor_match = thor_headerName === 'authorization'
      ? thor_header.match(/^Bearer\s+(.+)$/iu)
      : thor_header.match(/(?:VALKYR_AUTH|jwtSession)=([^;,\s]+)/iu) || [null, thor_headerName === 'valkyr_auth' ? thor_header : ''];
    if (thor_match?.[1]) thor_token = thor_match[1];
  }
  return { token: thor_token, xsrfToken: String(thor_xsrfToken) };
}

function tokenIsClearlyReadOnly(thor_token) {
  try {
    const thor_payload = JSON.parse(Buffer.from(thor_token.split('.')[1], 'base64url').toString('utf8'));
    const thor_roles = [...(thor_payload.roles || []), ...(thor_payload.roleList || []), ...(thor_payload.authorities || []), ...(thor_payload.authorityList || [])];
    const thor_scopes = thor_payload.scopes || [];
    return thor_roles.every((thor_role) => ['EVERYONE', 'FREE'].includes(thor_role)) && thor_scopes.every((thor_scope) => thor_scope === 'SCOPE_schema.read');
  } catch {
    return false;
  }
}

export async function login(thor_credentials) {
  const thor_attempts = Math.max(1, Number(process.env.GRAYMATTER_HTTP_RETRIES || 4));
  let thor_lastError;
  for (let thor_attempt = 1; thor_attempt <= thor_attempts; thor_attempt += 1) {
    const thor_controller = new AbortController();
    const thor_timeout = setTimeout(() => thor_controller.abort(), Number(process.env.GRAYMATTER_LOGIN_TIMEOUT_MS || 60000));
    try {
      const thor_response = await fetch(thor_loginUrl, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(thor_credentials),
        signal: thor_controller.signal
      });
      const thor_body = await thor_response.text();
      if (!thor_response.ok) {
        const thor_error = new Error(thor_response.status === 401 ? 'GrayMatter username or password was not accepted.' : `GrayMatter sign-in failed (HTTP ${thor_response.status}).`);
        thor_error.retryable = thor_response.status >= 500 || thor_response.status === 429;
        throw thor_error;
      }
      const { token: thor_token, xsrfToken: thor_xsrfToken } = sessionFromResponse(thor_body, thor_response.headers);
      if (!thor_token) throw new Error('GrayMatter signed in but the server did not return a usable session.');
      if (process.env.GRAYMATTER_ALLOW_READONLY_TOKEN !== '1' && tokenIsClearlyReadOnly(thor_token)) {
        throw new Error('GrayMatter issued a read-only session. This account needs memory write access.');
      }
      return { token: thor_token, xsrfToken: thor_xsrfToken };
    } catch (thor_error) {
      thor_lastError = thor_error;
      const thor_retryable = thor_error.retryable || thor_error.name === 'AbortError' || thor_error instanceof TypeError;
      if (!thor_retryable || thor_attempt === thor_attempts) throw thor_error;
      await new Promise((thor_resolve) => setTimeout(thor_resolve, Math.min(1000 * thor_attempt, 3000)));
    } finally {
      clearTimeout(thor_timeout);
    }
  }
  throw thor_lastError;
}

export function storeSession(thor_username, thor_token) {
  writeCredential(thor_service, thor_username, thor_token);
  writeCredential(thor_service, 'default', thor_token);
  writeCredential(thor_usernameService, 'default', thor_username);
  deleteCredential(thor_legacyPasswordService, thor_username);
}

async function main() {
  const thor_mode = process.argv[2] || 'keychain';
  if (!['keychain', 'env', 'token', 'read-token'].includes(thor_mode)) throw new Error('Usage: gm-auth.mjs [keychain|env|token|read-token]');
  if (thor_mode === 'read-token') {
    process.stdout.write(readStoredToken());
    return;
  }
  const thor_credentials = await collectCredentials();
  if (!thor_credentials.username || !thor_credentials.password) throw new Error('Both a GrayMatter username and password are required.');
  const thor_session = await login(thor_credentials);
  const thor_token = thor_session.token;
  if (thor_mode !== 'token') storeSession(thor_credentials.username, thor_token);
  if (thor_mode === 'env') {
    process.stdout.write(`export VALKYR_API_BASE=${JSON.stringify(thor_apiBase)}\nexport VALKYR_AUTH_TOKEN=${JSON.stringify(thor_token)}\n`);
    if (thor_session.xsrfToken) process.stdout.write(`export GRAYMATTER_XSRF_TOKEN=${JSON.stringify(thor_session.xsrfToken)}\n`);
  } else if (thor_mode === 'token') {
    process.stdout.write(`${thor_token}\n`);
  }
  process.stderr.write(thor_mode === 'token'
    ? 'GrayMatter sign-in complete; password was not saved.\n'
    : `GrayMatter sign-in complete. Session stored in ${thor_platform === 'win32' ? 'Windows Credential Manager' : thor_platform === 'darwin' ? 'macOS Keychain' : 'the system credential vault'}; password was not saved.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((thor_error) => {
    process.stderr.write(`GrayMatter sign-in failed: ${thor_error.message}\n`);
    process.stderr.write(`Create or recover an account: ${thor_signupUrl}\n`);
    process.exitCode = 4;
  });
}
