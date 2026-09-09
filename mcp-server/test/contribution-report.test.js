'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contributionReport } = require('../lib/contribution-report.cjs');

test('write verification never counts as reuse; replayed observations are deduplicated', async () => {
  const thor_verification = { observationId: 'read1', memoryId: 'memory1', purpose: 'write_verification' };
  const thor_report = await contributionReport(() => { throw new Error('unexpected API read'); }, {
    observations: [thor_verification, thor_verification,
      { observationId: 'read2', memoryId: 'memory1', purpose: 'reuse', taskRef: 'later-task' }]
  });
  assert.deepEqual(thor_report.observedReadCounts, { inspection: 0, write_verification: 1, reuse: 1 });
  assert.equal(thor_report.distinctMemoryIds, 1);
  assert.equal(thor_report.duplicateObservationsRemoved, 1);
  assert.equal(thor_report.linkedEvidenceChains, 0);
  assert.deepEqual(Object.values(thor_report.measuredImpact), [null, null, null, null]);
});

test('builds content-free chains only from authenticated trajectory responses', async () => {
  const thor_report = await contributionReport(async thor_endpoint => {
    assert.equal(thor_endpoint, 'graymatter/omega/trajectories/t1');
    return { trajectory: { trajectoryId: 't1', receiptRef: 'r1', actionRef: 'decision1',
      outcomeRef: 'commit1', testRef: 'test1', outcome: 'success', outcomeHash: 'a'.repeat(64) },
    steps: [{ evidenceRefs: ['memory:one'] }, { evidenceRefs: ['memory:one'] }] };
  }, { trajectoryIds: ['t1', 't1'] });
  assert.equal(thor_report.authorizedTrajectories, 1);
  assert.equal(thor_report.linkedEvidenceChains, 1);
  assert.deepEqual(thor_report.chains[0].evidenceRefs, ['memory:one']);
  assert.equal(thor_report.observedReadCounts.reuse, 0);
});

test('authorization errors and conflicting classifications fail closed', async () => {
  await assert.rejects(contributionReport(async () => { throw new Error('denied'); }, { trajectoryIds: ['t1'] }));
  await assert.rejects(contributionReport(async () => ({}), { observations: [
    { observationId: 'a', memoryId: 'm', purpose: 'reuse' },
    { observationId: 'a', memoryId: 'm', purpose: 'write_verification' }
  ] }));
});

test('a success without linked evidence cannot produce a complete contribution chain', async () => {
  const thor_report = await contributionReport(async () => ({
    trajectory: { trajectoryId: 't1', outcome: 'success' }, steps: []
  }), { trajectoryIds: ['t1'] });
  assert.equal(thor_report.linkedEvidenceChains, 0);
  assert.equal(thor_report.measuredImpact.defectsPrevented, null);
});
