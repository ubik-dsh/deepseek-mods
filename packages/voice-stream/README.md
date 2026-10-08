# voice-stream — read the answer aloud while it is still being written

**English** · [Русский](README.ru.md)

**Porting this to another language or another TTS engine: [`runtime/SKILL.md`](runtime/SKILL.md).**
It is the portable form of the work: the live-stream hook, the warm synthesis process, text
preparation for speech, the filler cache, the mute control, and the twelve traps that were measured
while building it.

**Installing this Russian reader on another machine:
[`runtime/INSTALL.ru.md`](runtime/INSTALL.ru.md)** (Russian on purpose: the voice, the numbers and
the letter names are Russian, so it should not be installed by mistake where another language is
needed).

## What is in the package

| where | what |
|---|---|
| `lib/index.js` | the mod: live answer stream, piece cutting, fillers, wait announcements, the panel route |
| `lib/client.js` | the "Голос: вкл / выкл" button in the chat header |
| `runtime/say_stream.py` | the warm voice process: queue, synthesis/playback pipeline, filler cache |
| `runtime/speak.py` | the engine: Silero, voice `xenia`, +10% rate |
| `runtime/числа.py`, `runtime/латиница.py` | text preparation: numbers, units, versions, Latin script |
| `runtime/алиасы-речи.txt` | the pronunciation dictionary a human edits |
| `runtime/INSTALL.ru.md` | installation on another machine |
| `runtime/SKILL.md` | porting to another language or engine |

## What it fixes

The first reader (`_voice\dsh_voice.mjs`) watched the session log, and the log only receives
the answer **when the step closes**: `assistant/message` is appended once, with the whole
text. So the first word sounded seconds after the answer was finished, and the wait was the
whole generation plus synthesis.

The harness does publish the text live — that is what the browser renders from. It is emitted
as the process-local event **`agent/assistant-stream`**, whose frames are `start`, `chunk` and
`end`; inside a `chunk` sits a model piece of type `text-delta` (the answer), `reasoning-delta`
(the private reasoning) or `tool-call-delta` (a tool call). This mod subscribes to that event
and reads the answer as it arrives.

## How it reads

- `text-delta` pieces accumulate in a buffer. `reasoning-delta` and `tool-call-delta` are
  ignored: they are not read aloud.
- Every time the buffer holds a finished sentence at or after `firstChunk` characters, that
  sentence goes to the voice process immediately. A run-on sentence is cut at a comma once it
  reaches `chunkChars`, so a piece never grows into a paragraph.
- On `end` the tail is flushed, so nothing is lost — the mistake the first reader made twice.
- Pieces are handed to `runtime\say_stream.py`, which keeps the voice model warm and
  synthesizes the next piece while the current one is playing. The voice therefore does not
  fall behind the typing.
- Subagents are skipped: their sessions carry `delegationDepth > 0`, and reading their chatter
  aloud would be noise. `readSubagents: true` overrides that.

### Filler phrases: the voice cache

Wait time is covered the way the big voice assistants do it, and the operator asked for it:
short phrases spoken from a **pre-synthesized cache**, so the first sound costs nothing at
all. `runtime\say_stream.py` synthesizes the list once at startup into `runtime\voices\fillers\`
and then only plays those files back; a phrase goes out at the start of every turn, and
further ones when work drags on (`workAfterMs`, at most `maxFillersPerTurn` per turn, no
oftener than `workRepeatMs`).

Announced waits are synthesized on demand instead, because their text varies: when a tool
call carries an explicit pause (`Start-Sleep -Seconds 59`, `timeout /t 30`, `--sleep 5`),
the mod says "Подождём 59 секунд." before the wait starts. Under a minute it names seconds,
over a minute minutes — the operator's rule. A time *limit* (`timeoutMs`) is deliberately not
treated as a wait: announcing "ten minutes" for a command that ends in three seconds would be
a lie.

### The button in the panel

The only control is one button in the session header's utilities row: it shows whether
answers are read aloud and switches that with a click. It writes the same switch file the
voice process reads (`runtime\ГОЛОС.txt` (next to the configured `say_stream.py`)), so the panel, the lamp and the voice itself always
agree. The route is `/api/voice-stream.mod`; the browser half uses nothing but baseline
modules and asks for the `slots` service. The host half **injects `connection`**, because the
harness refuses to hand a plugin a service it never declared: reading `ctx.connection` without
it throws `cannot get property "connection" without inject` and takes the whole plugin down,
the reading included. A headless run therefore does not activate this mod.

## Configuration

One loader row in `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: voice-stream
      name: '@local/dsh-voice-stream'
      config:
        pythonPath: 'C:\...\Python312\python.exe'
        streamPath: 'C:\Users\<you>\.dsh\profiles\node_modules\@local\dsh-voice-stream\runtime\say_stream.py'
```

| key | default | meaning |
|---|---|---|
| `pythonPath` | none, **required** | interpreter with torch and the voice model |
| `streamPath` | none, **required** | `runtime\say_stream.py` inside the installed package |
| `firstChunk` | `50` | characters to wait for before the first spoken piece |
| `chunkChars` | `260` | piece size after which a run-on sentence is cut |
| `maxChars` | `6000` | how much of one answer is read at all |
| `idleStopMs` | `600000` | release the voice process after this much silence |
| `readSubagents` | `false` | also read subagent text |
| `fillers` | `true` | speak short filler phrases from the cache |
| `workAfterMs` | `12000` | silence before saying "работаю" |
| `workRepeatMs` | `30000` | how often that reminder may repeat |
| `maxFillersPerTurn` | `4` | filler phrases per turn, after that it is chatter |

## Installing and checking

```bash
node tools/install.mjs                          # copies packages/ and adds the row
node tools/dev/test-voice-stream.mjs            # piece cutting, hook wiring, refusal
```

Then reload the Web GUI (F5). This is a **new** mod, so `dsh web` must be restarted once
before it is loaded; a row for a newly installed package is not picked up by a running host.

Turning the voice off is the same switch as before: `runtime\ГОЛОС.txt` (next to the configured `say_stream.py`) set to `ВЫКЛ` silences
the reader without stopping it, and `runtime\say_stream.py` reads that file itself.
