"""Pinned native Graphiti node retrieval over an explicitly supplied graph."""
import asyncio, hashlib, importlib.metadata, json, os, resource, socket, sys, time
from datetime import datetime, timezone
from pathlib import Path
from redislite.async_falkordb_client import AsyncFalkorDB
from graphiti_core.driver.falkordb_driver import FalkorDriver
from graphiti_core.nodes import EntityNode
from graphiti_core.edges import EntityEdge
from graphiti_core.search.search import node_search
from graphiti_core.search.search_config import NodeSearchConfig, NodeSearchMethod, NodeReranker
from graphiti_core.search.search_filters import SearchFilters

ROOT = Path(os.environ['GM_GRAPHITI_RUN_ROOT']).resolve()
assert ROOT.is_dir()
assert not (ROOT/'observed.json').exists()
assert not (ROOT/'benchmark.rdb').exists()
FIXTURE = Path(os.environ['GM_GRAPHITI_FIXTURE']).resolve()
EXPECTED_FIXTURE = 'c88f1c7ab95d897c7f00b3f284cb586338c39d364de226ec671a04f4038cf985'
BM25 = NodeSearchConfig(search_methods=[NodeSearchMethod.bm25], reranker=NodeReranker.rrf)
BFS = NodeSearchConfig(search_methods=[NodeSearchMethod.bfs], reranker=NodeReranker.rrf, bfs_max_depth=1)

async def seed(db, case, name):
    driver = FalkorDriver(falkor_db=db, database=name)
    if driver._init_task:
        await driver._init_task
    nodes = {}
    for index, row in enumerate(case['rows']):
        node = EntityNode(name=f'source_{index}', group_id=name + row.get('sourceSuffix', ''),
            summary=row['text'], attributes={'fixture_key': row['key'], 'fixture_tags': json.dumps(row.get('tags', [])), 'fixture_type': row.get('type', 'context')})
        await node.save(driver)
        nodes[row['key']] = node
    edges = []
    for link in case['links']:
        edge = EntityEdge(source_node_uuid=nodes[link['from']].uuid, target_node_uuid=nodes[link['to']].uuid,
            name=link['relation'], fact=link['relation'], group_id=name, created_at=datetime.now(timezone.utc))
        await edge.save(driver)
        edges.append(edge)
    return driver, nodes, edges

async def retrieve(driver, query, group):
    started = time.perf_counter_ns()
    seeds, scores = await node_search(driver, None, query, [], [group], BM25, SearchFilters(), limit=1)
    direct_ns = time.perf_counter_ns() - started
    neighbors, nscores = await node_search(driver, None, query, [], [group], BFS, SearchFilters(),
        bfs_origin_node_uuids=[n.uuid for n in seeds], limit=8)
    total_ns = time.perf_counter_ns() - started
    def record(n, score):
        return {'uuid': n.uuid, 'key': n.attributes['fixture_key'], 'groupId': n.group_id,
                'text': n.summary, 'score': score}
    direct = [record(n, s) for n, s in zip(seeds, scores)]
    traversed = [record(n, s) for n, s in zip(neighbors, nscores)]
    combined = {n['uuid']: n for n in direct}
    for n in traversed:
        combined.setdefault(n['uuid'], n)
    return {'direct': direct, 'traversed': traversed, 'combined': list(combined.values()),
            'directNs': direct_ns, 'combinedNs': total_ns,
            'bodyUtf8Bytes': sum(len(n['text'].encode()) for n in combined.values())}

async def main():
    raw = FIXTURE.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == EXPECTED_FIXTURE
    fixture = json.loads(raw)
    external = None
    try:
        with socket.create_connection(('192.0.2.1', 443), timeout=0.2):
            raise AssertionError('External networking was not denied')
    except OSError as failure:
        external = {'errorType': type(failure).__name__, 'errno': failure.errno}
        assert failure.errno == 1, external
    output = {'kind': 'native-graphiti-supplied-graph-retrieval/v1', 'fixtureSha256': EXPECTED_FIXTURE,
        'sourceCommit': '747b480ec6b12ecb718f1e2bc588b20ee36ea9c2', 'externalNetworkDenied': external,
        'python': sys.version, 'models': [], 'modelCalls': 0, 'cases': [], 'lifecycle': []}
    db = AsyncFalkorDB(str(ROOT/'benchmark.rdb'), serverconfig={'bind':'127.0.0.1','maxmemory':'256mb','maxmemory-policy':'noeviction'})
    try:
        for number, case in enumerate(fixture['cases']):
            group = f'case_{number}'
            driver, nodes, edges = await seed(db, case, group)
            for _ in range(2): await retrieve(driver, case['query'], group)
            trials = [await retrieve(driver, case['query'], group) for _ in range(7)]
            source_reads = {k: (await EntityNode.get_by_uuid(driver, n.uuid)).model_dump(mode='json') for k,n in nodes.items()}
            edge_reads = [(await EntityEdge.get_by_uuid(driver,e.uuid)).model_dump(mode='json') for e in edges]
            output['cases'].append({'id':case['id'],'query':case['query'],'sourceReads':source_reads,'edgeReads':edge_reads,'trials':trials,
                'requestedLiteTokenBudget':case.get('tokenBudget',1024),'nativeTokenBudget':None})
        for mutation in ['correct-anchor','delete-anchor','delete-edge']:
            case = fixture['cases'][0]
            group = 'life_'+mutation.replace('-','_')
            driver,nodes,edges = await seed(db,case,group)
            before = await retrieve(driver,case['query'],group)
            if mutation=='correct-anchor':
                nodes['anchor'].summary='Corrected source: the former courier dispatch statement is withdrawn.'
                await nodes['anchor'].save(driver)
            elif mutation=='delete-anchor': await nodes['anchor'].delete(driver)
            else: await edges[0].delete(driver)
            after = await retrieve(driver,case['query'],group)
            try: source=(await EntityNode.get_by_uuid(driver,nodes['anchor'].uuid)).summary
            except Exception as failure: source={'errorType':type(failure).__name__}
            output['lifecycle'].append({'mutation':mutation,'before':before,'after':after,'currentAnchor':source,
                'heldClientSnapshot':before,'serverReceiptContract':'not exercised'})
        output['packages']={d.metadata['Name']:d.version for d in importlib.metadata.distributions()}
        output['loadedSources']={str(Path(m.__file__).resolve()):hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest()
          for m in list(sys.modules.values()) if getattr(m,'__file__',None) and Path(m.__file__).is_file()
          and any(s in m.__file__ for s in ['/graphiti_core/','/falkordb/','/redislite/'])}
        output['maxRssBytes']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        with (ROOT/'observed.json').open('x') as target:
            target.write(json.dumps(output,indent=2)+'\n')
        print(json.dumps({'cases':len(output['cases']),'lifecycle':len(output['lifecycle']),'modelCalls':0,'loadedSources':len(output['loadedSources'])}),flush=True)
    finally:
        # Explicit async shutdown avoids the embedded package's sync-cleanup coroutine warning.
        try: await db.client.shutdown(save=False)
        finally: await db.close()
asyncio.run(main())
