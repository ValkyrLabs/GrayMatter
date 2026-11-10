"""Authenticated native Lite compile under the existing directional TCP sandbox."""
import argparse
import importlib.util
import json
from pathlib import Path
import secrets
import shutil

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('prior_lite_probe',HERE.parent/'run.py')
helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--jar',type=Path,required=True);parser.add_argument('--java',required=True);parser.add_argument('--output-dir',type=Path,required=True)
    args=parser.parse_args();root=args.output_dir.resolve();root.mkdir(exist_ok=False)
    jar=root/'pinned.jar';shutil.copyfile(args.jar,jar)
    protocol=json.loads((HERE/'protocol.json').read_text())
    assert helpers.digest(jar)==protocol['native']['Lite']['jarSha256']
    fixture=json.loads((HERE/'fixture.json').read_text());cases=[]
    with helpers.runtime(jar,args.java,root,secrets.token_urlsafe(24),['-Xms128m','-Xmx512m'],'dispatch') as http:
        for case in fixture['cases']:
            state=helpers.seed(http,case)
            lookup={r['id']:k for k,r in state['rows'].items()}
            trials=[]
            for iteration in range(9):
                trial={}
                for arm,expanded in [('control',False),('treatment',True)]:
                    response=http(helpers.CONTEXT,{'query':case['query'],'source':state['channel'],
                        'retrievalMode':'KEYWORD','topK':1,'tokenBudget':1024,'includeText':True,'includeAssociations':expanded})
                    body=helpers.success(response)
                    trial[arm]={'sources':[{'id':lookup[r['memoryId']],'nativeId':r['memoryId'],'text':r['excerpt']} for r in body.get('items',[])],
                                'permitted':body.get('answerPolicy')=='ALLOW_ANSWER','elapsedMs':response['elapsedMs'],'native':body}
                if iteration>=2:trials.append(trial)
            cases.append({'id':case['id'],'trials':trials,'state':state})
            print('CASE',case['id'],flush=True)
    observed={'product':'Lite','cases':cases,'llmCalls':0,'jarSha256':helpers.digest(jar),'java':args.java,
              'networkBoundary':'Directional TCP localhost-only profile inherited from association-recall/loopback.sb',
              'networkProfileSha256':helpers.digest(HERE.parent/'loopback.sb')}
    (root/'observed.json').write_text(json.dumps(observed,indent=2)+'\n')


if __name__=='__main__':main()
