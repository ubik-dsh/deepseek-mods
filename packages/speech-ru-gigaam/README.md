# speech-ru-gigaam — Russian speech recognition for the microphone button

**English** · [Русский](README.ru.md)

## What it fixes

The Voice Input bundle ships one local recognizer, **SenseVoiceSmall**, and that model
knows five languages: Chinese, English, Cantonese, Japanese and Korean. Russian is not
one of them, and the language list is not a setting — it is compiled into both halves of
that provider (`lib/index.js:14-21` and `lib/worker.js:39-46`), and the Settings service
refuses to store a language the selected provider does not advertise.

The model cannot say "I do not know", so it answers in the nearest language it does
know. Dictated Russian comes back as katakana and hangul: `Thisシ人のバ。 면しく。`

This mod does not touch that provider. It registers a **second** recognizer beside it and
lets the operator pick one in the voice panel. Russian goes to GigaAM; anything else can
still go to SenseVoice exactly as before.

## Why GigaAM and not Whisper

Measured on the operator's own recordings — 10 files from `_voice\takes`, 143.5 s,
16 kHz mono, microphone on a table with a television running:

| engine | load | speed | punctuation | worst habit |
|---|---:|---:|---|---|
| whisper-large-v3-turbo (GPU) | 4.9 s | 19.9x | yes | invents words at unclear openings |
| gigaam-v2-ctc (CPU) | 2.9 s | 10.2x | no | no capitals, no commas |
| **gigaam-v3-e2e_rnnt (CPU)** | **3.2 s** | **7.6x** | **yes** | `Гигаем` for `ГигаАМ` |
| whisper-large-v3 (GPU) | 8.4 s | 6.5x | yes | `ГИП` instead of `Дип`; invents `Девятая` |
| whisper-large-v3 + prompt | 8.5 s | 6.3x | yes | `ГИБДД 25 сентября` instead of `Дип 25 сентября` |
| vosk-small-ru | 1.6 s | 4.3x | no | `лампочках с познает нареч` |
| vosk-ru-0.42 | 448 s | 1.7x | no | seven minutes to load |

GigaAM-v3 `e2e_rnnt` was the only engine that did not invent a word where the recording
opens indistinctly, it writes punctuation and `ё` (`распознаёт`), it handles the wake
word `Дип` better than Whisper, and it needs no video card. Full texts per engine:
`_voice\ЗАМЕР-распознавания.md` in the workspace.

## What it needs on the machine

- A Python interpreter with `torch` >= 2.6, `torchaudio`, `transformers` ~4.57 and
  `numpy`. On the operator's machine that is `_voice\gigaam-env`, and the path goes into
  the loader row, never into this package.
- 428 MB of weights on first use, from `huggingface.co` (`ai-sage/GigaAM-v3`), cached
  under `hubCache`. Point `hubCache` at a directory that already holds the revision and
  nothing is downloaded.
- No `ffmpeg`: the model's own loader shells out to it, so the worker reads WAV itself
  (8, 16, 24 and 32-bit) and replaces that loader inside the loaded module, saying so in
  the log.

Two honest notes about the remote code: `transformers` refuses to `torch.load` a `.bin`
on torch below 2.6 (CVE-2025-32434), which is why the interpreter is asked for 2.6+; and
loading the remote file requires every package named in it to be importable, including
`pyannote`, which is needed only for long-form segmentation. `lib/pyannote-stub` supplies
a stand-in that raises a loud error if it is ever called — it is added to the worker's
import path only when the real package is absent.

## Configuration

One loader row in `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: speech-ru-gigaam
      name: '@local/dsh-speech-ru-gigaam'
      config:
        pythonPath: 'C:\...\gigaam-env\Scripts\python.exe'
        hubCache: 'C:\...\_hf-cache'
        modulesCache: 'C:\...\_hf-cache\modules'
```

| key | default | meaning |
|---|---|---|
| `pythonPath` | none, **required** | interpreter with torch and transformers |
| `workerPath` | `lib/worker.py` | the sidecar that ships here |
| `revision` | `e2e_rnnt` | `ctc`, `rnnt`, `e2e_ctc`, `e2e_rnnt` |
| `device` | `cpu` | `cpu` or `cuda` |
| `threads` | `0` | `torch` threads, 0 leaves torch alone |
| `hubCache` / `modulesCache` | `''` | huggingface caches; empty uses the library default |
| `requestTimeoutMs` | `300000` | the first request may download the weights |
| `idleTimeoutMs` | `600000` | release ~1.5 GB of memory after this much silence |
| `maxAudioBytes` | `33554432` | refuse a recording larger than this |
| `providerId` | `gigaam-ru-local` | the id the voice panel stores |

## How it works

The host half registers one provider with `ctx.speechToText` and owns one warm Python
process. The process loads the model on the first recording and then only computes, so a
sentence costs one to three seconds; after `idleTimeoutMs` of silence it is stopped and
the memory goes back, and the next recording pays the model load again.

Wire format, one JSON object per line:

```
→ {"id":1,"wav":"<base64 WAV 16 kHz mono>","language":"ru"}
→ {"ready":true,"revision":"e2e_rnnt","loadSeconds":3.2}
← {"id":1,"text":"Дип, какой-нибудь текст мне прочитай.","audioSeconds":10.6,"inferenceSeconds":1.4}
```

Recordings longer than 24.5 s are cut into 20-second pieces and joined, because the model
itself refuses anything longer than 25 s.

### `auto` and `ru` both mean Russian

The provider advertises two language hints and transcribes Russian either way. `ru` is the
honest one; `auto` has to be there or the recognizer cannot be selected at all. The voice
panel keeps **one** language for every provider and sends only `providerId` when the
operator switches; the service then checks the stored language (the shipped default is
`auto`) against the new provider's list and refuses the switch when it is missing. The
language dropdown only offers the languages of the provider already selected, so a
provider advertising `ru` alone is unreachable from the interface.

## Installing and checking

```bash
node tools/install.mjs            # copies packages/ into $DSH_HOME and adds the row
node tools/dev/test-speech-ru.mjs # shape, refusal, and a real recording through the worker
node tools/boot-check.mjs         # is the mod in the served boot graph?
```

Then reload the Web GUI (F5), open the voice panel, and choose the recognizer
`GigaAM-v3 e2e_rnnt`. This is a **newly installed** mod, so `dsh web` must be restarted
once before the panel can see it; the package's own row is picked up live only after that.
