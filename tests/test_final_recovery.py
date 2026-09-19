"""Editorial recovery, author inheritance and publication status; review is mocked."""
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch
import test_main_repair as main
import test_increment_pipeline as pipeline
f=main.f

class FinalRecovery(unittest.TestCase):
    setUp=main.MainRepair.setUp
    candidate=main.MainRepair.candidate
    original=main.MainRepair.original
    ready=main.MainRepair.ready
    begin=main.MainRepair.begin
    verdict=main.MainRepair.verdict
    publish_fixed=main.MainRepair.publish_fixed
    accepted=pipeline.IncrementPipeline.accepted
    article=pipeline.IncrementPipeline.article

    def revised(self):
        d=self.accepted();self.article(d)
        old=f.read(d/'article.json');commit=f.digest(d/'commit.json')
        (self.r/'new.md').write_text('Definition A.\n\nTheorem B.\n\nTheorem C.\n\nEditorial heading.\n')
        args=NS(id='c',round='a2',paper=self.r/'new.md',identity='new-editor')
        p=f.article_packet(self.r,args);self.assertEqual(p,f.article_packet(self.r,args))
        q=d/'articles/a2';f.write(q/'v.json',dict(packet_sha256=f.digest(q/'packet.json'),reviewer_identity='sol',verdict='accepted-for-article',complete=True,faithful=True,issues=[]))
        return d,q,old,commit

    def map_args(self,request,round,current=False,identity='extractor'):
        paper=self.r/f.state(self.r)['paper'] if current else f.article_binding(self.r,request)[0]
        f.write(self.r/'mapcheck.json',dict(source_sha256=f.digest(paper)))
        f.write(self.r/'mapvalidation.json',dict(source_sha256=f.digest(paper),map_sha256=f.digest(self.r/'base.json'),validator='fixture',errors=[]))
        return NS(id=request,round=round,map=self.r/'base.json',source_check=self.r/'mapcheck.json',validation=self.r/'mapvalidation.json',identity=identity,current=current)

    def map_verdict(self,request,round,reviewer='sol-map'):
        q=self.r/'reviews'/request/'maps'/round
        f.write(q/'v.json',dict(packet_sha256=f.digest(q/'packet.json'),reviewer_identity=reviewer,verdict='accepted-for-projection',score=100,coverageRatio=1,sourceClean=True,omissions=[],distortions=[],fabrications=[],unresolved=[],assessments=[],source_coverage=[dict(source_locator=dict(heading="Fixture paper",line_start=1,line_end=len((q/'paper.md').read_text().splitlines())),mapped_object_ids=[],disposition='not-extracted-justified',reason='Empty-map test fixture; no mathematical review claimed.')]))
        return NS(id=request,round=round,verdict=q/'v.json')

    def test_editorial_revision_keeps_commit_and_receipt_history(self):
        d,q,old,commit=self.revised()
        self.assertIn('article-writer',f.read(q/'packet.json')['excluded_reviewers'])
        with self.assertRaisesRegex(ValueError,'awaits integration'):f.map_packet(self.r,self.map_args('c','early'))
        args=NS(id='c',round='a2',verdict=q/'v.json');receipt=f.update_article(self.r,args)
        self.assertEqual(receipt,f.update_article(self.r,args))
        self.assertEqual(f.read(d/'articles/a1/receipt.json'),old)
        self.assertEqual(f.digest(d/'commit.json'),commit)
        self.assertEqual(f.article_binding(self.r,'c')[0],q/'paper.md')
        with self.assertRaisesRegex(ValueError,'stale'):f.update_article(self.r,NS(id='c',round='a1',verdict=d/'articles/a1/v.json'))
        f.map_packet(self.r,self.map_args('c','fresh'));f.publish(self.r,self.map_verdict('c','fresh'))
        with self.assertRaises(ValueError):f.article_packet(self.r,NS(id='c',round='late',paper=self.r/'new.md',identity='main'))

    def test_prepared_old_map_cannot_publish_during_or_after_revision(self):
        d=self.accepted();self.article(d)
        f.map_packet(self.r,self.map_args('c','old'));v=self.map_verdict('c','old')
        f.article_packet(self.r,NS(id='c',round='a2',paper=self.r/'complete.md',identity='another-writer'))
        with self.assertRaisesRegex(ValueError,'awaits integration'):f.publish(self.r,v)
        q=d/'articles/a2';f.write(q/'v.json',dict(packet_sha256=f.digest(q/'packet.json'),reviewer_identity='sol',verdict='accepted-for-article',complete=True,faithful=True,issues=[]))
        f.update_article(self.r,NS(id='c',round='a2',verdict=q/'v.json'))
        with self.assertRaisesRegex(ValueError,'older article'):f.publish(self.r,v)

    def test_article_switch_interruption_recovers_without_new_commit(self):
        d,q,old,commit=self.revised();args=NS(id='c',round='a2',verdict=q/'v.json');write=f.write
        def interrupted(path,value):
            if path==d/'article.json':raise OSError('fixture interruption')
            write(path,value)
        with patch.object(f,'write',side_effect=interrupted):
            with self.assertRaises(OSError):f.update_article(self.r,args)
        self.assertEqual(f.read(d/'article.json'),old)
        f.update_article(self.r,args)
        self.assertEqual(f.digest(d/'commit.json'),commit)

    def published_correction(self):
        self.original();self.ready();f.accept(self.r,NS(id='c2',verdict=self.verdict('c2','fix')))
        return self.publish_fixed('c2','Definition A.\nTheorem B.\nConditional C.\n')

    def test_map_only_inherits_authors_across_repeats_and_old_state(self):
        self.published_correction()
        s=f.state(self.r);s.pop('article_authors');f.write(self.r/'workspace.json',s)
        for name in ['m1','m2']:
            p=f.map_packet(self.r,self.map_args(name,'map',current=True))
            self.assertTrue({'main','proof-session','proposer','editor'}<=set(p['article_authors']))
            self.assertNotIn('main',p['excluded_reviewers'])
            with self.assertRaisesRegex(ValueError,'independent'):f.publish(self.r,self.map_verdict(name,'map','extractor'))
            f.publish(self.r,self.map_verdict(name,'map','main'))
            self.assertEqual(f.request_progress(self.r,'c')['status'],'published')
            self.assertEqual(f.accept(self.r,NS(id='c2',verdict=self.r/'reviews/c2/v.json'))['status'],'published')

    def test_publication_record_before_pointer_is_still_pending(self):
        self.original();self.ready();f.accept(self.r,NS(id='c2',verdict=self.verdict('c2','fix')))
        write=f.write
        def interrupted(path,value):
            if path==self.r/'workspace.json' and value.get('revision')==1:raise OSError('fixture interruption')
            write(path,value)
        with patch.object(f,'write',side_effect=interrupted):
            with self.assertRaises(OSError):self.publish_fixed('c2','Definition A.\nTheorem B.\nConditional C.\n')
        self.assertEqual(f.request_progress(self.r,'c')['status'],'resume_commit')
        f.publish(self.r,NS(id='c2',round='m1',verdict=self.r/'reviews/c2/maps/m1/v.json'))
        self.assertEqual(f.request_progress(self.r,'c')['status'],'published')

    def test_baseline_known_author_and_additional_exclusion(self):
        f.write(self.r/'provenance.json',dict(author_identity='historical-author',contributor_identities=['coauthor']))
        s=f.state(self.r);s['baseline_provenance']='provenance.json';f.write(self.r/'workspace.json',s)
        a=self.map_args('baseline-map','m',current=True);a.exclude_reviewers=['known-extra']
        p=f.map_packet(self.r,a)
        self.assertTrue({'historical-author','coauthor'}<=set(p['article_authors']))
        self.assertEqual(p['excluded_reviewers'],['extractor','known-extra'])
        f.publish(self.r,self.map_verdict('baseline-map','m'))
        p=f.map_packet(self.r,self.map_args('baseline-map2','m',current=True))
        self.assertNotIn('known-extra',p['excluded_reviewers'])
        self.assertTrue({'historical-author','coauthor'}<=set(p['article_authors']))

    def test_old_identical_map_replay_preserves_later_authors_and_pointer(self):
        self.published_correction()
        f.map_packet(self.r,self.map_args('m1','map',current=True));first=self.map_verdict('m1','map')
        f.publish(self.r,first)
        a=self.map_args('m2','map',current=True);a.exclude_reviewers=['later-known-author']
        f.map_packet(self.r,a);s=f.publish(self.r,self.map_verdict('m2','map'))
        self.assertEqual(f.publish(self.r,first),s)
        p=f.map_packet(self.r,self.map_args('m3','map',current=True))
        self.assertNotIn('later-known-author',p['excluded_reviewers'])
        self.assertTrue(set(s['article_authors'])<=set(p['article_authors']))

    def test_map_prepared_before_same_bytes_publication_is_stale(self):
        self.published_correction()
        f.map_packet(self.r,self.map_args('early','map',current=True));old=self.map_verdict('early','map')
        a=self.map_args('later','map',current=True);a.exclude_reviewers=['new-author']
        f.map_packet(self.r,a);f.publish(self.r,self.map_verdict('later','map'))
        with self.assertRaisesRegex(ValueError,'stale projection publication'):f.publish(self.r,old)
