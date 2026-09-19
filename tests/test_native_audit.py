import copy
import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
from native_audit import _native_metadata, ReviewError

class NativeContext(unittest.TestCase):
    def events(self):
        return [dict(type='session_meta',payload={'id':'reviewer'}),dict(type='event_msg',payload={'type':'task_started','turn_id':'t'}),dict(type='turn_context',payload={'turn_id':'t','model':'gpt-5.6-sol','effort':'medium','scope':{'path':'/x'}}),dict(type='event_msg',payload={'type':'task_complete','turn_id':'t'})]
    def test_identical_duplicate_payload_accepted(self):
        e=self.events();expected=_native_metadata(e);duplicate=copy.deepcopy(e[2]);duplicate['timestamp']='later';e.insert(3,duplicate)
        self.assertEqual(_native_metadata(e),expected)
    def test_conflicting_payload_rejected_even_if_model_same(self):
        e=self.events();duplicate=copy.deepcopy(e[2]);duplicate['payload']['scope']['path']='/y';e.insert(3,duplicate)
        with self.assertRaisesRegex(ReviewError,'conflicting'):_native_metadata(e)
    def test_latest_incomplete_turn_still_rejected(self):
        e=self.events();e.append(dict(type='event_msg',payload={'type':'task_started','turn_id':'new'}))
        with self.assertRaisesRegex(ReviewError,'incomplete'):_native_metadata(e)
    def test_missing_context_rejected(self):
        e=self.events();e.pop(2)
        with self.assertRaisesRegex(ReviewError,'lacks turn_context'):_native_metadata(e)
