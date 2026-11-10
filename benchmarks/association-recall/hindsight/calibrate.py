"""Separate native graph-arm positive control; not part of the matched fixture."""
import argparse
import asyncio
import errno
import json
from pathlib import Path
import socket
import time

from run import compact, native_command, sha


async def test(output, database_url, source_case):
    from hindsight_api.engine.memory_engine import MemoryEngine
    from hindsight_api.engine.response_models import Budget
    from hindsight_api.models import RequestContext
    engine = MemoryEngine(db_url=database_url, pool_min_size=1, pool_max_size=4)
    try:
        await engine.initialize()
        rows = [{'key':f'anchor-{i}', 'text':source_case['rows'][0]['text']} for i in range(20)]
        rows.append(next(r for r in source_case['rows'] if r['key']=='answer'))
        ids = await engine.retain_batch_async('calibration', [
            {'content':r['text'], 'document_id':r['key'],
             'entities':[{'text':'calibration_shared_entity'}], 'resolve_entities':False}
            for r in rows], request_context=RequestContext())
        assert len(ids)==21 and all(len(x)==1 for x in ids)
        known = {str(x[0]):row['key'] for x,row in zip(ids,rows)}
        results={}
        for enabled in (False, True):
            await engine.update_bank_config('calibration', {'enable_graph_retrieval':enabled,
                'enable_temporal_retrieval':False}, request_context=RequestContext())
            start=time.perf_counter_ns()
            result=await engine.recall_async('calibration',source_case['query'],budget=Budget.LOW,
                max_tokens=2048, fact_type=['world'],enable_trace=True,request_context=RequestContext())
            results[str(enabled)]=compact(result,known,(time.perf_counter_ns()-start)/1_000_000)
        answer_id=next(k for k,v in known.items() if v=='answer')
        answer=next(s for s in results['True']['nativeScores'] if s['id']==answer_id)
        assert answer['semantic_rank']==21, answer
        assert results['False']['retrievalCounts']['graph_count']==0
        assert results['True']['retrievalCounts']['graph_count']>=1
        (output/'calibration.json').write_text(json.dumps({
            'classification':'Separate graph-arm calibration; twenty duplicate high-similarity seeds and one supplied neighbor. No task-quality or unique-experience claim.',
            'query':source_case['query'],'rows':rows,'sourceIds':known,
            'results':results,'nativeGraphPositive':True,
            'fixtureSha256':sha(Path(__file__).parent.parent/'fixture.json'),
        },indent=2)+'\n')
        print('CALIBRATION_NATIVE_GRAPH_POSITIVE',results['True']['retrievalCounts'],flush=True)
    finally:
        await engine.close()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--setup',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    args=parser.parse_args()
    output=args.output_dir.resolve()
    probe=socket.socket();probe.settimeout(1)
    try:
        probe.connect(('192.0.2.1',443));raise AssertionError('Network escape')
    except PermissionError as exc:
        assert exc.errno==errno.EPERM
    finally:
        probe.close()
    case=json.loads((Path(__file__).parent.parent/'fixture.json').read_text())['cases'][0]
    pg=args.setup.resolve()/'embedded/postgresql-18.1.0-aarch64-apple-darwin/bin'
    data=output/'data';sockets=output/'socket';sockets.mkdir()
    native_command(pg/'initdb','-D',data,'-U','hindsight','--auth=trust','--no-locale','-E','UTF8')
    started=False
    try:
        native_command(pg/'pg_ctl','-D',data,'-l',output/'postgres.log','-o',
            f"-k {sockets} -h '' -p 55491 -c max_connections=16 -c shared_buffers=32MB",'-w','start')
        started=True
        native_command(pg/'createdb','-h',sockets,'-p','55491','-U','hindsight','hindsight')
        asyncio.run(test(output,f'postgresql://hindsight@/hindsight?host={sockets}&port=55491',case))
    finally:
        if started:native_command(pg/'pg_ctl','-D',data,'-m','fast','-w','stop')


if __name__=='__main__':
    main()
