import json,sys,threading,urllib.request,urllib.error
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'runtime'))
import unittest
import test_view_data as fixtures
import trajectory_view as tv
class TrajectoryTests(unittest.TestCase):
    setUp=fixtures.ViewTests.setUp
    archive=fixtures.ViewTests.archive
    hashes=fixtures.ViewTests.hashes
    def test_graphical_input_retains_round_and_exact_baseline(self):
        self.archive();before=self.hashes();data=tv.load_input(self.r)
        self.assertEqual(len(data['process']['runs']),1)
        self.assertEqual(data['bundle']['steps'][0]['article_revision'],0)
        self.assertIn('轮初基线',data['bundle']['steps'][0]['o'])
        self.assertIn('no_change',data['process']['runs'][0]['result_summary'])
        self.assertEqual(before,self.hashes())
    def test_partial_and_empty_graph_input(self):
        self.assertIsNone(tv.load_input(self.r)['bundle'])
        (self.r/'attempts/partial').mkdir(parents=True)
        data=tv.load_input(self.r);self.assertIsNone(data['bundle'])
        self.assertTrue(data['process']['runs'][0]['warnings'])
    def test_pinned_assets_and_readonly_server(self):
        self.archive();before=self.hashes();a=tv.assets();self.assertIn(b'article-replay.js',tv.page(a))
        server,url=tv.server(self.r);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            self.assertIn('研究轨迹',urllib.request.urlopen(url).read().decode())
            data=json.load(urllib.request.urlopen(url+'api/pure-graph-input'));self.assertEqual(len(data['bundle']['steps']),1)
            for path in ['../../workspace.json','workspace.json']:
                with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(url+path)
            with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(urllib.request.Request(url,data=b'{}'))
        finally:server.shutdown();server.server_close();thread.join()
        self.assertEqual(before,self.hashes())
