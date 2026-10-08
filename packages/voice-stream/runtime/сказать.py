"""Сказать фразу вслух тем же путём, что и читалка: проверка голоса и произношения.

Зачем отдельный скрипт. Проверить читалку целиком нельзя без DSH и без ответа модели, а
голос, числа и латиницу проверить хочется сразу после установки. Здесь тот же путь, что в
`say_stream.py`: подготовка текста (`числа.prepare`) → синтез (`speak.py`) → проигрыш.

Запуск:
    python сказать.py "Подождём 12 секунд, порт 3080, диск NVMe"
    python сказать.py --без-подготовки "как есть"
    python сказать.py --варианты NVMe
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
if sys.stdout is not None:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

import speak as voice  # noqa: E402
import числа  # noqa: E402

DEFAULT_PHRASES = [
    "Читалка на месте. Строка 1. Процессор Intel Core i9-13900HX, 24 ядра, 32 потока.",
    "Подождём 12 секунд. Порт 3080, синтез 0.26 секунды.",
    "Первый диск NE-256, NVMe, 256 ГБ, состояние исправен.",
]


def say(text: str, out: Path) -> float:
    """Синтезировать и проиграть. Возвращает длительность звука в секундах."""
    import wave
    voice._speak_silero(text, out)  # noqa: SLF001
    with wave.open(str(out), "rb") as handle:
        seconds = round(handle.getnframes() / handle.getframerate(), 2)
    try:
        import winsound
        winsound.PlaySound(str(out), winsound.SND_FILENAME)
    except Exception as error:  # noqa: BLE001
        print(f"  проиграть не удалось: {type(error).__name__} {error}")
    return seconds


def main() -> int:
    args = [item for item in sys.argv[1:] if not item.startswith("--")]
    prepare = "--без-подготовки" not in sys.argv
    phrases = args if args else DEFAULT_PHRASES
    out = HERE / "voices" / "_сказать.wav"
    (HERE / "voices").mkdir(exist_ok=True)
    for phrase in phrases:
        spoken = числа.prepare(phrase) if prepare else phrase
        print(f"было:  {phrase}")
        print(f"стало: {spoken}")
        print(f"  звучит {say(spoken, out)} с")
    print("готово")
    return 0


if __name__ == "__main__":
    sys.exit(main())
