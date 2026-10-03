'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const moduleUrl = pathToFileURL(path.join(root, 'scripts/gm-connection.mjs')).href;
const tempState = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'graymatter-local-onboarding-')));

test('portable auth CLI executes through a filesystem alias', async (t) => {
  const state = tempState(); t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const alias = path.join(state, 'auth-alias.mjs'); fs.symlinkSync(path.join(root, 'scripts/gm-auth.mjs'), alias);
  const result = await run(alias, ['invalid-mode'], { GRAYMATTER_STATE_DIR: state });
  assert.equal(result.code, 4); assert.match(result.stderr, /Usage: gm-auth/);
});

test('portable installer CLI executes through a filesystem alias', async (t) => {
  const state = tempState(); t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const alias = path.join(state, 'install-alias.mjs'); fs.symlinkSync(path.join(root, 'scripts/gm-install.mjs'), alias);
  const codex = path.join(state, 'fixture-codex');
  fs.writeFileSync(codex, '#!/bin/sh\nprintf \'{}\\n\'\n', { mode: 0o755 });
  const result = await run(alias, [], { GRAYMATTER_STATE_DIR: state, GRAYMATTER_INSTALL_SKIP_AUTH: '1', CODEX_CLI: codex });
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /GrayMatter plugin ready/);
});

async function run(script, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, VALKYR_API_BASE: '', VALKYR_AUTH_TOKEN: '', VALKYR_JWT_SESSION: '', VALKYR_AUTH: '', GRAYMATTER_PROFILE: '', GRAYMATTER_ACTIVE_PROFILE: '', GRAYMATTER_PROFILES: '', GRAYMATTER_PROFILE_MODE: '', GRAYMATTER_LIGHT_MODE: '', GRAYMATTER_LIGHT_PASSWORD: '', GRAYMATTER_USERNAME: '', VALKYR_USERNAME: '', GRAYMATTER_PASSWORD: '', VALKYR_PASSWORD: '', GRAYMATTER_STATE_DIR: tempState(), ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

function fakeVault(state) {
  const bin = path.join(state, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(state, 'vault.log');
  fs.writeFileSync(path.join(bin, 'security'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$1" in find-generic-password) exit 44;; esac\n`, { mode: 0o755 });
  return { PATH: `${bin}:${process.env.PATH}`, GRAYMATTER_TEST_PLATFORM: 'darwin', GRAYMATTER_STATE_DIR: state, GRAYMATTER_MAX_INTERACTIVE_ATTEMPTS: '1' };
}

async function server(t, handler) {
  const requests = [];
  const fixture = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { requests.push({ url: req.url, body, authorization: req.headers.authorization }); handler(req, res); });
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  t.after(() => fixture.close());
  return { base: `http://127.0.0.1:${fixture.address().port}/v1`, requests };
}

test('URL validation accepts loopback and HTTPS; rejects unsafe credential destinations', async () => {
  const { normalizeApiBase } = await import(moduleUrl);
  assert.equal(normalizeApiBase(' http://localhost:8787/ '), 'http://localhost:8787/v1');
  assert.equal(normalizeApiBase('http://[::1]:8080'), 'http://[::1]:8080/v1');
  assert.equal(normalizeApiBase('https://memory.example/custom/'), 'https://memory.example/custom');
  for (const value of ['localhost:8787', 'http://memory.example/v1', 'https://user:password@memory.example/v1', 'https://memory.example/v1?token=x', 'https://memory.example/v1#fragment', 'file:///tmp/memory']) {
    assert.throws(() => normalizeApiBase(value));
  }
});

test('first-run choices include Cloud, Lite localhost, ValkyrAI localhost and self-hosted', async () => {
  const { CONNECTION_CHOICES, resolveConnection } = await import(moduleUrl);
  assert.deepEqual(CONNECTION_CHOICES.map((choice) => choice.apiBase), ['https://api-0.valkyrlabs.com/v1', 'http://localhost:8787/v1', 'http://localhost:8080/v1', '']);
  assert.equal(resolveConnection({ GRAYMATTER_STATE_DIR: tempState() }).apiBase, CONNECTION_CHOICES[0].apiBase);
});

test('env login exports shell-safe values and uses the selected instance', async (t) => {
  const hostileToken = 'fixture-$(touch /tmp/graymatter-unwanted-command)-`id`-\'quoted';
  const hostileXsrf = 'fixture-$(touch /tmp/graymatter-unwanted-xsrf)-`id`-\'quoted';
  const fixture = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ token: hostileToken, xsrfToken: hostileXsrf })); });
  const state = tempState();
  const result = await run(path.join(root, 'scripts/gm-auth.mjs'), ['env'], {
    ...fakeVault(state), GRAYMATTER_TEST_DIALOG_JSON: JSON.stringify({ apiBase: fixture.base, kind: 'hosted', username: 'local-user', password: 'fixture-password' })
  });
  assert.equal(result.code, 0, result.stderr);
  const evaluated = spawnSync('bash', ['-c', 'eval "$(cat)"; printf "%s\\n%s\\n%s" "$VALKYR_API_BASE" "$VALKYR_AUTH_TOKEN" "$GRAYMATTER_XSRF_TOKEN"'], { input: result.stdout, encoding: 'utf8' });
  assert.equal(evaluated.status, 0, evaluated.stderr);
  assert.equal(evaluated.stdout, `${fixture.base}\n${hostileToken}\n${hostileXsrf}`);
});

