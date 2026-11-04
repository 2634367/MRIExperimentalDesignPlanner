"""Writes misc/inner-speech-v4.json: Inner Speech Decoding V4, every aim.

usage: make_v4.py OUT AIM1_COUNT AIM2_COUNT AIM3_COUNT
"""
import json
import random
import sys

OUT = sys.argv[1]
COUNTS = [int(x) for x in sys.argv[2:5]]

n = {"i": 0}


def uid(prefix):
    n["i"] += 1
    return f"{prefix}_v4{n['i']:04d}"


CARDS = {
    "EPI-TR2000-Task": {"id": "EPI-TR2000-Task", "label": "Task EPI - TR 2000 ms", "tr": 2, "seconds": 1439.9},
    "EPI-TR1000-Task": {"id": "EPI-TR1000-Task", "label": "Task EPI - TR 1000 ms", "tr": 1, "seconds": 1439.9},
    "EPI-TR800-Task": {"id": "EPI-TR800-Task", "label": "Task EPI - TR 800 ms", "tr": 0.8, "seconds": 1536.7},
    "Survey-Localizer": {"id": "Survey-Localizer", "label": "Survey / Localizer", "tr": 0, "seconds": 27},
    "SENSE-Reference": {"id": "SENSE-Reference", "label": "SENSE Reference", "tr": 0, "seconds": 24.4},
    "T1-Anatomical-MPRAGE": {"id": "T1-Anatomical-MPRAGE", "label": "T1 Anatomical (MPRAGE)", "tr": 0, "seconds": 384.9},
    "EPI-SBRef": {"id": "EPI-SBRef", "label": "Single-Band Reference", "tr": 4, "seconds": 27.9},
    "Field-Map-Reverse-PE": {"id": "Field-Map-Reverse-PE", "label": "Field Map (Reverse PE)", "tr": 4, "seconds": 27.9},
}

# -- the question bank ---------------------------------------------------------

GK, AR, RH, CA, BI, EM, AM = ("General Knowledge", "Arithmetic", "Rhyme Judgment", "Category",
                              "Biographical", "Emotional", "Ambiguous Category")
STANDARD = [GK, AR, RH, CA, BI, EM]

GK_YES = ["Is fire hot ?", "Is the sun a star ?", "Is water wet ?", "Is snow cold ?", "Do birds have feathers ?",
          "Is the ocean salty ?", "Do cows give milk ?", "Is grass green ?", "Does the moon orbit the Earth ?",
          "Do plants need sunlight ?", "Is ice frozen water ?", "Do bees make honey ?", "Is the Earth round ?",
          "Do fish live in water ?", "Is a year twelve months long ?", "Is gold a metal ?", "Do spiders have eight legs ?",
          "Does the sun rise in the east ?", "Is the Pacific an ocean ?", "Do people need oxygen ?"]
GK_NO = ["Is ice warm ?", "Is the sky green ?", "Do cats lay eggs ?", "Is the sun cold ?", "Is sugar salty ?",
         "Can pigs fly ?", "Is the moon made of cheese ?", "Does the sun set in the north ?", "Is a week ten days long ?",
         "Do trees walk ?", "Is lead lighter than air ?", "Do dogs have wings ?", "Is coal white ?", "Do horses lay eggs ?",
         "Is milk black ?", "Is the Earth flat ?", "Do rocks grow on trees ?", "Is a minute an hour long ?",
         "Do worms have bones ?", "Is rain made of sand ?"]

RH_YES = [("cat", "hat"), ("dog", "log"), ("tree", "sea"), ("cake", "lake"), ("moon", "spoon"), ("ring", "sing"),
          ("bell", "well"), ("rain", "train"), ("star", "car"), ("light", "night"), ("boat", "coat"), ("mouse", "house"),
          ("bed", "red"), ("fish", "dish"), ("book", "cook"), ("hand", "sand"), ("bear", "chair"), ("snow", "glow"),
          ("king", "wing"), ("pen", "ten")]
