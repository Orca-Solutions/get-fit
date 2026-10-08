# Training logic: "strange periodization", made explicit

Milestone 1 draft · training-logic thread · 2026-10-07 · rev 3: Mon legs / Wed + Fri upper / Sat home core covering all 8 dynamics, grip finishers, morning run untouched · rev 3.1: home cables are resistance bands · rev 3.2: Planet Fitness with Smith machine for main lifts, 25 and 35 lb kettlebells · rev 3.3 (2026-10-08): legs moved to Wednesday and chest & biceps to Monday, so an occasional Sunday long run doesn't fall the day before leg day

## Background: Anatoly and AnatolyFit

**The man.** "Anatoly" is the on-screen persona of **Vladimir Shmondenko**. He is a Ukrainian powerlifter born in 1999 who grew up on a farm and began training at 15, using a homemade gym "from old tractor parts, car wheels, and bricks" [13].
- **Competition:** as a junior he won the Kyiv Cup in 2017 and 2018 and took bronze at the 2018 GPA Worlds (teen 18–19). He competed around 74–79 kg bodyweight [13][16].
- **How he got famous:** his straight training videos went nowhere for three years. Fame came in 2019 with the prank format. He poses as a frail-looking gym janitor, then casually lifts enormous weights with a 32 kg mop and bucket [13][15].
- **Since 2022:** he left Russia for Dubai after the invasion, switched to English-language pranks, and grew to tens of millions of followers. He trained with Arnold Schwarzenegger in July 2025 [13][15].
- **Size:** about 180 cm and 78 kg, close to your size [13][14].
- **Lifts:** his brand claims gym bests of 320 kg deadlift, 225 kg squat and 150 kg bench [14][16]. Wikipedia lists 290 / 210 / 150 [13]. His best *competition* lifts are much lower: 245 kg deadlift, 150 kg squat and 122.5 kg bench [16]. Treat the gym numbers as marketing.

**His philosophy, in his brand's own words.** The whole persona rests on being strong without looking big. The blog says he "wanted to be strong" rather than pursue size. It credits technique, coordination and "generating force in complex positions" for his strength [14]. It also says plainly that "strength and size don't always increase at the same rate… muscle growth is significantly influenced by the total volume of hard work" [14]. Three statements map directly onto this doc's rules:
- **Two kinds of periods.** "During more intense periods, athletes use more working sets, fewer repetitions, and a gradual increase in load; in less intense periods, incorporate a wider variety of exercises and reduce the weight on the barbell." [17] This is the closest thing to a published definition of the method you noticed. Heavy periods narrow the exercise list and push load. Lighter periods widen the exercise list and back off load.
- **Form decides the load.** "Add weight as long as your form remains stable; maintain it when your form becomes unstable; reduce the load when fatigue begins to affect your movement." [17] This is autoregulation, and it becomes the progression rules in 4.4.
- **Small steps, earned.** "You don't add a new weight plate to the bar just because a new week has started." Steps are 1.5–2.5 kg [17].

