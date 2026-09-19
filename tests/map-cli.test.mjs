import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../tools/validate-map.mjs',import.meta.url));
for(const valid of [true,false]) test(`map command records ${valid?'successful':'failed'} real validation`,()=>{
 const dir=mkdtempSync(join(tmpdir(),'math-map-test-'));
 try{
  const paper=join(dir,'paper.md'),map=join(dir,'map.json'),out=join(dir,'validation.json');
  writeFileSync(paper,'Test fixture article.');
  writeFileSync(map,JSON.stringify(valid?{entries:[],inferences:[],b0ClaimEntryIds:[],negationPairs:[]}:{entries:[],unexpected:true}));
  const result=spawnSync(process.execPath,[cli,paper,map,out],{encoding:'utf8'});
  assert.equal(result.status,valid?0:1,result.stderr);
  const record=JSON.parse(readFileSync(out,'utf8'));
  assert.equal(record.validator,'cmath-gamma.math-map-semantics/v3');
  assert.equal(record.source_sha256.length,64);assert.equal(record.map_sha256.length,64);
  assert.equal(record.errors.length===0,valid);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
