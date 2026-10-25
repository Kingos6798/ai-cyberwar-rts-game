# Dev Journal

The story of building this game, newest first. Wins, failures, surprises, and what the agents did well or badly. Anyone can add an entry.

## 2026-10-25 — Faction balance, measured again (#32)

- Issue #32 said the AI collapses under pressure (control beats AI boom 76%) and owns the control mirror (B 73%). On main today, over 80 seeds, those are 42% and 61%: the bot fixes since then did a lot. What's left on the faction side: the AI wins the boom and turtle mirrors (36% and 39% human wins) and has its first army out 29 s earlier.
- Fourteen stat variants, run in memory against the same bots and seeds as `npm run balance`. Buffing the AI (hp, cost) made things worse. Training humans 10-20% faster overshot so far that humans won the control mirror 72-80%. Just 5% faster put the boom and turtle mirrors back inside 40-60%, with B at 58%.
- Human rush vs AI turtle stayed at 2-21% in every sane variant, and the turtle bot folds to pressure as either faction. Those look like bot habits, not faction stats. Proposal 0003 has the tables; nothing changes until the owner plays it.
- Lesson: re-measure before fixing an issue that's a few days old. Half of #32's numbers had already moved.

## 2026-10-25 — A cloud General, bring your own key

- Owner decision (D-020): players without a GPU can play the LLM General through an OpenAI-compatible API, using their own key. The client is about 50 lines. The interesting part is everything around the key: kept for the session unless you ask to remember it, sent only in a header, never in a URL, log or error message, and errors are scrubbed in case a provider echoes the key back.
- One deliberate limit: the browser only talks to api.openai.com. If a link could set the API address, a shared link could quietly send someone's saved key to a stranger's server.
- Surprise: a wrong key in the browser doesn't show up as a 401. OpenAI's error replies have no CORS header, so the browser reports a bare "Failed to fetch". The General now says what to check and how to re-enter the key.
- Not yet run against a real model: there's no key yet. Default model and cost per match get measured with the Gate 2 head-to-head when there is.

## 2026-10-24 — Five words that cost 60 points

- After the General learned to mass its army, it lost to the control (33% vs 58%). Guessing didn't help: a prompt making the enemy core its default target changed where it attacked, but not how often it won.
- So, an ablation. Run the LLM but honor only some of its tools: attacks only 53%, plus build plan 17%, plus army mix 33%, plus training 23% (control 60%). The build plan was the culprit.
- Its plans were `3-4 workers, 0 racks, 0 defenses`, set early and kept. The tool said "Total workers to keep (you have workers.total)", and the model dutifully copied its starting count. Rewording it to targets ("about 8 workers and 2 racks; low targets starve your economy") got plans of 6-8 / 2 / 1-3.
- Result: 95% vs 58% over 60 seeds (+37), consistent across both halves. Gate 2's win criterion is met for real this time. The best fixed policy found, the control plus a 6/2/2 build plan, reaches 82%, so the model is adding judgment on top of a good economy.
- Lessons: measure before guessing (headless stubs answered "is it the mix? the rally?" in seconds each), and a hint in a tool description is an instruction to a small model.

## 2026-10-24 — The General learns to mass, and loses its lead

