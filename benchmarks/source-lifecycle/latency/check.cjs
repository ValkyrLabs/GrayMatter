'use strict';
// Verify both saved observations, recalculate the published percentiles, and print milliseconds.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const fixture = require('./fixture.json');
const sha = name => createHash('sha256').update(readFileSync(join(__dirname, name))).digest('hex');
function rank(rows, p) { return [...rows].sort((a, b) => a - b)[Math.ceil(rows.length * p) - 1]; }
const printable = [];
const controls = [];
const files = process.argv.slice(2);
assert.ok(files.length === 0 || files.length === 2, 'Usage: node check.cjs [v3.json v4.json]');
for (const [i, profile] of ['v3', 'v4'].entries()) {
  const obs = JSON.parse(readFileSync(files[i] || join(__dirname, profile + '.json'), 'utf8'));
  assert.equal(obs.profile, profile);
  assert.equal(obs.jarSha256, fixture.artifacts[profile]);
  assert.equal(obs.fixtureSha256, sha('fixture.json'));
  assert.equal(obs.runnerSha256, sha('probe.cjs'));
  assert.equal(obs.warmupPerRoute, fixture.warmupCycles);
  assert.equal(obs.measuredPerRoute, fixture.measuredCycles);
  assert.equal(obs.unit, 'microseconds');
  assert.equal(obs.percentile, 'nearest-rank');
  assert.deepEqual(obs.stages.map(stage => stage.ownerRows), fixture.scales);
  for (const stage of obs.stages) {
    assert.deepEqual(stage.eligibleRows, { narrow: Math.min(fixture.narrowRows, stage.ownerRows), wide: stage.ownerRows });
    for (const route of ['narrow', 'wide', 'healthBasic', 'healthAnonymous']) {
      const us = stage.rawUs[route];
      assert.equal(us.length, fixture.measuredCycles);
      assert.ok(us.every(value => Number.isSafeInteger(value) && value > 0));
      const p50Us = rank(us, 0.50), p95Us = rank(us, 0.95);
      assert.deepEqual(stage.stats[route], { n: us.length, p50Us, p95Us });
      printable.push({ version: profile, ownerRows: stage.ownerRows, route,
        n: us.length, p50ms: p50Us / 1000, p95ms: p95Us / 1000 });
    }
    const paired = (subject, control) => rank(stage.rawUs[subject].map(
      (latency, cycle) => latency - stage.rawUs[control][cycle]), 0.50) / 1000;
    controls.push({ version: profile, ownerRows: stage.ownerRows,
      narrowMinusBasicMs: paired('narrow', 'healthBasic'), wideMinusBasicMs: paired('wide', 'healthBasic'),
      basicMinusAnonymousMs: paired('healthBasic', 'healthAnonymous') });
  }
}
console.table(printable);
console.table(controls);
