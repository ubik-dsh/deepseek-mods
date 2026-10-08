#!/usr/bin/env python3
"""Озвучить ответ. Голос по умолчанию — Ксения из Silero, +10%.

ВЫБРАН ОПЕРАТОРОМ после прослушивания десяти голосов: шесть Silero (aidar, baya, kseniya,
xenia, eugene, random) и четыре Piper (irina, denis, dmitri, ruslan). Победила xenia при
ускорении 10%. Оба движка локальные, интернета не требуют.

Озвучить ответ голосом Piper — локально, бесплатно, с кнопкой выключения.

    python speak.py "текст ответа"
    python speak.py --file answer.txt
    python speak.py --on        включить голос
    python speak.py --off       выключить голос (читать глазами)
    python speak.py --status    что сейчас

ПОЧЕМУ PIPER, А НЕ WINDOWS SAPI. У Windows голос Ирины звучит как автоответчик из двухтысячных.
Piper — нейросетевой синтез, русские голоса есть, модель 60 МБ, работает локально на CPU.
Ни облака, ни подписки, ни интернета.

ПОЧЕМУ ЛОКАЛЬНО ВАЖНО. Весь наш круг уже локальный: ключ — openWakeWord, разбор — Whisper,
теперь голос — Piper. Ничего никуда не уходит.

КНОПКА ВЫКЛЮЧЕНИЯ. Оператор: «выведи мне куда-то кнопку, чтоб если что мог выключить голос
и продолжить читать глазами». Состояние лежит в файле ГОЛОС.txt рядом. Выключается и отсюда
(--off), и кнопкой в лампочке. Пока выключено — этот скрипт молчит и только пишет в лог.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import wave
from datetime import datetime
from pathlib import Path

if sys.stdout is not None:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

HERE = Path(__file__).resolve().parent
ENGINE = "silero"                      # silero | piper — выбран оператором после прослушивания
# ПУТЬ К МОДЕЛИ МОЖНО ВЫНЕСТИ ЗА ПРЕДЕЛЫ ПАКЕТА. Установщик мода заменяет каталог пакета
# целиком, поэтому скачанная модель голоса и правки словаря при обновлении пропадут. Если
# задать переменную DSH_VOICE_MODEL, файл живёт в своём месте и переживает любую переустановку.
_MODEL_FROM_ENV = os.environ.get("DSH_VOICE_MODEL")
SILERO_MODEL = Path(_MODEL_FROM_ENV) if _MODEL_FROM_ENV else HERE / "voices" / "silero" / "v3_ru.pt"
SILERO_SPEAKER = "xenia"               # выбран из шести: aidar baya kseniya xenia eugene random
SILERO_RATE = 1.10                     # +10% — оператор слушал 10 и 21, оставил 10
VOICE = HERE / "voices" / "ru_RU-irina-medium.onnx"   # голос Piper, если ENGINE вернут на piper
VOICE_NAME_FILE = HERE / "Голос-Piper.txt"            # выбранный голос Piper
VOICE_NAMES = ["irina", "denis", "dmitri", "ruslan"]
STATE = HERE / "ГОЛОС.txt"
LOG = HERE / "speak.log"

# Модель держим в памяти между вызовами: загрузка занимает секунды, а ответов бывает много.
_VOICE = None
_SILERO = None


def voice_path(name: str) -> Path:
    """Путь к голосу Piper по имени. Нужен, когда ENGINE переключат на piper."""
    return HERE / "voices" / f"ru_RU-{name}-medium.onnx"


def current_voice() -> str:
    """Какой голос Piper выбран. По умолчанию irina."""
    try:
        name = VOICE_NAME_FILE.read_text(encoding="utf-8").strip().lower()
        if name in VOICE_NAMES:
            return name
    except Exception:
        pass
    return "irina"


def set_voice_name(name: str) -> None:
    VOICE_NAME_FILE.write_text(name, encoding="utf-8")


def voice_on() -> bool:
    """Включён ли голос. По умолчанию ВКЛЮЧЁН — оператор просил озвучку, а не тишину."""
    if not STATE.exists():
        return True
    return STATE.read_text(encoding="utf-8").strip().upper() != "ВЫКЛ"


def set_voice(on: bool) -> None:
    STATE.write_text("ВКЛ" if on else "ВЫКЛ", encoding="utf-8")


def clean(text: str) -> str:
    """Убрать всё, что голос читать не должен: пометки, разметку, пути, код."""
    text = re.sub(r"\[РЕЧЬ[^\]]*\]", "", text)
    text = re.sub(r"\[РЕЖИМ[^\]]*\]", "", text)
    text = re.sub(r"`[^`]*`", "", text)                 # код не читаем вовсе
    text = re.sub(r"https?://\S+", "ссылка", text)
    text = re.sub(r"[*_#>|]", "", text)
    text = re.sub(r"[А-ЯA-Z]:\\[^\s]+", "путь", text)    # пути не выговариваются
    text = re.sub(r"[┌└│─├┐┘┤┼═║╔╚]+", " ", text)          # рамки и таблицы — мусор для слуха
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _speak_silero(text: str, out: Path) -> None:
    """Ксения из Silero, ускорение 10% пересчётом.

    Модель грузится один раз и держится в _SILERO — иначе каждый ответ ждал бы секунды.
    """
    global _SILERO
    import numpy as np
    import torch
    if _SILERO is None:
        importer = torch.package.PackageImporter(str(SILERO_MODEL))
        _SILERO = importer.load_pickle("tts_models", "model")
    audio = _SILERO.apply_tts(text=text, speaker=SILERO_SPEAKER, sample_rate=48000)
    data = audio.numpy()
    if SILERO_RATE != 1.0:
        # Питч поднимается вместе со скоростью: у Silero нет числового процента,
        # только слова slow/medium/fast. Оператор это слышал и выбрал 10%.
        count = int(len(data) / SILERO_RATE)
        index = np.linspace(0, len(data) - 1, count)
        data = np.interp(index, np.arange(len(data)), data)
    with wave.open(str(out), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(48000)
        handle.writeframes((data * 32767).astype("<i2").tobytes())


def speak(text: str, rate: float = 1.0) -> int:
    global _VOICE
    text = clean(text)
    if not text:
        return 1
    if len(text) > 600:
        cut = text[:600]
        stop = max(cut.rfind("."), cut.rfind("!"), cut.rfind("?"))
        text = cut[:stop + 1] if stop > 300 else cut

    if not voice_on():
        LOG.parent.joinpath(LOG.name).open("a", encoding="utf-8").write(
            f"{datetime.now():%H:%M:%S} голос ВЫКЛ — не озвучиваю: {text[:60]}\n")
        print("  голос выключен — текст остаётся для чтения глазами")
        return 0

    # ВЕТКА ВЫБОРА ДВИЖКА. Первый патч вставил функцию _speak_silero и константы, но НЕ ЭТУ
    # ПРОВЕРКУ — и speak() пошёл по старой ветке Piper. Оператор услышал Ирину вместо Ксении
    # и сказал «ты что сломал, это не Ксения». Патч при этом отчитался «правки внесены».
    # Отсюда правило: после любой правки ЗАПУСКАТЬ и слушать, а не читать файл.
    selected = voice_path(current_voice())
    if ENGINE == "silero":
        made_with = f"Silero {SILERO_SPEAKER} +{int((SILERO_RATE-1)*100)}%"
    else:
        if not selected.exists():
            print(f"  нет голоса: {selected}")
            return 1
        made_with = f"Piper {current_voice()}"

    out = HERE / "voices" / "_last.wav"
    try:
        if ENGINE == "silero":
            _speak_silero(text, out)
        else:
            from piper import PiperVoice
            if _VOICE is None:
                _VOICE = PiperVoice.load(str(selected))
            with wave.open(str(out), "wb") as handle:
                _VOICE.synthesize_wav(text, handle)
    except Exception as error:
        print(f"  синтез не удался: {type(error).__name__} {error}")
        return 1

    try:
        import winsound
        winsound.PlaySound(str(out), winsound.SND_FILENAME)
    except Exception as error:
        print(f"  проиграть не удалось: {type(error).__name__} {error}")
        return 1

    with LOG.open("a", encoding="utf-8") as handle:
        handle.write(f"{datetime.now():%H:%M:%S} сказано: {text[:80]}\n")
    print(f"  сказано ({len(text)} симв.): {text[:70]}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("text", nargs="*")
    ap.add_argument("--file", type=Path)
    ap.add_argument("--on", action="store_true")
    ap.add_argument("--off", action="store_true")
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()

    if args.on:
        set_voice(True)
        print("  голос ВКЛЮЧЁН")
        return 0
    if args.off:
        set_voice(False)
        print("  голос ВЫКЛЮЧЕН — читай глазами")
        return 0
    if args.status:
        # Показываем модель ДЕЙСТВУЮЩЕГО движка, а не того, который выключен: раньше здесь
        # всегда печатался размер модели Piper, и при работающем Silero выходило «НЕТ».
        active = SILERO_MODEL if ENGINE == "silero" else VOICE
        engine_name = "Silero" if ENGINE == "silero" else "Piper"
        print(f"  голос: {'ВКЛ' if voice_on() else 'ВЫКЛ'}   (файл {STATE.name})")
        print(f"  движок: {engine_name}")
        print(f"  модель {engine_name}: "
              + (f"есть {round(active.stat().st_size / 1024 / 1024, 1)} МБ ({active})"
                 if active.exists() else f"НЕТ, жду файл {active}"))
        return 0

    text = args.file.read_text(encoding="utf-8") if args.file else " ".join(args.text)
    if not text.strip():
        print("  нечего говорить")
        return 2
    return speak(text)


if __name__ == "__main__":
    raise SystemExit(main())
