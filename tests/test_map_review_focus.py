"""Reading-index and archival compatibility tests; native audits are fixtures."""
import copy
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch
import test_publication_decoupling as publication
f=publication.f

class MapReviewFocus(unittest.TestCase):
    setUp=publication.PublicationDecoupling.setUp
    candidate=publication.PublicationDecoupling.candidate
    accepted=publication.PublicationDecoupling.accepted
    article=publication.PublicationDecoupling.article
    first=publication.PublicationDecoupling.first
    next_article=publication.PublicationDecoupling.next_article
    map_args=publication.PublicationDecoupling.map_args
    map_verdict=publication.PublicationDecoupling.map_verdict

    def publish_basis(self):
        self.first()
        f.map_packet(self.r,self.map_args('c','m'))
        f.publish(self.r,self.map_verdict('c','m'))
        return self.r/'reviews/c/maps/m'

    def test_first_map_requires_full_scope_without_prior_review(self):
        self.first();p=f.map_packet(self.r,self.map_args('c','m'))
        q=self.r/'reviews/c/maps/m'
        focus=f.read(q/'review-focus.json')
        self.assertEqual(focus['suggested_scope'],'full')
        self.assertIsNone(focus['previous_review'])
        self.assertIn('Theorem C.',focus['article_diff'])
        self.assertEqual(p['files']['review-focus.json'],f.digest(q/'review-focus.json'))

    def test_incremental_uses_reviewed_article_when_map_lags(self):
        basis=self.publish_basis();self.next_article();f.publish_article(self.r,NS(id='d'))
        f.map_packet(self.r,self.map_args('d','m'))
        focus=f.read(self.r/'reviews/d/maps/m/review-focus.json')
        self.assertEqual(focus['suggested_scope'],'incremental')
        self.assertEqual(focus['previous_review']['paper.md']['sha256'],f.digest(basis/'paper.md'))
        self.assertIn('+Theorem D.',focus['article_diff'])
        self.assertEqual(focus['changed'],[])  # Source change alone still requires reading.

    def test_packet_retry_does_not_rebase_after_another_map_publishes(self):
        self.publish_basis();self.next_article();f.publish_article(self.r,NS(id='d'))
        args=self.map_args('d','m');p=f.map_packet(self.r,args)
        focus=f.read(self.r/'reviews/d/maps/m/review-focus.json')
        f.map_packet(self.r,self.map_args('manual','m',current=True))
        f.publish(self.r,self.map_verdict('manual','m'))
        self.assertEqual(f.map_packet(self.r,self.map_args('d','m')),p)
        self.assertEqual(f.read(self.r/'reviews/d/maps/m/review-focus.json'),focus)

    def test_legacy_packet_retries_without_adding_focus(self):
        self.first();args=self.map_args('c','m');p=f.map_packet(self.r,args)
        q=self.r/'reviews/c/maps/m';p['files'].pop('review-focus.json')
        f.write(q/'packet.json',p);(q/'review-focus.json').unlink()
        self.assertEqual(f.map_packet(self.r,args),p)
        self.assertFalse((q/'review-focus.json').exists())

    def test_tampered_old_report_is_not_reused(self):
        q=self.publish_basis();v=f.read(q/'verdict.json');v['score']=0;f.write(q/'verdict.json',v)
        self.next_article()
        with self.assertRaisesRegex(ValueError,'verdict changed'):
            f.map_packet(self.r,self.map_args('d','m'))

    def test_object_and_dependency_diff_preserves_old_and_new_endpoints(self):
        q=self.publish_basis();s=f.state(self.r)
        def claim(i):return dict(id=i,entryClass='claim',claimKind='lemma',title=i,statement=i)
        old=dict(entries=[claim(i) for i in ['a','b','c','gone']],
                 inferences=[dict(id='p',operationKind='proof',premises=['a'],conclusion='b',argument='old')],
                 b0ClaimEntryIds=['a'],negationPairs=[dict(claimEntryIds=['b','c'])])
        new=copy.deepcopy(old);new['entries']=new['entries'][:-1]+[claim('new')]
        new['entries'][2]['statement']='changed c'
        new['inferences'][0]['premises']=['c'];new['b0ClaimEntryIds']=['c'];new['negationPairs']=[]
        # Swap the fixture basis and update its existing hash bindings; native check is mocked.
        f.write(q/'math-map.json',old);p=f.read(q/'packet.json');p['files']['math-map.json']=f.digest(q/'math-map.json');f.write(q/'packet.json',p)
        v=f.read(q/'verdict.json');v['packet_sha256']=f.digest(q/'packet.json');f.write(q/'verdict.json',v)
        pub=f.read(self.r/s['publication_receipt']);pub.update(map_sha256=f.digest(q/'math-map.json'),map_packet_sha256=f.digest(q/'packet.json'),map_verdict_sha256=f.digest(q/'verdict.json'));f.write(self.r/s['publication_receipt'],pub)
        dest=self.r/'new-map';dest.mkdir();f.write(dest/'math-map.json',new);(dest/'paper.md').write_text('New source.\n')
        focus=f.map_review_focus(self.r,dest,s,1)
        refs=lambda key:{(x['kind'],x['id']) for x in focus[key]}
        self.assertIn(('entry','new'),refs('added'));self.assertIn(('entry','gone'),refs('removed'))
        self.assertIn(('entry','c'),refs('changed'));self.assertIn(('inference','p'),refs('changed'))
        self.assertIn(('b0','c'),refs('added'));self.assertIn(('b0','a'),refs('removed'))
        self.assertIn(('negationPair','0'),refs('removed'))
        self.assertTrue({('entry','a'),('entry','b'),('entry','c'),('inference','p')}<=refs('related_objects_to_inspect'))
        self.assertIn(('entry','a'),refs('reuse_candidates'))  # Candidate, not approval.
