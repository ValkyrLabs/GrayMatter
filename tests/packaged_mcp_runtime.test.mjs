import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const source of ['.', 'plugins/graymatter']) {
  test(`the ${source} download starts MCP without credentials or network warmups`, { timeout: 20000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'graymatter-package-runtime-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const archive = join(directory, 'graymatter.skill');
    const home = join(directory, 'home');
    const bin = join(directory, 'bin');
    const events = join(directory, 'unexpected-events');
    mkdirSync(home); mkdirSync(bin);
    // A distributed package must discover tools before accessing a user's vault
    // or running online update/auth helpers. These substitutes never use either.
    for (const command of ['security', 'osascript', 'secret-tool', 'curl', 'powershell.exe']) {
      writeFileSync(join(bin, command), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(events)}, ${JSON.stringify(command + '\n')});process.exit(97);\n`, { mode: 0o755 });
    }
    const environment = {
      PATH: `${bin}:${process.env.PATH}`, HOME: home, USERPROFILE: home,
      TMPDIR: directory, SYSTEMROOT: process.env.SYSTEMROOT || '',
      GRAYMATTER_STATE_DIR: join(directory, 'state'),
      GRAYMATTER_PROFILES_FILE: join(directory, 'profiles.json'),
      // The mirror's output override remains supported by the canonical packager.
      [source === '.' ? 'GRAYMATTER_PACKAGE_OUT' : 'GRAYMATTER_PLUGIN_PACKAGE_OUT']: archive
    };
    execFileSync('/bin/bash', [join(root, source, 'scripts/package-graymatter')], { env: environment, stdio: 'pipe', timeout: 10000 });
    execFileSync('unzip', ['-q', archive, '-d', directory], { stdio: 'pipe' });
    const unpacked = join(directory, 'graymatter');
    assert.ok(existsSync(join(unpacked, 'LICENSE')));
    assert.match(execFileSync(process.execPath, [join(unpacked, 'scripts/gm-procedure-execute'), '--help'], { env: environment, encoding: 'utf8' }), /shadow-replay/);

    const child = spawn(process.execPath, [join(unpacked, 'scripts/gm-mcp-launcher.mjs'), '--stdio'], {
      cwd: unpacked, env: environment, stdio: ['pipe', 'pipe', 'pipe']
    });
    let stderr = '';
    const pending = new Map();
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', () => {});
    const lines = createInterface({ input: child.stdout });
    let nextId = 0;
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); clearTimeout(request.timer); request.resolve(message); }
    });
    child.on('exit', code => {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(`Packaged MCP exited ${code}: ${stderr}`)); }
      pending.clear();
    });
    t.after(async () => {
      lines.close();
      child.stdin.end();
      if (child.exitCode === null) {
        child.kill();
        await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1000).unref(); });
      }
    });
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Packaged ${method} stalled: ${stderr}`)); }, 5000);
      pending.set(id, { timer, resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    const initialized = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'packaged-download-test', version: '1' } });
    assert.ok(initialized.result?.capabilities?.tools);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const listed = await rpc('tools/list', {});
    for (const name of ['memory_put', 'memory_query', 'memory_link', 'memory_health']) {
      assert.ok(listed.result?.tools.some(tool => tool.name === name), name);
    }
    assert.equal(existsSync(events) ? readFileSync(events, 'utf8') : '', '');
    assert.equal(existsSync(join(directory, 'profiles.json')), false, 'Discovery must not create a credential profile');
  });
}
