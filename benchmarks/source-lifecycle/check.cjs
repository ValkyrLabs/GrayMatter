'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createHash} = require('node:crypto');

function check(report) {
  const fixtureBytes = fs.readFileSync(require.resolve('./fixture.json'));
  assert.equal(report.fixtureSha256, createHash('sha256').update(fixtureBytes).digest('hex'));
  assert.equal(report.sdk, '@langchain/langgraph-checkpoint@1.2.2');
  assert.match(report.jarSha256, /^[0-9a-f]{64}$/);
  assert.match(report.driverSha256, /^[0-9a-f]{64}$/);
  const names = ['correction-deletion', 'stale-correction', 'two-writers', 'stale-delete', 'restore-identical'];
  const original = {exactTarget: 'original', search: ['neighbor/neighbor', 'target/original']};
  const corrected = {exactTarget: 'corrected', search: ['neighbor/neighbor', 'target/corrected']};
  const deleted = {exactTarget: null, search: ['neighbor/neighbor']};
  for (const surface of [report.langgraph, report.lite]) {
    assert.deepEqual(Object.keys(surface), names);
    assert.deepEqual(surface[names[0]].initial, original);
    assert.equal(surface[names[0]].neighbor, 'neighbor');
    assert.equal(surface[names[0]].retainedClientCopy, 'original');
  }
  const sdk = report.langgraph, gm = report.lite;
  const common = sdk[names[0]], local = gm[names[0]];
  assert.equal(common.correction, 'resolved');
  assert.equal(common.deletion, 'resolved');
  assert.deepEqual(common.afterCorrection, corrected);
  assert.deepEqual(common.afterDeletion, deleted);
  assert.equal(sdk['stale-correction'].final.exactTarget, 'late');
  assert.equal(sdk['stale-delete'].final.exactTarget, null);
  assert.deepEqual(sdk['two-writers'].writes, ['resolved', 'resolved']);
  assert.ok(['corrected', 'late'].includes(sdk['two-writers'].final.exactTarget));
  assert.equal(sdk['restore-identical'].afterFirst, 'corrected');
  assert.equal(sdk['restore-identical'].afterRestore, 'original');
  assert.equal(sdk['restore-identical'].final.exactTarget, 'late');

  const untouched = local.independentAfterDeletion;
  assert.equal(untouched.current, 'OK');
  assert.equal(untouched.hydration.neighbor.returned, 'neighbor');
  assert.deepEqual(untouched.fork.delivered, ['neighbor']);
  if (report.expectedBuild === 'before') {
    for (const status of [local.correction, local.deletion, ...gm['two-writers'].writes,
      gm['stale-correction'].delayed, gm['stale-delete'].delayed, gm['restore-identical'].restored]) {
      assert.ok([404,405].includes(status), 'expected pre-action surface to be unavailable');
    }
    assert.deepEqual(local.afterCorrection, original);
    assert.deepEqual(local.afterDeletion, original);
    assert.equal(local.originalAfterDeletion.current, 'OK');
    assert.equal(local.originalAfterDeletion.hydration.target.returned, 'original');
    return;
  }
  assert.equal(report.expectedBuild, 'after');
  assert.equal(local.correction, 200); assert.equal(local.deletion, 204);
  assert.deepEqual(local.afterCorrection, corrected); assert.deepEqual(local.afterDeletion, deleted);
  assert.ok(local.hashOnExactRead);
  for (const receipt of [local.originalAfterCorrection, local.originalAfterDeletion, local.secondAfterDeletion]) {
    assert.equal(receipt.recorded, 'OK');
    assert.equal(receipt.current, 'STALE_CONTEXT');
    assert.deepEqual(receipt.staleKeys, ['target']);
    assert.equal(receipt.hydration.neighbor.http, 409);
    assert.deepEqual(receipt.fork.delivered, []);
    assert.notEqual(receipt.fork.policy, 'ALLOW_ANSWER');
  }
  assert.equal(local.originalAfterCorrection.hydration.target.http, 409);
  assert.equal(local.originalAfterDeletion.hydration.target.http, 404);
  assert.equal(local.secondAfterDeletion.hydration.target.http, 404);
  for (const name of ['stale-correction','stale-delete']) {
    assert.equal(gm[name].preceding, 200); assert.equal(gm[name].delayed, 412);
    assert.equal(gm[name].final.exactTarget, 'corrected');
  }
  const concurrent = gm['two-writers'];
  assert.deepEqual([...concurrent.writes].sort(), [200,412]);
  assert.equal(concurrent.final.exactTarget, concurrent.writes[0] === 200 ? 'corrected' : 'late');
  const restore = gm['restore-identical'];
  assert.equal(restore.afterFirst, 'corrected'); assert.equal(restore.restored, 200);
  assert.equal(restore.afterRestore, 'original');
  assert.equal(restore.originalHashMatchesRestored, false);
  assert.equal(restore.originalReceipt.current, 'STALE_CONTEXT');
  assert.equal(restore.originalReceipt.hydration.target.http, 409);
  assert.deepEqual(restore.originalReceipt.fork.delivered, []);
  assert.equal(restore.delayed, 412); assert.equal(restore.final.exactTarget, 'original');
}

if (require.main === module) {
  const files = process.argv.slice(2);
  assert.ok(files.length, 'Pass at least one JSON capture');
  const reports = files.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const [index, report] of reports.entries()) {
    check(report);
    for (const field of ['sdk', 'node', 'fixtureSha256', 'driverSha256']) {
      assert.equal(report[field], reports[0][field], 'Different ' + field + ' across captures');
    }
    console.log('Verified', files[index]);
  }
}
module.exports = {check};
