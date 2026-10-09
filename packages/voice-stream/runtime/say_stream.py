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
import platform
import queue
import shutil
import subprocess
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


def choose_player(system: str | None = None, find=shutil.which) -> dict:
    """Чем играть звук на этой платформе.

    ПОЧЕМУ ЭТО ОТДЕЛЬНАЯ ФУНКЦИЯ. Синтез кроссплатформенный (`torch` и `numpy` есть везде), а
    платформенным было только воспроизведение: `winsound` существует лишь на Windows, и на Linux
    импорт падал в общий `except` — падения не было, но и звука тоже: функция МОЛЧА не работала.
    Здесь выбор делается один раз при запуске, пишется в журнал, а если играть нечем — человек
    получает не тишину, а подсказку, что поставить.

    :param system: имя платформы (`platform.system()`); параметр нужен, чтобы проверять выбор
        запуском на любой машине, а не только на своей.
    :param find: чем искать команду в PATH; подменяется в проверке.
    :returns словарь с `kind` и либо готовой командой, либо подсказкой.
    """
    name = (system or platform.system()).lower()
    if name.startswith("win"):
        return {"kind": "winsound", "command": None, "args": [],
                "why": "Windows: winsound, внешних программ не нужно"}
    if name == "darwin":
        if find("afplay") is not None:
            return {"kind": "afplay", "command": find("afplay"), "args": [],
                    "why": "macOS: afplay"}
        return {"kind": "none", "command": None, "args": [],
                "why": "macOS: не найден afplay", "hint": "afplay входит в macOS; проверьте PATH"}
    # Linux и прочие: первый найденный из списка. Порядок от самого лёгкого к самому общему.
    candidates = [
        ("aplay", ["-q"], "alsa-utils"),
        ("paplay", [], "pulseaudio-utils"),
        ("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet"], "ffmpeg"),
        ("mpv", ["--really-quiet", "--no-video"], "mpv"),
    ]
    for command, extra, package in candidates:
        found = find(command)
        if found is not None:
            return {"kind": command, "command": found, "args": extra,
                    "why": f"Linux: {command}"}
    return {"kind": "none", "command": None, "args": [],
            "why": "Linux: не найдено ни aplay, ни paplay, ни ffplay, ни mpv",
            "hint": "поставьте alsa-utils (aplay) или pulseaudio-utils (paplay)"}


def play(path: Path, player: dict) -> tuple[bool, str | None]:
    """Проиграть файл выбранным способом.

    :returns (сыграли ли, текст ошибки или None).
    """
    if player["kind"] == "none":
        return False, player.get("hint") or player.get("why")
    if player["kind"] == "winsound":
        try:
            import winsound  # noqa: PLC0415 — только Windows, поэтому импорт внутри ветки
            winsound.PlaySound(str(path), winsound.SND_FILENAME)
            return True, None
        except Exception as error:  # noqa: BLE001
            return False, f"{type(error).__name__} {error}"
    try:
        subprocess.run([player["command"], *player["args"], str(path)],
                       check=True, capture_output=True, timeout=600)
        return True, None
    except Exception as error:  # noqa: BLE001
        return False, f"{type(error).__name__} {error}"


# ВЫБРАННЫЙ ПРОИГРЫВАТЕЛЬ. Определяется один раз при запуске процесса: искать в PATH на каждый
# кусок незачем, а главное — выбор должен быть виден в журнале, чтобы «тишина» объяснялась.
PLAYER = choose_player()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Потоковая озвучка кусками")
    parser.add_argument("--staging", type=int, default=3,
                        help="сколько кусков держать готовыми впереди")
    parser.add_argument("--max-total", type=int, default=6000,
                        help="предохранитель на ОДИН ответ, знаков после очистки; "
                             "планировщик на той стороне режет ответ сам")
    parser.add_argument("--selftest", action="store_true",
                        help="проверить выбор проигрывателя для всех платформ и выйти")
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


def selftest() -> int:
    """Проверить выбор проигрывателя для всех платформ — на любой машине.

    Платформенную ветку нельзя проверить «своим» запуском: на Windows нет Linux, а на Linux нет
    `winsound`. Поэтому выбор вынесен в чистую функцию с подменяемым поиском в PATH, и здесь мы
    прогоняем все три платформы, включая случай «играть нечем»: он обязан дать подсказку, а не
    пустоту, иначе человек снова получит тишину без объяснений.
    """
    checks: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append((name, ok, detail))

    def finder(*available: str):
        return lambda command: f"/usr/bin/{command}" if command in available else None

    windows = choose_player("Windows", finder())
    check("Windows: winsound, без внешних программ",
          windows["kind"] == "winsound" and windows["command"] is None, windows["why"])
    mac = choose_player("Darwin", finder("afplay"))
    check("macOS: afplay", mac["kind"] == "afplay" and mac["command"].endswith("afplay"), mac["why"])
    linux_aplay = choose_player("Linux", finder("aplay"))
    check("Linux: первый найденный это aplay", linux_aplay["kind"] == "aplay", linux_aplay["why"])
    check("Linux: aplay с тихим ключом", linux_aplay["args"] == ["-q"], str(linux_aplay["args"]))
    linux_paplay = choose_player("Linux", finder("paplay", "mpv"))
    check("Linux: если aplay нет, берём paplay", linux_paplay["kind"] == "paplay", linux_paplay["why"])
    linux_ffplay = choose_player("Linux", finder("ffplay"))
    check("Linux: если нет ничего кроме ffplay, берём его", linux_ffplay["kind"] == "ffplay",
          linux_ffplay["why"])
    linux_mpv = choose_player("Linux", finder("mpv"))
    check("Linux: mpv последним", linux_mpv["kind"] == "mpv", linux_mpv["why"])
    nothing = choose_player("Linux", finder())
    check("Linux без проигрывателей: отказ с подсказкой",
          nothing["kind"] == "none" and "alsa-utils" in nothing.get("hint", ""),
          f"{nothing['why']} / {nothing.get('hint', '')}")
    played, why = play(Path("нет-такого-файла.wav"), nothing)
    check("Играть нечем: play отвечает отказом и причиной",
          played is False and why is not None, str(why))

    failures = 0
    for name, ok, detail in checks:
        print(f"{'ПРОШЛО' if ok else 'ПРОВАЛ'}  {name}" + (f" — {detail}" if detail else ""))
        if not ok:
            failures += 1
    print(f"\nпроверок: {len(checks)}, провалов: {failures}")
    return 0 if failures == 0 else 1


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
            played, why = play(Path(path), PLAYER)
            if not played:
                log(f"проиграть кусок {identifier} не удалось: {why}")
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
    # ЧЕМ ИГРАЕМ И ЧЕМ НЕ ИГРАЕМ. Если проигрывателя нет, человек должен узнать это из журнала
    # сразу, а не гадать, почему ответы читаются молча.
    log(f"проигрыватель: {PLAYER['why']}")
    if PLAYER["kind"] == "none":
        log(f"звука не будет: {PLAYER['why']}. {PLAYER.get('hint', '')}".strip())
    if ARGS.selftest:
        return selftest()
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
