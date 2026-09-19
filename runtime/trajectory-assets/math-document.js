/* Read-only document formatting around the same GammaMath renderer as view-map. */
(function(root){
  const escape=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const mathPattern=/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+\$|\\\([\s\S]+?\\\))/g;
  const math=text=>root.GammaMath?.render(text)??escape(text);
  // Protect math before formatting Markdown: TeX underscores, stars and newlines
  // must never become Markdown emphasis, list markers or paragraph boundaries.
  function render(value){
    const formulas=[];
    let prefix='CMATHFORMULATOKEN';
    while(String(value??'').includes(prefix))prefix+='X';
    const text=String(value??'').replace(mathPattern,s=>`${prefix}${formulas.push(s)-1}END`);
    const restore=s=>s.replace(new RegExp(prefix+'(\\d+)END','g'),(_,i)=>formulas[Number(i)]);
    const inline=s=>s.split(new RegExp('('+prefix+'\\d+END)')).map(part=>{
      const match=part.match(new RegExp('^'+prefix+'(\\d+)END$'));
      if(match)return math(formulas[Number(match[1])]);
      return part.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map(t=>t.startsWith('`')?'<code>'+escape(t.slice(1,-1))+'</code>':t.startsWith('**')?'<strong>'+math(t.slice(2,-2))+'</strong>':math(t)).join('');
    }).join('');
    const out=[];let paragraph=[],list=null,fence=false,code=[];
    const flush=()=>{if(paragraph.length){out.push('<p>'+inline(paragraph.join('\n'))+'</p>');paragraph=[];}if(list){out.push('</'+list+'>');list=null;}};
    for(const line of text.split('\n')){
      if(/^\s*```/.test(line)){flush();if(fence){out.push('<pre><code>'+escape(restore(code.join('\n')))+'</code></pre>');code=[];}fence=!fence;continue;}
      if(fence){code.push(line);continue;}
      if(!line.trim()){flush();continue;}
      const heading=line.match(/^#{1,6}\s+(.+)$/),bullet=line.match(/^\s*(?:([-*])|\d+[.)])\s+(.+)$/);
      if(heading){flush();out.push('<h5>'+inline(heading[1])+'</h5>');}
      else if(/^>\s?/.test(line)){flush();out.push('<blockquote>'+inline(line.replace(/^>\s?/,''))+'</blockquote>');}
      else if(bullet){const type=bullet[1]?'ul':'ol';if(list!==type){flush();out.push('<'+type+'>');list=type;}out.push('<li>'+inline(bullet[2])+'</li>');}
      else {if(list)flush();paragraph.push(line);}
    }
    flush();if(code.length)out.push('<pre><code>'+escape(restore(code.join('\n')))+'</code></pre>');
    return out.join('');
  }
  const api={render,inline:math,escape};root.CMathDocument=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