RH_NO = [("dog", "cup"), ("book", "lamp"), ("tree", "door"), ("sun", "fork"), ("cat", "milk"), ("ring", "shoe"),
         ("bell", "rope"), ("rain", "desk"), ("star", "leaf"), ("light", "bread"), ("boat", "sock"), ("mouse", "tent"),
         ("bed", "kite"), ("fish", "clock"), ("hand", "rug"), ("goat", "bin"), ("bear", "mop"), ("king", "bowl"),
         ("pen", "tub"), ("moon", "gift")]

CA_YES = ["Is a triangle a shape ?", "Is a rose a flower ?", "Is a dog an animal ?", "Is an apple a fruit ?",
          "Is a carrot a vegetable ?", "Is a hammer a tool ?", "Is a piano an instrument ?", "Is an oak a tree ?",
          "Is an eagle a bird ?", "Is a shark a fish ?", "Is red a colour ?", "Is a chair furniture ?",
          "Is a car a vehicle ?", "Is Monday a day ?", "Is July a month ?", "Is a salmon a fish ?",
          "Is a square a shape ?", "Is a violin an instrument ?", "Is a tulip a flower ?", "Is a wrench a tool ?"]
CA_NO = ["Is a carrot a vehicle ?", "Is a hammer an animal ?", "Is a rose a tool ?", "Is an apple a bird ?",
         "Is a piano a fruit ?", "Is an oak a fish ?", "Is an eagle a vegetable ?", "Is a shark a flower ?",
         "Is a chair a colour ?", "Is a car a month ?", "Is Monday a shape ?", "Is July an animal ?",
         "Is a salmon furniture ?", "Is a violin a tree ?", "Is a tulip a vehicle ?", "Is a wrench a fruit ?",
         "Is a triangle a bird ?", "Is a banana a tool ?", "Is a spoon an animal ?", "Is a cloud a vegetable ?"]

BIO = ["Is your father’s name Paul ?", "Were you born in winter ?", "Do you have a sister ?", "Do you have a brother ?",
       "Do you live in a city ?", "Were you born in Ohio ?", "Do you own a car ?", "Do you have a pet ?",
       "Is your mother’s name Mary ?", "Did you go to college ?", "Are you left-handed ?", "Do you wear glasses ?",
       "Have you been to Europe ?", "Do you speak Spanish ?", "Is your favourite colour blue ?",
       "Do you play an instrument ?", "Were you born before 1990 ?", "Do you have children ?", "Have you lived abroad ?",
       "Do you drink coffee ?", "Is your birthday in summer ?", "Do you live alone ?", "Did you grow up on a farm ?",
       "Do you have a middle name ?", "Have you broken a bone ?", "Can you swim ?", "Do you like spicy food ?",
       "Have you flown in a plane ?", "Is your first name longer than five letters ?", "Do you own a bicycle ?",
       "Did you play sports in school ?", "Do you have a tattoo ?", "Were you the oldest child ?", "Do you cook at home ?",
       "Have you seen the ocean ?", "Do you work at a university ?", "Do you have a garden ?",
       "Have you run a marathon ?", "Do you read before bed ?", "Do you live near a river ?"]

EMO = ["Are you uncomfortable ?", "Are you tired ?", "Do you feel calm ?", "Are you hungry ?", "Are you cold ?",
       "Are you thirsty ?", "Are you bored ?", "Do you feel anxious ?", "Are you happy right now ?", "Are you relaxed ?",
       "Do you feel sleepy ?", "Are you warm ?", "Do you feel restless ?", "Are you in pain ?", "Do you feel alert ?",
       "Are you stressed ?", "Do you feel content ?", "Are you nervous ?", "Do you feel focused ?", "Are you excited ?",
       "Do you feel sad ?", "Are you comfortable ?", "Do you feel rested ?", "Are you frustrated ?", "Do you feel safe ?",
       "Are you annoyed ?", "Do you feel energetic ?", "Are you worried ?", "Do you feel peaceful ?", "Are you itchy ?",
       "Do you feel dizzy ?", "Are you lonely ?", "Do you feel confident ?", "Are you impatient ?",
       "Do you feel cheerful ?", "Are you curious ?", "Do you feel heavy ?", "Are you distracted ?",
       "Do you feel hopeful ?", "Are you sore ?"]

