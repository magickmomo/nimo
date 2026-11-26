## World 003 — deferred transfer backlog (26 November 2026)

Do not implement yet. Revisit after core experiments. Source reviewed on main: world-worker/src/index.ts, decision-schema.ts, personal-memory-consolidation.ts, personal-memory-recall.ts, priority-policy.ts, oracle.ts. Live deployment/database not verified.

- [ ] W003-E01: Remove solicited identityUpdate from prompt/schema and automatic persistence; retain existing identity/history.

- [ ] W003-E02: Remove mandatory monologue for executable actions; derive activity display from selected action/outcome. Preserve deliberate thoughts, journal entries, visitor replies and creator requests; retain verified event audit.

- [ ] W003-E03: Simplify decision prompt toward “You are Nimo. Choose your next action.” Keep necessary environment semantics, tool eligibility, visitor handling and safety constraints; move enforceable rules into code. Remove Oracle usage coaching, repeated autonomy/novelty guidance and instruction parroting triggers. Test separately from schema changes.

- [ ] W003-E04: Validate memory proposals independently; preserve valid proposals when another fails, treat length as guidance where safe, log rejected proposals and preserve evidence checks, atomic commits and existing retry/skip audit. Consider episodic/semantic/reflective types alongside existing subject categories in a separate test. Review 500-character event truncation and actual source content.

- [ ] W003-E05: Replace automatic goal generation with deliberately managed goals/projects; preserve visitor commitments and project state.

- [ ] W003-E06: Audit input tokens and remove duplicate context (action menu/catalogue, needs, history, goal review, etc.) incrementally; retain necessary perception and verified outcomes.

- [ ] W003-E07: Evaluate native strict function calling with deterministic execution. World 003 already uses one ordinary decision call; do not assume core's 64% call savings transfer.

- [ ] W003-E08: Extend existing relevance-based recall with historical search and retrieval; preserve separate Oracle knowledge and artwork access.

Preserve world physics, fullness/curiosity, economy, navigation, deterministic permissions, projects, object observations, Oracle async research and costs, artwork inspection, creator requests and visitor interactions. Oracle already has a separate research identity and answer visibility; retain those. Verify actual daily quota enforcement before simplifying its prompt. Use isolated branches, matched baseline runs and one change at a time; measure action distribution, repetition, verified success, memory validity, token usage/cost and visitor regressions. No production changes or deployment authorized by this note.

Evidence: [E10](https://github.com/magickmomo/nimo/actions/runs/45872006135), [200-decision run](https://github.com/magickmomo/nimo/actions/runs/45872831686): 200/200, 220 calls, 20/20 consolidations, 185 reads, 7 thoughts, 5 journals, 2 acquisitions, 1 browse, 931927 tokens. Six consolidation cycles exceeded prior length guidance and were preserved. Long-term retrieval and creative repetition remain open. Single run, not proof of transfer to World 003.