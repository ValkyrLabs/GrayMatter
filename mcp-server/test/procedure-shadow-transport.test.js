'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scripts = path.resolve(__dirname, '../../scripts');
const input = { candidateRef: 'skillcand-transport', baselineCapsuleRef: 'skillxp-baseline' };
const endpoint = '/skillopt_ops/candidates/skillcand-transport/replay-executions';
const accepted = { ...input, status: 'accepted', experimentRef: 'omega-exp-synthetic',
  mechanizationReceiptRef: 'skillmech-synthetic', routeReceiptRef: 'route-synthetic', selectedRoute: 'run_workflow',
  workflowExecutionId: '11111111-1111-4111-8111-111111111111', workflowVersionId: '22222222-2222-4222-8222-222222222222',
  taskDigest: 'a'.repeat(64) };

// Keep the CLI and shared transport real. Replace curl, login and the credential store with
// local executables. The trace contains event names only and never records credentials.
function transportFixture(t, denial) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-shadow-transport-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const trace = path.join(directory, 'trace');
  function executable(name, body) {
    const filename = path.join(directory, name);
    fs.writeFileSync(filename, '#!' + process.execPath + '\n' + body, { mode: 0o700 });
    return filename;
  }
  executable('security', 'process.exit(1);');
  const login = executable('login', `
    require('node:fs').appendFileSync(process.env.TRACE, 'LOGIN\\n');
    process.stdout.write('export VALKYR_AUTH_TOKEN=refreshed-synthetic-token\\n');
  `);
  executable('curl', `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    const afterDenial = fs.existsSync(process.env.TRACE);
    if (!args.includes('POST') || !args.includes(process.env.VALKYR_API_BASE + process.env.ENDPOINT)) process.exit(9);
    fs.appendFileSync(process.env.TRACE, 'POST\\n');
    fs.writeFileSync(args[args.indexOf('-o') + 1], afterDenial ? process.env.ACCEPTED : '{}');
    fs.writeFileSync(args[args.indexOf('-D') + 1], '');
    process.stdout.write(afterDenial ? '200' : process.env.DENIAL);
  `);
  return {
    trace: () => fs.readFileSync(trace, 'utf8').trim().split('\n'),
    options: { encoding: 'utf8', timeout: 10000, input: JSON.stringify(input),
      env: {
        PATH: directory + path.delimiter + process.env.PATH, TRACE: trace, TMPDIR: directory,
        GRAYMATTER_TMPDIR: directory, GRAYMATTER_PROFILE_RESOLVED: 'true', GRAYMATTER_USERNAME: 'synthetic',
        GRAYMATTER_XSRF_TOKEN: 'synthetic-xsrf', VALKYR_AUTH_TOKEN: 'initial-synthetic-token',
        GRAYMATTER_LOGIN_COMMAND: login, GRAYMATTER_SKIP_AUTO_REPLAY: 'true', GRAYMATTER_SKIP_DEFERRED: 'true',
        VALKYR_API_BASE: 'http://127.0.0.1:1/v1', ENDPOINT: endpoint, DENIAL: String(denial), ACCEPTED: JSON.stringify(accepted)
      }
    }
  };
}

for (const denial of [401, 403]) {
  test(`real shadow replay transport sends one business POST after HTTP ${denial}`, t => {
    const fixture = transportFixture(t, denial);
    const result = spawnSync(process.execPath, [path.join(scripts, 'gm-procedure-execute'), 'shadow-replay'], fixture.options);
    assert.ifError(result.error);
    assert.deepEqual(fixture.trace(), ['POST']);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).error.code, 'SHADOW_REPLAY_OUTCOME_UNKNOWN');
  });
}

test('shared transport still recovers credentials and reissues by default', t => {
  const fixture = transportFixture(t, 401);
  const result = spawnSync('bash', [path.join(scripts, 'graymatter_api.sh'), 'POST', endpoint,
    JSON.stringify({ baselineCapsuleRef: input.baselineCapsuleRef })], fixture.options);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'accepted');
  assert.deepEqual(fixture.trace(), ['POST', 'LOGIN', 'POST']);
});
