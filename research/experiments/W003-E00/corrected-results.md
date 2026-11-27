# W003-E00 corrected mature baseline

The single approved run completed 50 decisions on 27 November 2026. The [runner commit](https://github.com/magickmomo/nimo/commit/421b75a5c667714b8d9e73aadbdd37705d4aa85f) changes the snapshot scripts, experiment telemetry, tests, and workflow. Worker cognitive source files are identical to the parent commit. [Paid workflow](https://github.com/magickmomo/nimo/actions/runs/45973447418) · [Branch checks](https://github.com/magickmomo/nimo/actions/runs/45973447343).

## Snapshot and offline verification

The read-only export began at 09:24:55.885 and completed at 09:25:00.113 UK time. The manifest pins runner schema 34 and SQL SHA-256 `b56294f210b641769dfcb8c872216efda3c9e4080fff354ff0cc9a4ee4abcdc9`. The stored state had tick 5,797, position (15, 12), 65.158% fullness, 100% curiosity, one fruit, 72 stored memories, 11,268 events, 12 documents, 284 sketches and no active intention.

- Type checking and 199 worker tests passed locally and in the paid workflow's offline gate. GitHub's separate branch checks also passed.
- The regression tests exercised physical timer offsets, preserved history, stale review lease cleanup, two mocked first requests through the real worker, authenticated encryption, and rejection of tampered ciphertext.
- The workflow independently restored the export twice before charging the paid run. After download, we matched both GitHub ZIP digests, decrypted the SQL, verified its manifest hash, and restored two further copies offline. Both presented 65% fullness, 100% curiosity, and position (15, 12) on their first decision.
- The backup uses AES-256-GCM with a fresh content key wrapped to the baseline RSA public key. The encrypted snapshot and transcript have durable copies, with the private recovery key retained separately. GitHub artifacts are [baseline 15185948092](https://github.com/magickmomo/nimo/actions/runs/45973447418/artifacts/15185948092) and [results 15186036931](https://github.com/magickmomo/nimo/actions/runs/45973447418/artifacts/15186036931). See [restore instructions](restore.md).

## Observed behaviour and cost

| Metric | Corrected W003-E00 | Earlier mature run |
|---|---:|---:|
| Completed decisions | 50 | 50 |
| First decision fullness | 65% | 0% |
| Final stored fullness | 64.224% | Last decision saw 0% |
| Inspections | 46 | 19 |
| Journeys completed / attempted | 2 / 2 | 12 / 16 |
| Turns with automatic recall | 50 | 50 |
| Primary calls | 50 | 50 |
| Consolidation calls | 8 | 8 |
| Total tokens | 255,098 | 253,320 |
| Total tokens per completed decision | 5,101.96 | 5,066.40 |

Primary calls used 233,732 input and 1,796 output tokens. Consolidation used 19,167 input and 403 output tokens. The API reported zero cached and zero reasoning tokens. The decrypted trace contained all 50 primary requests and outcomes, with 50 distinct decision trace IDs. The first serialized decision request was 22,809 bytes. The token totals are measured API usage.

All 46 inspections targeted `plot_003` and returned an unchanged comparison. The other actions were two one-step journeys, one THINK and one object note. Recall surfaced five distinct memory IDs across 50 turns. Eight completed consolidation batches proposed zero memory changes. Nimo made no food or explicit historical-search decisions. Recall exposure is observable, but the trace provides no evidence that recall interrupted the inspection loop. Two journeys are too few to infer a change in navigation reliability.

The earlier run started from matching reported tick and position, but its SQL was deleted. Exact state equality cannot be checked. Fullness differed at first decision, and model output can vary. The corrected result establishes a reusable baseline and a concrete repetition pattern, without isolating what caused the pattern.

## Remaining limits

The clone uses the export window's start as its physical timer reference. Daily ledgers retain their original dates, while the experiment follows the execution calendar. Background Oracle research was inactive. No cooldowns were applied. There were no memory revisions in the paid run to exercise the new committed revision links. No W003-E01 work or additional paid run was started.
