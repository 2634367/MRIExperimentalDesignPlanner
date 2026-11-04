"""Plays fMRI run plans in PsychoPy.

A run plan (format fmri-run-plan/1) is made by the fMRI Experiment Designer:
every onset, every jittered duration, every prompt item and every layer on
screen already decided. This package only draws it on time, waits for the
scanner, records key presses, and writes down what happened. It knows nothing
about trial types, prompt lists or jitter, which is what keeps it in step with
the designer's own browser player: both play the same file.

    python -m fmri_runner plans/run-01.json [more.json | a folder] [options]

It needs Python 3.9+ and PsychoPy; nothing else.
"""

__version__ = "1.0"
FORMAT = "fmri-run-plan/1"
