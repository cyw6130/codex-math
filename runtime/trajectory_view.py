#!/usr/bin/env python3
"""Serve the original 1.12.0 trajectory UI over verified mathematical research archives."""
import sys
sys.dont_write_bytecode=True
import argparse,hashlib,json,mimetypes,secrets,subprocess
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import view_data
ROOT=Path(__file__).resolve().parents[1]
VENDOR=ROOT/'vendor/trajectory-reader'
TRAJ='capabilities/packages/math-map/presentation/research-trajectory-view-v1/'
FORCE='capabilities/packages/math-map/presentation/graph-core-v1/variants/cmath-harness/assets/vendor/force-graph/force-graph.min.js'


def assets():
    manifest=json.loads((VENDOR/'provenance.json').read_text())
    result={}
    for name,sha in manifest['files'].items():
        p=(VENDOR/name).resolve()
        if not p.is_relative_to(VENDOR.resolve()):raise ValueError('asset outside reader')
        data=p.read_bytes()
        if hashlib.sha256(data).hexdigest()!=sha:raise ValueError('reader asset changed: '+name)
        result[name]=data
    pins=json.loads(result['pin-manifest.json'])
    for name,sha in pins['files'].items():
        if hashlib.sha256(result[name]).hexdigest()!=sha:raise ValueError('upstream pin mismatch: '+name)
    display=ROOT/'vendor/math-map-display'
    for name,sha in json.loads((display/'provenance.json').read_text())['files'].items():
        p=(display/name).resolve()
        if not p.is_relative_to(display.resolve()):raise ValueError('display asset outside reader')
        data=p.read_bytes()
        if hashlib.sha256(data).hexdigest()!=sha:raise ValueError('display asset changed: '+name)
        result['display/'+name]=data
    for name in ['article-replay.js','trajectory-canvas.js','trajectory-style.js','trajectory-view.js','math-document.js','trajectory-details.css','process-panel.js']:
        result['os/'+name]=(ROOT/'runtime/trajectory-assets'/name).read_bytes()
    return result


def reviewed_map(root, publication_path):
    """Read the exact map bound by a publication, without changing any archive."""
    f=view_data.f;pub=f.read(publication_path)
    directory=root/'reviews'/f.ident(pub['request_id'])
    matches=[p for p in (directory/'maps').glob('*/packet.json') if f.digest(p)==pub['map_packet_sha256']]
    f.require(len(matches)==1,'published trajectory map packet missing or ambiguous')
    q=matches[0].parent;packet=f.read(matches[0]);f.checked(q,packet['files'])
    f.require(packet['revision']==pub['revision'] and packet['files']['math-map.json']==pub['map_sha256'] and packet['files']['paper.md']==pub['paper_sha256'],'trajectory map publication changed')
    f.require(f.digest(q/'verdict.json')==pub['map_verdict_sha256'],'trajectory map review changed')
    verdict=f.review_binding(q,q/'verdict.json',pub['map_packet_sha256'],packet['excluded_reviewers'])
    f.require(verdict.get('verdict')=='accepted-for-projection','trajectory map review not passed')
    return pub,q/'math-map.json'


def load_input(root):
    root=Path(root).resolve();index=view_data.trajectory(root);runs=[];frames=[];shown_publications=set()
    for seq,row in enumerate(index['attempts'],1):
        label=f"第 {row['round']} 轮" if 'round' in row else row['attempt_id']
        local_repair = row.get('activity') == 'local-revision'
        basis = '修订基线' if local_repair else '轮初基线'
        if local_repair: label += ' · 本地修订'
        warnings=[];indices=[];artifacts=[];baseline=None
        if row.get('base_map_revision',row.get('base_revision')) != row.get('base_revision'):
            warnings.append(f"本轮事实文章 v{row['base_revision']}；冻结地图来自文章 v{row['base_map_revision']}，未展示更新后的全部事实。")
        for a in row.get('artifacts',[]):
            # Recheck the exact bytes read, not merely an earlier filesystem read.
            data=Path(a['path']).read_bytes()
            if hashlib.sha256(data).hexdigest()!=a['sha256']:raise ValueError('archive changed: '+a['path'])
            if a['name']=='base-map.json':
                baseline=dict(map=json.loads(data),source=a['path'])
                indices.append(len(frames));frames.append(dict(map=json.loads(data),sha256=a['sha256'],source=a['path'],revision=row.get('base_map_revision',row['base_revision']),outcome=row.get('outcome'),basis=basis,label=label+' · '+basis))
            try:
                messages=[dict(role='原始文件',content=data.decode('utf-8'))];limitations=''
            except UnicodeDecodeError:
                messages=[];limitations='二进制材料未内嵌，请按原始路径查看。'
            artifacts.append(dict(kind='evidence' if a['name'].startswith('evidence/') else 'document',summary=a['name'],reference=a['path'],coverage='SHA-256 '+a['sha256'],messages=messages,limitations=limitations))
        publication=row.get('publication_path')
        if publication and row.get('commit_status')=='published' and publication not in shown_publications:
            pub,map_path=reviewed_map(root,Path(publication));comparison=baseline
            if pub.get('previous_publication_receipt'):
                previous=root/pub['previous_publication_receipt']
                view_data.f.require(view_data.f.digest(previous)==pub['previous_publication_receipt_sha256'],'previous trajectory publication changed')
                _,previous_map=reviewed_map(root,previous)
                comparison=dict(map=view_data.f.read(previous_map),source=str(previous_map))
            indices.append(len(frames))
            frames.append(dict(map=view_data.f.read(map_path),sha256=pub['map_sha256'],source=str(map_path),revision=pub['revision'],
                outcome='published',basis='已发布地图',label=label+' · 已发布地图',
                comparison_map=comparison['map'] if comparison else None,comparison_source=comparison['source'] if comparison else None))
            shown_publications.add(publication)
            if comparison is None:warnings.append('缺少可核实的比较地图，未标记新增。')
        elif row.get('commit_status')=='article_published_map_pending':
            warnings.append('本轮文章已发布，结果地图尚待发布；不以旧基线冒充本轮新增。')
        if not indices:warnings.append('没有冻结的轮初地图；仅展示已保存的过程记录。')
        summary=''
        if row.get('summary_path'):
            summary=next(a['messages'][0]['content'] for a in artifacts if a['reference']==row['summary_path'])
        if row.get('repair_of'): warnings.append('修订来源：'+row['repair_of']+('；本地后处理，不另计推理轮。' if local_repair else '；Codex session 修复研究轮。'))
        runs.append(dict(action=label+' · '+row.get('research_mode','后处理' if local_repair else '研究'),sequence=seq,frame_indices=indices,warnings=warnings,
            math_summary=row.get('objective','尚无完整运行记录。'),result_summary='\n'.join(filter(None,[row.get('outcome',row['phase']),row.get('commit_status'),summary])),
            started_at=row.get('started_at','未记录'),ended_at='未记录',parent_run_id=None,child_run_ids=[],artifacts=artifacts))
    output=subprocess.run(['node',str(ROOT/'tools/project-article-trajectory.mjs')],input=json.dumps(frames),capture_output=True,text=True,timeout=30)
    if output.returncode:raise ValueError(output.stderr.strip())
    return dict(bundle=json.loads(output.stdout),process=dict(runs=runs,unlinked_frame_indices=[],coverage=dict(warnings=sum(len(r['warnings']) for r in runs))),
        warning='回放真实冻结基线及已发布结果地图。黄色表示结果地图相对其比较地图新增的对象和连边，不表示旧文补录也是本轮新发现。基线不标新增，缺少的中间推导不补造；本地修订不另计推理轮。'+('尚无真实 Attempt 记录。' if not runs else ''))


