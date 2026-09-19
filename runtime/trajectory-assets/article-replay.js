/* Article archive display adapter. Does not synthesize Kernel State or routes. */
(function(root){
 const original=root.CMathReplayState;
 root.CMathReplayState=Object.freeze({
  stateAt(bundle,index){
   if(!bundle.articleHistory)return original.stateAt(bundle,index);
   root.CMathTrajectoryContract.assertBundle(bundle);
   const s=bundle.steps[Math.max(0,Math.min(bundle.steps.length-1,Number(index)||0))];
   return {status:{...s.status},produced:[...(s.produced??[])],exactProduced:true,b0:s.b0,route:{entries:new Set(),inferences:new Set()},
    obstacles:[],goals:[],focus:null,fabIds:new Set(),revision:s.article_revision,currentRoute:null,
    routes:[],abandoned:new Set(),strategies:{},pendingR:[],acceptedR:[],mathStates:{...s.states},deriv:{...s.deriv}};
  },
  commitGroups(bundle){return bundle.articleHistory?bundle.steps.map((s,i)=>({steps:[i],fab:false,label:s.o})):original.commitGroups(bundle);}
 });
})(globalThis);
