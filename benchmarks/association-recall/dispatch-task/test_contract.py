"""Consumer and independent judge controls, including non-corpus values."""
import copy
import json
import unittest
from consumer import execute
from corpus import fixture
from judge import oracle, score


class ContractTest(unittest.TestCase):
    def test_all_full_authorized_populations(self):
        for case in fixture()['cases']:
            sources = [{'id':r['key'], 'text':r['text']} for r in case['rows'] if not r.get('sourceSuffix')]
            out = execute(case['shipmentId'], sources)
            self.assertTrue(score(case, out, [s['id'] for s in sources])['correct'], case['id'])

    def test_unseen_literal_values(self):
        fact = {'schema':'dispatch-fact/v1','shipmentId':'unseen','pickupCode':'blizzard-207','gate':'south','packingSymbol':'hexagon'}
        out = execute('unseen',[{'id':'s','text':'FACT '+json.dumps(fact)}])
        self.assertEqual(out['packet'],{k:v for k,v in fact.items() if k!='schema'})

    def test_duplicate_fields_and_unknown_fields(self):
        for text in ['FACT {"schema":"dispatch-fact/v1","shipmentId":"a","shipmentId":"b"}',
                     'FACT {"schema":"dispatch-fact/v1","shipmentId":"a","owner":"admin"}']:
            self.assertEqual(execute('a',[{'id':'s','text':text}])['status'],'invalid_evidence')

    def test_policy_and_budget_do_not_emit_packets(self):
        self.assertIsNone(execute('a', [], permitted=False)['packet'])
        self.assertEqual(execute('a',[{'id':'s','text':'x'*1025}])['status'],'budget_exceeded')

    def test_missing_conflict_wrong_citation_and_oracle_tamper(self):
        case = fixture()['cases'][2]
        self.assertFalse(score(case,execute(case['shipmentId'],[]),[])['correct'])
        sources=[{'id':r['key'],'text':r['text']} for r in case['rows']]
        out=execute(case['shipmentId'],sources)
        bad=copy.deepcopy(out); bad['citations']['gate']=['invented']
        self.assertFalse(score(case,bad,['anchor','detail'])['correct'])
        bad=copy.deepcopy(out); bad['packet']['gate']='invented'
        self.assertFalse(score(case,bad,['anchor','detail'])['correct'])


if __name__=='__main__': unittest.main()
