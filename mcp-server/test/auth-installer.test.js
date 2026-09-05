'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..', '..');
const authScript = path.join(root, 'scripts', 'gm-auth.mjs');
const launcherScript = path.join(root, 'scripts', 'gm-mcp-launcher.mjs');
const installerScript = path.join(root, 'scripts', 'gm-install.mjs');
const token = 'eyJhbGciOiJub25lIn0.eyJyb2xlcyI6WyJFVkVSWU9ORSIsIkFETUlOIl0sInNjb3BlcyI6WyJTQ09QRV9zY2hlbWEucmVhZCIsIlNDT1BFX3NjaGVtYS53cml0ZSJdfQ.';

function executable(file, content) {
  fs.writeFileSync(file, content, { mode: 0o755 });
}

function runAuth(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [authScript, 'keychain'], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

function runInstaller(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [installerScript], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

async function loginServer() {
  let requestResolve;
  const request = new Promise((resolve) => { requestResolve = resolve; });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requestResolve({ url: req.url, body: JSON.parse(body) });
      res.writeHead(200, { 'Set-Cookie': `VALKYR_AUTH=${token}; Path=/; HttpOnly; Secure` });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, request, base: `http://127.0.0.1:${server.address().port}/v1` };
}

test('macOS native dialog signs in and never persists the password', async (t) => {
  const fixture = await loginServer();
  t.after(() => fixture.server.close());
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'graymatter-mac-auth-'));
  const bin = path.join(temp, 'bin');
  const log = path.join(temp, 'security.log');
  const dialogLog = path.join(temp, 'dialog.log');
  fs.mkdirSync(bin);
  executable(path.join(bin, 'osascript'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${dialogLog}"\nprintf '%s\\n' '{"username":"reviewer-mac","password":"fixture-password"}'\n`);
  executable(path.join(bin, 'security'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\ncase "$1" in find-generic-password) exit 44;; esac\n`);
  const result = await runAuth({
    PATH: `${bin}:${process.env.PATH}`,
    GRAYMATTER_TEST_PLATFORM: 'darwin',
    VALKYR_API_BASE: fixture.base
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual((await fixture.request).body, { username: 'reviewer-mac', password: 'fixture-password' });
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /add-generic-password .* -s VALKYR_AUTH /u);
  assert.doesNotMatch(calls, /fixture-password|(?:add-generic-password|Write).*VALKYR_AUTH_PASSWORD/u);
  assert.match(calls, /delete-generic-password .*VALKYR_AUTH_PASSWORD/u);
  const dialogCalls = fs.readFileSync(dialogLog, 'utf8').trim().split('\n');
  assert.equal(dialogCalls.length, 1, 'macOS sign-in should use one native dialog invocation');
  assert.match(dialogCalls[0], /-l JavaScript .*gm-macos-signin\.js/u);
  assert.match(result.stderr, /password was not saved/u);
});

test('Windows native dialog uses Credential Manager and never persists the password', async (t) => {
  const fixture = await loginServer();
  t.after(() => fixture.server.close());
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'graymatter-win-auth-'));
  const helper = path.join(temp, 'powershell.exe');
  const log = path.join(temp, 'powershell.log');
  executable(helper, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\naction=''; previous=''; for arg in "$@"; do [ "$previous" = '-Action' ] && action="$arg"; previous="$arg"; done\ncase "$action" in Prompt) printf '%s\\n' '{"username":"reviewer-win","password":"fixture-password"}';; Write) cat >/dev/null;; Read) exit 0;; Delete) exit 0;; esac\n`);
  const result = await runAuth({
    GRAYMATTER_TEST_PLATFORM: 'win32',
    GRAYMATTER_POWERSHELL: helper,
    VALKYR_API_BASE: fixture.base
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual((await fixture.request).body, { username: 'reviewer-win', password: 'fixture-password' });
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /-Action Prompt/u);
  assert.match(calls, /-Action Write .*GrayMatter:VALKYR_AUTH:default/u);
  assert.doesNotMatch(calls, /fixture-password|-Action Write .*VALKYR_AUTH_PASSWORD/u);
  assert.match(calls, /-Action Delete .*VALKYR_AUTH_PASSWORD/u);
  assert.match(result.stderr, /Windows Credential Manager/u);
});

test('invalid credentials reopen the native dialog with the username preserved', async (t) => {
  let attempts = 0;
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      attempts += 1;
      requests.push(JSON.parse(body));
      if (attempts === 1) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{"message":"invalid credentials"}');
      } else {
        res.writeHead(200, { 'Set-Cookie': [`XSRF-TOKEN=fixture-xsrf; Path=/`, `VALKYR_AUTH=${token}; Path=/; HttpOnly; Secure`] });
        res.end('{}');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'graymatter-auth-retry-'));
  const helper = path.join(temp, 'powershell.exe');
  const log = path.join(temp, 'powershell.log');
  executable(helper, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\naction=''; previous=''; for arg in "$@"; do [ "$previous" = '-Action' ] && action="$arg"; previous="$arg"; done\ncase "$action" in Prompt) count_file="${temp}/count"; count=$(cat "$count_file" 2>/dev/null || echo 0); count=$((count+1)); echo "$count" > "$count_file"; if [ "$count" = 1 ]; then printf '%s\\n' '{"username":"reviewer-win","password":"wrong"}'; else printf '%s\\n' '{"username":"reviewer-win","password":"correct"}'; fi;; Write) cat >/dev/null;; Read) exit 0;; Delete) exit 0;; esac\n`);

  const result = await runAuth({
    GRAYMATTER_TEST_PLATFORM: 'win32',
    GRAYMATTER_POWERSHELL: helper,
    VALKYR_API_BASE: `http://127.0.0.1:${server.address().port}/v1`
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(requests, [
    { username: 'reviewer-win', password: 'wrong' },
    { username: 'reviewer-win', password: 'correct' }
  ]);
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /-DefaultUsername reviewer-win -ErrorMessage GrayMatter username or password was not accepted\./u);
});

