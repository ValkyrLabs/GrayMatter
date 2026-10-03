import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const CLOUD_API_BASE = 'https://api-0.valkyrlabs.com/v1';
export const CONNECTION_CHOICES = [
  { label: 'GrayMatter Cloud (api-0)', apiBase: CLOUD_API_BASE, kind: 'hosted' },
  { label: 'Local GrayMatter Lite (localhost:8787)', apiBase: 'http://localhost:8787/v1', kind: 'local' },
  { label: 'Local ValkyrAI (localhost:8080)', apiBase: 'http://localhost:8080/v1', kind: 'hosted' },
  { label: 'Other self-hosted server', apiBase: '', kind: 'hosted' }
];

export function normalizeApiBase(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Enter a valid server URL, such as http://localhost:8787/v1.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS server URL without credentials, a query, or a fragment.');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Self-hosted servers outside localhost require HTTPS.');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '') || '/v1';
  return url.toString().replace(/\/+$/u, '');
}

export function registryFile(env = process.env) {
  return env.GRAYMATTER_PROFILES_FILE || path.join(env.GRAYMATTER_STATE_DIR || path.join(homedir(), '.graymatter'), 'profiles.json');
}

function registry(env) {
  const file = registryFile(env);
  if (!existsSync(file)) return { version: 1, mode: 'legacy', activeProfile: null, blendProfiles: [], profiles: {} };
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value.version !== 1 || !['legacy', 'single', 'blend'].includes(value.mode) || !value.profiles || typeof value.profiles !== 'object' || Array.isArray(value.profiles) || !Array.isArray(value.blendProfiles)) {
    throw new Error('The GrayMatter account profile registry is invalid. Repair it before signing in.');
  }
  return value;
}

export function resolveConnection(env = process.env, { preferSaved = false } = {}) {
  const value = registry(env);
  const requestedRoute = !preferSaved && Boolean(env.VALKYR_API_BASE || env.GRAYMATTER_PROFILE_RESOLVED === 'true');
  const name = (!preferSaved && (env.GRAYMATTER_ACTIVE_PROFILE || env.GRAYMATTER_PROFILE)) || (!requestedRoute && value.mode === 'single' ? value.activeProfile : '');
  const record = name ? value.profiles[name] : undefined;
  if (name && !record) throw new Error(`GrayMatter profile '${name}' is not configured.`);
  if (record && (typeof record.username !== 'string' || !record.username.trim() || typeof record.apiBase !== 'string' || !record.apiBase.trim())) {
    throw new Error(`GrayMatter profile '${name}' is missing its account or server binding.`);
  }
  const explicitRoute = requestedRoute && (!record || env.GRAYMATTER_PROFILE_RESOLVED === 'true');
  const apiBase = normalizeApiBase(explicitRoute ? env.VALKYR_API_BASE || record?.apiBase || CLOUD_API_BASE : record?.apiBase || CLOUD_API_BASE);
  const kind = (!preferSaved && env.GRAYMATTER_LIGHT_MODE === 'true') || (!explicitRoute && record?.kind === 'local') ? 'local' : 'hosted';
  if (env.GRAYMATTER_LOCAL_ONLY === 'true' && (kind !== 'local' || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(apiBase).hostname) || env.GRAYMATTER_PROFILES || env.GRAYMATTER_PROFILE_MODE === 'blend')) {
    throw new Error('This connection requires a local GrayMatter Lite profile on loopback. Run ./vaix setup in its source folder, then reconnect; hosted signup is not required.');
  }
  const scopedService = apiBase === CLOUD_API_BASE ? 'VALKYR_AUTH' : `GRAYMATTER_${createHash('sha256').update(apiBase).digest('hex').slice(0, 16)}`;
  return {
    apiBase, kind, profileName: name || '',
    username: (!explicitRoute && record?.username) || (!preferSaved && (env.GRAYMATTER_USERNAME || env.VALKYR_USERNAME)) || '',
    keychainService: (!explicitRoute && record?.keychainService) || (!preferSaved && env.VALKYR_KEYCHAIN_SERVICE) || scopedService,
    passwordFile: !explicitRoute ? record?.passwordFile || '' : '',
    password: (!preferSaved && env.GRAYMATTER_LIGHT_PASSWORD) || '',
    blended: Boolean(env.GRAYMATTER_PROFILES || env.GRAYMATTER_PROFILE_MODE === 'blend' || (!explicitRoute && value.mode === 'blend')),
    blendProfiles: env.GRAYMATTER_PROFILES || value.blendProfiles.join(',')
  };
}

