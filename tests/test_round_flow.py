import json
from pathlib import Path
from types import SimpleNamespace as NS
import tempfile
import unittest
import sys
sys.path.insert(0, str(Path(__file__).parents[1] / 'runtime'))
import article_flow as f
from legacy_archive_fixture import prepare as prepare_round


class RoundTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.r = self.root
        (self.r/'.workflow').mkdir()
        (self.r/'base.md').write_text('Definition A.\nTheorem B.\n')
        f.write(self.r/'base.json', dict(entries=[], inferences=[], b0ClaimEntryIds=[], negationPairs=[]))
        f.write(self.r/'workspace.json', dict(schema='math-workspace/v1', revision=0,
            paper='base.md', map='base.json', paper_sha256=f.digest(self.r/'base.md'), map_sha256=f.digest(self.r/'base.json'), pending=None))
        (self.r/'goal.md').write_text('User test fixture: prove C.')
        (self.r/'raw.md').write_text('Test fixture full prompt and response.')
        (self.r/'summary.md').write_text('This round proposes theorem C; root still open.')
        f.write(self.r/'delta.json', dict(edits=[dict(before='Theorem B.', after='Theorem B.\nTheorem C.')], rationale='fixture'))
        self.round = dict(schema='codex-math-round/v1', target_id='goal', contract_sha256='a'*64,
            round=1, attempt_id='r1', request_id='c1', author_identity='writer', contributor_identities=['writer','session'],
            tasks=[dict(id='task1',status='returned',source='raw.md',complete=True,author_identity='session')], summary='summary.md', outcome='candidate')
        self.policy = dict(mode='per_round_auto', target_id='goal', contract_sha256='a'*64, authorization='TEST FIXTURE user authorization')
        self.save()

    def save(self):
        f.write(self.r/'round.json', self.round); f.write(self.r/'policy.json', self.policy)

    def archive(self, outcome='candidate'):
        f.start(self.r,NS(id='r1',objective='C',identity='writer',grilling=self.r/'goal.md',sources=[]))
        f.finish(self.r,NS(id='r1',outcome=outcome,transcript=self.r/'raw.md',delta=self.r/'delta.json' if outcome=='candidate' else None,evidence=[self.r/'raw.md',self.r/'summary.md']))

    def prepare(self):
        return prepare_round(self.r, self.r/'round.json', self.r/'policy.json')

    def test_candidate_prepares_once_and_excludes_all_authors(self):
        self.archive(); first=self.prepare(); self.assertEqual(first,self.prepare())
        p=f.read(self.r/'reviews/c1/packet.json')
        self.assertEqual(p['selected'],['r1']); self.assertEqual(p['excluded_reviewers'],['session','writer'])
        self.assertFalse((self.r/'reviews/c1/commit.json').exists())
        self.assertEqual(f.state(self.r)['revision'],0)

    def test_no_change_only_archives_summary(self):
        self.round['outcome']='no_change';self.save();self.archive('no_change')
        self.assertEqual(self.prepare()['status'],'no_change')
        self.assertFalse((self.r/'reviews').exists())

    def test_interrupted_round_never_prepares(self):
        self.round.update(outcome='interrupted');self.round['tasks'].append(dict(id='task2', status='running'))
        self.save();self.archive('interrupted')
        self.assertEqual(self.prepare()['status'],'interrupted');self.assertFalse((self.r/'reviews').exists())

    def test_manual_or_missing_authorization_cannot_auto_prepare(self):
        self.archive()
        for change in [dict(mode='manual'),dict(authorization=''),dict(contract_sha256='b'*64),dict(target_id='other')]:
            old=dict(self.policy);self.policy.update(change);self.save()
            with self.assertRaises(ValueError):self.prepare()
            self.policy=old
        self.assertFalse((self.r/'reviews').exists())

    def test_pending_task_blocks_candidate(self):
        self.archive();self.round['tasks'][0]['status']='running';self.save()
        with self.assertRaisesRegex(ValueError,'barrier'):self.prepare()

    def test_truncated_source_is_not_a_candidate(self):
        self.archive();self.round['tasks'][0]['complete']=False;self.save()
        with self.assertRaisesRegex(ValueError,'incomplete'):self.prepare()

    def test_changed_source_or_summary_is_rejected(self):
        self.archive();(self.r/'raw.md').write_text('different source')
        with self.assertRaisesRegex(ValueError,'frozen'):self.prepare()

    def test_changed_retry_cannot_select_new_request(self):
        self.archive();self.prepare();self.round['request_id']='c2';self.save()
        with self.assertRaisesRegex(ValueError,'retry differs'):self.prepare()
        self.assertFalse((self.r/'reviews/c2').exists())

    def test_missing_pro_author_is_rejected(self):
        self.archive();self.round['contributor_identities']=['writer'];self.save()
        with self.assertRaisesRegex(ValueError,'session author'):self.prepare()

    def test_publication_pending_resumes_original_request(self):
        self.archive();original=self.prepare()
        s=f.state(self.r);s['pending']='c1';f.write(self.r/'workspace.json',s)
        f.write(self.r/'reviews/c1/commit.json',dict(status='publication_pending'))
        resumed=self.prepare()
        self.assertEqual(resumed['status'],'resume_commit');self.assertEqual(resumed['packet_sha256'],original['packet_sha256'])
        self.assertEqual(len(list((self.r/'reviews').iterdir())),1)

    def test_pro_author_cannot_review_and_rejection_cannot_commit(self):
        from unittest.mock import patch
        self.archive();self.prepare()
        d=self.r/'reviews/c1'
        v=dict(packet_sha256=f.digest(d/'packet.json'),reviewer_identity='session',verdict='accept',accepted_attempts=['r1'],article_whole='accept')
        f.write(d/'input.json',v)
        with self.assertRaisesRegex(ValueError,'independent'):
            f.accept(self.r,NS(id='c1',verdict=d/'input.json'))
        v.update(reviewer_identity='independent',verdict='reject',article_whole='reject');f.write(d/'input.json',v)
        with patch.object(f,'native_check'):
            with self.assertRaisesRegex(ValueError,'not accepted'):
                f.accept(self.r,NS(id='c1',verdict=d/'input.json'))
        self.assertFalse((d/'commit.json').exists());self.assertEqual(f.state(self.r)['revision'],0)

    def test_prepare_cli_supports_excluded_contributors(self):
        import subprocess
        self.archive()
        cmd=[sys.executable,str(Path(f.__file__)),str(self.r),'prepare','c1','r1','--identity','writer','--exclude-reviewer','session']
        done=subprocess.run(cmd,capture_output=True,text=True)
        self.assertEqual(done.returncode,0,done.stderr)
        self.assertIn('session',json.loads(done.stdout)['excluded_reviewers'])


if __name__=='__main__':unittest.main()
