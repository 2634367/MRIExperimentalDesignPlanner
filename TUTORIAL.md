# Tutorial

This walks through a design from an empty experiment to a run. It takes one example: participants see a cue, then a word, and press a key. Replace the example with your own task as you go.

Words in **bold** are the app's own labels. For installing and starting the app, see [README.md](README.md).

## Start an experiment

Open **Experiments**. Under **New experiment**, type a **Name**. Set **Start from** to **Blank**, or to **A small example** if you would rather edit a working design. Press **Create**.

The sidebar now shows the design screens. Edits save on their own, and the badge beside the title says **Unsaved**, **Saving…** or **Saved**. Ctrl+Z undoes and Ctrl+Y redoes.

A design holds everything by id, not by name. You can rename or reorder anything without breaking what uses it.

The order below is one that works, not one the app enforces. **Things to fix** on **Overview** lists what is wrong at any point.

## Prompts

A prompt list is a table of what varies from trial to trial: the word, the picture, the answer, a category to balance.

1. Open **Prompts** and press **New prompt list**. Give it a **List name**.
2. A new list has two **Columns**: Text and Image. Each column has a **Label**, a **Key** and a **Type** (**Text**, **Picture** or **Number**). Press **Add column** and add one called Category.
3. Under **Items**, press **Add item** and fill in a few rows.

For a long list, use **Import CSV / paste**. The first row names the columns. Names that match a column fill it, and new names become new columns. Under **Existing items**, choose **Keep them, add these** or **Replace them**. In a picture column, a web address is downloaded and a copy kept. A picture's name matches one already on the **Pictures** screen.

The key is what a layer uses to show a column, written `{text}` or `{category}`. Renaming a key updates every layer that uses it.

### Pictures

**Pictures** holds every picture the experiment can show. Use **Upload pictures**, drop files on the screen, or paste **Or a picture's web address** and press **Download a copy**. The server keeps its own copy, so a run never depends on the original site. PNG, JPEG, GIF and WebP are accepted.

## Trial types and phases

A trial type is a sequence of phases. Each phase lasts a fixed or jittered time and shows a stack of layers. Kinds of trial that differ in their cue, task or timing are different trial types. Each trial type is its own condition.

Open **Trial types** and press **New trial type**. It starts with a Fixation phase and a Prompt phase that shows `{text}`.

### Where the items come from

Under **Prompts**:

- **Draws items from** picks the list. **No list (same screen every trial)** is also allowed.
- **Order** is **Shuffled** or **In list order**.
- **Repeats** is **Not within a session**, **Not within a run** or **Allowed**.
- **Balance by** picks a column to keep even. With exactly two values, **Share (%)** sets how often the first comes up. 50 is even.
- **Only items where** … **is one of** narrows the list.

**Repeats** and **Balance by** apply to **Shuffled** only. **In list order** walks through the list and wraps round.

Two trial types can use **Only items where** to draw different parts of one list. They still never repeat an item between them, because the items already used are tracked per list.

If a list runs out of items, it starts over rather than failing. **Things to fix** warns of this ahead of time, and the run dialog says so when it happens.

### Phases

Press **Add phase** for each screen in the trial. For each one, set:

- **Phase name**.
- **Duration**: **Fixed**, or one of the jitter settings in the next section.
- **Model this phase in the HRF analysis (one regressor)**: tick this on the phases you will analyse.
- **Record keys**: the keys to record in this phase, for example `1, 2`. The first press is the response, with its time. Every press stays in the run record.
- **Blank the screen after a response**: this clears the screen when the key comes. The phase still runs to its full length, so the timing does not change.
- **Expected key**: which key is right, so answers can be scored. **Always 1** expects the same key on every trial. **From column: Answer** lists each value of that column this trial type can draw (yes, no) and lets you pick a key for each: yes → 1, no → 2. For an opposite-answer control, map them the other way round. A value left on **not scored**, such as a question with no right answer, is not counted. The runner writes `expected_response` and `correct` into the events file, and **Results** shows accuracy and reaction times.