test('self-hosted login sends credentials only to the chosen server and saves its route', async (t) => {
  const fixture = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"token":"fixture-self-hosted-session"}'); });
  const state = tempState();
  const result = await run(path.join(root, 'scripts/gm-auth.mjs'), ['keychain'], {
    ...fakeVault(state), GRAYMATTER_TEST_DIALOG_JSON: JSON.stringify({ apiBase: fixture.base.replace('/v1', ''), kind: 'hosted', username: 'local-user', password: 'fixture-password' })
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(fixture.requests.map(({ url, body, authorization }) => ({ url, body: JSON.parse(body), authorization })), [{ url: '/v1/auth/login', body: { username: 'local-user', password: 'fixture-password' }, authorization: undefined }]);
  const value = JSON.parse(fs.readFileSync(path.join(state, 'profiles.json')));
  assert.equal(value.mode, 'single');
  assert.equal(value.profiles[value.activeProfile].apiBase, fixture.base);
  assert.match(value.profiles[value.activeProfile].keychainService, /^GRAYMATTER_[a-f0-9]+$/u);
  assert.doesNotMatch(fs.readFileSync(path.join(state, 'vault.log'), 'utf8'), /(?:add|delete)-generic-password .* -s VALKYR_AUTH /u);
  assert.doesNotMatch(fs.readFileSync(path.join(state, 'profiles.json'), 'utf8'), /fixture-password|fixture-self-hosted-session/u);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-password|fixture-self-hosted-session/u);
});

test('Lite login validates the actual local account and resumes through existing profiles', async (t) => {
  const fixture = await server(t, (req, res) => {
    if (req.url !== '/v1/UserPreferences/me') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"username":"local-user"}');
  });
  const state = tempState();
  const result = await run(path.join(root, 'scripts/gm-auth.mjs'), ['keychain'], {
    ...fakeVault(state), GRAYMATTER_TEST_DIALOG_JSON: JSON.stringify({ apiBase: fixture.base, kind: 'local', username: 'local-user', password: 'fixture-local-password' })
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fixture.requests[0].authorization, `Basic ${Buffer.from('local-user:fixture-local-password').toString('base64')}`);
  const { resolveConnection, connectionEnvironment } = await import(moduleUrl);
  const connection = resolveConnection({ GRAYMATTER_STATE_DIR: state });
  assert.equal(connection.kind, 'local');
  assert.equal(connection.apiBase, fixture.base);
  const env = connectionEnvironment(connection, { VALKYR_AUTH_TOKEN: 'cloud-token' });
  assert.equal(env.GRAYMATTER_LIGHT_PASSWORD, 'fixture-local-password');
  assert.equal(env.VALKYR_AUTH_TOKEN, undefined);
  assert.equal(fs.statSync(connection.passwordFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(state, 'profiles.json')).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(path.join(state, 'profiles.json'), 'utf8'), /fixture-local-password/u);
  assert.doesNotMatch(fs.readFileSync(path.join(state, 'vault.log'), 'utf8'), /add-generic-password/u);
});

