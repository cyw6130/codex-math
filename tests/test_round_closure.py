import unittest
from types import SimpleNamespace as NS
from datetime import datetime,timedelta,timezone
import test_view_data as fixtures
import article_flow as f
import dispatch_log as dl
import round_flow as rf
class RoundClosure(unittest.TestCase):
    setUp=fixtures.ViewTests.setUp
    def close(self,outcome='no_change'):
        (self.r/'context.md').write_text('Frozen fixture context: Definition A.')
        context=f.digest(self.r/'context.md')
        f.start(self.r,NS(id='r1',identity='author',objective='fixture',grilling=self.r/'goal.md',sources=[self.r/'context.md']))
        start=datetime.now(timezone.utc)
        self.dispatch=self.r/'dispatch'
        (self.r/'prompt.md').write_text('t1 '+context+'\nTest prompt')
        dl.prepare(self.dispatch,'t1','dialogue',self.r/'prompt.md',context,start.isoformat(),attempt_id='r1')
        dl.transition(self.dispatch,'t1','sending',start.isoformat())
        dl.transition(self.dispatch,'t1','sent',(start+timedelta(seconds=1)).isoformat(),self.r/'raw.md')
        with self.assertRaises(ValueError):dl.close(self.dispatch,(start+timedelta(seconds=2)).isoformat())
        dl.transition(self.dispatch,'t1','returned',(start+timedelta(seconds=3)).isoformat(),self.r/'raw.md')
        dl.close(self.dispatch,(start+timedelta(seconds=4)).isoformat())
        self.round.update(schema='codex-math-round/v2',closure='dispatch/closed.json',outcome=outcome)
        f.write(self.r/'round.json',self.round)
        delta=None
        if outcome=='candidate':
            delta=self.r/'delta.json';f.write(delta,dict(edits=[dict(before='Definition A.',after='Definition A.\nObservation B.')],rationale='Fixture'))
        f.finish(self.r,NS(id='r1',outcome=outcome,transcript=self.r/'raw.md',delta=delta,evidence=[self.r/'raw.md',self.r/'summary.md',self.r/'exploration.json',self.dispatch/'closed.json']))
    def test_completed_reasoning_round_prepares_increment_only(self):
        self.close('candidate');result=rf.prepare_round(self.r,self.r/'round.json',self.r/'policy.json')
        self.assertEqual(result['status'],'prepared');self.assertFalse((self.r/'reviews/c1/paper.md').exists())
        self.assertEqual(f.read(self.r/'reviews/c1/packet.json')['schema'],'research-increment-packet/v2')
    def test_no_change_round_no_commit_and_closed_cannot_dispatch(self):
        self.close();result=rf.prepare_round(self.r,self.r/'round.json',self.r/'policy.json');self.assertEqual(result['status'],'no_change')
        self.assertFalse((self.r/'reviews').exists())
        with self.assertRaises(ValueError):dl.prepare(self.dispatch,'t2','dialogue',self.r/'prompt.md','a'*64,f.now())
    def test_partial_inventory_or_changed_closure_rejected(self):
        self.close();self.round['tasks'].append(dict(id='omitted',status='returned',complete=True,source='raw.md',author_identity='session'));f.write(self.r/'round.json',self.round)
        with self.assertRaisesRegex(ValueError,'inventory'):rf.prepare_round(self.r,self.r/'round.json',self.r/'policy.json')
    def test_interrupted_round_never_commits_partial_results(self):
        self.close('interrupted');self.round['tasks'][0]['status']='dispatch_unknown';f.write(self.r/'round.json',self.round)
        self.assertEqual(rf.prepare_round(self.r,self.r/'round.json',self.r/'policy.json')['status'],'interrupted')
        self.assertFalse((self.r/'reviews').exists())

    def test_fresh_legacy_round_cannot_bypass_closure(self):
        self.close();self.round['schema']='codex-math-round/v1';self.round.pop('closure');f.write(self.r/'round.json',self.round)
        with self.assertRaisesRegex(ValueError,'new rounds require v2'):rf.prepare_round(self.r,self.r/'round.json',self.r/'policy.json')
    def test_wrong_attempt_or_unfrozen_context_rejected(self):
        self.close();path=self.dispatch/'closed.json';v=f.read(path);v['attempt_id']='other';f.write(path,v)
        with self.assertRaisesRegex(ValueError,'attempt'):rf.prepare_round(self.r,self.r/'round.json',self.r/'policy.json')
    def test_dispatch_before_attempt_rejected(self):
        self.close();path=self.r/'attempts/r1/run.json';run=f.read(path);run['started_at']='2099-01-01T00:00:00+00:00';f.write(path,run)
        result=f.read(self.r/'attempts/r1/result.json');result['run_sha256']=f.digest(path);f.write(self.r/'attempts/r1/result.json',result)
        with self.assertRaisesRegex(ValueError,'predates'):rf.prepare_round(self.r,self.r/'round.json',self.r/'policy.json')
    def test_mixed_context_refused(self):
        self.close();path=self.dispatch/'t1/state.json';s=f.read(path);s['binding']['task_id']='t2';s['binding']['context_sha256']='b'*64
        import shutil
        shutil.copytree(self.dispatch/'t1',self.dispatch/'t2');f.write(self.dispatch/'t2/state.json',s)
        with self.assertRaisesRegex(ValueError,'share the frozen'):dl.close(self.dispatch,f.read(self.dispatch/'closed.json')['finished_at'])

    def test_documented_round_directory_layout(self):
        self.close('candidate')
        import shutil
        round_dir=self.r/'project/research/results/topic/round-1';round_dir.mkdir(parents=True)
        for name in ['round.json','policy.json','raw.md','summary.md','exploration.json']:
            shutil.copy2(self.r/name,round_dir/name)
        shutil.copytree(self.dispatch,round_dir/'dispatch')
        result=rf.prepare_round(self.r,round_dir/'round.json',round_dir/'policy.json')
        self.assertEqual(result['status'],'prepared')
        self.assertFalse((self.r/'reviews/c1/paper.md').exists())
