import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const version=(key,value)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')+':'+key;
const require=createRequire(import.meta.url);
const {deriveMathState}=require('../vendor/math-graph-semantics-v3/src/index.js');
const naming=require('../vendor/math-map-display/math-map-naming.js');
// Source section locators are retained separately, not used as map display numbers.
export const shortTitle=value=>String(value??'').trim().replace(/^(?:[（(]\d+(?:\.\d+)*[)）]|[A-Z](?:\.\d+)*(?:[.:：]))\s*/u,'');
export function project(frames,title='研究历程 · 冻结基线') {
 const b={name:'article-archive',title,articleHistory:true,entries:[],infs:[],nodes:[],links:[],b0:[],states:{},deriv:{},prem:{},succ:{},steps:[]};
 const seen=new Set();let ledger=null;
 for(const frame of frames){
  const math=deriveMathState(frame.map);
  const byId=new Map(frame.map.entries.map(e=>[e.id,e]));
  const named=[...frame.map.entries.map(e=>({...e,mathematicalShortTitle:shortTitle(e.title)})),
   ...frame.map.inferences.map(i=>({...i,mathematicalShortTitle:shortTitle(i.title??byId.get(i.conclusion)?.title??i.conclusion)}))];
  const names=naming.applyNumberingTransitions({projectId:'article-history-display',objects:named,ledger,
   transitions:naming.transitionsFromAdmission({verdict:'accepted',acceptedObjectIds:named.map(e=>e.id)})});
  ledger=names.ledger;
  // Content versions preserve unchanged identities without overwriting older statements.
  const ids=new Map(frame.map.entries.map(e=>[e.id,version(e.id,e)]));
  for(const i of frame.map.inferences)ids.set(i.id,version(i.id,{...i,premises:i.premises.map(x=>ids.get(x)),conclusion:ids.get(i.conclusion)}));
  const id=x=>ids.get(x);
  const previous=frame.comparison_map;
  const oldIds=new Set(previous?[...previous.entries,...previous.inferences].map(x=>x.id):[]);
  const produced=previous?[...frame.map.entries,...frame.map.inferences].filter(x=>!oldIds.has(x.id)).map(x=>id(x.id)):[];
  const remapDerivation=d=>({...d,
   ...(d.establishingProofIds?{establishingProofIds:d.establishingProofIds.map(id)}:{}),
   ...(d.negatingClaimEntryId?{negatingClaimEntryId:id(d.negatingClaimEntryId)}:{}),
   ...(d.negationPairClaimEntryIds?{negationPairClaimEntryIds:d.negationPairClaimEntryIds.map(id)}:{}),
   ...(d.blockedProofs?{blockedProofs:d.blockedProofs.map(p=>({...p,proofId:id(p.proofId),missingPremiseIds:p.missingPremiseIds.map(id)}))}:{})});
  const status={};
  for(const e of frame.map.entries){
   status[id(e.id)]='acc';
   if(seen.has(id(e.id)))continue;seen.add(id(e.id));
   b.entries.push({id:id(e.id),sourceId:e.id,sourceTitle:e.title,c:e.entryClass,k:e.factKind??e.claimKind,t:names.namesById[e.id],s:e.statement});b.nodes.push({id:id(e.id),t:'e',c:e.entryClass});
  }
  for(const e of frame.map.inferences){
   status[id(e.id)]='acc';
   if(seen.has(id(e.id)))continue;seen.add(id(e.id));
   const inf={id:id(e.id),sourceId:e.id,sourceTitle:e.title??'',t:names.namesById[e.id],k:e.operationKind,p:e.premises.map(id),c:id(e.conclusion),a:e.argument};
   b.infs.push(inf);b.nodes.push({id:inf.id,t:'i'});
   for(const p of inf.p){b.links.push({source:p,target:inf.id,r:'p'});(b.succ[p]??=[]).push({inf:inf.id,to:inf.c});}
   b.links.push({source:inf.id,target:inf.c,r:'c'});(b.prem[inf.c]??=[]).push({inf:inf.id,k:inf.k,n:inf.p.length});
  }
  b.b0.push(...frame.map.b0ClaimEntryIds.map(id));
  const states=Object.fromEntries(Object.entries(math.claimStates).map(([k,v])=>[id(k),v]));
  const deriv=Object.fromEntries(Object.entries(math.claimDerivations).map(([k,v])=>[id(k),remapDerivation(v)]));
  Object.assign(b.states,states);Object.assign(b.deriv,deriv);
  b.steps.push({n:b.steps.length+1,a:frame.basis??'轮初基线',res:frame.outcome==='no_change'?'no-change':frame.outcome,o:frame.label,m:[],r:[],f:[],i:[],produced,b0:frame.map.b0ClaimEntryIds.map(id),comparison_source:frame.comparison_source??null,article_revision:frame.revision,source:frame.source,sha256:frame.sha256,status,states,deriv});
 }
 for(const s of b.steps)for(const n of b.nodes)s.status[n.id]??='absent';
 b.b0=[...new Set(b.b0)];return b.steps.length?b:null;
}
if(process.argv[1]===new URL(import.meta.url).pathname)process.stdout.write(JSON.stringify(project(JSON.parse(readFileSync(0,'utf8')))));
