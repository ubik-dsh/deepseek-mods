---
name: build-a-voice-reader
description: Build a voice reader that speaks an agent's answer aloud while it is still being written, for any language and any local text-to-speech engine. Use when asked to make an agent talk, to read answers aloud, to add speech output to a chat agent or a harness, or to port an existing reader to another language or another TTS model. Covers the live token stream hook, the warm synthesis process, text preparation for speech (numbers, units, foreign words, versions), a cache of filler phrases, a mute control, and the twelve failure modes that were measured while building one.
---

# Build a voice reader

A reader that speaks an answer **while it is being generated**, so the first word is heard about a
second after the answer starts, not after it ends. This document is the portable form of a working
Russian implementation; the code that implements it lives in `runtime/` next to this file, and every
claim here was measured on that implementation rather than reasoned about.

Read the section that matches your situation:

- **porting to another language or engine** → [What to replace](#what-to-replace);
- **building from scratch** → [Architecture](#architecture), then the traps;
- **fixing a reader that is slow, silent, or mangles words** → [The twelve traps](#the-twelve-traps).

## Architecture

Four parts, in the order they run:

1. **Tap the live token stream.** The answer must be read from the live stream the client renders,
   not from the durable conversation log. In this harness that stream is the process-local event
   `agent/assistant-stream`, whose frames are `start`, `chunk` and `end`; a `chunk` carries a model
   piece of type `text-delta` (the visible answer), `reasoning-delta` (private reasoning) or
   `tool-call-delta` (a tool call in progress). Subscribe globally, read only `text-delta`, and
   ignore subagent sessions if your harness exposes a delegation depth.

2. **Accumulate and cut at sentence boundaries.** Hold the incoming text until it contains a
   finished sentence at or after a small threshold (50 characters works: about half a second of
   generation), then hand that sentence to the voice. Cut a run-on sentence at a comma once it
   passes a second, larger threshold (260 characters). Keep the leading and trailing whitespace of
   every piece, and keep a piece's consumed length so nothing is duplicated or lost.

3. **Speak from a warm process with a queue.** One long-lived process holds the TTS model in
   memory. Two threads: a synthesizer that turns the next piece into an audio file, and a player
   that plays the files in order. Synthesis of piece N+1 therefore overlaps playback of piece N, and
   a piece is never prepared twice. Loading the model once is the difference between roughly 0.3 s
   and roughly 9 s of latency per piece, so warm it at process start rather than on the first
   sentence.

4. **Control and announce.** Expose one mute control that writes a state file the voice process
   reads, so a GUI, a tray tool and the voice itself cannot disagree. Pre-synthesize a handful of
   short filler phrases at process start and play one when a turn begins or when work drags on:
   silence while tools run reads as "not heard" to a human. When a tool call carries an explicit
   pause, say the pause before it starts, in words, in the listener's language.

## What to replace

Porting is a table swap, not a rewrite. Go through these in order; only the first two are usually
required.

| What | Where in this implementation | What you need for your language |
|---|---|---|
| TTS engine | `runtime/speak.py` | a local engine and a voice file; keep the same function names (`_speak_silero(text, out)` → your `synthesize(text, out)`) |
| Filler phrases | `FILLERS` in `runtime/say_stream.py` | 5–10 short phrases a native speaker would actually say |
| Numbers to words | `runtime/числа.py` | cardinal, ordinal, decimal, percent and year forms for your language |
| Units | `RUSSIAN_UNITS` in `runtime/числа.py` | your abbreviations and their grammatical forms (`GB` → "gigabytes", and the form after 2 vs 5) |
| Foreign script | `runtime/латиница.py` | the mapping from the script your answers are written in to pronounceable text: letter names, file extensions, acronyms |
| Pronunciation dictionary | `runtime/алиасы-речи.txt` | words your engine says wrong, one `word = spoken` per line, editable by the user |
| Wait phrasing | `describeWait` in `lib/index.js` | "waiting 59 seconds" under a minute, minutes above it |

Everything else — the stream hook, the queue, the cap, the mute control, the announcement logic —
is language-independent.

## The twelve traps

Each one was hit, diagnosed and fixed here. They are listed in the order they cost time.

1. **The durable log is written when the answer is finished.** A reader that tails it cannot start
   before the answer ends. Measured cost: 3 to 12 seconds per answer, 6.2 s on average. Fix: read
   the live stream.
2. **Reading a service without declaring it kills the whole plugin.** In a cordis-based harness,
   touching `ctx.connection` without `inject: ['connection']` throws
   `cannot get property "connection" without inject` at activation; the plugin does not load at all,
   and everything it provides disappears. Fix: declare every service you touch. Symptom to look for
   in the host console: `warning: 1 entry did not activate`.
3. **A newly installed plugin needs a host restart.** Hot reload covers changed files; a package
   that did not exist when the host booted is not loaded. Always restart and re-verify.
4. **Staging audio files in a ring is a race.** Staging piece N into `file[N % 4]` lets a fast
   synthesizer overwrite a file the player has not played yet, and the player deletes files after
   playing. Measured symptom: the last piece logged "spoken" and produced silence. Fix: one unique
   file per piece, deleted only by the player after playback.
5. **A cap counted per process cuts later answers.** A "read at most 6000 characters" counter that
   accumulates across answers stops mid-sentence on the second or third answer. Fix: reset the
   counter on an explicit per-answer marker.
6. **The engine strips whitespace.** `ru-normalizr` trims the leading and trailing spaces of the
   fragment it is given, so `GPU` + ` и ` + `RTX` came out as `... юиэр ...`. Fix: keep the edges
   yourself and normalise only the core.
7. **Digits are not spoken.** A TTS engine may skip numerals entirely rather than spell them out.
   Observing this is what started the work: "Подождём 12 секунд" played without the number.
8. **Foreign script is spelled out or mangled.** Acronyms become letter chains the engine chews
   (`NVMe` → four tiny syllables), and file names break at the dot (`client.js` → "client. Js").
   Fix: convert the script yourself for structure (paths, extensions, acronyms) and let a
   phonemizer handle ordinary words.
9. **Versions are read as fractions.** `5.27` → "five and twenty-seven hundredths"; `32.0.16.1088`
   → two decimals. Fix: a version context rule (after "version", "driver", "build") and a rule for
   three or more dot-separated components.
10. **A date pattern that is too loose eats versions.** `\d{1,2}[./-]\d{1,2}` matches both `22.07`
    and `32.0`. Fix: require day, month and year.
11. **Multi-word dictionary entries never match after tokenization.** If the text is split into
    foreign-script tokens first, a phrase like `American Megatrends = американ мегатрендс` can no
    longer match. Fix: apply the user dictionary before splitting.
12. **The listener is the only available ear.** There is no way for an agent to hear its own
    output. Build a variant runner that speaks the candidate pronunciations numbered, and ask the
    human which number was right; record the choice, and record that it is a choice.

## How to verify

Verification is by measurement, not by reading code.

```bash
python runtime/сказать.py          # speaks numbers, foreign words and a file name
python runtime/числа.py --selftest # 17 checks, including "no digits and no foreign script remain"
python runtime/латиница.py --selftest
```

- **Time to first sound.** Measure generation-to-audio latency, not synthesis time alone. On the
  implementation here: about 1 s, against 7–13 s for a log-based reader.
- **Synthesis cost per piece.** Warm: 0.26 s for a 21-character piece, 1.33 s for 165 characters.
  If your first piece costs seconds while later ones are fast, your model is loading per piece.
- **The property test that matters most.** Whatever goes to the synthesizer must contain no digits
  and no foreign script. Assert it as a property over realistic sentences; it catches the whole
  class of "the engine silently skipped it" bugs.
- **A real host, not a mock.** The plugin half must be verified against a running harness: check the
  panel control is served, and that the host console shows no activation failure.

## What not to do

- **Do not edit the user's release files.** A voice engine that another tool already uses is the
  user's; work on a copy and ask before replacing it.
- **Do not restart the user's server.** Hand them the command; a restart ends their session.
- **Do not commit the voice model.** It is tens of megabytes of binary. Ship a fetch script with a
  manual fallback, and verify the model by synthesizing a phrase, not by checking its size.
- **Do not commit secrets.** Paths and tokens belong in the host's own configuration, never in the
  package: the package should run for any user once its config row is filled in.
- **Do not trust a health field or a plausible number.** The same rule as everywhere else: a missing
  reading is not a good reading. If you did not measure the latency, you do not know it.
