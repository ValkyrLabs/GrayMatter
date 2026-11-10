"""Exercise actual Hindsight native retain/recall on the frozen supplied fixture."""
import argparse
import asyncio
import errno
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import resource
import socket
import subprocess
import sys
import time


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def native_command(*args):
    result = subprocess.run([str(x) for x in args], check=True, capture_output=True,
                            text=True, timeout=45)
    print(result.stdout, flush=True)


def entity_names(case):
    pairs = {tuple(sorted([link['from'], link['to']])) for link in case['links']}
    result = {row['key']: [] for row in case['rows']}
    for pair in sorted(pairs):
        name = 'fixture_edge_' + hashlib.sha256(json.dumps(pair).encode()).hexdigest()[:16]
        for key in pair:
            result[key].append(name)
    return result


def compact(result, known_ids, elapsed_ms):
    value = result.model_dump(mode='json')
    trace = value.pop('trace')
    summary = trace['summary']
    phases = {phase['phase_name']: phase for phase in summary['phase_metrics']}
    return {
        'elapsedMs': elapsed_ms,
        'result': value,
        'keys': [known_ids[row['id']] for row in value['results']],
        'sourceBytes': sum(len(row['text'].encode('utf-8')) for row in value['results']),
        'traceSummary': summary,
        'retrievalCounts': phases['parallel_retrieval']['details'],
        'tokenFiltering': phases['token_filtering']['details'],
        'entryPoints': trace.get('entry_points', []),
        'nativeScores': [{k: row.get(k) for k in (
            'id', 'rrf_score', 'rrf_rank', 'semantic_rank', 'bm25_rank',
            'semantic_similarity', 'combined_score', 'activation')}
            for row in trace['final_results']],
    }


