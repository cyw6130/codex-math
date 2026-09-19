"""Construct already-existing v1 archives for compatibility tests only."""
from pathlib import Path
import article_flow as f
import round_flow as rf

def prepare(root,round_path,policy_path):
    r=f.read(round_path);root=Path(root);base=Path(round_path).parent
    d=root/'rounds'/r['target_id']/str(r['round'])
    if not (d/'binding.json').exists():
        sources=[]
        if r.get('research_mode')=='explore':sources.append(base/r['exploration'])
        sources += [base/t['source'] for t in r['tasks'] if t.get('status')=='returned']
        binding=dict(round_sha256=f.digest(round_path),policy_sha256=f.digest(policy_path),attempt_id=r['attempt_id'],request_id=r['request_id'],summary_sha256=f.digest(base/r['summary']),source_sha256=[f.digest(p) for p in sources])
        if r.get('research_mode')=='explore':binding['exploration_sha256']=f.digest(base/r['exploration'])
        f.freeze(round_path,d/'round.json');f.freeze(policy_path,d/'policy.json');f.write(d/'binding.json',binding)
    return rf.prepare_round(root,round_path,policy_path)
