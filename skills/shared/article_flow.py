#!/usr/bin/env python3
"""Mathematical research archives. Receipts bind real reviewer outputs; this is not a prover."""
import argparse
import difflib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from datetime import datetime, timezone

def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def read(p):
    return json.loads(Path(p).read_text())

def write(p, value):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=p.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, p)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def require(test, message):
    if not test:
        raise ValueError(message)

def ident(s):
    require(isinstance(s, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', s), 'invalid ID')
    return s

def now():
    return datetime.now(timezone.utc).isoformat()

def freeze(source, target):
    source, target = Path(source), Path(target)
    require(source.is_file(), f'missing source: {source}')
    target.parent.mkdir(parents=True, exist_ok=True)
    source_sha = digest(source)
    if target.exists():
        require(source_sha == digest(target), f'immutable artifact differs: {target}')
    else:
        fd, tmp = tempfile.mkstemp(dir=target.parent, prefix='.' + target.name + '.')
        try:
            shutil.copyfile(source, tmp)
            os.fsync(fd)
            require(digest(tmp) == source_sha == digest(source), f'source changed while freezing: {source}')
            os.replace(tmp, target)
        finally:
            os.close(fd)
            if os.path.exists(tmp): os.unlink(tmp)
    return source_sha

def checked(directory, files):
    for name, sha in files.items():
        p = directory / name
        require(p.resolve().is_relative_to(directory.resolve()), 'path escapes archive')
        require(p.is_file() and digest(p) == sha, f'changed or missing archive: {p}')

def state(root):
    s = read(root / 'workspace.json')
    require(s['schema'] == 'math-workspace/v1', 'wrong workspace schema')
    require(type(s['revision']) is int and s['revision'] >= 0, 'invalid revision')
    for key in ['paper', 'map', 'map_paper', 'runtime', 'baseline_provenance']:
        if key not in s:
            continue
        p = Path(s[key])
        require(not p.is_absolute() and (root / p).resolve().is_relative_to(root.resolve()), 'workspace path escapes root')
    if s.get('publication_receipt'):
        rp = root / s['publication_receipt']
        require(rp.resolve().is_relative_to(root.resolve()) and digest(rp) == s.get('publication_receipt_sha256'), 'publication receipt changed')
        pub = read(rp)
        require(pub['revision'] == s.get('map_revision', s['revision']) and pub['paper_sha256'] == s.get('map_paper_sha256', s['paper_sha256']) and pub['map_sha256'] == s['map_sha256'], 'publication pointer mismatch')
    if s.get('article_publication_receipt'):
        checked(root, {s['article_publication_receipt']: s['article_publication_receipt_sha256']})
        pub = read(root / s['article_publication_receipt'])
        require(pub['revision'] == s['revision'] and pub['paper_sha256'] == s['paper_sha256'], 'article publication pointer mismatch')
        require(type(s.get('map_revision')) is int and 0 <= s['map_revision'] <= s['revision'], 'invalid map revision')
        require(digest(root / s['map_paper']) == s['map_paper_sha256'], 'map source article changed')
    require(digest(root / s['paper']) == s['paper_sha256'], 'current paper changed')
    require(digest(root / s['map']) == s['map_sha256'], 'current map changed')
    return s

def same_base(s, record):
    require(s['revision'] == record['base_revision'] and s['paper_sha256'] == record['base_paper_sha256'], 'stale article revision')

def active_request(s, request, *, accepting=False):
    """Publication pauses during repair; historical receipts remain readable."""
    require(request not in s.get('replacements', {}), 'request superseded by a repair; resume its replacement')
    repair = s.get('repair')
    require(not repair or (accepting and repair.get('request_id') == request), 'mathematical repair in progress')

def repair_source(root, s, request):
    d = root / 'reviews' / ident(request)
    p = read(d / 'packet.json'); checked(d, p['files']); same_base(s, p)
    require(p['schema'] == 'research-increment-packet/v2', 'repair requires an increment packet')
    if (d / 'commit.json').exists():
        committed_increment(root, request)
    return d, p

def register_repair_packet(root, s, packet, request):
    source = packet.get('repair_of')
    if not source:
        return
    repair = s.get('repair') or {}
    require(repair.get('source_request') == source and packet['selected'] == [repair.get('attempt_id')], 'not the active repair attempt')
    require(repair.get('request_id') in [None, request], 'repair already has a request; start a linked revision')
    repair['request_id'] = request
    s['replacements'][source]['request_id'] = request
    write(root / 'workspace.json', s)

def request_progress(root, request):
    """Resolve repair descendants without moving the original round binding."""
    s = state(root); chain = []; seen = set()
    while request in s.get('replacements', {}):
        require(request not in seen, 'cyclic repair history'); seen.add(request)
        replacement = s['replacements'][request]
        run = read(root / 'attempts' / ident(replacement['attempt_id']) / 'run.json')
        checked(root / 'attempts' / replacement['attempt_id'], run['files'])
        require(run.get('repair_of') == request, 'repair history mismatch')
        chain.append(dict(source_request=request, **replacement))
        if not replacement.get('request_id'):
            return dict(status='repair_in_progress', request_id=None, repair_attempt=replacement['attempt_id'], repair_chain=chain)
        request = ident(replacement['request_id'])
        packet = read(root / 'reviews' / request / 'packet.json')
        checked(root / 'reviews' / request, packet['files'])
        require(packet.get('repair_of') == run['repair_of'] and packet['selected'] == [run['id']], 'replacement packet mismatch')
    d = root / 'reviews' / request
    status = 'resume_commit' if (d / 'commit.json').exists() else 'prepared'
    if published_request(root, s, request):
        status = 'published' if map_publication_complete(root, s, request) else 'article_published_map_pending'
    return dict(status=status, request_id=request, repair_chain=chain)

def published_request(root, s, request):
    d = root / 'reviews' / ident(request)
    path = d / 'article-published.json' if (d / 'article-published.json').exists() else d / 'published.json'
    if not path.exists():
        return False
    pub = read(path)
    _, packet, commit = committed_increment(root, request)
    require(pub['request_id'] == request and pub['revision'] == commit['revision'] and
            pub['basis_sha256'] == digest(d / 'commit.json'), 'publication basis changed')
    paper, _, _ = article_binding(root, request)
    require(pub['paper_sha256'] == digest(paper), 'published article changed')
    if path.name == 'article-published.json' and packet['schema'] == 'research-increment-packet/v2':
        require(pub['article_receipt_sha256'] == digest(d / 'article.json'), 'published integration changed')
    return s.get('pending') != request and s['revision'] >= pub['revision'] and (
        s['revision'] > pub['revision'] or s['paper_sha256'] == pub['paper_sha256'])

def map_publication_complete(root, s, request):
    path = root / 'reviews' / ident(request) / 'published.json'
    if not path.exists(): return False
    if publication_in_history(root, s, path): return True
    pub = read(path)
    return s.get('map_revision', -1) > pub['revision'] or (
        pub.get('kind') == 'article-commit' and s.get('map_revision') == pub['revision'] and
        s.get('map_paper_sha256') == pub['paper_sha256'] and bool(s.get('publication_receipt')))  # Superseded map, archive only.


def current_article_authors(root, s):
    """Recover known contributors even after legacy map-only publications."""
    authors = set(s.get('article_authors', []))
    for path in (root / 'reviews').glob('*/published.json'):
        pub = read(path)
        if pub.get('kind') == 'article-commit' and pub.get('revision') == s['revision'] and pub.get('paper_sha256') == s['paper_sha256']:
            require(published_request(root, s, path.parent.name), 'article publication not completed')
            _, _, contributors = article_binding(root, path.parent.name)
            authors.update(contributors)
    provenance = s.get('baseline_provenance')
    if s['revision'] == 0 and provenance:
        p = read(root / provenance)
        authors.update(p.get('contributor_identities', []))
        if p.get('author_identity'): authors.add(p['author_identity'])
    return sorted(authors)

def article_ready(d):
    require(not (d / 'article-pending.json').exists(), 'article revision awaits integration check')

def publication_in_history(root, s, path):
    reference, sha = s.get('publication_receipt'), s.get('publication_receipt_sha256')
    seen = set()
    while reference:
        require(reference not in seen, 'cyclic publication history'); seen.add(reference)
        checked(root, {reference: sha})
        if root / reference == path: return True
        receipt = read(root / reference)
        reference, sha = receipt.get('previous_publication_receipt'), receipt.get('previous_publication_receipt_sha256')
    return False

def initialize(root, a):
    require(not (root / 'workspace.json').exists(), 'workspace already configured; use status')
    provenance = read(a.provenance)
    require(provenance.get('paper_sha256') == digest(a.paper) and provenance.get('map_sha256') == digest(a.map), 'baseline provenance mismatch')
    require(provenance.get('authorization') and provenance.get('article_review'), 'baseline requires actual authorization and article review provenance')
    require(provenance.get('map_review') in ['not-run', 'independent-passed'], 'explicit map review status required')
    d = root / '.workflow/baseline'
    review = provenance['article_review']
    require(isinstance(review, dict) and digest(root / review['path']) == review['sha256'], 'baseline article review missing or changed')
    # This registers user-confirmed existing work, not a new mathematical admission.
    if provenance['map_review'] == 'independent-passed':
        mr = provenance.get('map_review_receipt', {})
        require(mr.get('path') and digest(root / mr['path']) == mr.get('sha256'), 'map review receipt required')
        freeze(root / mr['path'], d / 'map-review-receipt.json')
    freeze(root / review['path'], d / 'article-review.md')
    files = {}
    for name, source in [('paper.md', a.paper), ('math-map.json', a.map), ('provenance.json', a.provenance)]:
        files[name] = freeze(source, d / name)
    s = dict(schema='math-workspace/v1', revision=0,
             paper='.workflow/baseline/paper.md', map='.workflow/baseline/math-map.json',
             paper_sha256=files['paper.md'], map_sha256=files['math-map.json'],
             map_review=provenance['map_review'], pending=None,
             runtime='.workflow/article_flow.py', baseline_provenance='.workflow/baseline/provenance.json')
    write(root / 'workspace.json', s)
    return s

def start(root, a):
    s = state(root)
    source = getattr(a, 'repair_of', None)
    require(source or (not s.get('pending') and not s.get('repair')), 'recover pending publication or start an explicit repair')
    d = root / 'attempts' / ident(a.id)
    require(not (d / 'run.json').exists() or source, 'run ID exists')
    require(a.objective.strip() and a.identity.strip(), 'objective and identity required')
    parent = None
    if source:
        src, parent = repair_source(root, s, source)
        previous = s.get('replacements', {}).get(source)
        retry_failed = False
        if previous and previous['attempt_id'] != a.id and not previous.get('request_id'):
            result_path = root / 'attempts' / ident(previous['attempt_id']) / 'result.json'
            retry_failed = result_path.is_file() and read(result_path)['outcome'] in ['failed', 'interrupted', 'no_change']
        require(not previous or previous['attempt_id'] == a.id or retry_failed, 'source already has a repair')
        repair = s.get('repair')
        require(not repair or repair.get('request_id') == source or
                (repair['source_request'] == source and (repair['attempt_id'] == a.id or retry_failed)), 'finish or revise the active repair first')
        require(not s.get('pending') or s['pending'] == source or repair, 'unrelated publication pending')
    files = {}
    for name, p in [('grilling.md', a.grilling), ('base-paper.md', root / s['paper']), ('base-map.json', root / s['map'])]:
        files[name] = freeze(p, d / name)
    for i, p in enumerate(a.sources):
        name = f'sources/{i:04d}'
        files[name] = freeze(p, d / name)
    if parent:
        for name in ['packet.json', *parent['files'], 'commit.json', 'verdict.json', 'native-receipt.json', 'native-review.jsonl']:
            if (src / name).is_file():
                files['repair-source/' + name] = freeze(src / name, d / 'repair-source' / name)
    record = dict(schema='article-attempt/v1', id=a.id, objective=a.objective,
                  agent_identity=a.identity, base_revision=s['revision'], base_paper_sha256=s['paper_sha256'],
                  base_map_revision=s.get('map_revision', s['revision']), base_map_paper_sha256=s.get('map_paper_sha256', s['paper_sha256']),
                  started_at=now(), files=files)
    if parent:
        record.update(repair_of=source, contributor_identities=parent['excluded_reviewers'])
    if (d / 'run.json').exists():
        old = read(d / 'run.json'); record['started_at'] = old['started_at']
        require(record == old, 'repair start retry differs')
    else:
        write(d / 'run.json', record)
    if parent:
        # One atomic pointer pauses the source, including an already prepared map.
        # Retrying after a crash before this write reuses the immutable run above.
        replacements = s.setdefault('replacements', {})
        if retry_failed:
            replacements[source] = dict(attempt_id=a.id, previous_attempts=previous.get('previous_attempts', []) + [previous['attempt_id']])
        else:
            replacements.setdefault(source, dict(attempt_id=a.id))
        if not s.get('repair') or s['repair']['attempt_id'] != a.id:
            s['repair'] = dict(source_request=source, attempt_id=a.id)
        write(root / 'workspace.json', s)
    return record

def finish(root, a):
    d = root / 'attempts' / ident(a.id)
    run = read(d / 'run.json')
    checked(d, run['files'])
    if a.outcome != 'interrupted':
        same_base(state(root), run)
    files = {'transcript.md': freeze(a.transcript, d / 'transcript.md')}
    for i, p in enumerate(a.evidence):
        name = f'evidence/{i:04d}'
        files[name] = freeze(p, d / name)
    if a.outcome == 'candidate':
        require(a.delta and a.evidence, 'candidate requires article delta and Evidence')
        delta = read(a.delta)
        require(set(delta) == {'edits', 'rationale'} and isinstance(delta['edits'], list) and
                (delta['edits'] or run.get('repair_of')) and delta['rationale'], 'invalid article delta')
        apply_delta((d / 'base-paper.md').read_text(), delta)
        files['delta.json'] = freeze(a.delta, d / 'delta.json')
    else:
        require(not a.delta, 'non-candidate outcome cannot contain delta')
    result = dict(outcome=a.outcome, run_sha256=digest(d / 'run.json'), files=files)
    if (d / 'result.json').exists():
        require(read(d / 'result.json') == result, 'finish retry differs')
    else:
        write(d / 'result.json', result)
    return result

def apply_delta(text, delta):
    for edit in delta['edits']:
        require(set(edit) == {'before', 'after'} and isinstance(edit['before'], str) and isinstance(edit['after'], str), 'invalid edit')
        require(edit['before'] and text.count(edit['before']) == 1, 'edit anchor must occur exactly once')
        require(edit['before'] != edit['after'], 'empty edit')
        text = text.replace(edit['before'], edit['after'], 1)
    return text

def increment_focus(d, selected, files):
    """Reading index, not a substitute for evidence or a mathematical verdict."""
    changes=[]
    for aid in selected:
        key=f'attempts/{aid}/delta.json'
        delta=read(d/key)
        changes.append(dict(attempt_id=aid,delta_path=key,delta_sha256=files[key],rationale=delta['rationale'],edits=delta['edits'],
            evidence=[dict(path=k,sha256=v) for k,v in files.items() if k.startswith(f'attempts/{aid}/evidence/')]))
    return dict(schema='increment-review-focus/v1',authority='reading-index',base_paper='base-paper.md',
                base_paper_sha256=files['base-paper.md'],changes=changes,
                instruction='Read all changes and required evidence; inspect affected dependencies in the full base. Expand scope for uncertainty, conflicts or withdrawals. Unchanged history need not be re-proved.')


def insertion_matches(base, deltas, paper):
    text=base
    for delta in deltas:
        for e in delta['edits']:
            before,after=e['before'],e['after']
            if not (after.startswith(before) or after.endswith(before)) or after.count(before)!=1:
                return False
        text=apply_delta(text,delta)
    return text==paper


def integration_check(q, packet, filename):
    if packet.get('review_mode','independent')=='independent':
        v=review_binding(q,filename,digest(q/'packet.json'),packet['excluded_reviewers'])
        require(v.get('verdict')=='accepted-for-article' and v.get('complete') is True and v.get('faithful') is True and v.get('issues')==[], 'article integration not passed')
        return v
    require(packet.get('review_mode')=='lightweight', 'unknown integration review mode')
    require(digest(filename)==packet['files'].get('maintenance-check.json'), 'maintenance check changed')
    v=read(filename)
    require(v.get('schema')=='article-maintenance-check/v1' and v.get('classification') in ['simple-insertion','editorial-integration'], 'unknown maintenance classification')
    require(v.get('commit_sha256')==packet['commit_sha256'] and v.get('paper_sha256')==packet['files']['paper.md'], 'maintenance check belongs to different content')
    require(v.get('maintainer_identity')==packet.get('author_identity') and v.get('maintainer_identity'), 'maintenance identity mismatch')
    require(v.get('complete') is True and v.get('faithful') is True and v.get('issues')==[] and v.get('risk_flags')==[], 'integration requires independent review')
    require(isinstance(v.get('coverage'),str) and v['coverage'].strip(), 'actual maintenance coverage required')
    accepted_commit=read(q/'accepted/commit.json')
    require(digest(q/'accepted/commit.json')==packet['commit_sha256'], 'copied commit changed')
    require(digest(q/'accepted/packet.json')==accepted_commit['packet_sha256'], 'copied accepted packet changed')
    accepted=read(q/'accepted/packet.json')
    checked(q/'accepted',accepted['files'])
    require(accepted['schema']=='research-increment-packet/v2', 'lightweight integration requires increment commit')
    deltas=[read(q/f'accepted/attempts/{aid}/delta.json') for aid in accepted['selected']]
    # Legacy receipts asserted exact insertion. Editorial fidelity is Main's
    # recorded semantic judgment, not something a text-shape test can establish.
    if v['classification']=='simple-insertion':
        require(insertion_matches((q/'accepted/base-paper.md').read_text(),deltas,(q/'paper.md').read_text()), 'changed old text or non-exact integration contradicts simple-insertion check')
    return v


def prepare(root, a):
    s = state(root)
    d = root / 'reviews' / ident(a.id)
    require(len(set(a.attempts)) == len(a.attempts) and a.attempts, 'select nonempty distinct attempts')
    runs = [read(root / 'attempts' / ident(aid) / 'run.json') for aid in a.attempts]
    repair_of = runs[0].get('repair_of')
    if repair_of:
        repair = s.get('repair') or {}
        require(a.attempts == [repair.get('attempt_id')] and repair.get('source_request') == repair_of, 'not the active repair attempt')
        require(repair.get('request_id') in [None, a.id], 'repair already prepared; start a linked revision')
        require(getattr(a, 'increment_only', True), 'repairs use increment packets')
    else:
        require(not s.get('pending') and not s.get('repair'), 'recover pending publication first')
    require(a.id not in s.get('replacements', {}), 'request superseded by a repair')
    if (d / 'packet.json').exists():
        p = read(d / 'packet.json')
        require(p['selected'] == a.attempts and p['author_identity'] == a.identity, 'request retry differs')
        require(p.get('additional_excluded_reviewers', []) == sorted(set(getattr(a, 'exclude_reviewers', []))), 'reviewer exclusions retry differs')
        same_base(s, p)
        checked(d, p['files'])
        register_repair_packet(root, s, p, a.id)
        return p
    text = (root / s['paper']).read_text()
    files = {'base-paper.md': freeze(root / s['paper'], d / 'base-paper.md')}
    additional = sorted(set(getattr(a, 'exclude_reviewers', [])))
    require(all(isinstance(x, str) and x for x in additional), 'invalid contributor identity')
    authors = {a.identity, *additional}
    for aid in a.attempts:
        src = root / 'attempts' / ident(aid)
        run, result = read(src / 'run.json'), read(src / 'result.json')
        same_base(s, run)
        checked(src, run['files'])
        checked(src, result['files'])
        require(digest(src / 'run.json') == result['run_sha256'] and result['outcome'] == 'candidate', 'invalid candidate archive')
        authors.add(run['agent_identity'])
        authors.update(run.get('contributor_identities', []))
        text = apply_delta(text, read(src / 'delta.json'))
        for name in ['run.json', 'result.json', *run['files'], *result['files']]:
            key = f'attempts/{aid}/{name}'
            files[key] = freeze(src / name, d / key)
    if getattr(a, 'increment_only', True):
        require(text != (d / 'base-paper.md').read_text() or repair_of, 'net-zero increment cannot be committed')
        focus=increment_focus(d,a.attempts,files)
        prior=[]
        for candidate in [s.get('publication_receipt'), '.workflow/baseline/article-review.md']:
            if candidate and (root/candidate).is_file():
                prior.append(dict(path=candidate,sha256=digest(root/candidate)))
        focus['prior_review_references']=prior
        if repair_of:
            source, previous = repair_source(root, s, repair_of)
            prior_text = (source / 'base-paper.md').read_text()
            for aid in previous['selected']:
                prior_text = apply_delta(prior_text, read(source / f'attempts/{aid}/delta.json'))
            focus['revision_of'] = repair_of
            focus['revision_diff'] = ''.join(difflib.unified_diff(prior_text.splitlines(True), text.splitlines(True), fromfile='previous-candidate', tofile='revised-candidate'))
            focus['prior_review_references'] += [dict(path=str((source/name).relative_to(root)), sha256=digest(source/name)) for name in ['packet.json','commit.json','verdict.json','native-receipt.json'] if (source/name).is_file()]
        if (d/'review-focus.json').exists():require(read(d/'review-focus.json')==focus,'partial review focus differs')
        else:write(d/'review-focus.json',focus)
        files['review-focus.json']=digest(d/'review-focus.json')
        packet = dict(schema='research-increment-packet/v2', selected=a.attempts, author_identity=a.identity,
                      excluded_reviewers=sorted(authors), additional_excluded_reviewers=additional,
                      article_authors=sorted(authors | set(current_article_authors(root, s))),
                      base_revision=s['revision'], base_paper_sha256=s['paper_sha256'], files=files)
        if repair_of:
            packet['repair_of'] = repair_of
        write(d / 'packet.json', packet)
        register_repair_packet(root, s, packet, a.id)
        return packet
    paper = d / 'paper.md'
    if paper.exists():
        require(paper.read_text() == text, 'partial request differs')
    else:
        paper.parent.mkdir(parents=True, exist_ok=True)
        paper.write_text(text)
    files['paper.md'] = digest(paper)
    packet = dict(schema='article-commit-packet/v1', selected=a.attempts, author_identity=a.identity,
                  excluded_reviewers=sorted(authors | set(current_article_authors(root, s))), additional_excluded_reviewers=additional, base_revision=s['revision'], base_paper_sha256=s['paper_sha256'], files=files)
    write(d / 'packet.json', packet)
    return packet

def native_check(d, filename, packet_hash, excluded):
    from native_audit import _rollout_events, _native_metadata, _native_final_report
    r = read(d / 'native-receipt.json')
    require(r['packet_sha256'] == packet_hash and r['verdict_sha256'] == digest(filename), 'native receipt artifact mismatch')
    require(r['rollout_sha256'] == digest(d / 'native-review.jsonl'), 'native rollout changed')
    events = _rollout_events(d / 'native-review.jsonl')
    meta, context = _native_metadata(events)
    report = _native_final_report(events)
    spawn = meta.get('source', {}).get('subagent', {}).get('thread_spawn', {})
    require(meta.get('thread_source') == 'subagent' and meta.get('id') == r['reviewer_identity'] and meta.get('id') not in excluded, 'not an independent native subagent')
    require(meta.get('parent_thread_id') == spawn.get('parent_thread_id') and meta.get('id') != meta.get('parent_thread_id') and meta.get('agent_path') == r['agent_path'] == spawn.get('agent_path'), 'native identity mismatch')
    require(context.get('model') == r['model'] and context.get('effort') == r['effort'], 'native model mismatch')
    scope = {'article-commit-packet/v1':'mathematical-correctness', 'research-increment-packet/v2':'mathematical-correctness', 'article-integration-packet/v1':'article-integration-fidelity', 'article-editorial-packet/v1':'article-integration-fidelity', 'article-map-review-packet/v1':'extraction-fidelity'}[read(d / 'packet.json')['schema']]
    require(report['packet_sha256'] == packet_hash and report['verdicts_sha256'] == digest(filename) and report['review_scope'] == scope, 'native final does not bind review')
    require(read(filename).get('reviewer_identity') == meta['id'], 'verdict identity differs from actual thread')

def import_review(root, a):
    from native_audit import _rollout_events, _native_metadata, _native_final_report
    d = root / 'reviews' / ident(a.id)
    if getattr(a, 'article_round', None):
        require(not a.round, 'select one review stage')
        d = d / 'articles' / ident(a.article_round)
    elif a.round:
        d = d / 'maps' / ident(a.round)
    src = Path(a.rollout).resolve()
    require(any(src.is_relative_to(Path.home() / '.codex' / folder) for folder in ['sessions', 'archived_sessions']), 'production import requires host Codex rollout')
    events = _rollout_events(src)
    meta, ctx = _native_metadata(events)
    report = _native_final_report(events)
    require(meta.get('agent_path') == a.agent_path, 'unexpected reviewer agent')
    require(ctx.get('model') == a.model and ctx.get('effort') == a.effort, 'unexpected reviewer model/effort')
    require(report['packet_sha256'] == digest(d / 'packet.json') and report['verdicts_sha256'] == digest(a.verdict), 'native final artifact mismatch')
    frozen = d / 'native-review.jsonl'
    freeze(src, frozen)
    receipt = dict(packet_sha256=digest(d / 'packet.json'), verdict_sha256=digest(a.verdict), rollout_sha256=digest(frozen),
                   reviewer_identity=meta['id'], agent_path=a.agent_path, model=a.model, effort=a.effort)
    if (d / 'native-receipt.json').exists():
        require(read(d / 'native-receipt.json') == receipt, 'native import differs')
    else:
        write(d / 'native-receipt.json', receipt)
    native_check(d, a.verdict, receipt['packet_sha256'], read(d / 'packet.json')['excluded_reviewers'])
    return receipt

def review_binding(d, filename, packet_hash, excluded):
    v = read(filename)
    require(v.get('packet_sha256') == packet_hash, 'review packet mismatch')
    reviewer = v.get('reviewer_identity')
    require(isinstance(reviewer, str) and reviewer.strip() and reviewer not in excluded, 'reviewer must be independent')
    native_check(d, filename, packet_hash, excluded)
    return v

def accept(root, a):
    s = state(root)
    active_request(s, a.id, accepting=True)
    d = root / 'reviews' / ident(a.id)
    p = read(d / 'packet.json')
    checked(d, p['files'])
    increment = p['schema'] == 'research-increment-packet/v2'
    if (d / 'commit.json').exists():
        receipt = read(d / 'commit.json')
        require(receipt['verdict_sha256'] == digest(a.verdict), 'commit retry verdict differs')
        require(receipt['packet_sha256'] == digest(d / 'packet.json'), 'committed packet changed')
        review_binding(d, a.verdict, digest(d / 'packet.json'), p['excluded_reviewers'])
        require(receipt['request_id'] == a.id and receipt['revision'] == p['base_revision'] + 1 and (increment or receipt['paper_sha256'] == p['files']['paper.md']) and receipt['verdict_sha256'] == digest(d / 'verdict.json'), 'invalid commit receipt')
    else:
        same_base(s, p)
        require(not s.get('pending') or (s.get('repair') or {}).get('request_id') == a.id, 'another publication is pending')
        v = review_binding(d, a.verdict, digest(d / 'packet.json'), p['excluded_reviewers'])
        require(v.get('verdict') == 'accept' and v.get('accepted_attempts') == p['selected'] and v.get('increment' if increment else 'article_whole') == 'accept', 'review has not accepted the exact selection and scope')
        freeze(a.verdict, d / 'verdict.json')
        receipt = dict(schema='article-commit-receipt/v1', request_id=a.id, revision=s['revision'] + 1,
                       packet_sha256=digest(d / 'packet.json'), verdict_sha256=digest(a.verdict),
                       reviewer_identity=v['reviewer_identity'], status='article_update_pending' if increment else 'publication_pending')
        if increment:
            receipt['schema'] = 'research-increment-receipt/v2'
            if p.get('repair_of'):
                receipt['supersedes'] = p['repair_of']
        else:
            receipt['paper_sha256'] = p['files']['paper.md']
        write(d / 'commit.json', receipt)
    if published_request(root, s, a.id):
        return dict(receipt, status='published' if map_publication_complete(root, s, a.id) else 'article_published_map_pending')
    same_base(s, p)
    require(not s.get('pending') or s['pending'] == a.id or (s.get('repair') or {}).get('request_id') == a.id, 'another publication pending')
    s['pending'] = a.id
    s.pop('repair', None)
    write(root / 'workspace.json', s)
    return receipt

def committed_increment(root, request):
    d = root / 'reviews' / ident(request)
    p, receipt = read(d / 'packet.json'), read(d / 'commit.json')
    checked(d, p['files'])
    require(receipt['packet_sha256'] == digest(d / 'packet.json') and receipt['verdict_sha256'] == digest(d / 'verdict.json'), 'commit binding changed')
    v = review_binding(d, d / 'verdict.json', receipt['packet_sha256'], p['excluded_reviewers'])
    require(v.get('verdict') == 'accept' and v.get('accepted_attempts') == p['selected'] and v.get('increment' if p['schema']=='research-increment-packet/v2' else 'article_whole') == 'accept', 'increment not accepted')
    require(receipt['request_id'] == request and receipt['revision'] == p['base_revision'] + 1, 'commit identity changed')
    return d, p, receipt


def article_packet(root, a):
    s = state(root)
    active_request(s, a.id)
    require(s.get('pending') == a.id, 'no matching accepted increment')
    d, p, commit = committed_increment(root, a.id)
    require(p['schema'] == 'research-increment-packet/v2', 'legacy commit already contains article')
    require(not (d / 'published.json').exists() and not (d / 'article-published.json').exists(), 'publication already recorded; resume publication first')
    require(Path(a.paper).read_text().strip() and a.identity.strip(), 'complete article and author required')
    q = d / 'articles' / ident(a.round)
    previous = None
    if (q / 'packet.json').exists():
        if (q / 'previous-article.json').exists(): previous = q / 'previous-article.json'
    elif (d / 'article.json').exists():
        article_binding(root, a.id)
        previous = d / 'article.json'
    files = {'paper.md':freeze(a.paper, q / 'paper.md')}
    prior_authors = list(p.get('article_authors', p['excluded_reviewers']))
    excluded = set(p['excluded_reviewers'] + [a.identity])
    if previous:
        files['previous-article.json'] = freeze(previous, q / 'previous-article.json')
        prior = read(q / 'previous-article.json')
        prior_packet = read(d / 'articles' / ident(prior['round']) / 'packet.json')
        prior_authors += prior_packet.get('article_authors', prior_packet['excluded_reviewers'])
        excluded.update(prior_packet['excluded_reviewers'])
    for name in ['packet.json','commit.json',*p['files']]:
        files['accepted/' + name] = freeze(d / name, q / 'accepted' / name)
    expected=(d/'base-paper.md').read_text()
    for aid in p['selected']:expected=apply_delta(expected,read(d/f'attempts/{aid}/delta.json'))
    actual=(q/'paper.md').read_text()
    focus=dict(schema='article-integration-focus/v1',authority='reading-index',
               accepted_changes='accepted/review-focus.json' if 'review-focus.json' in p['files'] else 'accepted/packet.json',
               integration_diff=''.join(difflib.unified_diff(expected.splitlines(True),actual.splitlines(True),fromfile='accepted-increment-applied',tofile='maintained-article')),
               base_headings=[x for x in (d/'base-paper.md').read_text().splitlines() if x.startswith('#')],
               article_headings=[x for x in actual.splitlines() if x.startswith('#')],full_base='accepted/base-paper.md',full_article='paper.md')
    if (q/'review-focus.json').exists():require(read(q/'review-focus.json')==focus,'article focus retry differs')
    else:write(q/'review-focus.json',focus)
    files['review-focus.json']=digest(q/'review-focus.json')
    light=getattr(a,'lightweight_check',None)
    if light:files['maintenance-check.json']=freeze(light,q/'maintenance-check.json')
    packet = dict(schema='article-integration-packet/v1', commit_sha256=digest(d / 'commit.json'),
                  revision=commit['revision'], files=files, author_identity=a.identity, review_mode='lightweight' if light else 'independent',
                  excluded_reviewers=sorted(excluded), article_authors=sorted(set(prior_authors+[a.identity])))
    if light:integration_check(q,packet,q/'maintenance-check.json')
    if (q / 'packet.json').exists():require(read(q / 'packet.json') == packet, 'article round differs')
    else:write(q / 'packet.json', packet)
    if (d / 'article.json').exists() and read(d / 'article.json')['round'] == a.round:
        return packet
    require(files.get('previous-article.json') == (digest(d / 'article.json') if (d / 'article.json').exists() else None), 'stale article revision')
    write(d / 'article-pending.json', dict(round=a.round, packet_sha256=digest(q / 'packet.json')))
    return packet


def article_binding(root, request):
    d, p, commit = committed_increment(root, request)
    if p['schema'] == 'article-commit-packet/v1':return d / 'paper.md', commit, p['excluded_reviewers']
    a = read(d / 'article.json')
    require(a['commit_sha256'] == digest(d / 'commit.json'), 'article commit changed')
    q = d / 'articles' / ident(a['round'])
    packet = read(q / 'packet.json'); checked(q, packet['files'])
    require(packet['commit_sha256'] == a['commit_sha256'] and packet['revision'] == commit['revision'], 'article basis changed')
    require(a['packet_sha256'] == digest(q / 'packet.json') and a['verdict_sha256'] == digest(q / 'verdict.json'), 'article review binding changed')
    integration_check(q,packet,q/'verdict.json')
    require(a['paper_sha256'] == packet['files']['paper.md'], 'maintained article changed')
    return q / 'paper.md', dict(commit, paper_sha256=a['paper_sha256']), packet.get('article_authors', packet['excluded_reviewers'])


def update_article(root, a):
    s = state(root)
    active_request(s, a.id)
    require(s.get('pending') == a.id or s.get('last_request') == a.id, 'no matching accepted increment')
    d, p, commit = committed_increment(root, a.id)
    q = d / 'articles' / ident(a.round)
    packet = read(q / 'packet.json');checked(q, packet['files'])
    require(packet['commit_sha256'] == digest(d / 'commit.json') and packet['revision'] == commit['revision'], 'wrong article basis')
    integration_check(q,packet,a.verdict)
    receipt = dict(schema='maintained-fact-article/v1',round=a.round,commit_sha256=digest(d / 'commit.json'),
                   packet_sha256=digest(q / 'packet.json'),verdict_sha256=digest(a.verdict),paper_sha256=packet['files']['paper.md'])
    if packet.get('review_mode')=='lightweight':receipt['verification']='maintenance-check; not an independent mathematical review'
    current = read(d / 'article.json') if (d / 'article.json').exists() else None
    if current != receipt:
        require(not (d / 'article-published.json').exists(), 'published article is immutable')
        require(s.get('pending') == a.id, 'published article is immutable')
        require(packet['files'].get('previous-article.json') == (digest(d / 'article.json') if current else None), 'stale article revision')
        pending = read(d / 'article-pending.json') if (d / 'article-pending.json').exists() else None
        require(not pending or pending == dict(round=a.round, packet_sha256=digest(q / 'packet.json')), 'another article revision is active')
        if current: freeze(d / 'article.json', d / 'articles' / ident(current['round']) / 'receipt.json')
    freeze(a.verdict, q / 'verdict.json')
    if (q / 'receipt.json').exists(): require(read(q / 'receipt.json') == receipt, 'article receipt changed')
    else: write(q / 'receipt.json', receipt)
    write(d / 'article.json',receipt)
    pending_path = d / 'article-pending.json'
    if pending_path.exists() and read(pending_path)['round'] == a.round: pending_path.unlink()
    return receipt


def publish_article(root, a):
    """Expose a checked fact article without waiting for its derived map."""
    s = state(root); d = root / 'reviews' / ident(a.id)
    article_ready(d)
    paper, commit, authors = article_binding(root, a.id)
    path = d / 'article-published.json'
    publication = dict(schema='fact-article-publication/v1', request_id=a.id,
                       revision=commit['revision'], paper_sha256=digest(paper),
                       basis_sha256=digest(d / 'commit.json'))
    if (d / 'article.json').exists():
        publication['article_receipt_sha256'] = digest(d / 'article.json')
    if path.exists():
        require(read(path) == publication, 'article publication receipt differs')
        if published_request(root, s, a.id): return s
    elif (d / 'published.json').exists() and published_request(root, s, a.id):
        return s  # Legacy joint publication already completed.
    active_request(s, a.id)
    require(s.get('pending') == a.id, 'no matching pending article')
    same_base(s, read(d / 'packet.json'))
    # Before moving the article pointer, retain the map's exact source version.
    s.setdefault('map_revision', s['revision'])
    s.setdefault('map_paper', s['paper'])
    s.setdefault('map_paper_sha256', s['paper_sha256'])
    write(path, publication)
    s.update(revision=commit['revision'], paper=str(paper.relative_to(root)),
             paper_sha256=digest(paper), pending=None, last_request=a.id,
             article_authors=authors, article_publication_receipt=str(path.relative_to(root)),
             article_publication_receipt_sha256=digest(path))
    write(root / 'workspace.json', s)
    return s


def editorial_packet(root, a):
    s = state(root)
    require(not s.get('pending') and not s.get('repair'), 'finish active article or repair first')
    require(a.identity.strip() and Path(a.paper).read_text().strip(), 'article and author required')
    d = root / 'reviews' / ident(a.id)
    if (d / 'packet.json').exists():
        old = read(d / 'packet.json')
        require(old['schema'] == 'article-editorial-packet/v1', 'request ID already used')
        same_base(s, old)
    elif d.exists():
        allowed = {'paper.md', 'base-paper.md', 'base-workspace.json', 'basis.json',
                   'review-focus.json', 'maintenance-check.json'}
        require(all(x.name in allowed and x.is_file() for x in d.iterdir()), 'request ID already used')
    files = {'paper.md': freeze(a.paper, d / 'paper.md'),
             'base-paper.md': freeze(root / s['paper'], d / 'base-paper.md')}
    # Retain the exact previous authority and its receipt, not a new math Commit.
    snapshot = d / 'base-workspace.json'
    if snapshot.exists():
        previous = read(snapshot)
        require(previous['revision'] == s['revision'] and previous['paper_sha256'] == s['paper_sha256'], 'editorial base changed')
    else:
        write(snapshot, s)
    files['base-workspace.json'] = digest(snapshot)
    previous = read(snapshot)
    if previous.get('article_publication_receipt'):
        basis = root / previous['article_publication_receipt']
        require(digest(basis) == previous['article_publication_receipt_sha256'], 'previous article receipt changed')
    elif previous['revision'] == 0:
        basis = root / previous['baseline_provenance']
    else:
        # Older workspaces published article and map together; a later map-only
        # receipt may have replaced the pointer, so locate the article receipt.
        matches = []
        for path in (root / 'reviews').glob('*/published.json'):
            pub = read(path)
            if (pub.get('kind') == 'article-commit' and
                    pub.get('revision') == previous['revision'] and
                    pub.get('paper_sha256') == previous['paper_sha256']):
                require(published_request(root, previous, path.parent.name), 'previous publication incomplete')
                matches.append(path)
        require(len(matches) == 1, 'current article publication missing or ambiguous')
        basis = matches[0]
    files['basis.json'] = freeze(basis, d / 'basis.json')
    focus = dict(schema='article-editorial-focus/v1', authority='reading-index',
                 full_base='base-paper.md', full_article='paper.md',
                 integration_diff=''.join(difflib.unified_diff(
                     (d / 'base-paper.md').read_text().splitlines(True),
                     (d / 'paper.md').read_text().splitlines(True),
                     fromfile='published-article', tofile='editorial-candidate')))
    if (d / 'review-focus.json').exists():
        require(read(d / 'review-focus.json') == focus, 'editorial focus changed')
    else:
        write(d / 'review-focus.json', focus)
    files['review-focus.json'] = digest(d / 'review-focus.json')
    light = getattr(a, 'lightweight_check', None)
    if light:
        files['maintenance-check.json'] = freeze(light, d / 'maintenance-check.json')
    packet = dict(schema='article-editorial-packet/v1', base_revision=s['revision'],
                  base_paper_sha256=s['paper_sha256'], revision=s['revision'] + 1,
                  files=files, author_identity=a.identity,
                  article_authors=sorted(set(current_article_authors(root, s) + [a.identity])),
                  excluded_reviewers=sorted(set([a.identity] + a.exclude_reviewers)),
                  review_mode='lightweight' if light else 'independent')
    if (d / 'packet.json').exists():
        require(read(d / 'packet.json') == packet, 'editorial packet differs; use new ID')
    else:
        write(d / 'packet.json', packet)
    if light:
        editorial_check(d, packet, d / 'maintenance-check.json')
    return packet


def editorial_check(d, p, verdict):
    require(p['schema'] == 'article-editorial-packet/v1', 'not an editorial packet')
    checked(d, p['files'])
    base = read(d / 'base-workspace.json')
    require(base['revision'] == p['base_revision'] and base['paper_sha256'] == p['base_paper_sha256'] == p['files']['base-paper.md'], 'editorial base mismatch')
    require(p['revision'] == p['base_revision'] + 1, 'editorial revision mismatch')
    if p['review_mode'] == 'independent':
        v = review_binding(d, verdict, digest(d / 'packet.json'), p['excluded_reviewers'])
        require(v.get('verdict') == 'accepted-for-article', 'editorial review not passed')
    else:
        require(p['review_mode'] == 'lightweight', 'unknown editorial review mode')
        require(digest(verdict) == p['files']['maintenance-check.json'], 'editorial check changed')
        v = read(verdict)
        require(v.get('schema') == 'article-editorial-check/v1' and v.get('maintainer_identity') == p['author_identity'], 'editorial check identity mismatch')
        require(v.get('base_paper_sha256') == p['base_paper_sha256'] and v.get('paper_sha256') == p['files']['paper.md'], 'editorial check content mismatch')
        require(v.get('risk_flags') == [], 'editorial revision requires independent review')
    require(v.get('complete') is True and v.get('faithful') is True and v.get('issues') == [] and v.get('mathematics_changed') is False, 'editorial fidelity not confirmed')
    require(isinstance(v.get('coverage'), str) and v['coverage'].strip(), 'actual editorial coverage required')
    return v


def publish_editorial(root, a):
    s = state(root)
    d = root / 'reviews' / ident(a.id)
    p = read(d / 'packet.json')
    editorial_check(d, p, a.verdict)
    path = d / 'article-published.json'
    publication = dict(schema='fact-article-publication/v1', kind='editorial',
                       request_id=a.id, revision=p['revision'], paper_sha256=p['files']['paper.md'],
                       basis_sha256=p['files']['basis.json'],
                       base_paper_sha256=p['base_paper_sha256'],
                       base_workspace_sha256=p['files']['base-workspace.json'],
                       packet_sha256=digest(d / 'packet.json'), verdict_sha256=digest(a.verdict))
    if path.exists():
        require(read(path) == publication, 'editorial publication differs')
        if s['revision'] >= p['revision']:
            # Only a publication present in the article ancestry is an idempotent retry.
            cursor = s
            while cursor.get('article_publication_receipt'):
                rp = root / cursor['article_publication_receipt']
                require(digest(rp) == cursor['article_publication_receipt_sha256'], 'article history changed')
                if rp == path:
                    return s
                pub = read(rp)
                if pub.get('kind') != 'editorial':
                    break
                old = rp.parent / 'base-workspace.json'
                require(digest(old) == pub['base_workspace_sha256'], 'editorial ancestry changed')
                cursor = read(old)
            require(False, 'stale editorial publication; current article is not its descendant')
    require(not s.get('pending') and not s.get('repair'), 'finish active article or repair first')
    same_base(s, p)
    freeze(a.verdict, d / 'verdict.json')
    write(path, publication)
    s.setdefault('map_revision', s['revision'])
    s.setdefault('map_paper', s['paper'])
    s.setdefault('map_paper_sha256', s['paper_sha256'])
    s.update(revision=p['revision'], paper=str((d / 'paper.md').relative_to(root)),
             paper_sha256=p['files']['paper.md'], article_authors=p['article_authors'],
             article_publication_receipt=str(path.relative_to(root)),
             article_publication_receipt_sha256=digest(path))
    write(root / 'workspace.json', s)
    return s


def map_objects(m):
    """Object identities for a reading diff, not a semantic impact verdict."""
    result = {('entry', e['id']): e for e in m['entries']}
    result.update({('inference', e['id']): e for e in m['inferences']})
    entries = {e['id']: e for e in m['entries']}
    result.update({('b0', eid): entries[eid] for eid in m['b0ClaimEntryIds']})
    result.update({('negationPair', str(i)): pair for i, pair in enumerate(m['negationPairs'])})
    return result


def map_review_focus(root, q, s, revision):
    """Locate a verified earlier review and expose changes for the reviewer."""
    current = read(q / 'math-map.json'); objects = map_objects(current)
    focus = dict(schema='map-review-focus/v1', authority='reading-index',
                 suggested_scope='full', previous_review=None,
                 instruction='Review changed source and objects, affected dependencies, and Entry quality. Unchanged objects are reuse candidates only; assess semantic impact and source locations before carrying prior judgments. No automatic acceptance.')
    old = {}; old_text = ''
    if s.get('publication_receipt'):
        pubpath = root / s['publication_receipt']; pub = read(pubpath)
        if pub['revision'] <= revision:
            request = root / 'reviews' / ident(pub['request_id'])
            matches = [p for p in (request / 'maps').glob('*/packet.json') if digest(p) == pub['map_packet_sha256']]
            require(len(matches) == 1, 'published map review packet missing or ambiguous')
            previous = matches[0].parent; packet = read(matches[0]); checked(previous, packet['files'])
            require(digest(previous / 'verdict.json') == pub['map_verdict_sha256'], 'published map verdict changed')
            require(packet['revision'] == pub['revision'] and packet['files']['paper.md'] == pub['paper_sha256'] and packet['files']['math-map.json'] == pub['map_sha256'], 'published map basis changed')
            verdict = review_binding(previous, previous / 'verdict.json', digest(matches[0]), packet['excluded_reviewers'])
            require(verdict.get('verdict') == 'accepted-for-projection', 'published map has no passing review')
            old = map_objects(read(previous / 'math-map.json'))
            old_text = (previous / 'paper.md').read_text()
            focus.update(suggested_scope='incremental', previous_review={
                name: dict(path=str((previous / name).relative_to(root)), sha256=digest(previous / name))
                for name in ['packet.json', 'verdict.json', 'paper.md', 'math-map.json']})
    def refs(keys): return [dict(kind=k, id=i) for k, i in sorted(keys)]
    added = objects.keys() - old.keys(); removed = old.keys() - objects.keys()
    changed = {k for k in objects.keys() & old.keys() if objects[k] != old[k]}
    unchanged = (objects.keys() & old.keys()) - changed
    focus.update(added=refs(added), changed=refs(changed), removed=refs(removed), reuse_candidates=refs(unchanged))
    changed_entries = {i for k, i in added | changed | removed if k in ['entry', 'b0']}
    touched = set()
    for key, obj in list(old.items()) + list(objects.items()):
        if key[0] == 'inference' and (key in added | changed | removed or changed_entries & set(obj['premises'] + [obj['conclusion']])):
            touched.add(key); touched.update(('entry', i) for i in obj['premises'] + [obj['conclusion']])
        elif key[0] == 'negationPair' and (key in added | changed | removed or changed_entries & set(obj['claimEntryIds'])):
            touched.add(key); touched.update(('entry', i) for i in obj['claimEntryIds'])
    focus['related_objects_to_inspect'] = refs(touched & objects.keys())
    focus['article_diff'] = ''.join(difflib.unified_diff(old_text.splitlines(True), (q / 'paper.md').read_text().splitlines(True), fromfile='previous-reviewed-article', tofile='current-article'))
    return focus


def map_packet(root, a):
    s = state(root)
    active_request(s, a.id)
    d = root / 'reviews' / ident(a.id)
    if getattr(a, 'current', False):
        require(not (d / 'commit.json').exists(), 'cannot mix map-only review with commit')
        projection = dict(base_revision=s['revision'], base_paper_sha256=s['paper_sha256'], base_map_sha256=s['map_sha256'],
                          base_publication_receipt_sha256=s.get('publication_receipt_sha256'))
        if (d / 'projection-request.json').exists():
            if 'base_publication_receipt_sha256' not in read(d / 'projection-request.json'):
                projection.pop('base_publication_receipt_sha256', None)
            require(read(d / 'projection-request.json') == projection, 'stale projection request')
        else:
            freeze(root / s['paper'], d / 'paper.md')
            write(d / 'projection-request.json', projection)
        receipt = dict(revision=s['revision'], paper_sha256=s['paper_sha256'])
        authors = current_article_authors(root, s)
        paper_source = d / 'paper.md'
    else:
        require(s.get('pending') == a.id or published_request(root, s, a.id), 'no matching accepted article')
        article_ready(d)
        paper_source, receipt, authors = article_binding(root, a.id)
    # This review compares the extraction to the source, not the source's proof.
    excluded = [a.identity] + getattr(a, 'exclude_reviewers', [])
    require(digest(paper_source) == receipt['paper_sha256'], 'accepted article changed')
    m = read(a.map)
    require(set(m) == {'entries', 'inferences', 'b0ClaimEntryIds', 'negationPairs'}, 'strict map required')
    check, validation = read(a.source_check), read(a.validation)
    require(check.get('source_sha256') == receipt['paper_sha256'], 'source check belongs to another paper')
    require(validation.get('source_sha256') == receipt['paper_sha256'] and validation.get('map_sha256') == digest(a.map) and validation.get('errors') == [] and validation.get('validator'), 'missing or mismatched semantic validation')
    # Semantic validation belongs to to-map and its recorded report, not a second closure engine.
    q = d / 'maps' / ident(a.round)
    files = {}
    for name, source in [('paper.md', paper_source), ('math-map.json', a.map), ('source-check.json', a.source_check), ('validation.json', a.validation)]:
        files[name] = freeze(source, q / name)
    # Existing packets retain their exact bytes and old review obligations.
    existing = read(q / 'packet.json') if (q / 'packet.json').exists() else None
    if existing is None or 'review-focus.json' in existing['files']:
        focus_path = q / 'review-focus.json'
        if not focus_path.exists():
            require(existing is None, 'review focus missing')
            write(focus_path, map_review_focus(root, q, s, receipt['revision']))
        files['review-focus.json'] = digest(focus_path)
    packet = dict(schema='article-map-review-packet/v1', revision=receipt['revision'], files=files,
                  excluded_reviewers=sorted(set(excluded)), article_authors=sorted(set(authors)))
    if (d / 'article.json').exists(): packet['article_receipt_sha256'] = digest(d / 'article.json')
    if (q / 'packet.json').exists():
        require(read(q / 'packet.json') == packet, 'map round differs')
    else:
        write(q / 'packet.json', packet)
    return packet

def validate_map_review_sources(verdict, math_map, paper):
    """Validate review evidence records, not their mathematical truth."""
    lines = paper.splitlines()
    require(bool(lines), 'reviewed paper is empty')

    def nonempty(value):
        return isinstance(value, str) and bool(value.strip())

    def locator(record):
        loc = record.get('source_locator')
        require(isinstance(loc, dict) and nonempty(loc.get('heading')), 'invalid source_locator heading')
        start, end = loc.get('line_start'), loc.get('line_end')
        require(type(start) is int and type(end) is int and 1 <= start <= end <= len(lines),
                'source_locator lines outside reviewed paper')
        return start, end

    assessments = verdict.get('assessments')
    require(isinstance(assessments, list), 'map assessments incomplete')
    for item in assessments:
        require(isinstance(item, dict) and nonempty(item.get('reason')), 'invalid map assessment')
        locator(item)

    coverage = verdict.get('source_coverage')
    require(isinstance(coverage, list) and bool(coverage), 'source_coverage missing or empty')
    object_ids = {x['id'] for x in math_map['entries'] + math_map['inferences']}
    intervals = []
    for item in coverage:
        require(isinstance(item, dict), 'invalid source_coverage record')
        intervals.append(locator(item))
        require(nonempty(item.get('reason')), 'source_coverage reason required')
        ids = item.get('mapped_object_ids')
        require(isinstance(ids, list) and all(isinstance(i, str) and i in object_ids for i in ids),
                'source_coverage references unknown object')
        require(len(ids) == len(set(ids)), 'duplicate source_coverage object reference')
        disposition = item.get('disposition')
        require((disposition == 'covered' and bool(ids)) or
                (disposition == 'not-extracted-justified' and not ids),
                'source_coverage disposition conflicts with mapped objects')
    # Merge overlapping ranges; overlaps must not hide an omitted source interval.
    end = 0
    for start, stop in sorted(intervals):
        require(not any(line.strip() for line in lines[end:start - 1]), 'source_coverage has uncovered source lines')
        end = max(end, stop)
    require(not any(line.strip() for line in lines[end:]), 'source_coverage has uncovered source lines')


def publish(root, a):
    s = state(root)
    d = root / 'reviews' / ident(a.id)
    if not (d / 'published.json').exists(): active_request(s, a.id)
    map_only = (d / 'projection-request.json').exists()
    if map_only:
        base = read(d / 'projection-request.json')
        receipt = dict(revision=base['base_revision'], paper_sha256=base['base_paper_sha256'])
        receipt_file = d / 'projection-request.json'
    else:
        article_ready(d)
        receipt = read(d / 'commit.json')
        cp = read(d / 'packet.json')
        checked(d, cp['files'])
        require(digest(d / 'packet.json') == receipt['packet_sha256'] and digest(d / 'verdict.json') == receipt['verdict_sha256'], 'commit archive changed')
        review_binding(d, d / 'verdict.json', receipt['packet_sha256'], cp['excluded_reviewers'])
        _, receipt, _ = article_binding(root, a.id)
        receipt_file = d / 'commit.json'
    q = d / 'maps' / ident(a.round)
    p = read(q / 'packet.json')
    checked(q, p['files'])
    if (d / 'article.json').exists():
        if p.get('article_receipt_sha256') or 'previous-article.json' in read(d / 'articles' / read(d / 'article.json')['round'] / 'packet.json')['files']:
            require(p.get('article_receipt_sha256') == digest(d / 'article.json'), 'map belongs to an older article integration')
    require(p['revision'] == receipt['revision'] and p['files']['paper.md'] == receipt['paper_sha256'], 'wrong reviewed paper')
    v = review_binding(q, a.verdict, digest(q / 'packet.json'), p['excluded_reviewers'])
    require(v.get('verdict') == 'accepted-for-projection' and v.get('score') == 100 and v.get('coverageRatio') == 1 and v.get('sourceClean') is True, 'map review not passed')
    require(all(v.get(k) == [] for k in ['omissions', 'distortions', 'fabrications', 'unresolved']), 'map review has issues')
    m = read(q / 'math-map.json')
    expected = {('entry', x['id']) for x in m['entries']} | {('inference', x['id']) for x in m['inferences']} | {('b0', x) for x in m['b0ClaimEntryIds']} | {('negationPair', str(i)) for i, _ in enumerate(m['negationPairs'])}
    # Historical receipts remain replayable only with the exact bindings checked below.
    if not (d / 'published.json').exists():
        validate_map_review_sources(v, m, (q / 'paper.md').read_text())
    assessments = v.get('assessments', [])
    require(len(assessments) == len(expected) and {(x['kind'], x['id']) for x in assessments} == expected and all(x.get('disposition') == 'faithful' and x.get('source_locator') and x.get('reason') for x in assessments), 'map assessments incomplete')
    publication = dict(schema='article-publication/v1', request_id=a.id, revision=receipt['revision'],
                       basis_sha256=digest(receipt_file), kind='map-only' if map_only else 'article-commit', map_packet_sha256=digest(q / 'packet.json'),
                       map_verdict_sha256=digest(a.verdict), paper_sha256=p['files']['paper.md'], map_sha256=p['files']['math-map.json'])
    previous = read(d / 'published.json') if (d / 'published.json').exists() else s
    for key in ['publication_receipt', 'publication_receipt_sha256']:
        value = previous.get('previous_' + key) if (d / 'published.json').exists() else previous.get(key)
        if value: publication['previous_' + key] = value
    if (d / 'published.json').exists():
        require(read(d / 'published.json') == publication, 'publication receipt differs')
        if publication_in_history(root, s, d / 'published.json'): return s
    if s.get('article_publication_receipt') or (d / 'article-published.json').exists():
        if not map_only:
            if s.get('pending') == a.id and not published_request(root, s, a.id):
                s = publish_article(root, a)  # Resume callers using the old combined command.
            require(published_request(root, s, a.id), 'publish the checked article before its map')
        require(receipt['revision'] <= s['revision'], 'map source article not published')
        # A late map may advance a lagging map head, but can never rewind it.
        # At the same source revision, a projection must still match its base.
        archived_only = receipt['revision'] < s.get('map_revision', s['revision']) or (
            not map_only and receipt['revision'] == s.get('map_revision', s['revision']) and bool(s.get('publication_receipt')))
        if not archived_only and map_only:
            require(s['map_sha256'] == base['base_map_sha256'], 'stale projection base')
            require('base_publication_receipt_sha256' in base and s.get('publication_receipt_sha256') == base['base_publication_receipt_sha256'], 'stale projection publication')
        freeze(a.verdict, q / 'verdict.json')
        write(d / 'published.json', publication)
        if archived_only: return s
        s.update(map=str((q / 'math-map.json').relative_to(root)), map_sha256=p['files']['math-map.json'],
                 map_revision=receipt['revision'], map_paper=str((q / 'paper.md').relative_to(root)),
                 map_paper_sha256=p['files']['paper.md'], map_review='independent-passed',
                 publication_receipt=str((d / 'published.json').relative_to(root)),
                 publication_receipt_sha256=digest(d / 'published.json'))
        # Only map fields move: a newer article, pending increment and authors survive.
        write(root / 'workspace.json', s)
        return s
    active_request(s, a.id)
    if s['revision'] == receipt['revision'] and s.get('last_request') == a.id:
        require((d / 'published.json').is_file() and s['map_sha256'] == publication['map_sha256'] and s['paper_sha256'] == publication['paper_sha256'], 'different artifacts already published')
        return s
    require(map_only or s.get('pending') == a.id, 'no matching pending publication')
    if map_only:
        same_base(s, base)
        require(not s.get('pending'), 'commit pending during map-only publication')
        require(s['map_sha256'] == base['base_map_sha256'], 'stale projection base')
        if 'base_publication_receipt_sha256' in base:
            require(s.get('publication_receipt_sha256') == base['base_publication_receipt_sha256'], 'stale projection publication')
        elif (d / 'published.json').exists() and s.get('publication_receipt'):
            require(publication.get('previous_publication_receipt_sha256') == s.get('publication_receipt_sha256'), 'historical map receipt cannot replace current publication')
        else:
            require(not s.get('publication_receipt'), 'legacy projection lacks publication basis; prepare a new map request')
    freeze(a.verdict, q / 'verdict.json')
    write(d / 'published.json', publication)
    s.update(revision=receipt['revision'], paper=str((q / 'paper.md').relative_to(root)), map=str((q / 'math-map.json').relative_to(root)),
             paper_sha256=p['files']['paper.md'], map_sha256=p['files']['math-map.json'], pending=None,
             map_review='independent-passed', last_request=a.id)
    s['article_authors'] = sorted(set(current_article_authors(root, state(root))) |
                                 set(p.get('article_authors', []) if map_only else article_binding(root, a.id)[2]))
    s['publication_receipt'] = str((d / 'published.json').relative_to(root))
    s['publication_receipt_sha256'] = digest(d / 'published.json')
    # workspace.json is the authoritative atomic pointer. Reading links are recoverable conveniences.
    write(root / 'workspace.json', s)
    return s

def links(root):
    s = state(root)
    for name, source in [('paper.md', s['paper']), ('math-map.json', s['map'])]:
        p = root / name
        require(not p.exists() or p.is_symlink(), f'refuse to replace regular file: {p}')
        tmp = root / ('.' + name + '.link')
        if tmp.is_symlink():
            tmp.unlink()
        tmp.symlink_to(source)
        os.replace(tmp, p)
    return s

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    sub = parser.add_subparsers(dest='command', required=True)
    for cmd in ['status', 'links', 'trajectory']:
        sub.add_parser(cmd)
    p = sub.add_parser('initialize'); p.add_argument('--paper', required=True); p.add_argument('--map', required=True); p.add_argument('--provenance', required=True)
    p = sub.add_parser('start'); p.add_argument('id'); p.add_argument('--objective', required=True); p.add_argument('--identity', required=True); p.add_argument('--grilling', required=True); p.add_argument('--source', dest='sources', action='append', default=[]); p.add_argument('--repair-of', help='revise this unpublished increment; pauses its publication')
    p = sub.add_parser('finish'); p.add_argument('id'); p.add_argument('--outcome', choices=['candidate','no_change','failed','interrupted'], required=True); p.add_argument('--transcript', required=True); p.add_argument('--delta'); p.add_argument('--evidence', action='append', default=[])
    p = sub.add_parser('prepare'); p.add_argument('id'); p.add_argument('attempts', nargs='+'); p.add_argument('--identity', required=True); p.add_argument('--exclude-reviewer', dest='exclude_reviewers', action='append', default=[]); p.set_defaults(increment_only=True)
    p = sub.add_parser('accept'); p.add_argument('id'); p.add_argument('--verdict', required=True)
    p = sub.add_parser('import-review'); p.add_argument('id'); p.add_argument('--round'); p.add_argument('--article-round'); p.add_argument('--rollout', required=True); p.add_argument('--verdict', required=True); p.add_argument('--agent-path', required=True); p.add_argument('--model', default='gpt-5.6-sol'); p.add_argument('--effort', default='medium')
    p = sub.add_parser('article-packet'); p.add_argument('id'); p.add_argument('round'); p.add_argument('--paper', required=True); p.add_argument('--identity', required=True); p.add_argument('--lightweight-check')
    p = sub.add_parser('update-article'); p.add_argument('id'); p.add_argument('round'); p.add_argument('--verdict', required=True)
    p = sub.add_parser('publish-article'); p.add_argument('id')
    p = sub.add_parser('editorial-packet'); p.add_argument('id'); p.add_argument('--paper', required=True); p.add_argument('--identity', required=True); p.add_argument('--lightweight-check'); p.add_argument('--exclude-reviewer', dest='exclude_reviewers', action='append', default=[])
    p = sub.add_parser('publish-editorial'); p.add_argument('id'); p.add_argument('--verdict', required=True)
    p = sub.add_parser('map-packet'); p.add_argument('id'); p.add_argument('round'); p.add_argument('--map', required=True); p.add_argument('--source-check', required=True); p.add_argument('--validation', required=True); p.add_argument('--identity', required=True); p.add_argument('--current', action='store_true'); p.add_argument('--exclude-reviewer', dest='exclude_reviewers', action='append', default=[])
    p = sub.add_parser('publish'); p.add_argument('id'); p.add_argument('round'); p.add_argument('--verdict', required=True)
    a = parser.parse_args(); root = a.root.resolve()
    (root / '.workflow').mkdir(exist_ok=True)
    with (root / '.workflow/lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if a.command == 'status':
            result = state(root)
        elif a.command == 'links':
            result = links(root)
        elif a.command == 'trajectory':
            result = []
            for d in sorted((root / 'attempts').glob('*')):
                if not (d / 'run.json').exists():
                    result.append({'id': d.name, 'phase': 'partial'}); continue
                run = read(d / 'run.json'); checked(d, run['files'])
                item = {'run': run, 'phase': 'active'}
                if (d / 'result.json').exists():
                    r = read(d / 'result.json'); checked(d, r['files'])
                    require(r['run_sha256'] == digest(d / 'run.json'), 'run changed')
                    item.update(result=r, phase='complete')
                result.append(item)
        else:
            result = globals()[a.command.replace('-', '_')](root, a)
            if a.command in ['publish', 'publish-article', 'publish-editorial']:
                links(root)
        print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError) as exc:
        raise SystemExit(str(exc))
