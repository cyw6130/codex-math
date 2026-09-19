import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).parents[1]/'runtime'))
import dispatch_log as d


class DispatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.context='a'*64;self.prompt=self.root/'input.md';self.prompt.write_text('task1\n'+self.context+'\n完整数学材料（测试）')
        self.evidence=self.root/'receipt.txt';self.evidence.write_text('TEST FIXTURE observed dialogue receipt')
        self.start='2026-09-12T00:00:00+00:00'
        d.prepare(self.root/'dispatch','task1','session',self.prompt,self.context,self.start)
    def move(self,action,time='2026-09-12T00:01:00+00:00',evidence=None):
        return d.transition(self.root/'dispatch','task1',action,time,evidence)
    def test_send_before_receipt_and_unknown_recovery_do_not_resend(self):
        sent=self.move('sending');deadline=sent['deadline_at'];self.move('unknown')
        with self.assertRaisesRegex(ValueError,'illegal'):self.move('sending')
        found=self.move('found','2026-09-12T01:00:00+00:00',self.evidence)
        self.assertEqual(found['status'],'sent');self.assertEqual(found['deadline_at'],deadline)
        with self.assertRaisesRegex(ValueError,'illegal'):self.move('sending','2026-09-12T01:01:00+00:00')
    def test_receipt_cannot_be_invented_and_old_evidence_cannot_change(self):
        self.move('sending')
        with self.assertRaisesRegex(ValueError,'evidence'):self.move('sent')
        state=self.move('sent',evidence=self.evidence)
        saved=self.root/'dispatch/task1'/state['events'][-1]['evidence'];saved.write_text('tampered')
        with self.assertRaises(ValueError):self.move('returned',evidence=self.evidence)
    def test_confirmed_absence_permits_new_send_and_preserves_history(self):
        self.move('sending');self.move('unknown');self.move('absent',evidence=self.evidence)
        retried=self.move('sending','2026-09-12T00:20:00+00:00')
        self.assertEqual(retried['deadline_at'],'2026-09-12T02:20:00+00:00');self.assertEqual(len(retried['events']),4)
    def test_next_check_respects_oldest_deadline(self):
        tasks=[dict(status='sent',deadline_at='2026-09-12T02:00:00Z'),dict(status='sent',deadline_at='2026-09-12T03:45:00Z')]
        self.assertEqual(d.next_check(tasks,'2026-09-12T01:45:00Z','2026-09-12T02:15:00Z'),'2026-09-12T02:00:00+00:00')
    def test_unknown_requires_immediate_inspection_and_returned_is_ignored(self):
        tasks=[dict(status='dispatch_unknown',deadline_at='2026-09-12T02:00:00Z')]
        self.assertEqual(d.next_check(tasks,self.start,'2026-09-12T00:15:00Z'),self.start)
        tasks[0]['status']='returned'
        self.assertEqual(d.next_check(tasks,self.start,'2026-09-12T00:15:00Z'),'2026-09-12T00:15:00+00:00')
    def test_prepared_retry_cannot_replace_prompt(self):
        self.prompt.write_text('different task1 '+self.context)
        with self.assertRaisesRegex(ValueError,'retry differs'):d.prepare(self.root/'dispatch','task1','session',self.prompt,self.context,self.start)
    def test_no_direct_ack_without_send_intent(self):
        with self.assertRaisesRegex(ValueError,'illegal'):self.move('sent',evidence=self.evidence)

if __name__=='__main__':unittest.main()
