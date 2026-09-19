"""Published result frames are read from bound archives; audit fixtures are mocked."""
import unittest
from unittest.mock import patch
from types import SimpleNamespace as NS
import test_publication_decoupling as pub
import trajectory_view as tv
f=pub.f
class ResultFrames(unittest.TestCase):
    setUp=pub.PublicationDecoupling.setUp
    candidate=pub.PublicationDecoupling.candidate
    accepted=pub.PublicationDecoupling.accepted
    article=pub.PublicationDecoupling.article
    first=pub.PublicationDecoupling.first
    next_article=pub.PublicationDecoupling.next_article
    map_args=pub.PublicationDecoupling.map_args
    map_verdict=pub.PublicationDecoupling.map_verdict
    def load(self):
        with patch.object(tv.view_data,'f',f):return tv.load_input(self.r)
    def publish_map(self,req):
        f.map_packet(self.r,self.map_args(req,'m'));f.publish(self.r,self.map_verdict(req,'m'))
    def test_result_frame_and_previous_publication_comparison(self):
        self.first();self.publish_map('c');self.next_article();f.publish_article(self.r,NS(id='d'));self.publish_map('d')
        before={str(p):f.digest(p) for p in self.r.rglob('*') if p.is_file()}
        data=self.load();steps=data['bundle']['steps'];results=[s for s in steps if s['a']=='已发布地图']
        self.assertEqual(len(results),2);self.assertEqual([s['article_revision'] for s in results],[1,2])
        self.assertTrue(results[1]['comparison_source'].endswith('reviews/c/maps/m/math-map.json'))
        self.assertEqual(before,{str(p):f.digest(p) for p in self.r.rglob('*') if p.is_file()})
    def test_no_result_frame_while_map_pending(self):
        self.first();data=self.load()
        self.assertFalse(any(s['a']=='已发布地图' for s in data['bundle']['steps']))
        self.assertTrue(any('尚待发布' in w for r in data['process']['runs'] for w in r['warnings']))
    def test_tampered_published_map_rejected(self):
        self.first();self.publish_map('c')
        f.write(self.r/'reviews/c/maps/m/math-map.json',{'broken':True})
        with self.assertRaises(ValueError):self.load()
