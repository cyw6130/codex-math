#!/usr/bin/env python3
"""Prepare one authorized round; never manufacture a mathematical review."""
import argparse
import fcntl
import json
from pathlib import Path
from types import SimpleNamespace
import article_flow as f


def local_file(base, name):
    f.require(isinstance(name, str) and name and not Path(name).is_absolute(), 'relative round file required')
    p = (base / name).resolve()
    f.require(p.is_relative_to(base.resolve()) and p.is_file(), 'round file missing or escapes directory')
    return p


def validate_exploration_record(data, round_dir, run_dir, run, result):
    """Check the final round's claims of progress against frozen source records."""
    def nonempty(value):
        return isinstance(value, str) and bool(value.strip())

    def refs(values):
        f.require(isinstance(values, list) and values and all(nonempty(x) for x in values), 'exploration evidence references required')
        allowed = set(run['files'].values()) | {sha for name, sha in result['files'].items() if name.startswith('evidence/')}
        for value in values:
            if value.startswith('attempt:'):
                name = value.removeprefix('attempt:')
                f.require(name in run['files'] or name in result['files'], 'unknown attempt reference')
                path = run_dir / name
            else:
                path = local_file(round_dir, value)
            f.require(f.digest(path) in allowed, 'exploration reference is not frozen Evidence or baseline')

    questions = set()
    for q in data['questions']:
        f.require(isinstance(q, dict) and nonempty(q.get('id')) and q['id'] not in questions, 'invalid exploration question identity')
        questions.add(q['id'])
        f.require(nonempty(q.get('statement')) and nonempty(q.get('motivation')), 'exploration question and motivation required')
        refs(q.get('sourceRefs'))
    observations = set()
    grounded_progress = False
    kinds = {'sharpen_question', 'distinguish_examples', 'identify_relationship', 'identify_obstruction', 'establish_result', 'exclude_direction'}
    for observation in data['observations']:
        f.require(isinstance(observation, dict) and nonempty(observation.get('id')) and observation['id'] not in observations, 'invalid observation identity')
        observations.add(observation['id'])
        f.require(observation.get('kind') in kinds and nonempty(observation.get('statement')), 'observation content required')
        ids = observation.get('questionIds')
        f.require(isinstance(ids, list) and ids and all(isinstance(x, str) and x in questions for x in ids), 'observation question references required')
        f.require(observation.get('status') in ['recorded', 'candidate', 'invalidated'], 'round observation is not a new mathematical acceptance')
        refs(observation.get('evidenceRefs'))
        if observation['status'] == 'recorded':
            grounded_progress = True
    if data['researchOutcome'] == 'understanding_advanced':
        f.require(grounded_progress, 'understanding progress requires a grounded recorded observation')


