"""Validator-only tests. Synthetic request envelopes are never benchmark observations."""
import copy
import hashlib
import json
import os
from pathlib import Path
import unittest

import score
from check import verify_controls

HERE = Path(__file__).parent
FROZEN = Path(os.environ['DISPATCH_FROZEN'])
ACTUAL = Path(os.environ['DISPATCH_PRIOR_NATIVE'])
PRIOR_HASH = 'd61748183624d3f90280596f18bd00715c4a652aad6e9bfadd734260935d8105'


class CaptureValidationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert score.digest(ACTUAL) == PRIOR_HASH
        cls.prior = json.loads(ACTUAL.read_text())
        cls.fixture = json.loads((FROZEN / 'fixture.json').read_text())
        cls.cases = {row['id']: row for row in cls.fixture['cases']}

    def pair(self, index=0):
        row = copy.deepcopy(self.prior['observations'][index])
        case = self.cases[row['case']]
        bindings = {}
        for entry in case['rows']:
            key = entry['key']
            bindings[key] = {'nativeId': row['discovery']['id' if key == 'anchor' else 'contentDataId'],
                'schemaName': 'ContentMediaLink' if key == 'anchor' else 'ContentData',
                'field': 'fileName' if key == 'anchor' else 'title',
                'excluded': bool(entry.get('sourceSuffix')),
                'textSha256': hashlib.sha256(entry['text'].encode()).hexdigest()}
        setup = {'status': 'ready', 'bindings': bindings, 'linked': True,
                 'freeLinkLabelsRetainedAsAuthority': False}
        receipt = row['receipt']
        raw = {'status': 'completed', 'attempted': True, 'elapsedNanos': row['elapsedNanos'],
            'planRequest': score.expected_plan(case['query']), 'planHttpStatus': 200, 'planResponse': row['plan'],
            'toolRequest': score.expected_tool(case['query'], receipt['planRef'], 'typed_pair'),
            'toolHttpStatus': 200, 'toolResponse': row['toolResponse'],
            'receiptHttpStatus': 200, 'receiptResponse': {'receipt': receipt},
            'compileRequest': {'taskIntent': case['query'], 'retrievalReceipt': {'id': receipt['id']},
                'includeTypedPathEndpoints': True, 'tokenBudget': 1024},
            'compileHttpStatus': 200, 'compileResponse': row['compiledPage'],
            'hydrateRequest': {'contextPageRef': row['compiledPage']['contextPage']['pageRef'],
                'maxItems': 2, 'maxTokens': 1024},
            'hydrateHttpStatus': 200, 'hydrateResponse': row['hydratedPage']}
        return case, setup, raw

    def reject(self, mutator):
        case, setup, raw = self.pair()
        mutator(setup, raw)
        with self.assertRaises((AssertionError, KeyError)):
            score.extract(case, setup, raw, 'typed_pair', self.prior)

    def test_previous_real_pair_values_survive_unchanged(self):
        consumer = score.module('test_frozen_consumer', FROZEN / 'consumer.py')
        judge = score.module('test_frozen_judge', FROZEN / 'judge.py')
        for index in (0, 1):
            case, setup, raw = self.pair(index)
            sources, permitted, available, boundary = score.extract(case, setup, raw, 'typed_pair', self.prior)
            self.assertTrue(permitted and available)
            self.assertEqual(boundary, 'current_typed_pair')
            output = consumer.execute(case['shipmentId'], sources, permitted)
            self.assertTrue(judge.score(case, output, [s['id'] for s in sources])['correct'])

    def test_rejects_planted_seed(self):
        self.reject(lambda setup, raw: raw['toolRequest'].update(seedIds=[setup['bindings']['anchor']['nativeId']]))

    def test_rejects_changed_budget(self):
        self.reject(lambda setup, raw: raw['planRequest']['budgets'].update(maxLatencyMs=10000))

    def test_rejects_changed_query(self):
        self.reject(lambda setup, raw: raw['toolRequest'].update(query='query-free answer'))

    def test_rejects_readback_owner_swap(self):
        self.reject(lambda setup, raw: raw['receiptResponse']['receipt'].update(ownerId=setup['bindings']['anchor']['nativeId']))

    def test_rejects_readback_plan_swap(self):
        self.reject(lambda setup, raw: raw['receiptResponse']['receipt'].update(planRef='another-plan'))

    def test_rejects_downgraded_policy(self):
        self.reject(lambda setup, raw: raw['receiptResponse']['receipt'].update(answerPolicy='ALLOW_ANSWER'))

    def test_rejects_false_native_source_hash(self):
        self.reject(lambda setup, raw: setup['bindings']['anchor'].update(textSha256='0' * 64))

    def test_rejects_substituted_projection(self):
        self.reject(lambda setup, raw: raw['hydrateResponse']['contextPage']['items'][0].update(summary='different text'))

    def test_rejects_changed_source_revision(self):
        self.reject(lambda setup, raw: raw['hydrateResponse']['contextPage']['hydrationPointers'][0].update(sourceVersion='graph-projection:' + '0' * 64))

    def test_rejects_disclosed_excluded_source(self):
        case, setup, raw = self.pair()
        case = copy.deepcopy(case)
        case['rows'][1]['sourceSuffix'] = 'excluded'
        setup['bindings']['detail']['excluded'] = True
        with self.assertRaises(AssertionError):
            score.extract(case, setup, raw, 'typed_pair', self.prior)

    def unavailable_matrix(self):
        result = {'schemaVersion': 'cloud-dispatch-full-capture/v1',
            'protocolSha256': score.digest(HERE / 'protocol.json'),
            'fixtureSha256': score.FROZEN['fixture.json'],
            'actorId': self.prior['actorId'], 'tenantId': self.prior['tenantId'],
            'requesterIdentity': copy.deepcopy(self.prior['requesterIdentity']),
            'cases': []}
        for case in self.fixture['cases']:
            phases = {}
            for phase, count in (('warmups', 2), ('trials', 7)):
                phases[phase] = [{'iteration': i, **{arm: {'status': 'setup_unavailable', 'attempted': False,
                    'elapsedNanos': 0} for arm in score.ARMS}} for i in range(count)]
            result['cases'].append({'id': case['id'], 'query': case['query'], 'shipmentId': case['shipmentId'],
                'setup': {'status': 'setup_error'}, **phases})
        return result

    def test_unavailable_matrix_retains_all_twelve_without_abstention_credit(self):
        observed = score.evaluate(self.unavailable_matrix(), HERE / 'protocol.json', FROZEN)
        self.assertEqual(len(observed['cases']), 12)
        for arm in score.ARMS:
            self.assertEqual(observed['summary'][arm]['assignedTasks'], 12)
            self.assertEqual(observed['summary'][arm]['availableTasks'], 0)
            self.assertEqual(observed['summary'][arm]['correctTasks'], 0)

    def test_rejects_dropped_case(self):
        capture = self.unavailable_matrix()
        capture['cases'].pop()
        with self.assertRaises(AssertionError):
            score.evaluate(capture, HERE / 'protocol.json', FROZEN)

    def test_rejects_dropped_repetition(self):
        capture = self.unavailable_matrix()
        capture['cases'][0]['trials'].pop()
        with self.assertRaises(AssertionError):
            score.evaluate(capture, HERE / 'protocol.json', FROZEN)

    def test_rejects_native_error_credit(self):
        case, setup, raw = self.pair()
        raw.update(status='runtime_error', compileHttpStatus=500)
        self.assertFalse(score.extract(case, setup, raw, 'typed_pair', self.prior)[2])

    def source_only(self):
        # Synthetic ENTITY envelope for validator testing, never a runtime observation.
        case, setup, raw = self.pair()
        receipt = raw['receiptResponse']['receipt']
        selected = receipt['items'][0]
        selected['entityType'] = 'ContentMediaLink'
        selected['entityId'] = setup['bindings']['anchor']['nativeId']
        selected['graphPathCitations'] = [{'queryMode': 'ENTITY', 'hopCount': 0, 'edges': [],
            'seed': {'entityId': selected['entityId']}, 'target': {'entityId': selected['entityId']}}]
        raw['toolRequest'] = score.expected_tool(case['query'], receipt['planRef'], 'source_only')
        raw['readRequest'] = {'planId': receipt['planRef'], 'query': case['query'],
            'searchReceiptRef': receipt['receiptId'], 'sourceRef': selected['memoryId'],
            'maxBytes': 4096, 'maxTokens': 1024}
        raw['readHttpStatus'] = 200
        raw['readResponse'] = {'planRef': receipt['planRef'], 'searchReceiptRef': receipt['receiptId'],
            'sourceRef': selected['memoryId'], 'entityId': selected['entityId'], 'entityType': 'ContentMediaLink',
            'status': 'OK', 'truncated': False,
            'structuredFields': {'fileName': next(r['text'] for r in case['rows'] if r['key'] == 'anchor')}}
        return case, setup, raw

    def test_selected_entity_read_failure_has_no_correct_abstention_credit(self):
        for status in (403, 404, 409):
            case, setup, raw = self.source_only()
            raw.update(status='native_denied', readHttpStatus=status, readResponse={})
            sources, permitted, available, boundary = score.extract(case, setup, raw, 'source_only', self.prior)
            self.assertEqual(sources, [])
            self.assertFalse(permitted or available)
            self.assertEqual(boundary, 'source_read_unavailable')

    def test_generated_read_retains_canonical_synthetic_source_ref(self):
        case, setup, raw = self.source_only()
        sources, permitted, available, boundary = score.extract(case, setup, raw, 'source_only', self.prior)
        self.assertTrue(available)
        self.assertEqual(sources[0]['id'], 'anchor')
        raw['readResponse']['sourceRef'] = 'ContentMediaLink:' + setup['bindings']['anchor']['nativeId']
        with self.assertRaises(AssertionError):
            score.extract(case, setup, raw, 'source_only', self.prior)

    def test_empty_receipt_with_graph_provider_exception_has_no_abstention_credit(self):
        for arm in score.ARMS:
            case, setup, raw = self.source_only() if arm == 'source_only' else self.pair()
            raw['status'] = 'native_withheld'
            receipt = raw['receiptResponse']['receipt']
            receipt['items'] = []
            receipt['policy']['policyNotes'].append('omega_provider_failure=graph:AccessDeniedException')
            result = score.extract(case, setup, raw, arm, self.prior)
            self.assertEqual(result, ([], False, False, 'graph_provider_unavailable'))

    def test_genuine_empty_receipt_without_provider_exception_can_abstain(self):
        case, setup, raw = self.pair()
        raw['status'] = 'native_withheld'
        raw['receiptResponse']['receipt']['items'] = []
        self.assertEqual(score.extract(case, setup, raw, 'typed_pair', self.prior),
                         ([], False, True, 'empty_current_receipt'))

    def test_revocation_checks_require_denial_and_same_receipt(self):
        rows = [{'control': name, 'receiptRef': 'receipt', 'pageRef': 'page',
            'receiptHttpStatus': 409, 'hydrateHttpStatus': 409}
            for name in ('effective_read_denied', 'merge_revoked')]
        capture = {'controls': rows, 'cases': [{'trials': [{'typed_pair': {
            'status': 'completed', 'toolResponse': {'receiptRef': 'receipt'},
            'hydrateResponse': {'contextPage': {'pageRef': 'page'}}}}]}]}
        self.assertTrue(verify_controls(capture)['qualified'])
        rows[0]['hydrateHttpStatus'] = 200
        with self.assertRaises(AssertionError):
            verify_controls(capture)


if __name__ == '__main__':
    unittest.main()