AMB = ["Is a whale a fish ?", "Is a tomato a vegetable ?", "Is a bat a bird ?", "Is a peanut a nut ?",
       "Is Pluto a planet ?", "Is a strawberry a berry ?", "Is a hot dog a sandwich ?", "Is glass a liquid ?",
       "Is a virus alive ?", "Is a cucumber a fruit ?", "Is a koala a bear ?", "Is a jellyfish a fish ?",
       "Is a starfish a fish ?", "Is a seahorse a fish ?", "Is a pumpkin a fruit ?", "Is a mushroom a plant ?",
       "Is coffee a bean ?", "Is soup a drink ?", "Is cereal a soup ?", "Is a dolphin a fish ?",
       "Is a pickle a vegetable ?", "Is a coconut a nut ?", "Is a cashew a nut ?", "Is a tortoise a turtle ?",
       "Is chess a sport ?", "Is a tablet a computer ?", "Is a moth a butterfly ?", "Is rice a grass ?",
       "Is a banana a herb ?", "Is a crocodile a dinosaur ?"]


def arithmetic():
    """20 true and 20 false statements, each answer computed."""
    rng = random.Random(4)
    out = [("Is 8 odd ?", "no")]
    seen = {("parity", 8)}
    want = {"yes": 20, "no": 19}
    while want["yes"] or want["no"]:
        kind = rng.choice(["odd", "even", "plus", "minus", "times", "greater"])
        if kind in ("odd", "even"):
            x = rng.randint(2, 30)
            truth = (x % 2 == 1) if kind == "odd" else (x % 2 == 0)
            text = f"Is {x} {kind} ?"
            key = ("parity", x)
        elif kind == "greater":
            a, b = rng.sample(range(2, 40), 2)
            truth = a > b
            text = f"Is {a} greater than {b} ?"
            key = ("greater", a, b)
        else:
            a, b = rng.randint(2, 9), rng.randint(2, 9)
            if kind == "minus" and b > a:
                a, b = b, a
            real = a + b if kind == "plus" else a - b if kind == "minus" else a * b
            say = real if rng.random() < 0.5 else real + rng.choice([-2, -1, 1, 2])
            truth = say == real
            text = f"Is {a} {kind} {b} equal to {say} ?"
            key = (kind, a, b)
        answer = "yes" if truth else "no"
        if key in seen or not want[answer]:
            continue
        seen.add(key)
        want[answer] -= 1
        out.append((text, answer))
    return out


rows = []
rows += [(q, GK, "yes") for q in GK_YES] + [(q, GK, "no") for q in GK_NO]
rows += [(q, AR, a) for q, a in arithmetic()]
rows += [(f"Does {a} rhyme with {b} ?", RH, "yes") for a, b in RH_YES] + [(f"Does {a} rhyme with {b} ?", RH, "no") for a, b in RH_NO]
rows += [(q, CA, "yes") for q in CA_YES] + [(q, CA, "no") for q in CA_NO]
rows += [(q, BI, "") for q in BIO] + [(q, EM, "") for q in EMO] + [(q, AM, "ambiguous") for q in AMB]
assert len({r[0] for r in rows}) == len(rows), "duplicate question"
for cat in (GK, AR, RH, CA):
    answers = [r[2] for r in rows if r[1] == cat]
    assert answers.count("yes") == 20 and answers.count("no") == 20, cat
assert len(BIO) == 40 and len(EMO) == 40 and len(AMB) == 30

