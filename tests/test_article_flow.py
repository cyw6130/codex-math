import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace as NS
import tempfile
import unittest
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).parents[1] / "runtime"))
spec = importlib.util.spec_from_file_location('flow', Path(__file__).parents[1] / 'runtime/article_flow.py')
f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)

class InterfaceTests(unittest.TestCase):
    def setUp(self):
        self.native_mock = patch.object(f, "native_check"); self.native_mock.start(); self.addCleanup(self.native_mock.stop)
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.r = Path(self.tmp.name)
        (self.r/'base.md').write_text('Definition A.\nTheorem B.\n')
        self.m = dict(entries=[],inferences=[],b0ClaimEntryIds=[],negationPairs=[])
        f.write(self.r/'base.json',self.m)
        f.write(self.r/'workspace.json',dict(schema='math-workspace/v1',revision=0,paper='base.md',map='base.json',paper_sha256=f.digest(self.r/'base.md'),map_sha256=f.digest(self.r/'base.json'),pending=None))
        (self.r/'g.md').write_text('User: prove C.'); (self.r/'t.md').write_text('Actual test fixture transcript')
        (self.r/'e.md').write_text('Test fixture proof')
        f.write(self.r/'delta.json',dict(edits=[dict(before='Theorem B.',after='Theorem B.\nTheorem C.')],rationale='test fixture'))
    def candidate(self, id='a'):
        f.start(self.r, NS(id=id,objective='C',identity='proposer',grilling=self.r/'g.md',sources=[]))
        return f.finish(self.r, NS(id=id,outcome='candidate',transcript=self.r/'t.md',delta=self.r/'delta.json',evidence=[self.r/'e.md']))
    def prepared(self):
        self.candidate(); p=f.prepare(self.r, NS(id='c',attempts=['a'],identity='editor',increment_only=False))
        d=self.r/'reviews/c'; (d/'native-review.txt').write_text('TEST FIXTURE NOT REAL REVIEW')
        v=dict(packet_sha256=f.digest(d/'packet.json'),reviewer_identity='reviewer',native_output_sha256=f.digest(d/'native-review.txt'),verdict='accept',accepted_attempts=['a'],article_whole='accept')
        f.write(d/'input-verdict.json',v); return d,v
    def test_no_change_archive(self):
        f.start(self.r,NS(id='a',objective='C',identity='author',grilling=self.r/'g.md',sources=[]))
        args=NS(id='a',outcome='no_change',transcript=self.r/'t.md',delta=None,evidence=[])
        self.assertEqual(f.finish(self.r,args),f.finish(self.r,args))
        self.assertEqual(f.state(self.r)['revision'],0)
    def test_tampered_evidence_refused(self):
        self.candidate(); (self.r/'attempts/a/evidence/0000').write_text('tampered')
        with self.assertRaises(ValueError): f.prepare(self.r, NS(id='c',attempts=['a'],identity='editor',increment_only=False))
    def test_stale_candidate_refused(self):
        self.candidate(); s=f.state(self.r); s['revision']=1; f.write(self.r/'workspace.json',s)
        with self.assertRaises(ValueError): f.prepare(self.r, NS(id='c',attempts=['a'],identity='editor',increment_only=False))
    def test_exact_selection_and_independence(self):
        d,v=self.prepared(); v['reviewer_identity']='proposer'; f.write(d/'input-verdict.json',v)
        with self.assertRaises(ValueError): f.accept(self.r, NS(id='c',verdict=d/'input-verdict.json'))
        v['reviewer_identity']='reviewer';v['accepted_attempts']=[];f.write(d/'input-verdict.json',v)
        with self.assertRaises(ValueError): f.accept(self.r, NS(id='c',verdict=d/'input-verdict.json'))
    def test_publication_and_retry(self):
        d,v=self.prepared(); args=NS(id='c',verdict=d/'input-verdict.json')
        receipt=f.accept(self.r,args); self.assertEqual(f.accept(self.r,args),receipt)
        self.assertEqual(f.state(self.r)['revision'],0)
        with self.assertRaises(ValueError): f.start(self.r,NS(id='b',objective='D',identity='p',grilling=self.r/'g.md',sources=[]))
        f.write(self.r/'check.json',dict(source_sha256=f.digest(d/'paper.md')))
        f.write(self.r/'valid.json',dict(source_sha256=f.digest(d/'paper.md'),map_sha256=f.digest(self.r/'base.json'),errors=[],validator='test-fixture'))
        f.map_packet(self.r,NS(id='c',round='r1',map=self.r/'base.json',source_check=self.r/'check.json',validation=self.r/'valid.json',identity='extractor'))
        q=d/'maps/r1';(q/'native-review.txt').write_text('TEST FIXTURE')
        v=dict(packet_sha256=f.digest(q/'packet.json'),reviewer_identity='map-reviewer',native_output_sha256=f.digest(q/'native-review.txt'),verdict='accepted-for-projection',score=100,coverageRatio=1,sourceClean=True,omissions=[],distortions=[],fabrications=[],unresolved=[],assessments=[],source_coverage=[dict(source_locator=dict(heading="Fixture paper",line_start=1,line_end=len((q/'paper.md').read_text().splitlines())),mapped_object_ids=[],disposition='not-extracted-justified',reason='Empty-map test fixture; no mathematical review claimed.')])
        f.write(q/'input-verdict.json',v)
        result=f.publish(self.r,NS(id='c',round='r1',verdict=q/'input-verdict.json'))
        self.assertEqual(result['revision'],1);self.assertIn('Theorem C.',(self.r/result['paper']).read_text())
        self.assertEqual(f.publish(self.r,NS(id='c',round='r1',verdict=q/'input-verdict.json')),result)
        self.assertEqual(f.accept(self.r,args)['status'],'published')
        f.links(self.r);self.assertEqual((self.r/'paper.md').read_text(),(self.r/result['paper']).read_text())
    def test_map_only_review_does_not_commit_mathematics(self):
        sha=f.digest(self.r/'base.md')
        f.write(self.r/'check.json',dict(source_sha256=sha))
        f.write(self.r/'valid.json',dict(source_sha256=sha,map_sha256=f.digest(self.r/'base.json'),errors=[],validator='test-fixture'))
        f.map_packet(self.r,NS(id='mapfix',round='r1',map=self.r/'base.json',source_check=self.r/'check.json',validation=self.r/'valid.json',identity='extractor',current=True))
        q=self.r/'reviews/mapfix/maps/r1'
        v=dict(packet_sha256=f.digest(q/'packet.json'),reviewer_identity='independent',verdict='accepted-for-projection',score=100,coverageRatio=1,sourceClean=True,omissions=[],distortions=[],fabrications=[],unresolved=[],assessments=[],source_coverage=[dict(source_locator=dict(heading="Fixture paper",line_start=1,line_end=len((q/'paper.md').read_text().splitlines())),mapped_object_ids=[],disposition='not-extracted-justified',reason='Empty-map test fixture; no mathematical review claimed.')])
        f.write(q/'input-verdict.json',v)
        result=f.publish(self.r,NS(id='mapfix',round='r1',verdict=q/'input-verdict.json'))
        self.assertEqual(result['revision'],0)
        self.assertFalse((self.r/'reviews/mapfix/commit.json').exists())
        self.assertEqual(result['map_review'],'independent-passed')
    def test_fake_native_review_rejected_in_production(self):
        d,v=self.prepared(); self.native_mock.stop()
        with self.assertRaises((ValueError,FileNotFoundError)):
            f.accept(self.r,NS(id='c',verdict=d/'input-verdict.json'))
    def test_partial_start_recovery(self):
        d=self.r/'attempts/a';d.mkdir(parents=True);(d/'grilling.md').write_text((self.r/'g.md').read_text())
        f.start(self.r,NS(id='a',objective='C',identity='p',grilling=self.r/'g.md',sources=[]))
        self.assertTrue((d/'run.json').exists())
    def test_external_path_rejected(self):
        s=f.state(self.r);s['paper']=str(self.r/'base.md');f.write(self.r/'workspace.json',s)
        with self.assertRaises(ValueError):f.state(self.r)
    def test_changed_publication_receipt(self):
        self.test_publication_and_retry()
        (self.r/'reviews/c/published.json').write_text('{}')
        with self.assertRaises(ValueError):f.state(self.r)
    def test_conflicting_edits(self):
        with self.assertRaises(ValueError): f.apply_delta('x x',dict(edits=[dict(before='x',after='y')]))
    def test_missing_source_validation(self):
        d,v=self.prepared(); f.accept(self.r,NS(id='c',verdict=d/'input-verdict.json'))
        f.write(self.r/'check.json',dict(source_sha256='wrong'));f.write(self.r/'valid.json',{})
        with self.assertRaises(ValueError): f.map_packet(self.r,NS(id='c',round='r1',map=self.r/'base.json',source_check=self.r/'check.json',validation=self.r/'valid.json',identity='extractor'))

if __name__=='__main__': unittest.main()
