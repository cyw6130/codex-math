"""Contract regression fixtures: native checks mocked only for transaction tests."""
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
import test_article_flow as fixtures
f=fixtures.f
class IncrementPipeline(unittest.TestCase):
    setUp=fixtures.InterfaceTests.setUp
    candidate=fixtures.InterfaceTests.candidate
    def accepted(self):
        self.candidate();f.prepare(self.r,NS(id='c',attempts=['a'],identity='author',increment_only=True))
        d=self.r/'reviews/c'
        self.assertFalse((d/'paper.md').exists())
        self.assertEqual(f.read(d/'packet.json')['schema'],'research-increment-packet/v2')
        f.write(d/'v.json',dict(packet_sha256=f.digest(d/'packet.json'),reviewer_identity='reviewer',verdict='accept',increment='accept',accepted_attempts=['a']))
        c=f.accept(self.r,NS(id='c',verdict=d/'v.json'))
        self.assertNotIn('paper_sha256',c);self.assertEqual(c['status'],'article_update_pending')
        return d
    def article(self,d):
        (self.r/'complete.md').write_text('Definition A.\n\nTheorem B.\n\nTheorem C.\n')
        f.article_packet(self.r,NS(id='c',round='a1',paper=self.r/'complete.md',identity='article-writer'))
        q=d/'articles/a1'
        f.write(q/'v.json',dict(packet_sha256=f.digest(q/'packet.json'),reviewer_identity='integration-reviewer',verdict='accepted-for-article',complete=True,faithful=True,issues=[]))
        args=NS(id='c',round='a1',verdict=q/'v.json')
        receipt=f.update_article(self.r,args);self.assertEqual(receipt,f.update_article(self.r,args))
        return q
    def test_commit_then_complete_article_then_map_publication(self):
        d=self.accepted()
        with self.assertRaises((ValueError,OSError)):f.map_packet(self.r,NS(id='c',round='m1',identity='extractor'))
        q=self.article(d);paper,receipt,_=f.article_binding(self.r,'c')
        self.assertEqual(paper,q/'paper.md');self.assertEqual(f.state(self.r)['revision'],0)
        f.write(self.r/'check.json',dict(source_sha256=f.digest(paper)))
        f.write(self.r/'validation.json',dict(source_sha256=f.digest(paper),map_sha256=f.digest(self.r/'base.json'),errors=[],validator='test-only'))
        f.map_packet(self.r,NS(id='c',round='m1',identity='extractor',map=self.r/'base.json',source_check=self.r/'check.json',validation=self.r/'validation.json'))
        m=d/'maps/m1';f.write(m/'v.json',dict(packet_sha256=f.digest(m/'packet.json'),reviewer_identity='map-reviewer',verdict='accepted-for-projection',score=100,coverageRatio=1,sourceClean=True,omissions=[],distortions=[],fabrications=[],unresolved=[],assessments=[],source_coverage=[dict(source_locator=dict(heading="Fixture paper",line_start=1,line_end=len((m/'paper.md').read_text().splitlines())),mapped_object_ids=[],disposition='not-extracted-justified',reason='Empty-map test fixture; no mathematical review claimed.')]))
        args=NS(id='c',round='m1',verdict=m/'v.json');s=f.publish(self.r,args)
        self.assertEqual(s['revision'],1);self.assertEqual(s['paper_sha256'],f.digest(q/'paper.md'))
        self.assertEqual(s,f.publish(self.r,args));self.assertIsNone(s['pending'])
        self.assertEqual(f.accept(self.r,NS(id='c',verdict=d/'v.json'))['status'],'published')
    def test_article_without_commit_and_wrong_integration_reviewer_rejected(self):
        with self.assertRaises((ValueError,OSError)):f.article_packet(self.r,NS(id='missing',round='a1',paper=self.r/'base.md',identity='writer'))
        d=self.accepted();q=self.article(d)
        v=f.read(q/'v.json');v['reviewer_identity']='article-writer';f.write(q/'bad.json',v)
        with self.assertRaises(ValueError):f.update_article(self.r,NS(id='c',round='a1',verdict=q/'bad.json'))
    def test_mutating_maintained_article_blocks_map(self):
        d=self.accepted();q=self.article(d);(q/'paper.md').write_text('changed')
        with self.assertRaises(ValueError):f.article_binding(self.r,'c')
    def test_rejected_increment_has_no_commit(self):
        self.candidate();f.prepare(self.r,NS(id='c',attempts=['a'],identity='writer',increment_only=True));d=self.r/'reviews/c'
        f.write(d/'bad.json',dict(packet_sha256=f.digest(d/'packet.json'),reviewer_identity='reviewer',verdict='accept',increment='reject',accepted_attempts=['a']))
        with self.assertRaises(ValueError):f.accept(self.r,NS(id='c',verdict=d/'bad.json'))
        self.assertFalse((d/'commit.json').exists())

    def test_net_zero_increment_rejected(self):
        f.write(self.r/'delta.json',dict(edits=[dict(before='Theorem B.',after='Theorem C.'),dict(before='Theorem C.',after='Theorem B.')],rationale='Test net zero'))
        self.candidate()
        with self.assertRaisesRegex(ValueError,'net-zero'):f.prepare(self.r,NS(id='c',attempts=['a'],identity='author'))
        self.assertFalse((self.r/'reviews/c/packet.json').exists())
