# Status — 2026-11-27

Shared branch: `experiment/world-003-compact-cognition`.

**W003-E00 ran; baseline acceptance is pending.** The [snapshot run](https://github.com/magickmomo/nimo/actions/runs/45969123701) and [branch checks](https://github.com/magickmomo/nimo/actions/runs/45969123384) succeeded on [`4ad6c6e`](https://github.com/magickmomo/nimo/commit/4ad6c6e9f56bf43f7182376023bdefaecdc2117b). The [results audit](experiments/W003-E00/results.md) independently verifies artifact `15184635626` against its GitHub SHA-256 digest.

The artifact records 50 successful decisions, 12 completed journeys in 16 attempts, and 253,320 total tokens, including eight consolidation calls. Stored fullness was 65.16%, while the first decision saw 0%. A mocked worker replay reproduced the drop and preserved reporting at 65% when the clone's decision clock was rebased. This verifies the mechanism on an offline fixture. The original SQL export was deleted, so an identical mature baseline is unavailable.

The clock policy, secure snapshot retention, and richer evidence telemetry remain proposed. The audit identifies the specific gaps and checks for each. E01–E08 remain pending. The corrected paid E00 run requires owner approval.
