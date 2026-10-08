# voice-stream — read the answer aloud while it is still being written

**English** · [Русский](README.ru.md)

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
- Pieces are handed to `_voice\say_stream.py`, which keeps the voice model warm and
  synthesizes the next piece while the current one is playing. The voice therefore does not
  fall behind the typing.
- Subagents are skipped: their sessions carry `delegationDepth > 0`, and reading their chatter
  aloud would be noise. `readSubagents: true` overrides that.

## Configuration

One loader row in `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: voice-stream
      name: '@local/dsh-voice-stream'
      config:
        pythonPath: 'C:\...\Python312\python.exe'
        streamPath: 'C:\...\_voice\say_stream.py'
```

| key | default | meaning |
|---|---|---|
| `pythonPath` | none, **required** | interpreter with torch and the voice model |
| `streamPath` | none, **required** | `_voice\say_stream.py`, the warm voice process |
| `firstChunk` | `50` | characters to wait for before the first spoken piece |
| `chunkChars` | `260` | piece size after which a run-on sentence is cut |
| `maxChars` | `6000` | how much of one answer is read at all |
| `idleStopMs` | `600000` | release the voice process after this much silence |
| `readSubagents` | `false` | also read subagent text |

## Installing and checking

```bash
node tools/install.mjs                          # copies packages/ and adds the row
node tools/dev/test-voice-stream.mjs            # piece cutting, hook wiring, refusal
```

Then reload the Web GUI (F5). This is a **new** mod, so `dsh web` must be restarted once
before it is loaded; a row for a newly installed package is not picked up by a running host.

Turning the voice off is the same switch as before: `_voice\ГОЛОС.txt` set to `ВЫКЛ` silences
the reader without stopping it, and `_voice\say_stream.py` reads that file itself.
