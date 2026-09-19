"""Repair transactions; native review is mocked, never mathematical evidence."""
from types import SimpleNamespace as NS
from unittest.mock import patch
import unittest
import test_article_flow as fixture
f = fixture.f

class MainRepair(unittest.TestCase):
    setUp = fixture.InterfaceTests.setUp
    candidate = fixture.InterfaceTests.candidate

    def original(self, accepted=True):
        self.candidate()
        f.prepare(self.r, NS(id='c', attempts=['a'], identity='editor', exclude_reviewers=['proof-session']))
        self.verdict('c', 'a')
        if accepted: f.accept(self.r, NS(id='c', verdict=self.r/'reviews/c/v.json'))

    def verdict(self, request, attempt, reviewer='sol-reviewer'):
        d = self.r/'reviews'/request
        f.write(d/'v.json', dict(packet_sha256=f.digest(d/'packet.json'), reviewer_identity=reviewer,
            verdict='accept', increment='accept', accepted_attempts=[attempt]))
        return d/'v.json'

    def begin(self, source='c', attempt='fix'):
        args = NS(id=attempt, repair_of=source, objective='Correct the missing hypothesis', identity='main', grilling=self.r/'g.md', sources=[self.r/'e.md'])
        f.start(self.r, args)
        return args

    def ready(self, source='c', attempt='fix', request='c2', withdraw=False):
        self.begin(source, attempt)
        f.write(self.r/'fix.json', dict(edits=[] if withdraw else [dict(before='Theorem B.', after='Theorem B.\nConditional C.')], rationale='Withdraw or correct the original claim'))
        f.finish(self.r, NS(id=attempt, outcome='candidate', transcript=self.r/'t.md', delta=self.r/'fix.json', evidence=[self.r/'e.md']))
        args=NS(id=request, attempts=[attempt], identity='main')
        p=f.prepare(self.r,args)
        self.assertEqual(p,f.prepare(self.r,args))
        return p

    def publish_fixed(self, request, text):
        d=self.r/'reviews'/request
        (self.r/'fixed.md').write_text(text)
        f.article_packet(self.r, NS(id=request,round='a1',paper=self.r/'fixed.md',identity='main'))
        q=d/'articles/a1';f.write(q/'v.json',dict(packet_sha256=f.digest(q/'packet.json'),reviewer_identity='sol-reviewer',verdict='accepted-for-article',complete=True,faithful=True,issues=[]))
        f.update_article(self.r,NS(id=request,round='a1',verdict=q/'v.json'))
        sha=f.digest(q/'paper.md');f.write(self.r/'check.json',dict(source_sha256=sha))
        f.write(self.r/'validation.json',dict(source_sha256=sha,map_sha256=f.digest(self.r/'base.json'),validator='fixture',errors=[]))
        f.map_packet(self.r,NS(id=request,round='m1',map=self.r/'base.json',source_check=self.r/'check.json',validation=self.r/'validation.json',identity='main'))
        q=d/'maps/m1';f.write(q/'v.json',dict(packet_sha256=f.digest(q/'packet.json'),reviewer_identity='sol-map',verdict='accepted-for-projection',score=100,coverageRatio=1,sourceClean=True,omissions=[],distortions=[],fabrications=[],unresolved=[],assessments=[],source_coverage=[dict(source_locator=dict(heading="Fixture paper",line_start=1,line_end=len((q/'paper.md').read_text().splitlines())),mapped_object_ids=[],disposition='not-extracted-justified',reason='Empty-map test fixture; no mathematical review claimed.')]))
        return f.publish(self.r,NS(id=request,round='m1',verdict=q/'v.json'))

    def test_rejected_candidate_main_fix_same_sol_no_research_round(self):
        self.original(False);p=self.ready()
        self.assertEqual(p['repair_of'],'c')
        self.assertTrue({'main','editor','proposer','proof-session'} <= set(p['excluded_reviewers']))
        old=self.r/'reviews/c/v.json'
        with self.assertRaisesRegex(ValueError,'packet mismatch'): f.accept(self.r,NS(id='c2',verdict=old))
        v=self.verdict('c2','fix');c=f.accept(self.r,NS(id='c2',verdict=v))
        self.assertEqual(c['reviewer_identity'],'sol-reviewer');self.assertEqual(c['supersedes'],'c')
        self.assertFalse((self.r/'rounds').exists())

    def test_pending_correction_preserves_history_and_publishes_once(self):
        self.original();old=f.digest(self.r/'reviews/c/commit.json');self.ready()
        c=f.accept(self.r,NS(id='c2',verdict=self.verdict('c2','fix')))
        self.assertEqual(c['revision'],1);self.assertEqual(f.state(self.r)['pending'],'c2')
        s=self.publish_fixed('c2','Definition A.\nTheorem B.\nConditional C.\n')
        self.assertEqual(s['revision'],1);self.assertIsNone(s['pending']);self.assertNotIn('repair',s)
        self.assertEqual(old,f.digest(self.r/'reviews/c/commit.json'))
        with self.assertRaisesRegex(ValueError,'superseded'): f.accept(self.r,NS(id='c',verdict=self.r/'reviews/c/v.json'))
        self.assertEqual(f.request_progress(self.r,'c')['request_id'],'c2')

    def test_repair_immediately_suspends_old_publication_and_unrelated_work(self):
        self.original();self.begin()
        for call in [lambda:f.publish(self.r,NS(id='c')),lambda:f.article_packet(self.r,NS(id='c')),lambda:f.map_packet(self.r,NS(id='map-only',current=True))]:
            with self.assertRaises(ValueError):call()
        with self.assertRaises(ValueError):self.candidate('unrelated')
        self.assertEqual(f.request_progress(self.r,'c')['status'],'repair_in_progress')

    def test_main_cannot_review_own_repair_and_changed_evidence_blocks(self):
        self.original();self.ready()
        with self.assertRaisesRegex(ValueError,'independent'):f.accept(self.r,NS(id='c2',verdict=self.verdict('c2','fix','main')))
        (self.r/'reviews/c2/attempts/fix/evidence/0000').write_text('altered')
        with self.assertRaisesRegex(ValueError,'changed or missing'):f.accept(self.r,NS(id='c2',verdict=self.verdict('c2','fix')))

    def test_repeated_rejection_keeps_lineage_and_original_pending(self):
        self.original();self.ready();self.ready('c2','fix2','c3')
        self.assertEqual(f.state(self.r)['pending'],'c')
        v=self.verdict('c3','fix2');f.accept(self.r,NS(id='c3',verdict=v))
        self.assertEqual(f.request_progress(self.r,'c')['request_id'],'c3')
        self.assertEqual(len(f.request_progress(self.r,'c')['repair_chain']),2)
        with self.assertRaises(ValueError):f.accept(self.r,NS(id='c2',verdict=self.verdict('c2','fix')))

    def test_interrupted_repair_can_resume_with_new_attempt(self):
        self.original();args=self.begin();self.assertEqual(f.start(self.r,args)['id'],'fix')
        f.finish(self.r,NS(id='fix',outcome='interrupted',transcript=self.r/'t.md',delta=None,evidence=[]))
        self.ready('c','fix2','c2')
        self.assertEqual(f.state(self.r)['replacements']['c']['previous_attempts'],['fix'])

    def test_start_crash_before_workspace_pointer_is_retryable(self):
        self.original();write=f.write
        def interrupted(path,value):
            if path==self.r/'workspace.json':raise OSError('fixture interruption')
            write(path,value)
        with patch.object(f,'write',side_effect=interrupted):
            with self.assertRaises(OSError):self.begin()
        self.begin();self.assertEqual(f.state(self.r)['repair']['attempt_id'],'fix')

    def test_commit_crash_before_pointer_is_retryable(self):
        self.original();self.ready();v=self.verdict('c2','fix');write=f.write
        def interrupted(path,value):
            if path==self.r/'workspace.json':raise OSError('fixture interruption')
            write(path,value)
        with patch.object(f,'write',side_effect=interrupted):
            with self.assertRaises(OSError):f.accept(self.r,NS(id='c2',verdict=v))
        self.assertEqual(f.state(self.r)['pending'],'c')
        f.accept(self.r,NS(id='c2',verdict=v));self.assertEqual(f.state(self.r)['pending'],'c2')

    def test_full_withdrawal_is_linked_audited_correction(self):
        self.original();self.ready(withdraw=True)
        f.accept(self.r,NS(id='c2',verdict=self.verdict('c2','fix')))
        s=self.publish_fixed('c2',(self.r/'base.md').read_text())
        self.assertEqual(s['paper_sha256'],f.digest(self.r/'base.md'))
        self.assertEqual(s['revision'],1)

    def test_repair_is_visible_without_fabricated_round(self):
        import view_data
        self.original(False);self.ready()
        with patch.object(view_data,'f',f):view=view_data.trajectory(self.r)
        fix=next(x for x in view['attempts'] if x['attempt_id']=='fix')
        self.assertEqual(fix['repair_of'],'c');self.assertEqual(fix['request_id'],'c2')
        self.assertNotIn('round',fix)
        self.assertIn('不另计推理轮',view_data.markdown(view))
