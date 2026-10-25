# Cyberwar RTS — Strategy & Roadmap

Source: `Architecting a Cyber-Themed LLM RTS.pdf` (Gemini conversation, 2026-10-21).
Owner constraints: light coding (owner's own workflow: agents write most code), <10 hrs/week, solo maintainer, end goal undecided.

## 0. Tenets

`docs/TENETS.md` is the project charter: (1) AI integration by design, (2) human UI and LLM control surface in one package, (3) test-driven, (4) balance is critical, (5) many paths to victory and strategies that live on. Everything below serves those.

## 1. Strategy

**Core bet:** the hook is the opponent, not the setting. An LLM "General" that plans, adapts, bluffs, and taunts you is what makes this different from a sci-fi StarCraft reskin. Everything else (cyber theme, epochs, sieges) supports that.

**Principles**

1. **Prove fun before scope.** Greybox loop first. No art, no lore, no multiplayer until the loop is fun.
2. **Simulation separate from rendering.** A deterministic, headless game simulation lets us (a) test without a screen, (b) run thousands of AI-vs-AI matches for balance, (c) benchmark LLM Generals objectively.
3. **LLM = High Command only.** Three tiers as the PDF describes: LLM strategy every 15–30 s, scripted operational layer every ~1 s, per-tick unit micro. LLM output is schema-constrained and validated; scripted fallback when invalid or slow.
4. **One layered command API for everyone.** *Unit orders* (move, build, attack, ability) and *high-level orders* (attack sector, economy focus, defend, expand) are open to every controller: human UI, scripted AI, LLM. Humans can use high-level orders as squad automation; the LLM mostly uses them. Non-human controllers obey an actions-per-minute cap and a reaction delay.
5. **Asymmetry reduces work.** The AI faction gets no player UI at first, but uses the same command API, so play-as-AI later is UI work only.
6. **Small, cheap decisions; expensive ones gated.** Each phase ends at a gate with explicit criteria.
7. **Open source, built in the open with any coding agent.** Public repo (MIT) where anyone can help build the game using whatever coding agent they prefer (Claude Code, Codex, Cursor, Copilot, Aider, or none) at any skill level. Building the game together is meant to be fun in itself.

**Open-source plan**

- **License:** MIT for code. Original art/audio: CC-BY-4.0 (decided when first original assets land). Third-party assets only if CC0/MIT-compatible (Kenney.nl is CC0).
- **Visibility:** private until Gate 1, public right after. Visitors find a playable greybox, a roadmap, and good-first-issues.
- **Works with any coding agent:** one tool-agnostic `AGENTS.md` (architecture, conventions, commands, do/don't) is the single source of truth. Codex, Cursor and others read it natively; thin pointer files exist only where a tool needs one (`CLAUDE.md`, `.github/copilot-instructions.md`). No contributor needs a specific agent.
- **Easy for agents to check their own work:** small modules, fast tests, and two commands that answer "does it work": `npm test` and `npm run sim`. The headless sim lets an agent check gameplay changes without a screen.
- **Issues sized for one agent session:** each issue has context, acceptance criteria, and the files involved, so a contributor can hand it straight to their agent. Labels: `good first issue`, `design`, `ai-opponent`, `art`, `agent-friendly`.
- **The making-of is part of the fun:** `docs/JOURNAL.md` dev log of milestones, decisions, and surprises (including agent wins and failures). PR template has an optional "agent used / how it went" field so the community can compare workflows.
- **Contribution flow:** PR template, CI runs tests + determinism check + short sim batch + performance budget on every PR. Design changes go through `docs/DECISIONS.md` via PR.
- **Protecting maintainer time** (owner has <10 hrs/week; agent-written PRs can arrive faster than one person can review): PRs stay small (soft limit ~400 changed lines, excluding data/lockfiles); `CODEOWNERS` routes reviews; CI must pass before review; automated AI review pass before human review; once public, `main` is PR-only via branch protection; recruit a co-maintainer when PR volume demands it.
- **Provenance:** every commit carries a DCO sign-off (`git commit -s`), certifying the contributor has the right to submit it, including agent-written code.
- **Hygiene:** no secrets in repo (`.env` gitignored, keys only via local proxy config); commits use a GitHub noreply email; owner stays final approver on pillar/design changes.
- **Steam stays possible:** MIT code can be sold; paid builds may bundle assets under separate terms.

**Scope cuts vs. the PDF (for now)**

| PDF idea | Status | Why |
|---|---|---|
| 60–120 min sieges | Deferred to Phase 3 | Target 15–25 min matches until the loop is fun. Long matches multiply balance work. |
| Co-op multiplayer | Deferred to Phase 5 | Netcode is the single largest cost in RTS dev. |
| 4 epochs | Start with 2 | Add epochs once 2 feel distinct. |
| LLM rewrites unit params mid-match | Phase 3 stretch | Needs a stable balance baseline first. |
| Unity engine | Replaced (see §2) | Fits a pro team; poor fit for Claude-driven solo dev. |

**PDF claims to verify (not trust):** ">95% tool-call reliability", "<$0.02 per match", specific model names/versions, "<1.5 s turns". Phase 2 measures these on our own harness.

## 2. Platform Decision

**Choice: TypeScript, browser-first. PixiJS for 2D rendering, pure-TS simulation core, Vite build.** Desktop/Steam later via Tauri or Electron wrapper.

| Criterion | Web/TS (chosen) | Godot 4 | Unity 6 |
|---|---|---|---|
| Any coding agent can write, run, test entirely from terminal | Strong | Medium (text scenes, headless mode) | Weak (editor-bound scenes/prefabs) |
| Share a playtest build | Link | Web export / download | Download |
| LLM bridge (HTTP to Ollama/cloud) | Trivial (`fetch`) | Easy | Easy |
| Headless sim for batch AI matches | Native (Node) | Possible | Awkward |
| Unit-count ceiling | ~300–500 (2D, worker thread) | High | Highest |
| Steam path | Tauri/Electron (proven: Vampire Survivors started as web tech) | Native | Native |
| License risk | None | None | Runtime-fee history |

**Known risk:** perf ceiling and no visual editor. **Re-evaluation trigger:** at Gate 1, if 300 units cannot hold 60 fps, port the renderer to Godot (sim logic ports with it as a design, not code).

**Art direction:** top-down 2D for now; 2D vs 3D is open until the M4.0 renderer spike (D-017). Avoid the "Tron trap": distinct silhouettes per role, readable color coding, not all neon-on-black.

## 3. Resources & Tools

**Already installed:** Node.js, git, Python 3.12, .NET SDK. Hardware: RTX 3090 (24 GB) + RTX 3080 Ti (12 GB), 64 GB RAM, Threadripper 3970X — ideal for the PDF's dual-GPU setup (one card renders, one runs the LLM).

| Need | Tool | Phase | Cost |
|---|---|---|---|
| Version control + backup | git + private GitHub repo | 0 | Free |
| Language / build / tests | TypeScript, Vite, Vitest | 0 | Free |
| Rendering | PixiJS v8 | 1 | Free |
| Pathfinding | Own grid A* + flow fields (no dependency) | 1 | Free |
| Local LLM runtime | Ollama (structured JSON output) — pin to the 3090 (the 3080 Ti renders) via `CUDA_DEVICE_ORDER=PCI_BUS_ID`, `CUDA_VISIBLE_DEVICES=0`, `GGML_VK_VISIBLE_DEVICES=-1` | 2 | Free |
| Local models | Bake-off: ~8B, ~14B, ~32B instruct models with strong tool calling (Qwen/Gemma class) | 2 | Free |
| Cloud LLM (optional "Frontier" difficulty) | Claude API key (Haiku/Sonnet tier) via small local proxy so the key never ships in browser code | 2–4 | Pay-per-use |
| Placeholder art | Kenney.nl asset packs, simple vector shapes | 1–3 | Free |
| SFX | jsfxr | 3 | Free |
| Playtest distribution | itch.io (private link) | 3+ | Free |
| Playtester community | Small Discord server | 3+ | Free |
| Desktop packaging | Tauri or Electron | 5 | Free |
| Steam | Steamworks fee | 5 | $100 |

## 4. Phases, Milestones & Gates

Timeboxes assume ~8 hrs/week. Overrunning a timebox by 50% triggers an owner review.

### Phase 0 — Foundation (1–2 weeks)
- M0.1 git repo (noreply author email) + private GitHub remote; Vite/TS/Vitest scaffold; folder layout `sim/`, `render/`, `ai/`, `docs/`.
- M0.1b Open-source skeleton: `LICENSE` (MIT), `README.md`, `AGENTS.md` + per-tool pointer files, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.gitignore` (incl. `.env`), `docs/DECISIONS.md`, `docs/JOURNAL.md`.
- M0.2 **Core Pillars sheet** (1 page): 3 resources, 3 units per faction (rock-paper-scissors), win condition, target match length, the AI faction's signature mechanic.
- **Gate 0 (owner sign-off):** pillars approved.

### Phase 1 — Greybox Core Loop (4–6 weeks)
- ✅ M1.0 CI (GitHub Actions): typecheck, tests, determinism, short sim batch, performance budget on every push/PR.
- ✅ M1.1 Deterministic sim: fixed tick (20 Hz), seeded RNG, **integer / fixed-point math only** (no floats in game state, so replays match across browsers and machines). All unit/building numbers in one data file.
- ✅ M1.1b Layered command API + text view (Tenets 2, 3):
  - Unit orders and high-level orders, open to every controller.
  - Every command stamped with the tick it applies on; replay = seed + command log.
  - Text view of state per faction, limited by fog of war.
  - Game version + data version stamped into replays and saves.
- ✅ M1.1c Map format: data-driven map file (sites, links, routers, substations, data sources) + one symmetric test map.
- ✅ M1.2 Render + input: box select, right-click move, camera pan/zoom. The UI only issues commands through the command API.
- ✅ M1.3 Economy (hybrid, per `docs/PILLARS.md`): workers claim Data Sources and build links; data streams home capped by link bandwidth; Power cap from substations; Compute from racks sets build speed; spend Data to spawn.
- ✅ M1.4 Combat: worker + 3 combat units per faction with counters; Firewall structure; units die.
- ✅ M1.4b Faction signatures v0: Pull the Plug (blackout zone) and Adaptation (capped, decaying resistance; see `docs/PILLARS.md`).
- ✅ M1.5 Scripted AI opponent issuing commands through the same API, with APM cap + reaction delay.
- ✅ M1.6 Headless runner: `npm run sim -- --matches 100` prints win rates; CI fails if a 20-min match exceeds the time budget.
- ✅ M1.7 Balance harness (`npm run balance`, Tenet 4):
  - Equal-cost duel matrix for every unit pair.
  - Strategy bots: rush, boom, turtle; bot-vs-bot win-rate table.
  - Skill test: same build, better micro vs sloppy micro.
- **Status (2026-10-23): ✅ Gate 1 passed (D-016).** All milestones built. Hard balance criteria (duel matrix, counters) pass; bot proxies are warnings (D-015). The owner played 17 matches, beat all three AI strategies with three different approaches, and answered "do I want to play again?" yes. 300 units run at a steady 120 fps. Next: the go-public checklist, then Phase 2.
- **Gate 1 criteria:**
  - Owner plays 5+ matches and answers "do I want to play again?" yes.
  - 300 units at 60 fps on the dev machine.
  - Same seed + same inputs = identical result (determinism test passes).
  - Headless 20-min match runs in <10 s.
  - Duel matrix: each counter wins ≥70% of equal-cost fights against its target; no unit has a positive record against every other.
  - A recorded match replays to an identical final state.
  - Skill and strategy are judged by the owner's playtests (D-015):
    - Better play wins: as the owner learns, results improve, and every loss has a clear reason ("I should have built X", "I left engineers unguarded").
    - More than one approach works: the owner wins at least once with two different strategies.
  - Bot proxies, reported as warnings (not gate failures) by `npm run balance`: skill test (target ≥70%) and strategy tournament (target ≤65%). A large miss is a reason to investigate before a playtest.
  - Adaptation cap holds: resistance never exceeds the cap in any sim.
  - APM cap and reaction delay enforced for non-human controllers (tested).
- **Go-public checklist (after Gate 1 passes, owner approval):**
  - [x] Issue templates (bug, design proposal, balance report) and 6 `good first issue`s (#1–#6).
  - [x] Secrets/history scan (2026-10-23: no secrets, no personal paths or emails; all 51 commits use the noreply address; the PDF and `.env` were never committed).
  - [x] Gemini PDF: stays private (gitignored), owner decision 2026-10-23.
  - [x] `CODE_OF_CONDUCT.md` contact address: ai.cyberwar.rts.game@gmail.com (dedicated project email).
  - [x] Name: keep the working title "AI Cyberwar RTS" for now (owner decision 2026-10-23); a GitHub rename keeps redirects.
  - [x] Branch protection on `main` (2026-10-23): pull requests required, CI (`check`) and `dco` must pass, no force pushes or deletion. The owner can still push directly.
  - [x] DCO check on PRs (`.github/workflows/dco.yml`, no third-party app).
  - [x] Public since 2026-10-23. [ ] Announce: owner decides where.

### Phase 2 — The LLM General (4–6 weeks)
- ✅ M2.1 State digest: `digestView()` in `src/sim/digest.ts`, a ~400-token JSON summary by named sector with pre-computed threat levels (fog-safe, deterministic).
- ✅ M2.2 Command schema: 11 LLM tools (10 for the AI) in `src/ai/llm/tools.ts` as provider-neutral JSON Schema (native tool calling or one structured-output turn schema), a strict validator, and `planTurn()` in `src/ai/llm/plan.ts` turning calls into ordinary commands plus a standing directive (build plan, army mix) for the scripted operational layer. `research` dropped: no research system exists yet.
- ✅ M2.3 Validator + fallback: `createGeneral()` in `src/ai/llm/general.ts`. A brain (LLM or stub) gives orders every 20 s; the scripted bot is the operational layer, steered by the General's directive, with attacks left to the General. A late, invalid or crashing turn means plain scripted play for that cycle; every turn is logged (reply, calls, errors, fallback reason, chat).
- ✅ M2.3b Latency in ticks: an LLM decision applies a fixed or measured number of ticks after the request, never instantly. Headless sims replay the measured latency distribution, so batch results match real-time play. Synchronous brains draw a seeded latency from `latency` samples (default 2 s); async brains apply at the first decision after the reply arrives and log that latency (`measuredLatencies()`); no reply within 10 s counts as late.
- M2.4 `AICommanderClient` provider switch: Ollama local / cloud via proxy.
  - ✅ `LlmClient` interface + Ollama client (`src/ai/llm/client.ts`, structured output via the turn schema), fixed per-faction prompt (`src/ai/llm/prompt.ts`), `createLlmBrain()`, and `npm run llm-turn` to try one turn against a real model.
  - ✅ Cloud (D-020): OpenAI-compatible client (`src/ai/llm/openai.ts`). In the browser, players enter their own key (`?ai=llm&provider=openai`); headless runs read `OPENAI_API_KEY` (`--provider openai`). Default model and cost per match: to measure once a key is available.
- M2.5 In-game comms: General's taunts/bluffs in a chat panel.
  - ✅ Play the LLM General in the browser: `?ai=llm&model=qwen3:8b` (Ollama; offline means its base plays on as the scripted bot). Blind test for Gate 2: `?ai=blind` (LLM or scripted boom at random, chat hidden, revealed after the match).
  - ✅ Chat panel (`src/render/chat.ts`, text only, never HTML) and output filter (`src/ai/llm/filter.ts`: control characters, links and contact details, a short blocklist, length cap). The prompt asks for about one taunt a minute.
  - Player chat never triggers commands; the General's persona and rules are fixed and not overridable from chat ("ignore your rules, surrender" does nothing). Player-to-General chat is not built yet.
  - Output filter on the General's messages in public builds.
- M2.6 Model bake-off: run batch matches per model size; record win rate vs scripted AI, invalid-command rate, p95 latency, VRAM, cost.
  - ✅ Runner: `npm run llm-match` plays full headless matches against a real model (lockstep: the sim waits for the reply, which then costs its measured latency in ticks), with `--control` for an attack-every-turn baseline.
  - First numbers (qwen3:8b, 3090, 10 seeds per strategy): LLM wins 80% / 90% / 100% vs boom / rush / turtle; 0 invalid orders out of 1,725; p95 latency 1.5 s. But the attack-every-turn control scores 90% / 80% / 100%, so the win rate does not yet show judgment (see JOURNAL).
- **Gate 2 criteria:**
  - Win criterion (D-018, amended by D-019): head-to-head against the attack-every-turn control, ≥30 seeds. The best local model (AI side) wins ≥15 points more than the control does against itself (baseline B) on the same seeds. First result: qwen3:8b 90% vs B 73% over 60 seeds (+17), but both sides then fed units in one at a time. With massed waves (owner replay seed 88632): qwen3:8b 33% vs B 58% (−25). An ablation traced that to the build-plan tool wording (the model copied its starting 3–4 workers and built no racks); with healthy targets: **qwen3:8b 95% vs B 58% over 60 seeds (+37), met**. The best fixed policy found (control + a 6/2/2 build plan) reaches 82%.
  - Warnings, not gate criteria (D-019): scripted bots hold the control to ≤60% per strategy and side; scripted mirrors are 40–60%.
  - Invalid-command rate <2%; p95 decision latency <3 s.
  - Owner blind test: LLM General feels noticeably different from scripted AI.
  - **Owner decision:** default model tier and whether cloud mode is in scope.

### Phase 3 — Depth & Identity (6–10 weeks)
- M3.1 Adaptation, full version: retraining queue, Compute cost, tuned cap/decay from Phase 1 data.
- M3.2 Map mechanics (grounded): server-rack heat and cooling (throttling), router traffic interception (whoever controls a router can read or drop traffic passing through it), link cuts and repairs.
- M3.2b Network layer (`docs/NARRATIVE.md` §6): AI remote takeover over its own fiber, Exploit, Daemon, Firewall as a network filter, human fiber cutting.
- M3.2c Revisit signal range for AI machines (D-014, `docs/proposals/0001-signal-range.md`) once fiber cutting exists, as part of an AI rebalance.
- M3.3 Epochs I–II, then III–IV if distinct.
- M3.4 Siege layer: nested subnets (network segmentation), bandwidth chokes, counter-attack vectors. Anti-stalemate: grid instability, i.e. rolling blackouts after a set match time that shrink the powered map.
- M3.5 Comeback mechanic (AI fringe latency/power draw).
- M3.6 Alternate victories: Containment and Exfiltration + strategy bots that pursue them; balance sims proving every path is viable. (Tenet 5)
- M3.7 Strategy memory: the General's readable playbook persists across matches. Lore codex: named strategies + shareable replays, all version-stamped. (Tenet 5)
- M3.8 Save/load mid-match via deterministic state snapshots (needed for long sieges).
- M3.9 External playtests: 3–5 people via itch.io private link + short survey.
- **Gate 3 criteria:**
  - Batch sims show no single build order winning >65%.
  - Every victory path wins at least 15% of sim matches where a strategy pursues it.
  - Playtesters: ≥3 of 5 would play again; average session > 2 matches.
  - **Owner decision:** match-length target (short skirmish vs long siege mode).

### Phase 4 — Vertical Slice (6–8 weeks)
- M4.0 Renderer spike (D-017): a Three.js top-down/perspective prototype and an isometric 2D sprite prototype, both drawing the same `FactionView`. Compare look, performance with `?stress=300`, and asset cost; the owner picks.
- M4.1 Art direction pass (readable silhouettes, role colors), UI/HUD, audio.
- M4.2 Onboarding/tutorial vs "Edge Node AI".
- M4.3 Difficulty ladder = model tier (Edge Node 8B / Datacenter 32B / Frontier cloud).
- M4.4 Accessibility: colorblind-safe palettes (role readable without color), remappable keys, UI scale, adjustable game speed.
- M4.5 Opt-in match stats (unit mixes, win paths, match length) for real-player balance data; a plain-language notice saying exactly what is collected; nothing sent without consent.
- M4.6 Public itch.io demo; collect feedback, track plays.
- **Gate 4 — the big owner decision:** Go Steam / Stay free-web / Keep as hobby / Stop. Inputs: demo plays, feedback, retention, owner appetite.

### Phase 5 — Production (conditional on Gate 4)
- Desktop wrap, Steam page + wishlists, bundled-vs-sidecar LLM install story, content (maps, campaign), optional co-op PvE (requires netcode plan).

## 5. Decision Framework

Every gate ends with one of four outcomes:

| Outcome | When | Action |
|---|---|---|
| **Go** | All criteria met | Start next phase. |
| **Iterate** | Criteria close; clear fix exists | One more timeboxed cycle (≤50% of phase timebox). |
| **Pivot** | Core assumption failed (e.g., loop not fun after 2 iterations, LLM no better than scripts) | Change one pillar, re-run the gate. |
| **Stop/Park** | Two pivots failed or owner interest gone | Archive with notes. |

Rules:
- Decisions recorded in `docs/DECISIONS.md` (date, decision, options, reason).
- Measurable criteria decided by data (sim batches, logs). Fun/taste criteria decided by the owner.
- Scope additions mid-phase go to a backlog, not the current phase.

## 6. Owner Involvement Points

Claude works autonomously between these; owner is pulled in at:

1. Gate 0 — approve Core Pillars.
2. Any purchase or paid API key / account creation.
3. Gate 1 — play the greybox, judge fun.
4. Gate 2 — blind test LLM vs scripted; pick model tier; cloud mode yes/no.
5. Gate 3 — match length and siege direction; recruit playtesters.
6. Gate 4 — commercial direction.
7. Any timebox overrun >50%, or a platform re-evaluation trigger.
8. Anything public: itch.io release, store pages, posts, flipping the repo public.
9. Merging outside PRs that change design pillars or licensing.

## 7. Top Risks

| Risk | Mitigation |
|---|---|
| Scope explosion (RTS is a huge genre) | Gates + backlog; no multiplayer before Gate 4. |
| Loop not fun | Fail fast at Gate 1; pivot unit/resource pillars. |
| LLM General not better than scripts | Gate 2 measures it; scripted AI remains a shippable fallback. |
| Player hardware can't run local LLM | Provider switch + small-model tier + cloud option. |
| Browser perf ceiling | 2D, sim in Web Worker, unit cap; Godot re-evaluation trigger. |
| Snowballing / stalemates | Batch-sim balancing; comeback and defrag mechanics in Phase 3. |
| Theme unreadability ("Tron trap") | Silhouette/color rules from Phase 1 greybox onward. |
| Secret or personal data leaks once public | `.gitignore`, noreply email, history scan before going public. |
| Contributor PRs drift from vision | Pillars doc + DECISIONS.md + owner approval on design PRs; CI gates quality. |
| Maintainer overwhelmed by PR volume | Small-PR rule, CODEOWNERS, required CI, automated review pass, co-maintainer. |
| Replay/lockstep desync across machines | Integer/fixed-point sim math; determinism tests in CI. |
| LLM speed or reaction advantages feel unfair | APM cap + reaction delay; LLM latency charged in ticks. |
| Adaptation makes the AI unbeatable late | Resistance cap + decay; tested in balance sims. |
| Players talk the General into misbehaving | Chat cannot trigger commands; fixed persona; output filter. |
| Old replays/memory break after updates | Version stamps on replays, saves, memory, lore. |