**The products.** Several Anatoly-branded products exist, and it isn't clear which ones he runs day to day:
- **anatolyfit.com:** a Dubai-based web subscription. In June 2026 it relaunched its program as "APS" (Anatoly's Power System), described as a weekly-refreshing personalized plan, and claims 90,000+ users [2][15][20]. On Trustpilot it scores 2.6/5 from 23 reviews. 70% of reviews are one-star, citing refund refusals, generic plans, missing progression guidance and, for a while, no phone app [3].
- **"Anatoly Fitness":** an Android app published by Saasfactory LLC, rated 2.9 stars [18].
- **shmondenkovladimir.com:** his own site, selling fixed 1–16-week PDF/video programs [19].

**How this shapes our design (inference).** Anatoly's own method is a powerlifter's method. It uses heavy top sets, alternates intensity periods, earns load by form, and has a small exercise menu built around three competition lifts. AnatolyFit then wraps that in a weekly-regenerated, general-population plan without exposing his load logic or your history. For you, a beginner whose goal is muscle, the useful parts are:
- the heavy/light alternation, with variety concentrated in the lighter periods
- form-gated small increments
- the heavy-set-then-volume session shape

What we don't copy:
- powerlifting specificity (heavy singles and doubles from day one)
- the opaque regeneration

## 1. What AnatolyFit actually publishes

There is no published spec called "strange periodization." The phrase does not appear in AnatolyFit's materials or in the sports-science literature (searched 2026-10-07). What AnatolyFit does say publicly:

- **Phases alternate between heavy and volume work.** "One phase is aimed at developing strength under heavy loads. The other focuses on increasing volume." [1]
- **Each session starts with one heavy, low-rep set and then builds volume.** "The workout begins with a 1×2 set, and the remaining exercises are used to increase the volume." Secondary lifts run 4×6 to 4×12 and accessories 3×10 to 3×15. [1]
- **Anatoly's own week:** Monday legs; Wednesday chest & biceps; Friday back, triceps & shoulders; Saturday cardio. Grip, wrists, abs and core are trained separately or tacked on. [1]
- **Weight goes up in small steps, and only with clean form.** "An increase in weight of 1.5–2.5 kg is considered progress if form remains consistent." Sets or exercises get added before weight does. [1]
- **Exercise variety goes up when load goes down.** Lighter periods "incorporate a wider variety of exercises and reduce the weight on the barbell." [17]
- **The plan refreshes every week.** "New plan every week… progressive overload built in." Sessions are shown as set/exercise counts, for example "17 Sets | 6 Exercises." [2]
- **The app knows too little about your history.** Reviewers say it gives "no recommended weight increases… and no transparent overview of previous training data," and some got lopsided splits, such as two leg days and one upper day. [3]

**Inference:** the "strange" feel you noticed is most likely three things stacked together. Rep ranges change from session to session (undulating periodization). The movement chosen for a muscle changes from week to week, and changes most in lighter periods (conjugate-style variation). The plan is also regenerated weekly with no visible logic behind it. Each of these is a known method. AnatolyFit just doesn't show the rules. This doc writes them down.

## 2. What the research says about each lever

| Lever | Evidence | What we do with it |
|---|---|---|
| Undulating rep ranges vs. fixed (linear) | For hypertrophy, the method doesn't matter much when volume is equal [4][5]. For strength, undulating beats linear, but mostly in trained lifters (ES 0.61). In beginners the gap is near zero (ES 0.06) [5]. | Undulate, because it keeps training fresh and costs nothing. Don't expect it to be magic. Volume and progression are what drive growth. |
| Rep range | Hypertrophy is similar from about 6 to 30 reps when sets are taken close to failure. Strength is best with heavier loads [6]. | Use three zones: heavy, moderate, light. All three build muscle, and the heavy zone also builds strength. |
| Weekly volume | More sets give more growth, with diminishing returns. Strength plateaus sooner than size. Indirect work counts for about half a set [7]. | Count sets per muscle, with indirect sets at 0.5. Start low and ramp up. |
| Frequency | Once volume is equal, frequency matters little for size and somewhat for strength [7]. | Your split trains each muscle directly once a week. Arms also get indirect work on the other upper day. That costs little for size. |
| Exercise variation | Systematic variation helps regional growth. Random or excessive rotation hurts [8]. | Rotate on a schedule, a few exercises at a time, within movement families. Never shuffle randomly. |
| Effort (RIR) | Reps in reserve (RIR) is a valid way to set effort [9]. | Prescribe by RIR and log an optional one-tap effort rating. |
| Deloads | Deloads are commonly pre-planned every 4–8 weeks by reducing volume, effort or frequency. They can also be triggered by fatigue [10][11]. | Plan a deload in week 4 of each block, and pull it earlier if performance drops. |
| Daily running | Concurrent training slightly blunts growth of type I muscle fibers, and running blunts it more than cycling (SMD −0.81) [12]. | Your 2-mile morning run stays exactly as it is. Running first thing and lifting later already separates the two. The plan just keeps leg volume moderate. |
| Core periodization | No good trials compare periodized and fixed core training. Core muscles respond to overload like any other muscle, and core work is low-fatigue (inference). | A light version of the same wave. See 4.2, Core day. |

## 3. The schedule (your call) and the defaults I picked

**Your schedule:**

| Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|
| AM run | AM run | AM run | AM run | AM run | AM run | AM run |
| **Chest & biceps** | — | **Legs** | — | **Back, triceps & shoulders** | **Core (home)** | — |

Your 2-mile morning run is fixed. The plan never schedules, moves or adjusts it. Legs sit midweek so an occasional Sunday long run doesn't land the day before leg day (rev 3.3). The upper-body pairing is Anatoly's own published split: chest and biceps, then back, triceps and shoulders, with grip, wrists and abs done separately [1]. Grip and forearm work is tacked onto lifting days (4.1). The two days barely overlap. Arms still get hit twice: biceps directly on Monday and indirectly through Friday's rows, and triceps directly on Friday and indirectly through Monday's presses. That's my reading of "mostly arms split into 2 days," and decision 1 asks you to confirm it.

**Session size (your numbers):** 6–8 movements and usually about 17 working sets, ranging from about 12 to 22. Sessions run roughly 55–75 minutes. The core day is done at home with resistance bands, bodyweight and kettlebells. It runs about 16 sets in 30–35 minutes, as supersets.

**My defaults:**
- **Goal:** muscle first, strength second.
- **Gym (your info):** Planet Fitness. There is no free barbell, trap bar or deadlift platform. Squats, deadlifts and presses are done on the **Smith machine**, and since you already did all three in AnatolyFit, they're in from day one. The gym also has dumbbells, cables, a leg press, a hack squat, hip adduction, and assisted pull-up and dip machines.
- **Home (your info):** resistance bands and kettlebells of 25 and 35 lb.
- **Units:** lb.
- **Weekly volume:** 6–10 hard sets per major muscle, averaged over a block. The ceiling is about 14 in year one.

## 4. The generator, as rules

### 4.1 Building blocks

- **Block:** 4 weeks, made up of 3 loading weeks and 1 deload week. A block is the unit for exercise rotation.
- **Session template:** an ordered list of **slots**, each defined by movement attributes, not by exercise name. Every slot has a role:
  - **P** (primary compound)
  - **C** (secondary compound)
  - **I** (isolation)
  - **V** (variety: an extra movement that appears only on lighter days)
- **Zone:** each lifting day has a zone for that week. The zone sets the reps and, following Anatoly's two kinds of periods, the session's shape. Heavy days have fewer movements and more sets each. Light days have more movements and fewer sets each, so variety widens as load drops [17].

| Zone | Compound reps | Rest | Movements | Typical sets |
|---|---|---|---|---|
| **H** (heavy) | 5–8 (block 1: 6–8) | 2–3 min | 6 (P, C, C, I, I, I) | 18–22 |
| **M** (moderate) | 8–12 | 1.5–2 min | 7 (the 6 base slots plus 1 V) | about 17 |
| **L** (light) | 12–20 (block 1: 12–15) | 1–1.5 min | 8 (the 6 base slots plus 2 V) | about 16 |
| Deload | that week's zone, at reduced load | | 6 (base slots only) | about 12 |

Sets per slot:

| Role | H | M | L | Deload |
|---|---|---|---|---|
| P | 4 (block 1: 3) | 3 | 2 | 2 |
| C | 3 | 3 | 2 | 2 |
| I | 3 | 2 | 2 | 2 |
| V | — | 2 | 2 each | — |

- **Isolation and variety slots ignore the zone's rep range.** They always run 10–15 or 12–20 reps.
- **A movement's own limits win.** If a slot's zone is below an exercise's sensible minimum (for example a split squat on an H day), reps clamp up to that minimum (8–10). Smith or DB Romanian deadlifts are never programmed in L, where the generator swaps in a back extension or a machine hamstring move.
- **Anatoly-style top set:** from block 3 onward, the P slot on an H day can start with one set of 3–5 reps at RIR 2, followed by back-off sets at −10% (see decision 3).
- **Volume ramp across blocks:** when recovery is good (no early deloads and no stalls), the next block adds one set to the P slot and one to the I slots on H days. This walks heavy sessions from about 18 up to about 22 sets.
- **Grip & forearm tack-ons:** each week, the M day and the L day end with a 2-set grip or forearm finisher (about 4 minutes). The H day, already the biggest session, gets none, and neither does a deload week. The finisher always comes last, so pulling work is never done with tired hands. It rotates through the grip families from session to session:
  - support (dead hang, farmer's hold)
  - crush (thick-handle hold)
  - pinch (plate pinch)
  - wrist flexion
  - wrist extension
  - pronation/supination
  - reverse curl

  It adds 2 sets, so sessions stay inside 12–22.
- **Weekly effort ramp:** week 1 at RIR 3, week 2 at RIR 2, week 3 at RIR 1–2 (compounds never go below RIR 1), week 4 is a deload at RIR 4 or more.

### 4.2 Day templates and how muscle groups rotate

Each lifting day has 6 base slots, which stay put for the whole block, and a variety pool that the V slots draw from:

| Slot | Mon: Legs | Wed: Chest & biceps | Fri: Back, triceps & shoulders |
|---|---|---|---|
| 1 · P | squat pattern, bilateral | horizontal press, flat | vertical pull |
| 2 · C | hinge, bilateral | horizontal press, incline | horizontal pull |
| 3 · C | single-leg, knee-dominant | (I) chest fly / adduction | vertical press |
| 4 · I | knee extension | elbow flexion, supinated | shoulder abduction (side delt) |
| 5 · I | knee flexion | elbow flexion, neutral grip | elbow extension, overhead (stretch) |
| 6 · I | calf | elbow flexion, stretch position | elbow extension, pushdown |
| V pool | hip extension; hack squat or leg press; hip adduction; hinge variant | chest press variant (machine, assisted dip, push-up); forearm or reverse curl; third curl angle | rear delt or face pull; row or pullover variant; shrug |

Wednesday's slot 3 is an isolation slot, so that day runs P, C, I, I, I, I. This keeps chest at about 10 sets and makes the day as arm-heavy as AnatolyFit's.

**Core day (Saturday, at home: resistance bands, bodyweight, kettlebells).** Every session hits every core dynamic once: 8 slots of 2 sets each, run as 4 supersets that pair opposing dynamics, in about 30–35 minutes.

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

**My recommendation: keep a light version of the strange periodization for core.** It's workable because core work is low-fatigue. It's useful because home equipment limits load: kettlebells jump in big steps, band tension can't be logged as a weight, and bodyweight moves stall if the only lever is "more reps." So progress has to come from switching between load, hold time and harder variants. That reasoning is inference; no trials compare the two approaches. The light version:
- **Weekly wave:** week 1 is Moderate (10–15 reps or 30–40 s holds). Week 2 is Heavy (the heaviest KB, the next band, or the harder variant, at 6–10 reps or 15–25 s holds). Week 3 is Light (15–25 reps or 45–60 s holds, or 3-second-down tempo). Week 4 is a deload at half the sets.
- **Variants rotate every block** within each dynamic, because the slots stay fixed and only the exercise changes.
- **Progression:** double progression on reps or time. Once the top of the range is reached, it moves one step up that equipment's ladder:
  - kettlebell: 25 → 35 lb. That's a 40% jump, so the 35 comes in on Heavy weeks first. Past 35, progress comes from tempo, pauses, single-arm versions or the harder variant.
  - band: first a step further from the anchor (about one foot, with your stance logged), then the next band in your set, dropping back to the closer stance
  - bodyweight: the next variant (for example plank → long-lever plank → body saw)
- **Band logging:** band sets record a **band level** (your bands, ordered lightest to heaviest, set up once) and a **stance** (steps from the anchor) instead of a weight. The e1RM math doesn't apply to bands. They use double progression and the ladder only.
- **If you'd rather not:** setting core to "flat" keeps week 1's Moderate scheme every week, with the same progression rules.

**Zone rotation (the undulation):** the zones shift by one day each week. Over a block, every muscle group gets one heavy, one moderate and one light session:

| | Wed (Legs) | Mon (Chest & biceps) | Fri (Back, triceps & shoulders) |
|---|---|---|---|
| Week 1 | H | M | L |
| Week 2 | M | L | H |
| Week 3 | L | H | M |
| Week 4 | deload | deload | deload |

**Focus muscle:** each block names one muscle group to get 2–3 extra sets a week. On M and L days it claims a V slot. On H days, where there are no V slots, it adds 1 set to its I slot. The rotation is side delts → chest → arms → upper back → glutes/hamstrings, then repeats. Side delts go first because this split gives them the least work.

**Coverage check:** the generator sums sets per muscle across the 3 loading weeks (secondary muscles count 0.5) and checks two things:
- **Block average:** if a major muscle averages under 6 sets a week, a set is added to its best slot. If it averages over the block ceiling, a set comes off an isolation slot.
- **Weekly floor:** no major muscle drops below 4 sets in any week, including its L week.

Minor muscles (calves, rear delts, forearms) have a floor of 2. The grip tack-ons cover forearms, and your daily running also counts for something on calves. The core day is checked differently: every session must contain all 8 dynamics. This check is what prevents the lopsided weeks AnatolyFit reviewers describe.

### 4.3 Exercise selection and variety

Candidate filter for a slot: pattern matches, equipment is available, skill level is at or below yours, the exercise is allowed in the slot's zone, and it is not excluded.

The highest-scoring candidate wins. Scoring:
- \+ a different family from what this slot used last block (variety)
- \+ it covers a region the day is missing (for example a stretch-position curl when the other curls are shortened-bias)
- \+ your rating (thumbs up or down)
- − a high fatigue cost on a heavy leg day (keeps leg day recoverable)
- core day only: the exercise must work with home equipment (resistance band, bodyweight or kettlebell)

Rotation rules:
- **Base slots keep the same exercise for the whole block,** so progress is measurable.
- **V slots are where novelty lives.** They draw from the day's pool, favor families not used in the last two blocks, and can change every week. They only appear on M and L days, which is Anatoly's "wider variety when the bar gets lighter."
- **At each block boundary, rotate one or two base slots per day,** at most one of which is P or C. Also rotate any slot you rated down or that **stalled** (no e1RM gain over 3 exposures).
- **Mid-session swap:** the app offers the top 3 candidates for the same slot. Your logged sets attach to whatever you actually did.

### 4.4 Loads and progression (the feedback loop)

Everything runs on what you **logged**, not what was prescribed. Logged reps and weight are the truth.

1. **Estimated max per exercise.** For each set, e1RM = load × (1 + (reps + RIR) / 30). This is the Epley formula with reps in reserve added. RIR comes from your effort tap (Easy = 4, Right = target, Hard = 0–1). With no tap, the app assumes the target RIR. The session's value is its best set, smoothed against the last value so one fluke set doesn't swing things.
2. **Same exercise, same zone as last time (double progression):**
   - All working sets hit the top of the rep range at or below target effort → add one increment next time and reset to the bottom of the range. Increments:
     - Smith machine: +5 lb (2.5 per side)
     - dumbbells: the next pair up
     - machines: the next pin
     - assisted pull-up and dip machines: one step less assistance
     - kettlebells: see the core-day ladder

     **Smith machine:** you log only the plates added, and the bar's weight is set once per gym, so loads stay comparable. **Assisted machines:** the effective load is bodyweight minus assistance, so the app needs your bodyweight (165–170 lb) for the e1RM math.
   - You overshot by 3 or more reps → add two increments.
   - Reps landed inside the range → keep the load and aim for +1 rep on the first set.
   - Two or more sets fell below the range → keep the load. If it happens twice in a row, drop 5–10%.
3. **Same exercise, new zone, or the first exposure in a block:** load = e1RM ÷ (1 + (target reps + target RIR) / 30), rounded down to an available increment. This lets a heavy day inform a light day and the reverse.
4. **First time ever on an exercise:** a calibration exposure. Ramp across sets to a weight that feels like RIR 3 inside the rep range. That first log sets the baseline.
5. **Pre-filled fields** show the prescription in grey. Typing replaces it. A set left untouched is recorded as done as prescribed when you mark it complete (product thread to confirm).

### 4.5 Calendar, deloads and missed days

- **Calendar:** the generator assigns every session a date on your weekly schedule. The calendar shows each day's session type and zone (for example "Legs · Heavy"), marks deload weeks and block boundaries, and shows completed sessions with a link to their logs. The product thread owns the calendar UI.
- **Moving a session:** you can move a session to any other day. Progression keys off the session, not the date, so nothing breaks. The generator only warns if a move stacks two lifting sessions on the same day.
- **Missed session:** it slides to the next open day that week (Tue, Thu, Sat or Sun). If the core day is displaced, it moves to Sunday. If a session can't fit before the week ends, it's skipped rather than stacked, and the zone rotation continues next week as planned. The coverage check then flags the muscle that lost its week.
- **Long gap:** after 10 or more days off, loads drop 10% for one session.
- **Planned deload (week 4):** same exercises, base slots only, 2 sets each, loads −10%, RIR 4 or more. The core day keeps all 8 dynamics at 1 set each.
- **Early deload:** if 3 or more exercises regress in one week, or you mark a session as "beat up," the next lifting session becomes a deload.

### 4.6 Running

- **Your 2-mile run, first thing every morning, is fixed.** The generator never schedules, moves or modifies it, and never suggests changing it.
- **Running is accounted for on the lifting side only.** Leg volume stays moderate, and block 1's heavy leg session avoids pairing the two highest-fatigue variants (for example a Smith squat and a Smith RDL).
- **If leg sets keep missing:** if 3 or more leg sets miss their range two weeks in a row, the generator cuts one leg set before touching anything else, then suggests checking sleep and food.
- **Inference, not cited:** growing at 165–170 lb on 2 miles a day probably needs a calorie surplus. Meal planning is out of scope, but the app could show bodyweight next to lift trends later.

### 4.7 Generator in brief

```
for each block:
  pick focus muscle (rotation)
  for each day template (Legs, Chest & biceps, Back/tri/shoulders, Core):
    select exercises for base slots (4.3), keeping most from last block
  for week 1..3:
    assign zone per day (rotation table) and RIR from effort ramp
    choose V-slot movements from each day's pool (M: 1, L: 2), focus claims one
    sets per slot from role × zone table; add grip tack-ons to 2 lifting days
    core day: all 8 dynamics, core wave for this week (M/H/L)
    coverage check (4.2)
  week 4: deload transform
  place sessions on calendar dates (Mon/Wed/Fri lifting, Sat core); runs are never scheduled
for each session served:
  load per slot from progression rules (4.4) using latest logs
after each session logged:
  update e1RM, stall counters, early-deload trigger
```

## 5. What this needs from the other threads

**Exercise database:** each movement needs these attributes:
- `pattern` (fine-grained enough to tell flat from incline press and supinated from neutral curl)
- `primary_muscles` and `secondary_muscles`
- `mechanic` (compound or isolation)
- `equipment`
- `laterality`
- `skill_level` (1–3)
- `family`, so variants group together (all Smith-machine horizontal presses, for example)
- `load_increment`, plus a flag for assisted machines, where load counts down
- `allowed_zones`, or min and max sensible reps
- `fatigue_cost` (axial and lower-body load)
- `length_bias` (stretch or shortened), optional
- `core_dynamic`, for core movements: one of the 8 in 4.2
- `difficulty_rank` within a family, for bodyweight progression ladders
- `grip_type`, for grip movements: support, crush, pinch, wrist flexion, wrist extension or rotation
- `home_ok`, or `equipment` reliable enough to filter to band, bodyweight or kettlebell for the home core day

**Product:**
- **Calendar:** each session needs a scheduled date, a day type (Legs, Chest & biceps, Back/tri/shoulders, Core) and a zone, plus a way to move it to another date.
- **Logging:** each logged set needs `reps` (or `seconds` for holds and carries), `load` (or band level and stance for bands) and a completed flag. Band levels are set up once, as your bands ordered lightest to heaviest. Each exercise per session can carry an optional effort tap. Each session needs its date and an optional "beat up" flag.
- **Swaps:** a swap must record the exercise you actually did.

## 6. Sample 2 weeks (block 1, weeks 1–2)

Example exercises appear in brackets only for readability. The generator picks by attributes. "Cal" means calibrate (4.4.4). Block 1's focus muscle is side delts. Week 2 loads come from week 1 logs. This sample predates rev 3.3: legs are now on Wednesday and chest & biceps on Monday, with each day keeping its zone.

**Week 1 (all sessions at RIR 3)**

**Mon · Legs · Heavy** (6 movements, 18 sets)

| Slot | Pattern [example] | Sets × reps |
|---|---|---|
| 1 P | squat, bilateral [Smith squat] | 3 × 6–8, cal |
| 2 C | hinge [DB RDL; not the Smith RDL, so it isn't paired with the Smith squat on a heavy day, per 4.6] | 3 × 6–8, cal |
| 3 C | single-leg [Bulgarian split squat] | 3 × 8–10/leg (clamped up from 6–8), cal |
| 4 I | knee extension [leg extension] | 3 × 10–15 |
| 5 I | knee flexion [seated leg curl] | 3 × 10–15 |
| 6 I | calf [standing calf raise] | 3 × 12–20 |

**Wed · Chest & biceps · Moderate** (7 movements + grip finisher, 18 sets)

| Slot | Pattern [example] | Sets × reps |
|---|---|---|
| 1 P | flat press [Smith bench press] | 3 × 8–12, cal |
| 2 C | incline press [incline DB press] | 3 × 8–12, cal |
| 3 I | chest fly [cable fly] | 2 × 12–15 |
| 4 I | supinated curl [EZ-bar curl] | 2 × 10–15 |
| 5 I | neutral curl [hammer curl] | 2 × 10–15 |
| 6 I | stretch curl [incline DB curl] | 2 × 10–15 |
| 7 V | chest press variant [machine chest press] | 2 × 10–15 |
| + | grip finisher: support [farmer's hold] | 2 × 30–45 s |

**Fri · Back, triceps & shoulders · Light** (8 movements + grip finisher, 18 sets)

| Slot | Pattern [example] | Sets × reps |
|---|---|---|
| 1 P | vertical pull [lat pulldown] | 2 × 12–15, cal |
| 2 C | horizontal pull [chest-supported row] | 2 × 12–15, cal |
| 3 C | vertical press [seated DB shoulder press] | 2 × 12–15, cal |
| 4 I | side delt [DB lateral raise] | 2 × 12–20 |
| 5 I | overhead triceps [overhead cable extension] | 2 × 12–15 |
| 6 I | pushdown [rope pushdown] | 2 × 12–15 |
| 7 V | rear delt [face pull] | 2 × 15–20 |
| 8 V | focus: side delt [cable lateral raise] | 2 × 12–20 |
| + | grip finisher: wrist extension [DB wrist extension] | 2 × 15–20 |

**Sat · Core at home · Moderate core week** (8 dynamics, 16 sets, 4 supersets)

| Superset | Dynamic [home example] | Sets × reps/time |
|---|---|---|
| A | anti-extension [dead bug] | 2 × 10–15/side |
| A | hip extension [KB swing] | 2 × 10–15 |
| B | flexion [band crunch] | 2 × 10–15 |
| B | anti-rotation [band Pallof press] | 2 × 10–15/side |
| C | rotation [band woodchop, high to low] | 2 × 10–15/side |
| C | anti-lateral flexion [side plank] | 2 × 30–40 s/side |
| D | hip flexion [reverse crunch] | 2 × 10–15 |
| D | lateral flexion [KB side bend] | 2 × 10–15/side |

**Week 2 (all sessions at RIR 2; zones shift so Mon=M, Wed=L, Fri=H)**

**Mon · Legs · Moderate** (7 movements + grip finisher, 19 sets)
- Base slots: 3 · 3 · 3 · 2 · 2 · 2 sets, at 8–12 reps.
- One V slot is added: hip extension [hip thrust], 2 × 10–15.
- Grip finisher: pinch [plate pinch], 2 × 20–30 s.
- Squat load comes from week 1's e1RM. If you did 135 × 8 at RIR 3, e1RM ≈ 135 × 1.37 = 185. For 10 reps at RIR 2: 185 ÷ 1.40 ≈ 132, which rounds down to 130 lb.

**Wed · Chest & biceps · Light** (8 movements + grip finisher, 18 sets)
- Every slot gets 2 sets, and the presses run 12–15 reps.
- Two V slots: the machine press stays, and a third curl angle is added [preacher curl], 2 × 12–15.
- Grip finisher: reverse curl, 2 × 12–15.
- This is the "wider variety, lighter bar" day.

**Fri · Back, triceps & shoulders · Heavy** (6 movements, 19 sets)
- Pulldown, row and shoulder press each get 3 × 6–8. Loads come from week 1's light-day e1RM.
- Lateral raise gets 3 + 1 sets (the focus muscle on an H day) at 12–20.
- Both triceps slots get 3 × 10–15.
- No V slots, because the face pull and cable lateral raise drop out on a heavy day.
- No grip finisher on the H day.

**Sat · Core at home · Heavy core week:** same 8 dynamics and exercises, now at 6–10 reps or 15–25 s holds:
- swings and side bends move from the 25 to the 35 lb kettlebell
- the band moves go to the next band, or a step further from the anchor
- the dead bug becomes a KB-loaded dead bug
- the side plank becomes a side plank with top-leg raise

Each change is one step up its difficulty ladder.

**Weekly balance:** set counts per muscle, averaged over the 3 loading weeks. Direct sets count fully, indirect sets count 0.5, rounded.

| Muscle | Avg sets/week | Status |
|---|---|---|
| Quads | about 8 | ok |
| Glutes/hamstrings | about 9 | ok |
| Chest | about 9 | ok |
| Back | about 6–7 | ok; a future focus |
| Side delts | about 6 | ok only because it's block 1's focus |
| Biceps | about 9 | ok |
| Triceps | about 8 | ok |
| Rear delts | about 3 | minor-muscle floor met |
| Calves | about 2–3 | minor-muscle floor met; running adds some |
| Core | 16 (Sat), all 8 dynamics | ok |
| Grip/forearms | 4 finisher sets + indirect from pulls and curls | ok |

Week 3 shifts once more (legs L, chest & biceps H, back M) at RIR 1–2. Week 4 is the deload. Block 2 rotates one or two base slots per day and moves the focus to chest.

## 7. Decisions I need from you

1. **Upper pairing:** Wed chest & biceps and Fri back, triceps & shoulders (Anatoly's own split, my pick), or Wed push and Fri pull?
2. **Core day:** Saturday (my pick) or Sunday?
3. **Core periodization:** light wave as in 4.2 (my pick), or flat?
4. **Anatoly-style heavy top set (1 × 3–5, later doubles):** start in block 3 (my pick), start now, or never?
5. **Effort logging:** an optional one-tap Easy/Right/Hard (my pick), a typed RIR number, or nothing?
6. **Variety:** V slots on lighter days plus one or two core swaps per block (my pick), more, or less?
7. **Exclusions:** any injuries, movements you hate, or missing equipment? Default: none. For home core, I'm assuming a set of resistance bands with a door or post anchor, plus your 25 and 35 lb kettlebells.

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
- The reading of what makes AnatolyFit feel "strange" (section 1)
- The specific zone rep ranges, the role × zone set table, the day slot templates and the V-slot mechanism (synthesized from refs 4–8, 17 and your session-size numbers)
- The weekly-floor and block-average coverage thresholds
- The calendar slide and skip rules for missed sessions
- The 8-dynamic core template, the core wave and the recommendation to keep it
- The grip finisher placement on M and L days
- The focus-muscle rotation
- The one-third rotation cap (an operationalization of ref 8)
- The e1RM smoothing and the specific progression thresholds
- The 10-day gap rule
- The running-placement rules beyond ref 12
- The calorie-surplus note
