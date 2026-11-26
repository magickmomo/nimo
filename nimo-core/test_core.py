"""Run with: cd nimo-core && python -m unittest -v"""
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from contextlib import redirect_stdout
from unittest.mock import patch

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

    def test_library_browse_acquire_read_resume_with_verbatim_passage(self):
        steps = ["browse_library", "acquire_book", "read_book",
                 "put_down_book", "read_book"]
        class ReadingAI(core.MockAI):
            def call(self, endpoint, payload):
                if endpoint == "decisions":
                    action = steps.pop(0)
                    choices = [c["value"] for c in payload["questions"][0]["choices"]]
                    assert action in choices, (action, choices)
                    return {"answers":[{"name":"next_action","type":"choice","choice":action}],
                            "usage":{}}
                data = json.loads(payload["input"][1]["content"])
                if data["purpose"] == "library_acquire":
                    value = {"book_id":"programming"}
                elif data["purpose"] == "library_read":
                    value = {"book_id":"programming","move":"next"}
                else:
                    return super().call(endpoint, payload)
                return {"output":[{"content":[{"type":"output_text","text":json.dumps(value)}]}],
                        "usage":{}}
        body = ("Programming is a way to describe algorithms. " * 260 + "\\n\\n" +
                "A variable stores a value for a program. " * 230)
        real_acquire = core.library.acquire
        def offline_acquire(db, decision_id, book_id, timestamp=""):
            return real_acquire(db,decision_id,book_id,
                                fetch=lambda url: body, timestamp=timestamp)
        with patch.object(core.library, "acquire", side_effect=offline_acquire):
            result = core.run(self.db, ReadingAI(), 5)
        self.assertEqual([r["selected"] for r in result],
                         ["browse_library","acquire_book","read_book",
                          "put_down_book","read_book"])
        self.assertTrue(all(r["status"] == "completed" for r in result), result)
        initial = json.loads(self.rows(
            "SELECT context_json FROM decisions WHERE id=1")[0]["context_json"])
        self.assertNotIn("library_catalogue", initial)
        browsed = json.loads(self.rows(
            "SELECT context_json FROM decisions WHERE id=2")[0]["context_json"])
        self.assertEqual(len(browsed["library_catalogue"]), 4)
        first_read = json.loads(self.rows(
            "SELECT context_json FROM decisions WHERE id=4")[0]["context_json"])
        self.assertEqual(first_read["last_read_passage"]["segment"], 1)
        self.assertIn("Programming is a way", first_read["last_read_passage"]["text"])
        after_pause = json.loads(self.rows(
            "SELECT context_json FROM decisions WHERE id=5")[0]["context_json"])
        self.assertNotIn("last_read_passage", after_pause)
        self.assertEqual(self.rows(
            "SELECT next_segment FROM library_reading WHERE book_id='programming'")[0][0], 3)
        events = self.rows("SELECT action,data_json FROM library_events ORDER BY decision_id")
        self.assertEqual([e["action"] for e in events],
                         ["browse_library","acquire_book","read_book",
                          "put_down_book","read_book"])
        self.assertEqual(core.recent_context(self.db)["last_read_passage"]["segment"], 2)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM artifacts")[0][0], 0)

    def test_gutenberg_acquisition_is_agent_initiated_and_uses_approved_mirror(self):
        attempted = []
        sample = ("*** START OF THE PROJECT GUTENBERG EBOOK THE TIME MACHINE ***\\n" +
                  "CHAPTER I\\n" + "This is a genuine test passage. " * 120 +
                  "\\n*** END OF THE PROJECT GUTENBERG EBOOK THE TIME MACHINE ***")
        def only_mirror(url):
            attempted.append(url)
            return sample
        self.assertFalse(self.rows("SELECT * FROM library_books"))
        core.library.browse(self.db, 1)
        self.assertEqual(attempted, [])
        core.library.acquire(self.db, 2, "time_machine", fetch=only_mirror)
        self.assertEqual(len(attempted), 1)
        self.assertEqual(attempted[0],
                         "https://gutenberg.pglaf.org/cache/epub/35/pg35.txt")
        event = json.loads(self.rows("SELECT data_json FROM library_events WHERE decision_id=2")[0][0])
        self.assertEqual(event["downloaded_from"], attempted)
        self.assertEqual(len(self.rows("SELECT * FROM library_books")), 1)

    def test_gutenberg_mirror_fallback_does_not_commit_failed_download(self):
        attempted = []
        sample = ("*** START OF THE PROJECT GUTENBERG EBOOK THE TIME MACHINE ***\\n" +
                  "CHAPTER I\\n" + "This is a genuine test passage. " * 120 +
                  "\\n*** END OF THE PROJECT GUTENBERG EBOOK THE TIME MACHINE ***")
        def transient_primary_error(url):
            attempted.append(url)
            if "gutenberg.pglaf.org" in url:
                raise core.library.urllib.error.HTTPError(url,503,"Service Unavailable",{},None)
            return sample
        core.library.acquire(self.db, 1, "time_machine", fetch=transient_primary_error)
        self.assertEqual(len(attempted), 2)
        self.assertIn("mirror.cs.odu.edu", attempted[1])
        event = json.loads(self.rows("SELECT data_json FROM library_events")[0][0])
        self.assertEqual(event["downloaded_from"], attempted[1:])
        self.assertEqual(len(self.rows("SELECT library_books.id FROM library_books")), 1)

    def test_all_mirrors_failed_leaves_no_owned_book(self):
        def unavailable(url):
            raise core.library.urllib.error.HTTPError(url,503,"Service Unavailable",{},None)
        with self.assertRaisesRegex(RuntimeError, "every approved source"):
            core.library.acquire(self.db, 1, "beagle", fetch=unavailable)
        self.assertEqual(len(self.rows("SELECT * FROM library_books")), 0)
        self.assertEqual(len(self.rows("SELECT * FROM library_events")), 0)

    def test_gutenberg_book_content_starts_after_distribution_notice(self):
        sample = ("Intro distribution notice\n" +
                  "*** START OF THE PROJECT GUTENBERG EBOOK A BOOK ***\n" +
                  "CHAPTER ONE\n\nThe narrative begins here.\n" +
                  "*** END OF THE PROJECT GUTENBERG EBOOK A BOOK ***\n" +
                  "End distribution notice")
        result = core.library.strip_gutenberg_notice(sample)
        self.assertTrue(result.startswith("CHAPTER ONE"))
        self.assertNotIn("distribution notice", result)
        self.assertEqual(core.library.strip_gutenberg_notice("plain text"), "plain text")

    def test_library_preserves_programming_example_formatting(self):
        source = "Example:\\n\\n    def greet(name):\\n        if name:\\n            print(name)\\n"
        segments = core.library.split_text(source)
        self.assertEqual(segments, [source])
        long_source = ("    def greet(name):\\n        if name:\\n            print(name)\\n\\n" * 450)
        parts = core.library.split_text(long_source)
        self.assertGreater(len(parts), 1)
        self.assertTrue(all("def greet(name):" in part for part in parts))

    def test_backward_navigation_updates_next_segment(self):
        text = "This sentence describes some test words. " * 900
        core.library.acquire(self.db, 1, "time_machine", fetch=lambda url: text)
        self.assertGreaterEqual(self.db.execute(
            "SELECT COUNT(*) FROM library_segments").fetchone()[0], 3)
        for decision, move in enumerate(("next","next","next","previous","next"),start=2):
            core.library.read(self.db, decision, "time_machine", move)
        events = [json.loads(r["data_json"])["segment"] for r in self.db.execute(
            "SELECT data_json FROM library_events WHERE action='read_book' ORDER BY decision_id")]
        self.assertEqual(events, [1,2,3,2,3])

    def test_library_read_cannot_fetch_unacquired_book(self):
        with self.assertRaisesRegex(ValueError,"not been acquired"):
            core.library.read(self.db, 1, "time_machine", "next")
        self.assertEqual(len(core.library.catalogue()), 4)

    def test_live_transport_streams_call_progress_without_changing_audit(self):
        class SimulatedLive(core.OpenAI):
            def __init__(self):
                self.model = "offline-simulated-live"
                self.mock = core.MockAI()

            def call(self, endpoint, payload):
                return self.mock.call(endpoint, payload)

        output = io.StringIO()
        with redirect_stdout(output):
            result = core.run_one(self.db, SimulatedLive())
        self.assertEqual(result["status"], "completed")
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([event["event"] for event in events],
                         ["model_call_started", "model_call_completed"] * 3)
        self.assertEqual([event["purpose"] for event in events[::2]],
                         ["express_want", "select", "think"])
        self.assertEqual(events[1]["preview"],
                         "I would like to explore something I have noticed.")
        self.assertEqual(events[3]["preview"], "think")
        self.assertEqual(len(self.rows("SELECT * FROM model_calls")), 3)

    def test_thinking_is_structured_and_reaches_future_context(self):
        first = core.run_one(self.db, self.ai)
        self.assertEqual(first["selected"], "think")
        self.assertEqual(first["status"], "completed")
        row = self.rows("SELECT * FROM think_notes WHERE decision_id=1")[0]
        self.assertEqual(row["purpose"], "curiosity")
        self.assertEqual(row["assessment"], "I have not tested this idea yet.")
        self.assertEqual(row["next_step"], "Explore a small creative idea.")
        self.assertEqual(json.loads(row["evidence_decision_ids_json"]), [])
        self.assertEqual(core.recent_context(self.db)["latest_thinking"]["decision_id"], 1)
        self.assertEqual(core.recent_context(self.db)["latest_thinking"]["next_step"],
                         "Explore a small creative idea.")
        self.assertEqual(self.db.execute("SELECT current_intention FROM state").fetchone()[0],
                         "Explore a small creative idea.")
        next_context = core.recent_context(self.db)
        self.assertIn("latest_thinking", next_context)
        core.run_one(self.db, self.ai)
        saved = json.loads(self.rows("SELECT context_json FROM decisions WHERE id=2")[0][0])
        self.assertEqual(saved["latest_thinking"]["purpose"], "curiosity")

    def test_thinking_can_be_open_reflection_without_plan_or_new_intention(self):
        class ReflectAI(core.MockAI):
            def call(self, endpoint, payload):
                if endpoint != "decisions":
                    data = json.loads(payload["input"][1]["content"])
                    if data["purpose"] == "think":
                        value = {"purpose": "reflection",
                                 "assessment": "I enjoy considering the cup without a conclusion.",
                                 "next_step": None, "intention": None,
                                 "evidence_decision_ids": []}
                        return {"output":[{"content":[{"type":"output_text",
                                  "text":json.dumps(value)}]}], "usage":{}}
                return super().call(endpoint, payload)
        core.run_one(self.db, ReflectAI())
        self.assertIsNone(self.db.execute("SELECT current_intention FROM state").fetchone()[0])
        self.assertIsNone(self.db.execute("SELECT next_step FROM think_notes").fetchone()[0])
        self.assertIn("Thought (reflection)", self.rows(
            "SELECT outcome FROM experiences WHERE decision_id=1")[0][0])

    def test_thinking_rejects_unverified_evidence_without_state_change(self):
        class BadEvidenceAI(core.MockAI):
            def call(self, endpoint, payload):
                if endpoint != "decisions":
                    data = json.loads(payload["input"][1]["content"])
                    if data["purpose"] == "think":
                        value = {"purpose": "evaluation", "assessment": "Something happened.",
                                 "next_step": "Test it", "intention": "A new intention",
                                 "evidence_decision_ids": [999]}
                        return {"output":[{"content":[{"type":"output_text",
                                  "text":json.dumps(value)}]}], "usage":{}}
                return super().call(endpoint, payload)
        result = core.run_one(self.db, BadEvidenceAI())
        self.assertEqual(result["status"], "failed")
        self.assertIn("evidence", result["outcome"])
        self.assertEqual(len(self.rows("SELECT * FROM think_notes")), 0)
        self.assertIsNone(self.db.execute("SELECT current_intention FROM state").fetchone()[0])

    def test_capability_awareness_and_progress_selection(self):
        self.assertIn("ask the Oracle questions", core.DEFAULT_IDENTITY)
        self.assertIn("cannot physically inspect", core.DEFAULT_IDENTITY)
        initial = core.recent_context(self.db)
        self.assertEqual(initial["identity"], core.DEFAULT_IDENTITY)
        result = core.run_one(self.db, self.ai)
        self.assertEqual(result["status"], "completed")
        calls = self.rows("SELECT purpose,request_json FROM model_calls WHERE decision_id=1 ORDER BY id")
        self.assertEqual([r["purpose"] for r in calls], ["express_want", "select", "think"])
        want = json.loads(calls[0]["request_json"])
        want_context = json.loads(want["input"][1]["content"])["context"]
        self.assertEqual(want_context["identity"], core.DEFAULT_IDENTITY)
        self.assertIn("oracle_questions_remaining_today", want_context)
        selected = json.loads(calls[1]["request_json"])
        selector_context = selected["input"][1]["content"][0]["data"]
        self.assertEqual(selector_context["expressed_want"], result["expressed_want"])
        self.assertEqual([c["value"] for c in selected["questions"][0]["choices"]], list(core.ACTIONS) + ["browse_library"])
        self.assertEqual(selected["questions"][0]["instructions"],
                         "Which available action would make the most meaningful progress toward Nimo's expressed intention?")
        oracle = next(c for c in selected["questions"][0]["choices"] if c["value"] == "ask_oracle")
        self.assertIn("text answer", oracle["description"])
        self.assertIn("cannot physically inspect", oracle["description"])
        self.assertIn("three questions per UTC day", oracle["description"])

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
        self.assertEqual(json.loads(record["offered_json"]), list(core.ACTIONS) + ["browse_library"])
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

    def test_new_object_appears_only_after_tenth_decision_when_enabled(self):
        core.run(self.db, self.ai, 10, new_object_after_10=True)
        before = json.loads(self.rows(
            "SELECT context_json FROM decisions WHERE id=10")[0]["context_json"])
        self.assertEqual(before["known_objects"], list(core.KNOWN_OBJECTS))
        core.run(self.db, self.ai, 1, new_object_after_10=True)
        after = json.loads(self.rows(
            "SELECT context_json FROM decisions WHERE id=11")[0]["context_json"])
        self.assertEqual(after["known_objects"], [*core.KNOWN_OBJECTS, core.NEW_OBJECT])
        requests = self.rows(
            "SELECT purpose,request_json FROM model_calls WHERE decision_id=11 ORDER BY id")
        express = json.loads(requests[0]["request_json"])
        self.assertEqual(json.loads(express["input"][1]["content"])["context"]["known_objects"],
                         after["known_objects"])
        selector = json.loads(requests[1]["request_json"])
        self.assertEqual(selector["input"][1]["content"][0]["data"]["known_objects"],
                         after["known_objects"])
        self.assertEqual(len(self.rows("SELECT * FROM memories")), 1)

    def test_control_at_decision_eleven_sees_same_three_objects(self):
        core.run(self.db, self.ai, 10)
        core.run(self.db, self.ai, 1)
        context = json.loads(self.rows(
            "SELECT context_json FROM decisions WHERE id=11")[0]["context_json"])
        self.assertEqual(context["known_objects"], list(core.KNOWN_OBJECTS))
        self.assertNotIn("music_box_001", json.dumps(context))

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
                         list(core.ACTIONS) + ["browse_library"])

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

    def test_memory_references_match_persisted_artifacts_without_content(self):
        core.run(self.db, self.ai, 10)
        memory = self.rows("SELECT artifact_refs_json FROM memories WHERE cycle_end_decision=10")[0]
        refs = json.loads(memory["artifact_refs_json"])
        actual = [dict(row) for row in self.rows(
            "SELECT id,decision_id,kind,title FROM artifacts ORDER BY decision_id,id")]
        self.assertEqual(refs, actual)
        self.assertGreater(len(refs), 0)
        self.assertTrue(all(set(ref) == {"id", "decision_id", "kind", "title"} for ref in refs))
        context = core.recent_context(self.db)
        self.assertEqual(context["recent_memories"][0]["artifacts"], actual)
        self.assertNotIn("content", json.dumps(context))
        self.assertNotIn("svg", json.dumps(context))
        self.assertEqual(len(self.rows("SELECT * FROM memories")), 1)

    def test_reference_is_kept_when_reflection_fails(self):
        class NoReflection(core.MockAI):
            def call(self, endpoint, payload):
                if endpoint == "responses" and '"consolidate"' in payload["input"][1]["content"]:
                    raise RuntimeError("Reflection unavailable")
                return super().call(endpoint, payload)
        core.run(self.db, NoReflection(), 10)
        memory = self.rows("SELECT status,artifact_refs_json FROM memories")[0]
        self.assertEqual(memory["status"], "fallback")
        self.assertEqual(json.loads(memory["artifact_refs_json"]),
                         [dict(r) for r in self.rows(
                             "SELECT id,decision_id,kind,title FROM artifacts ORDER BY decision_id,id")])

    def test_existing_database_migrates_without_rewriting_old_memories(self):
        path = str(Path(self.temp.name) / "previous.db")
        old = sqlite3.connect(path)
        old.execute("""CREATE TABLE memories (
            id INTEGER PRIMARY KEY, cycle_end_decision INTEGER UNIQUE NOT NULL,
            created_at TEXT NOT NULL, objective_summary TEXT NOT NULL,
            reflection TEXT, tentative_identity_note TEXT,
            evidence_decision_ids_json TEXT NOT NULL, status TEXT NOT NULL)""")
        old.execute("""INSERT INTO memories
            (cycle_end_decision,created_at,objective_summary,evidence_decision_ids_json,status)
            VALUES (10,'yesterday','existing memory','[1,2,3,4,5,6,7,8,9,10]','reflected')""")
        old.commit()
        old.close()
        migrated = core.open_db(path)
        try:
            row = migrated.execute("SELECT objective_summary,artifact_refs_json FROM memories").fetchone()
            self.assertEqual(row["objective_summary"], "existing memory")
            self.assertEqual(json.loads(row["artifact_refs_json"]), [])
            self.assertEqual(core.recent_context(migrated)["recent_memories"][0]["artifacts"], [])
        finally:
            migrated.close()

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
        self.assertIn("Verified artifact references (metadata only)", html)
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
