from pathlib import Path
from types import SimpleNamespace as NS
import tempfile
import unittest
import sys
sys.path.insert(0,str(Path(__file__).parents[1]/'runtime'))
import article_flow as f
import round_flow as rf
from legacy_archive_fixture import prepare as prepare_legacy
import view_data as v


class ViewTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.r=Path(self.tmp.name)
        (self.r/'.workflow').mkdir();(self.r/'base.md').write_text('Definition A.\n')
        f.write(self.r/'base.json',dict(entries=[],inferences=[],b0ClaimEntryIds=[],negationPairs=[]))
        f.write(self.r/'workspace.json',dict(schema='math-workspace/v1',revision=0,paper='base.md',map='base.json',paper_sha256=f.digest(self.r/'base.md'),map_sha256=f.digest(self.r/'base.json'),pending=None))
        (self.r/'goal.md').write_text('Fixture user: develop understanding of A.')
        (self.r/'raw.md').write_text('Fixture full prompt and response.')
        (self.r/'summary.md').write_text('本轮区分了两个待研究问题，但尚无新的数学断言。')
        f.write(self.r/'exploration.json',dict(targetId='topic',activeContractFingerprint='a'*64,questions=[dict(id='q1',statement='两个自然问题的差别在哪里',motivation='原文表明二者此前混在一起',sourceRefs=['raw.md'])],observations=[dict(id='o1',kind='sharpen_question',statement='细化问题',questionIds=['q1'],status='recorded',evidenceRefs=['raw.md'])],researchOutcome='understanding_advanced'))
        self.round=dict(schema='codex-math-round/v1',research_mode='explore',target_id='topic',contract_sha256='a'*64,round=1,attempt_id='r1',request_id='c1',author_identity='author',contributor_identities=['author','session'],tasks=[dict(id='t1',status='returned',source='raw.md',complete=True,author_identity='session')],summary='summary.md',exploration='exploration.json',outcome='no_change')
        f.write(self.r/'round.json',self.round)
        f.write(self.r/'policy.json',dict(mode='per_round_auto',research_mode='explore',target_id='topic',contract_sha256='a'*64,authorization='TEST FIXTURE actual user authorization'))
    def archive(self):
        f.start(self.r,NS(id='r1',identity='author',objective='探索自然问题',grilling=self.r/'goal.md',sources=[]))
        f.finish(self.r,NS(id='r1',outcome='no_change',transcript=self.r/'raw.md',delta=None,evidence=[self.r/'raw.md',self.r/'summary.md',self.r/'exploration.json']))
        return prepare_legacy(self.r,self.r/'round.json',self.r/'policy.json')
    def hashes(self):return {str(p.relative_to(self.r)):f.digest(p) for p in self.r.rglob('*') if p.is_file()}
    def test_exploration_without_math_delta_is_archived_and_visible_without_commit(self):
        self.assertEqual(self.archive()['status'],'no_change');before=self.hashes()
        data=v.trajectory(self.r);row=data['attempts'][0]
        self.assertEqual(row['research_mode'],'explore');self.assertEqual(row['outcome'],'no_change')
        self.assertIsNone(row['request_id']);self.assertEqual(Path(row['summary_path']).read_text(),(self.r/'summary.md').read_text())
        self.assertIn('第 1 轮',v.markdown(data));self.assertEqual(before,self.hashes())
        self.assertFalse((self.r/'reviews').exists())
    def test_trajectory_does_not_require_current_article_or_map(self):
        self.archive();(self.r/'workspace.json').unlink();(self.r/'base.md').unlink();(self.r/'base.json').unlink()
        self.assertEqual(len(v.trajectory(self.r)['attempts']),1)
    def test_missing_or_changed_archive_is_not_silently_omitted(self):
        self.archive();(self.r/'attempts/r1/evidence/0000').write_text('tampered')
        with self.assertRaises(ValueError):v.trajectory(self.r)
    def test_current_map_stays_on_published_version_while_pending(self):
        s=f.state(self.r);s['pending']='candidate';f.write(self.r/'workspace.json',s)
        before=self.hashes();view=v.map_input(self.r)
        self.assertEqual(view['map_path'],str((self.r/'base.json').resolve()));self.assertEqual(view['publication_pending'],'candidate');self.assertEqual(before,self.hashes())
    def test_explore_cannot_use_proof_policy(self):
        p=f.read(self.r/'policy.json');p['research_mode']='proof';f.write(self.r/'policy.json',p)
        with self.assertRaisesRegex(ValueError,'mode mismatch'):self.archive()
    def test_partial_attempt_is_shown_and_empty_history_is_honest(self):
        self.assertEqual(v.trajectory(self.r)['attempts'],[])
        (self.r/'attempts/partial').mkdir(parents=True)
        self.assertEqual(v.trajectory(self.r)['attempts'][0]['phase'],'partial')
    def test_exploration_observation_file_must_be_frozen(self):
        self.archive();(self.r/'exploration.json').write_text('{}')
        with self.assertRaises(ValueError):prepare_legacy(self.r,self.r/'round.json',self.r/'policy.json')
    def test_empty_observations_cannot_claim_understanding_progress(self):
        data=f.read(self.r/'exploration.json');data.update(questions=[],observations=[]);f.write(self.r/'exploration.json',data)
        with self.assertRaisesRegex(ValueError,'grounded recorded'):self.archive()
        self.assertFalse((self.r/'rounds/topic/1/status.json').exists())  # Existing legacy fixture is not advanced.
    def test_unfrozen_source_cannot_support_understanding_progress(self):
        (self.r/'unfrozen.md').write_text('Not frozen evidence')
        data=f.read(self.r/'exploration.json');data['observations'][0]['evidenceRefs']=['unfrozen.md'];f.write(self.r/'exploration.json',data)
        with self.assertRaisesRegex(ValueError,'not frozen'):self.archive()
    def test_candidate_conjecture_alone_is_not_verified_understanding_progress(self):
        data=f.read(self.r/'exploration.json');data['observations'][0]['status']='candidate';f.write(self.r/'exploration.json',data)
        with self.assertRaisesRegex(ValueError,'grounded recorded'):self.archive()
    def test_no_progress_with_empty_observations_remains_a_valid_record(self):
        data=f.read(self.r/'exploration.json');data.update(questions=[],observations=[],researchOutcome='no_verified_progress');f.write(self.r/'exploration.json',data)
        self.assertEqual(self.archive()['status'],'no_change')
    def test_publication_receipt_before_pointer_is_not_displayed_as_published(self):
        from unittest.mock import patch
        self.round['outcome']='candidate';f.write(self.r/'round.json',self.round)
        f.write(self.r/'delta.json',dict(edits=[dict(before='Definition A.',after='Definition A.\nDefinition B.')],rationale='TEST FIXTURE'))
        f.start(self.r,NS(id='r1',identity='author',objective='探索自然问题',grilling=self.r/'goal.md',sources=[]))
        f.finish(self.r,NS(id='r1',outcome='candidate',transcript=self.r/'raw.md',delta=self.r/'delta.json',evidence=[self.r/'raw.md',self.r/'summary.md',self.r/'exploration.json']))
        prepare_legacy(self.r,self.r/'round.json',self.r/'policy.json')
        d=self.r/'reviews/c1';vpath=d/'input.json'
        f.write(vpath,dict(packet_sha256=f.digest(d/'packet.json'),reviewer_identity='reviewer',verdict='accept',accepted_attempts=['r1'],article_whole='accept'))
        with patch.object(f,'native_check'):
            receipt=f.accept(self.r,NS(id='c1',verdict=vpath))
            f.write(d/'published.json',dict(basis_sha256=f.digest(d/'commit.json'),request_id='c1',revision=1))
            self.assertEqual(v.trajectory(self.r)['attempts'][0]['commit_status'],'publication_recorded')
        self.assertEqual(f.state(self.r)['pending'],'c1')
    def test_cli_read_only_index(self):
        import subprocess
        self.archive();before=self.hashes()
        done=subprocess.run([sys.executable,str(Path(v.__file__)),str(self.r),'--kind','trajectory','--format','markdown'],capture_output=True,text=True)
        self.assertEqual(done.returncode,0,done.stderr);self.assertIn('no_change',done.stdout);self.assertEqual(before,self.hashes())

if __name__=='__main__':unittest.main()
