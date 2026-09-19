"""Publication/recovery regressions. Mathematical review is mocked by fixtures."""
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch
import test_increment_pipeline as pipeline
import test_final_recovery as recovery
import view_data
f=pipeline.f

class PublicationDecoupling(unittest.TestCase):
    setUp=pipeline.IncrementPipeline.setUp
    candidate=pipeline.IncrementPipeline.candidate
    accepted=pipeline.IncrementPipeline.accepted
    article=pipeline.IncrementPipeline.article
    map_args=recovery.FinalRecovery.map_args
    map_verdict=recovery.FinalRecovery.map_verdict

    def first(self):
        d=self.accepted(); self.article(d)
        return f.publish_article(self.r,NS(id='c'))

    def next_article(self):
        s=f.state(self.r)
        f.start(self.r,NS(id='b',identity='main',objective='Next',grilling=self.r/'g.md',sources=[]))
        text=(self.r/s['paper']).read_text()
        f.write(self.r/'next-delta.json',dict(edits=[dict(before=text,after=text+'Theorem D.\n')],rationale='next'))
        f.finish(self.r,NS(id='b',outcome='candidate',transcript=self.r/'g.md',evidence=[self.r/'g.md'],delta=self.r/'next-delta.json'))
        f.prepare(self.r,NS(id='d',attempts=['b'],identity='main',increment_only=True))
        d=self.r/'reviews/d'
        f.write(d/'v.json',dict(packet_sha256=f.digest(d/'packet.json'),reviewer_identity='sol',verdict='accept',increment='accept',accepted_attempts=['b']))
        f.accept(self.r,NS(id='d',verdict=d/'v.json'))
        (self.r/'next.md').write_text(text+'Theorem D.\n')
        f.article_packet(self.r,NS(id='d',round='a1',paper=self.r/'next.md',identity='main'))
        q=d/'articles/a1'
        f.write(q/'v.json',dict(packet_sha256=f.digest(q/'packet.json'),reviewer_identity='sol2',verdict='accepted-for-article',complete=True,faithful=True,issues=[]))
        f.update_article(self.r,NS(id='d',round='a1',verdict=q/'v.json'))
        return d

    def test_article_ready_without_map_and_next_baseline_honest(self):
        s=self.first(); self.assertEqual((s['revision'],s['map_revision']),(1,0)); self.assertIsNone(s['pending'])
        self.assertEqual(f.request_progress(self.r,'c')['status'],'article_published_map_pending')
        self.assertEqual(f.accept(self.r,NS(id='c',verdict=self.r/'reviews/c/v.json'))['status'],'article_published_map_pending')
        self.next_article()
        run=f.read(self.r/'attempts/b/run.json')
        self.assertEqual((run['base_revision'],run['base_map_revision']),(1,0))
        self.assertEqual(run['base_paper_sha256'],s['paper_sha256'])
        v=view_data.map_input(self.r)
        self.assertTrue(v['map_stale']);self.assertEqual(v['revision'],0);self.assertEqual(v['article_revision'],1)

    def test_late_map_preserves_newer_pending_commit(self):
        self.first(); self.next_article()
        before=f.state(self.r)
        f.map_packet(self.r,self.map_args('c','m1'))
        s=f.publish(self.r,self.map_verdict('c','m1'))
        for k in ['revision','paper','paper_sha256','pending','last_request','article_authors','article_publication_receipt']:
            self.assertEqual(s[k],before[k])
        self.assertEqual(s['map_revision'],1);self.assertEqual(s['pending'],'d')
        f.publish_article(self.r,NS(id='d'));self.assertEqual(f.state(self.r)['revision'],2)

    def test_old_map_archives_without_rewinding_newer_map(self):
        self.first();f.map_packet(self.r,self.map_args('c','m1'));old=self.map_verdict('c','m1')
        self.next_article();f.publish_article(self.r,NS(id='d'))
        f.map_packet(self.r,self.map_args('d','m2'));s=f.publish(self.r,self.map_verdict('d','m2'))
        self.assertEqual(s['map_revision'],2)
        self.assertEqual(f.publish(self.r,old),s);self.assertEqual(f.publish(self.r,old),s)
        self.assertTrue((self.r/'reviews/c/published.json').exists())
        self.assertEqual(f.publish_article(self.r,NS(id='c')),s)

    def test_article_pointer_crash_recovers_and_prevents_mutation(self):
        d=self.accepted();self.article(d);write=f.write
        def fail(path,value):
            if path==self.r/'workspace.json': raise OSError('crash')
            return write(path,value)
        with patch.object(f,'write',side_effect=fail):
            with self.assertRaises(OSError):f.publish_article(self.r,NS(id='c'))
        self.assertEqual(f.state(self.r)['revision'],0)
        self.assertEqual(f.request_progress(self.r,'c')['status'],'resume_commit')
        with self.assertRaises(ValueError):f.article_packet(self.r,NS(id='c',round='a2',paper=self.r/'complete.md',identity='main'))
        s=f.publish_article(self.r,NS(id='c'));self.assertEqual(f.publish_article(self.r,NS(id='c')),s)

    def test_map_pointer_crash_recovers_after_article_advances(self):
        self.first();f.map_packet(self.r,self.map_args('c','m1'));args=self.map_verdict('c','m1');write=f.write
        def fail(path,value):
            if path==self.r/'workspace.json':raise OSError('crash')
            return write(path,value)
        with patch.object(f,'write',side_effect=fail):
            with self.assertRaises(OSError):f.publish(self.r,args)
        self.assertEqual(f.request_progress(self.r,'c')['status'],'article_published_map_pending')
        self.next_article();f.publish_article(self.r,NS(id='d'))
        s=f.publish(self.r,args);self.assertEqual((s['revision'],s['map_revision']),(2,1))
        self.assertEqual(f.publish(self.r,args),s)

    def test_map_only_same_version_conflict_and_late_source(self):
        self.first()
        f.map_packet(self.r,self.map_args('p1','m',current=True));v1=self.map_verdict('p1','m')
        f.map_packet(self.r,self.map_args('p2','m',current=True));v2=self.map_verdict('p2','m')
        self.next_article();f.publish_article(self.r,NS(id='d'))
        s=f.publish(self.r,v1);self.assertEqual((s['revision'],s['map_revision']),(2,1))
        with self.assertRaisesRegex(ValueError,'stale projection'):f.publish(self.r,v2)

    def test_unchecked_article_and_failed_map_cannot_publish(self):
        self.accepted()
        with self.assertRaises((OSError,ValueError)):f.publish_article(self.r,NS(id='c'))
        self.article(self.r/'reviews/c');self.first_after_article=f.publish_article(self.r,NS(id='c'))
        f.map_packet(self.r,self.map_args('c','m'));v=self.map_verdict('c','m');data=f.read(v.verdict);data['sourceClean']=False;f.write(v.verdict,data)
        with self.assertRaises(ValueError):f.publish(self.r,v)
        self.assertEqual(f.state(self.r),self.first_after_article)

    def test_legacy_v1_joint_publish_after_split_workspace(self):
        self.first();self.candidate('legacy')
        f.prepare(self.r,NS(id='legacy-request',attempts=['legacy'],identity='main',increment_only=False))
        d=self.r/'reviews/legacy-request'
        f.write(d/'v.json',dict(packet_sha256=f.digest(d/'packet.json'),reviewer_identity='sol',verdict='accept',article_whole='accept',accepted_attempts=['legacy']))
        f.accept(self.r,NS(id='legacy-request',verdict=d/'v.json'))
        f.map_packet(self.r,self.map_args('legacy-request','m'))
        s=f.publish(self.r,self.map_verdict('legacy-request','m'))
        self.assertEqual((s['revision'],s['map_revision']),(2,2));self.assertIsNone(s['pending'])
        self.assertEqual(f.request_progress(self.r,'legacy-request')['status'],'published')
        self.assertEqual(f.publish_article(self.r,NS(id='legacy-request')),s)

    def test_old_combined_v2_caller_after_split_workspace(self):
        self.first();self.next_article()
        f.map_packet(self.r,self.map_args('d','m'))
        s=f.publish(self.r,self.map_verdict('d','m'))
        self.assertEqual((s['revision'],s['map_revision']),(2,2));self.assertIsNone(s['pending'])

    def test_trajectory_labels_actual_map_source(self):
        self.first();self.next_article()
        import trajectory_view
        with patch.object(view_data,'f',f):
            data=trajectory_view.load_input(self.r)
        row=next(r for r in data['process']['runs'] if r['action'].startswith('b ·'))
        self.assertTrue(any('文章 v1' in w and '地图来自文章 v0' in w for w in row['warnings']))
        self.assertEqual(data['bundle']['steps'][row['frame_indices'][0]]['article_revision'],0)

    def test_independent_map_for_same_article_finishes_first(self):
        self.first();f.map_packet(self.r,self.map_args('c','m'));late=self.map_verdict('c','m')
        f.map_packet(self.r,self.map_args('manual-map','m',current=True))
        s=f.publish(self.r,self.map_verdict('manual-map','m'))
        self.assertEqual(f.publish(self.r,late),s)
        self.assertEqual(f.request_progress(self.r,'c')['status'],'published')
        self.assertEqual(f.publish(self.r,late),s)
