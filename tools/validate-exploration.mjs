import {createHash} from 'node:crypto';
export const EXPLORATION_SCHEMA='run-math/exploration-state-v1';
const text=x=>typeof x==='string' && x.trim().length>0;
const object=x=>x && typeof x==='object' && !Array.isArray(x);
const strings=x=>Array.isArray(x)&&x.every(text)&&new Set(x).size===x.length;
const effects=['sharpen_question','distinguish_examples','identify_relationship','identify_obstruction','establish_result','exclude_direction'];
export function fingerprint(value){
 const stable=x=>Array.isArray(x)?x.map(stable):object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
 const copy={...value};delete copy.fingerprint;
 return createHash('sha256').update(JSON.stringify(stable(copy))).digest('hex');
}
export function validateExploration(state,decision){
 const errors=[];
 const check=(ok,code,path)=>{if(!ok)errors.push({code,path});};
 if(!object(state))return {valid:false,ok:false,errors:[{code:'STATE_REQUIRED',path:'state'}]};
 check(state.schema===EXPLORATION_SCHEMA,'SCHEMA','schema');
 check(text(state.targetId),'TARGET','targetId');
 const intent=state.intention;
 check(object(intent),'INTENTION','intention');
 if(object(intent)){
  for(const key of ['id','verbatimUserRequest','sourceRequestRef','objects','interest','scope','conventions'])check(text(intent[key]),'INTENTION_FIELD','intention.'+key);
  check(intent.fingerprint===fingerprint(intent),'INTENTION_HASH','intention.fingerprint');
 }
 check(state.fingerprint===fingerprint(state),'STATE_HASH','fingerprint');
 check(Array.isArray(state.contractRevisions),'REVISIONS','contractRevisions');
 const revisions=Array.isArray(state.contractRevisions)?state.contractRevisions:[];
 let active=intent?.fingerprint; const contracts=new Set([active]);
 for(const [i,r] of revisions.entries()){
  check(object(r)&&text(r.grillingEvidence)&&text(r.approvedAt)&&r.previousFingerprint===active&&object(r.intention),'UNAPPROVED_SCOPE_CHANGE',`contractRevisions[${i}]`);
  if(object(r?.intention)){
   for(const key of ['id','verbatimUserRequest','sourceRequestRef','objects','interest','scope','conventions'])check(text(r.intention[key]),'INTENTION_FIELD',`contractRevisions[${i}].intention.${key}`);
   check(r.intention.fingerprint===fingerprint(r.intention),'INTENTION_HASH',`contractRevisions[${i}].intention`);
   active=r.intention.fingerprint;contracts.add(active);
  }
 }
 check(state.activeContractFingerprint===active,'CONTRACT_MISMATCH','activeContractFingerprint');
 check(['understanding_advanced','no_verified_progress','invalidated'].includes(state.researchOutcome),'EXPLORATION_OUTCOME','researchOutcome');
 check(!('rootTarget' in state)&&!('completionEvidence' in state),'NO_THEORY_COMPLETION','state');
 check(['running','blocked','budget_exhausted','stopped'].includes(state.status),'EXPLORATION_STATUS','status');
 check(Number.isInteger(state.roundBudget)&&state.roundBudget>0,'BUDGET','roundBudget');
 check(Number.isInteger(state.roundsStarted)&&state.roundsStarted>=0&&state.roundsStarted<=state.roundBudget,'ROUND_COUNT','roundsStarted');
 const questions=new Map();
 check(Array.isArray(state.questions),'QUESTIONS','questions');
 for(const [i,q] of (Array.isArray(state.questions)?state.questions:[]).entries()){
  const p=`questions[${i}]`;
  if(!object(q)){check(false,'QUESTION',p);continue;}
  check(text(q.id)&&!questions.has(q.id),'QUESTION_ID',p);questions.set(q.id,q);
  for(const k of ['statement','motivation','relationToIntention'])check(text(q[k]),'QUESTION_FIELD',p+'.'+k);
  check(strings(q.sourceRefs)&&q.sourceRefs.length>0,'QUESTION_GROUNDING',p+'.sourceRefs');
  check(['open','selected','resolved','retired','deferred'].includes(q.status),'QUESTION_STATUS',p+'.status');
  check(q.contractFingerprint===active||['retired','deferred','resolved'].includes(q.status)&&contracts.has(q.contractFingerprint),'QUESTION_SCOPE',p+'.contractFingerprint');
 }
 const results=new Map();
 check(Array.isArray(state.acceptedResults),'RESULTS','acceptedResults');
 for(const [i,r] of (Array.isArray(state.acceptedResults)?state.acceptedResults:[]).entries()){
  if(!object(r)){check(false,'RESULT',`acceptedResults[${i}]`);continue;}
  check(text(r.id)&&!results.has(r.id),'RESULT_ID',`acceptedResults[${i}]`);results.set(r.id,r);
  check(['accepted','conditional','invalidated','superseded'].includes(r.status),'RESULT_STATUS',`acceptedResults[${i}]`);
  check(text(r.articleSha256)&&text(r.receiptRef),'FACT_BINDING',`acceptedResults[${i}]`);
 }
 check(Array.isArray(state.observations),'OBSERVATIONS','observations');
 let evidencedProgress=false; const seen=new Set();
 for(const [i,o] of (Array.isArray(state.observations)?state.observations:[]).entries()){
  const p=`observations[${i}]`;
  if(!object(o)){check(false,'OBSERVATION',p);continue;}
  check(text(o.id)&&!seen.has(o.id),'OBSERVATION_ID',p);seen.add(o.id);
  check(effects.includes(o.kind)&&text(o.statement),'OBSERVATION_CONTENT',p);
  check(strings(o.evidenceRefs)&&o.evidenceRefs.length>0,'PROGRESS_EVIDENCE',p+'.evidenceRefs');
  check(strings(o.questionIds)&&o.questionIds.length>0&&o.questionIds.every(id=>questions.has(id)),'OBSERVATION_QUESTIONS',p+'.questionIds');
  check(['recorded','candidate','accepted','invalidated'].includes(o.status),'OBSERVATION_STATUS',p);
  if(o.status==='accepted')check(results.get(o.resultId)?.status==='accepted','OBSERVATION_ACCEPTANCE',p+'.resultId');
  if(o.status!=='invalidated'&&['recorded','accepted'].includes(o.status)&&strings(o.evidenceRefs)&&o.evidenceRefs.length>0)evidencedProgress=true;
 }
 if(state.researchOutcome==='understanding_advanced')check(evidencedProgress,'PROGRESS_NOT_GROUNDED','researchOutcome');
 if(decision!==undefined){
  if(!object(decision)){check(false,'DECISION','decision');return {valid:false,ok:false,errors};}
  check(decision.schema==='run-math/exploration-decision-v1','DECISION_SCHEMA','decision.schema');
  check(text(decision.id)&&decision.targetId===state.targetId,'DECISION_TARGET','decision');
  check(decision.intentionRef===intent?.id&&decision.activeContractFingerprint===active,'DECISION_SCOPE','decision');
  check(decision.basedOnStateFingerprint===state.fingerprint,'STALE_DECISION','decision.basedOnStateFingerprint');
  check(['dispatch','ask_user','stop'].includes(decision.action),'ACTION','decision.action');
  if(decision.action==='dispatch'){
   check(!('stopReason' in decision)&&!('grilling' in decision),'ACTION_FIELDS','decision');
   check(state.status==='running'&&!state.publicationPending&&!state.invalidationsPending,'RUN_BLOCKED','state');
   check(Number.isInteger(decision.round)&&decision.round>0&&decision.round<=state.roundBudget&&[state.roundsStarted,state.roundsStarted+1].includes(decision.round),'DISPATCH_BUDGET','decision.round');
   check(Array.isArray(decision.tasks)&&decision.tasks.length>0,'TASKS','decision.tasks');
   const ids=new Set();
   for(const [i,t] of (Array.isArray(decision.tasks)?decision.tasks:[]).entries()){
    const p=`decision.tasks[${i}]`;
    if(!object(t)){check(false,'TASK',p);continue;}
    check(text(t.taskId)&&!ids.has(t.taskId),'TASK_ID',p);ids.add(t.taskId);
    const q=questions.get(t.questionId);
    check(q&&['open','selected'].includes(q.status),'TASK_QUESTION',p+'.questionId');
    for(const k of ['dialogueRef','objective','successEffect','failureEffect'])check(text(t[k]),'TASK_FIELD',p+'.'+k);
    check(effects.includes(t.expectedUnderstandingEffect),'TASK_EFFECT',p);
    check(t.mayCountAsTheoryCompletion===false,'NO_THEORY_COMPLETION',p);
    check(['accepted_only','conditional_exploration'].includes(t.premiseMode),'PREMISE_MODE',p);
    check(strings(t.premiseRefs),'PREMISES',p);
    for(const ref of (Array.isArray(t.premiseRefs)?t.premiseRefs:[])){
     const r=results.get(ref);
     check(r&&(r.status==='accepted'||t.premiseMode==='conditional_exploration'&&r.status==='conditional'),'UNACCEPTED_PREMISE',p+'.premiseRefs');
    }
   }
  }else if(decision.action==='ask_user'){
   check(!('tasks' in decision)&&!('stopReason' in decision),'ACTION_FIELDS','decision');
   check(decision.grilling?.skill==='grilling'&&text(decision.grilling.reason)&&strings(decision.grilling.questions)&&decision.grilling.questions.length>0,'GRILLING_REQUIRED','decision.grilling');
  }else if(decision.action==='stop'){
   check(!('tasks' in decision)&&!('grilling' in decision),'ACTION_FIELDS','decision');
   check(['budget_exhausted','blocked','no_grounded_question','user_stop'].includes(decision.stopReason),'STOP_REASON','decision.stopReason');
   if(decision.stopReason==='budget_exhausted')check(state.roundsStarted===state.roundBudget,'PREMATURE_BUDGET_STOP','decision.stopReason');
  }
 }
 return {valid:errors.length===0,ok:errors.length===0,errors};
}
