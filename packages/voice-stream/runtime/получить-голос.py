"""Получить модель голоса Silero, если её нет.

ЧТО ЭТО. Читалка говорит голосом Silero (`v3_ru.pt`, около 59 МБ). Файл модели бинарный и
рядом с кодом не лежит: его либо скачивают, либо копируют с другой машины.

ЧЕСТНАЯ ОГОВОРКА. На машине автора этот скрипт не проверялся на скачивании: файл уже был,
а хост `models.silero.ai` с той сети не отвечал. Поэтому здесь три пути по порядку, и
последний всегда работает: скопировать файл руками. Итог проверяется запуском синтеза, а не
размером файла.

Запуск: python получить-голос.py
"""
from __future__ import annotations

import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = HERE / "voices" / "silero" / "v3_ru.pt"
MODEL_URL = "https://models.silero.ai/models/tts/ru/v3_ru.pt"
MIN_BYTES = 40 * 1024 * 1024


def log(line: str) -> None:
    print(line, flush=True)


def already_there() -> bool:
    return TARGET.exists() and TARGET.stat().st_size >= MIN_BYTES


def try_hub() -> bool:
    """Официальный путь Silero: torch.hub сам скачивает модель в свой кэш."""
    log("путь 1: torch.hub (официальный способ Silero)")
    try:
        import torch
    except ImportError:
        log("  torch не установлен, этот путь пропускаю")
        return False
    try:
        torch.hub.load(repo_or_dir="snakers4/silero-models", model="silero_tts",
                       language="ru", speaker="v3_ru")
    except Exception as error:  # noqa: BLE001
        log(f"  не вышло: {type(error).__name__} {error}")
        return False
    # Ищем скачанный файл в кэше torch: имя может отличаться от версии к версии.
    cache = Path(torch.hub.get_dir())
    found = [path for path in cache.rglob("*.pt") if path.stat().st_size >= MIN_BYTES]
    if not found:
        log(f"  модель скачалась, но файла нужного размера нет в {cache}")
        return False
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(max(found, key=lambda path: path.stat().st_size), TARGET)
    log(f"  взял из кэша: {TARGET}")
    return True


def try_url() -> bool:
    """Прямая ссылка. Хост может быть недоступен из вашей сети."""
    log(f"путь 2: прямая ссылка {MODEL_URL}")
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    temporary = TARGET.with_suffix(".part")
    try:
        with urllib.request.urlopen(MODEL_URL, timeout=60) as source, temporary.open("wb") as sink:
            shutil.copyfileobj(source, sink)
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        log(f"  не вышло: {type(error).__name__} {error}")
        temporary.unlink(missing_ok=True)
        return False
    if temporary.stat().st_size < MIN_BYTES:
        log(f"  скачалось всего {temporary.stat().st_size} байт, это не модель")
        temporary.unlink(missing_ok=True)
        return False
    temporary.replace(TARGET)
    return True


def verify() -> bool:
    """Проверка запуском: синтезировать короткую фразу тем же кодом, что и читалка."""
    log("проверяю синтезом")
    sys.path.insert(0, str(HERE))
    try:
        import speak as voice
    except Exception as error:  # noqa: BLE001
        log(f"  не смог загрузить speak.py: {type(error).__name__} {error}")
        return False
    out = HERE / "voices" / "_проверка.wav"
    try:
        voice._speak_silero("Проверка голоса прошла.", out)  # noqa: SLF001
    except Exception as error:  # noqa: BLE001
        log(f"  синтез не удался: {type(error).__name__} {error}")
        return False
    import wave
    with wave.open(str(out), "rb") as handle:
        seconds = handle.getnframes() / handle.getframerate()
    log(f"  синтез прошёл, {seconds:.2f} с звука")
    try:
        import winsound
        winsound.PlaySound(str(out), winsound.SND_FILENAME)
    except Exception:  # noqa: BLE001
        log("  проиграть не удалось, но файл синтеза есть")
    return True


def main() -> int:
    if already_there():
        log(f"модель на месте: {TARGET} ({TARGET.stat().st_size // 1024 // 1024} МБ)")
        return 0 if verify() else 1
    log(f"модели нет: жду файл около 59 МБ в {TARGET}\n")
    for step in (try_hub, try_url):
        if step():
            break
    else:
        log("\nпуть 3: скопировать файл руками.")
        log(f"  Возьмите v3_ru.pt с машины, где читалка уже работает, и положите в {TARGET.parent}")
        return 2
    return 0 if verify() else 1


if __name__ == "__main__":
    sys.exit(main())
