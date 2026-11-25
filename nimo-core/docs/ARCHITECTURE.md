# Nimo Core — architecture contract (v0.1)

**Status:** isolated prototype, **not deployed**, no scheduler, no connection to World 004 production data.  
**Implementation:** [nimo_core.py](../nimo_core.py) · **Tests:** [test_core.py](../test_core.py)  
**This document is the specification against which changes should be reviewed.**

## 1. Purpose, and what we learned

Nimo Core tests one proposition:

> Can a persistent agent choose among a small number of creative opportunities, produce verified outcomes, reflect on ten consecutive decisions, and carry something meaningful from that experience into later decisions — while we can inspect every influence?

World 004 taught us that (a) providing a menu of nearby tools narrows what the agent does; (b) frequent independent selections can destroy continuity; (c) repeated drawings can reinforce their own themes via recent examples; (d) direct deterministic execution is cheaper for actions requiring no creative output; and (e) passing the entire world history into each model call makes costs grow quickly. This prototype **does not claim to solve** open-ended autonomy or emergent personality. It is an experiment to establish an understandable baseline.

## 2. Non-goals

No virtual body, hunger, curiosity meter, location, shop, coins, garden, background timer, GitHub access, marketplace, passive monetization, cross-world sync, hidden scoring, automatic cooldowns, or separate activity-selection heuristics. These features are **not** silently reintroduced elsewhere.

