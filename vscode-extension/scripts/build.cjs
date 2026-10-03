const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
(async () => {
  const root = path.resolve(__dirname,'..'), gray = process.env.GRAYMATTER_RUNTIME_SOURCE || path.resolve(root,'..');
  const valor = process.env.GRAYMATTER_VALORIDE_SOURCE || path.resolve(root,'../../ValorIDE');
  const runtime = path.join(root,'runtime'); await fs.rm(runtime,{recursive:true,force:true}); await fs.mkdir(runtime);
  if (await fs.stat(path.join(gray,'.git')).catch(()=>undefined)) {
    const tar = path.join(root,'runtime-source.tar');
    execFileSync('git',['archive','--output',tar,'HEAD','scripts','mcp-server/index.js','mcp-server/lib'],{cwd:gray,timeout:30000});
    execFileSync('/usr/bin/tar',['-xf',tar,'-C',runtime]); await fs.rm(tar);
  } else {
    // A source-review archive can supply the exact portable source snapshot without Git metadata.
    for (const relative of ['scripts','mcp-server/lib']) await fs.cp(path.join(gray,relative),path.join(runtime,relative),{recursive:true});
    await fs.writeFile(path.join(runtime,'mcp-server/index.js'),await fs.readFile(path.join(gray,'mcp-server/index.js')));
  }
  // All pre-existing authored runtime changes plus these task fixes are reused verbatim.
  for (const relative of ['scripts/gm-auth.mjs','scripts/gm-connection.mjs','scripts/gm-mcp-launcher.mjs','scripts/gm-macos-signin.js','scripts/gm-windows-credential.ps1','scripts/graymatter_api.sh','mcp-server/index.js']) {
    const source=path.join(gray,relative), target=path.join(runtime,relative);
    await fs.writeFile(target,await fs.readFile(source)); await fs.chmod(target,(await fs.stat(source)).mode & 0o777);
  }
  // The existing source builder runs from private extension storage, with private toolchains as needed.
  const payload=path.join(root,'lite-source.tar.gz');
  const sourceTar=path.join(root,'lite-source.tar');
  const tarOptions={timeout:30000,env:{...process.env,COPYFILE_DISABLE:'1'}};
  try {
    execFileSync('/usr/bin/tar',['-cf',sourceTar,'--exclude=.git','--exclude=node_modules','--exclude=target','--exclude=.vaix','--exclude=.graymatter','--exclude=.graymatter-lite','--exclude=.run-*','--exclude=.tmp-*','--exclude=tmp','--exclude=dist','--exclude=output','--exclude=*.skill','--exclude=admin.env','--exclude=.DS_Store','--exclude=._*','--exclude=.env*','--exclude=vscode-extension','--exclude=artifacts','--exclude=logs','--exclude=tools','--exclude=chatgpt-app-submission.json','--exclude=.agents','--exclude=.codex','--exclude=.aws','--exclude=*.vsix','-C',gray,'.'],tarOptions);
    // Mandatory Lite self-tests need this public catalog. Keep all other agent state excluded.
    const catalog='.agents/plugins/marketplace.json';
    await fs.access(path.join(gray,catalog));
    execFileSync('/usr/bin/tar',['-rf',sourceTar,'-C',gray,catalog],tarOptions);
    await fs.writeFile(payload,gzipSync(await fs.readFile(sourceTar)));
  } finally { await fs.rm(sourceTar,{force:true}); }
  const payloadBytes=await fs.readFile(payload);
  if(payloadBytes.length>32*1024*1024)throw new Error('Lite source exceeds the supported 32 MiB limit. Remove generated artifacts from the source payload before packaging.');
  await fs.writeFile(path.join(root,'lite-source.json'),JSON.stringify({version:1,sha256:createHash('sha256').update(payloadBytes).digest('hex'),sizeBytes:payloadBytes.length,license:'AGPL-3.0-only',source:'GrayMatter source snapshot with preserved existing work and verified onboarding fixes'},null,2)+'\n');
  const shared = path.join(root,'shared'); await fs.mkdir(shared,{recursive:true});
  await esbuild.build({stdin:{contents:`export { connectLocalGrayMatterCommand } from ${JSON.stringify(path.join(valor,'src/commands/graymatter/localGrayMatterCommand.ts'))};`,resolveDir:valor,loader:'ts'},outfile:path.join(shared,'onboarding.cjs'),bundle:true,platform:'node',format:'cjs',external:['vscode'],tsconfig:path.join(valor,'tsconfig.json'),metafile:true}).then(async result=>{
    const inputs=Object.keys(result.metafile.inputs); if(inputs.some(file=>file.endsWith('/McpHub.ts')))throw new Error('Unexpected ValorIDE runtime coupling');
    await fs.writeFile(path.join(root,'shared-source-proof.json'),JSON.stringify({kind:'Build-time reuse of tested ValorIDE host adapter; no ValorIDE runtime',inputs,bytes:(await fs.stat(path.join(shared,'onboarding.cjs'))).size},null,2)+'\n');
  });
  const bundle = await esbuild.build({entryPoints:[path.join(root,'src/extension.ts')],outfile:path.join(root,'dist/extension.cjs'),bundle:true,platform:'node',format:'cjs',external:['vscode'],target:'node20',metafile:true});
  await esbuild.build({entryPoints:[path.join(root,'src/liteSource.ts')],outfile:path.join(root,'dist/lite-source-tests.cjs'),bundle:true,platform:'node',format:'cjs',target:'node20'});
  const licenses = new Map();
  for (const input of Object.keys(bundle.metafile.inputs)) {
    if (!input.includes('node_modules')) continue;
    let directory = path.dirname(path.resolve(input));
    while (directory !== path.dirname(directory)) {
      const metadata = await fs.readFile(path.join(directory,'package.json'),'utf8').then(JSON.parse).catch(()=>undefined);
      if (metadata?.name) {
        if (!licenses.has(metadata.name)) {
          const names=(await fs.readdir(directory)).filter(name=>/^(?:license|copying)(?:[.\-]|$)/i.test(name));
          if (!names.length) throw new Error(`License missing for bundled ${metadata.name}`);
          licenses.set(metadata.name,`${metadata.name} ${metadata.version} (${metadata.license})\n${(await Promise.all(names.map(name=>fs.readFile(path.join(directory,name),'utf8')))).join('\n')}`);
        }
        break;
      }
      directory=path.dirname(directory);
    }
  }
  const adapterLicense=await fs.readFile(path.join(valor,'LICENSE'),'utf8');
  await fs.writeFile(path.join(root,'THIRD_PARTY_NOTICES.txt'),`ValorIDE local setup adapter (Apache-2.0)\n${adapterLicense}\n\n${[...licenses.values()].join('\n\n'+'='.repeat(72)+'\n\n')}`);
  // media/icon.png is a reviewed higher-resolution rendering of the existing brand icon.
  await fs.access(path.join(root,'media/icon.png'));
  console.log('Built standalone GrayMatter extension with shared onboarding and portable runtime.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
