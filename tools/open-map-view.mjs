#!/usr/bin/env node
// Launch the existing reader; never generate an alternate frontend.
import {existsSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function readerCommand(reader,map){
 reader=resolve(reader);map=resolve(map);
 if(!existsSync(map))throw new Error(`Map missing: ${map}`);
 JSON.parse(readFileSync(map,'utf8'));
 if(!existsSync(join(reader,'server.js')))throw new Error(`Reader missing server.js: ${reader}`);
 const page=['pages/pure-graph-view.html','pure-graph-view.html'].find(x=>existsSync(join(reader,x)));
 if(!page)throw new Error(`Reader missing graph page: ${reader}`);
 const pkg=JSON.parse(readFileSync(join(reader,'package.json'),'utf8'));
 if(!pkg.scripts?.['graph:view'])throw new Error('Reader has no graph:view script');
 return {command:'npm',args:['run','graph:view','--',map],cwd:reader,page};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [reader,map,flag]=process.argv.slice(2);if(!reader||!map)throw new Error('Usage: open-map-view.mjs READER MAP [--check]');
  const spec=readerCommand(reader,map);
  if(flag==='--check')console.log(JSON.stringify(spec));
  else{
   if(flag)throw new Error('Unknown argument');
   const child=spawn(spec.command,spec.args,{cwd:spec.cwd,stdio:'inherit'});
   child.on('error',e=>{console.error(e.message);process.exitCode=1;});
   child.on('exit',code=>{process.exitCode=code??1;});
   for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
  }
 }catch(e){console.error(e.message);process.exitCode=1;}
}
