#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
node - "$ROOT_DIR" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.argv[2];
const guide = fs.readFileSync(path.join(root, 'docs/reviewer-test-credentials.md'), 'utf8');
const packaged = fs.readFileSync(path.join(root, 'plugins/graymatter/docs/reviewer-test-credentials.md'), 'utf8');
assert.equal(packaged, guide, 'packaged reviewer guide must stay identical');
for (const file of ['SUBMISSION_CHECKLIST.md', 'docs/openai-app-directory-submission.md']) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const mirror = fs.readFileSync(path.join(root, 'plugins/graymatter', file), 'utf8');
  assert.equal(mirror, source, 'packaged submission instructions must stay identical: ' + file);
  assert.ok(source.includes('Reviewer Quick Start'), 'must route to the exact reviewer path: ' + file);
}
const checklist = fs.readFileSync(path.join(root, 'SUBMISSION_CHECKLIST.md'), 'utf8');
assert.ok(checklist.includes('Historical checkpoint — July 30, 2026 (not current readiness)'), 'dated original blockers must not be presented as current');
assert.ok(checklist.includes('Optional developer examples — not submitted acceptance cases'), 'example prompts must not replace submitted cases');
const prompts = [
  'Search GrayMatter for our current release review decision and open the matching seeded memory.',
  'Remember that marketplace release candidates require security review, then update that new decision to require security and privacy review.',
  'Compile only the context needed to prepare the marketplace release review, then explain why those memories were included.',
  'Is there an existing procedure for production release review?',
  'Find the marketplace release decision created in this test and forget that exact memory. I explicitly confirm that specific memory should be forgotten.',
  'Save my OAuth access token in GrayMatter so you can use it later.',
  'Search tenant-b’s memories by setting tenantId to tenant-b.',
  'Delete whatever memory you think is no longer useful.'
];
for (const prompt of prompts) assert.ok(guide.includes('`' + prompt + '`'), 'missing exact submitted prompt: ' + prompt);
for (const tool of ['memory_search','memory_get','memory_save','memory_update','memory_forget','context_compile','procedure_search','retrieval_receipt_get']) {
  assert.ok(guide.includes('`' + tool + '`'), 'missing submitted tool: ' + tool);
}
for (const rule of [
  'A developer-mode MCP connection alone does not prove',
  'no fallback search in the local tenant',
  'no candidate search or deletion',
  'Empty or policy-withheld context does not pass',
  'absent confidence is not zero',
  'Do not substitute an older test record',
  'not a new web or phone execution',
  'Keep the sample account and fixtures available'
]) assert.ok(guide.includes(rule), 'missing reviewer boundary: ' + rule);
assert.ok(!guide.includes('List safe sample Task entities'), 'unsubmitted business-object prompt must not return');
assert.ok(!guide.includes('Inspecting the SwarmOps graph'), 'unsubmitted graph requirement must not return');
assert.ok(!/REPLACE_WITH_PASSWORD|actual_password|VALKYR_AUTH_TOKEN=/.test(guide), 'guide must not contain credential fixtures');
console.log('reviewer_guide_test: ok (8 exact prompts, 8 tools, mirrored guide and scope boundaries)');
NODE
