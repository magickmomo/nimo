# Nimo World — reward experiment v0.1

**Status:** experimental, code on `feature/world-needs-drives-v01`. Does not affect production until merged, D1 migration applied, and Worker/web deployed.

## Purpose

Give Nimo a small, auditable, outcome-based incentive system inside his **existing 9×9 world**. No fabricated achievements: rewards come only from confirmed game-world actions and events.

The model still selects actions; this is **reward feedback and a prompt-level incentive**, *not* reinforcement learning of model weights or a deterministic action-selection policy. Compare the action distribution after deployment to see whether behaviour actually changes.

## Exact reward schedule

| Event | Points | Trigger and anti-farming rule |
|---|---:|---|
| First visit to a new traversable square | **+10** | After an actual completed waypoint. Previously visited squares never pay again. |
| Walk into a previously visited square | **0** | No score for pacing. Journey *start* pays zero. |
| First verified inspection of a tree, shrub or rock | **+12** | From structured observation comparison `first`; each object pays this once. |
| Inspect object with changed observable properties | **+8** | Requires recorded `changed` properties, not a claim in prose. |
| Inspect same object; nothing changed | **−1** | Discourages repetitive inspection loops. |
| Add first label/note to a known object | **+3** | Only the object's first persisted note receives points. |
| Edit an existing object note | **0** | No incentive to repeatedly rewrite labels. |
| Create a new virtual document | **+4** | Only first saved revision. |
| Replace an existing document | **0** | Revisions remain possible, but do not provide unlimited score. |
| Reply to a pending visitor message | **+2** | Only a reply recorded against a specific pending visitor. |
| THINK, OBSERVE, REMEMBER, REQUEST with no executed tool | **0** | Useful reflection is allowed without point-farming. |
| New belief or revised identity | **0** | Unverified self-reported evidence cannot be rewarded safely. |
| Failed tool attempt (invalid destination, unavailable object, etc.) | **−2** | Failure is scored after error confirmation. |
| Travel start or normal behind-the-scenes perception | **0** | No points merely for initiating a journey or repeatedly reading context. |
| Picking and eating apples | **Not implemented** | Food interaction is not an executable tool in this version. Do not award imaginary food points. |
| Sleeping / tiredness recovery | **Not rewarded** | Operator Sleep/Wake remains a control, not an agent tool. |

**Important:** `world_seen` already displays visible squares, but the experiment rewards *visiting* a previously unvisited square, not simply seeing it. Only verified waypoints pay. The initial square and any squares visited before the experiment do not retroactively earn points.

## Reward-to-mood feedback

All meters continue to use **0.0–1.0**.

- Positive reward of `p` points: boredom decreases by `0.004 × p`; happiness increases by `0.0015 × p`.
- Negative reward of `−p` points: boredom increases by `0.006 × p`; happiness decreases by `0.003 × p`.
- All results are clamped to 0–1.
- Reward *does not* magically refill hunger or energy. Tiredness is **100% − Energy** (one physical drive, not two).
- Hunger still increases with time; eating has not yet been integrated into the world, so this version cannot resolve hunger.
- Existing time-based mood drift and visitor-response rules remain.

Examples: A new square (+10) reduces boredom by **4 percentage points**, increases happiness by **1.5 percentage points**. A first inspection (+12) reduces boredom **4.8 points**, increases happiness **1.8 points**. One unchanged inspection (−1) increases boredom **0.6 points** and decreases happiness **0.3 points**.

## Where the records live

- `world_rewards` D1 table: one row per verified action or waypoint, with a unique `source_key` to avoid double-paying retries.
- `world.state.rewardCursor`: last reward record applied to mood. Rewards from travel are processed on the next successful decision tick.
- `/snapshot`: `rewardTotal` and up to 30 newest `rewards`.
- World dashboard: **Reward feedback** panel, showing each outcome and current cumulative total.
- Prompt: provides scoring policy and recent rewards, but the LLM remains free to choose an action that scores zero.
- No reset of the existing journal, object memory or map.

## Deployment order

1. Apply `world-worker/migrations/008_world_rewards.sql` to the existing Cloudflare D1 database (once). Fresh databases already include this table in `schema.sql`.
2. Run `cd world-worker && npm install && npm test && npm run typecheck`.
3. Run `cd web && npm install && npm run typecheck`.
4. Deploy Worker changes and then web UI. **Do not deploy the Worker before the D1 migration.**
5. Keep production and experiment behaviour separate until review.

## Behaviour test protocol

Record one baseline session (before deploying) and one equal-length session afterwards. Aim for 20–30 decisions each under comparable conditions.

| Measure | Before | After | What to watch |
|---|---|---|---|
| Unique new tiles actually visited | | | Should increase, but eventually saturate. |
| First object inspections | | | Should increase before repetition. |
| Repeated unchanged inspections | | | Should decrease. |
| Repeated revisits / pacing | | | Should not become a point loop. |
| Non-tool THINK/OBSERVE choices | | | Should still happen when appropriate. |
| Failed tool calls | | | Should not increase. |
| Happiness, boredom, hunger, tiredness | | | Four meters remain sensible. |
| Total reward and per-action breakdown | | | Correlate increases with genuinely new outcomes. |

**Example trace:** Nimo walks to two genuinely new squares: +20. He inspects a tree for the first time: +12. He saves its first note: +3. He inspects the unchanged tree three more times: −3. Net = **+32**. If he retraces the same path, his old squares score **0**.

## Known limitations and next iteration

1. Model weight training is **not** happening. Behaviour change is driven by the prompt, reward history and simulated need feedback.
2. The observation scene is currently static; repeat inspections should usually score −1. Changes are future-proof but uncommon in today's world.
3. Hunger lacks a relief action until apple trees, picking and eating are implemented.
4. Energy still follows the prior day/night target; sleeping is an owner-controlled pause, not a voluntary agent action.
5. The four meters are not a fully autonomous utility-based policy. The next step could calculate a ranked list of feasible actions from needs, memory and expected reward, then give that to the model for final choice.
6. Only successful decisions update `rewardCursor`; reward rows survive failures and are caught up on a future completed tick.
7. The initial 9×9 world is small, so exploration rewards necessarily run out. This is deliberate and makes curiosity-vs-repetition observable.

## Review questions

- Does he stop inspecting an unchanged tree after a few attempts?
- Does he go to unexplored locations without obsessively checking every tile?
- What does he do when all reachable novelty is exhausted?
- Does a reward-free action still occur when it makes sense?
- How do hunger and boredom influence choices *before* apple trees and food exist?
