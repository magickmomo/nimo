# W003-E00 snapshot run audit

**Disposition:** run completed, baseline acceptance pending. Run [45969123701](https://github.com/magickmomo/nimo/actions/runs/45969123701), artifact [15184635626](https://github.com/magickmomo/nimo/actions/runs/45969123701/artifacts/15184635626), runner [`4ad6c6e`](https://github.com/magickmomo/nimo/commit/4ad6c6e9f56bf43f7182376023bdefaecdc2117b), rebuild [`00a352d`](https://github.com/magickmomo/nimo/commit/00a352dd0c1c661c63ac7b9fd3fc8b08a68d1e9f). SHA-256 of the downloaded ZIP matched GitHub metadata: `5f329aa3aafe2fe769cb81b246bc351c819475d05676200c49606c4b79ff6e61`. The ZIP contains one redacted results JSON and no database export.

## Measured results

The copy started at tick 5,797 and position (15, 12), with one fruit, 72 stored consolidated memories, 11,268 journal events, 12 documents, 284 sketches, and zero coins. The copied world was paused and had no current intention. The runner woke the copy. Stored fullness was 65.158% and curiosity was 1. The first and last decisions saw 0% fullness.

| Metric | Mature snapshot E00 | Fresh rebuild |
|---|---:|---:|
| Completed decisions | 50 | 50 |
| ACT / THINK | 47 / 3 | 47 / 3 |
| Completed journeys / attempts | 12 / 16 | 19 / 20 |
| Turns with automatic recall | 50 | 44 |
| Primary input / output tokens | 231,810 / 1,888 | 161,015 / 1,863 |
| Consolidation calls | 8 | 8 |
| Consolidation input / output tokens | 18,730 / 892 | 12,523 / 1,382 |
| Total tokens | 253,320 | 176,783 |
| Tokens per decision, all calls | 5,066.4 | 3,535.7 |

Cached input and reasoning tokens reported by the API were zero in E00. The total was 43.3% higher than the [fresh rebuild](https://github.com/magickmomo/nimo/actions/runs/45964624365). These runs differ in history, inventory, position, and first-decision fullness. They do not isolate the cost or behavioural effect of inherited memory.

All four travel failures were `already_at_destination`. Three were attempts to travel to (2, 7) while already there. No historical search was selected. Eight consolidation batches recorded two semantic creates and one semantic update, with no reflective proposals.

- Decision 5798 ate amber fruit and raised fullness from 0% to 35%. The model received recalled IDs before this decision, but the redacted records cannot establish that any recalled lesson drove the choice.
- Decision 5803 ate red fruit and reduced fullness from 34.56% to 16.56%. Decision 5805 ate red fruit again and hit the lower boundary. The second observation cannot quantify the full effect.
- Decisions 5811, 5814 and 5816 ate blue fruit at 0% fullness and stayed at 0%. These boundary-censored observations cannot establish that blue fruit has exactly zero effect.

## Offline clock audit

On the research checkout at `781a7aa`, the real worker and isolated SQLite adapter processed two synthetic copies with 65.158% stored fullness, one amber fruit, and the same existing intention. The mock intercepted the exact Responses request before network I/O and returned a valid THINK decision. Both ticks succeeded with one mocked call each.

| Fixture | Fullness in first decision payload |
|---|---:|
| `lastTick` 24 hours earlier | 0% |
| `lastTick` set to the clone start | 65% |

Inventory and intention were preserved in both payloads. The runner currently wakes the clone and resumes journeys without rebasing `lastTick`. The worker calculates hunger from awake time since that timestamp. The artifact confirms the original symptom, but lacks the original `lastTick` and configured hunger rate required to reconstruct the original decay numerically. The fixture tests the first-turn hunger mechanism. It does not validate a complete snapshot clock policy.

## Remaining work for baseline acceptance

- **Clock policy.** Define which elapsed intervals should count before the first decision and during execution. Exercise journey progress, fruit and wildflower regrowth, crop timers, review cursors and daily limits. A hunger-only rebase leaves those other clocks on wall time. Compare stored and effective first-turn needs and document differences.
- **Reusable snapshot.** The workflow deletes the raw export and uploads only redacted results. A reconstruction from public telemetry would lack inherited data. A future baseline needs an access-controlled immutable export, capture timestamp, content digest, schema version, and a verified restore into two independent copies. Choose the storage destination and retention policy before taking a new retained export. Keep raw journals and SQL out of Git and public artifacts.
- **Evidence telemetry.** The artifact lists recall IDs but omits retrievable memory content, stable links from review changes to stored memory versions, and reasons for action selection. Add redacted linkage for decision, outcome, evidence, memory revision and recall. Store detailed context privately if needed to audit application. Keep the distinction between a lesson present in context and observed use in a subsequent decision.

No architecture or runner change was applied by this audit. A corrected paid run remains pending owner approval.
