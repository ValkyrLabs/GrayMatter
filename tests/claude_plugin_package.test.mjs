import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClaudePlugin, bundleFiles } from '../scripts/package-claude-plugin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const temporary = () => mkdtempSync(join(tmpdir(), 'graymatter-claude-test-'));

test('builds a small allowlisted bundle with exact canonical skills', () => {
  const result = buildClaudePlugin();
  assert.equal(result.files.length, 10);
  assert.ok(result.bytes < 1024 * 1024);
  for (const [source, destination] of bundleFiles) {
    assert.deepEqual(readFileSync(join(result.pluginRoot, destination)), readFileSync(join(root, source)));
  }
  for (const path of ['mcp-server', 'scripts', 'bin', '.app.json', '.codex-plugin', 'artifacts', 'node_modules']) {
    assert.equal(existsSync(join(result.pluginRoot, path)), false, path);
  }
});

test('connector uses only the canonical HTTPS endpoint and native OAuth', () => {
  const config = json(join(root, 'claude-plugin/.mcp.json'));
  assert.deepEqual(config, { mcpServers: { graymatter: {
    type: 'http', url: 'https://api-0.valkyrlabs.com/graymatter/mcp'
  } } });
  assert.equal(/Authorization|Bearer|password|secret|user_config|command|env/.test(JSON.stringify(config)), false);
});

test('manifest and marketplace preserve the product name, license and version', () => {
  const manifest = json(join(root, 'claude-plugin/.claude-plugin/plugin.json'));
  const marketplace = json(join(root, 'claude-plugin/.claude-plugin/marketplace.json'));
  assert.equal(manifest.name, 'graymatter');
  assert.equal(manifest.displayName, 'GrayMatter');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.license, 'AGPL-3.0-only');
  assert.equal(manifest.icon, './assets/icon.png');
  assert.equal(manifest.privacyPolicyUrl, 'https://valkyrlabs.com/v1/Legal/privacy/');
  assert.deepEqual(marketplace.plugins.map(p => [p.name, p.displayName, p.version, p.source]),
    [[manifest.name, manifest.displayName, manifest.version, './']]);
  for (const field of ['hooks', 'settings', 'userConfig', 'apps']) assert.equal(field in manifest, false);
});

test('README discloses behavior, destination, setup and privacy', () => {
  const text = readFileSync(join(root, 'claude-plugin/README.md'), 'utf8');
  assert.ok(text.split(/\s+/).length > 40);
  for (const value of ['OAuth', 'https://api-0.valkyrlabs.com/graymatter/mcp', 'privacy', 'retention', 'Support:', '/mcp', 'no\nexecutable hooks']) {
    assert.ok(text.includes(value), value);
  }
});

test('all bundled files meet the directory file limits and are regular files', () => {
  const { pluginRoot, files } = buildClaudePlugin();
  assert.ok(files.length <= 512);
  for (const file of files) {
    const stat = lstatSync(join(pluginRoot, file));
    assert.ok(stat.isFile());
    assert.ok(stat.size < (file.endsWith('.png') ? 5 * 1024 * 1024 : 256 * 1024));
    assert.equal(/(?:^|\/)(?:\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(?:$|\/)/.test(file), false);
  }
});

test('listing icon is a square PNG in the directory accepted size range', () => {
  const data = readFileSync(join(root, 'claude-plugin/assets/icon.png'));
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  assert.equal(width, height);
  assert.ok(width >= 512 && width <= 2048);
  assert.ok(data.length < 2 * 1024 * 1024);
});

test('refuses nonempty outputs without overwriting files', () => {
  const out = temporary();
  writeFileSync(join(out, 'keep.txt'), 'user data');
  assert.throws(() => buildClaudePlugin({ out }), /never overwritten/);
  assert.equal(readFileSync(join(out, 'keep.txt'), 'utf8'), 'user data');
});

test('refuses output in the source checkout', () => {
  assert.throws(() => buildClaudePlugin({ out: join(root, 'claude-plugin') }), /outside the source checkout/);
});

test('refuses symlink output without writing through it', () => {
  const base = temporary();
  mkdirSync(join(base, 'destination'));
  symlinkSync(join(base, 'destination'), join(base, 'link'));
  assert.throws(() => buildClaudePlugin({ out: join(base, 'link') }), /must not be a symlink/);
  assert.deepEqual(readdirSync(join(base, 'destination')), []);
});

test('refuses symlink source paths', () => {
  const base = temporary();
  const sourceRoot = join(base, 'source');
  mkdirSync(sourceRoot);
  for (const [source] of bundleFiles) {
    const target = join(sourceRoot, source);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, source), target);
  }
  const swapped = join(sourceRoot, 'LICENSE');
  // A separate fixture uses a linked parent, so no product source is modified.
  const linkedRoot = join(base, 'linked-source');
  mkdirSync(linkedRoot);
  symlinkSync(join(sourceRoot, 'claude-plugin'), join(linkedRoot, 'claude-plugin'));
  assert.ok(existsSync(swapped));
  assert.throws(() => buildClaudePlugin({ sourceRoot: linkedRoot, out: join(base, 'out') }), /Symlink is not allowed/);
});

test('refuses an output ancestor that aliases the source checkout', () => {
  const base = temporary();
  symlinkSync(root, join(base, 'source-alias'));
  const name = `claude-package-test-${basename(base)}`;
  assert.throws(() => buildClaudePlugin({ out: join(base, 'source-alias', name) }), /outside the source checkout/);
  assert.equal(existsSync(join(root, name)), false);
});

test('resolves a safe output ancestor before creating a new directory', () => {
  const base = temporary();
  mkdirSync(join(base, 'destination'));
  symlinkSync(join(base, 'destination'), join(base, 'alias'));
  const result = buildClaudePlugin({ out: join(base, 'alias', 'new', 'bundle') });
  assert.equal(result.pluginRoot, join(realpathSync(base), 'destination', 'new', 'bundle'));
  assert.ok(existsSync(join(result.pluginRoot, '.claude-plugin/plugin.json')));
});
