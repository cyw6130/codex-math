#!/usr/bin/env python3
"""Read verified research view inputs without writing even a lock file."""
import argparse
import json
from pathlib import Path
from urllib.parse import quote
import article_flow as f


def trajectory(root):
    root=Path(root).resolve(); rows=[]; round_by_attempt={}
    repair_requests = {}; replaced = {}; requests_by_attempt = {}
    for path in sorted((root/'reviews').glob('*/packet.json')):
        p = f.read(path)
        if p.get('schema') in ['research-increment-packet/v2','article-commit-packet/v1']:
            f.checked(path.parent, p['files'])
            for aid in p['selected']:
                f.require(f.digest(path.parent/'attempts'/f.ident(aid)/'run.json') == f.digest(root/'attempts'/aid/'run.json'), 'request attempt binding changed')
                requests_by_attempt.setdefault(aid, []).append(path.parent.name)
        if p.get('repair_of'):
            f.checked(path.parent, p['files'])
            f.require(len(p['selected']) == 1, 'ambiguous repair attempt')
            repair_requests[p['selected'][0]] = path.parent.name
            replaced[p['repair_of']] = path.parent.name
    for binding_path in sorted((root/'rounds').glob('*/*/binding.json')):
        d=binding_path.parent;b=f.read(binding_path)
        f.require(f.digest(d/'round.json')==b['round_sha256'] and f.digest(d/'policy.json')==b['policy_sha256'], 'changed round binding')
        r=f.read(d/'round.json')
        f.require(r['attempt_id']==b['attempt_id'],'round attempt mismatch')
        f.require(r['attempt_id'] not in round_by_attempt, 'duplicate round attribution')
        round_by_attempt[r['attempt_id']]=(r,b)
    for d in sorted((root/'attempts').glob('*')):
        if not d.is_dir():continue
        if not (d/'run.json').exists():
            rows.append(dict(attempt_id=d.name,phase='partial',directory=str(d)));continue
        run=f.read(d/'run.json');f.checked(d,run['files'])
        item=dict(attempt_id=d.name,phase='active',objective=run['objective'],started_at=run['started_at'],base_revision=run['base_revision'],base_map_revision=run.get('base_map_revision',run['base_revision']),artifacts=[])
        files=dict(run['files'])
        if (d/'result.json').exists():
            result=f.read(d/'result.json');f.checked(d,result['files'])
            f.require(result['run_sha256']==f.digest(d/'run.json'),'attempt provenance changed')
            item.update(phase='complete',outcome=result['outcome']);files.update(result['files'])
        item['artifacts']=[dict(name=name,path=str(d/name),sha256=sha) for name,sha in files.items()]
        request_ids = requests_by_attempt.get(d.name, [])
        if request_ids:
            item['request_ids'] = request_ids
            committed = [rid for rid in request_ids if (root/'reviews'/rid/'commit.json').exists()]
            if len(request_ids) == 1 or len(committed) == 1:
                item['request_id'] = committed[0] if committed else request_ids[0]
            for rid in request_ids:
                path = root/'reviews'/rid/'packet.json'
                item['artifacts'].append(dict(name='review-request/'+rid,path=str(path),sha256=f.digest(path)))
        if run.get('repair_of'):
            item.update(repair_of=run['repair_of'],request_id=repair_requests.get(d.name),activity='local-revision')
        if d.name in round_by_attempt:
            r,b=round_by_attempt[d.name]
            summaries=[name for name,sha in files.items() if sha==b['summary_sha256']]
            f.require(summaries,'frozen round summary missing')
            item.update(round=r['round'],target_id=r['target_id'],research_mode=r.get('research_mode','proof'),
                        summary_path=str(d/summaries[0]),request_id=b['request_id'] if r['outcome']=='candidate' else None)
            if run.get('repair_of'): item['activity']='session-repair-round'
        if item.get('request_id'):
            request = root/'reviews'/f.ident(item['request_id'])
            item['commit_status'] = 'not_committed'
            if (request/'commit.json').exists():
                commit=f.read(request/'commit.json');packet=f.read(request/'packet.json')
                f.checked(request,packet['files'])
                f.require(commit['packet_sha256']==f.digest(request/'packet.json') and (packet['schema']=='research-increment-packet/v2' or commit['paper_sha256']==packet['files']['paper.md']), 'commit binding changed')
                f.require(commit['request_id']==item['request_id'] and d.name in packet['selected'], 'commit does not contain this attempt')
                f.review_binding(request,request/'verdict.json',commit['packet_sha256'],packet['excluded_reviewers'])
                f.require(commit['verdict_sha256']==f.digest(request/'verdict.json'),'commit review changed')
                item.update(commit_status='publication_pending',commit_path=str(request/'commit.json'))
                if packet['schema']=='research-increment-packet/v2':
                    item['commit_status']='article_update_pending'
                    if (request/'article.json').exists():
                        paper, _, _ = f.article_binding(root,item['request_id'])
                        item.update(commit_status='map_update_pending',maintained_article_path=str(paper))
                    if (request/'article-pending.json').exists():
                        pending=f.read(request/'article-pending.json')
                        pending_packet=request/'articles'/f.ident(pending['round'])/'packet.json'
                        f.require(f.digest(pending_packet)==pending['packet_sha256'], 'pending article packet changed')
                        f.checked(pending_packet.parent,f.read(pending_packet)['files'])
                        item.update(commit_status='article_update_pending',pending_article_round=pending['round'])
                if (request/'article-published.json').exists():
                    current=f.state(root)
                    if f.published_request(root,current,item['request_id']):
                        item.update(commit_status='article_published_map_pending',article_publication_path=str(request/'article-published.json'))
                if (request/'published.json').exists():
                    pub=f.read(request/'published.json')
                    f.require(pub['basis_sha256']==f.digest(request/'commit.json') and pub['request_id']==item['request_id'], 'publication binding changed')
                    item.update(commit_status='publication_recorded',publication_path=str(request/'published.json'))
                    # published.json is written before the atomic workspace pointer.
                    # If current state cannot be checked, show only what the receipt proves.
                    try:
                        current=f.state(root)
                    except (ValueError,OSError,KeyError):
                        current=None
                    if current and current['revision'] >= pub['revision'] and current.get('pending') != item['request_id'] and (not current.get('article_publication_receipt') or f.map_publication_complete(root,current,item['request_id'])):
                        item['commit_status']='published'
            if (request/'packet.json').exists():item['review_packet_path']=str(request/'packet.json')
            if item['request_id'] in replaced:
                item.update(commit_status='superseded',replacement_request=replaced[item['request_id']])
        rows.append(item)
    # A started repair already suspends its source, even before a replacement packet.
    sources = {row.get('repair_of') for row in rows if row.get('repair_of')}
    for row in rows:
        if row.get('request_id') in sources and row.get('commit_status') != 'superseded':
            row['commit_status'] = 'repair_in_progress'
    known={x['attempt_id'] for x in rows}
    f.require(all(aid in known for aid in round_by_attempt),'round refers to missing attempt')
    rows.sort(key=lambda x:(x.get('started_at',''),x['attempt_id']))
    return dict(schema='article-trajectory-view/v1',authority='derived-archive-index',workspace=str(root),
                coverage='仅展示已记录且校验通过的档案；排序按记录时间，不能据此推造发现顺序或历史图状态。',attempts=rows)


