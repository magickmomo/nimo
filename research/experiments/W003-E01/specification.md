# W003-E01 — Voluntary structured thinking

**State:** implemented and screened after owner approval on 27 November 2026. [Verification](verification.md) · [results](results.md). E00 remains the accepted comparison baseline. E01 awaits acceptance.

Sources: [E00 interpretation](../W003-E00/analysis.md), [corrected results](../W003-E00/corrected-results.md), [snapshot restore procedure](../W003-E00/restore.md), [E012 reference](https://github.com/magickmomo/nimo/blob/feac030561151122a55c01d4eaa28293825984d7/nimo-core/nimo_core.py).

## Question and hypothesis

When Nimo independently chooses THINK, does a short assessment with an optional next step and explicit evidence help a later action follow through, revise course, or make progress? E00 completed 50 decisions and returned an unchanged result on all 46 inspections of `plot_003`. It selected THINK once. The inspection loop motivates this test. The baseline leaves its cause open.

## Single experimental change

Replace the free-text argument of voluntary THINK with the fields below, and carry the latest eligible structured thought into the existing `latestThinking` slot. Use the same primary decision call, action selection, availability, and intent disposition.

| Field | Contract |
|---|---|
| `purpose` | One of `planning`, `evaluation`, `problem_solving`, `curiosity`, or `reflection`. |
| `assessment` | Required, 1–500 characters after trimming. Summarize what is known, what remains uncertain, or what changed. |
| `nextStep` | A suggestion of 1–200 characters, or `null`. It creates no commitment and needs no execution. |
| `evidenceEventIds` | Up to four distinct positive integer IDs drawn from eligible outcome events in the exact request's existing recent-experience window. An empty list is valid. |
| `intentDisposition` | Existing field and existing semantics. THINK gains no new goal-setting or intention update behavior. |

E012 cites recent decision IDs. W003 already carries recent event IDs, so the W003 version uses those IDs as anchors. Eligibility uses the worker's existing verified-outcome predicate. Thoughts, visitor content, retrieval echoes, and IDs outside that request are ineligible. Validate against the exact allowlist captured when the request is assembled, and route malformed arguments through the existing model-error path without writing a partial thought or calling the model again. Valid ID membership proves provenance. The relevance of a cited outcome to its assessment remains an analysis question.

Persist the four structured fields with the existing THINK event ID and preserve the journal's plain-text contract by storing the assessment as the event text. Write the event and its structured record atomically. Keep the current bounded newest-event selection for THINK and WRITE_JOURNAL. If the selected event has a structured record, expose its ID and the four fields, with one record at most. Otherwise use the current legacy text projection. A later eligible journal entry can supersede a THINK in context under the existing selection rule. Historical events stay in their original format. The next step is advisory context, and each later tool call is selected and validated independently.

## Controlled settings

| Control | Required setting |
|---|---|
| Code baseline | Branch E01 implementation from accepted E00 runner `421b75a5c667714b8d9e73aadbdd37705d4aa85f`. Record exact candidate revision. |
| Snapshot | Restore the E00 encrypted archive, artifact `15185948092`. Verify plaintext SQL SHA-256 `b56294f210b641769dfcb8c872216efda3c9e4080fff354ff0cc9a4ee4abcdc9`. |
| Clock and start | Reuse the E00 capture manifest and `stored-needs-and-active-timers-v1`. Check initial tick 5,797, position (15, 12), 65.158% stored fullness, first-decision fullness 65%, curiosity 100%, one held fruit, 72 memories, and no active intention. Record any execution-calendar difference. |
| Models and limits | Same `gpt-6-luna` decision model, E00 request settings and output cap, and `gpt-4.1-mini` consolidation settings. One primary call per decision. Background Oracle research inactive. |
| Other mechanisms | Preserve physical rules, need decay, tools, invitations, goal and progress handling, rewards and priority, memory eligibility and ranking, historical search, and consolidation triggers and schemas. The existing consumers of journal text still see an assessment as THINK text. |
| Run budget | Offline verification first. If separately authorized, one candidate screening run capped at 50 primary decisions, cooldowns disabled, compared to the recorded E00 results. No automatic retries or second paid run. |

Keep THINK voluntary. Keep inspection availability, domain rules, and action scheduling the same. E02 intention and progress changes are outside this specification. Use isolated copies and keep production and main outside the experiment.

## Offline gate

1. **Schema and provenance.** Test all purposes, valid null and empty fields, max lengths, invalid and duplicate IDs, unverified events, and an ID present in storage but absent from the submitted request. Confirm valid IDs still validate if the history changes after request assembly.
2. **Persistence and continuity.** Use a mocked THINK followed by a normal tool decision. Confirm atomic event and structured record writes, deterministic execution, round-trip through a restarted worker, correct newest-event selection, fallback for legacy THINK and WRITE_JOURNAL, and bounded single-thought exposure in the next eligible payload.
3. **Unrelated behavior.** Capture matched E00 and candidate payloads at the first decision and after matched scripted inputs. Compare available tools, non-THINK schemas, context fields, models, ordering and execution. Explain differences limited to the THINK contract, its brief instructions, and downstream representations of the chosen thought. Verify a next step neither auto-executes an action nor bypasses availability. Verify no added calls and no forced THINK.
4. **Baseline and privacy.** Restore twice from the exact encrypted SQL and confirm starting invariants. Intercept exact requests without network access, profile identical scenarios with and without a structured thought, and record serialized size separately from API tokens. Confirm public artifacts contain only redacted metadata and private context is encrypted. Run worker type checks and the full regression suite before seeking the paid-run decision.

## Analysis and decision rules

Use the [accepted E00 workflow](https://github.com/magickmomo/nimo/actions/runs/45973447418) as the reference. Predeclare and report the following for both runs wherever the baseline trace supports it.

| Measure | Scoring |
|---|---|
| Unchanged repetition | Count unchanged inspections, repeated unchanged inspections of the same target, longest consecutive unchanged inspection streak on one target, and distinct inspected targets. E00 total is 46 unchanged inspections of one plot. |
| Voluntary THINK and follow-through | Count selected and persisted THINKs, valid citations, and later request exposure by thought ID. For each exposed non-null next step, examine the next three eligible decisions or stop at the next THINK or end of the run. Classify the sequence as follows through, revises with new evidence, diverges, or indeterminate. Mark truncated windows. |
| Meaningful progress | Cite actual events that yield new information, achieve a stated step, or make a useful state change. Assess repeated actions by outcomes. A different action or an unchanged inspection alone is insufficient. |
| Recall-to-action evidence | Link evidence event, recalled memory or thought ID, subsequent action, and verified outcome. Report explicit use separately from consistency and mere exposure. Leave the relationship unresolved where the trace is ambiguous. |
| Cost | Report primary and auxiliary calls and input, cached, output, reasoning where available, and total tokens. Compare combined tokens per completed decision with E00's 5,101.96. E00 used 255,098 tokens including eight consolidation calls. |

Publish only redacted IDs, categories, counts and usage. Verify thought content and evidence links from an encrypted transcript. Report direct observations, plausible interpretations, and limits separately.

A valid thought visible in a later request establishes that the intervention was exercised. An observable follow-through or well-supported revision with a useful verified outcome is evidence for the hypothesis, particularly if unchanged repetition also falls. If no THINK is selected, mark E01 unexercised. If THINK is selected too late for follow-through or the sequence is ambiguous, mark the behavioral result inconclusive. Persistence of repetition is a documented result, with one stochastic run insufficient to decide acceptance by itself. Owner review determines acceptance, refinement or rejection after the results are available.
