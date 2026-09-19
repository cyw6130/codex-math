import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {project} from '../tools/project-article-trajectory.mjs';
const require=createRequire(import.meta.url);
const scope={katex:require('../vendor/math-map-display/katex/katex.min.js')};scope.window=scope;
vm.createContext(scope);
for(const f of ['vendor/math-map-display/math-text.js','vendor/math-map-display/math-rendering-consumer.js','runtime/trajectory-assets/math-document.js'])vm.runInContext(readFileSync(new URL('../'+f,import.meta.url),'utf8'),scope);
test('复用 view-map 公式渲染，Markdown 段落不会破坏多行公式',()=>{
 const html=scope.CMathDocument.render('### 根群字\n\n条件 $T^{-1}$。\n\n$$\n\\boxed{\\exp(e)\\exp(-f)\\exp(e)=S^{-1}}\\tag{4}\n$$\n\n**结论**\n\n- 第一项\n- 第二项');
 assert.match(html,/<h5>根群字<\/h5>/);assert.match(html,/katex-display/);assert.match(html,/<strong>结论<\/strong>/);assert.match(html,/<ul>/);
 assert.doesNotMatch(html,/katex-error|CMATHFORMULA|\$\$/);
});
test('原文 HTML 只作为文本，不执行脚本或生成外部请求',()=>{
 const html=scope.CMathDocument.render('<img src="https://example.test/a" onerror="alert(1)">\n\n<script>alert(2)</script>');
 assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;img/);
 assert.match(scope.CMathDocument.render('```\n$x$\n```'),/<pre><code>\$x\$<\/code><\/pre>/);
});
test('命名按原对象 ID 稳定分配，翻步、修订、追加不改变已有显示编号',()=>{
 const a={entries:[{id:'z',entryClass:'claim',claimKind:'lemma',title:'L：根群字',statement:'原陈述'}],inferences:[],b0ClaimEntryIds:['z'],negationPairs:[]};
 const b=structuredClone(a);b.entries.push({id:'a',entryClass:'claim',claimKind:'lemma',title:'新结论',statement:'新陈述'});b.inferences.push({id:'p',operationKind:'proof',premises:['z'],conclusion:'a',argument:'证明'});
 const c=structuredClone(b);c.entries[0].statement='修订陈述';
 const out=project([a,b,c].map((map,i)=>({map,revision:i})));
 assert.equal(out.entries.find(x=>x.s==='原陈述').t,'引理 · 1 · 根群字');assert.equal(out.entries.find(x=>x.s==='修订陈述').t,'引理 · 1 · 根群字');
 assert.equal(out.entries.find(x=>x.sourceId==='a').t,'引理 · 2 · 新结论');assert.equal(out.infs[0].t,'证明 · 1 · 新结论');
 assert.equal(out.entries[0].sourceTitle,'L：根群字');
});
test('侧栏关系使用数学名称，原始 ID 折叠，切换对象回到顶部',()=>{
 const elements=new Map();
 const element=()=>({innerHTML:'',textContent:'',scrollTop:0,setAttribute(){},append(){},querySelector(){return null;}});
 const el=k=>{if(!elements.has(k))elements.set(k,element());return elements.get(k);};
 const container={querySelector:el,addEventListener(){},removeEventListener(){}};
 let select;
 const s={window:null,CMathDocument:scope.CMathDocument,document:{createElement:element},CMathTrajectoryCanvas:{create(_,options){select=options.onNodeClick;return {setData(){},setSelected(){},repaint(){},fit(){}};}}};s.window=s;vm.createContext(s);
 const base='../vendor/trajectory-reader/capabilities/packages/math-map/presentation/research-trajectory-view-v1/src/';
 for(const f of [base+'bundle-contract.js',base+'replay-state.js','../runtime/trajectory-assets/article-replay.js','../runtime/trajectory-assets/trajectory-style.js','../runtime/trajectory-assets/trajectory-view.js'])vm.runInContext(readFileSync(new URL(f,import.meta.url),'utf8'),s);
 const map={entries:[{id:'definition-source-id',entryClass:'fact',factKind:'definition',title:'L：测试数据',statement:'条件 $x^2=0$。'},{id:'claim-source-id',entryClass:'claim',claimKind:'lemma',title:'测试结论',statement:'结论 $x=0$。'}],inferences:[{id:'proof-source-id',operationKind:'proof',premises:['definition-source-id'],conclusion:'claim-source-id',argument:'示例'}],negationPairs:[],b0ClaimEntryIds:[]};
 const bundle=project([{map,revision:0}]);s.CMathTrajectoryView.mount(container,bundle);
 el('#paneD').scrollTop=500;select(bundle.entries[0].id);assert.equal(el('#paneD').scrollTop,0);
 const html=el('#paneD').innerHTML;assert.match(html,/定义 · 1 · 测试数据/);assert.match(html,/katex/);assert.doesNotMatch(html,/<small>|数学状态|已进入权威/);
 assert.match(html,/<details class="object-source">.*definition-source-id/s);
 el('#paneD').scrollTop=300;select(bundle.entries[1].id);assert.equal(el('#paneD').scrollTop,0);
 assert.match(el('#paneD').innerHTML,/证明 · 1 · 测试结论/);
});
