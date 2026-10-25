# AGENTS.md

Instructions for any coding agent (Claude Code, Codex, Cursor, Copilot, Aider, …) and for humans. This file is the single source of truth; tool-specific files only point here.

## Project

Open-source 2D real-time strategy game. Humans fight an AI faction, commanded by an LLM "General", for compute, bandwidth, and data in a cyber world. **Read `docs/TENETS.md` first**: every change must serve those five tenets. Roadmap: `docs/ROADMAP.md`. Design pillars: `docs/PILLARS.md`. World and story: `docs/NARRATIVE.md`. Past decisions: `docs/DECISIONS.md`.

## Stack

- TypeScript (strict), Node >= 22.18 (runs `.ts` directly), Vite, Vitest.
- PixiJS v8 for rendering.

## Layout

| Path | What lives here | Rules |
|---|---|---|
| `src/sim/` | Deterministic game simulation | No DOM, no PixiJS, no `Math.random()`, no `Date`/wall-clock time. Randomness only via the world's seeded `Rng` (use `rng.int`). Game state uses integers / fixed-point only, never floats, so replays match on every machine. |
| `src/render/` | Drawing and input | Reads sim state; never mutates it directly. Player actions become commands applied by the sim. |
| `src/harness/` | Headless match runner, fair-play pacing (APM cap, reaction delay) | Controllers only get `factionView` and issue commands. |
| `src/ai/` | AI opponent (scripted and LLM) | Talks to the sim through commands only. Obeys the APM cap and reaction delay. Must tolerate invalid or slow LLM output. Player chat never becomes commands. |
| `scripts/` | Node CLI tools (headless sim runner) | |
| `tests/` | Vitest tests (`*.test.ts`) | |
| `docs/` | Roadmap, pillars, decisions, journal | |

## Commands

```sh
npm install
npm run dev        # play in browser at the printed URL
npm test           # unit + determinism tests
npm run typecheck
npm run sim -- --matches 10 --human boom --ai rush   # headless bot matches, prints win rates
npm run sim -- --matches 1 --verbose                 # also print each side's text view at the end
npm run sim -- --matches 5 --max-ms 10000          # fail if any match exceeds the time budget (CI)
npm run replay -- replay.json --every 15            # re-run a saved match (summary's "Save replay") and print a timeline
npm run balance -- --seeds 40                       # duel matrix + counters (--gate exits 1 on failures); tournament and skill test print warnings
npm run llm-turn -- --model qwen3:8b               # one LLM General turn against a local Ollama model (needs `ollama serve`)
npm run llm-match -- --model qwen3:8b --human control --matches 30 --with-control   # Gate 2 bar (D-019): LLM vs the control head-to-head, plus the control-vs-control baseline
npm run llm-match -- --model qwen3:8b --matches 30 --with-control   # secondary: LLM General vs every scripted bot, plus the control on the same seeds
npm run llm-match -- --control --matches 30                         # control only (attack every turn, no model)
npm run build
# Visual checks: with `npm run dev` running, open (or screenshot headless) e.g.
# http://localhost:5173/?seed=3&human=boom&ai=turtle&autostart&skip=40
# human=<strategy> lets a bot play your side, autostart skips the start screen, skip=N fast-forwards N seconds.
# Play the LLM General (needs `ollama serve`): http://localhost:5173/?ai=llm&model=qwen3:8b  · blind test: ?ai=blind
npm run shot -- "http://localhost:5173/?seed=3&human=boom&ai=turtle&autostart" shot.png --wait 20   # headless screenshot after 20 s of real time (needs `npm run dev`); prints page errors, exits 1 if the page threw. Chrome/Edge/Chromium, or set BROWSER_PATH
```

## Definition of done

1. One logical unit of work per PR, matching the issue's acceptance criteria.
2. Test first: new behavior ships with a test; a bug fix starts with a failing test.
3. `npm run typecheck` and `npm test` pass (CI enforces this).
4. Determinism kept: same seed + same commands = same result.
5. Gameplay changes: run `npm run sim`. Stat changes: include before/after balance numbers in the PR.
6. Every player action goes through the layered command API (unit orders + high-level orders), so humans and LLMs use the same controls. No UI-only or AI-only shortcuts.
7. Small PR: soft limit ~400 changed lines, excluding data files and lockfiles. Split bigger work.
8. Commits signed off (`git commit -s`, DCO).
9. Anything saved to disk (replays, saves, AI memory, lore) carries the game + data version.

## Conventions

- Imports use explicit `.ts` extensions (`import { step } from './world.ts'`).
- Prefer plain data + functions over classes in `src/sim/`.
- Unit and building numbers live in one data file, never hard-coded in logic.
- Keep files small and single-purpose so an agent can load them whole.
- Grounding rule: every in-game term must behave like its real-world counterpart (see `docs/PILLARS.md`). Flag anything that bends reality.
- Design changes (resources, units, win conditions) need an entry in `docs/DECISIONS.md` and owner approval.
- Never commit secrets. API keys go in a local `.env` (gitignored).
- Notable wins, failures, or surprises while building: add a short entry to `docs/JOURNAL.md`.
