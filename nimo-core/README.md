# Nimo Core

**Small, inspectable autonomy experiment.** No World 004 dependencies, no virtual body, no background jobs. All code and data remain inside this directory unless you explicitly choose a database path elsewhere.

**Read first:** [Architecture and behaviour contract](docs/ARCHITECTURE.md).

### The loop

First, Responses asks Nimo **"What would you like to do?"** and records his free-form answer as `expressed_want`. The existing Decisions API then selects one of the same four choices, with that answer added to its context.

One of four choices: **think, write in journal, draw, ask Oracle**. Decisions API selects the choice. Responses creates content only for the selected action. The executor validates the content and saves its actual result. Every **10 attempted decisions** produces exactly one memory: a guaranteed factual summary plus an optional model reflection.

| File | Why it exists |
|---|---|
| \`nimo_core.py\` | Runtime, SQLite schema, model transport, validator, CLI |
| \`test_core.py\` | Offline executable tests with mock Responses/Decisions |
| \`docs/ARCHITECTURE.md\` | Precise contract, audit model, limitations and future decisions |

### Run offline first (no API key, no cost)

Requirements: Python 3.11+ and its standard library.

\`\`\`bash
cd nimo-core
python -m unittest -v
python nimo_core.py --db ./trial.sqlite3 run --mock --decisions 10
python nimo_core.py --db ./trial.sqlite3 inspect
python nimo_core.py --db ./trial.sqlite3 inspect --decision 1
python nimo_core.py --db ./trial.sqlite3 report --out ./audit.html
\`\`\`

The offline mock is scripted: **do not infer autonomous behaviour from its choices**. It tests the loop and persistence, including mandatory memory creation.

### Optional live experiment (paid model calls)

\`\`\`bash
export OPENAI_API_KEY="your-key"
export NIMO_CORE_MODEL="gpt-6-luna"
python nimo_core.py --db ./live-trial.sqlite3 run --live --decisions 10
\`\`\`

**No live run is automatically started.** This command will make one additional paid Responses call per attempted decision to ask Nimo what he wants, as well as paid Decisions and Responses API requests, including an extra Oracle answer call when selected and one consolidation call at decision 10. A single command is hard-capped at ten decisions. Use a fresh database to begin from a blank slate.

### Inspect artwork and the audit trail

\`\`\`bash
python nimo_core.py --db ./trial.sqlite3 inspect --decision 4
python nimo_core.py --db ./trial.sqlite3 export --artifact 1 --out ./artifact.svg
\`\`\`

Open `audit.html` in a browser for a read-only, expandable view of every choice, exact API request/response, validated outcome, artifact, and ten-decision memory. This is a static local file; it does not start a server or an agent.

Artifact 1 may be a journal or Oracle result rather than a drawing; inspect the artifact's kind first and use a suitable extension. For drawing records, export writes a standalone SVG. Model API requests and returned responses are stored in \`model_calls\` without the Authorization header.

### Boundaries

- The drawing tool is an isolated implementation of World 004's vector-stroke format, not its live D1 drawing storage.
- Core's Oracle uses Responses to provide a text answer; it is not World 004's researched Oracle or a source-verified search system.
- The stable identity seed is factual. Reflective personality notes are tentative, evidence-linked memories.
- No auto-deploy, no scheduled execution, no GitHub permissions for Nimo, no connection to production world data.
- The prototype expects one process/database writer at a time. Do not schedule it until locks and crash recovery exist.
- The model name may need updating if your OpenAI API access uses another available model.

**Development rule:** modify only this directory, document the change's expected behavioural impact, and add a regression test. See [Change control](docs/ARCHITECTURE.md#11-change-control-rules-for-future-codex-work).

### Controlled new-object attention experiment

This is **one opt-in context change**, not a permanent novelty rule. First run ten live decisions in a *new* database; then make two independent copies of the SQLite database. Close all processes before copying. Both copies contain exactly the same first ten decisions and consolidated memory.

```bash
python3 -u nimo_core.py --db ./attention-seed.sqlite3 run --live --decisions 10
cp ./attention-seed.sqlite3 ./attention-control.sqlite3
cp ./attention-seed.sqlite3 ./attention-stimulus.sqlite3

# Control: no new object
python3 -u nimo_core.py --db ./attention-control.sqlite3 run --live --decisions 10

# Intervention: same history, music box added to known_objects at decision 11
python3 -u nimo_core.py --db ./attention-stimulus.sqlite3 run --live --decisions 10 --new-object-after-10

