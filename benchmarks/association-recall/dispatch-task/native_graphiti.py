"""Actual pinned node search and BFS, supplied graph; no inference client."""
import asyncio
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import resource
import socket
import sys
import time
from datetime import datetime, timezone
from redislite.async_falkordb_client import AsyncFalkorDB
from graphiti_core.driver.falkordb_driver import FalkorDriver
from graphiti_core.nodes import EntityNode
from graphiti_core.edges import EntityEdge
from graphiti_core.search.search import node_search
from graphiti_core.search.search_config import NodeSearchConfig, NodeSearchMethod, NodeReranker
from graphiti_core.search.search_filters import SearchFilters

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ['DISPATCH_OUTPUT'])
BM25 = NodeSearchConfig(search_methods=[NodeSearchMethod.bm25], reranker=NodeReranker.rrf)
BFS = NodeSearchConfig(search_methods=[NodeSearchMethod.bfs], reranker=NodeReranker.rrf, bfs_max_depth=1)


async def main():
    try:
        socket.create_connection(('192.0.2.1', 443), timeout=.2)
        raise AssertionError('external network permitted')
    except PermissionError as e:
        assert e.errno == 1
    fixture = json.loads((HERE/'fixture.json').read_text())
    cases = []
    db = AsyncFalkorDB(str(ROOT/'benchmark.rdb'), serverconfig={'bind':'127.0.0.1','maxmemory':'256mb','maxmemory-policy':'noeviction'})
    try:
        for index, case in enumerate(fixture['cases']):
            group = f'dispatch_{index}'
            driver = FalkorDriver(falkor_db=db, database=group)
            if driver._init_task: await driver._init_task
            nodes = {}
            for i, row in enumerate(case['rows']):
                node = EntityNode(name=f'source_{i}', group_id=group+row.get('sourceSuffix',''), summary=row['text'],
                                  attributes={'fixture_key':row['key'],'fixture_tags':json.dumps(row.get('tags',[]))})
                await node.save(driver); nodes[row['key']]=node
            edges=[]
            for link in case['links']:
                edge=EntityEdge(source_node_uuid=nodes[link['from']].uuid,target_node_uuid=nodes[link['to']].uuid,
                                name=link['relation'],fact=link['relation'],group_id=group,created_at=datetime.now(timezone.utc))
                await edge.save(driver); edges.append(edge)
            trials=[]
            for iteration in range(9):
                start=time.perf_counter_ns()
                seeds,scores=await node_search(driver,None,case['query'],[],[group],BM25,SearchFilters(),limit=1)
                direct_ns=time.perf_counter_ns()-start
                neighbors,nscores=await node_search(driver,None,case['query'],[],[group],BFS,SearchFilters(),
                                                  bfs_origin_node_uuids=[n.uuid for n in seeds],limit=8)
                combined_ns=time.perf_counter_ns()-start
                def row(n,s): return {'id':n.attributes['fixture_key'],'nativeId':n.uuid,'text':n.summary,'score':s}
                direct=[row(n,s) for n,s in zip(seeds,scores)]
                combined={r['id']:r for r in direct}
                for n,s in zip(neighbors,nscores): combined.setdefault(n.attributes['fixture_key'],row(n,s))
                if iteration>=2:trials.append({'control':{'sources':direct,'permitted':True,'elapsedMs':direct_ns/1e6},
                                              'treatment':{'sources':list(combined.values()),'permitted':True,'elapsedMs':combined_ns/1e6}})
            cases.append({'id':case['id'],'trials':trials,
                'sourceReads':{k:(await EntityNode.get_by_uuid(driver,n.uuid)).model_dump(mode='json') for k,n in nodes.items()},
                'edgeReads':[(await EntityEdge.get_by_uuid(driver,e.uuid)).model_dump(mode='json') for e in edges]})
        observed={'product':'Graphiti','cases':cases,'llmCalls':0,'networkProbeErrno':1,
            'packages':{d.metadata['Name']:d.version for d in importlib.metadata.distributions()},
            'maxPythonRssBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'loadedSources':{str(Path(m.__file__).resolve()):hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest()
                for m in list(sys.modules.values()) if getattr(m,'__file__',None) and Path(m.__file__).is_file()
                and any(s in m.__file__ for s in ['/graphiti_core/','/falkordb/','/redislite/'])}}
        (ROOT/'observed.json').write_text(json.dumps(observed,indent=2)+'\n')
        print('Completed native Graphiti',len(cases),'cases',flush=True)
    finally:
        try:await db.client.shutdown(save=False)
        finally:await db.close()


asyncio.run(main())
