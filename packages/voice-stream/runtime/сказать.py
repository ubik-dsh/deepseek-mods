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


# Варианты произношения спорных сокращений: их зачитывают по номерам, а выбор делает
# человек. У агента слуха нет, поэтому последнее слово всегда за тем, кто слышит.
VARIANTS = {
    "nvme": ["энвээми", "эн-вэ-эм-и", "эн вэ эм и"],
    "bios": ["биос", "би ай оу эс"],
    "ssd": ["эс-эс-ди", "эс эс ди", "эсэсди"],
    "usb": ["ю-эс-би", "ю эс би", "усб"],
    "gpu": ["джи пи ю", "джи-пи-ю", "гпу"],
    "api": ["эй пи ай", "а пи ай", "апи"],
    "dsh": ["ди эс эйч", "дэ эс эйч", "дэ эс аш"],
    "hdd": ["хадэдэ", "эйч ди ди"],
    "sata": ["сата", "эс-эй-ти-эй"],
    "uefi": ["уэфи", "ю-и-эф-ай"],
}


def variants_for(word: str) -> list[str]:
    """Кандидаты произношения: из таблицы, иначе три общих подхода."""
    known = VARIANTS.get(word.strip().lower())
    if known is not None:
        return known
    import латиница
    engine = числа.normalizer_engine()
    by_engine = None
    if engine is not None:
        try:
            by_engine = engine.normalize(word).strip() or None
        except Exception:  # noqa: BLE001
            by_engine = None
    candidates = [by_engine, латиница.letter_names(word), word.lower()]
    seen: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in seen:
            seen.append(candidate)
    return seen


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
    if "--варианты" in sys.argv:
        word = args[0] if args else "nvme"
        out = HERE / "voices" / "_варианты.wav"
        (HERE / "voices").mkdir(exist_ok=True)
        print(f"варианты произношения для {word!r}: скажи, какой номер звучал верно")
        for number, candidate in enumerate(variants_for(word), start=1):
            label = f"Вариант {числа.integer_to_words(number)}. "
            print(f"  {number}) {candidate}")
            print(f"     звучит {say(label + candidate, out)} с")
        print("выбранный вариант впиши строкой в алиасы-речи.txt")
        return 0
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
