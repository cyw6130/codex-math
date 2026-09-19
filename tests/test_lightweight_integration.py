"""Transaction tests; native mathematics checks are mocked, not real proof audits."""
import unittest
from types import SimpleNamespace as NS
import test_increment_pipeline as pipeline
f=pipeline.f

class LightweightIntegration(unittest.TestCase):
    setUp=pipeline.IncrementPipeline.setUp
    candidate=pipeline.IncrementPipeline.candidate
    accepted=pipeline.IncrementPipeline.accepted
    def light(self, d=None, **changes):
        if d is None:d=self.accepted()
        paper=self.r/'complete.md'
        paper.write_text(f.apply_delta((d/'base-paper.md').read_text(),f.read(d/'attempts/a/delta.json')))
        check=dict(schema='article-maintenance-check/v1',classification='simple-insertion',
                   maintainer_identity='writer',commit_sha256=f.digest(d/'commit.json'),
                   paper_sha256=f.digest(paper),complete=True,faithful=True,issues=[],risk_flags=[],
                   coverage='Fixture: old A and B retained, accepted C inserted; no dependency changes.')
        check.update(changes);f.write(self.r/'check.json',check)
        return d,NS(id='c',round='light',paper=paper,identity='writer',lightweight_check=self.r/'check.json')
    def test_light_receipt_and_retry(self):
        d,a=self.light();f.article_packet(self.r,a)
        u=NS(id='c',round='light',verdict=self.r/'check.json')
        receipt=f.update_article(self.r,u)
        self.assertIn('not an independent',receipt['verification'])
        self.assertEqual(receipt,f.update_article(self.r,u))
        self.assertEqual(f.article_binding(self.r,'c')[0],d/'articles/light/paper.md')
        self.assertFalse((d/'articles/light/native-receipt.json').exists())
        self.native_mock.stop()
        with self.assertRaises((ValueError,OSError)):f.article_binding(self.r,'c')
    def test_risk_flags_require_independent(self):
        d,a=self.light(risk_flags=['cross-chapter dependency'])
        with self.assertRaisesRegex(ValueError,'independent'):f.article_packet(self.r,a)
    def test_wrong_identity_rejected(self):
        d,a=self.light(maintainer_identity='someone-else')
        with self.assertRaisesRegex(ValueError,'identity'):f.article_packet(self.r,a)
    def test_old_text_changes_rejected_even_with_matching_paper_hash(self):
        d,a=self.light();a.paper.write_text(a.paper.read_text().replace('Definition A.','Definition A revised.'))
        c=f.read(a.lightweight_check);c['paper_sha256']=f.digest(a.paper);f.write(a.lightweight_check,c)
        with self.assertRaisesRegex(ValueError,'non-exact'):f.article_packet(self.r,a)
    def test_replacement_is_not_insertion(self):
        self.assertFalse(f.insertion_matches('A B',[dict(edits=[dict(before='B',after='C')])],'A C'))
    def test_main_can_reorganize_editorially_without_another_native_review(self):
        d,a=self.light(classification='editorial-integration')
        commit=f.digest(d/'commit.json')
        a.paper.write_text('# Definitions\n\nDefinition A.\n\n# Results\n\nTheorem B.\n\nTheorem C.\n')
        c=f.read(a.lightweight_check)
        c.update(paper_sha256=f.digest(a.paper),coverage='Main checked A, B and accepted C are unchanged; only headings and spacing were added.')
        f.write(a.lightweight_check,c)
        f.article_packet(self.r,a)
        receipt=f.update_article(self.r,NS(id='c',round='light',verdict=a.lightweight_check))
        self.assertEqual(commit,f.digest(d/'commit.json'))
        self.assertIn('not an independent',receipt['verification'])
        self.assertEqual(f.article_binding(self.r,'c')[0].read_text(),a.paper.read_text())
        self.assertFalse((d/'articles/light/native-receipt.json').exists())
    def test_editorial_claim_with_unresolved_math_is_not_a_pass(self):
        d,a=self.light(classification='editorial-integration',issues=['Condition of C may be missing.'])
        with self.assertRaisesRegex(ValueError,'independent'):f.article_packet(self.r,a)
    def test_editorial_check_is_still_bound_to_the_actual_article(self):
        d,a=self.light(classification='editorial-integration')
        a.paper.write_text(a.paper.read_text()+'Unreviewed text.')
        with self.assertRaisesRegex(ValueError,'different content'):f.article_packet(self.r,a)
    def test_focus_preserves_sources_and_is_hash_bound(self):
        d=self.accepted();focus=f.read(d/'review-focus.json')
        self.assertEqual(focus['changes'][0]['attempt_id'],'a')
        self.assertTrue(focus['changes'][0]['evidence'])
        self.assertTrue((d/focus['base_paper']).exists())
        (d/'review-focus.json').write_text('{}')
        with self.assertRaises(ValueError):f.committed_increment(self.r,'c')
    def test_copied_packet_cannot_substitute_different_increment(self):
        d,a=self.light();f.article_packet(self.r,a);q=d/'articles/light'
        packet=f.read(q/'packet.json');accepted=f.read(q/'accepted/packet.json')
        accepted['selected']=[];f.write(q/'accepted/packet.json',accepted)
        packet['files']['accepted/packet.json']=f.digest(q/'accepted/packet.json');f.write(q/'packet.json',packet)
        with self.assertRaisesRegex(ValueError,'copied accepted packet'):f.update_article(self.r,NS(id='c',round='light',verdict=a.lightweight_check))

    def article(self,d):
        _,a=self.light(d);f.article_packet(self.r,a)
        f.update_article(self.r,NS(id='c',round='light',verdict=a.lightweight_check))
        return d/'articles/light'
    def test_lightweight_full_publication_and_retry(self):
        pipeline.IncrementPipeline.test_commit_then_complete_article_then_map_publication(self)