questions = {
    "id": uid("list"), "name": "Questions",
    "notes": "V4 bank: 40 items per standard category (General Knowledge, Arithmetic, Rhyme Judgment and Category are "
             "20 yes / 20 no; arithmetic answers are computed), 40 Biographical and 40 Emotional with answers recorded "
             "per participant (Biographical in the training session, Emotional at each session's debrief), and 30 "
             "Ambiguous. Item id and every column are logged with each trial, so analyses can hold items out.",
    "columns": [{"key": "text", "label": "Text", "type": "text"}, {"key": "category", "label": "Category", "type": "text"},
                {"key": "answer", "label": "Answer", "type": "text"}],
    "items": [{"id": uid("i"), "values": {"text": q, "category": c, "answer": a}} for q, c, a in rows],
}

# -- screens and timings -------------------------------------------------------


def text(t, height=0.06, pos=(0, 0)):
    return {"id": uid("l"), "kind": "text", "text": t, "pos": list(pos), "height": height, "color": "", "wrap": 1.4, "bold": False}


def fixation():
    return [text("+", 0.08)]


def cue():
    # One answer cue for every condition, so the cue itself carries no label.
    return [text("+", 0.16)]


def fixed(v):
    return {"kind": "fixed", "value": v}


def geometric(a, b):
    return {"kind": "geometric", "min": a, "max": b, "p": 0.5, "snap_to_tr": False}


def phase(name, duration, layers, modelled=False, keys=None, ends=False):
    return {"id": uid("ph"), "name": name, "duration": duration, "layers": layers,
            "response": {"keys": keys or [], "ends_phase": ends}, "modelled": modelled}


def question_phases(prompt, long=False):
    """Fixation -> prompt -> jittered delay -> answer cue -> ITI; long is the
    separated calibration trial, whose responses return to baseline."""
    return [
        phase("Fixation", geometric(2, 6), fixation()),
        phase("Prompt", fixed(4), prompt, modelled=True),
        phase("Long wait" if long else "Delay", geometric(10, 14) if long else geometric(2, 5), fixation()),
        phase("Answer", fixed(4), cue(), modelled=True),
        phase("ITI", geometric(8, 12) if long else geometric(2, 5), fixation()),
    ]


def trial(name, color, notes, phases, values=None, column="category", balance=""):
    drawn = values is not None
    return {
        "id": uid("tt"), "name": name, "color": color, "notes": notes,
        "list": questions["id"] if drawn else "",
        "filter": {"column": column if drawn else "", "values": values or []},
        "order": "shuffle", "balance_by": balance, "no_repeat": "session", "phases": phases,
    }


line = lambda t: text(t, 0.04, (0, -0.15))
q = lambda: text("{text}")
PALETTE = ["#4c78a8", "#f58518", "#54a24b", "#e45756", "#72b7b2", "#b279a2", "#eeca3b", "#9d755d", "#bab0ac"]

standard = [trial(f"Q · {cat}", PALETTE[i], f"Standard question, {cat} only; yes and no balanced within the category.",
                  question_phases([q()]), [cat], balance="answer") for i, cat in enumerate(STANDARD)]
opposite = trial("Control · Opposite answer", "#d62728", "Answer the opposite of the true answer: the yes/no word without its meaning.",
                 question_phases([q(), line("Answer: the opposite")]), STANDARD, balance="category")
neutral = trial("Control · Neutral (ready)", "#17becf", "Read the question, answer the constant word \"ready\".",
                question_phases([q(), line("Answer: ready")]), STANDARD, balance="category")
no_answer = trial("Control · No answer", "#7f7f7f", "Read the question only, no inner speech.",
                  question_phases([q(), line("Read only – no answer")]), STANDARD, balance="category")
np_yes = trial("Control · No prompt – yes", "#2ca02c", "No question to read; answer \"yes\".", question_phases([text("Answer: yes")]))
np_no = trial("Control · No prompt – no", "#8c564b", "No question to read; answer \"no\".", question_phases([text("Answer: no")]))
ambiguous = trial("Control · Ambiguous", "#bcbd22", "Questions with no clear yes/no answer (whale/fish).",
                  question_phases([q()]), [AM])
