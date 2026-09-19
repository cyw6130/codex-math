"""Evidence validation only; fixtures do not claim independent mathematical review."""
import copy
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch
import test_article_flow as article_tests
f = article_tests.f

class SourceRecords(unittest.TestCase):
    def setUp(self):
        self.m = dict(entries=[dict(id='E')], inferences=[dict(id='P')])
        self.paper = '# Title\nStatement\nProof\n'
        self.loc = dict(heading='Title', line_start=1, line_end=3)
        self.v = dict(assessments=[dict(source_locator=self.loc.copy(), reason='Source statement')],
                      source_coverage=[dict(source_locator=self.loc.copy(), mapped_object_ids=['E', 'P'],
                                            disposition='covered', reason='Statement and proof')])

    def check(self, v):
        f.validate_map_review_sources(v, self.m, self.paper)

    def test_complete_and_justified_unextracted_sources(self):
        self.check(self.v)
        self.v['source_coverage'][0].update(mapped_object_ids=[], disposition='not-extracted-justified')
        self.check(self.v)

    def test_missing_empty_or_malformed_coverage(self):
        for value in [None, [], {}, [None]]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.check(dict(self.v, source_coverage=value))

    def test_invalid_locators_on_both_record_types(self):
        for key in ['assessments', 'source_coverage']:
            for loc in [None, {}, dict(self.loc, heading=' '), dict(self.loc, line_start=True),
                        dict(self.loc, line_start=0), dict(self.loc, line_start=2, line_end=1),
                        dict(self.loc, line_end=4), dict(self.loc, line_end=3.0)]:
                v=copy.deepcopy(self.v);v[key][0]['source_locator']=loc
                with self.subTest(key=key, loc=loc), self.assertRaises(ValueError): self.check(v)

    def test_unknown_duplicate_and_inconsistent_references(self):
        for ids, disposition in [(['missing'], 'covered'), (['E','E'], 'covered'),
                                 ([], 'covered'), (['E'], 'not-extracted-justified'),
                                 ([], 'unknown'), ([{}], 'covered')]:
            v=copy.deepcopy(self.v);v['source_coverage'][0].update(mapped_object_ids=ids, disposition=disposition)
            with self.subTest(ids=ids), self.assertRaises(ValueError): self.check(v)

    def test_gaps_and_overlaps(self):
        for spans in [[(2,3)], [(1,2)], [(1,1),(3,3)], [(1,1),(1,1),(3,3)]]:
            v=copy.deepcopy(self.v)
            v['source_coverage']=[dict(v['source_coverage'][0],source_locator=dict(self.loc,line_start=a,line_end=b)) for a,b in spans]
            with self.subTest(spans=spans), self.assertRaises(ValueError): self.check(v)
        v=copy.deepcopy(self.v)
        v['source_coverage']=[dict(v['source_coverage'][0],source_locator=dict(self.loc,line_start=a,line_end=b)) for a,b in [(2,3),(1,2)]]
        self.check(v)

    def test_blank_source_gaps_are_not_omissions(self):
        self.paper = '# Title\n   \nProof\n\n'
        item = self.v['source_coverage'][0]
        self.v['source_coverage'] = [dict(item, source_locator=dict(self.loc,line_start=a,line_end=b)) for a,b in [(1,1),(3,3)]]
        self.check(self.v)

    def test_blank_reasons_are_rejected(self):
        for key in ['assessments', 'source_coverage']:
            v=copy.deepcopy(self.v);v[key][0]['reason']=' '
            with self.subTest(key=key), self.assertRaises(ValueError): self.check(v)

class PublicationGate(unittest.TestCase):
    setUp=article_tests.InterfaceTests.setUp

    def test_missing_coverage_cannot_publish_or_change_workspace(self):
        sha=f.digest(self.r/'base.md')
        f.write(self.r/'check.json',dict(source_sha256=sha))
        f.write(self.r/'valid.json',dict(source_sha256=sha,map_sha256=f.digest(self.r/'base.json'),errors=[],validator='test-fixture'))
        f.map_packet(self.r,NS(id='mapfix',round='r1',map=self.r/'base.json',source_check=self.r/'check.json',validation=self.r/'valid.json',identity='extractor',current=True))
        q=self.r/'reviews/mapfix/maps/r1'
        v=dict(packet_sha256=f.digest(q/'packet.json'),reviewer_identity='independent',verdict='accepted-for-projection',score=100,coverageRatio=1,sourceClean=True,omissions=[],distortions=[],fabrications=[],unresolved=[],assessments=[])
        f.write(q/'input-verdict.json',v)
        before=(self.r/'workspace.json').read_bytes()
        with self.assertRaisesRegex(ValueError,'source_coverage'):
            f.publish(self.r,NS(id='mapfix',round='r1',verdict=q/'input-verdict.json'))
        self.assertEqual(before,(self.r/'workspace.json').read_bytes())
        self.assertFalse((self.r/'reviews/mapfix/published.json').exists())

    def test_historical_receipt_replays_with_exact_bindings(self):
        # Simulate a pre-upgrade publication, then exercise the real upgraded gate.
        # Reuse the fixture's successful publish; remove new evidence before receipt creation.
        writer = f.write
        def legacy_write(path, value):
            if path.name == 'input-verdict.json' and isinstance(value, dict):
                value = dict(value); value.pop('source_coverage', None)
            return writer(path, value)
        with patch.object(f, 'write', side_effect=legacy_write), patch.object(f, 'validate_map_review_sources'):
            article_tests.InterfaceTests.test_map_only_review_does_not_commit_mathematics(self)
        args=NS(id='mapfix',round='r1',verdict=self.r/'reviews/mapfix/maps/r1/input-verdict.json')
        published=f.state(self.r)
        self.assertEqual(f.publish(self.r,args), published)
        # Receipt was persisted but pointer update was interrupted.
        initial=dict(published, map='base.json',map_sha256=f.digest(self.r/'base.json'),map_review='not-run')
        for key in ['publication_receipt','publication_receipt_sha256','last_request']:
            initial.pop(key,None)
        f.write(self.r/'workspace.json',initial)
        self.assertEqual(f.publish(self.r,args)['map_review'],'independent-passed')