test('startup preserves a stored session when validation is temporarily unavailable', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/v1/auth/me' ? 503 : 404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { authState } = await import(`${pathToFileURL(launcherScript).href}?test=${Date.now()}`);
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  assert.equal(await authState(token, base), 'unavailable');
  assert.equal(await authState('', base), 'missing');
});

test('one-command installer connects the marketplace and installs the plugin', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'graymatter-install-'));
  const codex = path.join(temp, 'codex');
  const log = path.join(temp, 'codex.log');
  executable(codex, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\ncase "$*" in *'marketplace list --json'*) printf '%s\\n' '{"marketplaces":[]}' ;; *) printf '%s\\n' '{}' ;; esac\n`);
  const result = await runInstaller({
    CODEX_CLI: codex,
    GRAYMATTER_INSTALL_SKIP_AUTH: '1'
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /downloading plugin[\s\S]*performing signup\/login[\s\S]*authenticating[\s\S]*GrayMatter plugin ready/u);
  const calls = fs.readFileSync(log, 'utf8');
  if (fs.existsSync(path.join(root, '.agents', 'plugins', 'marketplace.json'))) {
    assert.match(calls, /plugin marketplace add .*GrayMatter --json/u);
    assert.match(calls, /plugin add graymatter@graymatter --json/u);
  }
});

test('installer skips a broken Codex shim and uses a healthy fallback', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'graymatter-codex-fallback-'));
  const broken = path.join(temp, 'broken-codex');
  const fallback = path.join(temp, 'working-codex');
  const log = path.join(temp, 'codex.log');
  executable(broken, '#!/bin/sh\nexit 127\n');
  executable(fallback, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\ncase "$*" in *'marketplace list --json'*) printf '%s\\n' '{"marketplaces":[]}' ;; *) printf '%s\\n' '{}' ;; esac\n`);
  const result = await runInstaller({
    CODEX_CLI: broken,
    CODEX_CLI_FALLBACK: fallback,
    GRAYMATTER_INSTALL_SKIP_AUTH: '1'
  });
  assert.equal(result.code, 0, result.stderr);
  if (fs.existsSync(path.join(root, '.agents', 'plugins', 'marketplace.json'))) {
    assert.match(fs.readFileSync(log, 'utf8'), /plugin add graymatter@graymatter --json/u);
  }
});