check = trial("Check · Button press", "#393b79",
              "A standard question, then the answer on the button box (1 = yes, 2 = no) to check covert answers.",
              question_phases([q()]) + [phase("Button", fixed(3), [text("1 = yes        2 = no", 0.05)], keys=["1", "2"], ends=True)],
              STANDARD, balance="category")
aim1_yes = trial("Aim 1 · Yes question", "#1f77b4", "Aim 1 blocked design: only questions whose answer is yes.",
                 question_phases([q()]), ["yes"], column="answer", balance="category")
aim1_no = trial("Aim 1 · No question", "#ff7f0e", "Aim 1 blocked design: only questions whose answer is no.",
                question_phases([q()]), ["no"], column="answer", balance="category")


def localizer(word, color):
    return trial(f"Localizer · {word}", color, f"Cued repetition block: repeat \"{word}\" while the cross is shown.", [
        phase("Cue", fixed(2), [text(word, 0.1)]),
        phase("Repetition", fixed(16), cue(), modelled=True),
        phase("Rest", fixed(12), fixation()),
    ])


loc = [localizer("yes", "#3182bd"), localizer("no", "#e6550d"), localizer("ready", "#31a354")]
calibration = trial("Aim 3 · Separated calibration", "#636363",
                    "Fully separated trial (long wait and ITI), for long-delay reference data and FIR timing.",
                    question_phases([q()], long=True), STANDARD, balance="answer")

trial_types = standard + [opposite, neutral, no_answer, np_yes, np_no, ambiguous, check, aim1_yes, aim1_no] + loc + [calibration]

# -- runs ------------------------------------------------------------------------

INSTRUCT_Q = ("When the answer cue (cross) appears and for the entire duration it is shown, answer clearly and silently "
              "in your internal voice with a constant pacing of either \"yes, yes, yes …\" or \"no, no, no …\".\n\n"
              "\"Answer: ready\" – repeat \"ready\".   \"Answer: the opposite\" – repeat the opposite answer.\n"
              "\"Read only – no answer\" – just read, no inner speech.   \"1 = yes  2 = no\" – press the button.")
INSTRUCT_LOC = "When a word appears, repeat it silently at a constant pace for as long as the large cross is shown."


def block(name, mix, rest=0, order="shuffle"):
    return {"id": uid("b"), "name": name, "repeat": 1, "order": order,
            "mix": [{"trial_type": tt["id"], "count": c} for tt, c in mix], "rest_after": {"seconds": rest, "layers": fixation()}}


def run(name, notes, card, blocks, instructions=INSTRUCT_Q):
    ref = CARDS[card]
    return {"id": uid("run"), "name": name, "notes": notes, "tr": ref["tr"], "dummy_volumes": -1, "card": dict(ref),
            "instructions": {"enabled": True, "layers": [text(instructions, 0.04)]},
            "lead_in": {"seconds": 12, "layers": fixation()}, "lead_out": {"seconds": 12, "layers": fixation()},
            "blocks": blocks}


def question_blocks():
    std = [(tt, 1) for tt in standard]
    return [
        block("Third 1", std + [(opposite, 1), (neutral, 1), (no_answer, 1), (np_yes, 1)], rest=12),
        block("Third 2", std + [(opposite, 1), (neutral, 1), (no_answer, 1), (np_no, 1)], rest=12),
        block("Third 3", std + [(opposite, 1), (neutral, 1), (ambiguous, 2), (check, 1)]),
    ]


r_loc = run("Aim 1 — Block localizer", "Cued repetition blocks (yes / no / ready, 3 each, shuffled) for individual ROI definition.",
            "EPI-TR2000-Task", [block("Localizer", [(t, 3) for t in loc])], INSTRUCT_LOC)
r_blocked = run("Aim 1 — Blocked questions", "Affirmative answers first, then negative, then the neutral and read-only controls, "
                "with rests between blocks (Aim 1 approach).", "EPI-TR2000-Task", [
                    block("Yes answers", [(aim1_yes, 8)], rest=16),
                    block("No answers", [(aim1_no, 8)], rest=16),
                    block("Neutral (ready)", [(neutral, 4)], rest=16),
                    block("Read only", [(no_answer, 4)]),
                ])
