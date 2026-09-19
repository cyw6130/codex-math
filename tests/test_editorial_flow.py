"""Editorial transaction tests; native review is mocked, never a math verdict."""
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
import test_article_flow as fixture
f = fixture.f


class EditorialFlow(unittest.TestCase):
    candidate = fixture.InterfaceTests.candidate
    prepared = fixture.InterfaceTests.prepared
    def setUp(self):
        fixture.InterfaceTests.setUp(self)
        f.write(self.r / 'provenance.json', {'paper_sha256': f.digest(self.r / 'base.md'), 'article_review': 'fixture'})
        s = f.state(self.r)
        s['baseline_provenance'] = 'provenance.json'
        f.write(self.r / 'workspace.json', s)

    def packet(self, name='edit', independent=False):
        s = f.state(self.r)
        paper = self.r / (name + '.md')
        paper.write_text('# Organized\n\n' + (self.r / s['paper']).read_text())
        check = self.r / (name + '.json')
        f.write(check, dict(schema='article-editorial-check/v1', maintainer_identity='editor',
                           base_paper_sha256=s['paper_sha256'], paper_sha256=f.digest(paper),
                           mathematics_changed=False, complete=True, faithful=True,
                           issues=[], risk_flags=[], coverage='Same statements, added navigation heading.'))
        a = NS(id=name, paper=paper, identity='editor', exclude_reviewers=[],
               lightweight_check=None if independent else check)
        p = f.editorial_packet(self.r, a)
        if independent:
            v = f.read(check)
            v.update(packet_sha256=f.digest(self.r / 'reviews' / name / 'packet.json'),
                     reviewer_identity='independent', verdict='accepted-for-article')
            f.write(check, v)
        return a, NS(id=name, verdict=check), p

    def test_publish_preserves_math_and_map_and_retry(self):
        old = f.state(self.r)
        a, u, p = self.packet()
        self.assertEqual(p, f.editorial_packet(self.r, a))
        s = f.publish_editorial(self.r, u)
        self.assertEqual(s['revision'], 1)
        self.assertEqual(s['map_revision'], 0)
        self.assertEqual(s['map_paper_sha256'], old['paper_sha256'])
        self.assertEqual(s, f.publish_editorial(self.r, u))
        self.assertFalse((self.r / 'reviews/edit/commit.json').exists())
        f.write(self.r / 'source.json', dict(source_sha256=s['paper_sha256']))
        f.write(self.r / 'validation.json', dict(source_sha256=s['paper_sha256'], map_sha256=s['map_sha256'], errors=[], validator='fixture'))
        mp = f.map_packet(self.r, NS(id='mapfix', round='m1', map=self.r / s['map'], source_check=self.r / 'source.json', validation=self.r / 'validation.json', identity='extractor', current=True, exclude_reviewers=[]))
        self.assertEqual(mp['revision'], 1)
        self.assertEqual(mp['files']['paper.md'], s['paper_sha256'])

    def test_stale_candidate_and_later_editorial_retry(self):
        _, first, _ = self.packet('first')
        _, stale, _ = self.packet('stale')
        f.publish_editorial(self.r, first)
        with self.assertRaisesRegex(ValueError, 'stale'):
            f.publish_editorial(self.r, stale)
        _, second, _ = self.packet('second')
        latest = f.publish_editorial(self.r, second)
        self.assertEqual(latest, f.publish_editorial(self.r, first))

    def test_interrupted_publication_recovers(self):
        _, u, _ = self.packet()
        real_write = f.write
        def fail_pointer(p, value):
            if p == self.r / 'workspace.json':
                raise OSError('simulated pointer interruption')
            return real_write(p, value)
        with patch.object(f, 'write', side_effect=fail_pointer):
            with self.assertRaises(OSError):
                f.publish_editorial(self.r, u)
        self.assertEqual(f.publish_editorial(self.r, u)['revision'], 1)

    def test_partial_packet_recovers(self):
        real_write = f.write
        def interrupt_packet(p, value):
            if p.name == 'packet.json':
                raise OSError('simulated packet interruption')
            return real_write(p, value)
        with patch.object(f, 'write', side_effect=interrupt_packet):
            with self.assertRaises(OSError):
                self.packet()
        _, u, _ = self.packet()
        self.assertEqual(f.publish_editorial(self.r, u)['revision'], 1)

    def test_mutation_and_math_changes_rejected(self):
        _, u, _ = self.packet()
        v = f.read(u.verdict)
        v['mathematics_changed'] = True
        f.write(u.verdict, v)
        with self.assertRaises(ValueError):
            f.publish_editorial(self.r, u)
        (self.r / 'reviews/edit/paper.md').write_text('tampered')
        with self.assertRaises(ValueError):
            f.publish_editorial(self.r, u)

    def test_independence_and_no_fake_receipt(self):
        _, u, _ = self.packet(independent=True)
        v = f.read(u.verdict)
        v['reviewer_identity'] = 'editor'
        f.write(u.verdict, v)
        with self.assertRaisesRegex(ValueError, 'independent'):
            f.publish_editorial(self.r, u)
        v['reviewer_identity'] = 'independent'
        f.write(u.verdict, v)
        self.native_mock.stop()
        with self.assertRaises((ValueError, OSError)):
            f.publish_editorial(self.r, u)

    def test_pending_research_blocks_editorial_publication(self):
        _, u, _ = self.packet()
        s = f.state(self.r)
        s['pending'] = 'new-math'
        f.write(self.r / 'workspace.json', s)
        with self.assertRaisesRegex(ValueError, 'active article'):
            f.publish_editorial(self.r, u)

    def test_legacy_joint_publication_is_the_basis(self):
        fixture.InterfaceTests.test_publication_and_retry(self)
        # A subsequent map-only publication replaces the map receipt pointer.
        s = f.state(self.r)
        f.write(self.r / 'source.json', dict(source_sha256=s['paper_sha256']))
        f.write(self.r / 'validation.json', dict(source_sha256=s['paper_sha256'], map_sha256=s['map_sha256'], errors=[], validator='fixture'))
        f.map_packet(self.r, NS(id='later-map', round='m1', map=self.r / s['map'], source_check=self.r / 'source.json', validation=self.r / 'validation.json', identity='extractor', current=True, exclude_reviewers=[]))
        q = self.r / 'reviews/later-map/maps/m1'
        v = f.read(self.r / 'reviews/c/maps/r1/input-verdict.json')
        v['packet_sha256'] = f.digest(q / 'packet.json')
        f.write(q / 'v.json', v)
        f.publish(self.r, NS(id='later-map', round='m1', verdict=q / 'v.json'))
        _, u, p = self.packet()
        self.assertEqual(p['files']['basis.json'], f.digest(self.r / 'reviews/c/published.json'))
        self.assertEqual(f.publish_editorial(self.r, u)['revision'], 2)