async def exercise(setup, output, fixture, protocol, database_url):
    from hindsight_api.engine.memory_engine import MemoryEngine
    from hindsight_api.engine.response_models import Budget
    from hindsight_api.models import RequestContext

    engine = MemoryEngine(db_url=database_url, pool_min_size=1, pool_max_size=4)
    observations = []
    lifecycle = []
    ctx = RequestContext
    try:
        await engine.initialize()
        backend = await engine._get_backend()

        async def retain(case, bank):
            names = entity_names(case)
            mapping = {}
            for suffix in sorted({row.get('sourceSuffix', '') for row in case['rows']}):
                rows = [row for row in case['rows'] if row.get('sourceSuffix', '') == suffix]
                group = bank + ('-' + suffix if suffix else '')
                items = [{
                    'content': row['text'], 'document_id': row['key'],
                    'tags': row.get('tags', []),
                    'metadata': {'fixture_key': row['key'], 'fixture_type': row.get('type', 'context'),
                                 'original_links': json.dumps(case['links'], separators=(',', ':'))},
                    'entities': [{'text': name} for name in names[row['key']]],
                    'resolve_entities': False,
                } for row in rows]
                ids = await engine.retain_batch_async(group, items, request_context=ctx())
                assert len(ids) == len(rows)
                for row, returned in zip(rows, ids):
                    assert len(returned) == 1, (row['key'], returned)
                    mapping[row['key']] = {'id': str(returned[0]), 'bank': group}
            sources = {}
            for row in case['rows']:
                ref = mapping[row['key']]
                current = await engine.get_memory_unit(ref['bank'], ref['id'], ctx())
                assert current['text'] == row['text']
                sources[row['key']] = current
            async with backend.acquire() as conn:
                links = await conn.fetch('SELECT from_unit_id,to_unit_id,link_type,weight FROM public.memory_links WHERE bank_id=$1 ORDER BY from_unit_id,to_unit_id,link_type', bank)
                entities = await conn.fetch('SELECT ue.unit_id,e.canonical_name FROM public.unit_entities ue JOIN public.entities e ON e.id=ue.entity_id WHERE e.bank_id=$1 ORDER BY ue.unit_id,e.canonical_name', bank)
            return mapping, sources, [dict(x) for x in links], [dict(x) for x in entities]

        async def recall(case, bank, mapping, enabled):
            await engine.update_bank_config(bank, {
                'enable_graph_retrieval': enabled, 'enable_temporal_retrieval': False,
            }, request_context=ctx())
            start = time.perf_counter_ns()
            result = await engine.recall_async(
                bank, case['query'], budget=Budget.LOW,
                max_tokens=case.get('tokenBudget', fixture['retrieval']['tokenBudget']),
                fact_type=['world'], enable_trace=True, request_context=ctx())
            elapsed = (time.perf_counter_ns() - start) / 1_000_000
            known = {v['id']: key for key, v in mapping.items()}
            return compact(result, known, elapsed)

        for index, case in enumerate(fixture['cases']):
            bank = 'case-' + str(index)
            mapping, sources, links, entities = await retain(case, bank)
            trials = {'control': [], 'treatment': []}
            for iteration in range(2 + 7):
                for name, enabled in [('control', False), ('treatment', True)]:
                    row = await recall(case, bank, mapping, enabled)
                    if iteration >= 2:
                        trials[name].append(row)
            observations.append({'id': case['id'], 'bank': bank, 'query': case['query'],
                                 'mapping': mapping, 'sources': sources,
                                 'nativeLinks': links, 'nativeEntities': entities, 'trials': trials})
            print('CASE', case['id'], trials['control'][0]['keys'], trials['treatment'][0]['keys'], flush=True)

        case = next(c for c in fixture['cases'] if c['id'] == fixture['lifecycle']['case'])
        for i, mutation in enumerate(protocol['lifecycle']):
            bank = 'lifecycle-' + str(i)
            mapping, sources, links, entities = await retain(case, bank)
            before = await recall(case, bank, mapping, True)
            original = json.loads(json.dumps(before))
            anchor = mapping['anchor']['id']
            if mutation == 'correct-anchor':
                updated = await engine.update_memory_unit(bank, anchor, text='This former dispatch record is obsolete; the office now sells ceramic bowls.', request_context=ctx())
            elif mutation == 'delete-anchor':
                updated = await engine.delete_memory_unit(anchor, bank_id=bank, request_context=ctx())
            else:
                updated = await engine.update_memory_unit(bank, anchor, entities=[], resolve_entities=False, request_context=ctx())
            current = await engine.get_memory_unit(bank, anchor, ctx())
            after = await recall(case, bank, mapping, True)
            assert before == original
            lifecycle.append({'mutation': mutation, 'mapping': mapping, 'sourcesBefore': sources,
                              'before': original, 'nativeMutationResponse': updated,
                              'currentAnchor': current, 'after': after,
                              'historicalClientSnapshotUnchanged': True})
            print('LIFECYCLE', mutation, 'current', current is not None, flush=True)

        async with backend.acquire() as conn:
            db_version = await conn.fetchval('SELECT version()')
            extensions = [dict(row) for row in await conn.fetch('SELECT extname,extversion FROM pg_extension ORDER BY extname')]
        source_root = setup / ('hindsight-' + protocol['sourceCommit']) / 'hindsight-api-slim'
        modules = {}
        for name, module in sorted(sys.modules.items()):
            file = getattr(module, '__file__', None)
            if name.startswith('hindsight_api') and file and Path(file).is_file():
                path = Path(file).resolve()
                modules[name] = {'file': str(path.relative_to(source_root)), 'sha256': sha(path)}
        observed = {
            'classification': 'Actual native Hindsight engine with supplied undirected entity associations',
            'protocolSha256': sha(Path(__file__).parent/'protocol.json'),
            'fixtureSha256': sha(Path(__file__).parent.parent/'fixture.json'),
            'sourceCommit': protocol['sourceCommit'],
            'databaseVersion': db_version, 'extensions': extensions,
            'python': sys.version, 'platform': platform.platform(),
            'packages': {d.metadata['Name']: d.version for d in importlib.metadata.distributions()},
            'loadedSourceModules': modules, 'maxPythonRssBytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'networkProbe': {'address': '192.0.2.1:443', 'errno': 1, 'bytesSent': 0},
            'llmCalls': 0, 'embedding': protocol['embedding'], 'cases': observations, 'lifecycle': lifecycle,
        }
        (output/'observed.json').write_text(json.dumps(observed, indent=2, default=str)+'\n')
    finally:
        await engine.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--setup', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    setup, output = args.setup.resolve(), args.output_dir.resolve()
    protocol = json.loads((Path(__file__).parent/'protocol.json').read_text())
    fixture_file = Path(__file__).parent.parent/'fixture.json'
    assert sha(fixture_file) == protocol['fixtureSha256']
    fixture = json.loads(fixture_file.read_text())
    sock = socket.socket()
    sock.settimeout(1)
    try:
        sock.connect(('192.0.2.1', 443))
        raise AssertionError('IP networking escaped containment')
    except PermissionError as exc:
        assert exc.errno == errno.EPERM
    finally:
        sock.close()
    pg = setup/'embedded/postgresql-18.1.0-aarch64-apple-darwin/bin'
    data, sockets = output/'data', output/'socket'
    sockets.mkdir()
    native_command(pg/'initdb', '-D', data, '-U', 'hindsight', '--auth=trust', '--no-locale', '-E', 'UTF8')
    started = False
    try:
        native_command(pg/'pg_ctl', '-D', data, '-l', output/'postgres.log', '-o',
                       f"-k {sockets} -h '' -p 55491 -c max_connections=16 -c shared_buffers=32MB", '-w', 'start')
        started = True
        native_command(pg/'createdb', '-h', sockets, '-p', '55491', '-U', 'hindsight', 'hindsight')
        asyncio.run(exercise(setup, output, fixture, protocol,
                            f'postgresql://hindsight@/hindsight?host={sockets}&port=55491'))
    finally:
        if started:
            native_command(pg/'pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop')


if __name__ == '__main__':
    main()
