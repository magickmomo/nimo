# Status — 2026-11-27

Shared branch: `experiment/world-003-compact-cognition`.

**W003-E00 corrected baseline is accepted as the comparison baseline.**

The [corrected run](https://github.com/magickmomo/nimo/actions/runs/45973447418) and [branch checks](https://github.com/magickmomo/nimo/actions/runs/45973447343) passed on [`421b75a`](https://github.com/magickmomo/nimo/commit/421b75a5c667714b8d9e73aadbdd37705d4aa85f). It completed 50 decisions with stored fullness 65.158% and first-decision fullness 65%. The unchanged cognitive architecture inspected the same plot 46 times. See the [corrected results and verification](experiments/W003-E00/corrected-results.md) and [restore instructions](experiments/W003-E00/restore.md).

**Historical uncorrected run.** The [snapshot run](https://github.com/magickmomo/nimo/actions/runs/45969123701) and [branch checks](https://github.com/magickmomo/nimo/actions/runs/45969123384) succeeded on [`4ad6c6e`](https://github.com/magickmomo/nimo/commit/4ad6c6e9f56bf43f7182376023bdefaecdc2117b). The [results audit](experiments/W003-E00/results.md) independently verifies artifact `15184635626` against its GitHub SHA-256 digest.

The artifact records 50 successful decisions, 12 completed journeys in 16 attempts, and 253,320 total tokens, including eight consolidation calls. Stored fullness was 65.16%, while the first decision saw 0%. A mocked worker replay reproduced the drop and preserved reporting at 65% when the clone's decision clock was rebased. This verifies the mechanism on an offline fixture. The original SQL export was deleted, so an identical mature baseline is unavailable.

The single approved paid run has been used. [W003-E01 completed its one approved screening run](experiments/W003-E01/results.md) from the exact E00 snapshot. The longest unchanged inspection streak fell from 45 to 12, and one structured thought was followed by verified collection at the intended tree. E01 acceptance is pending. E02 through E08 remain pending. The corrected run gives a reproducible starting snapshot and an observed inspection loop. It did not exercise eating, historical search, or a memory revision.
