/* Read native process metadata through the OS seam; mathematical rendering
   remains owned by the pinned CMath reader. No synthetic graph is constructed. */
(function () {
  'use strict';
  const names = {'start-research':'启动','find-way':'找路','reconsider-route':'找路','orient-research':'定向','explore-research':'探索','advance-research':'推进','commit-research':'接纳'};
  const kinds = {'research-run-record':'子运行记录','research-interaction-record':'用户交互','research-intent':'研究目标','attempt':'研究尝试','evidence':'依据','action-result':'本轮结果','document':'材料'};
  let noticeTarget;
  const label = run => names[run.action.replace(/^\//,'')] || run.action;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function notice(message) {
    if (noticeTarget) { noticeTarget.textContent = message; return; }
    let pending = document.getElementById('process-load-error');
    if (!pending) { pending = element('p', '', 'none'); pending.id='process-load-error'; document.getElementById('stage').append(pending); }
    pending.textContent=message;
  }
  function mount(app, input) {
    app.querySelector('#pick').remove();
    document.getElementById('process-load-error')?.remove();
    const view = input.bundle ? CMathTrajectoryView.mount(app, input.bundle) : null;
    const process = input.process;
    const tab = element('button', '研究过程');
    tab.id='tabP'; tab.type='button'; tab.setAttribute('role','tab'); tab.setAttribute('aria-selected','false');
    app.querySelector('.tabs').append(tab);
    const pane = element('div'); pane.id='paneP'; pane.className='pane'; pane.hidden=true;
    app.querySelector('aside').append(pane);
    const note = element('button', '记录说明' + (process.coverage.warnings ? ' · '+process.coverage.warnings : ''));
    note.id='process-note'; note.type='button'; note.classList.toggle('has-warning', Boolean(process.coverage.warnings));
    app.querySelector('header').append(note);
    noticeTarget=element('p', input.warning, 'process-summary'); pane.append(noticeTarget);
    const select=element('select'); select.id='process-select'; select.setAttribute('aria-label','选择研究运行'); pane.append(select);
    const detail=element('div'); detail.id='process-detail'; pane.append(detail);
    const missing=element('div'); missing.id='missing-graph'; missing.hidden=true;
    missing.append(element('strong','该次运行没有记录历史图'), element('p','过程记录仍可查看。选择一个有图的步骤，即可继续回放。'));
    const openProcess=element('button','查看过程记录'); missing.append(openProcess); app.querySelector('#stage').append(missing);
    const panels=['R','D','P'];
    function setTab(key) {
      for (const id of panels) { app.querySelector('#tab'+id).setAttribute('aria-selected', String(key===id)); app.querySelector('#pane'+id).hidden=key!==id; }
    }
    tab.onclick=note.onclick=openProcess.onclick=()=>setTab('P');
    // Keep the original route/object tab semantics, including canvas selections.
    const observer=new MutationObserver(()=>{
      if (panels.slice(0,2).some(id=>app.querySelector('#tab'+id).getAttribute('aria-selected')==='true')) {
        tab.setAttribute('aria-selected','false'); pane.hidden=true;
      }
    });
    for(const id of ['R','D']) observer.observe(app.querySelector('#tab'+id),{attributes:true,attributeFilter:['aria-selected']});
    app.addEventListener('click',event=>{
      const target=event.target.closest?.('#tabR,#tabD');
      if(target){setTab(target.id.slice(-1)); if(!view)event.stopPropagation();}
    },true);
    const entries=process.runs.map(run=>({run,frames:run.frame_indices,title:run.sequence+' · '+label(run)+(run.warnings.length?' · 记录待核对':'')}));
    for(const frame of process.unlinked_frame_indices)entries.push({run:null,frames:[frame],title:'独立状态步骤 '+(frame+1)});
    entries.forEach((entry,index)=>{const option=element('option',entry.title);option.value=String(index);select.append(option);});
    const add=(text,cls)=>{const node=element('div',undefined,'math-document '+(cls||''));node.innerHTML=CMathDocument.render(text);detail.append(node);};
    function show(entry) {
      detail.replaceChildren();
      const run=entry?.run;
      if(run){
        add(run.math_summary); add(run.result_summary);
        for(const warning of run.warnings)add(warning,'warning');
        const provenance=element('details');provenance.append(element('summary','时间与原始记录'));
        const lines=[run.started_at+' → '+run.ended_at,run.parent_run_id&&'所属流程：'+run.parent_run_id,run.child_run_ids.length&&'子运行：'+run.child_run_ids.join('、')].filter(Boolean);
        provenance.append(element('p',lines.join('\n'),'provenance'));detail.append(provenance);
        for(const artifact of run.artifacts){
          const item=element('details');item.append(element('summary',artifact.summary||kinds[artifact.kind]||'研究材料'));
          item.append(element('p',[artifact.summary,artifact.coverage,artifact.limitations].filter(Boolean).join('\n')));
          item.append(element('p',[artifact.id,artifact.reference].filter(Boolean).join('\n'),'provenance'));
          for(const message of artifact.messages||[])item.append(element('pre',message.role+'：'+message.content,'raw-record'));
          detail.append(item);
        }
      }else add('这个状态步骤的原始图已保存，但没有绑定到唯一的运行记录。');
    }
    function clearMissing(){missing.hidden=true;app.classList.remove('missing-frame');}
    function choose(index) {
      const entry=entries[index]; if(!entry)return;
      select.value=String(index); show(entry);
      const wasProcess=!pane.hidden;
      if(view && entry.frames.length){clearMissing();view.goTo(entry.frames[0]);}
      else{
        missing.hidden=false;app.classList.add('missing-frame');
        app.querySelector('#paneR').replaceChildren(element('p','本次运行未绑定可还原的路线状态。','none'));
        app.querySelector('#paneD').replaceChildren(element('p','选择有历史图的步骤后，可点击对象查看详情。','none'));
        app.querySelector('#now').replaceChildren(element('span',runName(entry),'act'),element('span','过程已记录 · 本步无历史图','pos'));
        for(const tick of app.querySelectorAll('#tl .cur'))tick.classList.remove('cur');
      }
      if(wasProcess)setTab('P');
    }
    function runName(entry){return entry.run ? label(entry.run) : '研究记录';}
    select.onchange=()=>choose(Number(select.value));
    // Native timeline controls retain their existing graph navigation. When they
    // return from a record-only selection, do not leave the empty-state overlay.
    function navigating(event){
      if(!view)return;
      const click=event.type==='click'&&event.target.closest?.('[data-go],[data-go-to],#reset,#end');
      const key=event.type==='keydown'&&event.target.tagName!=='SELECT'&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key);
      if(click||key){clearMissing();select.selectedIndex=-1;detail.replaceChildren(element('p','正在按底部时间线回放已保存的状态图。','none'));}
    }
    app.addEventListener('click',navigating,true);app.addEventListener('keydown',navigating,true);
    if(!view){
      for(const button of app.querySelectorAll('footer button'))button.disabled=true;
      app.querySelector('#profile').textContent=process.runs.length+' 次运行';
    }
    const first=entries.findIndex(entry=>entry.frames.length);
    if(entries.length)choose(first<0?0:first);
  }
  window.CMathProcessPanel=Object.freeze({mount,notice});
})();
