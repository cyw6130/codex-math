import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readerCommand} from '../tools/open-map-view.mjs';
for(const page of ['pages/pure-graph-view.html','pure-graph-view.html'])test(`复用已有阅读器页面 ${page}`,()=>{
 const dir=mkdtempSync(join(tmpdir(),'reader-test-'));
 try{
  mkdirSync(join(dir,'pages'));writeFileSync(join(dir,page),'fixture page');writeFileSync(join(dir,'server.js'),'fixture server');
  writeFileSync(join(dir,'package.json'),JSON.stringify({scripts:{'graph:view':'node server.js --port 0 --graph'}}));
  const map=join(dir,'map with spaces.json');writeFileSync(map,'{}');
  const c=readerCommand(dir,map);assert.equal(c.command,'npm');assert.equal(c.page,page);assert.deepEqual(c.args,['run','graph:view','--',map]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('阅读器缺失时报告，不生成替代前端',()=>{
 const dir=mkdtempSync(join(tmpdir(),'reader-test-'));
 try{writeFileSync(join(dir,'map.json'),'{}');assert.throws(()=>readerCommand(dir,join(dir,'map.json')),/server.js/);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
