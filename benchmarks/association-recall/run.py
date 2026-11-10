#!/usr/bin/env python3
"""Run the frozen association recall cases against an immutable, isolated Lite JAR."""
import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import statistics
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request
from zipfile import ZipFile

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / 'fixture.json'
CONTEXT = 'graymatter/retrieval-context'
ASSOCIATIONS = 'graymatter/memory/associations'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


class RefuseRedirect(HTTPRedirectHandler):
    def redirect_request(self, *unused):
        return None


@contextmanager
def runtime(jar, java, directory, password, flags, phase):
    env = {'PATH': os.environ['PATH'], 'HOME': str(directory),
           'GRAYMATTER_DATA_DIR': str(directory), 'GRAYMATTER_ADMIN_USERNAME': 'admin',
           'GRAYMATTER_ADMIN_PASSWORD': password,
           'GRAYMATTER_DB_URL': f'jdbc:h2:file:{directory}/memory;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE'}
    command = ['/usr/bin/sandbox-exec', '-f', str(HERE / 'loopback.sb'), java, *flags,
               '-Djava.net.preferIPv4Stack=true', '-Djava.io.tmpdir=' + str(directory), '-jar', str(jar),
               '--server.address=127.0.0.1', '--server.port=0',
               '--graymatter.starter-knowledge-pack.enabled=false']
    log = directory / ('boot-' + phase + '.log')
    opener = build_opener(ProxyHandler({}), RefuseRedirect())
    with log.open('x') as output:
        process = subprocess.Popen(command, env=env, cwd=directory, stdout=output, stderr=subprocess.STDOUT)
    try:
        deadline = time.monotonic() + 180
        while process.poll() is None and time.monotonic() < deadline:
            ports = re.findall(r'Tomcat started on port (\d+)', log.read_text())
            if ports:
                origin = 'http://127.0.0.1:' + ports[-1]
                try:
                    with opener.open(origin + '/actuator/health', timeout=4) as health:
                        if json.load(health)['status'] == 'UP':
                            break
                except URLError:
                    pass
            time.sleep(0.25)
        else:
            raise RuntimeError('Isolated Lite startup failed; inspect ' + str(log))
        authorization = 'Basic ' + base64.b64encode(('admin:' + password).encode()).decode()

        def request(endpoint, body=None):
            payload = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
            req = Request(origin + '/v1/' + endpoint, data=payload,
                          headers={'Authorization': authorization, 'Content-Type': 'application/json'})
            start = time.perf_counter_ns()
            try:
                response = opener.open(req, timeout=30)
            except HTTPError as error:
                response = error
            with response:
                raw = response.read()
                elapsed = (time.perf_counter_ns() - start) / 1_000_000
                parsed = json.loads(raw) if raw else None
                return {'status': response.status, 'body': parsed, 'elapsedMs': elapsed}
        yield request
    finally:
        process.terminate()
        try:
            process.wait(20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def success(result, expected=200):
    if result['status'] != expected:
        raise AssertionError(f'Expected HTTP {expected}, got {result["status"]}')
    return result['body']


def seed(http, case, suffix=''):
    channel = 'association-recall:' + case['id'] + suffix
    rows = {}
    for row in case['rows']:
        source = channel + (':' + row['sourceSuffix'] if row.get('sourceSuffix') else '')
        rows[row['key']] = success(http('MemoryEntry/write', {
            'text': row['text'], 'type': row.get('type', 'context'),
            'tags': row.get('tags', []), 'sourceChannel': source}))
    edges = []
    for edge in case['links']:
        edges.append(success(http(ASSOCIATIONS, {'fromId': rows[edge['from']]['id'],
            'toId': rows[edge['to']]['id'], 'relation': edge['relation']}), 201))
    return {'channel': channel, 'rows': rows, 'edges': edges}


def query(fixture, case, state, expanded):
    return {**fixture['retrieval'], 'query': case['query'], 'source': state['channel'],
            'tokenBudget': case.get('tokenBudget', fixture['retrieval']['tokenBudget']),
            'includeAssociations': expanded}


def summarize(response, state, oracle, budget):
    body = response['body'] or {}
    by_id = {row['id']: key for key, row in state['rows'].items()}
    items = body.get('items', [])
    keys = [by_id.get(item['memoryId'], 'UNKNOWN:' + item['memoryId']) for item in items]
    context = body.get('context') or ''
    relevant = set(oracle['relevantKeys'])
    required = set(oracle.get('requiredAnswerKeys', []))
    disclosed = set(keys)
    policy = body.get('answerPolicy')
    abstained = policy != 'ALLOW_ANSWER' and not context and not items and not body.get('contextPageRef')
    answer = None
    if required:
        answer = required <= disclosed and oracle['answerText'] in context
    return {'httpStatus': response['status'], 'receiptId': body.get('receiptId'),
            'retrievalStatus': body.get('retrievalStatus'), 'answerPolicy': policy,
            'sourceKeys': keys, 'sourceCount': body.get('sourceCount'),
            'answerEvidenceComplete': answer,
            'contextPrecision': len(disclosed & relevant) / len(disclosed) if disclosed else None,
            'forbiddenEvidence': sorted(disclosed & set(oracle.get('forbiddenKeys', []))),
            'abstained': abstained, 'requiredAbstentionMet': abstained if oracle.get('requiresAbstention') else None,
            'tokenEstimate': body.get('tokenEstimate'), 'contextUtf8Bytes': len(context.encode()),
            'budget': budget, 'elapsedMs': response['elapsedMs']}


def measure(http, fixture, case, state, expanded):
    request = query(fixture, case, state, expanded)
    warmups = fixture['timing']['warmups']
    count = fixture['timing']['measuredRepetitions']
    results = [http(CONTEXT, request) for _ in range(warmups + count)]
    trials = [summarize(result, state, case['oracle'], request['tokenBudget']) for result in results[warmups:]]
    latencies = sorted(trial['elapsedMs'] for trial in trials)
    return {'request': request, 'firstMeasuredResponse': results[warmups], 'trials': trials,
            'medianMs': statistics.median(latencies),
            'p95NearestRankMs': latencies[math.ceil(0.95 * len(latencies)) - 1]}


def receipt_checks(http, case, state, original, expanded, fixture):
    receipt = original['body'].get('receiptId') if original['body'] else None
    if not receipt:
        return {'available': False, 'initialHttpStatus': original['status']}
    pointer = state['rows']['answer']['id']
    return {'available': True,
            'inspect': http('graymatter-retrieval-receipts/' + receipt),
            'hydrateAnswer': http(CONTEXT + '/' + receipt + '/hydrate/' + pointer),
            'recompress': http(CONTEXT + '/' + receipt + '/recompress',
                               {'query': case['query'], 'tokenBudget': fixture['retrieval']['tokenBudget']}),
            'refresh': http(CONTEXT + '/' + receipt + '/refresh', query(fixture, case, state, expanded))}


def prepare_lifecycle(http, fixture, case, mutation):
    state = seed(http, case, ':lifecycle:' + mutation)
    receipts = {mode: http(CONTEXT, query(fixture, case, state, mode == 'expanded'))
                for mode in ['disabled', 'expanded']}
    return {'mutation': mutation, 'state': state, 'before': receipts}


def finish_lifecycle(http, fixture, case, scenario):
    state = scenario['state']
    scenario['anchorReadAfter'] = http('MemoryEntry/' + state['rows']['anchor']['id'])
    scenario['edgeReadAfter'] = http(ASSOCIATIONS + '/' + state['edges'][0]['associationRef'])
    scenario['after'] = {mode: receipt_checks(http, case, state, original, mode == 'expanded', fixture)
                         for mode, original in scenario['before'].items()}


def apply_stopped_faults(jar, java, directory, scenarios):
    with ZipFile(jar) as archive:
        name, = [n for n in archive.namelist() if n.startswith('BOOT-INF/lib/h2-') and n.endswith('.jar')]
        with archive.open(name) as source, (directory / 'h2.jar').open('wb') as output:
            shutil.copyfileobj(source, output)
    revoked = next(s for s in scenarios if s['mutation'] == 'revoke-anchor-owner')['state']['rows']['anchor']['id']
    edge = next(s for s in scenarios if s['mutation'] == 'delete-association')['state']['edges'][0]['associationRef']
    statements = [
        "insert into principal(id,username,password_hash,display_name,roles,enabled,created_at) "
        "select random_uuid(),'association-fault-owner',password_hash,'Synthetic revoked owner','ROLE_USER',true,current_timestamp "
        "from principal where username='admin'",
        "update memory_entry set principal_id=(select id from principal where username='association-fault-owner') "
        "where id='" + revoked + "'",
        "delete from memory_association where id='" + edge + "'"
    ]
    completed = subprocess.run([java, '-cp', str(directory / 'h2.jar'), 'org.h2.tools.Shell',
        '-url', f'jdbc:h2:file:{directory}/memory;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE',
        '-user', 'sa', '-password', '', '-sql', '; '.join(statements)],
        capture_output=True, text=True, timeout=30, check=True)
    if 'Error:' in completed.stdout or completed.stdout.count('Update count: 1') != 3:
        raise AssertionError('Stopped-database fault fixture did not update exactly three rows')
    return {'mechanism': 'Exact stopped-H2 synthetic fault fixture', 'updates': 3,
            'driverJarSha256': digest(directory / 'h2.jar'), 'sourceAnchorId': revoked,
            'revokedAssociationRef': edge}


def run(role, input_jar, output_path, java):
    fixture = json.loads(FIXTURE.read_bytes())
    if output_path.exists():
        raise FileExistsError('Observation path already exists')
    version = subprocess.run([java, '-version'], capture_output=True, text=True, check=True)
    version_text = version.stderr + version.stdout
    if not re.search(r'version "17[.]', version_text):
        raise ValueError('The frozen benchmark requires JDK17')
    scratch = Path(tempfile.mkdtemp(prefix='gm-association-recall-' + role + '-'))
    jar = scratch / 'runtime.jar'
    shutil.copyfile(input_jar, jar)
    jar_hash = digest(jar)
    if role == 'baseline' and jar_hash != fixture['baselineJarSha256']:
        raise ValueError('Baseline JAR differs from the frozen baseline')
    password = secrets.token_urlsafe(30)
    started = datetime.now(timezone.utc).isoformat()
    cases = []
    lifecycle = []
    with runtime(jar, java, scratch, password, fixture['runtime']['jvmFlags'], 'initial') as http:
        capability = success(http(ASSOCIATIONS + '/capabilities'))
        for case in fixture['cases']:
            state = seed(http, case)
            modes = {mode: measure(http, fixture, case, state, mode == 'expanded')
                     for mode in ['disabled', 'expanded']}
            cases.append({'id': case['id'], 'state': state, 'modes': modes})
        life_case = next(case for case in fixture['cases'] if case['id'] == fixture['lifecycle']['case'])
        for mutation in fixture['lifecycle']['mutations']:
            scenario = prepare_lifecycle(http, fixture, life_case, mutation)
            lifecycle.append(scenario)
            anchor = scenario['state']['rows']['anchor']
            if mutation == 'correct-anchor':
                scenario['mutationResponse'] = http('graymatter/memory/' + anchor['id'] + '/revise',
                    {'expectedSourceHash': anchor['sourceHash'], 'text': anchor['text'] + ' Checkpoint revised.'})
                success(scenario['mutationResponse'])
                finish_lifecycle(http, fixture, life_case, scenario)
            elif mutation == 'delete-anchor':
                scenario['mutationResponse'] = http('graymatter/memory/' + anchor['id'] + '/forget',
                    {'expectedSourceHash': anchor['sourceHash'], 'confirmed': True})
                success(scenario['mutationResponse'], 204)
                finish_lifecycle(http, fixture, life_case, scenario)
    fault = apply_stopped_faults(jar, java, scratch, lifecycle)
    with runtime(jar, java, scratch, password, fixture['runtime']['jvmFlags'], 'after-faults') as http:
        for scenario in lifecycle:
            if scenario['mutation'] in ['revoke-anchor-owner', 'delete-association']:
                finish_lifecycle(http, fixture, life_case, scenario)
    result = {'protocol': fixture['version'], 'role': role, 'startedUtc': started,
              'finishedUtc': datetime.now(timezone.utc).isoformat(), 'fixtureSha256': digest(FIXTURE),
              'driverSha256': digest(Path(__file__)), 'networkPolicySha256': digest(HERE / 'loopback.sb'),
              'inputJar': str(input_jar), 'jarSnapshot': str(jar), 'jarSha256': jar_hash,
              'java': java, 'javaVersion': version_text.strip(), 'runtime': fixture['runtime'],
              'networkJvmFlags': ['-Djava.net.preferIPv4Stack=true'],
              'capability': capability, 'cases': cases, 'lifecycle': lifecycle, 'faultFixture': fault,
              'logs': [{'path': str(p), 'sha256': digest(p)} for p in sorted(scratch.glob('boot-*.log'))]}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open('x') as output:
        json.dump(result, output, indent=2, ensure_ascii=False)
        output.write('\n')
    print(json.dumps({'observation': str(output_path), 'sha256': digest(output_path),
                      'jarSha256': jar_hash, 'cases': len(cases), 'lifecycle': len(lifecycle)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('role', choices=['baseline', 'candidate'])
    parser.add_argument('jar', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--java', default='/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/java')
    args = parser.parse_args()
    run(args.role, args.jar.resolve(strict=True), args.output.resolve(), args.java)
