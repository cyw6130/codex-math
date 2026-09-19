import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {project} from '../tools/project-article-trajectory.mjs';
const map=title=>({entries:[{id:'a',entryClass:'fact',factKind:'definition',title,statement:'Test fixture.'}],inferences:[],b0ClaimEntryIds:[],negationPairs:[]});
test('真实不同地图不混并同名对象，不虚构 Snapshot 或路线',()=>{
 const b=project([{map:map('old'),sha256:'a'.repeat(64),revision:3,source:'old/base-map.json',label:'第一轮'},{map:map('new'),sha256:'b'.repeat(64),revision:7,source:'new/base-map.json',label:'第二轮'}]);
 assert.equal(b.entries.length,2);assert.equal(b.steps[0].status[b.entries[1].id],'absent');
 const context={CMathReplayState:{},CMathTrajectoryContract:{assertBundle(){}}};vm.createContext(context);vm.runInContext(readFileSync(new URL('../runtime/trajectory-assets/article-replay.js',import.meta.url),'utf8'),context);
 const s=context.CMathReplayState.stateAt(b,1);assert.equal(s.revision,7);assert.equal(s.routes.length,0);assert.equal(s.status[b.entries[0].id],'absent');
 assert(!JSON.stringify(b).includes('snapshot_id'));assert(!JSON.stringify(b).includes('state_id'));assert.equal(context.CMathReplayState.commitGroups(b).length,2);
});
test('空历史没有造图；坏地图拒绝',()=>{assert.equal(project([]),null);assert.throws(()=>project([{map:{},sha256:'a',revision:0}]));});

test('对象名称碰巧是数学状态关键词时不改写语义',()=>{
 const m={entries:[{id:'open',entryClass:'claim',claimKind:'proposition',title:'Fixture',statement:'Fixture'}],inferences:[],b0ClaimEntryIds:[],negationPairs:[]};
 const b=project([{map:m,sha256:'c'.repeat(64),revision:0,label:'Fixture'}]);
 assert.equal(b.steps[0].states[b.entries[0].id],'open');assert.equal(b.steps[0].deriv[b.entries[0].id].basis,'open');
});

test('新增高亮只列新 ID，未变对象跨版本复用，修订对象保留历史',()=>{
 const before=map('原定义');
 const after=structuredClone(before);after.entries.push({id:'b',entryClass:'claim',claimKind:'lemma',title:'新结论',statement:'新结论'});
 after.inferences.push({id:'p',operationKind:'proof',premises:['a'],conclusion:'b',argument:'示例推导'});
 const changed=structuredClone(after);changed.entries[0].statement='修订后的定义';
 const b=project([{map:before,sha256:'1',revision:0},{map:after,comparison_map:before,sha256:'2',revision:1},{map:changed,comparison_map:after,sha256:'3',revision:2}]);
 assert.equal(b.entries.length,3); // unchanged b is not duplicated, revised a retains both versions.
 assert.equal(b.steps[0].produced.length,0);assert.equal(b.steps[1].produced.length,2);
 assert.equal(b.steps[2].produced.length,0); // changed statement/dependency is not a new ID.
 const firstA=b.entries.find(e=>e.s==='Test fixture.');assert.equal(b.steps[1].status[firstA.id],'acc');assert.equal(b.steps[2].status[firstA.id],'absent');
});

test('修复未审地图缺项时只标图上新增，不把整张图染黄',()=>{
 const before=map('A'),after=structuredClone(before);after.entries.push({...after.entries[0],id:'b',title:'B'});
 const b=project([{map:after,comparison_map:before,revision:1,sha256:'new'}]);
 assert.equal(b.steps[0].produced.length,1);assert(b.steps[0].produced[0].endsWith(':b'));
});
