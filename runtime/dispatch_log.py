#!/usr/bin/env python3
"""Journal local send intent and receipts; this module never sends messages."""
import argparse
from datetime import datetime, timedelta, timezone
import fcntl
import json
from pathlib import Path
import article_flow as f


def instant(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    f.require(dt.tzinfo is not None, 'time must include timezone')
    return dt.astimezone(timezone.utc)


def next_check(tasks, now, suggested):
    """The oldest absolute deadline must not be postponed by a newer dispatch."""
    current, planned = instant(now), instant(suggested)
    f.require(planned >= current, 'suggested check is in the past')
    deadlines = [instant(t['deadline_at']) for t in tasks if t['status'] in ['sending', 'sent', 'dispatch_unknown']]
    if any(t['status'] in ['sending', 'dispatch_unknown'] for t in tasks):
        return current.isoformat()
    return max(current, min([planned, *deadlines])).isoformat()


def prepare(directory, task_id, dialogue, prompt, context_sha256, now, attempt_id=None):
    f.require(not (Path(directory)/'closed.json').exists(), 'reasoning round is closed')
    d = Path(directory) / f.ident(task_id)
    f.require(dialogue.strip(), 'dialogue identity required')
    f.require(len(context_sha256) == 64 and all(c in '0123456789abcdef' for c in context_sha256), 'context hash required')
    instant(now)
    content = Path(prompt).read_text()
    f.require(content.strip() and task_id in content and context_sha256 in content, 'prompt must contain task ID and context hash')
    existing=[f.read(p) for p in Path(directory).glob('*/state.json') if p.parent.name != task_id]
    f.require(sum(x['binding']['dialogue']==dialogue for x in existing)<2, 'at most one supplemental task per dialogue in a round')
    binding = dict(task_id=task_id, dialogue=dialogue, prompt_sha256=f.digest(prompt), context_sha256=context_sha256)
    if attempt_id is not None:binding['attempt_id']=f.ident(attempt_id)
    p = d / 'state.json'
    if p.exists():
        state = f.read(p)
        f.require(state['binding'] == binding, 'dispatch retry differs')
        f.require(f.digest(d/'prompt.md') == binding['prompt_sha256'], 'saved prompt changed')
        return state
    f.freeze(prompt, d/'prompt.md')
    state = dict(binding=binding, status='prepared', prepared_at=now, events=[])
    f.write(p, state)
    return state


def transition(directory, task_id, action, now, evidence=None):
    f.require(not (Path(directory)/'closed.json').exists(), 'reasoning round is closed')
    d = Path(directory)/f.ident(task_id); p=d/'state.json'; state=f.read(p)
    f.checked(d, {e['evidence']: e['sha256'] for e in state['events'] if 'evidence' in e})
    timestamp=instant(now)
    last = state['events'][-1]['at'] if state['events'] else state['prepared_at']
    f.require(timestamp >= instant(last), 'event time went backwards')
    f.require(f.digest(d/'prompt.md') == state['binding']['prompt_sha256'], 'saved prompt changed')
    allowed = {'sending': ['prepared','not_sent'], 'sent': ['sending','dispatch_unknown'],
               'unknown': ['sending'], 'found': ['sending','dispatch_unknown'],
               'absent': ['sending','dispatch_unknown'], 'returned': ['sent']}
    f.require(action in allowed and state['status'] in allowed[action], 'illegal dispatch transition; inspect existing dialogue before retry')
    event = dict(action=action, at=now)
    if action in ['sent','found','absent','returned']:
        f.require(evidence is not None and Path(evidence).is_file() and Path(evidence).read_text().strip(), 'actual receipt or inspection evidence required')
        filename=f"evidence/{f.digest(evidence)}.txt"
        event.update(evidence=filename, sha256=f.freeze(evidence,d/filename))
    if action=='sending':
        state.update(status='sending', sent_started_at=now, deadline_at=(timestamp+timedelta(minutes=120)).isoformat())
    elif action in ['sent','found']:
        state['status']='sent'  # Preserve deadline from before the external send.
    elif action=='unknown':state['status']='dispatch_unknown'
    elif action=='absent':state['status']='not_sent'
    elif action=='returned':state['status']='returned'
    state['events'].append(event); f.write(p,state);return state


def close(directory, now):
    directory=Path(directory); end=instant(now)
    paths=sorted(directory.glob('*/state.json'))
    states=[f.read(p) for p in paths]
    f.require(all(p.parent.name==s['binding']['task_id'] for p,s in zip(paths,states)), 'dispatch task identity differs from directory')
    f.require(states and all(s['status']=='returned' for s in states), 'round barrier not reached')
    dialogues={};tasks=[];starts=[]
    attempts={s['binding'].get('attempt_id') for s in states}
    f.require(len(attempts)==1 and None not in attempts, 'dispatch journal must bind one attempt')
    contexts={s['binding']['context_sha256'] for s in states}
    f.require(len(contexts)==1, 'all tasks must share the frozen round context')
    for s in states:
        b=s['binding'];d=directory/f.ident(b['task_id'])
        f.require(f.digest(d/'prompt.md')==b['prompt_sha256'], 'prompt changed')
        f.checked(d,{e['evidence']:e['sha256'] for e in s['events'] if 'evidence' in e})
        starts.append(min(instant(e['at']) for e in s['events'] if e['action']=='sending'))
        f.require(s['events'][-1]['action']=='returned' and instant(s['events'][-1]['at'])<=end, 'return after round close')
        dialogues[b['dialogue']]=dialogues.get(b['dialogue'],0)+1
        f.require(dialogues[b['dialogue']]<=2, 'at most one supplemental task per dialogue in a round')
        tasks.append(dict(id=b['task_id'],dialogue=b['dialogue'],state_sha256=f.digest(d/'state.json'),source_sha256=s['events'][-1]['sha256']))
    record=dict(schema='reasoning-round-closure/v1',attempt_id=next(iter(attempts)),context_sha256=next(iter(contexts)),started_at=min(starts).isoformat(),finished_at=end.isoformat(),tasks=tasks)
    p=directory/'closed.json'
    if p.exists():f.require(f.read(p)==record, 'closure retry differs')
    else:f.write(p,record)
    return record


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory',type=Path)
    sub=p.add_subparsers(dest='command',required=True)
    s=sub.add_parser('prepare');s.add_argument('id');s.add_argument('--dialogue',required=True);s.add_argument('--prompt',required=True);s.add_argument('--context',required=True);s.add_argument('--attempt',required=True);s.add_argument('--now',required=True)
    s=sub.add_parser('transition');s.add_argument('id');s.add_argument('action',choices=['sending','sent','unknown','found','absent','returned']);s.add_argument('--now',required=True);s.add_argument('--evidence')
    s=sub.add_parser('close');s.add_argument('--now',required=True)
    s=sub.add_parser('next-check');s.add_argument('--now',required=True);s.add_argument('--suggested',required=True)
    a=p.parse_args();a.directory.mkdir(parents=True,exist_ok=True)
    with (a.directory/'lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if a.command=='prepare':result=prepare(a.directory,a.id,a.dialogue,a.prompt,a.context,a.now,a.attempt)
        elif a.command=='transition':result=transition(a.directory,a.id,a.action,a.now,a.evidence)
        elif a.command=='close':result=close(a.directory,a.now)
        else:result={'next_check':next_check([f.read(x) for x in a.directory.glob('*/state.json')],a.now,a.suggested)}
        print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    try:main()
    except (ValueError,OSError,KeyError,TypeError) as e:raise SystemExit(str(e))