A response key must not also be the **Trigger key**. **Things to fix** flags that as an error, and the runner refuses to start in wait mode.

### What is on screen

Under **On screen**, add layers: **Text**, **Picture**, **Shape** or **Fixation mark**. Layers stack in order, and the preview shows the result. **One trial** shows the whole trial to scale.

Sizes and positions are in screen heights, as in PsychoPy's height units. The screen is 1 tall, the middle is 0,0, the top is +0.5 and the right edge is +0.8 on a 16:10 screen.

A layer's text can mix words and `{column}` values. **Insert:** adds one for you. A picture layer can use **From column**. A layer that comes out empty is not drawn, so one trial type can serve items with and without a picture.

Press **Play this trial** to see one trial with a chosen item.

## Jitter

A jittered wait has its own window, **Min (s)** and **Max (s)**, and a way of drawing inside that window. In the phase's **Duration** you choose one of these:

| Choice | What it does |
|---|---|
| **Fixed** | Always the same number of **Seconds**. |
| **Design jitter (geometric)** | Follows the design-wide setting. The name in brackets shows the current mode. The phase keeps its own window. |
| **Jittered (geometric, whole TRs)** | Its own setting: **Min (s)** plus a whole number of TRs. |
| **Jittered (uniform)** | Its own setting: anywhere in the window. |
| **Jittered (exponential)** | Its own setting: short waits are likelier. |

The design-wide setting lives on **Scanner & display**, under **Jitter**. Choose it once and every phase on **Design jitter** follows. A new trial type's jittered phases follow it. So does a new phase once you pick **Design jitter**. The card tells you how many do: "{n} of {total} jittered waits follow this."

Under **Jitter**:

- **Mode** picks geometric, uniform or exponential.
- **p (next-TR chance)**, for geometric: the chance the wait ends on each next TR.
- **Cap (TRs)**, for geometric: the most extra TRs any wait can add. 0 means only the phase's own window limits it.
- **Mean (share of range)**, for exponential: how short the waits tend to be.

Lead-ins and lead-outs on **Runs** use the same control.

### Why geometric is the default

With a geometric wait, the chance that the next event comes on the next TR is always p. The participant cannot learn to expect it. That holds until the last rung of the window, where the event becomes certain.

Take a TR of 2 s, **Min (s)** 2, **Max (s)** 6 and p 0.5. The wait can be 2, 4 or 6 s. They come up 57%, 29% and 14% of the time, and the mean is 3.14 s.

- A flat window of 2 to 6 s would average 4 s. The **Jitter** card reports the difference for each trial type: "saves 0.86 s per trial against a flat window."
- Under the phase, **Show the distribution of waits** draws the rungs and gives the share of trials that land on the last one, where an ideal observer knows the event comes next.
- The table **Jitter: every wait** lists every wait in the design, and whether it follows the design or has its own setting.

If the window is shorter than one TR, a geometric wait never varies. **Things to fix** says so.

**Round to the TR** appears on a uniform or exponential wait, and rounds each draw to the TR grid.

## The fixation mark and What's on screen

**Scanner & display** holds one **Fixation mark** for the whole design. It is set once. A **Fixation mark** layer holds nothing of its own: it shows this mark. Changing the mark changes every screen that shows it. New trial types, lead-ins, lead-outs and rests use it.

**What's on screen** lists everything the design shows, once each, with its **Size**, how many uses it has and **Where**. Two layers count as the same when they would look the same in the same place. So hand-made copies of a cross show up as one row with a count.

Nothing is linked until you ask. A "+" on one screen is not always the same thing as a "+" on another. A row that could be a mark has two buttons. That means a shape, a picture, or text of up to 12 characters, with no `{column}` in it:

- **Link to the mark** replaces those copies with the fixation mark. They will look like the mark.
- **Use as the mark** makes this layer the fixation mark and links its copies. Screens already showing the mark change too.