- Owner playtest (replay seed 88632): the owner built towers near the center, and the LLM General sent units at them one or two at a time. It built 64 units but never had more than 3 alive. Two causes. `attack_sector` sent every combat unit out every turn, so each fresh unit walked in alone. And the digest counted enemy strength from units only, so towers were invisible to its threat math.
- Fixes: `attack_sector` now sets a target, and the base masses a wave (the strategy's attack value), sends reinforcements in groups and regroups after a lost attack. Towers count as enemy strength. When the target changes, the marching army turns with it. "Attacking" your own core sector is rejected. The prompt says mass before you attack, at least twice the target's strength, and stick to one target.
- Then Gate 2 fell over. The old +17 was measured against a control that trickled exactly like the LLM. Now the control masses too: it always throws its full army at the enemy core. qwen3:8b went to 58% vs 58% (no gain), and after the stick-to-a-target fixes 33% vs 58% (−25). Turn logs show the model hopping between side sectors (N, S, C) while the control simply goes for the throat.
- Lesson: a benchmark is only as good as its baseline. When both sides share a bug, the comparison flatters the model. The new number is the honest one.

## 2026-10-24 — The AI that sat on 7,500 Data

- Two playtests against the training AI: a loss at 9:48, then a win at 17:03. Feeding the downloaded replays to `npm run replay` showed the AI ending the win with 7,500 Data it never spent.
- The obvious fix (more Training Clusters) would have done nothing: all production buildings share one pool of Compute. The AI was training on its core's 10 Compute alone. Now the training AI builds Server Racks when Data piles up, and regroups after its attack is wiped out instead of sending 3 units at a time into a standing army.
- Surprise: giving every strategy spare-Data racks broke the tournament. Rush snowballed and beat boom and turtle in 90–100% of matches, even with the threshold raised to 1,000 Data. So spare racks are a per-strategy switch, on for training only. Regroup got the same treatment: on for every bot it pushed the rush and boom mirrors out of 40–60%.
- Lesson: read the replay and the production rules before trusting the obvious fix, and run the balance check before trusting a "harmless" AI fix.

## 2026-10-24 — The General beats the control, head-to-head

- Three more bot experiments (attacking sooner, a safe opening, a second production building) helped the human side but never the AI side. They were discarded, and nothing was committed. I'd promised to stop if an attempt didn't clearly help, and stopping kept the work honest.
- Worse, the old bar had a ceiling: the control already wins 90% against our bots, so "beat it by 15 points" was impossible. New bar (D-019): the LLM plays the control directly. The control playing itself sets the baseline, which also absorbs faction balance.
- qwen3:8b, first run: 87% vs a 67% baseline (+20). A second 30 seeds came in at +13, a useful reminder that 30 seeds is noisy. Pooled over 60 seeds: 90% vs 73% (+17), 0 invalid orders out of 3,405, p95 latency 1.5 s. The 8B model clears the Gate 2 numbers, narrowly. The baseline is high because the AI faction wins the control mirror, so there isn't much headroom.

## 2026-10-24 — Why constant pressure wins

- Goal (D-018): scripted bots should hold off the attack-every-turn control. Traces showed why they don't. The control's first raid arrives around 1:00, kills workers at the outlying sites, and the bot's army waits at home, because it only defended within 12 tiles of its core.
- Kept: bots now defend workers, buildings and owned sites anywhere on their own half (`guardOutposts`; the gentle training bot is unchanged). The human rush bot now holds the control (90% down to 55%), and the rush mirror is fair (63% down to 50%).
- Tried and dropped, each measured: an army-first mode after a raid (no gain), bots that never attack (worse), defending by attack-move instead of focus fire (mixed), doubled static-defense damage (no gain).
- What's left is faction balance, not bot logic. In a plain boom mirror the AI side has its first army out about 45 s earlier (cheap, fast-building units), which lets it raid before humans can answer. And "boom economy plus constant attacks" beats "boom and wait" for both factions, so waiting to attack is the weak habit. Both bots also leave 5-7 workers idle once all sources are claimed.

## 2026-10-24 — The sim was quietly picking a side

- Chasing the unfair mirrors (D-018), I put identical units on both sides in mirrored positions. They should split 50/50, but the AI side won up to 62% (over 200 seeds).
- Two order bugs. Units act one at a time, and the AI's spawn later. A human unit would step into range, then an AI unit acting later in the same tick saw it already in range and fired first. Later units also knew which enemies had died earlier that tick, so they never wasted a shot. Now combat reads enemy positions and who is alive from the start of the tick. Identical fights split 44-54%, and exact mirror positions end in mutual destruction every time.
- Detective lessons: two of my probes were confounded (the random layouts changed with what I was swapping), and 40 seeds were too few: ±8 points of noise looked like a 30/70 bias. 200 seeds settled it.
- Fixing it barely moved the strategy mirrors (rush 63%, boom 30%, turtle 23% human wins). That gap is faction balance, not a sim bug: humans win short fights, and the AI wins long economic games.

## 2026-10-24 — The General's first wars, and a humbling control

- The LLM General played its first 30 full matches: qwen3:8b on the 3090 vs the scripted bots. The sim pauses while the model thinks, but each reply still costs its measured latency in game ticks. About 15 s of wall time per match.
- On paper it already passes the Gate 2 numbers: it wins 90% overall (80% vs boom, 90% vs rush, 100% vs turtle), with 0 invalid orders out of 1,725 and p95 latency 1.5 s.
- Then the control. A stub "brain" that only says "attack the enemy core" every turn, with no model at all, also wins 90% (90 / 80 / 100). The LLM's wins come from constant pressure plus the scripted bot running its base, not from its judgment. It did beat the scripted AI on rush (90% vs 40%), but so did the stub.
- Two lessons. First, the scripted bots wait too long to attack, so relentless pressure beats them; that is a weakness of our opponents, not a strength of the model. Second, "beats the scripted AI" is too easy a bar for Gate 2. A better bar is "beats the attack-every-turn control", ideally on harder opponents.

## 2026-10-24 — First words from a real General

- Ollama is installed and runs on the RTX 3090 (the 3080 Ti stays free for rendering). qwen3:8b answered every turn with schema-valid orders in about 0.6-1.2 s warm. The first call took 70 s because the model was loading, so the client now asks Ollama to keep it loaded for 30 minutes.
- The first replies showed what a small model misreads. It set `workers: 0` in every turn, reading "target worker count" as "workers to add". It countered the wrong units because the prompt never said which role each enemy unit has. And it ordered units it couldn't afford.
- Fixes: the build plan now says "total to keep" with a floor of 2 workers. The digest says where both cores are, our army's value, and the worker total. The prompt lists enemy units with the counter for each, plus four strategy lines. After that, no zero-worker plans in 9 live turns, and it picked the right counter where it had seen the enemy.
- It still attacks in most turns. Next: full matches against the scripted AI will show whether that's a problem or just aggression.

## 2026-10-24 — A line to a real model

- M2.4 (local half): the General can now talk to a model through Ollama. The reply is forced into the turn schema (structured output), the prompt is fixed per faction, and the only thing that changes turn to turn is the digest. A request that fails or times out just means the scripted bot plays that turn.
- The prompt came out at about 2,500 characters plus a 1,400-character digest: small enough for an 8B local model.
- Not yet tried against a live model: Ollama isn't installed on the dev machine yet. `npm run llm-turn` is the first thing to run once it is.

## 2026-10-24 — Thinking takes time

- M2.3b: the General's orders now land some ticks after it was asked, never on the same tick. It plans from a digest that is already a little old, and its orders are checked against the state when they arrive.
- A real LLM call (a Promise) applies at the first decision after it answers, and that wait is logged. Feeding those logged waits back as `latency` samples makes headless matches feel the same delay as live play, while staying deterministic.
- Next: M2.4, the Ollama / cloud client.

## 2026-10-24 — A General with a safety net

- M2.3: the General now plays whole matches. Every 20 s its brain reads the digest and gives orders; between turns the scripted bot runs the base, following the General's build plan and army mix. Attacks are the General's call.
- Neat test: a brain that never answers, answers garbage, or throws produces exactly the same command log as the plain scripted bot. The fallback is provably the scripted AI, not something close to it.
- Surprise: at the 120 APM cap the harness only applies about one command per decision, so a turn with five orders would have lost four. The General now queues its orders and releases one per decision, ahead of the scripted ones.
- Next: M2.3b (latency measured in ticks) and M2.4 (Ollama / cloud client), then the first real LLM match.

## 2026-10-24 — The General gets its orders

- M2.2: the LLM General now has a fixed set of tools (attack, defend, retreat, expand, train, build plan, army mix, rally, Pull the Plug for humans, taunt, wait). Tools are data, so one spec feeds Ollama, Claude and a single JSON turn schema.
- Model output is treated as hostile input: unknown tools, extra arguments and out-of-range numbers are rejected with a reason, valid orders in the same turn still go through. Taunts only ever reach chat, even when they contain JSON orders.
- Next: M2.3, wiring the directive into the scripted bot as the operational layer, with scripted fallback when a turn is invalid or late.

## 2026-10-23 — Public

- The repo is public. Before the flip: the history scan was clean, issue templates and six good first issues (#1–#6) were added, plus a DCO sign-off check, and a Code of Conduct contact. After: `main` requires pull requests with CI and DCO passing.
- Welcome. Start with `AGENTS.md` (hand it to your coding agent too) and an issue labeled `good first issue`.

## 2026-10-23 — Gate 1 passed

- After 17 playtests, the owner's answer to "do I want to play again?" was yes. Phase 1 is done.
- What got it there was mostly not balance numbers. It was making the game readable: Power and Compute rules explained, fog shading, strength readouts, engineer job feedback, dead-source warnings, and a post-match summary plus replays that turned every loss into a clear lesson.
- Next: make the repo ready to go public, then Phase 2, the LLM General.

## 2026-10-23 — Seventeenth playtest: defend, then counter, beats AI rush

- First match against `?ai=rush`: a win in 6:36. The rush AI took the center first (14.8 to 5.8 Data/s at 1:20). The owner retook it behind two Security Posts, and the AI's attack at about 2:20 broke on the defenses (its army 390 → 35 Data; the owner lost one Armored Vehicle). Then Router Choke again: `a_router_fwd` at 4:00, `a_router` at 5:00, AI income 0.
- The owner has now beaten all three AI strategies, each with a different approach: defensive (turtle), Center First / Router Choke (boom), and defend-then-counter (rush).
- AI note for later: from 3:00 the rush AI banked 500–740 Data it couldn't spend. A rush builds no Server Racks, so it was stuck at base Compute, feeding small waves into Security Posts. A smarter bot would add racks once it is banking.

## 2026-10-23 — Sixteenth playtest: the recipe holds (6:12)

- Another rush win against boom with the same recipe: center by 0:40, the router won by 2:40, AI drones dead, Router Choke (`a_router_fwd` at 3:40, `a_router` at 4:40, AI income 0).
- The AI didn't rebuild drones even with the new minimum-workforce rule: it spent everything on army and sat at 30–45 Data, just under a drone's 45-Data price.
- Remaining habit: Data banking (1,772 unspent at the end; Server Racks only after 4:40).

## 2026-10-23 — Fifteenth playtest: rush beats boom in 5:04

- Fastest win yet. The owner took both center sources and the center router by 0:40, retook the router at 1:20 and held it, killed all 7 AI drones by 2:40, and took `a_router_fwd` at 3:00 (Router Choke again). Income was 14.8 to 5.8 Data/s from 2:40. They built 4 Server Racks and 4 Security Posts this time, applying the earlier replay's lessons.
- The replay also showed an AI bot bug: with every drone dead and a human army on its half, the bot never trained another worker. Its rule "under pressure, train army only" never cleared, so it sat on 500 Data with no economy. Bots now keep at least 2 workers even under pressure.
- `npm run replay` now also reports buildings built and destroyed.

## 2026-10-23 — Fourteenth playtest: Router Choke (first replay analysis)

- Owner beat `?ai=boom` in 14:17 (at 0.5× speed) and saved the first replay. `npm run replay` told the story:
  - The center router changed hands about 10 times between 1:00 and 9:30. Every AI retake cut off the owner's center sources (`blocked`), and income fell from 13.8 to 5.8–9.8 Data/s.
  - The owner banked Data the whole match (2,700 unspent at the end) with Power to spare: training speed (Server Racks) was the limit, not money.
  - The winning move: taking the AI's own routers (`a_router_fwd` from about 10:00, `a_router` at 13:00). Every AI source was then blocked from its core and its income fell to 0. That is containment, the game's core theme, found by a player. Lore name: **Router Choke**.
- Owner asked for double-click to select all units of a type on screen (as in AoE). Added.

## 2026-10-23 — Thirteenth playtest: "a decent opening, but still lost"

- Lost a rush to boom in 6:42 (Data earned 1,722 to 3,825). The owner's income came online at about 1:50 and stuck at about 6 Data/s, so the center source probably never fed the base: unconnected fiber, or a center router held by the AI (an enemy router doesn't forward your traffic). The summary couldn't tell which.
- Two additions so this can't stay hidden:
  - Dead-source warnings. The economy records each source's actual flow; `sourceIssue()` explains a shortfall (no fiber, no route home, blocked by an enemy router, or throttled by a full link). Shown as a red cross on the map, a line in the intel panel, hover text, and the text view.
  - Save replay. The summary offers the match as a file; `npm run replay -- file.json` re-runs it and prints a timeline. On a bot match it immediately showed the suspected failure: a center source marked `blocked` once the AI retook the center router.

## 2026-10-23 — What are my engineers doing?

- Owner: "it's frustrating to just see them sitting there with no visual feedback, so I end up moving them off a capture or connect fiber task." That was costly, because claim and fiber progress belong to the worker: a new order resets them.
- Now each worker's job is in the view (`src/sim/jobs.ts`: kind, target, working or walking, percent, seconds, contested). On the map: a progress ring around a site being claimed (pulsing orange when an enemy contests it), fiber lighting up from the end being worked, a faint line while walking, and a yellow marker over idle engineers. The selection panel lists each engineer's job and warns that a new order resets progress; the intel panel sums them up ("2 claiming · 1 connecting fiber · 1 idle"); hover text names the job.
- New test URL options, so agents can see the game mid-match: `human=<strategy>` (a bot plays the human side), `autostart`, `skip=N` (fast-forward).

## 2026-10-23 — Why rush keeps losing to boom

- Owner: "without at least some defensive play, I'm losing in rush v boom consistently." The bot data agreed: AI boom was the strongest strategy (65–69% overall).
- A deeper look (rush bot against AI boom, 20 seeds): the rush bot wins 14/20, because it takes the center Data sources first and out-earns boom by 2:00. AI boom builds a Sentry Gun at 0:12, and 50–80% of the rusher's losses happen near it. Pull the Plug silences it, but nothing tells the player.
- Tried and reverted: making boom build its turret at 2:30 instead. AI boom got stronger (73% overall; rush won 11/20), because the turret's 60 Data went into economy instead.
- Applied, with owner approval: Maintenance Drone cost 42 → 45 Data (work 1800). AI boom 69% → about 61%; human boom becomes viable. DATA_VERSION 11.

## 2026-10-23 — Twelfth playtest: closer, then one bad fight

- Lost to boom in 9:40, but with a clearly better economy and production than last time: Data earned 4,029 to 6,103 (1.5× behind, down from 2×), and 0:43 idle while units were affordable (down from 1:47).
- Armies were even (about 400 Data each) until a fight around 5:20 that the owner lost at about 435 against 550. The AI then camped the base and killed every new unit as it came out: 25 trained, 25 lost.
- A trend Gate 1 wants to see: each loss is closer, and the cause is clear and actionable.

## 2026-10-23 — Eleventh playtest: Center First is fragile

- Lost a rush against boom in 7:21. The AI earned 4,535 Data to the owner's 2,225. The owner's income ramped slowly: none until 1:00, one source until 2:30, about 10 Data/s only after 5:00. In the Center First win it was about 7 Data/s by 2:30. On top of that, 1:47 of idle production while units were affordable, and 13-for-13 unit trades that lost Data because human units cost more.
- The summary misled again: "Turning point: from 5:35 the AI out-earned you", when the AI had led almost the whole match apart from a brief dip. Turning points are now reported only for real comebacks; when one side led at least 80% of the time, the summary says so ("the AI out-earned you for 91% of the match").

## 2026-10-23 — Tenth playtest: center-first beats boom

- After three losses to `?ai=boom`, the owner won with their own plan: claim the two center Data sources first, then work back to connect everything. Data arrived later, but taking the center starved the AI's economy, and the rush held.
- That is the first strategy found by a player rather than suggested by the game or by us: a candidate for the lore system (Tenet 5). Name it "Center First".
- The summary told the wrong story for this win: both insight lines described the slow Center First opening, not the turnaround. Behind early, the owner out-earned the AI from about 3:00 to the end (6,992 Data to 3,880); the AI lost all 31 of its units. Added a "turning point" line (from when one side out-earned the other for good), and split idle production into "could afford a unit" (real slack) and "not enough Data" (starved).
- Gate 1 status: wins with two different approaches (defensive against turtle, Center First against boom), and every loss had a reason the owner could act on. That covers the D-015 skill and strategy criteria. Remaining: "do I want to play again?" and the 300-unit/60 fps check, which passed earlier.

## 2026-10-22 — Ninth playtest: the summary explains a loss

- Lost a rush against boom in 5:26 ("the AI is mass producing units at a rate I can't compete with"). The new summary said why. From about 1:15 the AI made 15 Data/s to the owner's 6: it held both center Data sources and its expansions, the owner only their home sources. It earned 3,838 Data to 1,619. The owner lost all 14 units while killing 4 of 38, and the SOC sat idle for 1:56.
- So it was economy, not unit spam. The game is behaving as designed; the lesson is to contest the center early and raid enemy workers.
- Summary fixes: "biggest gap" divided by a zero army ("1810.0×"). It now says "you had no army; the AI's was worth 1810 Data". A new economy line reports when the AI's income stayed 1.5× yours for a minute, and how many Data sources each side held.

## 2026-10-22 — Eighth playtest: a post-match summary

- Another rush loss against boom: "the AI had many more armor and ranged units than I did around 2:50." In bot matches, boom is normally behind a rush at 2:50 (45–195 Data of army against 160–260). So the likely causes were production gaps, plus AI units being cheaper (more bodies for the same Data). Neither of us could see which.
- Added a post-match summary: who won and when, the moment the AI's army was furthest ahead, totals (Data earned, combat units trained and lost, biggest army, time production sat idle), and army-value and income charts for both sides with hover readouts. Stats live in `src/harness/stats.ts` (no DOM), so headless runs and LLM benchmarks can use them later.
- Owner also asked for a counter on construction. The bar under unfinished buildings was showing their HP, not progress. It now shows real progress. The selection and intel panels say "Building: 45% · 8s (2 engineers)", or warn when no engineer is assigned, and the text view carries the same.

## 2026-10-22 — Seventh playtest: crushed rushing a boom

- Owner tried a rush against `?ai=boom` and lost badly. Their own diagnosis: "I should have been more aggressive with attacks. By the time I got moving, the AI had way more heavy units and I had no counter."
- A loss with a clear reason meets the Gate 1 "better play wins" criterion. The counter they were missing was the Red Team (double damage against tanks). Open question: did they see the counter hint in the intel panel?
- Also "data starved, even with 3 SOCs". Two hidden rules: training speed comes from one shared Compute pool, so extra SOCs add nothing (only Server Racks do); and the two home sources give only 4.8 Data/s. Owner chose to keep the pool and explain it. The SOC and Server Rack tips, and the Compute tooltip, now say so; the SOC button warns when you already have one; and hovering a Data source shows its rate.

## 2026-10-22 — Sixth playtest: first win against a strategy AI

- Owner beat `?ai=turtle`, the first win against a full-strength strategy bot.
- Asked for a countdown to the next unit. Production buildings now show a training bar on the map. The selection panel and intel panel say "Training Red Team: 6s (+2 queued)", or "waiting for Power". The text view carries the same, so LLMs get it too.

## 2026-10-22 — Fifth playtest: faster win, ready for the real AI

- Owner won again against the training AI in 16:07, down from 23:56, playing conservatively and managing Power and units better. Getting faster once a rule makes sense is what Gate 1 means by "better play wins".
- Unit spacing, the strength readout and fog shading all helped. The Power cap never came up.
- "Play again?": ready to face the strategy AIs (rush, boom, turtle). Those matches decide the rest of Gate 1.

## 2026-10-22 — Fourth playtest: first win, 23:56

- The owner beat the AI in 23:56, a length that felt about right. Correction: with no `?ai=` in the URL the game uses the gentle training opponent, so this was a win against training, not the full-strength bots.
- What won it: defenses held, the right counters, and out-expanding the AI. Three different systems mattered, and two of them are new this session (defenses and expansions).
- "Play again?": maybe. Gate 1 needs a clear yes; finding out what's holding it back is next.
- What held it back: "I couldn't build any more armor or fast units, but I had plenty of Data." They had hit the Power cap, and nothing said so. Finished units waited silently and the Train buttons kept taking Data. Now the Power counter shows FULL, an alert fires, the Train buttons explain why they're disabled, and the text view marks `FULL` for LLMs.
- Owner kept the Power cap ("I just didn't understand it as a game rule"). Also hard to read: overlapping units, the enemy's strength, and what was fogged. Fixes: units spread apart; the intel panel shows an army strength for each side (Data value scaled by health) with a verdict; fogged ground is shaded.

## 2026-10-22 — The skill gate and the limits of scripted bots

- Bots attacked once their army reached N units. Human units cost about 1.6× more, so in boom matches the human army never reached the threshold and never attacked. The AI won by attrition. Bots now attack by army value in Data. Sloppy mirror matches went from 68/13/73% to 58/34/60% human wins.
- The skill test mixed in counter-building, which changes the build. Gate 1 says "better micro with identical builds", so the test now measures focus fire only. Counter-building turned out to hurt humans in boom anyway: Adaptation stacks resistance against whatever kills AI units, so massing one counter backfires. That is working as designed.
- Tried and dropped: split fire, fire distribution, kiting, regrouping, retreating wounded units, and denying the sloppy side Pull the Plug. None gave a consistent gain.
- The numbers are fragile. Raising rush's attack threshold from 250 to 300 Data dropped rush skill from 70% to 49%. With bots this crude, 40 seeds can't tell a 65% line from noise.

## 2026-10-22 — Third playtest: "botnets destroyed all my engineers"

- As soon as attacks started, Botnet Swarms flew straight to the human engineers. The owner asked whether botnets can travel off the network. They can, and that bends reality: hijacked drones need a control link.
- Prototyped a signal-range rule behind a flag (`docs/proposals/0001-signal-range.md`). It works as intended, but it crushes the AI's rush (2–16% overall). The next idea to try is mesh swarms: drones relay signal for each other.
- Three rounds later (hard leash, mesh swarms, soft autopilot), every version crushes the AI's attacks, because the AI always fights in the human base, out of its own signal. Lesson: a rule that limits where one side can fight is a rebalance of that side, not a tweak. Shelved behind its flag until Phase 3.

## 2026-10-22 — Defenses, expansions, and one number that mattered most

- Owner approved two design changes: static defenses (Security Post / Sentry Gun) and expansion sites. Rushing had no answer, and booming had no payoff.
- They flipped the meta more than once. Rush dominated, then boom did, then rush again. With 20 seeds, results swung ±20 points from small changes, so tuning now uses 40.
- The biggest lever was the AI worker's price. At 35 Data the AI out-expanded humans in every mirror match; at 50 humans did. 42 lands both sides close to even (mirror matches 53/53/59%).
- A trap: a mirror match one faction always wins makes the skill test read exactly 50%, whatever the skill. Faction parity has to come before skill tuning.
- Bot lesson: guarding the core was useless. Rushes kill workers out at the Data sources, so bots now put defenses next to their most exposed source.

## 2026-10-22 — Balance: the bots were fighting their own lag

- The AI side won most strategy matchups. Most of it turned out to be bot bugs, not unit stats:
  - At the APM cap a bot gets about one action per decision. A defending bot re-issued the same attack order every decision, so it never trained units or sent workers out while under attack.
  - A bot sees the world a reaction delay late, and that delay equals its decision interval. So it repeated every order once, wasting half its actions. In the opening it trained two workers instead of one. That left humans 30 Data short of their first production building, while the AI's cheaper drones left it room.
  - Fixes: bots remember orders and spending that aren't visible yet, give production priority over worker jobs, and stop growing the economy when a bigger enemy army is on their half.
- Tuning: starting Data 200 to 260, so both sides can afford a worker, a production building and a first unit. Adaptation 5% per death (cap 40%) to 3% (cap 25%): with the old values the AI won every long mirror match.
- Result: AI rush overall 90% to 73%; mirror matches now 40–50%. Skill test 25–55% to 58–70%.
- Still failing: rush beats boom every time, for both sides. Workers don't add income (Data comes from a fixed set of sources that 4 workers can claim), and nothing gives a defender a home advantage. Both are design questions for the owner.

## 2026-10-21 — Second playtest: more fun, still lost at 8:43

- Owner reached step 3 (economy + a SOC) but had almost no army when the first attack came, and couldn't read the fights.
- Added: alerts and map pings when AI forces are spotted on your half or near your buildings, and when a building takes damage; shot lines between fighting units; hit flashes; death markers; an intel panel listing visible enemy units with the counter to build; a shape legend.

## 2026-10-21 — First playtest: "I have no idea how to play"

- Owner's first session: 120 fps with 300 units (performance gate passed), but the game was unplayable for a newcomer. Everything lived behind hotkeys listed in a collapsed panel.
- Fixes: a clickable command card for the current selection (with costs, and tooltips explaining what each unit counters), a getting-started checklist that ticks itself off, hover tooltips for every map object, a "Connect fiber" button, a start screen with the goal, and a gentle `training` opponent (no attacks before minute 8) as the default.
- Lesson: an agent can verify rules with tests, but only a human can tell you the game is confusing. Playtest early.

## 2026-10-21 — Playable greybox

- The browser build works: `npm run dev`. Select, move, claim sites, light links, build, train, Pull the Plug, and fight a scripted AI.
- The UI has no special powers. Every click becomes a command from the same API the AI uses. Press `T` to see the text view an LLM General would read.
- `?stress=300` spawns 300 fighting units with an FPS counter for the Gate 1 performance check.

## 2026-10-21 — The balance harness finds bugs before balance

- Built `npm run balance`: equal-cost duel matrix, strategy tournament, skill test.
- Unit counters work (every counter wins 75–100% at equal cost).
- Matches were lopsided, and most of the cause was not unit stats. The harness exposed fairness bugs in the engine and bots:
  - Units acted in creation order. Humans spawn first, so human units always fired first, and AI units killed that tick never fired back. Now every unit alive at the start of a tick acts (simultaneous combat).
  - Units searched for targets on ticks staggered by unit id, so one side spotted the other first. Now everyone searches on the same ticks.
  - Two workers claiming the same site: whoever was processed first won. Now the site is contested and nobody progresses until one side leaves (or dies).
  - Both bots raced for the same equidistant site because of alphabetical tie-breaks. Now ties break by which side of the line between the bases a site lies on, so bots make mirror-image choices.
- Lesson: with a deterministic sim, "the human side wins 90%" is often an ordering bug, not a stats problem. Test fairness before tuning numbers.
- Gate status: counters pass; strategy and skill gates still fail (the AI side now wins most matchups). Tuning continues.

## 2026-10-21 — Five tenets and a hard look at the plan

- Owner set five tenets: AI-integrated development, human + LLM control in one package, test-driven, balance above all, many paths to victory.
- Reviewing every doc against them turned up real holes. The biggest: "same commands for humans and LLMs" didn't hold when the LLM gave strategic orders and humans clicked units. Fix: one layered command API that everyone can use.
- Also caught before writing game code: floats would break cross-machine replays, an LLM's thinking time would vanish in headless sims, and Adaptation could make the AI unbeatable. All now designed out.
- Added CI with a performance budget, CODEOWNERS, and DCO sign-off for agent-written code.

## 2026-10-21 — Gate 0: pillars locked

- New rule: every term must act like the real thing. That reshaped the draft: Bandwidth stopped being a currency and became link capacity, routers became passive junctions you capture, Firewall became a wall instead of a tank, and Crawler became the AI's worker.
- Hybrid economy: data streams home over links; workers build the network instead of hauling resources.
- Pull the Plug vs Adaptation approved as the heart of the game.
- Next: Phase 1, the playable greybox.

## 2026-10-21 — Day zero

- Started from a brainstorm with Gemini about a cyber-themed RTS against an LLM opponent.
- With Claude Code: wrote the roadmap (phases, gates, decision framework), chose TypeScript + PixiJS over Unity because the code will be mostly agent-written and a text-only stack is easier for any agent to build and test.
- Decided to go open source (MIT), public after the first playable greybox.
- Scaffolded the repo: deterministic sim stub, headless runner (`npm run sim`), determinism tests, PixiJS window.
- Next: agree on the design pillars (Gate 0).
