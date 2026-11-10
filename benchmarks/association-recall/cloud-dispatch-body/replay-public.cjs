'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { discover, readResponse } = require('../../../mcp-server/lib/public-typed-path-discovery.cjs');
const { hydratePair, typedPairProjection } = require('../../../mcp-server/lib/public-context-compile.cjs');

const capture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(capture.schemaVersion, 'cloud-dispatch-body-capture/v1');
assert.equal(capture.requesterIdentity.organizationRole, 'org_member');

test('public typed adapter replays completed native body-discovery trials', async t => {
  const originalNow = Date.now;
  t.after(() => { Date.now = originalNow; });
  let completed = 0;
  for (const task of capture.cases) {
    for (const trial of task.trials) {
      const native = trial.typed_pair;
      if (native.status !== 'completed') continue;
      Date.now = () => Date.parse(native.planResponse.plan.createdAt);
      const calls = [
        ['POST', 'graymatter/omega/plan', native.planHttpStatus, native.planResponse],
        ['POST', 'graymatter/omega/tools/graph-expand', native.toolHttpStatus, native.toolResponse],
        ['GET', 'graymatter-retrieval-receipts/' + native.toolResponse.receiptRef,
          native.receiptHttpStatus, native.receiptResponse]
      ];
      let requestNumber = 0;
      const locator = await discover(async (method, route, body) => {
        const [expectedMethod, expectedRoute, status, response] = calls[requestNumber++];
        assert.deepEqual([method, route], [expectedMethod, expectedRoute]);
        assert.equal(status, 200);
        if (requestNumber === 1) {
          assert.equal(body.query, native.planRequest.query);
          assert.equal(body.mode, native.planRequest.mode);
          assert.equal(body.recipe, native.planRequest.recipe);
          for (const [key, value] of Object.entries(native.planRequest.budgets)) {
            assert.equal(body.budgets[key], value);
          }
        }
        if (requestNumber === 2) assert.deepEqual(body, native.toolRequest);
        const wrapped = new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } });
        return JSON.parse(await readResponse(wrapped, 'https://api.example.test/v1/' + route));
      }, { query: task.query, seedSource: 'content_body', maxLatencyMs: native.planRequest.budgets.maxLatencyMs });
      assert.equal(requestNumber, calls.length);
      assert.equal(locator.retrievalReceiptRef, native.receiptResponse.receipt.receiptId);
      assert.equal(locator.graymatterPolicy.answerAllowed, false);
      assert.equal(locator.graymatterPolicy.caveatRequired, true);
      assert.equal(locator.typedPathEndpoints.projection, 'not_returned');

      const preview = typedPairProjection(native.compileResponse, {
        task: task.query, retrievalReceiptRef: locator.retrievalReceiptRef, includeTypedPathEndpoints: true
      });
      const pageRef = preview.contextPage.pageRef;
      let hydrationCalls = 0;
      const { projection } = await hydratePair(async (method, route, body) => {
        hydrationCalls++;
        if (hydrationCalls === 1) {
          assert.deepEqual([method, route], ['GET', 'graymatter_ops/context_page/' + pageRef]);
          // The corpus captured the owning compile snapshot of this same page.
          return native.compileResponse;
        }
        assert.deepEqual([method, route], ['POST', 'graymatter_ops/context_page/hydrate']);
        assert.deepEqual(body, native.hydrateRequest);
        return native.hydrateResponse;
      }, { contextPageRef: pageRef, maxTokens: native.hydrateRequest.maxTokens });
      assert.equal(hydrationCalls, 2);
      assert.equal(projection.evidenceClaimScope, locator.evidenceClaimScope);
      assert.equal(projection.typedPathEndpoints.projection, 'exact_authorized_projection');
      assert.deepEqual(projection.endpoints.map(endpoint => endpoint.text).sort(),
        native.hydrateResponse.contextPage.items.map(item => item.summary).sort());
      completed++;
    }
  }
  assert.equal(completed, 56);
  t.diagnostic('56 native response sets replayed with the capture clock. The compile snapshot stands in for the pre-hydration GET.');
});
