'use strict';
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const {join} = require('node:path');
const fixture = require('./fixture.json');
const artifacts = require('./artifacts.json');
const hash = name => createHash('sha256').update(readFileSync(join(__dirname, name))).digest('hex');
const percentile = (rows, fraction) => [...rows].sort((a,b) => a-b)[Math.ceil(rows.length*fraction)-1];
const files = process.argv.slice(2);
assert.ok(files.length >= 2, 'Usage: node check.cjs baseline.json optimized.json [additional-runs.json...]');
let common;
const rows = [];
for (const file of files) {
  const observation = JSON.parse(readFileSync(file));
  assert.ok(['baseline','optimized'].includes(observation.profile));
  assert.match(observation.jarSha256, /^[a-f0-9]{64}$/);
  assert.equal(observation.jarSha256, artifacts[observation.profile], 'Artifact digest differs from reviewed build');
  assert.equal(observation.fixtureSha256, hash('fixture.json'));
  assert.equal(observation.runnerSha256, hash('probe.cjs'));
  assert.equal(observation.measuredPerRoute, fixture.measuredCycles);
  assert.equal(observation.warmupPerRoute, fixture.warmupCycles);
  assert.equal(observation.unit, 'microseconds');
  assert.equal(observation.percentile, 'nearest-rank');
  assert.deepEqual(observation.stages.map(s => s.ownerRows), fixture.scales);
  const runtime = [observation.node, observation.java, observation.cpu, observation.os];
  if (common) assert.deepEqual(runtime, common);
  common = runtime;
  for (const stage of observation.stages) {
    assert.deepEqual(stage.eligibleRows, {narrow: Math.min(fixture.narrowRows, stage.ownerRows), wide: stage.ownerRows});
    for (const route of ['narrow','wide','healthBasic','healthAnonymous']) {
      const data = stage.rawUs[route];
      assert.equal(data.length, fixture.measuredCycles);
      assert.ok(data.every(x => Number.isSafeInteger(x) && x > 0));
      const p50Us = percentile(data,.5), p95Us = percentile(data,.95);
      assert.deepEqual(stage.stats[route], {n:data.length,p50Us,p95Us});
      rows.push({file,profile:observation.profile,ownerRows:stage.ownerRows,route,n:data.length,p50ms:p50Us/1000,p95ms:p95Us/1000});
    }
  }
}
console.table(rows);
