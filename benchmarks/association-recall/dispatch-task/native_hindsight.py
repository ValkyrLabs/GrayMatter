"""Real MemoryEngine retain/recall with the previously pinned offline embedding."""
import argparse
import asyncio
import hashlib
import importlib.util
import importlib.metadata
import json
from pathlib import Path
import resource
import socket
import sys
import time

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('prior_hindsight_probe',HERE.parent/'hindsight/run.py')
helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)


async def exercise(setup,output,url):
    from hindsight_api.engine.memory_engine import MemoryEngine
    from hindsight_api.engine.response_models import Budget
    from hindsight_api.models import RequestContext
    engine=MemoryEngine(db_url=url,pool_min_size=1,pool_max_size=4)
    cases=[]
    try:
        await engine.initialize()
        for index,case in enumerate(json.loads((HERE/'fixture.json').read_text())['cases']):
            bank=f'dispatch-{index}'
            names=helpers.entity_names(case)
            mapping={}
            for suffix in sorted({r.get('sourceSuffix','') for r in case['rows']}):
                rows=[r for r in case['rows'] if r.get('sourceSuffix','')==suffix]
                group=bank+('-'+suffix if suffix else '')
                items=[{'content':r['text'],'document_id':r['key'],'tags':r.get('tags',[]),
                        'metadata':{'fixture_key':r['key'],'original_links':json.dumps(case['links'],separators=(',',':'))},
                        'entities':[{'text':n} for n in names[r['key']]],'resolve_entities':False} for r in rows]
                ids=await engine.retain_batch_async(group,items,request_context=RequestContext())
                for row,found in zip(rows,ids):
                    assert len(found)==1
                    mapping[row['key']]={'id':str(found[0]),'bank':group}
            lookup={v['id']:k for k,v in mapping.items()}
            sources={k:await engine.get_memory_unit(v['bank'],v['id'],RequestContext()) for k,v in mapping.items()}
            for row in case['rows']:assert sources[row['key']]['text']==row['text']
            trials=[]
            for iteration in range(9):
                trial={}
                for arm,enabled in [('control',False),('treatment',True)]:
                    await engine.update_bank_config(bank,{'enable_graph_retrieval':enabled,'enable_temporal_retrieval':False},request_context=RequestContext())
                    start=time.perf_counter_ns()
                    result=await engine.recall_async(bank,case['query'],budget=Budget.LOW,max_tokens=1024,
                        fact_type=['world'],enable_trace=True,request_context=RequestContext())
                    elapsed=(time.perf_counter_ns()-start)/1e6
                    data=helpers.compact(result,lookup,elapsed)
                    trial[arm]={'sources':[{'id':lookup[r['id']],'nativeId':r['id'],'text':r['text']} for r in data['result']['results']],
                                'permitted':True,'elapsedMs':elapsed,'native':data}
                if iteration>=2:trials.append(trial)
            cases.append({'id':case['id'],'trials':trials,'sourceReads':sources,'mapping':mapping})
            print('CASE',case['id'],flush=True)
        backend=await engine._get_backend()
        async with backend.acquire() as conn:
            version=await conn.fetchval('SELECT version()')
            extensions=[dict(r) for r in await conn.fetch('SELECT extname,extversion FROM pg_extension ORDER BY extname')]
        observed={'product':'Hindsight','cases':cases,'llmCalls':0,'networkProbeErrno':1,'databaseVersion':version,'extensions':extensions,
            'packages':{d.metadata['Name']:d.version for d in importlib.metadata.distributions()},
            'maxPythonRssBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'loadedSources':{str(Path(m.__file__).resolve()):hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest()
                for name,m in list(sys.modules.items()) if name.startswith('hindsight_api') and getattr(m,'__file__',None) and Path(m.__file__).is_file()}}
        (output/'observed.json').write_text(json.dumps(observed,indent=2,default=str)+'\n')
    finally:await engine.close()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--setup',type=Path,required=True);parser.add_argument('--output-dir',type=Path,required=True)
    args=parser.parse_args();setup=args.setup.resolve();output=args.output_dir.resolve()
    try:
        socket.create_connection(('192.0.2.1',443),timeout=.2)
        raise AssertionError('external network permitted')
    except PermissionError as e:assert e.errno==1
    pg=setup/'embedded/postgresql-18.1.0-aarch64-apple-darwin/bin'
    data=output/'data';sockets=output/'socket';sockets.mkdir()
    helpers.native_command(pg/'initdb','-D',data,'-U','hindsight','--auth=trust','--no-locale','-E','UTF8')
    started=False
    try:
        helpers.native_command(pg/'pg_ctl','-D',data,'-l',output/'postgres.log','-o',f"-k {sockets} -h '' -p 55491 -c max_connections=16 -c shared_buffers=32MB",'-w','start')
        started=True
        helpers.native_command(pg/'createdb','-h',sockets,'-p','55491','-U','hindsight','hindsight')
        asyncio.run(exercise(setup,output,f'postgresql://hindsight@/hindsight?host={sockets}&port=55491'))
    finally:
        if started:helpers.native_command(pg/'pg_ctl','-D',data,'-m','fast','-w','stop')


if __name__=='__main__':main()