## Scanner & display

While you are on this screen, set up the rest of it. Under **Scanner**:

- **TR (seconds)**. A run can use its own.
- **Dummy volumes**: the trigger pulses to wait for. The run starts on the last one.
- **Trigger key**: the key the scanner's trigger box sends, for example `5`.
- **Run clock starts at**: see [below](#run-clock-starts-at). Do not skip this.

Under **Keys**, **Quit keys** stop the run at once, and **Continue keys** dismiss the instructions and move between runs.

Under **Display**, set **Background**, **Text color**, **Font** and **Screen shape**. **Screen shape** is only for previews here. PsychoPy and the player use the real screen.

### Run clock starts at

t0 is the moment every onset is measured from. Everything in your analysis hangs on it. This setting decides which pulse is t0.

| Setting | t0 is | Use it when |
|---|---|---|
| **Last dummy pulse** | The last of the **Dummy volumes** pulses. | The scanner sends a pulse for each dummy volume. |
| **Pulse after the dummies** | The pulse after the last dummy, so one more than **Dummy volumes**. | The scanner sends a pulse for each dummy volume, and a pulse marks the start of its volume, so this pulse starts the first volume you keep. |
| **First pulse** | The very first pulse. No player waits for more. | The scanner sends no pulses during its dummy volumes. |

**Ask your site whether pulses arrive during dummy volumes, and whether a pulse marks the start of its volume.** The design cannot find this out, and scanners differ. Ask the people who run yours, set this to match, and test it before a real participant.

This is what goes wrong if the setting is wrong. Say you have 4 dummy volumes, the scanner sends no pulses during them, and you left **Last dummy pulse** set. The first pulse is then the first real volume. The player waits for 4 pulses, so it starts on the fourth real volume:

- Every onset is 3 TRs late against your data.
- The run starts inside real data, and the participant is still on the waiting screen during the first volumes.
- The run outlasts a scan sized for it, so its end is not scanned.

The runner helps you catch this. After a run in wait mode it compares the pulses it saw with the plan. If they fall short by about the dummy volumes, it warns that t0 was late and says to set **Run clock starts at** to **First pulse**.

With **Last dummy pulse**, t0 is the pulse of the last dummy volume. If a pulse marks the start of its volume, that is one TR before the first volume you keep, and **Pulse after the dummies** is the one you want.

## Runs and blocks

A run is one scan: instructions before the trigger, then a lead-in, blocks of trials, rests and a lead-out, all on one timeline. Its length here is its length in the scanner.

Open **Runs** and press **New run**.

- **Scanner card** picks a sequence. Its TR is this run's TR. With **None: TR below**, set **TR for this run**, or leave it empty to use the experiment's TR.
- **Dummy volumes**: leave empty for the experiment's setting.
- **Instructions**: **Show instructions before waiting for the scanner** puts a screen up until a continue key is pressed. It is not part of the timed run.
- **Lead-in** and **Lead-out**: screens at the start and end of the run. They show the fixation mark unless you change them. Their duration can be jittered.

Under **Blocks**, press **Add block**:

- **Add trial type** adds a row. Choose the **Trial type** and **How many**. A mix of several trial types is normal.
- **Trial order** is **Shuffled**, **As listed** or **Alternating**.
- **Repeat** plays the block that many times.
- **Rest after the block** is a screen after each repeat of this block, except at the very end of the run.

**Length and timeline** shows **Trials**, **Length** and **Volumes**. A length with jitter shows its range. Press **Play / run…** to play this run on its own.

## Sessions

A session is one visit: runs, other scans and breaks, in order.

Open **Sessions** and press **New session**. **Per participant** is how many of this session each participant does.

### Steps

Add steps with the **Run**, **Other scan** and **Break / setup** buttons. Each row has:

- **Kind**: you can change it after adding the step.
- **What**: the run, or a name. An **Other scan** can also pick a card.
- **Minutes**: for a scan or a break. A scan whose card gives a length shows **from the card**. Pick **None: type a name** as the card to set minutes by hand.
- **Times**: how many times this step happens, 1 to 100. A run ×3 is three runs from then on. It compiles, counts and plays as three.
- **Starts**: when the step begins, from the start of the session.
- **Length**: the step's total, repeats included.

To change the order, drag a step by its grip, or use **Move up** and **Move down**.

**Duplicate** adds a copy just below.

The switch sets **Switch this step off**. An off step stays in the list and shows **off**, but it takes no time and does not play. It is treated as if it were not there, so two runs either side of it count as back to back. Use it to try a session with and without a scan, without losing the step.

### Automatic breaks

**Break between back-to-back runs** adds a break between two runs that follow each other directly. It also adds one between the repeats of a run with **Times** above 1. 0 means none. These show as **Automatic break between runs**.

A break, automatic or typed in, belongs to the run before it. When a session plays, the screen between those two runs shows it. The break does not end by itself: a continue key starts the next run. A break before the first run or after the last has no screen, but it still counts towards the session's length. An **Other scan** step between two runs counts towards the length too, but it puts nothing on the participant's screen.

**Play / run the session…** plays every run in order, drawn together, so **Not within a session** holds across all of them.

## Overview

**Overview** adds up what the design costs.

### Identity

Under **Experiment**, **Experiment name** and **Notes** are for you. **Investigator**, **Institution** and **Design ID** are who the exports say the design belongs to. They appear in the report's Summary.

### Hours

Under **Scanner hours**, set **Hours available** and **Participants**. The table lists each session's **Length**, **Per participant** count and **Hours (all participants)**. Change the counts here or on **Sessions**. The app does not choose counts for you. It tells you what yours come to, and how many participants the hours would fit.

Hours are split in two:

- **Functional** is time in runs, from the first dummy volume to the end of the lead-out.
- **Overhead** is everything else in a session: setup, other scans and breaks.

**Charge overhead to the hours** decides whether overhead counts against **Hours available**. With it off, overhead is still reported, but it costs nothing. Use that if your site charges only for scanning time.

Lengths use the mean of every jittered wait. Going over **Hours available** is a warning, not a refusal.

**Raw functional data** estimates the size of the data at 16 bits, for the runs whose card gives a matrix and slices.

### Calendar

Optional. It tells you whether the study fits your scanner booking. Set **Sessions per week** and **Weeks available**. The weeks needed are all sessions, for all participants, at that rate. Going over only shows a warning.

### Limits

Optional. Set **Longest run (min)**, **Longest session (min)** and **Most runs per session**. Leave at 0 for no limit. Going over one only shows a warning under **Things to fix**. Runs and sessions are checked at their longest possible length, not their mean.

**Trials across the study** and **Prompt lists** show the totals that follow from your numbers.

## Scanner cards

**Scanner cards** is one library for the whole team. A card holds a sequence page by page, as the console shows it. It is not part of any one experiment, so a change reaches every design that uses it.

A new database starts with a set of example cards. Press **New blank card**, or open one and change it. Set **Name**, **Kind** and **Note**. Under **Console pages**, **Add a page** and **Add parameter** build the card. **Find a parameter** filters a page. **Copy as Markdown** copies a card.

The app reads a few rows by name:

| Parameter | Used for |
|---|---|
| `Act. TR/TE (ms)` | A run's TR, and the methods |
| `Total scan duration` | A scan step's length |
| `dyn scans`, `dummy scans` | **Write timing to card** |
| `Reconstruction matrix`, `slices` | **Raw functional data** |
| `ACQ voxel MPS (mm)`, `Flip angle (deg)`, `MB Factor`, `Fast Imaging mode`, `technique` | The report |

The TR is taken only from a **Functional EPI** or **Reference and field maps** card. A structural "TR" is per excitation, not per volume.

A run or step keeps a snapshot of the numbers it took, so a plan or share link never needs the library. If the card changes later, the run or step offers **Card changed: update**.

**Write timing to card** on **Runs** goes the other way. It puts a run's volumes, dummy scans and length into its card, after saying what will change. It appears when they differ. Remember that the card is shared.

Every save keeps a copy of what it replaced. **Earlier versions** lists them, and **Restore** puts one back.

## The HRF model and the graphs

**HRF model** sets the response every graph uses. The default is the canonical double gamma (SPM). The sliders change **Peak delay (s)**, **Peak dispersion**, **Undershoot delay (s)**, **Undershoot dispersion**, **Peak to undershoot ratio** and **Evaluate over (s)**. **Reset to the canonical response** puts them back.

**How long recovery takes** shows how long an event's response takes to settle. **Modelled phases** lists the regressors. Each ticked phase is one, named after its trial type.

### Predicted response (Trial types)

This shows the BOLD response each modelled phase predicts, over two trials back to back at mean phase durations. Read these two columns:

- **Under next peak**: how much of a response is still standing when the next modelled phase peaks.
- **Left at next trial**: what it still has when trial 2 opens.

Both fall as you lengthen the phases between them and the fixation at the end of the trial. Ctrl/⌘ + scroll zooms and dragging pans.

### Design efficiency (Runs)

This measures how well a run lets each modelled phase be estimated, on one real draw of it: the order, items and jitter it would really play. Regressors are the modelled phases convolved with the HRF, sampled at the TR, with linear and quadratic drift. **Re-draw** tries another draw.

| Figure | How to read it |
|---|---|
| **Vs baseline** | The lowest efficiency of any regressor against rest. Bigger is better. |
| **Between conditions** | The lowest efficiency of any difference between regressors. |
| **Largest \|r\|** | The highest correlation between two regressors. |
| **Largest VIF** | 1 is ideal; above 5 is a problem. |
| **Single-trial** | One beta per event (LSA). |
| **Modelled time** | The share of the run in modelled phases. |
| **Stacking gain** | Peak signal over one trial alone. |
| **Duty cycle** | Median signal over its 95th percentile. |

Compare efficiency only between runs with the same HRF and TR. The numbers mean nothing on their own.

If a run's modelled phases are hard to tell apart, **Things to fix** warns. It does so when the largest |r| is above 0.8 or the largest VIF is above 5, on the first draw. More jitter or a different order helps. **Contrasts** and **Correlations** have the detail.

## Report

**Report** gathers the design for a paper, a protocol or a colleague.

- **Methods**: a paragraph written from the design. Edit it here before copying, but edits are not saved. **Write it again** replaces it.
- **Tables**: every table, with **Copy all (Markdown)** and **Copy all (Word)**.
- **Figures**: every figure, as SVG or PNG.
- **Download report (.zip)**: report.xlsx (one sheet per table), report.md, methods.txt, each table as Markdown, every figure as SVG and PNG, each scanner card the design uses, and the experiment file. **XLSX only** and **Markdown (.md)** give parts of it.

**Efficiency draw** is the seed for the efficiency numbers in the report.

## Publish

**Locked order** is where the randomness gets decided, once. **Shuffle** picks the order, every jitter and every item, saves that in the design, and publishes it. From then on Publish and the run dialog use that order, for everyone, until you press **Shuffle again**, which asks first. Runs already played keep their own order in their records.

Pick a session or run to see its full list, trial by trial. A run played alone and the same run inside a session come out differently, so both are listed. **Download full list** is a CSV of every part of every run, with onsets in seconds from t0. **Download run files** is the PsychoPy bundle for the session or run you picked.

Three things can differ from the list. Editing the design keeps the seed, but changed parts come out differently, and the card says so. A participant's later visits from the run dialog avoid items they have seen. And **New random seed** in the run dialog tries another order, for that play only.

**Publish** puts this design's run plans and figures at addresses that stay the same, for a runner to fetch or a page to link to. They show what was published, so publish again after changing the design. The card says when the design has changed since. **Show the addresses** lists them.

Publish saves the design, then compiles every run and session with the locked order. Publishing again keeps that order. Three things follow:

- **Everyone who fetches gets the same order.** Same trials, same jitter, same items, until someone presses **Shuffle again**. For a different order per participant, shuffle between them, or use the run dialog and a bundle or a local launch.
- **A published session's `ses-` label is its place in the design.** It is not the participant's visit number. A session done three times by one participant has one set of plans, labelled the same each time. The runner keeps each attempt in its own folder and warns that results already exist.
- **Published plans ignore what a participant has seen,** and they have no participant in them. Pass `--participant` to the runner.

A runner on the stimulus machine then needs an API key in a file. See [the README](README.md#publish-then-runner-fetch) for the command. If the network fails at the scanner, the last fetched copy still runs.

Other people can see a design without an account through a read-only share link. Make one on **Experiments** under **Read-only share links**.

## Running it

Every Play button opens the same dialog. Its title says what will play.

### The options

| Option | What it does |
|---|---|
| **Participant** | Labels the results, and decides whose history items are drawn against. The app remembers it. |
| **Seed** | Decides every jitter and every item, so a seed gives the same run everywhere. The dialog opens on the locked order if the design has one, and on a new seed if not. **New random seed** tries another, for this play only. |
| **Scanner** | **Wait for the trigger key**, **Simulate trigger pulses** or **No scanner: start at once**. |
| **Browser speed** | Faster than real time, to check a run quickly. Browser only. |
| **Visit** | Sessions only. The `ses-` label. Empty means the next one for this participant. |
| **Blocks to play** | A number shortens each run, for a pilot. |
| **PsychoPy screen** | 0 is the main display. |
| **Mirror** | PsychoPy only, for optics that reverse the screen: **None**, **Left-right**, **Up-down** or **Both**. |
| **In a window (not full screen)** | For checking. |
| **Debug: space pauses PsychoPy (not for real data)** | PsychoPy only. |

The line under the options sums up what will play: runs, trials, time after the trigger and volumes. It also says if any list ran out, what this participant has already seen, and if this is a pilot.

The dialog remembers your last choices. The first time, it starts on **Simulate trigger pulses** and **In a window (not full screen)**. **For a real scan, set Wait for the trigger key and untick In a window.**

Then press one of:

- **Play in browser**: to look at it. Nothing is saved, and nothing counts as seen.
- **Run in PsychoPy**: on this machine, when the server can. The dialog shows the log and a **Stop** button.
- **Download for PsychoPy**: a zip for another machine. The dialog then shows the command, with your options as flags.

### Mirror

Some scanner setups show the screen through a mirror, which reverses it. **Mirror** flips everything drawn, text included, and the plan stays the same: it is a fact about the room, not about the design. The run record notes it. For a bundle, it appears in the command as `--flip`. Check it at the scanner with a screen of text.

### Simulate or wait

**Simulate trigger pulses** counts pretend pulses at the TR, then starts. Use it for anything that is not a real scan. The timing behaves as it will in the scanner, with no scanner needed.

**Wait for the trigger key** counts real pulses on the **Trigger key**. It waits for the **Dummy volumes** (one more with **Pulse after the dummies**, one pulse in all with **First pulse**), and t0 is the last pulse it waits for. There is no time limit, and the quit key always works. In the runner:

- The screen shows how many pulses have come. The terminal speaks up after 30 s of nothing.
- If pulses stop for 3 TRs during the run, the terminal warns once and the run carries on.
- On a Mac, see [macOS Input Monitoring](README.md#macos-input-monitoring) before you trust the keyboard.

The trigger box is usually a keyboard. On a stimulus machine, confirm which key it sends. You can test by pressing that key yourself with **Wait for the trigger key** and **In a window (not full screen)**.

### Pilots

Set **Blocks to play** to shorten each run. It plays the first N block repetitions. A block with **Repeat** 3 counts as 3. The trials kept are exactly the ones the full run would have started with, and the lead-out moves up behind them.

A shortened run says so in the dialog, is named `acq-pilot`, and is not counted as seen. A number at or above the run's blocks cuts nothing, so that run is an ordinary run.

The runner's `--pilot` does the same for a bundle: the first 2 blocks, no scanner, in a window.

### Visits

A session done more than once is more than one visit. **Visit** is the `ses-` label, so the second time a participant does a session it should be `ses-02`.

Leave it empty and the app works it out: one past the highest visit recorded for this participant. If it has none on record, it uses the session's place in the design. The empty field shows the number it will use.

This relies on the record, so a bundle's results must come back through **Add run results** before the next visit is worked out. To be sure, type the number.

### Seen items

The app records what each participant has actually been shown, so a later visit can prefer items they have not met.

This comes from run records, not plans. A run stopped early counts for exactly what reached the screen. A bundle that was never played counts for nothing.

- **Run in PsychoPy** records it when the runner exits.
- **Download for PsychoPy**: press **Add run results** and choose the `.json` run records from the bundle's data folder. They go on Results too. Adding a file twice changes nothing.
- **Play in browser** records nothing.
- Pilots, single-trial previews and runs with no participant do not count.

When you type a **Participant**, the dialog fetches their history and draws against it. It tells you how many items they have seen. Preferring unseen items is a preference, not a rule. When nothing else is left, items repeat and the dialog says which lists did. Trial types set to **Allowed** or **In list order** ignore it.

### Debug

There are two debug tools.

In the browser player, the bug button (**Debug window**) opens a filterable log of everything that happened, how far each onset landed from the plan, and **Jump** to any trial. The player also has **Speed**, **Pause / resume** and **Skip to the next screen**.

In PsychoPy, **Debug: space pauses PsychoPy (not for real data)** lets space hold the run, and space again resume it. Each remaining phase keeps its full length, so the run clock stops. A real scanner does not stop, so a paused run's onsets no longer line up with its volumes. The record says so and lists every pause. The runner refuses this if space is also a response key.

### During and after a run

Quit keys stop the run. Whatever ran is saved. The runner prints the `--from-run` number that starts again at that run. **Stop** in the dialog does the same.

Between runs, the screen shows the planned break, and a continue key starts the next run. That gives you time to restart the scanner.

Results are named and laid out as in [the README](README.md#where-results-go). Each start of the runner gets its own folder, so nothing is overwritten. Before you trust a run, read its closing line: segments played, responses, pulses seen against planned, and dropped frames.

The **Results** screen keeps that check for every run. A local launch's runs appear when PsychoPy closes. For a bundle, press **Add run results** (on Results or in the run dialog) and choose the `.json` records. Each run gets a verdict: **OK**, **Check** (late screens, dropped frames, a quiet scanner) or **Unusable** (stopped, failed, paused, or pulses that do not cover the run), with the reasons beside it. Use **Everyone** to pick one participant. Where phases have an Expected key, each run also shows how many answers were right, the misses and the mean reaction time of right answers, and **Behaviour** adds these up per participant, or per trial type for one participant.

### Before a real participant

- [ ] Your site has told you whether pulses arrive during dummy volumes and whether a pulse marks the start of its volume, and **Run clock starts at** matches.
- [ ] **Things to fix** has no errors.
- [ ] **Participant** is set, and **Visit** is right.
- [ ] **Scanner** is **Wait for the trigger key**.
- [ ] **In a window (not full screen)** is off, and **PsychoPy screen** is the participant's display.
- [ ] **Mirror** is right for the room.
- [ ] **Debug** is off, and **Blocks to play** is empty.
- [ ] The keyboard warning is absent on a Mac.
- [ ] A test run's closing line shows pulses matching the plan.