test('rejected or wrong-instance Lite responses never save credentials', async (t) => {
  for (const response of [{ status: 401, body: '{}' }, { status: 200, body: '{"username":"another-user"}' }, { status: 200, body: '<html>login</html>' }]) {
    const fixture = await server(t, (_req, res) => { res.writeHead(response.status); res.end(response.body); });
    const state = tempState();
    const result = await run(path.join(root, 'scripts/gm-auth.mjs'), ['keychain'], {
      ...fakeVault(state), GRAYMATTER_TEST_DIALOG_JSON: JSON.stringify({ apiBase: fixture.base, kind: 'local', username: 'local-user', password: 'fixture-password' })
    });
    assert.equal(result.code, 4);
    assert.equal(fs.existsSync(path.join(state, 'profiles.json')), false);
  }
});

test('a missing instance token never falls back to the hosted credential vault', async () => {
  const state = tempState();
  const env = fakeVault(state);
  const { saveConnection } = await import(moduleUrl);
  saveConnection({ apiBase: 'http://localhost:8080/v1', kind: 'hosted', username: 'local-user', keychainService: 'local-instance-vault' }, { GRAYMATTER_STATE_DIR: state });
  const result = await run(path.join(root, 'scripts/gm-auth.mjs'), ['read-token'], env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  const calls = fs.readFileSync(path.join(state, 'vault.log'), 'utf8');
  assert.doesNotMatch(calls, /-s VALKYR_AUTH|openclaw-valkyrai-admin|-a default -s local-instance-vault\s/u);
});

test('profile refresh preserves another active identity and switching Cloud retains local profiles', async () => {
  const { saveConnection, resolveConnection, connectionEnvironment, CLOUD_API_BASE } = await import(moduleUrl);
  const env = { GRAYMATTER_STATE_DIR: tempState() };
  const first = { apiBase: 'http://localhost:8080/v1', kind: 'hosted', username: 'one', keychainService: 'one-service' };
  saveConnection(first, env);
  const other = { apiBase: 'https://memory.example/v1', kind: 'hosted', username: 'two', keychainService: 'two-service' };
  saveConnection(other, { ...env, GRAYMATTER_KEYCHAIN_UPDATE_DEFAULT: '0' });
  assert.equal(resolveConnection(env).profileName, first.profileName);
  saveConnection({ apiBase: CLOUD_API_BASE, kind: 'hosted', username: 'cloud' }, env);
  assert.equal(resolveConnection(env).apiBase, CLOUD_API_BASE);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(env.GRAYMATTER_STATE_DIR, 'profiles.json'))).profiles).length, 2);
  const resumed = connectionEnvironment(resolveConnection(env), {
    VALKYR_API_BASE: first.apiBase, VALKYR_AUTH_TOKEN: 'old-instance-token', GRAYMATTER_PROFILE: first.profileName,
    GRAYMATTER_ACTIVE_PROFILE: first.profileName, GRAYMATTER_PROFILE_MODE: 'single', GRAYMATTER_PROFILE_RESOLVED: 'true', GRAYMATTER_LIGHT_MODE: 'true', GRAYMATTER_LIGHT_PASSWORD: 'old-local-password'
  });
  assert.equal(resumed.GRAYMATTER_PROFILE, undefined);
  assert.equal(resumed.GRAYMATTER_ACTIVE_PROFILE, undefined);
  assert.equal(resumed.GRAYMATTER_PROFILE_MODE, 'legacy');
  assert.equal(resumed.VALKYR_AUTH_TOKEN, undefined);
  assert.equal(resumed.GRAYMATTER_LIGHT_PASSWORD, undefined);
});

test('malformed profile registry fails closed', async () => {
  const { resolveConnection } = await import(moduleUrl);
  const state = tempState();
  fs.writeFileSync(path.join(state, 'profiles.json'), '{"version":1,"mode":"unknown","profiles":{}}');
  assert.throws(() => resolveConnection({ GRAYMATTER_STATE_DIR: state }), /registry is invalid/u);
});

test('explicit named profiles keep their account and server binding despite ambient defaults', async () => {
  const { saveConnection, resolveConnection } = await import(moduleUrl);
  const env = { GRAYMATTER_STATE_DIR: tempState() };
  const selected = { apiBase: 'http://localhost:8080/v1', kind: 'hosted', username: 'local-user', keychainService: 'local-service' };
  saveConnection(selected, env);
  const value = resolveConnection({ ...env, GRAYMATTER_PROFILE: selected.profileName, VALKYR_API_BASE: 'https://api-0.valkyrlabs.com/v1', GRAYMATTER_USERNAME: 'ambient-cloud-user', VALKYR_KEYCHAIN_SERVICE: 'VALKYR_AUTH' });
  assert.equal(value.apiBase, selected.apiBase);
  assert.equal(value.username, selected.username);
  assert.equal(value.keychainService, selected.keychainService);
});

