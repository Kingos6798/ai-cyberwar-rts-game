# Decisions

Newest first. Each entry: date, decision, options considered, reason. Changes to design pillars need owner approval.

## D-020 — 2026-10-25 — Cloud General: OpenAI-compatible API, player's own key in the browser
- **Decision:** cloud mode is in scope (Gate 2 owner decision), for players who can't or don't want to run Ollama.
  - **Provider:** an OpenAI-compatible `/chat/completions` client (`src/ai/llm/openai.ts`), so OpenAI and compatible services (OpenRouter, Groq, LM Studio, Ollama's `/v1`) all work. JSON mode for the reply; the turn validator checks its shape.
  - **Key, browser:** each player enters their own key (`?ai=llm&provider=openai`). It is kept in session storage, or in local storage only if they tick "remember". It is sent only in the Authorization header to `api.openai.com`, and never put in the URL, the build, logs or error messages. `&newkey` forgets it. The browser never takes a custom API address from a link, because a shared link could send a saved key elsewhere.
  - **Key, headless:** `--provider openai` reads `OPENAI_API_KEY` (and optional `OPENAI_BASE_URL`) from the environment or a local `.env`.
- **Options:** player's key in the browser (chosen); a local proxy holding a developer key (`npm run proxy`, safer for keys but players need Node); both.
- **Reason:** in-browser keys are the only option that works for a hosted build with no server. The project never holds anyone's key.
- **Open:** default cloud model and cost per match, to be measured with the Gate 2 head-to-head once a key is available (#29).
- **Approved:** owner, 2026-10-25.

## D-019 — 2026-10-24 — Gate 2 bar: head-to-head against the control; bot checks become warnings
- **Decision (amends D-018):**
  - Criteria 1 (bots survive pressure) and 2 (fair mirrors) become warnings in `npm run balance`, as D-015 did for Gate 1's bot proxies.
  - Criterion 3 is measured head-to-head. The LLM General plays the AI side against the control on the human side. Baseline B is the control playing itself (AI side vs human side) on the same seeds. The LLM must win at least B + 15 points over at least 30 seeds (`npm run llm-match -- --human control --matches 30 --with-control`). The comparison against scripted bots stays as a secondary report.
- **Options:** keep criterion 1 as a hard bar and change faction stats; head-to-head (chosen).
- **Reason:** four rounds of bot changes (outpost defense, kept; wave timing, safe opening, extra production, dropped) fixed the human side but never the AI side, which loses 80–100% to human pressure while winning the economic mirrors. That is faction balance, better judged in owner playtests than by bot proxies. And against today's bots the control already wins 90%, so "beat the control by 15 points" was capped at 10. Head-to-head has no such ceiling, and B absorbs faction balance.
- **First result (qwen3:8b, `--no-think`, RTX 3090):** seeds 1–30: LLM 87% vs B 67% (+20); seeds 31–60: 93% vs 80% (+13). Pooled over 60 seeds: 90% vs 73% (+17, about 2.4 standard errors). 0 invalid orders out of 3,405; p95 latency 1.5 s. B is high (the AI faction wins the control mirror), which leaves little headroom; re-measure if faction balance changes.
- **Approved:** owner, 2026-10-24.

## D-018 — 2026-10-24 — Gate 2 measures the LLM against an attack-every-turn control
- **Decision:** Gate 2's win criterion changes from "beats the scripted AI in ≥55% of matches" to three criteria:
  1. **Bots survive pressure:** the attack-every-turn control (`src/ai/llm/control.ts`, no model) wins at most 60% against each scripted strategy, on each side (`npm run balance`, pressure test).
  2. **Fair mirrors:** in each scripted mirror match (rush vs rush, …), each side wins 40–60% (`npm run balance`).
  3. **The LLM beats the control:** on the same seeds, at least 30 per opponent, the LLM General's pooled win rate is at least 15 points above the control's (`npm run llm-match -- --matches 30 --with-control`).
- **Options:** keep "≥55% vs scripted AI"; beat the control (chosen); add more trivial stub strategies (later, optional).
- **Reason:** the first 30 LLM matches won 90%, and so did the control. Against today's bots the old bar measures aggression, not judgment. Mirrors favor one side (boom: AI 67%), which hands a General wins it didn't earn. With 10 seeds a 10-point gap is noise, hence 30 seeds and a 15-point margin.
- **Baseline (2026-10-24, 30 seeds):** control vs human rush / boom / turtle 80% / 90% / 100%, vs AI rush / boom / turtle 37% / 100% / 98%. Mirrors (human win %): rush 70%, boom 33%, turtle 37%. So 5 of 6 pressure checks and all 3 mirrors miss; the next work is tougher bots. The gentle `training` opponent is not part of these checks and stays as it is.
- **Approved:** owner, 2026-10-24.

## D-017 — 2026-10-23 — OPEN: renderer for final art (2D vs 3D)
- **Question:** stay on PixiJS (2D, top-down or isometric "2.5D" sprites, as in the original Age of Empires) or move to a 3D renderer (Three.js or Babylon.js: perspective camera, glTF models)?
- **What's fixed either way:** the stack (TypeScript, npm, browser). The sim, AI, harness, tests, replays and HTML HUD stay unchanged, because the renderer only reads `FactionView` and issues commands. Only `src/render/` drawing (about 1,000 lines) and map picking would change.
- **Main cost:** art, not code. Models or sprites, licenses (contributed art CC-BY-4.0 or CC0), download size, one consistent style.
- **Plan:** keep PixiJS through Phases 2–3. At the start of Phase 4, a renderer spike (M4.0) compares a Three.js top-down prototype with isometric 2D sprites on the same game state; the owner picks the art direction from that.
- **Status:** open, owner to decide at M4.0. Tracking issue: #7.

## D-016 — 2026-10-23 — Gate 1 passed
- **Decision:** Phase 1 (greybox core loop) is complete; start the go-public checklist, then Phase 2 (the LLM General).
- **Evidence:** 17 owner playtests. Wins against turtle (defensive), boom (Center First and Router Choke) and rush (defend, then counter); losses with clear, actionable causes that turned into wins (D-015). Determinism, replay, APM and Adaptation tests pass. A 20-minute headless match runs in well under 10 s. 300 units at a steady 120 fps on the owner's machine. Owner: "play again?" yes.
- **Known gaps carried forward:** bot proxies near their targets but over them (human rush 68%; skill test 48–63%); the rush AI banks Data it can't spend; signal range shelved (D-014).

## D-015 — 2026-10-22 — Owner playtests judge skill and strategy at Gate 1
- **Decision:** the bot skill test and strategy tournament become warnings. Gate 1 skill and strategy criteria are judged in owner playtests: better play wins, and more than one strategy can win. The duel matrix and counter checks stay hard criteria.
- **Options:** more seeds plus a tolerance band; owner playtests; new skill-expressive mechanics.
- **Reason:** scripted bots are crude, so their results swing ±20 points on one parameter. Near the 65%/70% lines they can't tell a real imbalance from noise. Tenet 4 is about how skill feels to real players. Owner chose playtests.

## D-014 — 2026-10-22 — Signal range shelved until Phase 3
- **Decision:** AI machines keep moving freely. The signal-range prototype stays in code behind `SIGNAL.enabled = false`; revisit it in Phase 3 together with fiber cutting and an AI rebalance. See `docs/proposals/0001-signal-range.md`.
- **Options:** hard leash, mesh swarms, soft leash (all tested); shelve.
- **Reason:** every variant crushed the AI's attacks (AI rush 2–23% overall), because the AI always fights in the human base, out of its own signal. Making it fair needs a redesign of the AI side. Owner approved shelving.

## D-013 — 2026-10-22 — Expansion sites
- **Decision:** each side gets two extra Data sources far from its core (`h_exp_n`, `h_exp_s` and their mirrors), linked into its network.
- **Options:** more, farther sites; workers stationed at a site raise its output; booming means racks only.
- **Reason:** extra workers added no income, because 4 workers could claim every source, so booming never paid off. Expansions make "boom" mean "expand": more income, but more ground to defend. Approved by owner.

## D-012 — 2026-10-22 — Static defenses
- **Decision:** a cheap armed structure for each side. Humans: **Security Post** (armed guards; keeps firing in a blackout). AI: **Sentry Gun** (an automated turret it has hijacked; needs grid power, so Pull the Plug silences it).
- **Options:** static defenses; cores that shoot; repair and healing only.
- **Reason:** with no home advantage, rushing beat every other strategy for both sides. Approved by owner.

## D-011 — 2026-10-21 — Roster v3 adopted
- **Decision:** units follow Atoms vs Bits. Humans: Field Engineer, Counter-Drone Team, Red Team, Armored Response Vehicle. AI (hijacked machines): Maintenance Drone, Botnet Swarm, Hunter Drone, Industrial Robot. The physical wall is a Barricade. Firewall, Exploit, Daemon, remote takeover and fiber cutting move to the Phase 3 network layer. The AI is "The Model" and the region is a fictional metro for pre-release testing. All subject to change after testing.
- **Reason:** code units walking around and getting shot contradicted the world framing (D-010). Roles and stats are unchanged, so balance work carries over.

## D-010 — 2026-10-21 — World framing "Atoms vs Bits" and the breakout premise
- **Decision:** the map is a physical metro region with a network layer drawn on top. Humans act physically; the AI lives in the network and acts physically only through machines it hijacks. Premise: a frontier model breaks containment; humans must contain it before it exfiltrates. If containment fails, it escalates into a resource war. See `docs/NARRATIVE.md`.
- **Options:** Atoms vs Bits; pure cyberspace; physical only.
- **Reason:** owner found the premise conflated (code units walking around, people shooting software). Atoms vs Bits keeps every existing grounded mechanic (power, fiber, Pull the Plug, containment/exfiltration) and gives each side exactly what the other lacks.
- **Pending:** roster v3 and network-layer mechanics (NARRATIVE §6) need owner approval; tone is a provisional default.

## D-009 — 2026-10-21 — Docs review: architecture, fairness, balance, governance
- **Decisions:**
  - Layered command API (unit orders + high-level orders) open to every controller; humans can use high-level orders as automation.
  - Non-human controllers: APM cap + reaction delay; LLM decisions apply a measured number of ticks after the request.
  - Sim uses integer/fixed-point math only; commands tick-stamped; game + data version stamped on replays, saves, memory, lore.
  - Faction signatures (simple versions) move into Phase 1; Adaptation gets a cap, decay, and recent-deaths window.
  - Balance harness adds strategy bots, a skill test, and symmetric test maps; data-driven map format in Phase 1.
  - Phase 3 terms re-grounded: rack heat, router traffic interception, link cuts, grid instability (rolling blackouts) as anti-stalemate.
  - Alternate victories Containment / Exfiltration approved.
  - Governance: small-PR rule, CODEOWNERS, DCO sign-off, branch protection + DCO check at go-public, CI performance budget.
  - LLM chat can never trigger commands; output filter for public builds.
  - Phase 4 adds accessibility and opt-in match stats; save/load snapshots in Phase 3; name/trademark check before going public.
- **Reason:** owner-approved review of all docs against the five tenets; fixing architecture now is far cheaper than after Phase 1 code exists.

## D-008 — 2026-10-21 — Five design tenets adopted
- **Decision:** `docs/TENETS.md` is the project charter: AI integration by design; human UI + LLM control surface in one package; test-driven; balance is critical; many paths to victory with strategy memory and lore.
- **Consequences:** CI moves to the start of Phase 1; a single command API for UI, scripted AI and LLM; all stats in one data file; duel-matrix balance harness in Phase 1; alternate victories and strategy memory in Phase 3.
- **Reason:** owner's core intent for the project.

## D-007 — 2026-10-21 — Gate 0 passed: Core Pillars v2 approved
- **Decision:** `docs/PILLARS.md` v2 approved. Pull the Plug vs Adaptation as faction signatures; hybrid economy (data streams over links, workers claim sources and build/repair links); Power as cap, Compute as production speed, Bandwidth as link capacity; play-as-AI deferred to Phase 3+; unit names kept as drafts.
- **Options (economy):** data flows over links; workers carry data (classic AoE); hybrid.
- **Reason:** hybrid stays grounded (data really moves over networks) while keeping plenty of worker activity. Signatures mirror the real debate on AI and society: the off-switch vs a system that learns faster than we respond.

## D-006 — 2026-10-21 — Grounding rule for all terminology
- **Decision:** every in-game term and mechanic must behave like its real-world counterpart. Deviations are marked "stretch" in `docs/PILLARS.md` and need owner approval.
- **Reason:** owner wants the cyber world to feel real, not a sci-fi reskin. Example: a router forwards traffic and is passive, so it is a capturable junction, not a resource mine.

## D-005 — 2026-10-21 — Contributors use any coding agent; no pluggable AI opponents
- **Decision:** "Any agent" means contributors build the game with whatever coding agent they prefer. AI opponents are not a community plug-in surface.
- **Options:** pluggable "bring your own General" protocol and arena; agent-agnostic development only.
- **Reason:** owner's intent is a shared, fun creation process, not an AI-bot competition platform.

## D-004 — 2026-10-21 — Repo private until Gate 1, then public
- **Options:** public from Phase 0; after Gate 1; after Gate 2.
- **Reason:** visitors arrive to something playable plus a clear roadmap, while still early enough to join the journey.

## D-003 — 2026-10-21 — MIT license for code
- **Options:** MIT, Apache-2.0, GPL-3.0.
- **Reason:** lowest friction for contributors; keeps a future commercial release possible. Original assets will be CC-BY-4.0.

## D-002 — 2026-10-21 — TypeScript + PixiJS, browser-first
- **Options:** Unity (C#), Godot 4, web/TypeScript.
- **Reason:** code is mostly agent-written; a text-only stack can be built and tested fully from the terminal by any agent; playtests are a shareable link; LLM calls are plain HTTP; headless sim runs in Node. Steam later via Tauri/Electron.
- **Revisit if:** 300 units cannot hold 60 fps at Gate 1 (fallback: Godot).

## D-001 — 2026-10-21 — Scope for first playable
- **Decision:** single player vs AI; 15–25 min matches; 2 epochs; no multiplayer before Gate 4.
- **Reason:** prove the core loop is fun before adding long sieges, more epochs, or netcode.
