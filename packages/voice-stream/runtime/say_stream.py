"""Читать длинный ответ вслух кусками, готовя следующий, пока звучит предыдущий.

ПОЧЕМУ ОТДЕЛЬНЫЙ ПРОЦЕСС. `speak.py` при каждом вызове грузит модель голоса заново
(несколько секунд) и только потом синтезирует и играет. На ответ из пяти кусков это
пять загрузок и пять пауз. Здесь модель грузится один раз, а дальше работает конвейер:
пока звучит кусок N, уже синтезируется кусок N+1.

ОБМЕН. Строки JSON на стандартный вход, по одной на кусок:
    {"id": 1, "text": "первое предложение. и второе."}
    {"command": "quit"}
Ответ на каждый кусок:
    {"id": 1, "spoken": 120, "synthSeconds": 1.2, "queue": 1}

ГОЛОС. Берётся из `speak.py` целиком: тот же silero, тот же голос, тот же `ГОЛОС.txt`.
Файл `speak.py` не тронут: он импортируется как модуль, и его модель остаётся тёплой
внутри этого процесса.

Запуск: python _voice/say_stream.py
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import sys
import threading
import time
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

if sys.stdout is not None:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

import speak as voice  # noqa: E402 — голос, очистка текста и переключатель ГОЛОС.txt
import числа  # noqa: E402 — цифры и латиница словами: silero их не произносит


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Потоковая озвучка кусками")
    parser.add_argument("--staging", type=int, default=3,
                        help="сколько кусков держать готовыми впереди")
    parser.add_argument("--max-total", type=int, default=6000,
                        help="предохранитель на ОДИН ответ, знаков после очистки; "
                             "планировщик на той стороне режет ответ сам")
    return parser.parse_args()


ARGS = parse_args()
JOBS: queue.Queue = queue.Queue()
READY: queue.Queue = queue.Queue(maxsize=ARGS.staging)
STOP = threading.Event()
COUNTER = {"n": 0}

# ЗАГОТОВКИ ГОЛОСА. Короткие подводки синтезируются один раз при запуске и лежат
# готовыми файлами. Тогда первое слово звучит мгновенно: синтезировать нечего,
# остаётся только проиграть. Это и есть кэш голоса, о котором просил оператор.
FILLER_DIR = HERE / "voices" / "fillers"
FILLERS = [
    "Так.",                       # 0 — начало работы
    "Смотрю.",                    # 1
    "Секунду.",                   # 2
    "Сейчас гляну.",              # 3
    "Хм.",                        # 4
    "Понял, работаю.",            # 5 — когда работа затянулась
    "Проверяю.",                  # 6
    "Ещё немного.",               # 7
    "Думаю.",                     # 8 — длинная работа
    "Работаю, подожди.",          # 9
]


def filler_path(index: int) -> Path:
    return FILLER_DIR / f"{index:02d}.wav"


def prepare_fillers() -> None:
    """Синтезировать недостающие подводки. Готовые не трогаем: это кэш."""
    FILLER_DIR.mkdir(parents=True, exist_ok=True)
    made = 0
    for index, text in enumerate(FILLERS):
        path = filler_path(index)
        if path.exists() and path.stat().st_size > 1000:
            continue
        try:
            voice._speak_silero(text, path)  # noqa: SLF001 — голос тот же, что у speak.py
            made += 1
        except Exception as error:  # noqa: BLE001
            log(f"подводку «{text}» не синтезировать: {type(error).__name__} {error}")
    if made:
        log(f"подводки готовы: синтезировано {made} из {len(FILLERS)}, остальные из кэша")


def log(line: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    text = f"{stamp} {line}"
    print(text, flush=True)
    try:
        with voice.LOG.open("a", encoding="utf-8") as handle:
            handle.write(text + "\n")
    except Exception:  # noqa: BLE001
        pass


def stage_path(index: int) -> Path:
    """Свой файл на каждый кусок.

    БЫЛО ПО КРУГУ ИЗ ЧЕТЫРЁХ, И ЭТО МОЛЧА ЛОМАЛО ЧТЕНИЕ. Конвейер синтезирует вперёд,
    поэтому пятый кусок попадал в файл первого, а плеер, доиграв первый, удалял этот
    файл. Последний кусок оставался без звука: в журнале «прочитан», в ушах тишина.
    """
    folder = HERE / "voices"
    folder.mkdir(exist_ok=True)
    return folder / f"_stream-{index}.wav"


def synthesizer() -> None:
    """Готовить куски заранее: пока играет предыдущий, этот уже звучит в файле.

    Готовые файлы (подводки из кэша) проходят мимо синтеза: их только проиграть.
    """
    while not STOP.is_set():
        job = JOBS.get()
        if job is None:
            READY.put(None)
            return
        if job.get("kind") == "file":
            READY.put(job)
            continue
        identifier = job.get("id")
        text = job.get("text", "")
        started = time.time()
        path = stage_path(COUNTER["n"])
        COUNTER["n"] += 1
        try:
            if voice.ENGINE == "silero":
                voice._speak_silero(text, path)  # noqa: SLF001 — модель та же, что у speak.py
            else:
                from piper import PiperVoice
                selected = voice.voice_path(voice.current_voice())
                piper = PiperVoice.load(str(selected))
                with wave.open(str(path), "wb") as handle:
                    piper.synthesize_wav(text, handle)
            READY.put({"kind": "text", "id": identifier, "text": text, "path": path,
                       "synth": round(time.time() - started, 2), "delete": True})
        except Exception as error:  # noqa: BLE001
            log(f"синтез куска {identifier} не удался: {type(error).__name__} {error}")
            READY.put({"kind": "text", "id": identifier, "text": text, "path": None,
                       "synth": 0.0, "delete": False})


def player() -> None:
    """Играть по очереди и отвечать хосту, чем закончился каждый кусок."""
    while not STOP.is_set():
        item = READY.get()
        if item is None:
            return
        identifier = item.get("id")
        text = item.get("text", "")
        path = item.get("path")
        played = False
        if not voice.voice_on():
            # Переключатель ПОСЛЕДНЕГО МОМЕНТА: пока куски копились, оператор мог
            # выключить голос кнопкой в панели, и тогда молчит даже готовое.
            log("голос ВЫКЛ — проигрывать не буду")
        elif path is not None:
            try:
                import winsound
                winsound.PlaySound(str(path), winsound.SND_FILENAME)
                played = True
            except Exception as error:  # noqa: BLE001
                log(f"проиграть кусок {identifier} не удалось: {type(error).__name__} {error}")
        if not played and path is not None and not Path(path).exists():
            log(f"файл куска {identifier} не создан — читать нечего")
        reply = {"id": identifier, "spoken": len(text), "synthSeconds": item.get("synth", 0.0),
                 "queue": READY.qsize(), "played": played, "at": time.strftime("%H:%M:%S")}
        sys.stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        if item.get("delete") and path is not None:
            try:
                Path(path).unlink(missing_ok=True)
            except Exception:  # noqa: BLE001
                pass


def main() -> int:
    log(f"потоковая озвучка готова: движок {voice.ENGINE}, голос включён: {voice.voice_on()}")
    # ПРОГРЕВ. Загрузка модели голоса стоит около девяти секунд; платить их на первом
    # ответе незачем, поэтому грузим её сразу при запуске, а синтезированную пробу
    # выбрасываем, не проигрывая: она нужна только чтобы модель встала в память.
    try:
        warm = HERE / "voices" / "_warm.wav"
        started = time.time()
        voice._speak_silero("проверка", warm)  # noqa: SLF001
        warm.unlink(missing_ok=True)
        log(f"модель голоса загружена заранее ({round(time.time() - started, 2)} с)")
    except Exception as error:  # noqa: BLE001
        log(f"прогреть голос не вышло: {type(error).__name__} {error}")
    prepare_fillers()
    synthesizer_thread = threading.Thread(target=synthesizer, name="synth")
    player_thread = threading.Thread(target=player, name="play")
    for thread in (synthesizer_thread, player_thread):
        thread.start()

    total = 0
    for line in sys.stdin:
        line = line.strip()
        if line == "":
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            log(f"не разобрал запрос: {error}")
            continue
        if request.get("command") == "quit":
            break
        if request.get("command") == "begin":
            # НАЧАЛО ОТВЕТА. Сбрасываем счётчик: предел это предел ОДНОГО ответа.
            # Раньше он копился на весь процесс, и на втором-третьем ответе чтение
            # обрывалось на середине — «не дочитал последний абзац».
            total = 0
            plan = int(request.get("chunks") or 0)
            chars = int(request.get("chars") or 0)
            log(f"новый ответ: планировщик дал {plan} кусков, {chars} знаков, "
                f"это примерно {round(chars / 16)} с речи")
            continue
        if request.get("command") == "filler":
            # Подводка из кэша: синтеза нет, только проигрыш. Ради этого всё и затевалось.
            which = int(request.get("which") or 0) % len(FILLERS)
            path = filler_path(which)
            if path.exists():
                JOBS.put({"kind": "file", "id": request.get("id"), "text": FILLERS[which],
                          "path": path, "synth": 0.0, "delete": False})
                log(f"подводка «{FILLERS[which]}» из кэша")
            else:
                log(f"подводки нет в кэше: {path}")
            continue
        # ЧИСЛА И ЛАТИНИЦА. Найдено оператором: «Подождём 12 секунд» звучало без числа —
        # silero цифры не произносит, а латинские имена читает по буквам. Поэтому перед
        # синтезом идёт подготовка: алиасы («DSH» → «ди эс эйч»), потом числа словами.
        text = числа.prepare(voice.clean(str(request.get("text") or "")))
        if text == "":
            continue
        if not voice.voice_on():
            sys.stdout.write(json.dumps({"id": request.get("id"), "spoken": 0,
                                         "skipped": "голос ВЫКЛ"}, ensure_ascii=False) + "\n")
            sys.stdout.flush()
            continue
        if total + len(text) > ARGS.max_total:
            log(f"предохранитель {ARGS.max_total} знаков сработал: дальше этого ответа не читаю")
            break
        total += len(text)
        JOBS.put({"kind": "text", "id": request.get("id"), "text": text})

    JOBS.put(None)          # синтезатор доработает очередь и передаст конец плееру
    # ЖДАТЬ, А НЕ СПАТЬ. Первая версия засыпала на треть секунды и выходила, а потоки
    # были демонами — они умирали вместе с процессом, и в очередь прочитанное не звучало.
    # Порядок гарантирует очередь: плеер получает конец только после всех кусков.
    synthesizer_thread.join(timeout=1800)
    player_thread.join(timeout=1800)
    STOP.set()
    log(f"озвучка закончена: кусков {COUNTER['n']}, знаков {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
