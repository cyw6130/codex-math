import assert from 'node:assert/strict';
import test from 'node:test';
import {fingerprint} from '../tools/validate-exploration.mjs';
import {validateResearch} from '../tools/validate-research.mjs';
const rehash=s=>{s.fingerprint=fingerprint(s);return s;};
function fixture(){
 const intention={id:'centers',verbatimUserRequest:'理解这一类代数中心的自然结构',sourceRequestRef:'test-fixture-user',objects:'给定代数族',interest:'中心的结构',scope:'该代数族的定义和例子',conventions:'固定基域'};
 intention.fingerprint=fingerprint(intention);
 const state=rehash({schema:'run-math/exploration-state-v1',targetId:'centers',intention,activeContractFingerprint:intention.fingerprint,
 contractRevisions:[],roundBudget:3,roundsStarted:0,status:'running',researchOutcome:'no_verified_progress',
 questions:[{id:'q1',statement:'哪些例子区分两个自然的中心构造？',motivation:'已有两个定义在小例子上可能不同',relationToIntention:'区分所研究的中心结构',sourceRefs:['fixture:def-A','fixture:def-B'],contractFingerprint:intention.fingerprint,status:'open'}],observations:[],acceptedResults:[]});
 const decision={schema:'run-math/exploration-decision-v1',id:'d1',targetId:'centers',intentionRef:'centers',activeContractFingerprint:intention.fingerprint,basedOnStateFingerprint:state.fingerprint,action:'dispatch',round:1,tasks:[{taskId:'t1',dialogueRef:'fixture-session',questionId:'q1',objective:'找区分例子或证明二者在指定范围一致',expectedUnderstandingEffect:'distinguish_examples',premiseRefs:[],premiseMode:'accepted_only',successEffect:'澄清区别',failureEffect:'记录检验范围与未决问题',mayCountAsTheoryCompletion:false}]};
 return {state,decision};
}
const codes=r=>r.errors.map(e=>e.code);
test('探索可从自然问题开始而没有根命题',()=>{const {state,decision}=fixture();assert.equal(validateResearch(state,decision).valid,true);});
test('有证据的问题细化可为理解进展而无需已接纳定理',()=>{
 const {state}=fixture();state.observations=[{id:'o1',kind:'sharpen_question',statement:'两个定义的差异只剩一个明确条件需要调查',evidenceRefs:['fixture:round1-observation'],questionIds:['q1'],status:'recorded'}];state.researchOutcome='understanding_advanced';rehash(state);
 assert.equal(validateResearch(state).valid,true);assert.equal(state.acceptedResults.length,0);
});
test('空泛理解进展与错误理论完成均被拒绝',()=>{
 const {state}=fixture();state.researchOutcome='understanding_advanced';rehash(state);assert.ok(codes(validateResearch(state)).includes('PROGRESS_NOT_GROUNDED'));
 state.status='completed';state.researchOutcome='root_completed';rehash(state);const c=codes(validateResearch(state));assert.ok(c.includes('EXPLORATION_STATUS'));assert.ok(c.includes('EXPLORATION_OUTCOME'));
});
test('未确认范围变化和过时决定被拒绝',()=>{
 const {state,decision}=fixture();state.activeContractFingerprint='changed';rehash(state);
 const c=codes(validateResearch(state,decision));assert.ok(c.includes('CONTRACT_MISMATCH'));assert.ok(c.includes('STALE_DECISION'));
});
test('已批准新范围保留旧问题历史，但不能重新派发旧问题',()=>{
 const {state,decision}=fixture();const next={...state.intention,scope:'扩展到另一相关代数族'};next.fingerprint=fingerprint(next);
 state.contractRevisions.push({previousFingerprint:state.activeContractFingerprint,intention:next,grillingEvidence:'fixture:user-approval',approvedAt:'2026-09-12T00:00:00+08:00'});
 state.activeContractFingerprint=next.fingerprint;state.questions[0].status='retired';rehash(state);
 assert.equal(validateResearch(state).valid,true);
 decision.activeContractFingerprint=next.fingerprint;decision.basedOnStateFingerprint=state.fingerprint;
 assert.ok(codes(validateResearch(state,decision)).includes('TASK_QUESTION'));
});
test('未审核的观察不能充当证明前提',()=>{
 const {state,decision}=fixture();decision.tasks[0].premiseRefs=['unreviewed-observation'];assert.ok(codes(validateResearch(state,decision)).includes('UNACCEPTED_PREMISE'));
});
test('预算不能自动增加，合法提前停止不要求全理论完成',()=>{
 const {state,decision}=fixture();decision.round=4;assert.ok(codes(validateResearch(state,decision)).includes('DISPATCH_BUDGET'));
 const stop={...decision,action:'stop',stopReason:'no_grounded_question'};delete stop.tasks;delete stop.round;
 assert.equal(validateResearch(state,stop).valid,true);
 stop.stopReason='root_completed';assert.ok(codes(validateResearch(state,stop)).includes('STOP_REASON'));
});
test('有待发布事务时禁止探索派发',()=>{
 const {state,decision}=fixture();state.publicationPending='c1';rehash(state);decision.basedOnStateFingerprint=state.fingerprint;
 assert.ok(codes(validateResearch(state,decision)).includes('RUN_BLOCKED'));
});
test('malformed mode state and unknown schema fail closed',()=>{
 for(const state of [null,{}, {schema:'unknown'}, {schema:'run-math/exploration-state-v1',questions:[null],observations:[null],acceptedResults:[null],contractRevisions:[null]}])assert.equal(validateResearch(state).valid,false);
});
