import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {create}=require('../runtime/trajectory-assets/trajectory-canvas.js');
const {createStyler}=require('../runtime/trajectory-assets/trajectory-style.js');
test('概览不绘制标签，放大后绘制，节点始终保留',()=>{
 let paint;const graph=new Proxy({},{get:(_,k)=>(...args)=>{if(k==='nodeCanvasObject')paint=args[0];return graph;}});
 create({appendChild(){}},{window:{document:{createElement:()=>({setAttribute(){}})},ForceGraph:()=>()=>graph},nodeStyle:()=>({label:'名称'})});
 for(const [scale,want] of [[.5,0],[1,0],[2.1,0],[2.2,1],[4,1]]){
  let labels=0,circles=0;const ctx=new Proxy({},{get:(_,k)=>k==='fillText'?()=>labels++:k==='arc'?()=>circles++:()=>{},set:()=>true});
  paint({id:'a',x:0,y:0},ctx,scale);assert.equal(labels,want);assert(circles>0);
 }
});
test('准确新增集合驱动黄色节点和连边，不把已有结论附带染黄',()=>{
 const bundle={entries:[{id:'a',c:'claim'}],infs:[{id:'p',k:'proof',p:['a'],c:'a'}],b0:[],states:{a:'established'}};
 const state={produced:['p'],exactProduced:true,status:{a:'acc',p:'acc'},fabIds:new Set(),mathStates:{a:'open'},b0:[]};
 const styler=createStyler(bundle,()=>state,{produced:'#d6a84a',claimOpen:'#111111',background:'#000000',line2:'#333333',ink2:'#ffffff'});
 assert.equal(styler.nodeStyle({id:'p',t:'i'}).fill,'#d6a84a');assert.notEqual(styler.nodeStyle({id:'a',t:'e'}).fill,'#d6a84a');
 assert.equal(styler.nodeStyle({id:'a',t:'e'}).stroke,'#111111');
 assert.equal(styler.linkStyle({relation:'premise',source:'a',target:'p'}).color,'#d6a84a');
 assert.equal(styler.linkStyle({relation:'conclusion',source:'p',target:'a'}).color,'#d6a84a');
 state.produced=[];assert.notEqual(styler.linkStyle({relation:'conclusion',source:'p',target:'a'}).color,'#d6a84a');
});
test('前后翻步不会残留上一帧的黄色',()=>{
 const scope={CMathReplayState:{},CMathTrajectoryContract:{assertBundle(){}}};vm.createContext(scope);vm.runInContext(readFileSync(new URL('../runtime/trajectory-assets/article-replay.js',import.meta.url),'utf8'),scope);
 const b={articleHistory:true,steps:[{produced:[],status:{},states:{},deriv:{}},{produced:['p'],status:{},states:{},deriv:{}}]};
 assert.equal(scope.CMathReplayState.stateAt(b,1).produced[0],'p');assert.equal(scope.CMathReplayState.stateAt(b,0).produced.length,0);
});
test('点击区域跟随屏幕节点大小，历史中尚未出现的节点不可点击',()=>{
 let paint,pick;const graph=new Proxy({},{get:(_,k)=>(...args)=>{if(k==='nodeCanvasObject')paint=args[0];if(k==='nodePointerAreaPaint')pick=args[0];return graph;}});
 create({appendChild(){}},{window:{document:{createElement:()=>({setAttribute(){}})},ForceGraph:()=>()=>graph},nodeStyle:()=>({radius:6}),isFramed:n=>n.id==='a'});
 const ctx=new Proxy({},{get:()=>()=>{},set:()=>true});paint({id:'a',x:0,y:0},ctx,.5);
 let radius;const picking={beginPath(){},arc(x,y,r){radius=r;},fill(){}};
 pick({id:'a',x:0,y:0},'red',picking);assert.equal(radius,18);radius=null;
 pick({id:'future',x:0,y:0},'red',picking);assert.equal(radius,null);
});