r_aim2 = run("Aim 2 — Question run", "Event-related single-trial run for LSS betas: each third has one trial of every standard "
             "category plus controls; 31 trials.", "EPI-TR1000-Task", question_blocks())
r_aim3 = run("Aim 3 — Compressed question run", "The Aim 2 mix at TR 0.8 with the compressed prompt-to-cue delay; the bulk of "
             "Aim 3 data for the spatiotemporal models.", "EPI-TR800-Task", question_blocks())
r_cal = run("Aim 3 — Separated calibration run", "Session opener: 8 fully separated trials (long jittered wait and ITI), the "
            "long-delay reference and FIR timing data.", "EPI-TR800-Task", [block("Calibration", [(calibration, 8)])])
runs = [r_loc, r_blocked, r_aim2, r_aim3, r_cal]

# -- sessions ------------------------------------------------------------------


def step(kind, name="", minutes=0, run_id="", card=None):
    out = {"id": uid("st"), "kind": kind, "run": run_id, "name": name, "minutes": minutes, "card": None}
    if card:
        out["card"] = dict(CARDS[card])
        out["minutes"] = round(CARDS[card]["seconds"] / 60, 2)
    return out


def session(name, count, notes, run_ids):
    return {"id": uid("ses"), "name": name, "count": count, "notes": notes, "auto_break_minutes": 1, "steps": [
        step("break", "MRI safety screening", 6), step("break", "Positioning, coil, respiration belt and pulse oximeter", 5),
        step("break", "Cadence reminder", 4),
        *[step("scan", name=c, card=c) for c in ("Survey-Localizer", "SENSE-Reference", "T1-Anatomical-MPRAGE", "EPI-SBRef", "Field-Map-Reverse-PE")],
        *[step("run", run_id=r) for r in run_ids],
        step("break", "Debrief: unanswerable trials, state (Emotional) answers", 3),
    ]}


sessions = [
    session("Aim 1 — GLM session", COUNTS[0], "Localizers and the blocked yes/no design for the univariate GLM and individual ROIs; "
            "one event-related run as early Aim 2 data.", [r_loc["id"], r_loc["id"], r_blocked["id"], r_blocked["id"], r_blocked["id"], r_aim2["id"]]),
    session("Aim 2 — MVPA session", COUNTS[1], "Five event-related question runs at TR 1.0 for single-trial classifiers.", [r_aim2["id"]] * 5),
    session("Aim 3 — Time-series session", COUNTS[2], "A separated calibration run, then five compressed question runs at TR 0.8.",
            [r_cal["id"]] + [r_aim3["id"]] * 5),
]

doc = {
    "format_version": 1, "name": "Inner Speech Decoding — V4",
    "notes": "V4, built 2026-11-02 from the Inner Speech preliminary doc (Aims, Pitfalls, Procedure, Standard and Control "
             "Questions tabs). Hard limit: 100 scanner hours; session counts leave about 8% in reserve. Session 1 (consent, "
             "training, answering the full bank for ground truth) is outside the scanner and not counted. Design rules: one "
             "answer cue (large cross) for every condition so the cue carries no label; yes/no balanced within each standard "
             "category (one trial type per category); controls separate answer from question (opposite, no prompt yes/no, "
             "neutral \"ready\", read only, ambiguous); jittered prompt-to-cue delay; item and columns logged with every trial "
             "for item-held-out validation.",
    "scanner": {"tr": 2, "trigger_key": "5", "dummy_volumes": 4},
    "budget": {"hours_available": 100, "participants": 1},
    "lists": [questions], "trial_types": trial_types, "runs": runs, "sessions": sessions,
}
with open(OUT, "w", encoding="utf-8") as handle:
    json.dump(doc, handle, indent=1, ensure_ascii=False)
    handle.write("\n")
print(len(rows), "items,", len(trial_types), "trial types")
