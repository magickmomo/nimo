"""Run with: cd nimo-core && python -m unittest -v"""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import nimo_core as core


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = core.open_db(str(Path(self.temp.name) / "core.db"))
        self.ai = core.MockAI()

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def rows(self, sql, *params):
        return self.db.execute(sql, params).fetchall()

    def test_crash_does_not_silently_resume_an_incomplete_decision(self):
        self.db.execute("INSERT INTO decisions(started_at,context_json,offered_json,status) VALUES(?,?,?,'running')",
                        (core.now(), "{}", "[]"))
        self.db.commit()
        with self.assertRaisesRegex(RuntimeError, "incomplete"):
            core.run(self.db, self.ai, 1)
        self.assertEqual(len(self.rows("SELECT * FROM decisions")), 1)

    def test_three_fixed_objects_reach_selector_and_generation_without_new_actions(self):
        expected = [dict(item) for item in core.KNOWN_OBJECTS]
        self.assertEqual(len(expected), 3)
        first = core.run_one(self.db, self.ai)
        self.assertEqual(first["status"], "completed")
        record = self.rows("SELECT context_json,offered_json FROM decisions WHERE id=1")[0]
        context = json.loads(record["context_json"])
        self.assertEqual(context["known_objects"], expected)
        self.assertEqual(json.loads(record["offered_json"]), list(core.ACTIONS))
        calls = self.rows("SELECT purpose,request_json FROM model_calls WHERE decision_id=1 ORDER BY id")
        self.assertEqual([c["purpose"] for c in calls], ["express_want", "select", "think"])
        intention_payload = json.loads(calls[0]["request_json"])
        self.assertEqual(json.loads(intention_payload["input"][1]["content"])["context"]["known_objects"], expected)
        selection_payload = json.loads(calls[1]["request_json"])
        self.assertEqual(selection_payload["input"][1]["content"][0]["data"]["known_objects"], expected)
        self.assertEqual(selection_payload["input"][1]["content"][0]["data"]["expressed_want"],
                         "I would like to explore something I have noticed.")
        generation_payload = json.loads(calls[2]["request_json"])
        self.assertEqual(json.loads(generation_payload["input"][1]["content"])["context"]["known_objects"], expected)
        self.assertEqual(json.loads(generation_payload["input"][1]["content"])["context"]["expressed_want"],
                         "I would like to explore something I have noticed.")
        self.assertEqual(context["expressed_want"], "I would like to explore something I have noticed.")
        core.run_one(self.db, self.ai)
        second = json.loads(self.rows("SELECT context_json FROM decisions WHERE id=2")[0]["context_json"])
        self.assertEqual(second["known_objects"], expected)

    def test_open_intention_is_logged_before_decisions_and_does_not_change_tool_menu(self):
        result = core.run_one(self.db, self.ai)
        self.assertEqual(result["expressed_want"], "I would like to explore something I have noticed.")
        calls = self.rows("SELECT purpose,request_json FROM model_calls WHERE decision_id=1 ORDER BY id")
        self.assertEqual([c["purpose"] for c in calls], ["express_want", "select", "think"])
        want_request = json.loads(calls[0]["request_json"])
        self.assertEqual(want_request["input"][1]["role"], "user")
        self.assertIn("what would you like to do",
                      want_request["input"][1]["content"].lower())
        selector_request = json.loads(calls[1]["request_json"])
        selector_context = selector_request["input"][1]["content"][0]["data"]
        self.assertEqual(selector_context["expressed_want"], result["expressed_want"])
        self.assertEqual([x["value"] for x in selector_request["questions"][0]["choices"]],
                         list(core.ACTIONS))

    def test_failed_intention_generation_prevents_selection_and_records_failure(self):
        class BadIntention(core.MockAI):
            def call(self, endpoint, payload):
                if endpoint == "responses" and '"express_want"' in payload["input"][1]["content"]:
                    return {"output": [{"content": [{"type": "output_text", "text": '{"want":""}'}]}]}
                return super().call(endpoint, payload)
        result = core.run_one(self.db, BadIntention())
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["selected"], "selection_error")
        self.assertIsNone(result["expressed_want"])
        self.assertEqual([r["purpose"] for r in self.rows("SELECT purpose FROM model_calls")],
                         ["express_want"])
        self.assertEqual(len(self.rows("SELECT * FROM experiences")), 1)

    def test_ten_decisions_guarantee_one_memory_even_with_failures(self):
        results = core.run(self.db, self.ai, 10)
        self.assertEqual(len(results), 10)
        self.assertEqual(len(self.rows("SELECT * FROM decisions")), 10)
        self.assertEqual(len(self.rows("SELECT * FROM experiences")), 10)
        memories = self.rows("SELECT * FROM memories")
        self.assertEqual(len(memories), 1)
        self.assertEqual(memories[0]["cycle_end_decision"], 10)
        self.assertEqual(json.loads(memories[0]["evidence_decision_ids_json"]), list(range(1, 11)))
        self.assertEqual(self.rows("SELECT attempted FROM state")[0]["attempted"], 10)

    def test_html_report_contains_decisions_model_calls_and_memory(self):
        core.run(self.db, self.ai, 10)
        destination = Path(self.temp.name) / "audit.html"
        core.write_report(self.db, str(destination))
        html = destination.read_text()
        self.assertIn("Decision #1", html)
        self.assertIn("After decision #10", html)
        self.assertIn("Exact API request", html)
        self.assertIn("Memory-consolidation model calls", html)
        self.assertIn("Oracle", html)
        self.assertIn("&quot;", html)

    def test_offline_demo_exercises_all_four_choices_and_creates_artifacts(self):
        results = core.run(self.db, self.ai, 4)
        self.assertEqual([r["selected"] for r in results], list(core.ACTIONS))
        self.assertTrue(all(r["status"] == "completed" for r in results))
        self.assertEqual([r["kind"] for r in self.rows(
            "SELECT kind FROM artifacts ORDER BY id")], ["journal", "drawing", "oracle"])
        drawing = self.rows("SELECT content FROM artifacts WHERE kind='drawing'")[0]
        self.assertIn("<svg", json.loads(drawing["content"])["svg"])

    def test_every_model_request_and_response_is_inspectable(self):
        core.run(self.db, self.ai, 3)
        rows = self.rows("SELECT purpose,request_json,response_json,error FROM model_calls")
        self.assertGreater(len(rows), 3)
        for r in rows:
            self.assertIsInstance(json.loads(r["request_json"]), dict)
            self.assertIsInstance(json.loads(r["response_json"]), dict)
            self.assertIsNone(r["error"])
            self.assertNotIn("Authorization", r["request_json"])
        details = core.inspect(self.db, 1)
        self.assertEqual(details["decision"]["id"], 1)
        self.assertGreaterEqual(len(details["model_calls"]), 1)
        self.assertEqual(len(details["experience"]), 1)

    def test_fallback_memory_when_reflection_fails(self):
        class BrokenReflection(core.MockAI):
            def call(self, endpoint, payload):
                if endpoint == "responses" and '"consolidate"' in payload["input"][1]["content"]:
                    raise RuntimeError("Intentional reflection failure")
                return super().call(endpoint, payload)
        core.run(self.db, BrokenReflection(), 10)
        record = self.rows("SELECT * FROM memories")[0]
        self.assertEqual(record["status"], "fallback")
        self.assertIsNone(record["reflection"])
        self.assertIn("Decisions 1-10", record["objective_summary"])
        error = self.rows("SELECT error FROM model_calls WHERE purpose='consolidate'")[0]["error"]
        self.assertIn("Intentional reflection failure", error)

    def test_invalid_evidence_never_enters_fallback_memory(self):
        class UnsupportedReflection(core.MockAI):
            def call(self, endpoint, payload):
                if endpoint == "responses" and '"consolidate"' in payload["input"][1]["content"]:
                    return {"output": [{"content": [{"type": "output_text", "text": json.dumps({
                        "reflection": "I am unquestionably a master artist.",
                        "identity_note": "I have always been a master artist.",
                        "evidence_decision_ids": [999999]
                    })}]}], "usage": {}}
                return super().call(endpoint, payload)
        core.run(self.db, UnsupportedReflection(), 10)
        memory = self.rows("SELECT * FROM memories")[0]
        self.assertEqual(memory["status"], "fallback")
        self.assertIsNone(memory["reflection"])
        self.assertIsNone(memory["tentative_identity_note"])
        later = core.recent_context(self.db)["recent_memories"][0]
        self.assertIsNone(later["reflection"])
        self.assertIsNone(later["tentative_identity_note"])

    def test_oracle_max_three_per_utc_day(self):
        # Force the selector to choose Oracle whenever offered.
        class OracleFirst(core.MockAI):
            def call(self, endpoint, payload):
                if endpoint == "decisions":
                    opts = [x["value"] for x in payload["questions"][0]["choices"]]
                    selected = "ask_oracle" if "ask_oracle" in opts else "think"
                    return {"answers": [{"name": "next_action", "type": "choice", "choice": selected}],
                            "usage": {}}
                return super().call(endpoint, payload)
        results = core.run(self.db, OracleFirst(), 6)
        self.assertEqual([r["selected"] for r in results[:3]], ["ask_oracle"] * 3)
        self.assertEqual([r["status"] for r in results[:3]], ["completed"] * 3)
        self.assertNotIn("ask_oracle", [r["selected"] for r in results[3:]])
        self.assertEqual(len(self.rows("SELECT * FROM artifacts WHERE kind='oracle'")), 3)

    def test_invalid_artwork_does_not_create_artifact_and_is_audited(self):
        class InvalidDrawing(core.MockAI):
            def call(self, endpoint, payload):
                if endpoint == "decisions":
                    return {"answers": [{"name": "next_action", "type": "choice", "choice": "draw"}], "usage": {}}
                if endpoint == "responses" and '"draw"' in payload["input"][1]["content"]:
                    return {"output": [{"content": [{"type": "output_text", "text": json.dumps({
                        "title": "Invalid", "intention": "Test invalid coordinates",
                        "strokes": [{"points": [[0, 0], [999, 0]], "color": "#123456", "width": 2}]
                    })}]}], "usage": {}}
                return super().call(endpoint, payload)
        result = core.run_one(self.db, InvalidDrawing())
        self.assertEqual(result["status"], "failed")
        self.assertIn("coordinates", result["outcome"])
        self.assertFalse(self.rows("SELECT * FROM artifacts"))
        self.assertEqual(len(self.rows("SELECT * FROM experiences")), 1)

    def test_10_step_hard_cap_and_second_memory(self):
        with self.assertRaises(ValueError):
            core.run(self.db, self.ai, 11)
        core.run(self.db, self.ai, 10)
        core.run(self.db, self.ai, 10)
        self.assertEqual([r["cycle_end_decision"] for r in self.rows(
            "SELECT cycle_end_decision FROM memories ORDER BY id")], [10, 20])
        self.assertEqual(len(self.rows("SELECT * FROM experiences")), 20)

    def test_renderer_only_accepts_bounded_vector_strokes(self):
        strokes = [{"points": [[0, 0], [240, 180]], "color": "#123ABC", "width": 2}]
        self.assertEqual(core.valid_strokes(strokes), strokes)
        picture = core.svg(strokes)
        self.assertIn("<polyline", picture)
        with self.assertRaises(ValueError):
            core.valid_strokes([{"points": [[0, 0], [241, 180]], "color": "#123ABC", "width": 2}])

    def test_selection_excludes_oracle_after_quota(self):
        class Oracle(core.MockAI):
            def call(self, endpoint, payload):
                if endpoint == "decisions":
                    choices = [x["value"] for x in payload["questions"][0]["choices"]]
                    return {"answers": [{"name": "next_action", "type": "choice",
                                         "choice": "ask_oracle" if "ask_oracle" in choices else "think"}]}
                return super().call(endpoint, payload)
        core.run(self.db, Oracle(), 4)
        fourth = self.rows("SELECT offered_json FROM decisions WHERE id=4")[0]
        self.assertNotIn("ask_oracle", json.loads(fourth["offered_json"]))


if __name__ == "__main__":
    unittest.main()