def map_input(root):
    root=Path(root).resolve();s=f.state(root)
    return dict(schema='article-map-view/v1',map_path=str(root/s['map']),paper_path=str(root/s.get('map_paper',s['paper'])),
                revision=s.get('map_revision',s['revision']),map_sha256=s['map_sha256'],paper_sha256=s.get('map_paper_sha256',s['paper_sha256']),
                article_revision=s['revision'],latest_article_path=str(root/s['paper']),latest_article_sha256=s['paper_sha256'],
                map_stale=s.get('map_revision',s['revision']) < s['revision'],
                publication_pending=s.get('pending'),note='地图按来源文章版本展示；落后时不代表最新事实文章，候选地图不作为当前图。')


def markdown(view):
    lines=['# 真实研究历程','',view['coverage'],'']
    for row in view['attempts']:
        title=f"第 {row['round']} 轮" if 'round' in row else row['attempt_id']
        lines.extend([f"## {title} · {row.get('outcome',row['phase'])}",'',row.get('objective','尚无完整运行记录。'),''])
        if row.get('commit_status'):lines.extend([f"提交状态：{row['commit_status']}",''])
        if row.get('repair_of'):lines.extend([f"修订来源：{row['repair_of']}；" + ('Codex session 修复研究轮。' if 'round' in row else '本地修订后处理，不另计推理轮。'),''])
        if row.get('commit_path'):lines.extend([f"[接纳收据]({quote(row['commit_path'],safe='/')})",''])
        if row.get('summary_path'):lines.extend([f"[轮次总结]({quote(row['summary_path'],safe='/')})",''])
        for a in row.get('artifacts',[]):lines.append(f"- [{a['name']}]({quote(a['path'],safe='/')}) · SHA-256 `{a['sha256']}`")
        lines.append('')
    if not view['attempts']:lines.append('尚无真实 Attempt 记录。')
    return '\n'.join(lines)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('--kind',choices=['map','trajectory'],required=True);p.add_argument('--format',choices=['json','markdown'],default='json')
    a=p.parse_args()
    f.require(a.root.is_dir(),'workspace directory missing')
    f.require(a.kind=='trajectory' or a.format=='json','map input uses JSON')
    result=map_input(a.root) if a.kind=='map' else trajectory(a.root)
    print(markdown(result) if a.format=='markdown' else json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    try:main()
    except (ValueError,OSError,KeyError,TypeError) as e:raise SystemExit(str(e))