python3 nimo_core.py --db ./attention-control.sqlite3 report --out ./attention-control.html
python3 nimo_core.py --db ./attention-stimulus.sqlite3 report --out ./attention-stimulus.html
open ./attention-control.html ./attention-stimulus.html
```

The injected observation is a small mechanical music box with a missing winding key, presented as an ordinary fourth `known_objects` entry. There is **no instruction** to inspect it and no modification to the intention prompt, action menu, memory or Oracle. It is visible to the intention generator, selector and executor in the stimulus branch. The exact context is stored with every decision. Before decision 11, even an enabled run sees only the original objects.

Compare decisions 11–20: Did Nimo mention the new object, choose actions involving it, incorporate it into existing interests, or ignore it? Continuing with the compass is not inherently failure. This is a small exploratory comparison, not proof of spontaneous curiosity; stochastic model variation is a confound. No live calls are made by the code change or CI tests. Do **not** copy a database while a run is in progress or run the two conditions against the same database.

### Optional library experiment (four real books)

The independent library prototype offers **The Time Machine**, **The Voyage of the Beagle**, **A Short History of Astronomy**, and **How to Think Like a Computer Scientist: Learning with Python 3**. Sources: Project Gutenberg ebooks #35, #944 and #59212, plus the public HowToThink/HowToThink book source (GNU Free Documentation License 1.3). The astronomy and natural-history books are historic texts, not necessarily current scientific evidence.

Nimo learns that a library is available; he must select `browse_library` to see titles, then `acquire_book` to fetch an actual text (only after browsing). `read_book` loads one roughly 1,000-word passage, with `next`, `previous`, or `repeat` navigation. `put_down_book` pauses reading without losing the saved position. Other actions remain available throughout; reading is never forced. Every library action is explicitly selected through the existing Decisions API, and model-generated book identifiers are validated against the catalogue and database. No web searches, code execution, arbitrary URLs or unsandboxed actions are added.

The first acquisition downloads the source into the selected SQLite database. The programming text is fetched as seven original reStructuredText chapters. Actual book contents are **not** included in the ordinary context; the exact passage Nimo just read is offered to his *immediately following* intention call, then drops out of default context. The database retains immutable source passages, SHA-256, source URL, license, reading progress and event history. Library events and the full passage enter the HTML audit. There is no automatic summarization of reading into permanent memory, no sophisticated retrieval, and no recommendation algorithm.

```bash
git pull
python3 -m unittest -v
python3 -u nimo_core.py --db ./library-001.sqlite3 run --live --decisions 10
python3 nimo_core.py --db ./library-001.sqlite3 report --out ./library-001.html
open ./library-001.html
```

The offline mock deliberately uses only the original tools and does not perform network downloads. New tests exercise the browse/acquire/read/pause/resume sequence with synthetic text, without requiring network or model credentials. Live acquisition requires network access from the machine running Nimo Core and can fail if the source is unavailable; failed attempts are audited. Only run live actions intentionally; each makes billable model calls.

### Live terminal progress

During `--live` runs, the terminal now emits a flushed `model_call_started` event before each API request and `model_call_completed` (with a brief preview) or `model_call_failed` event afterward. Each decision's existing result JSON is also printed immediately when that decision finishes, rather than waiting for all ten decisions. The events identify call ID, decision ID, task purpose and endpoint, and cover the ten-decision consolidation call too. Complete audited request/response contents remain in SQLite and the HTML report. This changes only terminal visibility, not Nimo's prompts, actions, context, or choices. `--mock` remains quiet about individual model calls.

### On-demand book download via approved mirrors

Nimo still initiates every acquisition: `browse_library` exposes titles without downloading, and `acquire_book` triggers a download **only after** Nimo selects the action and the title. The programming book is fetched from the public textbook GitHub repository. The other three books use Project Gutenberg's mirror infrastructure (the Gutenberg high-speed mirror `gutenberg.pglaf.org` first, then the ODU Gutenberg mirror `mirror.cs.odu.edu`). We do not scrape Gutenberg's main website, whose automated-access policy discourages doing so. A failed mirror may fall through to the next approved source. The exact mirror URL(s), source page and SHA-256 are recorded in the SQLite library event upon success. An HTML error page or unexpectedly short response is rejected. All failed sources produce an explicit error and do not mark the book as owned. No books are silently preloaded into Nimo's collection, and model prompts, preferences and decisions are unchanged.

This is a network-dependent feature. The offline tests exercise 503 fallback and failure without network requests, but they do not prove that public mirrors will be reachable from every machine at run time. A mirror can still be unavailable; inspect the returned source-specific error before making more paid attempts.
