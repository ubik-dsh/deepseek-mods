"""Тёплый распознаватель русской речи GigaAM-v3 для кнопки микрофона в DSH.

Читает по одной строке JSON со стандартного ввода, отвечает строкой JSON в стандартный
вывод. Модель грузится один раз при первом запросе, дальше каждый кусок только
разбирается, поэтому задержка после первой фразы это время счёта, а не загрузки.

Запрос:   {"id": 1, "wav": "<base64 от WAV 16 кГц моно>", "language": "ru"}
Ответ:    {"id": 1, "text": "...", "audioSeconds": 1.23, "inferenceSeconds": 0.45}
Ошибка:   {"id": 1, "error": "..."}
Готов:    {"ready": true, "revision": "e2e_rnnt", "loadSeconds": 3.2}

Почему не зовём model.transcribe(): удалённый код GigaAM зовёт внешний ffmpeg, которого
на этой машине нет, и отказывается работать с записью длиннее 25 секунд. Здесь звук
читается своим кодом, а длинная запись режется на куски по 20 секунд.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
import wave


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="GigaAM-v3 speech worker")
    parser.add_argument("--revision", default="e2e_rnnt",
                        help="ssl | ctc | rnnt | e2e_ctc | e2e_rnnt")
    parser.add_argument("--device", default="cpu", help="cpu или cuda")
    parser.add_argument("--repo", default="ai-sage/GigaAM-v3")
    parser.add_argument("--hub-cache", default="", help="каталог кэша весов huggingface")
    parser.add_argument("--modules-cache", default="", help="каталог кэша удалённого кода")
    parser.add_argument("--threads", type=int, default=0, help="потоки torch, 0 значит не трогать")
    parser.add_argument("--chunk-seconds", type=float, default=20.0,
                        help="на какие куски резать длинную запись")
    return parser.parse_args()


ARGS = parse_args()


def log(message: str) -> None:
    """Служебные строки идут в stderr, чтобы не мешать обмену JSON."""
    print(message, file=sys.stderr, flush=True)


def send(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def prepare_caches() -> None:
    """Указать кэши huggingface до первого импорта transformers."""
    if ARGS.hub_cache:
        os.makedirs(ARGS.hub_cache, exist_ok=True)
        os.environ["HF_HUB_CACHE"] = ARGS.hub_cache
    if ARGS.modules_cache:
        os.makedirs(ARGS.modules_cache, exist_ok=True)
        os.environ["HF_MODULES_CACHE"] = ARGS.modules_cache
    # Символьные ссылки в кэше на Windows обычно недоступны, это не ошибка.
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def ensure_pyannote() -> None:
    """Подставить свою заглушку pyannote, если настоящего пакета нет.

    transformers, загружая удалённый код GigaAM-v3, требует импортируемости всех
    пакетов, упомянутых в файле, хотя pyannote нужен только для разметки длинной
    записи. Заглушка лежит внутри этого же пакета и объясняет себя при вызове.
    """
    try:
        import pyannote  # noqa: F401
        return
    except Exception:  # noqa: BLE001 - нет пакета, это и ожидалось
        pass
    stub = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pyannote-stub")
    if os.path.isdir(stub):
        sys.path.insert(0, stub)
        log(f"настоящего pyannote нет, подставляю заглушку из пакета: {stub}")


def read_wav_bytes(data: bytes):
    """Разобрать WAV сами: понимаем 8, 16, 24 и 32 бита, отдаём float32 в границах [-1, 1]."""
    import numpy as np
    import torch

    with wave.open(io.BytesIO(data)) as handle:
        if handle.getnchannels() != 1:
            raise ValueError(f"нужен один канал, а тут {handle.getnchannels()}")
        if handle.getframerate() != 16000:
            raise ValueError(f"нужно 16 кГц, а тут {handle.getframerate()}")
        width = handle.getsampwidth()
        frames = handle.readframes(handle.getnframes())

    if width == 2:
        return torch.frombuffer(bytearray(frames), dtype=torch.int16).float() / 32768.0
    if width == 1:
        raw = np.frombuffer(frames, dtype=np.uint8).astype(np.float32)
        return torch.from_numpy((raw - 128.0) / 128.0)
    if width == 3:
        raw = np.frombuffer(frames, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        values = raw[:, 0] | (raw[:, 1] << 8) | (raw[:, 2] << 16)
        values = np.where(values >= 1 << 23, values - (1 << 24), values).astype(np.float32)
        return torch.from_numpy(values / float(1 << 23))
    if width == 4:
        raw = np.frombuffer(frames, dtype=np.int32).astype(np.float32)
        return torch.from_numpy(raw / float(1 << 31))
    raise ValueError(f"неизвестная разрядность WAV: {width} байт")


def load_audio(source, sample_rate: int = 16000):
    """Замена той функции чтения, что зовёт ffmpeg. Понимает и путь, и готовые байты."""
    if isinstance(source, (bytes, bytearray)):
        return read_wav_bytes(bytes(source))
    with open(source, "rb") as handle:
        return read_wav_bytes(handle.read())


class Recognizer:
    """Одна тёплая модель на весь процесс."""

    def __init__(self) -> None:
        self.model = None

    def load(self) -> float:
        import torch

        from transformers import AutoModel

        if ARGS.threads > 0:
            torch.set_num_threads(ARGS.threads)
        ensure_pyannote()

        started = time.time()
        self.model = AutoModel.from_pretrained(
            ARGS.repo,
            revision=ARGS.revision,
            trust_remote_code=True,
        )
        if ARGS.device != "cpu":
            self.model = self.model.to(ARGS.device)
        self.model.eval()

        # Подменяем чтение звука в тех модулях, где функция реально лежит, и говорим об
        # этом вслух: молчаливая подмена однажды обманет того, кто будет это читать.
        replaced = []
        for holder in (self.model, getattr(self.model, "model", None)):
            if holder is None:
                continue
            for cls in type(holder).__mro__:
                for method_name in ("prepare_wav", "transcribe", "transcribe_longform"):
                    method = cls.__dict__.get(method_name)
                    if method is not None and hasattr(method, "__globals__"):
                        method.__globals__["load_audio"] = load_audio
                        replaced.append(f"{cls.__name__}.{method_name}")
        log(f"чтение звука подменено в: {', '.join(sorted(set(replaced))) or 'НИГДЕ'}")
        return time.time() - started

    def transcribe(self, wav_bytes: bytes) -> tuple[str, float]:
        import torch

        wav = read_wav_bytes(wav_bytes)
        audio_seconds = wav.numel() / 16000.0
        if wav.numel() <= int(24.5 * 16000):
            pieces = [wav]
        else:
            step = int(ARGS.chunk_seconds * 16000)
            pieces = [wav[start:start + step] for start in range(0, wav.numel(), step)]

        texts = []
        for piece in pieces:
            if piece.numel() == 0:
                continue
            batch = piece.to(self.model.device).to(self.model.dtype).unsqueeze(0)
            length = torch.full([1], batch.shape[-1], device=self.model.device)
            with torch.inference_mode():
                encoded, encoded_len = self.model.forward(batch, length)
                texts.append(self.model.model.decoding.decode(self.model.model.head, encoded, encoded_len)[0])
        return " ".join(text.strip() for text in texts if text.strip()), audio_seconds


def main() -> int:
    prepare_caches()
    recognizer = Recognizer()
    log(f"сторож готов, ревизия {ARGS.revision}, устройство {ARGS.device}")

    for line in sys.stdin:
        line = line.strip()
        if line == "":
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            send({"id": None, "error": f"не разобрал запрос: {error}"})
            continue

        identifier = request.get("id")
        if request.get("command") == "quit":
            send({"id": identifier, "ok": True})
            return 0

        try:
            if recognizer.model is None:
                load_seconds = recognizer.load()
                send({"ready": True, "revision": ARGS.revision, "loadSeconds": round(load_seconds, 2)})
            started = time.time()
            wav_bytes = base64.b64decode(request["wav"], validate=True)
            text, audio_seconds = recognizer.transcribe(wav_bytes)
            send({
                "id": identifier,
                "text": text,
                "audioSeconds": round(audio_seconds, 3),
                "inferenceSeconds": round(time.time() - started, 3),
            })
        except Exception as error:  # noqa: BLE001 - любая поломка уходит на ту сторону
            send({"id": identifier, "error": f"{type(error).__name__}: {error}"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
