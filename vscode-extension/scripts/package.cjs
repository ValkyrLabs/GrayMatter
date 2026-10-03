const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const {version}=require(path.join(root,'package.json'));
const output=path.join(root,'output');fs.mkdirSync(output,{recursive:true});
execFileSync('vsce',['package','--no-dependencies','--out',path.join(output,`graymatter-memory-${version}.vsix`)],{cwd:root,stdio:'inherit'});
