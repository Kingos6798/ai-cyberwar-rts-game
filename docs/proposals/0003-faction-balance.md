# Proposal 0003: Faction balance (issue #32)

Status: **proposed, needs owner playtests and approval.** No stat is changed yet. All numbers below come from running the game with the changed values in memory, on the bots and seeds `npm run balance` uses.

## What the numbers say on main today

Issue #32 was written before several bot fixes landed, so I re-measured. This is main at `DATA_VERSION` 11, over **80 seeds**: two runs of 40, since 40 seeds alone carry about ±8 points of noise (see the journal, "The sim was quietly picking a side").

| Measure | Issue said | Main now (80 seeds) | Target |
|---|---|---|---|
| Control vs AI boom (pressure) | 76% | 42% ✅ | ≤ 60% |
| Control vs AI turtle | 86% | 70% | ≤ 60% |
| Control vs human rush / boom / turtle | – | 71% / 60% / 88% | ≤ 60% |
| Mirrors, human win: rush / boom / turtle | – / 38% / 36% | 58% / 36% / 39% | 40–60% |
| Human rush vs AI turtle | 9% | 4% | – |
| Baseline B (control vs control, AI wins) | 73% | 61% | ~50% |
| First army out (150 Data of units, boom mirror) | AI ~45 s earlier | human 117 s, AI 88 s | – |

What's still a **faction** problem (one side favored by its stats):
- The AI wins the economic mirrors (boom 36%, turtle 39% human wins) and the control mirror (B 61%).
- The AI's first army arrives ~29 s earlier.

What looks like a **bot strategy** problem (shared by both sides, so not fixable with faction stats):
- The turtle bot collapses to constant pressure as either faction (control wins 88% vs human turtle, 70% vs AI turtle).
- The human rush bot can't break an AI turtle (4%). Every faction-wide change below leaves it at 2–21%, except changes so big they break everything else. It needs an owner playtest (`?ai=turtle`, rush) to tell whether a skilled human can break it.

## Why the AI wins long games

At equal Data, human units beat their AI counterpart of the same role 95–98% of the time (duel matrix). Humans win short fights. The AI makes up for it two ways:
1. **Production speed:** cheap units with less work each mean its first army is out ~29 s earlier.
2. **Adaptation:** up to 25% resistance to whatever killed it most, built up over a long game.

When the bots sit back and boom, both pay off, so the AI takes the slow mirrors.

## Options tested

The levers tested: human training speed (the `work` of human combat units), Adaptation (`cap`, `perDeath`), AI toughness (`hp`), AI unit cost, Maintenance Drone hp, and Sentry Gun fire rate. First at 40 seeds, then the front-runners at 80.

"Warnings" counts what `npm run balance` would flag among mirrors (40–60%) and pressure (≤ 60%). The duel matrix and counter checks pass in **every** variant.

| Variant (80 seeds) | Mirrors r/b/t | Pressure: human r/b/t | Pressure: AI r/b/t | Rush vs AI turtle | B | Warnings |
|---|---|---|---|---|---|---|
| **Main** | 58 / 36 / 39 | 71 / 60 / 88 | 48 / 42 / 70 | 4 | 61 | 5 |
| **A: human units train 5% faster** | 76 / 41 / 45 | 60 / 59 / 81 | 59 / 44 / 73 | 3 | 58 | 3 |
| **B: A + softer Adaptation + tougher drones** | 79 / 48 / 51 | 59 / 55 / 78 | 59 / 44 / 80 | 5 | 54 | 3 |
| Softer Adaptation + tougher drones only | 65 / 39 / 37 | 74 / 54 / 83 | 49 / 41 / 67 | 2 | 59 | 6 |

Dropped at 40 seeds:
- **AI units +10% hp:** humans lose more (rush vs boom 40 → 13, B 65).
- **AI units ~8% cheaper:** same direction (boom mirror 28, turtle vs boom 15).
- **Sentry Gun fires 20% slower:** no real change (rush vs AI turtle 9 → 4).
- **Human units train 10% or 20% faster:** overshoots. Rush mirror 80–95%, B 20–28%: humans now win the control mirror as lopsidedly as the AI used to.

## Recommendation

**Variant A first: human combat units train 5% faster.** It's one number per unit, and the smallest step that moves the AI-favored measures toward fair:

| Unit | `work` now | Proposed |
|---|---|---|
| counter_drone_team | 2500 | 2375 |
| red_team | 3000 | 2850 |
| armored_vehicle | 4000 | 3800 |

Effect over 80 seeds:
- Boom mirror 36 → 41 and turtle mirror 39 → 45: both now inside 40–60.
- Control vs human rush 71 → 60 (at the bar).
- B 61 → 58.
- Cost: the rush mirror tips toward humans (58 → 76).

Grounding: a better-drilled ops team gets crews out faster. Nothing bends reality.

**Variant B** adds two AI-side changes that bring B closest to 50% (54) and the boom and turtle mirrors closest to 50/50:
- `ADAPTATION.cap` 25 → 15, `perDeath` 3 → 2: the Model learns more slowly from losses.
- `maintenance_drone.hp` 30 → 40: same as a Field Engineer, so early raids don't wipe out the AI's workforce at once.

Its cost is the rush mirror (79) and AI turtle under pressure (80). Worth trying if A feels right but the AI still out-scales humans in long games.

Neither variant fixes **rush vs turtle** or **turtle under pressure**. Those look like turtle- and rush-bot habits, so they're follow-ups for the bots (or the owner's playtests), not for faction stats.

## Before any of this lands

1. **Owner playtests on main:** rush vs `?ai=turtle`, and early aggression vs `?ai=boom`. Does the AI collapse when attacked early? Does turtle feel unbreakable? Bots are crude proxies (D-015).
2. If approved, one PR per variant:
   - the `src/sim/data.ts` change with `DATA_VERSION` bumped to 12 (old replays are then refused, as designed);
   - a `docs/DECISIONS.md` entry;
   - `npm run balance -- --seeds 40` before/after in the PR;
   - **Gate 2 re-measured:** `npm run llm-match -- --model qwen3:8b --no-think --human control --matches 60 --with-control`, since B moves with faction balance (D-019).

## How to reproduce

Set the values above in `src/sim/data.ts` and run `npm run balance -- --seeds 40` (or 80). B is the control-only run: `npm run llm-match -- --control --human control --matches 80`.
