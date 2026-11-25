# Nimo Core

**Small, inspectable autonomy experiment.** No World 004 dependencies, no virtual body, no background jobs. All code and data remain inside this directory unless you explicitly choose a database path elsewhere.

**Read first:** [Architecture and behaviour contract](docs/ARCHITECTURE.md).

### The loop

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

**No live run is automatically started.** This command will make paid Decisions and Responses API requests, including an extra Oracle answer call when selected and one consolidation call at decision 10. A single command is hard-capped at ten decisions. Use a fresh database to begin from a blank slate.

### Inspect artwork and the audit trail

\`\`\`bash
python nimo_core.py --db ./trial.sqlite3 inspect --decision 4
python nimo_core.py --db ./trial.sqlite3 export --artifact 1 --out ./artifact.svg
\`\`\`

Open `audit.html` in a browser for a read-only, expandable view of every choice, exact API request/response, validated outcome, artifact, and ten-decision memory. This is a static local file; it does not start a server or an agent.\n\nArtifact 1 may be a journal or Oracle result rather than a drawing; inspect the artifact's kind first and use a suitable extension. For drawing records, export writes a standalone SVG. Model API requests and returned responses are stored in \`model_calls\` without the Authorization header.

### Boundaries

- The drawing tool is an isolated implementation of World 004's vector-stroke format, not its live D1 drawing storage.
- Core's Oracle uses Responses to provide a text answer; it is not World 004's researched Oracle or a source-verified search system.
- The stable identity seed is factual. Reflective personality notes are tentative, evidence-linked memories.
- No auto-deploy, no scheduled execution, no GitHub permissions for Nimo, no connection to production world data.
- The prototype expects one process/database writer at a time. Do not schedule it until locks and crash recovery exist.
- The model name may need updating if your OpenAI API access uses another available model.

**Development rule:** modify only this directory, document the change's expected behavioural impact, and add a regression test. See [Change control](docs/ARCHITECTURE.md#11-change-control-rules-for-future-codex-work).
