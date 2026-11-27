# W003-E02 — Intention and progress

Approved on 27 November 2026 for implementation, offline verification, and one paid screening of 50 decisions. E01 is provisionally accepted. E00 remains the immutable snapshot; compare against the completed E00 and E01 runs.

## Hypothesis

A compact record of the current intention and the results of recent attempts gives Nimo enough continuity to notice an ineffective approach and voluntarily reconsider it. Evidence for the hypothesis is a linked sequence of ineffective attempts, independent recognition, a change of approach, and a verified outcome that advances the stated aim. A lower inspection count alone is insufficient.

## Intervention

Continue using the existing autonomous goal as the intention. Track its start and last explicit lifecycle decision in clone state. Retain up to five recent tool attempts with decision and event IDs, bounded outcome text, and a factual status: failed, unchanged, observed, pending, or unverified. Carry recent attempts across goal changes and mark which belong to the current intention. Include a small aggregate of the attempts in the current window. A changed observation, successful action, or arrival does not automatically establish progress toward a goal. Associate verified travel arrival with the earlier start rather than crediting a queued journey.

Expose one voluntary intention-management action for setting or revising a goal, abandoning it, or recording completion. The model supplies a brief reason and optional verified outcome references from the submitted payload. Completion requires a cited verified outcome. The system validates provenance and records completion as the agent's assessment, leaving semantic goal satisfaction to analysis. Intentions can also change through the existing goal field on native actions. Keep visitor commitments and E01 structured THINK separate. The intervention never changes tool availability, executes a suggested step, rewards or punishes a choice, or schedules reflection.

Keep models, request settings, physical world rules, E01 THINK, memory and consolidation, and clocks unchanged. Branch from E01 candidate `ba8d8510c655ed8acc13763a3fa8e2207de4bef1`. Restore encrypted E00 SQL with SHA-256 `b56294f210b641769dfcb8c872216efda3c9e4080fff354ff0cc9a4ee4abcdc9`. Reuse its capture manifest, E01 rebase policy, and no-cooldown runner. One paid candidate run only after tests and a mocked exact restore. No production or E03 work.

## Offline gate and scoring

Test persistence and boundedness, pending travel and verified arrival, unchanged and failed outcomes, intention transitions and evidence validation against the exact request, and preservation of E01 THINK, ordinary actions and goal semantics. Compare matched first payloads, record serialized byte sizes, and verify that public telemetry redacts narrative content. Restore the exact snapshot and verify 65% first-decision fullness, 100% curiosity, position (15, 12), inherited inventory and memory.

Report unchanged repeats and longest consecutive streak, continuity across action sequences, voluntary recognition and revisions, outcomes after strategy changes, recalled information linked to actions, voluntary activities and action diversity, and API usage including consolidation. Attribute meaningful progress only when a verified outcome advances a stated aim. Treat absent or ambiguous recognition as inconclusive about that mechanism. Evaluate one screening run as evidence for owner review rather than causal proof or automatic acceptance.

[Implementation and offline verification](verification.md) · [partial results](results.md)