def prepare_round(root, round_path, policy_path):
    root, round_path, policy_path = Path(root).resolve(), Path(round_path).resolve(), Path(policy_path).resolve()
    r, policy = f.read(round_path), f.read(policy_path)
    f.require(r['schema'] in ['codex-math-round/v1','codex-math-round/v2'], 'wrong round schema')
    f.require(type(r['round']) is int and r['round'] > 0, 'invalid round number')
    f.require(policy.get('mode') == 'per_round_auto', 'automatic commit is not authorized')
    f.require(isinstance(policy.get('authorization'), str) and policy['authorization'].strip(), 'authorization source required')
    for key in ['target_id', 'contract_sha256']:
        f.require(isinstance(r.get(key), str) and r[key] and policy.get(key) == r[key], 'policy target/contract mismatch')
    f.ident(r['target_id'])
    f.require(len(r['contract_sha256']) == 64 and all(c in '0123456789abcdef' for c in r['contract_sha256']), 'invalid contract hash')
    research_mode = r.get('research_mode', 'proof')
    f.require(research_mode in ['proof', 'explore'] and policy.get('research_mode', 'proof') == research_mode, 'research mode mismatch')
    aid, request = f.ident(r['attempt_id']), f.ident(r['request_id'])
    d = root / 'rounds' / r['target_id'] / str(r['round'])
    f.require(r['schema']=='codex-math-round/v2' or (d/'binding.json').exists(), 'new rounds require v2 and dispatch closure; v1 is historical recovery only')
    summary = local_file(round_path.parent, r['summary'])
    f.require(summary.read_text().strip(), 'empty round summary')
    tasks = r['tasks']
    f.require(isinstance(tasks, list) and tasks, 'round task inventory required')
    f.require(len({x['id'] for x in tasks}) == len(tasks), 'duplicate round tasks')
    f.require(r['outcome'] in ['candidate', 'no_change', 'failed', 'interrupted'], 'invalid round outcome')
    if r['outcome'] in ['candidate', 'no_change']:
        f.require(all(x.get('status') == 'returned' for x in tasks), 'round barrier not reached')
    sources = []
    if r['schema'] == 'codex-math-round/v2' and r['outcome'] in ['candidate','no_change']:
        from dispatch_log import close
        closure_path=local_file(round_path.parent,r['closure'])
        f.require(closure_path.name=='closed.json', 'dispatch closure required')
        closure=f.read(closure_path)
        f.require(closure['schema']=='reasoning-round-closure/v1' and closure['attempt_id']==aid, 'wrong closure schema or attempt')
        f.require(close(closure_path.parent,closure['finished_at'])==closure, 'closure changed')
        by_id={t['id']:t for t in closure['tasks']}
        f.require(set(by_id)=={t['id'] for t in tasks}, 'round task inventory differs from closed dispatch journal')
        f.require(all(f.digest(local_file(round_path.parent,t['source']))==by_id[t['id']]['source_sha256'] for t in tasks), 'round source differs from returned evidence')
        sources.append(closure_path)
    exploration = None
    if research_mode == 'explore':
        exploration = local_file(round_path.parent, r['exploration'])
        data = f.read(exploration)
        f.require(isinstance(data, dict) and isinstance(data.get('questions'), list) and isinstance(data.get('observations'), list), 'exploration questions and observations required')
        f.require(data.get('researchOutcome') in ['understanding_advanced', 'no_verified_progress', 'invalidated'], 'invalid exploration outcome')
        f.require(data.get('targetId') == r['target_id'] and data.get('activeContractFingerprint') == r['contract_sha256'], 'exploration scope mismatch')
        sources.append(exploration)
    for task in tasks:
        if task.get('status') == 'returned':
            f.require(task.get('complete') is True, 'incomplete session source')
            source = local_file(round_path.parent, task['source'])
            f.require(source.read_text().strip(), 'empty session source')
            sources.append(source)
    run_dir = root / 'attempts' / aid
    run, result = f.read(run_dir / 'run.json'), f.read(run_dir / 'result.json')
    f.checked(run_dir, run['files']); f.checked(run_dir, result['files'])
    f.require(result['run_sha256'] == f.digest(run_dir / 'run.json'), 'attempt record changed')
    f.require(result['outcome'] == r['outcome'], 'round/attempt outcome mismatch')
    if r['schema']=='codex-math-round/v2' and r['outcome'] in ['candidate','no_change']:
        from dispatch_log import instant
        f.require(instant(closure['started_at']) >= instant(run['started_at']), 'dispatch predates attempt')
        f.require(closure['context_sha256'] in run['files'].values(), 'dispatch context is not frozen in attempt')
    if exploration is not None:
        validate_exploration_record(data, round_path.parent, run_dir, run, result)
    archived = set(result['files'].values())
    f.require(all(f.digest(p) in archived for p in [summary, *sources]), 'round sources and summary must be frozen as Evidence')
    authors = r['contributor_identities']
    f.require(isinstance(authors, list) and authors and all(isinstance(x, str) and x for x in authors), 'contributor identities required')
    f.require(r['author_identity'] in authors and run['agent_identity'] in authors, 'missing candidate author')
    f.require(all(t.get('author_identity') in authors for t in tasks if t.get('status') == 'returned'), 'missing session author')
    binding = dict(round_sha256=f.digest(round_path), policy_sha256=f.digest(policy_path), attempt_id=aid,
                   request_id=request, summary_sha256=f.digest(summary), source_sha256=[f.digest(p) for p in sources])
    binding_path = d / 'binding.json'
    if exploration is not None:
        binding['exploration_sha256'] = f.digest(exploration)
    if binding_path.exists():
        f.require(f.read(binding_path) == binding, 'round retry differs')
        f.require(f.digest(d / 'round.json') == binding['round_sha256'] and f.digest(d / 'policy.json') == binding['policy_sha256'], 'round archive changed')
    else:
        f.same_base(f.state(root), run)
        f.freeze(round_path, d / 'round.json'); f.freeze(policy_path, d / 'policy.json')
        f.write(binding_path, binding)
    if r['outcome'] != 'candidate':
        output = dict(status=r['outcome'], attempt_id=aid, request_id=None)
    else:
        packet_path = root / 'reviews' / request / 'packet.json'
        if packet_path.exists():
            packet = f.read(packet_path)
            f.checked(packet_path.parent, packet['files'])
            f.require(packet['selected'] == [aid] and packet['author_identity'] == r['author_identity'] and packet.get('additional_excluded_reviewers') == sorted(set(authors)), 'existing request differs')
        else:
            packet = f.prepare(root, SimpleNamespace(id=request, attempts=[aid], identity=r['author_identity'], exclude_reviewers=authors, increment_only=r['schema']=='codex-math-round/v2'))
        output = dict(status='prepared', attempt_id=aid, request_id=request, packet_sha256=f.digest(packet_path))
        commit_path = packet_path.parent / 'commit.json'
        if commit_path.exists():
            # Existing receipt is a recovery pointer, not a fresh approval. accept/publish revalidate it.
            output.update(status='resume_commit', commit_path=str(commit_path))
        progress = f.request_progress(root, request)
        output['status'] = progress['status']
        if progress['repair_chain']:
            output.update(progress, original_request_id=request)
            output.pop('packet_sha256', None); output.pop('commit_path', None)
            if progress['request_id']:
                current = root / 'reviews' / progress['request_id']
                output['packet_sha256'] = f.digest(current / 'packet.json')
                if (current / 'commit.json').exists(): output['commit_path'] = str(current / 'commit.json')
    f.write(d / 'status.json', output)
    return output


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('root', type=Path); p.add_argument('--round', required=True, type=Path)
    p.add_argument('--policy', required=True, type=Path)
    a = p.parse_args()
    with (a.root / '.workflow/lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        print(json.dumps(prepare_round(a.root, a.round, a.policy), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as exc:
        raise SystemExit(str(exc))
