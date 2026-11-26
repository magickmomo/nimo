"""Offline tests for the server-side experiment exporter."""
import tempfile
import unittest
from pathlib import Path

import nimo_core as core
import export_server_experiment as exported


class ServerExperimentExportTests(unittest.TestCase):
    def test_exports_full_10_decisions_without_network_or_secrets(self):
        with tempfile.TemporaryDirectory() as root:
            path = str(Path(root) / "trial.sqlite3")
            db = core.open_db(path)
            try:
                core.run(db, core.MockAI(), 10)
                result = exported.summarise(path)
                self.assertEqual(result["decision_count"], 10)
                self.assertEqual(result["completed_count"], 10)
                self.assertEqual(result["failed_count"], 0)
                self.assertEqual(sum(result["action_counts"].values()), 10)
                self.assertEqual(len(result["memories"]), 1)
                self.assertGreaterEqual(len(result["thinking"]), 1)
                self.assertEqual(result["model_call_count"], len(result["model_calls"]))
                self.assertTrue(result["decisions"][0]["want"])
            finally:
                db.close()


if __name__ == "__main__":
    unittest.main()