test('profile login refreshes only its configured account without creating or activating another profile', async (t) => {
  const fixture = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"token":"fixture-session"}'); });
  const state = tempState();
  const { saveConnection } = await import(moduleUrl);
  const selected = { apiBase: fixture.base, kind: 'hosted', username: 'local-user', keychainService: 'selected-service' };
  saveConnection(selected, { GRAYMATTER_STATE_DIR: state });
  const before = fs.readFileSync(path.join(state, 'profiles.json'), 'utf8');
  const result = await run(path.join(root, 'scripts/gm-auth.mjs'), ['keychain'], {
    ...fakeVault(state), GRAYMATTER_PROFILE_RESOLVED: 'true', GRAYMATTER_USERNAME: 'local-user',
    VALKYR_API_BASE: fixture.base, VALKYR_KEYCHAIN_SERVICE: 'selected-service', GRAYMATTER_KEYCHAIN_UPDATE_DEFAULT: '0',
    GRAYMATTER_TEST_DIALOG_JSON: JSON.stringify({ apiBase: fixture.base, kind: 'hosted', username: 'local-user', password: 'fixture-password' })
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(state, 'profiles.json'), 'utf8'), before);
  assert.doesNotMatch(fs.readFileSync(path.join(state, 'vault.log'), 'utf8'), /add-generic-password .* -a default/u);
  const wrong = await run(path.join(root, 'scripts/gm-auth.mjs'), ['keychain'], {
    ...fakeVault(tempState()), GRAYMATTER_PROFILE_RESOLVED: 'true', GRAYMATTER_USERNAME: 'local-user',
    VALKYR_API_BASE: fixture.base, VALKYR_KEYCHAIN_SERVICE: 'selected-service', GRAYMATTER_KEYCHAIN_UPDATE_DEFAULT: '0',
    GRAYMATTER_TEST_DIALOG_JSON: JSON.stringify({ apiBase: fixture.base, kind: 'hosted', username: 'different-user', password: 'fixture-password' })
  });
  assert.equal(wrong.code, 4);
  assert.equal(fixture.requests.length, 1);
});

test('MCP startup uses the server selected in the initial native prompt', async (t) => {
  const fixture = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"username":"local-user"}'); });
  const state = tempState();
  const plugin = path.join(state, 'plugin');
  fs.mkdirSync(path.join(plugin, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'mcp-server'));
  for (const file of ['gm-auth.mjs', 'gm-connection.mjs', 'gm-mcp-launcher.mjs']) fs.copyFileSync(path.join(root, 'scripts', file), path.join(plugin, 'scripts', file));
  fs.writeFileSync(path.join(plugin, 'mcp-server/index.js'), 'process.stdout.write(JSON.stringify({apiBase:process.env.VALKYR_API_BASE,local:process.env.GRAYMATTER_LIGHT_MODE,username:process.env.GRAYMATTER_LIGHT_USERNAME,hasPassword:Boolean(process.env.GRAYMATTER_LIGHT_PASSWORD),token:process.env.VALKYR_AUTH_TOKEN}));');
  const result = await run(path.join(plugin, 'scripts/gm-mcp-launcher.mjs'), ['--stdio'], {
    ...fakeVault(state), GRAYMATTER_PORTABLE_LAUNCH_ONLY: 'true',
    GRAYMATTER_TEST_DIALOG_JSON: JSON.stringify({ apiBase: fixture.base, kind: 'local', username: 'local-user', password: 'fixture-password' })
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { apiBase: fixture.base, local: 'true', username: 'local-user', hasPassword: true, token: '' });
  assert.equal(fixture.requests.length, 2, 'sign-in and startup verification use the chosen local instance');
});

