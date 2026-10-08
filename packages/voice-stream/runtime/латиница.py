"""Латиница голосом: имена файлов, пути, аббревиатуры, английские слова.

ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Готовый нормализатор `ru-normalizr` (режим tts) отлично
переводит английские слова и числа, но ломает ровно то, что чаще всего встречается
в ответах: `dsh_voice.mjs` он читает как «дш войс. Мджс» — точка с расширением
превращается в конец предложения, а `mjs` читается словом. Аббревиатуры тоже плывут:
`GPU` → «гпю», `API` → «эпи`, `RTX` → «рткс».

ПОЭТОМУ РАБОТА ДЕЛИТСЯ ТАК:

* структуру разбирает этот модуль — пути, имена файлов, расширения, аббревиатуры;
* незнакомые обычные слова (`voice`, `client`, `stream`) уходят в `ru-normalizr`,
  у него для этого есть фонетика через IPA (`voice` → «войс»);
* файл оператора `алиасы-речи.txt` решает спорные случаи и правится руками.

Проверка: python _voice\латиница.py --selftest
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# Названия английских букв по-русски: как их произносят, а не как они пишутся.
LETTER_NAMES = {
    "a": "эй", "b": "би", "c": "си", "d": "ди", "e": "и", "f": "эф", "g": "джи",
    "h": "эйч", "i": "ай", "j": "джей", "k": "кей", "l": "эл", "m": "эм", "n": "эн",
    "o": "оу", "p": "пи", "q": "кью", "r": "ар", "s": "эс", "t": "ти", "u": "ю",
    "v": "ви", "w": "дабл-ю", "x": "икс", "y": "уай", "z": "зед",
}

# Расширения читаются по-разному: одни буквами, другие сложились в слово.
EXTENSIONS = {
    "mjs": "эм джей эс", "js": "джей эс", "ts": "ти эс", "py": "питон", "md": "эм ди",
    "txt": "текст", "json": "джейсон", "jsonl": "джейсон эл", "yml": "ямл", "yaml": "ямл",
    "toml": "томл", "ini": "ини", "cfg": "конфиг", "log": "лог", "wav": "вав",
    "mp3": "эм пэ три", "ps1": "пи эс один", "bat": "бат", "sh": "эс эйч", "exe": "экзе",
    "dll": "дэ эл эл", "onnx": "о эн эн икс", "zst": "зст", "csv": "цэ эс ви",
    "xml": "икс эм эл", "html": "эйч тэ эм эл", "css": "цэ эс эс", "png": "пэ эн джи",
    "jpg": "джей пег", "pdf": "пэ дэ эф", "zip": "зип", "pt": "пи ти", "bin": "бин",
}

# Своё и частое: то, что фонетика читает неверно или разбирает по буквам.
BUILTIN = {
    "gigaam": "ГигаАМ", "silero": "силеро", "vosk": "воск", "whisper": "виспер",
    "dsh": "ди эс эйч", "onnx": "о эн эн икс", "cuda": "куда", "torch": "торч",
    "gpu": "джи пи ю", "cpu": "си пи ю", "rtx": "эр ти икс", "api": "эй пи ай",
    "asr": "а эс эр", "tts": "тэ тэ эс", "vad": "вэ а дэ", "env": "энви",
    "venv": "вэ энви", "fs": "эф эс", "os": "о эс", "ui": "ю ай", "id": "ай ди",
    # Короткие английские слова: фонетика норовит прочитать их по буквам («mod» → «эм оу ди»).
    "mod": "мод", "app": "эп", "dev": "дев", "run": "ран", "set": "сет", "get": "гет",
    "put": "пут", "add": "адд", "del": "дел", "sum": "сам", "max": "макс", "min": "мин",
    "key": "ки", "map": "мап", "bin": "бин", "doc": "док", "lib": "либ", "log": "лог",
    "cmd": "команд", "arg": "арг", "tmp": "темп", "req": "рек", "res": "рес",
    "err": "эрр", "msg": "мессидж", "ver": "версия", "num": "намбер", "str": "строка",
    "int": "инт", "obj": "обжект", "arr": "эррэй", "idx": "индекс", "sec": "сек",
    "mjs": "эм джей эс", "js": "джей эс", "ts": "ти эс", "py": "питон", "md": "эм ди",
    # Имена, которые фонетика произносит узнаваемо неправильно.
    "micron": "майкрон", "nvidia": "энвидиа", "geforce": "джифорс", "intel": "интел",
    # Аббревиатуры, которые по-русски говорят СЛОВОМ, а не по буквам: цепочку коротких
    # слов («би ай оу эс», «эн вэ эм и») голос прожёвывает, а слово звучит целиком.
    "bios": "биос", "uefi": "уэфи", "nvme": "энвээми", "ssd": "эс-эс-ди",
    "hdd": "хадэдэ", "usb": "ю-эс-би", "sata": "сата", "raid": "райд", "ide": "иде",
    "polestar": "полэстар", "amd": "эй эм ди", "ryzen": "райзен",
    "amd radeon": "радеон", "samsung": "самсунг", "seagate": "сигейт", "kingston": "кингстон",
    "wd": "дабл-ю ди", "toshiba": "тошиба", "crucial": "крушиал", "asus": "эйсус",
    "gigabyte": "гигабайт", "msi": "эм эс ай", "asrock": "асрок", "realtek": "реалтек",
}

# Разделители внутри одного токена: путь, имя с расширением, составное слово.
SEPARATORS = re.compile(r"[\\/]+")
PARTS = re.compile(r"[._-]+")

# Токен, в котором есть хоть одна латинская буква: цифры и разделители внутри него свои.
LATIN_RUN = re.compile(r"[A-Za-z0-9_.:\\/+-]*[A-Za-z][A-Za-z0-9_.:\\/+-]*")


def load_user_aliases(path: Path | None = None) -> list[tuple[str, str]]:
    """Файл оператора: строки вида `DSH = ди эс эйч`."""
    from числа import load_aliases
    return load_aliases(path) if path is not None else load_aliases()


def _lazy_normalizer():
    """Готовый нормализатор для обычных английских слов, если он установлен."""
    from числа import normalizer_engine
    return normalizer_engine()


def letter_names(word: str) -> str:
    """Слово по буквам: `mjs` → «эм джей эс», `DSH` → «ди эс эйч»."""
    return " ".join(LETTER_NAMES.get(letter.lower(), letter) for letter in word if letter.isalpha())


def digits_in_words(part: str) -> str:
    """Цифры внутри латинского токена: `ds1` → «ди эс один»."""
    from числа import integer_to_words
    out = re.sub(r"\d+", lambda m: f" {integer_to_words(int(m.group(0)))} ", part)
    return re.sub(r"\s+", " ", out).strip()


def looks_like_acronym(part: str) -> bool:
    """Аббревиатура: две-пять заглавных букв, либо короткое слово без гласных."""
    letters = [letter for letter in part if letter.isalpha()]
    if len(letters) < 2 or len(letters) > 5:
        return False
    if part.isupper():
        return True
    return not any(letter.lower() in "aeiouy" for letter in letters)


def convert_part(part: str, aliases: list[tuple[str, str]], engine) -> str:
    """Одно слово латиницей: алиасы, своё, аббревиатура, фонетика."""
    part = part.strip(":;,.()[]")
    if part == "":
        return ""
    lowered = part.lower()
    for key, value in aliases:
        if key.lower() == lowered:
            return value
    if lowered in BUILTIN:
        return BUILTIN[lowered]
    if lowered in EXTENSIONS:
        return EXTENSIONS[lowered]
    # Буквы вперемешку с цифрами: `ds1` — сначала буквы, потом число. Проверяем это
    # ДО аббревиатуры: иначе `ds1` уходит в буквы и число пропадает совсем.
    if re.search(r"\d", part) and re.search(r"[A-Za-z]", part):
        return digits_in_words(re.sub(r"[A-Za-z]+", lambda m: letter_names(m.group(0)), part))
    if looks_like_acronym(part):
        return letter_names(part)
    if engine is not None:
        try:
            spoken = engine.normalize(part).strip()
            if spoken != "":
                return spoken
        except Exception:  # noqa: BLE001 — фонетика не обязана справляться со всем
            pass
    return letter_names(part)


def convert_token(token: str, aliases: list[tuple[str, str]], engine) -> str:
    """Токен целиком: путь, имя файла, составное слово или просто слово."""
    # Путь: каждый отрезок читаем отдельно, разделители не произносим.
    if "\\" in token or "/" in token:
        pieces = [piece for piece in SEPARATORS.split(token) if piece not in ("", ".")]
        return " ".join(convert_token(piece, aliases, engine) for piece in pieces)
    # Имя с расширением: `dsh_voice.mjs` — имя отдельно, расширение отдельно.
    if re.fullmatch(r"[\w-]+\.[A-Za-z0-9]+", token):
        name, extension = token.rsplit(".", 1)
        spoken_name = " ".join(convert_part(part, aliases, engine) for part in PARTS.split(name) if part)
        lowered = extension.lower()
        spoken_extension = EXTENSIONS.get(lowered) or BUILTIN.get(lowered) or letter_names(extension)
        return f"{spoken_name} {spoken_extension}".strip()
    # Составное слово через подчёркивание или дефис: `voice-stream`, `_hf-cache`.
    if "_" in token or "-" in token:
        parts = [part for part in PARTS.split(token) if part]
        return " ".join(convert_part(part, aliases, engine) for part in parts)
    if token.isdigit():
        return digits_in_words(token)
    return convert_part(token, aliases, engine)


# Знаки по краям токена: точку в конце `client.js.` движок принимает за конец предложения
# и делает из расширения новое предложение («клайэнт. Джс»). Края отрезаем и возвращаем.
EDGE_PUNCT = re.compile(r"^([:;,.()\[\]]*)(.*?)([:;,.()\[\]]*)$", re.DOTALL)


def convert_latin_runs(text: str, aliases: list[tuple[str, str]] | None = None,
                       engine=None) -> str:
    """Заменить латинские токены кириллицей, остальное не трогать."""
    if not re.search(r"[A-Za-z]", text):
        return text
    pairs = load_user_aliases() if aliases is None else aliases
    resolved = _lazy_normalizer() if engine is None else engine

    def replace(match: re.Match) -> str:
        lead, core, trail = EDGE_PUNCT.match(match.group(0)).groups()
        if core == "":
            return match.group(0)
        return lead + convert_token(core, pairs, resolved) + trail

    return LATIN_RUN.sub(replace, text)


def split_runs(text: str) -> list[tuple[bool, str]]:
    """Разбить текст на куски: (латиница?, текст). Латиница считается отдельно."""
    parts: list[tuple[bool, str]] = []
    position = 0
    for match in LATIN_RUN.finditer(text):
        if match.start() > position:
            parts.append((False, text[position:match.start()]))
        parts.append((True, match.group(0)))
        position = match.end()
    if position < len(text):
        parts.append((False, text[position:]))
    return parts


def selftest() -> int:
    cases = [
        ("dsh_voice.mjs", "ди эс эйч войс эм джей эс"),
        ("client.js", "клайэнт джей эс"),
        ("_voice\\dsh_voice.mjs", "войс ди эс эйч войс эм джей эс"),
        ("voice-stream.mod", "войс стрим мод"),
        ("GPU", "джи пи ю"),
        ("RTX", "эр ти икс"),
        ("API", "а пи ай"),
        ("DSH", "ди эс эйч"),
        ("gigaam-gpu-env", "ГигаАМ джи пи ю энви"),
        ("ds1", "ди эс один"),
        ("client.js.", "клайэнт джей эс."),
    ]
    aliases = load_user_aliases()
    failed = 0
    for source, expected in cases:
        got = convert_latin_runs(source, aliases)
        mark = "ПРОШЛО" if got == expected else "ПРОВАЛ"
        if got != expected:
            failed += 1
        print(f"{mark}  {source!r} -> {got!r}")
        if got != expected:
            print(f"        ждал: {expected!r}")
    print(f"\nпроверок: {len(cases)}, провалов: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(convert_latin_runs(" ".join(sys.argv[1:]) or "Так, смотрю dsh_voice.mjs и правлю GPU"))
