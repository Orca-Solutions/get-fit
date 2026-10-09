# Training logic: "strange periodization", made explicit

The rules get-fit's plan generator follows, with the research behind them. The numbers live in `STRANGE_PERIODIZATION` (version 1.0.0) in [`packages/core/src/program.ts`](../packages/core/src/program.ts); the method (rotation, balancing, fallbacks) lives in [`packages/core/src/generator/`](../packages/core/src/generator). Code comments cite this document by section number, so keep the numbering stable.

Each rule below is implemented unless it is marked **Not yet implemented**. Those are collected in [§4.8](#48-not-yet-implemented).

The program was built and tuned for one lifter, captured in the core's `referenceProfile()`: a beginner aiming for muscle, about 6 ft and 168 lb, who runs 2 miles every morning, trains at a Planet Fitness-style gym (Smith machine, no free barbells) and does core work at home with bands, kettlebells and an ab wheel. Where a rule depends on that setup, it says so.

## Background: Anatoly and AnatolyFit

**The man.** "Anatoly" is the on-screen persona of **Vladimir Shmondenko**, a Ukrainian powerlifter born in 1999 who grew up on a farm and began training at 15 in a homemade gym built "from old tractor parts, car wheels, and bricks" [13].
- **Competition:** as a junior he won the Kyiv Cup in 2017 and 2018 and took bronze at the 2018 GPA Worlds (teen 18–19). He competed at about 74–79 kg bodyweight [13][16].
- **How he got famous:** his straight training videos went nowhere for three years. Fame came in 2019 with the prank format: he poses as a frail-looking gym janitor, then casually lifts enormous weights with a 32 kg mop and bucket [13][15].
- **Since 2022:** he left Russia for Dubai after the invasion, switched to English-language pranks, and grew to tens of millions of followers. He trained with Arnold Schwarzenegger in July 2025 [13][15].
- **Size:** about 180 cm and 78 kg [13][14].
- **Lifts:** his brand claims gym bests of 320 kg deadlift, 225 kg squat and 150 kg bench [14][16]. Wikipedia lists 290 / 210 / 150 [13]. His best *competition* lifts are much lower: 245 kg deadlift, 150 kg squat and 122.5 kg bench [16]. Treat the gym numbers as marketing.

**His philosophy, in his brand's own words.** The persona rests on being strong without looking big. The blog says he "wanted to be strong" rather than pursue size, and credits technique, coordination and "generating force in complex positions" for his strength [14]. It also says plainly that "strength and size don't always increase at the same rate… muscle growth is significantly influenced by the total volume of hard work" [14]. Three statements map directly onto this document's rules:
- **Two kinds of periods.** "During more intense periods, athletes use more working sets, fewer repetitions, and a gradual increase in load; in less intense periods, incorporate a wider variety of exercises and reduce the weight on the barbell." [17] This is the closest thing to a published definition of the method. Heavy periods narrow the exercise list and push load; lighter periods widen the exercise list and back off load.
- **Form decides the load.** "Add weight as long as your form remains stable; maintain it when your form becomes unstable; reduce the load when fatigue begins to affect your movement." [17] This is autoregulation, and it shapes the progression rules in §4.4.
- **Small steps, earned.** "You don't add a new weight plate to the bar just because a new week has started." Steps are 1.5–2.5 kg [17].

**The products.** Several Anatoly-branded products exist, and it isn't clear which ones he runs day to day:
- **anatolyfit.com:** a Dubai-based web subscription. In June 2026 it relaunched its program as "APS" (Anatoly's Power System), described as a weekly-refreshing personalized plan, and claims 90,000+ users [2][15][20]. On Trustpilot it scores 2.6/5 from 23 reviews; 70% of reviews are one-star, citing refund refusals, generic plans, missing progression guidance and, for a while, no phone app [3].
- **"Anatoly Fitness":** an Android app published by Saasfactory LLC, rated 2.9 stars [18].
- **shmondenkovladimir.com:** his own site, selling fixed 1–16-week PDF and video programs [19].

**How this shapes the design (inference).** Anatoly's own method is a powerlifter's method: heavy top sets, alternating intensity periods, load earned by form, and a small exercise menu built around three competition lifts. AnatolyFit wraps that in a weekly-regenerated, general-population plan without exposing its load logic or the user's history. For a beginner whose goal is muscle, the useful parts are:
- the heavy/light alternation, with variety concentrated in the lighter periods
- form-gated small increments
- the heavy-set-then-volume session shape

What get-fit doesn't copy:
- powerlifting specificity (heavy singles and doubles from day one)
- the opaque regeneration

## 1. What AnatolyFit actually publishes

There is no published spec called "strange periodization." The phrase does not appear in AnatolyFit's materials or in the sports-science literature (searched 2026-10-07). What AnatolyFit does say publicly:

- **Phases alternate between heavy and volume work.** "One phase is aimed at developing strength under heavy loads. The other focuses on increasing volume." [1]
- **Each session starts with one heavy, low-rep set and then builds volume.** "The workout begins with a 1×2 set, and the remaining exercises are used to increase the volume." Secondary lifts run 4×6 to 4×12 and accessories 3×10 to 3×15. [1]
- **Anatoly's own week:** Monday legs; Wednesday chest & biceps; Friday back, triceps & shoulders; Saturday cardio. Grip, wrists, abs and core are trained separately or tacked on. [1]
- **Weight goes up in small steps, and only with clean form.** "An increase in weight of 1.5–2.5 kg is considered progress if form remains consistent." Sets or exercises get added before weight does. [1]
- **Exercise variety goes up when load goes down.** Lighter periods "incorporate a wider variety of exercises and reduce the weight on the barbell." [17]
- **The plan refreshes every week.** "New plan every week… progressive overload built in." Sessions are shown as set and exercise counts, for example "17 Sets | 6 Exercises." [2]
- **The app knows too little about the user's history.** Reviewers say it gives "no recommended weight increases… and no transparent overview of previous training data," and some got lopsided splits, such as two leg days and one upper day. [3]

**Inference:** the "strange" feel is most likely three things stacked together. Rep ranges change from session to session (undulating periodization). The movement chosen for a muscle changes from week to week, and changes most in lighter periods (conjugate-style variation). And the plan is regenerated weekly with no visible logic behind it. Each of these is a known method; AnatolyFit just doesn't show the rules. This document writes them down.

## 2. What the research says about each lever

| Lever | Evidence | What get-fit does with it |
|---|---|---|
| Undulating rep ranges vs. fixed (linear) | For hypertrophy, the method doesn't matter much when volume is equal [4][5]. For strength, undulating beats linear, but mostly in trained lifters (ES 0.61); in beginners the gap is near zero (ES 0.06) [5]. | Undulate, because it keeps training fresh and costs nothing. Don't expect magic: volume and progression drive growth. |
| Rep range | Hypertrophy is similar from about 6 to 30 reps when sets are taken close to failure. Strength is best with heavier loads [6]. | Three zones: heavy, moderate, light. All three build muscle, and the heavy zone also builds strength. |
| Weekly volume | More sets give more growth, with diminishing returns. Strength plateaus sooner than size. Indirect work counts for about half a set [7]. | Count sets per muscle, with indirect sets at 0.5, against a target band per muscle. |
| Frequency | Once volume is equal, frequency matters little for size and somewhat for strength [7]. | The default split trains each muscle directly once a week. Arms also get indirect work on the other upper day. That costs little for size. |
| Exercise variation | Systematic variation helps regional growth. Random or excessive rotation hurts [8]. | Rotate on a schedule, a few exercises at a time, within movement families. Never shuffle randomly. |
| Effort (RIR) | Reps in reserve (RIR) is a valid way to set effort [9]. | Prescribe by RIR and log an optional one-tap effort rating. |
| Deloads | Deloads are commonly pre-planned every 4–8 weeks by reducing volume, effort or frequency. They can also be triggered by fatigue [10][11]. | A planned deload in week 4 of each block. |
| Daily running | Concurrent training slightly blunts growth of type I muscle fibers, and running blunts it more than cycling (SMD −0.81) [12]. | Runs stay outside the app and are never scheduled or changed. Running first thing and lifting later already separates the two; the plan keeps leg-day fatigue moderate. |
| Core periodization | No good trials compare periodized and fixed core training. Core muscles respond to overload like any other muscle, and core work is low-fatigue (inference). | A light version of the same wave; see §4.2, Core day. |

## 3. The default schedule and settings

The default schedule comes from `neutralProfile()` and `referenceProfile()` in [`packages/core/src/profiles.ts`](../packages/core/src/profiles.ts):

| Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|
| **Chest & biceps** (gym) | — | **Legs** (gym) | — | **Back, triceps & shoulders** (gym) | **Core** (home), Saturday or Sunday | |

- The upper-body pairing is Anatoly's own published split: chest and biceps, then back, triceps and shoulders, with grip, wrists and abs done separately [1]. The two days barely overlap, yet arms are hit twice: biceps directly on Monday and indirectly through Friday's rows, triceps directly on Friday and indirectly through Monday's presses.
- Legs sit midweek so a weekend long run doesn't land the day before leg day.
- The core day is a Saturday–Sunday window: either day counts, and it isn't missed until Sunday ends.
- Runs are not part of the plan. The generator never schedules, moves or adjusts them.

**Session size:** 6–8 movements and usually about 17 working sets, ranging from about 12 to 22 (a lifting session is capped at 8 movements and 22 sets, grip finisher aside). Sessions run roughly 55–75 minutes. The core day runs 16 sets in about 30–35 minutes, as supersets.

**Other defaults:**
- **Goal:** muscle first, strength second.
- **Gym:** the reference profile's gym is a Planet Fitness: no free barbell, trap bar or deadlift platform. Squats, deadlifts and presses are done on the **Smith machine**, from block 1. The gym also has dumbbells, cables, a leg press, a hack squat, hip adduction and abduction, and assisted pull-up and dip machines. Equipment per location is part of the profile, and the generator only picks what a day's location has.
- **Home:** resistance bands with a door anchor, an ab wheel, and kettlebells (the reference profile has two 25 lb and one 35 lb).
- **Units:** lb.

## 4. The generator, as rules

### 4.1 Building blocks

- **Block:** 4 weeks, made up of 3 loading weeks and 1 deload week. A block is the unit for exercise rotation. The app always keeps the current block and the next one planned.
- **Session template:** an ordered list of **slots**, each defined by movement attributes, not by exercise name. Every slot has a role:
  - **P** (primary compound)
  - **C** (secondary compound)
  - **I** (isolation)
  - **V** (variety: an extra movement that appears only on lighter days)
  - **G** (grip finisher) and **K** (core) for the finishers and the core day
- **Zone:** each lifting day has a zone for that week. The zone sets the reps and, following Anatoly's two kinds of periods, the session's shape. Heavy days have fewer movements and more sets each; light days have more movements and fewer sets each, so variety widens as load drops [17].

| Zone | Compound reps | Rest (compound / other) | Movements | Typical sets |
|---|---|---|---|---|
| **H** (heavy) | 5–8 (block 1: 6–8) | 2.5 min / 1.5 min | 6 base slots | 18–22 |
| **M** (moderate) | 8–12 | 1.75 min / 1.25 min | 6 base slots + 1 V + grip | about 17 |
| **L** (light) | 12–20 (block 1: 12–15) | 1.25 min / 1.25 min | 6 base slots + 2 V + grip | about 16–19 |
| Deload | the moderate ranges, at reduced load | 1.25 min | 6 base slots | 12 |

Grip finishers rest 1 minute and core sets 45 seconds.

Sets per slot:

| Role | H | M | L | Deload |
|---|---|---|---|---|
| P | 4 (block 1: 3) | 3 | 2 | 2 |
| C | 3 | 3 | 2 | 2 |
| I | 3 | 2 | 2 | 2 |
| V | — | 2 | 2 each | — |
| G | — | 2 | 2 | — |

- **Isolation and variety slots ignore the zone's compound rep range.** They run 10–15 reps on H and M days and 12–20 on L days.
- **A movement's own limits win.** Every catalog entry has a sensible rep range, and a slot's reps clamp into it, keeping a window of at least 2 reps (for example a split squat on an H day runs 8–10, and an assisted pull-up on an L day 10–12).
- **Light-day stand-ins:** Romanian deadlifts and other axial hinges are never programmed on an L day. The generator swaps in a hip-extension or hinge-variant movement instead, such as a back extension or a cable pull-through.
- **Anatoly-style top set:** from block 3 on, the P slot on an H day opens with one set of 3–5 reps at RIR 2, followed by its other sets.
- **Volume ramp across blocks:** from block 3 on, heavy days add one set to an isolation slot per block (block 3: one slot, block 4: two, block 5 onward: three). A block that follows one where any session was marked "beat up" skips the ramp.
- **Grip & forearm finishers:** the M and L days end with a 2-set grip or forearm finisher (about 4 minutes). The H day, already the biggest session, gets none, and neither does a deload week. The finisher always comes last, so pulling work is never done with tired hands. It rotates through the grip families from session to session:
  - support (dead hang, farmer's carry)
  - crush (thick-handle hold)
  - pinch (plate pinch)
  - wrist flexion
  - wrist extension
  - pronation/supination
  - reverse curl
- **Weekly effort ramp:** week 1 at RIR 3; week 2 at RIR 2; week 3 at RIR 2 for compounds and RIR 1 for everything else (compounds never go below RIR 1); week 4 is a deload at RIR 4 or more.

### 4.2 Day templates and how muscle groups rotate

Each lifting day has 6 base slots, which keep the same exercises for the whole block, and a variety pool that the V slots draw from:

| Slot | Mon: Chest & biceps | Wed: Legs | Fri: Back, triceps & shoulders |
|---|---|---|---|
| 1 · P | horizontal press, flat | squat pattern, bilateral | vertical pull |
| 2 · C | horizontal press, incline | hinge, bilateral | horizontal pull |
| 3 | (I) chest fly | (C) single-leg, knee-dominant | (C) vertical press |
| 4 · I | elbow flexion, supinated | knee extension | shoulder abduction (side delt) |
| 5 · I | elbow flexion, neutral grip | knee flexion | elbow extension, overhead (stretch) |
| 6 | (C) chest press variant, a different family from slots 1–2 (machine press or assisted dip) | (I) calf | (C) row or pullover, a different family from slot 2 |
| V pool | stretch-position curl; another curl angle; chest press variant | hip extension; hack squat or leg press; hip adduction; hip abduction; hinge variant | pushdown; side delt; row or pullover variant; rear delt or face pull; shrug |

Monday runs P, C, I, I, I, C: slot 3 is a fly and slot 6 a third press, so chest keeps pace with biceps. Friday's slot 6 is a second back compound, because back is the biggest upper-body muscle and was otherwise the least trained.

**Core day (weekend, at home: resistance bands, bodyweight, kettlebells, ab wheel).** Every session hits every core dynamic once: 8 slots of 2 sets each, run as 4 supersets that pair opposing dynamics, in about 30–35 minutes.

| Superset | Slot · dynamic | Main muscles | Home examples |
|---|---|---|---|
| A | 1 · anti-extension | rectus abdominis, deep abs | plank variants, dead bug, hollow hold, body saw |
| A | 2 · hip extension / lower back | spinal erectors, glutes | KB swing, bird dog, glute bridge, superman hold |
| B | 3 · trunk flexion | rectus abdominis | band crunch (anchored high), crunch variants, V-up |
| B | 4 · anti-rotation | obliques, deep abs | band Pallof press, KB plank pull-through |
| C | 5 · rotation | obliques | band woodchop (high-low and low-high), KB Russian twist |
| C | 6 · anti-lateral flexion | obliques, quadratus lumborum | side plank, KB suitcase carry or hold |
| D | 7 · hip flexion / lower abs | lower abs, hip flexors | reverse crunch, lying leg raise, dead-bug reach |
| D | 8 · lateral flexion | obliques, quadratus lumborum | KB side bend, band side bend, side-plank hip dip |

**Core follows a light version of the strange periodization.** It's workable because core work is low-fatigue. It's useful because home equipment limits load: kettlebells jump in big steps, band tension can't be logged as a weight, and bodyweight moves stall if the only lever is "more reps." So progress comes from switching between load, hold time and harder variants. That reasoning is inference; no trials compare the two approaches. The light version:
- **Weekly wave:** week 1 is Moderate (10–15 reps or 30–40 s holds). Week 2 is Heavy (one step up each movement's ladder: the harder variant, the heavier kettlebell or the next band, at 6–10 reps or 15–25 s holds). Week 3 is Light (15–25 reps or 45–60 s holds, with a slow 3-second lowering if it gets easy). Week 4 is a deload at 1 set per dynamic.
- **Variants rotate every block** within each dynamic, preferring one step up the ladder; the slots stay fixed and only the exercise changes.
- **Ladders:**
  - kettlebell: the next bell the profile owns (25 → 35 lb in the reference profile, a 40% jump, so the 35 comes in on Heavy weeks first). Past the heaviest bell, progress comes from tempo, pauses, single-arm versions or the harder variant.
  - band: a step further from the anchor (stance is logged), then the next band in the user's set, dropping back to the closer stance.
  - bodyweight: the next variant (for example plank → long-lever plank → body saw).
- **Band logging:** band sets record a **band** (the user's bands, ordered lightest to heaviest in Settings) and a **stance** (steps from the anchor) instead of a weight. The e1RM math doesn't apply to bands.
- **Flat option:** Settings › Core day › Flat keeps week 1's Moderate scheme every week.

**Zone rotation (the undulation):** the zones shift by one day each week. Over a block, every muscle group gets one heavy, one moderate and one light session:

| | Mon (Chest & biceps) | Wed (Legs) | Fri (Back, triceps & shoulders) |
|---|---|---|---|
| Week 1 | M | H | L |
| Week 2 | L | M | H |
| Week 3 | H | L | M |
| Week 4 | deload | deload | deload |

**Balance targets, with no focus muscle.** Every muscle should grow at about the same rate, and a missed week shouldn't throw a rotation off, so every loading week aims for the same per-muscle targets:

| Muscle | Sets per week |
|---|---|
| Quads | 9–11 |
| Glutes/hamstrings | 10–12 |
| Chest | 9–11 |
| Back | 9–11 |
| Side delts | 6–8 |
| Biceps | 7–9 |
| Triceps | 7–9 |
| Calves, rear delts | 3–5 |

**How a week reaches its targets.** Sets count 1 for a main muscle and 0.5 for a secondary one. The generator first adds up what the base movements alone give each muscle that week. Then:
- **Heavy days:** a muscle under its target gets 1 extra set on its slot (leg extension for quads, the slot 6 row for back, lateral raise for side delts, and so on).
- **Moderate and light days:** the V slots go to muscles under their target, biggest shortfall first. A V slot can also hold a movement outside the targeted muscles (shrug, adductors, forearm curl). It never adds a muscle that is already at its target, or one that 2 more sets would push over. If nothing qualifies, the slot stays empty, so Monday doesn't pick a fourth curl.
- **Grip finishers** skip movements, such as reverse curls, that would push biceps over.

**Coverage check:** after laying out the weeks, the generator checks every loading week against the targets:
- **Over:** a set comes off an isolation or variety slot above 2 sets, then a secondary compound. Otherwise a variety movement whose main muscles are all over goes. The primary lift is never trimmed, and base movements keep at least 2 sets.
- **Under:** a set is added to an isolation or variety slot, then a compound, in a session with room under 22 sets, as long as it pushes no other muscle over. Failing that, a 2-set variety movement is added on a moderate or light day with room.
- **Floors:** major muscles should not drop below 4 sets in any week, and calves, rear delts and forearms below 2. A week under a floor is reported as a warning.

A missed session just means fewer sets that week; nothing carries over. Forearms have no target because grip finishers and pulling work cover them, and daily running counts for something on calves. The core day is checked differently: every session contains all 8 dynamics. This check is what prevents the lopsided weeks AnatolyFit reviewers describe.

### 4.3 Exercise selection and variety

Candidate filter for a slot: the exercise is tagged for that slot, all of its equipment is available at the day's location, its level is beginner or intermediate, it suits the zone, and it isn't marked Avoid (anywhere) or Can't do (at that location).

The highest-scoring candidate wins. Scoring:
- \+ in block 1, a movement marked as a starter
- \+ beginner level; − intermediate (used when nothing beginner-friendly offers variety)
- \+ marked Favourite
- \+ on a P slot, a Smith machine lift (so the Smith squat, deadlift, bench and press lead from block 1)
- − a second high-fatigue compound in the same session (keeps leg day recoverable for a daily runner)
- − a high impact on running
- − for a variety slot, a movement already used as variety this block, or one from the same family as the day's base movements
- a small deterministic tie-breaker, so the same inputs always give the same plan

Rotation rules:
- **Base slots keep the same exercise for the whole block,** so progress is measurable.
- **V slots are where novelty lives.** They draw from the day's pool, avoid repeating a family already in the session, and can change every week. They only appear on M and L days, which is Anatoly's "wider variety when the bar gets lighter."
- **At each block boundary,** each lifting day rotates one isolation slot, and on even-numbered blocks one compound slot too (secondary compounds before the primary lift, so the main lift sticks around longest). Any exercise that has **stalled** (no e1RM gain over its last 3 exposures) also rotates out.
- **When nothing fits:** if every candidate for a slot is marked Avoid or Can't do, or none fits the available equipment, the slot takes a related movement for the same main muscle, or else keeps a flagged one, or else is left out of the block. The block's rationale says which, so a gap is never silent; adding equipment or removing a flag brings the slot back.
- **Mid-session swap:** the app offers movements tagged for the same slot first, then ones with the same movement pattern and muscles, limited to the equipment at that day's location. Logged sets attach to whatever was actually done.

### 4.4 Loads and progression (the feedback loop)

Everything runs on what was **logged**, not what was prescribed. Weights are never shown as targets: the right weight depends on the rep target, which keeps changing, so the weight field starts blank and the app shows what was lifted last time instead.

1. **Estimated max per exercise.** For each set, e1RM = load × (1 + (reps + RIR) / 30): the Epley formula with reps in reserve added. RIR comes from the movement's effort tap (Easy = 4, Right = 2, Hard = 0.5); with no tap, the app assumes 2. A session's value is its best set. e1RM drives the history chart, personal bests in the finish summary, and stall detection (§4.3).
2. **Effective load,** so different machines compare fairly:
   - **Smith machine:** the user logs only the plates added; the bar's weight is set once in Settings and added back.
   - **Assisted pull-up and dip machines:** the effective load is bodyweight minus assistance, so the profile keeps the user's bodyweight.
   - **Band and bodyweight movements** have no e1RM.
3. **Weight hint (double progression).** Above the sets, the app shows the newest session at a similar rep count ("Last time at 8–12: 40 lb each"), or failing that the last session's sets. If every set of that session reached the top of the range, it suggests one increment more ("try 45"). Increments are per exercise: +5 lb on the Smith machine, the next dumbbell pair, the next pin on a machine, and one step less assistance on assisted machines.
4. **First time ever on an exercise:** the plan adds a calibration note: ramp up across sets to a weight that leaves about 3 reps in reserve. That first log becomes the baseline.
5. **Pre-filled fields** show the planned reps in grey; typing replaces them. ✓ logs whatever is grey, so a set done as planned is one tap.

**Not yet implemented:** the finer progression rules: two increments after overshooting the range by 3 or more reps, a 5–10% drop after two sessions in a row with two or more sets below the range, and converting e1RM into a suggested load when an exercise moves to a new zone (load = e1RM ÷ (1 + (target reps + target RIR) / 30)).

### 4.5 Calendar, deloads and missed days

- **Calendar:** every session gets a date from the weekly schedule. The calendar shows each day's session type and zone (for example "Legs · Heavy"), shades deload weeks, and marks each session planned, done, partial, missed or done late. States are worked out from the plan and the logs, never stored.
- **Planning ahead:** the next block is planned when the current one starts, from the logs available then, and its unlogged sessions are rebuilt once from the latest logs on its first day. Settings › Regenerate upcoming workouts rebuilds the rest of the current block and the next one; logged or started sessions are never touched. After a long break, a new block starts on the current week's Monday.
- **Missed and moved sessions:** a session stays on its planned date. A missed session from the current week can be done on any later day of that week with **Do it today**, and a future session can be pulled forward the same way. The log records the real date and the calendar shows it as done late, not missed. Progression keys off the session, not the date, so nothing breaks. Nothing carries over to the next week, and the zone rotation continues as planned.
- **Planned deload (week 4):** same base exercises, 2 sets each, about 10% lighter, RIR 4 or more. The core day keeps all 8 dynamics at 1 set each.
- **"Beat up":** the finish summary has a "beat up" checkbox. Today it only cancels the next block's volume ramp (§4.1).

**Not yet implemented:**
- **Early deload:** if 3 or more exercises regress in one week, or a session is marked "beat up," the next lifting session becomes a deload.
- **Long gap:** after 10 or more days off, loads drop 10% for one session.

### 4.6 Running

- **Runs are outside the plan.** The generator never schedules, moves or modifies them, and never suggests changing them.
- **Running is accounted for on the lifting side only.** Legs sit midweek, leg-day fatigue stays moderate, and exercise selection penalises stacking two high-fatigue compounds in one session (so heavy leg day doesn't pair, say, a Smith squat with a Smith RDL) and movements with a high impact on running.
- **Not yet implemented:** if 3 or more leg sets miss their range two weeks in a row, cut one leg set before touching anything else.
- **Inference, not cited:** growing at 165–170 lb on 2 miles a day probably needs a calorie surplus. Meal planning is out of scope.

### 4.7 Generator in brief

```
for each block:
  for each lifting day (Chest & biceps, Legs, Back/tri/shoulders):
    pick base exercises (4.3), keeping most from last block and rotating the scheduled slots
  pick core variants for each of the 8 dynamics
  for week 1..3:
    zone per day from the rotation table; RIR from the effort ramp
    sets per slot from role × zone; top set and volume ramp on heavy days from block 3
    muscles under their weekly target claim heavy-day extra sets and V slots (M: 1, L: 2)
    grip finisher on M and L days
    core day: all 8 dynamics at this week's core zone
  coverage check (4.2): trim muscles over target, top up muscles under
  week 4: deload
  place sessions on calendar dates from the schedule; runs are never scheduled
when a planned-ahead block becomes current:
  rebuild its unlogged sessions from the latest logs
during a session:
  weight hint and next-increment suggestion from the logs (4.4)
```

`generateBlock` is a pure function: the same profile, catalog, flags, start date and previous block always give the same plan. Its inputs and outputs are documented in [api/core.md](api/core.md).

### 4.8 Not yet implemented

| Rule | Section |
|---|---|
| Two increments after a large overshoot; 5–10% drop after repeated misses; e1RM-based load for a new zone | §4.4 |
| Early deload from regressions or a "beat up" session | §4.5 |
| 10% load drop after 10 or more days off | §4.5 |
| Cut a leg set when leg sets keep missing | §4.6 |

## 5. Data the rules depend on

- **From the exercise catalog** ([exercise-database.md §4](exercise-database.md#4-schema)): the slots each movement may fill, movement pattern, primary and secondary muscles, mechanic, equipment, level, family, sensible rep range, load increment, weight convention (total, per hand, added, assisted, band), fatigue cost, run impact, starter flag, core dynamic and difficulty rank for core ladders, and grip type for finishers.
- **From the profile:** the weekly schedule, equipment per location, bands, kettlebells, Smith bar weight, bodyweight, and core wave or flat.
- **From the logs** ([SPEC.md §3](SPEC.md#3-data-model)): reps or seconds, weight or band and stance, the optional effort tap per movement, the session date, swaps, skips, and the "beat up" flag. A swap records the exercise actually done.
- **From the user's marks:** Favourite, Avoid, and Can't do per location.

## 6. Sample block

`npm run sample` prints a full generated block as Markdown, with the weekly sets per muscle. Week 1 of block 1 for the reference profile, starting Monday 2026-10-12 (all sessions at RIR 3; core at RIR 2):

**Mon · Chest & biceps · Moderate** (7 movements, 17 sets)

| Slot | Movement | Sets × reps |
|---|---|---|
| P | Smith Machine Bench Press | 3 × 8–12 |
| C | Incline Dumbbell Press | 3 × 8–12 |
| I | Cable Crossover (High to Low) | 2 × 10–15 |
| I | Dumbbell Curl | 2 × 10–15 |
| I | Dumbbell Hammer Curl | 2 × 10–15 |
| C | Machine Chest Press | 3 × 8–12 |
| G | Farmer's Carry | 2 × 20–60 s |

**Wed · Legs · Heavy** (6 movements, 18 sets)

| Slot | Movement | Sets × reps |
|---|---|---|
| P | Smith Machine Squat | 3 × 6–8 |
| C | Dumbbell Romanian Deadlift | 3 × 6–8 |
| C | Dumbbell Reverse Lunge | 3 × 8–10/side |
| I | Leg Extension | 3 × 10–15 |
| I | Seated Leg Curl | 3 × 10–15 |
| I | Seated Calf Raise | 3 × 10–15 |

**Fri · Back, triceps & shoulders · Light** (9 movements, 19 sets)

| Slot | Movement | Sets × reps |
|---|---|---|
| P | Assisted Pull-Up Machine | 2 × 10–12 |
| C | One-Arm Dumbbell Row | 2 × 12–15/side |
| C | Smith Machine Overhead Press | 2 × 10–12 |
| I | Dumbbell Lateral Raise | 3 × 12–20 (extra side-delt set) |
| I | Seated Dumbbell Overhead Extension | 2 × 12–15 |
| C | Seated Row Machine | 2 × 12–15 |
| V | Incline Side-Lying Lateral Raise | 2 × 12–20/side (extra side-delt sets) |
| V | Inverted Row (Smith Bar) | 2 × 12–15 (extra back sets) |
| G | Dumbbell Finger Curl | 2 × 12–25 |

**Sat · Core · Moderate** (8 movements, 16 sets, 4 supersets)

| Superset | Movement | Sets × reps/time |
|---|---|---|
| A | Dead Bug | 2 × 10–15/side |
| A | Bird Dog | 2 × 10–15/side |
| B | Kneeling Band Crunch | 2 × 10–15 |
| B | Band Pallof Press | 2 × 10–15/side |
| C | Band Woodchop (High to Low) | 2 × 10–15/side |
| C | Side Plank | 2 × 30–40 s/side |
| D | Reverse Crunch | 2 × 10–15 |
| D | Kettlebell Side Bend | 2 × 10–15/side |

Weeks 2 and 3 shift the zones (Monday light, Wednesday moderate, Friday heavy; then Monday heavy, Wednesday light, Friday moderate). On week 3's light leg day, a cable pull-through stands in for the Romanian deadlift. The heavy core week moves each core movement one step up its ladder: kettlebell dead bug, jackknife sit-up, half-kneeling Pallof press, side plank with leg raise, kettlebell windmill.

**Weekly sets per muscle** for this block (direct 1, indirect 0.5):

| Muscle | Week 1 | Week 2 | Week 3 | Target |
|---|---|---|---|---|
| Quads | 9 | 10 | 10 | 9–11 |
| Glutes/hamstrings | 12 | 12 | 11 | 10–12 |
| Chest | 11 | 10 | 11 | 9–11 |
| Back | 9 | 9 | 9 | 9–11 |
| Side delts | 6 | 6 | 6.5 | 6–8 |
| Biceps | 8 | 8.5 | 8.5 | 7–9 |
| Triceps | 7.5 | 9 | 8 | 7–9 |
| Calves | 4.5 | 3 | 3 | 3–5 |
| Rear delts | 4 | 4.5 | 4.5 | 3–5 |
| Forearms | 9.5 | 10 | 8.5 | no target |

The golden test (`packages/core/tests/golden.test.ts`) pins blocks 1 to 8 of this profile exactly. From block 6 on, Friday runs out of room for every target: back can dip to 8 sets in one week, triceps reach 10.5 in one week, and from block 8 rear delts sit at 1.5–2. Blocks 1 to 5 stay inside every target.

## 7. Design choices

The places where the rules could reasonably have gone another way, and what was chosen:

1. **Upper pairing:** Monday chest & biceps and Friday back, triceps & shoulders (Anatoly's own split), rather than push and pull days.
2. **Core day:** a weekend window, Saturday or Sunday.
3. **Core periodization:** the light wave in §4.2, with a flat option in Settings.
4. **Heavy top set:** one set of 3–5 reps on heavy days from block 3, rather than from day one or never.
5. **Effort logging:** an optional one-tap Easy / Right / Hard per movement, rather than a typed RIR number. A 1–5 "how hard was today" rating and free-text notes are recorded but don't feed the plan.
6. **Variety:** V slots on lighter days plus one or two base-slot rotations per block.
7. **Exclusions:** per-movement Avoid and Can't do marks in the library, rather than a list of injuries or banned patterns.
8. **Balance:** fixed per-muscle weekly targets rather than a rotating focus muscle, so every muscle grows at about the same rate.

## Sources

1. AnatolyFit, "How Does Anatoly Train? Vladimir Shmondenko's Real Training Routine." https://anatolyfit.com/blog/how-does-anatoly-train-vladimir-shmondenko-s-real-training-routine
2. AnatolyFit homepage (APS program description). https://anatolyfit.com/
3. Trustpilot reviews of AnatolyFit. https://www.trustpilot.com/review/anatolyfit.com
4. Grgic J, et al. Effects of linear and daily undulating periodized resistance training programs on measures of muscle hypertrophy: a systematic review and meta-analysis. *PeerJ* 2017;5:e3695. https://peerj.com/articles/3695
5. Moesgaard L, Beck MM, Christiansen L, Aagaard P, Lundbye-Jensen J. Effects of periodization on strength and muscle hypertrophy in volume-equated resistance training programs: a systematic review and meta-analysis. *Sports Med* 2022;52(7):1647–1666. Summary: https://sci-sport.com/en/effects-intensity-volume-periodization-strength-hypertrophy-238/
6. Schoenfeld BJ, et al. Loading recommendations for muscle strength, hypertrophy, and local endurance: a re-examination of the repetition continuum. *Sports* 2021;9(2):32. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7927075/
7. Pelland JC, et al. The resistance training dose-response: meta-regressions exploring the effects of weekly volume and frequency on muscle hypertrophy and strength gain. 2024 preprint, SportRxiv. Summary: https://biolayne.com/reps/issue-31/the-king-of-volume-metas/
8. Kassiano W, et al. Does varying resistance exercises promote superior muscle hypertrophy and strength gains? A systematic review. *J Strength Cond Res* 2022;36(6):1753–1762. https://lida.sport-iat.de/ta/Record/4077216?lng=en
9. Zourdos MC, Helms ER, et al. Novel resistance training-specific rating of perceived exertion scale measuring repetitions in reserve. *J Strength Cond Res* 2016;30(1):267–275.
10. Bell L, et al. Integrating deloading into strength and physique sports training programmes: an international Delphi consensus approach. *Sports Med Open* 2023;9(1). https://doi.org/10.1186/s40798-023-00633-0
11. Bell L, et al. A practical approach to deloading: recommendations and considerations for strength and physique sports. *Strength Cond J* 2025;47(3). https://shura.shu.ac.uk/35313/
12. Schumann M, et al. Compatibility of concurrent aerobic and strength training for skeletal muscle size and function: an updated systematic review and meta-analysis. *Sports Med* 2022;52(10):2391–2403. https://doi.org/10.1007/s40279-022-01688-x
13. Wikipedia, "Vladimir Shmondenko (weightlifter)." https://en.wikipedia.org/wiki/Vladimir_Shmondenko_(weightlifter)
14. AnatolyFit, "How Is Anatoly So Strong but Not Big? His Real Height, Weight, and Body Type Explained." https://anatolyfit.com/blog/how-is-anatoly-so-strong-but-not-big-his-real-height-weight-and-body-type-explained
15. AnatolyFit, "Anatoly's Story: From a 15-Year-Old Blogger to Training With Arnold Schwarzenegger." https://anatolyfit.com/blog/anatoly-s-full-story-from-a-15-year-old-blogger-with-no-views-to-training-with-arnold-schwarzenegger
16. AnatolyFit, "Anatoly's Real Strength Numbers: Bench, Squat, and Deadlift." https://anatolyfit.com/blog/anatoly-s-real-strength-numbers-bench-squat-and-deadlift
17. AnatolyFit, "What Is Anatoly's Secret? The Strength Behind the Mop." https://anatolyfit.com/blog/what-is-anatoly-s-secret-the-real-strength-behind-the-mop-and-why-it-s-more-than-a-joke
18. Google Play, "Anatoly Fitness - Workouts" (Saasfactory LLC). https://play.google.com/store/apps/details?id=app.anatoly.fitness
19. Vladimir Shmondenko programs site. https://shmondenkovladimir.com/
20. Manila Times newswire, "Anatoly Fit Launches APS System…" 2026-06-19. https://www.manilatimes.net/2026/06/19/tmt-newswire/plentisoft/anatoly-fit-launches-aps-system-to-streamline-its-online-workout-program/2369179

**Inferred rather than cited:**
- How Anatoly's powerlifting method relates to the AnatolyFit product, and which parts to copy (Background)
- The reading of what makes AnatolyFit feel "strange" (§1)
- The specific zone rep ranges, the role × zone set table, the day slot templates and the V-slot mechanism (synthesized from refs 4–8, 17 and the target session size)
- The weekly floors and the per-muscle weekly targets
- The handling of missed sessions
- The 8-dynamic core template, the core wave and the decision to keep it
- The grip finisher placement on M and L days
- The rotation cap of one or two base slots per block (an operationalization of ref 8)
- The progression thresholds
- The 10-day gap rule
- The running-related selection rules beyond ref 12
- The calorie-surplus note