export function connectionEnvironment(connection, env = process.env) {
  const next = { ...env, VALKYR_API_BASE: connection.apiBase };
  for (const name of ['GRAYMATTER_PROFILE', 'GRAYMATTER_ACTIVE_PROFILE', 'GRAYMATTER_PROFILE_MODE', 'GRAYMATTER_PROFILES', 'GRAYMATTER_BLEND_PROFILES', 'GRAYMATTER_PROFILE_RESOLVED']) delete next[name];
  if (connection.blended) {
    for (const name of ['VALKYR_AUTH_TOKEN', 'VALKYR_JWT_SESSION', 'VALKYR_AUTH']) delete next[name];
    return { ...next, GRAYMATTER_PROFILE_MODE: 'blend', GRAYMATTER_PROFILES: connection.blendProfiles, GRAYMATTER_SKIP_STARTUP_AUTH: 'true' };
  }
  if (connection.profileName) {
    for (const name of ['VALKYR_AUTH_TOKEN', 'VALKYR_JWT_SESSION', 'VALKYR_AUTH']) delete next[name];
    next.GRAYMATTER_PROFILE = connection.profileName;
    next.GRAYMATTER_ACTIVE_PROFILE = connection.profileName;
    next.GRAYMATTER_PROFILE_MODE = 'single';
  } else {
    next.GRAYMATTER_PROFILE_MODE = 'legacy';
    if (normalizeApiBase(env.VALKYR_API_BASE || CLOUD_API_BASE) !== connection.apiBase) {
      for (const name of ['VALKYR_AUTH_TOKEN', 'VALKYR_JWT_SESSION', 'VALKYR_AUTH']) delete next[name];
    }
  }
  next.GRAYMATTER_USERNAME = connection.username;
  next.VALKYR_USERNAME = connection.username;
  next.VALKYR_KEYCHAIN_SERVICE = connection.keychainService;
  next.VALKYR_USERNAME_KEYCHAIN_SERVICE = `${connection.keychainService}_USERNAME`;
  if (connection.kind === 'local') {
    next.GRAYMATTER_LIGHT_MODE = 'true';
    next.GRAYMATTER_LIGHT_USERNAME = connection.username;
    next.GRAYMATTER_LIGHT_PASSWORD = connection.password || (connection.passwordFile ? readFileSync(connection.passwordFile, 'utf8') : '');
    for (const name of ['VALKYR_AUTH_TOKEN', 'VALKYR_JWT_SESSION', 'VALKYR_AUTH']) delete next[name];
  } else {
    for (const name of ['GRAYMATTER_LIGHT_MODE', 'GRAYMATTER_LIGHT_USERNAME', 'GRAYMATTER_LIGHT_PASSWORD']) delete next[name];
  }
  return next;
}

// Profile routing is shared with gm-profile/gm-profile-lib. No session is stored
// in this registry; Lite's existing local-secret-file contract is retained.
export function saveConnection(connection, env = process.env) {
  const value = registry(env);
  const file = registryFile(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (connection.apiBase === CLOUD_API_BASE && !connection.profileName) {
    if (env.GRAYMATTER_KEYCHAIN_UPDATE_DEFAULT !== '0') {
      value.mode = 'legacy';
      value.activeProfile = null;
    }
  } else {
    const digest = createHash('sha256').update(`${connection.kind}:${connection.apiBase}:${connection.username}`).digest('hex').slice(0, 12);
    const name = connection.profileName || `connection-${digest}`;
    const now = new Date().toISOString();
    const previous = value.profiles[name];
    const record = {
      username: connection.username,
      accountFingerprint: `sha256:${createHash('sha256').update(connection.kind === 'local' ? `${connection.apiBase}|${connection.username}` : connection.username).digest('hex').slice(0, 12)}`,
      apiBase: connection.apiBase,
      createdAt: previous?.createdAt || now,
      updatedAt: now
    };
    if (connection.kind === 'local') {
      const passwordFile = previous?.passwordFile || path.join(path.dirname(file), 'secrets', `${name}.password`);
      mkdirSync(path.dirname(passwordFile), { recursive: true, mode: 0o700 });
      writeFileSync(passwordFile, connection.password, { mode: 0o600 });
      chmodSync(passwordFile, 0o600);
      Object.assign(record, { kind: 'local', passwordFile, keychainService: null });
    } else {
      record.keychainService = connection.keychainService;
    }
    value.profiles[name] = record;
    if (env.GRAYMATTER_KEYCHAIN_UPDATE_DEFAULT !== '0') {
      value.mode = 'single';
      value.activeProfile = name;
    }
    connection.profileName = name;
  }
  if (env.GRAYMATTER_KEYCHAIN_UPDATE_DEFAULT !== '0') value.blendProfiles = [];
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}