No model call runs until someone executes an explicit CLI command. The default environment remains unchanged. All state is held in a separate SQLite file. A live API call requires an explicit \`--live\` flag and \`OPENAI_API_KEY\`.

## 3. Four decisions, one purpose each

| Choice | Generated content | Verified product | Constraints |
|---|---|---|---|
| \`think\` | thought and optional intention | reflection in the experience log; intention updated if supplied | max 500 characters thought |
| \`write_journal\` | title and entry | immutable journal artifact | max 1200 characters |
| \`draw\` | title, intention, 1–8 vector strokes | one completed SVG drawing artifact | 240×180 canvas; validators reject invalid strokes |
| \`ask_oracle\` | question, then response | question/answer artifact | three successful or in-progress consultations per UTC day |

Nimo is shown only these high-level creative opportunities. He is **not** given a menu of arbitrary drawing titles, potential subjects, individual strokes, travel destinations, or destinations. Choosing an action is separate from generating its content. The initial prototype does not offer explicit “do nothing” because \`think\` covers taking time for reflection without producing an artifact.

**Drawing implementation:** uses the same *vector-stroke contract* as the World 004 sketchbook (integer points, hex color, width, 240×180 canvas). It does **not** import World 004’s D1-connected sketchbook service; the Core renderer creates a self-contained SVG. This is intentional isolation, not yet reuse of the live drawing storage. One high-level \`draw\` selection yields one completed SVG, not a cascade of stroke-selection decisions.

**Oracle implementation:** in Core v0.1, the question and answer are two Responses calls, recorded separately. It is **not** the existing World 004 research worker, has no external source retrieval or citations, and should not be presented as independently verified research. If we later want the existing Oracle, we must build and test a narrow interface; do not silently import its database or controls. The three-per-day limit is per **UTC calendar day**.

## 4. Decision sequence (one attempted decision)

1. Read identity, intention, last four **verified** experiences, last three consolidated memories, and remaining Oracle quota.
2. Save exactly that context in \`decisions.context_json\`, and save the four (or three) offered options in \`offered_json\`.
3. Call the Decisions API with a single-choice question. Persist the exact request, raw response, usage and any error in \`model_calls\`. The selector picks **only an action name**.
4. If selection is valid, record the name. Call Responses **only** to generate the chosen tool’s content (one additional Responses call for an Oracle answer). Each call is audited separately.
5. Validate generated content. Invalid content is **not** silently repaired. Render or save the verified result and write the corresponding artifact, if any.
6. Mark the decision completed/failed; always write exactly one experience, including selection failures.
7. Increment the attempted-decision counter exactly once.
8. After the 10th, 20th, 30th, ... attempt, run consolidation. Never run it in the middle of a decision.

Every step is persisted. A failure is a real experience, not an invented successful action. We count **attempts** for the ten-decision cadence so that a failure cannot indefinitely prevent memory creation.

### Model-call boundary

\`choose\` owns the Decisions API; \`generate\` owns Responses. \`execute\` cannot change which action was selected. \`valid_strokes\` and \`text_field\` are deterministic validators. Neither validator asks an AI what to do. They reject out-of-contract outputs.

No separate model is allowed to reinterpret the result after execution. The activity/experience log is authoritative about outcomes.

## 5. Exactly one memory every ten attempts

There are two parts to a cycle memory.

**A. Mandatory objective summary (deterministic):** counts attempted actions and successes/failures for decisions N−9 through N. This is committed even if the reflection model is unavailable, times out, or produces invalid evidence.

**B. Optional interpretation (model-assisted):** a short reflection and a tentative self-understanding note. The reflection sees **only** those ten experiences, previous recent memories, and exact evidence IDs. It may propose insights but must cite decision IDs from that batch. An invalid reflection produces status \`fallback\`. No fabricated reflective claim fills the gap.

The one memory record has \`status=reflected\` or \`status=fallback\`; both satisfy “create one memory every ten decisions regardless.” A fallback can later be investigated without losing the fact that the cycle happened.

A personality claim isn't automatically proven by repeated selections. **The identity seed remains stable.** Tentative identity notes live in memory, with evidence IDs, not overwritten into an immutable identity. The next decision can see them as tentative prior interpretations. Promoting an interpretation to a stronger identity statement requires a *separate, explicit future design change*. This avoids hidden self-reinforcing personality updates in v0.1.

## 6. Context budget and possible feedback loops

Every selection receives: identity, optional intention, **four** recent experiences, **three** recent cycle memories, quota, and available choices. The full lifetime history lives in SQLite, but is not sent to every model call.

When creating drawing content, the generator also receives the same compact context; it does **not** receive the last twelve drawing titles by default. This helps us observe whether repeating a subject occurs without a long artwork-example chain. We have not applied any hidden anti-repetition heuristic. The agent is free to draw similar art again.

Consolidation is bounded to **ten** experience rows, plus three earlier memory records. It does not read an infinite transcript.

These are explicit choices to test. If Nimo repeats an action, the record will show the options and exact context he saw; that is not the same as being able to prove the model's internal reasoning.

## 7. Database schema — where everything lives

| Table | Contents | Mutated by |
|---|---|---|
| \`state\` | factual identity seed; optional ongoing intention; attempted count | first initialization; \`think\`; completion |
| \`decisions\` | context snapshot, offered actions, selected action, status, outcome | decision runner |
| \`model_calls\` | **exact** model request JSON, raw response JSON, token usage, errors | API transport wrapper |
| \`artifacts\` | journal, drawing JSON+SVG, Oracle Q&A | validated action executor |
| \`experiences\` | one verified outcome or failure per attempt | decision runner |
| \`memories\` | cycle boundary, deterministic summary, optional reflection, evidence IDs, status | consolidator |

SQLite tables are never shared with World 004. No background jobs mutate them. No model credentials, Authorization headers or secrets are stored in audits. **Model output itself is untrusted** and must be treated as data in any future UI.

Artifact IDs are references, not personality claims. A memory record is append-only. Model call and decision records remain inspectable after memory consolidation.

## 8. Failure behaviour

| Failure | Result |
|---|---|
| Decisions API returns unknown choice | failed decision and experience; no tool execution |
| Responses returns malformed or incompatible JSON | failed decision; raw response remains in audit |
| Invalid drawing coordinates or stroke count | failed drawing; no artifact |
| Oracle exhausted | option is omitted; existing quota never bypassed |
| Oracle answer fails | failed decision; question and answer requests/errors remain visible |
| Memory model fails | **mandatory factual memory** with \`fallback\` status |
| Process crash mid-decision | potential \`running\` row; no automatic retry or invented completion; requires inspection before resuming |

**Known limitation:** crash recovery and concurrency locks are not implemented in v0.1. Only one CLI process may use a Core database at a time. Before any background/scheduled execution, add a single-writer lock, a safe incomplete-decision recovery policy, and tests. The prototype is manual and capped at 10 decisions per command.

## 9. Auditing: answer “why did that happen?”

Inspect a decision's complete chain:

For an easier overview, generate a **static, read-only HTML audit** (no web server, model call or state mutation):

```bash
python nimo_core.py --db ./trial.sqlite3 report --out ./audit.html
```

Open `audit.html` locally. Each decision expands to show the exact context, offered actions, selector and generation payloads, responses, usage, outcome and artifacts. Consolidation calls and memories appear in their own section.


\`\`\`bash
cd nimo-core
python nimo_core.py --db ./trial.sqlite3 inspect --decision 4
\`\`\`

The record includes:

- **Context**: what Nimo saw, including the prior memory and experiences.
- **Choices**: the complete available action list, not just the winning one.
- **Decision request and response**: raw selector input and selected option.
- **Generation request and response**: if content was needed.
- **Outcome**: whether the action passed validation, verified output and artifact ID.
- **Usage**: input/output/cached tokens if the API supplied them.

To inspect all memories and attempted decisions:

\`\`\`bash
python nimo_core.py --db ./trial.sqlite3 inspect
\`\`\`

The reflection request/response is recorded in \`model_calls\` with \`purpose='consolidate'\` and \`decision_id=NULL\`. Inspect it directly using SQLite until a dedicated browser inspector exists:

\`\`\`bash
python - <<'PY'
import sqlite3
db=sqlite3.connect("trial.sqlite3")
for row in db.execute("SELECT id,request_json,response_json,error FROM model_calls WHERE purpose='consolidate' ORDER BY id"):
    print(row)
PY
\`\`\`

The audit shows *observable inputs and outputs*, not a reliable causal explanation of hidden model reasoning. Any statement about motive is an interpretation, not a fact.

## 10. Experiment protocol

**Step 0:** Review this specification and tests. No live experiment is automatically run.

**Step 1:** Run 10 offline mock decisions to verify persistence, validation and consolidation. These choices are scripted and are not evidence about Nimo's autonomy.

**Step 2:** With explicit approval, set the API key and run **exactly 10** real decisions. The command is capped at 10. Inspect each decision and the mandatory memory before extending the experiment.

**Step 3:** Review the results. Ask: Did he genuinely select different goals? What context mattered? Did the generated content differ? Did memory cite actual evidence? Did it feed into later selections? Were costs acceptable? What did we fail to anticipate?

**Step 4:** Change only one documented component at a time, with a test proving the change and a before/after audit.

## 11. Change control rules for future Codex work

1. **No edits outside \`nimo-core/\`** unless separately approved.
2. No silent new drives, scores, prompts, capability restrictions, auto-planners or action cooldowns.
3. For every change, identify the exact contract section changed and expected behavioural effect.
4. Add a failing test before changing code whenever possible.
5. Keep an example of the exact before/after decision context and output.
6. Report API call count and whether the change increases model tokens.
7. Do not replace a real-world observation with synthetic simulation and claim it is a live result.
8. A green test suite is necessary but not proof that model behaviour will satisfy our goals.

## 12. Controlled experiment: three known objects

In this small follow-up, Nimo receives exactly three fixed descriptions in a new `known_objects` field of his normal decision context. These are part of his immediately known surroundings; they are **not** actions, objectives, new tools, memories, or randomly regenerated prompts.

| ID | Object | Direct description |
|---|---|---|
| `cup_001` | Blue ceramic cup | A small blue ceramic cup sits on a wooden table. A hairline crack runs down its handle. |
| `compass_001` | Brass compass | A worn brass pocket compass lies beside the cup. Its needle points northeast, even when the case is turned. |
| `fern_001` | Potted fern | A fern grows in a clay pot near a window. One frond is curled and brown at its tip. |

These descriptions are inserted by `recent_context()`. The identical field reaches the **Decisions API selector** and the **Responses generator** for `think`, `write_journal`, `draw`, and Oracle question creation. The Oracle answer step still receives only its question and its answer-specific instruction, as before. Memory consolidation still receives only ten verified experiences and earlier memories.

The objects are deliberately **constant across decisions and runs**, to test what happens when grounded sensory-like information is present without simultaneously changing the world. Nothing grants Nimo a way to manipulate or inspect these objects, and he is free to ignore them. The audit records the exact descriptions in each decision's saved context. No other behaviour, actions, quotas, memory cadence, prompts or execution mechanism is intentionally changed.

**Interpretation:** Comparing decisions from a fresh ten-decision database to the previous blank-slate run may reveal whether external descriptive context makes his output less abstract, but this small comparison cannot prove causality or a lasting personality shift.

## 13. Open questions (deliberately undecided)

- Should a \`think\` result always change intention, or only when explicitly chosen?
- Should repeated drawing subjects be accepted as sustained interest or prompt feedback?
- What is the smallest honest test for evolving self-understanding rather than self-reinforcement?
- When is it worth attaching the production drawing store or Oracle research engine?
- Should “do nothing” be its own action instead of using \`think\`?
- How should consecutive goals persist across multiple generated artifacts?
- What is a safe model failure retry budget and cost ceiling?

These are **not** already implemented. They are questions we can answer with actual audited runs.

## 14. Controlled experiment: intention before action (new)

**Only behavioural pipeline change:** for each attempted decision, Nimo receives the **existing context** in a new Responses request asking **"Nimo, what would you like to do?"** He answers in a short free-text field `want` (1–300 characters). This is **not** a selection from the tool menu, and Nimo does not see a tool menu in this new request.

1. `express_want` Responses call sees the unchanged identity, three known objects, ongoing intention, four recent experiences, three recent cycle memories and quota.
2. Validate `want`, then add `expressed_want` to the decision's context snapshot, stored in `decisions.context_json`.
3. Send that augmented context to the **existing** Decisions API selector and its **unchanged** four options.
4. The existing chosen tool executor sees the same augmented context for generation.
5. The normal experience log and exactly-one-memory-per-ten-attempts rule remain unchanged. This one-shot want is **not** automatically promoted to persistent state or memory; only the executed outcomes are consolidated as before.

All model requests and responses remain in `model_calls` in call order: `express_want`, `select`, then the selected tool generation. The audit HTML shows all three calls and the augmented context. The terminal response also includes `expressed_want`.

A failed or empty want is a **failed attempted decision**: do not invoke the selector or force a fallback action. It still contributes to the ten-attempt memory counter, as failures already do.

**Limitations:** This adds one Responses call per decision, increasing API cost and latency. It may produce vague or repetitive wants; the experiment measures that rather than silently fixing it. It does not turn the selector's output into a guaranteed expression of Nimo's preferences. The underlying `think` action can still update `state.current_intention` as in prior versions. The separate new `expressed_want` is ephemeral for that decision.

To compare fairly with the earlier experiment, use a **fresh SQLite database** and run exactly 10 live decisions. No live run starts automatically.

