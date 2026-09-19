"""Cross-round and initial-publication regression scenarios. Native review is mocked."""
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch
import test_final_recovery as final
f=final.f

class StabilityPasses(unittest.TestCase):
    setUp=final.FinalRecovery.setUp
    candidate=final.FinalRecovery.candidate
    original=final.FinalRecovery.original
    ready=final.FinalRecovery.ready
    begin=final.FinalRecovery.begin
    verdict=final.FinalRecovery.verdict
    publish_fixed=final.FinalRecovery.publish_fixed
    published_correction=final.FinalRecovery.published_correction
    map_args=final.FinalRecovery.map_args
    map_verdict=final.FinalRecovery.map_verdict

    def next_increment(self, request='next', run='next-attempt'):
        f.start(self.r,NS(id=run,objective='Next result',identity='new-session',grilling=self.r/'g.md',sources=[]))
        f.write(self.r/'next-delta.json',dict(edits=[dict(before='Conditional C.',after='Conditional C.\nTheorem D.')],rationale='TEST FIXTURE'))
        f.finish(self.r,NS(id=run,outcome='candidate',transcript=self.r/'t.md',delta=self.r/'next-delta.json',evidence=[self.r/'e.md']))
        return f.prepare(self.r,NS(id=request,attempts=[run],identity='new-main'))

    def test_authors_survive_new_increment_and_map_only_updates(self):
        self.published_correction();old=set(f.state(self.r)['article_authors'])
        args=self.map_args('known','m',current=True);args.exclude_reviewers=['historical-extra']
        f.map_packet(self.r,args);f.publish(self.r,self.map_verdict('known','m'))
        self.assertNotIn('historical-extra',f.state(self.r)['article_authors'])
        p=self.next_increment()
        self.assertTrue(old<=set(p['article_authors']))
        with self.assertRaisesRegex(ValueError,'independent'):
            f.accept(self.r,NS(id='next',verdict=self.verdict('next','next-attempt','new-session')))
        self.assertNotIn('proof-session',p['excluded_reviewers'])
        f.accept(self.r,NS(id='next',verdict=self.verdict('next','next-attempt','proof-session')))
        s=self.publish_fixed('next','Definition A.\nTheorem B.\nConditional C.\nTheorem D.\n')
        self.assertTrue(old<=set(s['article_authors']))
        p=f.map_packet(self.r,self.map_args('next-map','m',current=True))
        self.assertTrue(old<=set(p['article_authors']))

    def test_first_publication_rejects_earlier_identical_map_candidate(self):
        f.map_packet(self.r,self.map_args('early','m',current=True));early=self.map_verdict('early','m')
        projection=f.read(self.r/'reviews/early/projection-request.json')
        self.assertIn('base_publication_receipt_sha256',projection)
        self.assertIsNone(projection['base_publication_receipt_sha256'])
        a=self.map_args('later','m',current=True);a.exclude_reviewers=['known-author']
        f.map_packet(self.r,a);current=f.publish(self.r,self.map_verdict('later','m'))
        with self.assertRaisesRegex(ValueError,'stale projection publication'):f.publish(self.r,early)
        self.assertEqual(current,f.state(self.r))
        self.assertFalse((self.r/'reviews/early/published.json').exists())

    def test_first_map_publication_interruption_and_idempotent_replay(self):
        f.map_packet(self.r,self.map_args('first','m',current=True));v=self.map_verdict('first','m')
        write=f.write
        def interrupted(path,value):
            if path==self.r/'workspace.json':raise OSError('fixture interruption')
            write(path,value)
        with patch.object(f,'write',side_effect=interrupted):
            with self.assertRaises(OSError):f.publish(self.r,v)
        self.assertNotIn('publication_receipt',f.state(self.r))
        s=f.publish(self.r,v);self.assertEqual(f.publish(self.r,v),s)

    def test_legacy_ambiguous_map_cannot_overwrite_new_publication(self):
        f.map_packet(self.r,self.map_args('legacy','m',current=True))
        path=self.r/'reviews/legacy/projection-request.json';record=f.read(path)
        record.pop('base_publication_receipt_sha256');f.write(path,record)
        v=self.map_verdict('legacy','m')
        f.map_packet(self.r,self.map_args('new','m',current=True));s=f.publish(self.r,self.map_verdict('new','m'))
        with self.assertRaisesRegex(ValueError,'legacy projection'):f.publish(self.r,v)
        self.assertEqual(s,f.state(self.r))

    def test_write_boundary_interruptions_are_recoverable(self):
        """Replay each operation after failure immediately before/after each JSON write."""
        def operation(x, stage):
            if stage=='map-only':
                a=x.map_args('map','m',current=True)
                return lambda:f.map_packet(x.r,a)
            if stage=='prepare':
                x.candidate()
                return lambda:f.prepare(x.r,NS(id='c',attempts=['a'],identity='main'))
            x.original(False)
            if stage=='accept':
                return lambda:f.accept(x.r,NS(id='c',verdict=x.r/'reviews/c/v.json'))
            f.accept(x.r,NS(id='c',verdict=x.r/'reviews/c/v.json'))
            (x.r/'article.md').write_text('Definition A.\nTheorem B.\nTheorem C.\n')
            args=NS(id='c',round='a1',paper=x.r/'article.md',identity='main')
            if stage=='article-packet':return lambda:f.article_packet(x.r,args)
            f.article_packet(x.r,args);q=x.r/'reviews/c/articles/a1'
            f.write(q/'v.json',dict(packet_sha256=f.digest(q/'packet.json'),reviewer_identity='sol',verdict='accepted-for-article',complete=True,faithful=True,issues=[]))
            update=NS(id='c',round='a1',verdict=q/'v.json')
            if stage=='update-article':return lambda:f.update_article(x.r,update)
            f.update_article(x.r,update)
            ma=x.map_args('c','m')
            if stage=='map-packet':return lambda:f.map_packet(x.r,ma)
            f.map_packet(x.r,ma);publish=x.map_verdict('c','m')
            return lambda:f.publish(x.r,publish)
        counts={'prepare':2,'accept':2,'article-packet':3,'update-article':2,'map-packet':1,'map-only':2,'publish':2}
        for stage,count in counts.items():
            for boundary in range(1,count+1):
                for after in [False,True]:
                    with self.subTest(stage=stage,boundary=boundary,after=after):
                        x=final.FinalRecovery();x.setUp()
                        try:
                            run=operation(x,stage);write=f.write;calls=[0]
                            def interrupted(path,value):
                                calls[0]+=1
                                if calls[0]==boundary and not after:raise OSError('fixture interruption')
                                write(path,value)
                                if calls[0]==boundary and after:raise OSError('fixture interruption')
                            with patch.object(f,'write',side_effect=interrupted):
                                with self.assertRaises(OSError):run()
                            result=run()
                            self.assertEqual(result,run())
                            f.state(x.r)
                        finally:x.doCleanups()

    def test_non_round_attempt_exposes_commit_without_inventing_round(self):
        import view_data
        self.original();self.ready();f.accept(self.r,NS(id='c2',verdict=self.verdict('c2','fix')))
        self.publish_fixed('c2','Definition A.\nTheorem B.\nConditional C.\n')
        with patch.object(view_data,'f',f):rows=view_data.trajectory(self.r)['attempts']
        row=next(x for x in rows if x['attempt_id']=='a')
        self.assertEqual(row['request_id'],'c');self.assertEqual(row['commit_status'],'superseded')
        self.assertNotIn('round',row)

    def test_trajectory_shows_pending_editorial_recheck(self):
        import view_data
        x=final.FinalRecovery();x.setUp()
        try:
            d,q,old,commit=x.revised()
            with patch.object(view_data,'f',f):rows=view_data.trajectory(x.r)['attempts']
            row=next(x for x in rows if x['attempt_id']=='a')
            self.assertEqual(row['commit_status'],'article_update_pending')
            self.assertEqual(row['pending_article_round'],'a2')
        finally:x.doCleanups()

    def test_initial_map_replay_after_new_article_is_readonly_completion(self):
        f.map_packet(self.r,self.map_args('initial','m',current=True));v=self.map_verdict('initial','m')
        f.publish(self.r,v)
        self.published_correction();s=f.state(self.r)
        self.assertEqual(f.publish(self.r,v),s)
        p=self.next_increment();self.assertNotIn('proof-session',p['excluded_reviewers'])
        f.accept(self.r,NS(id='next',verdict=self.verdict('next','next-attempt','proof-session')))
        s=f.state(self.r)
        self.assertEqual(f.publish(self.r,v),s)
        self.assertEqual(f.state(self.r)['pending'],'next')

    def test_interrupted_copy_never_leaves_partial_immutable_artifact(self):
        from pathlib import Path
        x=final.FinalRecovery();x.setUp()
        try:
            x.original()
            (x.r/'article.md').write_text('Definition A.\nTheorem B.\nTheorem C.\n')
            args=NS(id='c',round='a1',paper=x.r/'article.md',identity='main')
            copy=f.shutil.copyfile
            def interrupted(src,dst):
                if Path(src)==x.r/'article.md':
                    Path(dst).write_bytes(Path(src).read_bytes()[:4])
                    raise OSError('fixture mid-copy interruption')
                return copy(src,dst)
            with patch.object(f.shutil,'copyfile',side_effect=interrupted):
                with self.assertRaises(OSError):f.article_packet(x.r,args)
            target=x.r/'reviews/c/articles/a1/paper.md'
            self.assertFalse(target.exists())
            f.article_packet(x.r,args)
            self.assertEqual(target.read_bytes(),(x.r/'article.md').read_bytes())
            (x.r/'article.md').write_text('Different completed material')
            with self.assertRaisesRegex(ValueError,'immutable artifact differs'):f.article_packet(x.r,args)
        finally:x.doCleanups()

    def test_source_change_during_freeze_is_retryable_and_not_accepted(self):
        from pathlib import Path
        source=self.r/'changing.md';source.write_text('original')
        target=self.r/'frozen.md';copy=f.shutil.copyfile
        def changing(src,dst):
            copy(src,dst);Path(src).write_text('updated')
        with patch.object(f.shutil,'copyfile',side_effect=changing):
            with self.assertRaisesRegex(ValueError,'source changed'):f.freeze(source,target)
        self.assertFalse(target.exists())
        f.freeze(source,target);self.assertEqual(target.read_text(),'updated')
