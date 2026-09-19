#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateProofRouting,PROOF_STATE_SCHEMA} from './validate-proof-routing.mjs';
import {validateExploration,EXPLORATION_SCHEMA} from './validate-exploration.mjs';
export function validateResearch(state,decision){
 if(state?.schema===PROOF_STATE_SCHEMA)return validateProofRouting(state,decision);
 if(state?.schema===EXPLORATION_SCHEMA)return validateExploration(state,decision);
 return {valid:false,ok:false,errors:[{code:'UNKNOWN_RESEARCH_SCHEMA',path:'schema'}]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [state,decision]=process.argv.slice(2);
  if(!state)throw new Error('Usage: validate-research.mjs STATE [DECISION]');
  const result=validateResearch(JSON.parse(readFileSync(state,'utf8')),decision?JSON.parse(readFileSync(decision,'utf8')):undefined);
  console.log(JSON.stringify(result,null,2));if(!result.valid)process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=2;}
}
