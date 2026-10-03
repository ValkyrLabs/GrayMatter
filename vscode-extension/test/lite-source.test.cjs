const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs/promises'), path=require('node:path');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const {ensureBundledLiteSource,verifyLocalSetupPrerequisites}=require('../dist/lite-source-tests.cjs');
test('missing host prerequisites give a repair step before building',async t=>{
  const fixture=await fs.mkdtemp('/tmp/gm-prerequisites-');
  try{
    await t.test('all missing tools are named with a retry instruction',async()=>{
      await assert.rejects(verifyLocalSetupPrerequisites({...process.env,PATH:fixture}),/curl tar jq zip.*Install.*retry Connect Local/);
    });
    await t.test('a supported extension host passes without changing global tools',async()=>{
      for(const tool of ['curl','tar','jq','zip'])await fs.symlink('/usr/bin/true',path.join(fixture,tool));
      await verifyLocalSetupPrerequisites({...process.env,PATH:fixture});
    });
  }finally{await fs.rm(fixture,{recursive:true,force:true})}
});
test('private bundled source setup is repeatable and preserves interrupted or unknown state',async t=>{
  const fixture=await fs.mkdtemp('/tmp/gm-cache-'), extension=path.join(fixture,'extension'), source=path.join(fixture,'source'), storage=path.join(fixture,'storage');
  try{
    await fs.mkdir(extension);await fs.mkdir(source);
    for(const file of ['vaix','scripts/gm-connection.mjs','scripts/gm-mcp-launcher.mjs','templates/graymatter-light-bootstrap/local-server/pom.xml','LICENSE']){
      await fs.mkdir(path.dirname(path.join(source,file)),{recursive:true});await fs.writeFile(path.join(source,file),'fixture source');
    }
    const archive=path.join(extension,'lite-source.tar.gz');execFileSync('tar',['-czf',archive,'-C',source,'.']);
    const bytes=await fs.readFile(archive), descriptor={version:1,sha256:createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length};
    const metadata=path.join(extension,'lite-source.json');await fs.writeFile(metadata,JSON.stringify(descriptor));
    let target;
    await t.test('fresh extraction commits licensed source and a private completion marker',async()=>{
      target=await ensureBundledLiteSource(extension,storage);assert.equal(await fs.readFile(path.join(target,'.graymatter-source-complete'),'utf8'),descriptor.sha256);assert.equal((await fs.stat(target)).mode&0o777,0o700);
    });
    await t.test('repeated setup preserves edits and avoids extracting again',async()=>{
      await fs.writeFile(path.join(target,'custom-note'),'keep');assert.equal(await ensureBundledLiteSource(extension,storage),target);assert.equal(await fs.readFile(path.join(target,'custom-note'),'utf8'),'keep');
    });
    await t.test('a hard-interrupted staging folder cannot become the installed source',async()=>{
      const next=path.join(fixture,'fresh');await fs.mkdir(path.join(next,'lite/.staging-abandoned'),{recursive:true});await fs.writeFile(path.join(next,'lite/.staging-abandoned/note'),'keep interrupted evidence');
      const installed=await ensureBundledLiteSource(extension,next);assert.notEqual(installed,path.join(next,'lite/.staging-abandoned'));assert.equal(await fs.readFile(path.join(next,'lite/.staging-abandoned/note'),'utf8'),'keep interrupted evidence');
    });
    await t.test('unknown existing destination is preserved and reported',async()=>{
      const next=path.join(fixture,'collision');const collision=path.join(next,'lite',descriptor.sha256);await fs.mkdir(collision,{recursive:true});await fs.writeFile(path.join(collision,'user-note'),'preserve');
      await assert.rejects(ensureBundledLiteSource(extension,next),/incomplete/);assert.equal(await fs.readFile(path.join(collision,'user-note'),'utf8'),'preserve');
    });
    await t.test('corrupt archive fails before writing a source destination',async()=>{
      await fs.writeFile(archive,'corrupt');const next=path.join(fixture,'corrupt');await assert.rejects(ensureBundledLiteSource(extension,next),/checksum/);assert.equal(await fs.stat(next).catch(()=>undefined),undefined);await fs.writeFile(archive,bytes);
    });
    await t.test('failed extraction leaves no installed source and can retry',async()=>{
      const bad=Buffer.from('not a tar');await fs.writeFile(archive,bad);await fs.writeFile(metadata,JSON.stringify({version:1,sha256:createHash('sha256').update(bad).digest('hex'),sizeBytes:bad.length}));
      const next=path.join(fixture,'retry');await assert.rejects(ensureBundledLiteSource(extension,next),/preparation did not complete/);assert.deepEqual(await fs.readdir(path.join(next,'lite')),[]);
      await fs.writeFile(archive,bytes);await fs.writeFile(metadata,JSON.stringify(descriptor));assert(await ensureBundledLiteSource(extension,next));
    });
  }finally{await fs.rm(fixture,{recursive:true,force:true})}
});