def page(a):
    scripts=[FORCE,'display/katex/katex.min.js','display/math-text.js','display/math-rendering-consumer.js','os/math-document.js',*[TRAJ+'src/'+n+'.js' for n in ['bundle-contract','replay-state']], 'os/article-replay.js','os/trajectory-style.js','os/trajectory-canvas.js','os/trajectory-view.js','os/process-panel.js']
    return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>研究轨迹</title><link rel="icon" href="data:,">'
      +f'<link rel="stylesheet" href="{TRAJ}assets/style.css"><link rel="stylesheet" href="os/process-panel.css">'
      +'<link rel="stylesheet" href="display/katex/katex.min.css"><link rel="stylesheet" href="os/trajectory-details.css">'
      +'<style>[hidden]{display:none!important}</style><div id="app">'+a[TRAJ+'assets/page.html'].decode()+'</div>'
      +''.join(f'<script src="{s}"></script>' for s in scripts)+'''<script>
let last='';async function refresh(){try{const r=await fetch('api/pure-graph-input',{cache:'no-store'}),v=await r.json();if(!r.ok)throw Error(v.error);
if(!last){CMathProcessPanel.mount(document.getElementById('app'),v);last=JSON.stringify(v);document.getElementById('tabP').click();document.getElementById('legend').textContent='放大后显示名称 · 黄色为本次地图新增';}
else if(last!==JSON.stringify(v))CMathProcessPanel.notice('有新的研究记录，重新打开可读取；当前回放位置保持不变。');
}catch(e){CMathProcessPanel.notice('画面未更新：'+e.message);}finally{setTimeout(refresh,3000)}}refresh();</script></html>''').encode()


def server(root,port=0):
    root=Path(root).resolve();load_input(root);a=assets();html=page(a);prefix='/'+secrets.token_urlsafe(24)+'/'
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.headers.get('Host')!=f'127.0.0.1:{self.server.server_port}' or not self.path.startswith(prefix):self.send_error(404);return
            route=self.path[len(prefix):];status=200
            if route=='':data=html;mime='text/html; charset=utf-8'
            elif route=='api/pure-graph-input':
                mime='application/json; charset=utf-8'
                try:data=json.dumps(load_input(root),ensure_ascii=False).encode()
                except Exception as e:status=409;data=json.dumps(dict(error=str(e)),ensure_ascii=False).encode()
            elif route in a:data=a[route];mime=mimetypes.guess_type(route)[0] or 'application/octet-stream'
            else:self.send_error(404);return
            self.send_response(status)
            for k,v in {'Content-Type':mime,'Content-Length':str(len(data)),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"}.items():self.send_header(k,v)
            self.end_headers();self.wfile.write(data)
        def log_message(self,*args):pass
    s=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    return s,f'http://127.0.0.1:{s.server_port}{prefix}'


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--facts-root',required=True,type=Path);p.add_argument('--port',type=int,default=0);p.add_argument('--export-json',action='store_true');a=p.parse_args()
    if not a.facts_root.is_dir():raise ValueError('facts directory missing')
    if a.export_json:print(json.dumps(load_input(a.facts_root),ensure_ascii=False));return
    s,url=server(a.facts_root,a.port);print(json.dumps(dict(url=url,reader='trajectory',ui_release='1.12.0',state_changed=False)),flush=True)
    try:s.serve_forever()
    finally:s.server_close()
if __name__=='__main__':main()