test('MCP startup follows a symlinked source folder and starts the local server', async (t) => {
  const fixture = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"username":"local-user"}'); });
  const state = tempState(); t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const plugin = path.join(state, 'plugin');
  fs.mkdirSync(path.join(plugin, 'scripts'), { recursive: true }); fs.mkdirSync(path.join(plugin, 'mcp-server'));
  for (const file of ['gm-auth.mjs', 'gm-connection.mjs', 'gm-mcp-launcher.mjs']) fs.copyFileSync(path.join(root, 'scripts', file), path.join(plugin, 'scripts', file));
  fs.writeFileSync(path.join(plugin, 'mcp-server/index.js'), 'process.stdout.write("local-symlink-launch-passed");');
  const link = path.join(state, 'selected-source'); fs.symlinkSync(plugin, link);
  const { saveConnection } = await import(moduleUrl);
  saveConnection({ apiBase: fixture.base, kind: 'local', username: 'local-user', password: 'disposable-symlink-fixture' }, { GRAYMATTER_STATE_DIR: state });
  const result = await run(path.join(link, 'scripts/gm-mcp-launcher.mjs'), ['--stdio'], { GRAYMATTER_STATE_DIR: state, GRAYMATTER_LOCAL_ONLY: 'true', GRAYMATTER_PORTABLE_LAUNCH_ONLY: 'true' });
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, 'local-symlink-launch-passed');
  assert.equal(fixture.requests.length, 1); assert.match(result.stderr, /starting portable MCP server/u);
});

test('native dialogs expose self-hosted choices before credentials and preserve route on retry', () => {
  const mac = fs.readFileSync(path.join(root, 'scripts/gm-macos-signin.js'), 'utf8');
  const win = fs.readFileSync(path.join(root, 'scripts/gm-windows-credential.ps1'), 'utf8');
  assert.match(mac, /NSPopUpButton/u);
  assert.match(mac, /Cloud signup is optional/u);
  assert.match(mac, /apiBase: thorRememberedBase, kind: thorRememberedKind/u);
  assert.match(win, /Local GrayMatter Lite \(localhost:8787\)/u);
  assert.match(win, /Local ValkyrAI \(localhost:8080\)/u);
  assert.match(win, /\$DefaultApiBase/u);
  assert.match(win, /Cloud signup is optional/u);
});


test('local-only connections reject hosted routes, remote Lite and blended defaults before any vault access', async () => {
  const { resolveConnection, saveConnection } = await import(moduleUrl);
  const state = tempState();
  const env = { GRAYMATTER_STATE_DIR: state };
  const local = { apiBase: 'http://localhost:8787/v1', kind: 'local', username: 'local-user', password: 'fixture-password' };
  saveConnection(local, env);
  assert.equal(resolveConnection({ ...env, GRAYMATTER_LOCAL_ONLY: 'true' }).kind, 'local');
  assert.throws(() => resolveConnection({ ...env, GRAYMATTER_LOCAL_ONLY: 'true', VALKYR_API_BASE: 'https://api-0.valkyrlabs.com/v1' }), /requires a local GrayMatter Lite/u);
  assert.throws(() => resolveConnection({ ...env, GRAYMATTER_LOCAL_ONLY: 'true', GRAYMATTER_PROFILE_MODE: 'blend' }), /requires a local GrayMatter Lite/u);
  saveConnection({ ...local, apiBase: 'https://memory.example/v1' }, env);
  assert.throws(() => resolveConnection({ ...env, GRAYMATTER_LOCAL_ONLY: 'true' }), /requires a local GrayMatter Lite/u);
});

test('local-only reconnect reports rejected local credentials without opening a hosted sign-in dialog', async (t) => {
  const { saveConnection } = await import(moduleUrl);
  const fixture = await server(t, (_req, res) => { res.writeHead(401); res.end('{}'); });
  const state = tempState();
  saveConnection({ apiBase: fixture.base, kind: 'local', username: 'local-user', password: 'fixture-password' }, { GRAYMATTER_STATE_DIR: state });
  const result = await run(path.join(root, 'scripts/gm-mcp-launcher.mjs'), ['--stdio'], { ...fakeVault(state), GRAYMATTER_LOCAL_ONLY: 'true', GRAYMATTER_PORTABLE_LAUNCH_ONLY: 'true' });
  assert.equal(result.code, 4);
  assert.match(result.stderr, /.\/vaix doctor/u);
  assert.doesNotMatch(result.stderr, /opening the secure GrayMatter dialog/u);
  assert.equal(fs.existsSync(path.join(state, 'vault.log')), false);
});
