"""Числа и латиница голосом: то, чего синтезатор сам не умеет.

БЕДА, НАЙДЕННАЯ ОПЕРАТОРОМ. Фраза «Подождём 12 секунд» звучала без числа: silero
не произносит цифры, он их пропускает. То же с латиницей: `DSH` читается как «дс»,
`GigaAM` как «ггам». При этом в ответах числа и латинские имена встречаются постоянно,
поэтому чинить это надо в одном месте и для всего текста, а не в одной фразе.

ЧТО ЗДЕСЬ. Два прохода до синтеза:

1. `apply_aliases` — заменяет латинские сокращения на русское произношение по файлу
   `алиасы-речи.txt`. Файл правится руками: это знание оператора о своей речи.
2. `numbers_to_words` — переводит числа в слова: целые, дробные, проценты, время,
   разряды через пробел. Падеж единиц не правим: «12 секунд» должно быть написано
   верно в самом тексте, здесь только произношение цифр.

Проверка: python _voice\числа.py --selftest
"""
from __future__ import annotations

import os
import re
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Словарь произношения можно держать вне пакета: установщик заменяет каталог пакета целиком,
# и правки в алиасы-речи.txt при обновлении пропадут. Переменная DSH_VOICE_ALIASES это лечит.
_ALIASES_FROM_ENV = os.environ.get("DSH_VOICE_ALIASES")
ALIAS_FILE = Path(_ALIASES_FROM_ENV) if _ALIASES_FROM_ENV else HERE / "алиасы-речи.txt"

# УДАРЕНИЯ. Русский синтез ставит ударение сам и на омографах ошибается: «за́мок» и «замо́к»,
# «сто́ит» и «стои́т». Голос понимает пометку «+» перед ударной гласной, и это проверено замером:
# пометка на втором слоге меняет форму звука, а на первом не меняет ничего, потому что там
# ударение и так по умолчанию. Пометки расставляет ruaccent — зависимость НЕОБЯЗАТЕЛЬНАЯ: нет её,
# текст уходит как есть, и читалка работает ровно как раньше. Загрузка занимает десятки секунд,
# поэтому идёт в фоне: первые фразы звучат без пометок, дальше с ними.
_ACCENT: object | None = None
_ACCENT_STATE = "off"          # off | loading | ready | unavailable
_ACCENT_STARTED = False
# ВКЛЮЧЕНО ПО УМОЛЧАНИЮ, и это осознанно: без ruaccent текст уходит как есть, то есть цена
# включённого флага нулевая, а выигрыш на омонимах заметный. Выключается переменной окружения
# (DSH_VOICE_STRESS=0) или настройкой `stress: false` в строке загрузчика мода.
_STRESS_DISABLE = {"0", "off", "false", "no", "нет", "выкл"}
# РАЗМЕР МОДЕЛИ АКЦЕНТУАТОРА. Здесь была ошибка, и её видно замером: я поставил `tiny`, а он
# экономит память ценой смысла — «по́том» и «пото́м» читаются одинаково. Ключа `big` у этой версии
# нет вовсе (KeyError в её собственной карте моделей), зато УМОЛЧАНИЕ ruaccent оказалось самым
# точным: на списке из восемнадцати пар оно дало 17 верных против 11 у `tiny`. Поэтому по умолчанию
# размер НЕ указываем, а переменная осталась для опытов (`DSH_VOICE_ACCENT_SIZE=tiny` вернёт лёгкую).
_ACCENT_SIZE = os.environ.get("DSH_VOICE_ACCENT_SIZE", "").strip()


def start_stress_loading() -> bool:
    """Начать загрузку акцентуатора в фоне, если ударения не выключены явно."""
    global _ACCENT_STATE, _ACCENT_STARTED
    if _ACCENT_STARTED:
        return _ACCENT_STATE == "loading"
    _ACCENT_STARTED = True
    wanted = os.environ.get("DSH_VOICE_STRESS", "1").strip().lower()
    if wanted in _STRESS_DISABLE:
        _ACCENT_STATE = "off"
        return False
    _ACCENT_STATE = "loading"
    threading.Thread(target=_load_accent, name="accent", daemon=True).start()
    return True


def _load_accent() -> None:
    """Загрузить ruaccent. Медленно, поэтому только в фоне и молча: неудача не ломает чтение."""
    global _ACCENT, _ACCENT_STATE
    try:
        from ruaccent import RUAccent

        accent = RUAccent()
        if _ACCENT_SIZE == "":
            # Ничего не указываем: это и есть самая точная модель ruaccent, проверено списком пар.
            accent.load(use_dictionary=True, device="CPU")
        else:
            accent.load(omograph_model_size=_ACCENT_SIZE, use_dictionary=True, device="CPU")
        _ACCENT = accent
        _ACCENT_STATE = "ready"
        log_line(f"ruaccent загружен ({_ACCENT_SIZE or 'по умолчанию'}): ударения расставляются")
    except Exception as error:  # noqa: BLE001
        _ACCENT = None
        _ACCENT_STATE = "unavailable"
        log_line(f"ruaccent не поднялся ({type(error).__name__}): текст идёт без пометок ударения")


def log_line(message: str) -> None:
    """Строка в журнал голосового процесса: тот же вид, что у остальных его сообщений."""
    import time

    sys.stderr.write(f"{time.strftime('%H:%M:%S')} {message}\n")
    sys.stderr.flush()


def stress_marks(text: str) -> str:
    """Поставить ударения, если акцентуатор включён и уже загружен. Иначе текст как есть."""
    if _ACCENT_STATE != "ready" or _ACCENT is None or text.strip() == "":
        return text
    try:
        return _ACCENT.process_all(text)  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        return text


UNITS = ["ноль", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"]
UNITS_FEMALE = ["ноль", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"]
TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать",
         "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"]
TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят",
        "восемьдесят", "девяносто"]
HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот",
            "восемьсот", "девятьсот"]

# Склонение по числу: 1 тысяча, 2 тысячи, 5 тысяч.
THOUSAND_FORMS = ("тысяча", "тысячи", "тысяч")
MILLION_FORMS = ("миллион", "миллиона", "миллионов")


def plural_index(value: int) -> int:
    """0 для «одна тысяча», 1 для «две тысячи», 2 для «пять тысяч»."""
    mod100 = value % 100
    if 11 <= mod100 <= 14:
        return 2
    mod10 = value % 10
    if mod10 == 1:
        return 0
    if 2 <= mod10 <= 4:
        return 1
    return 2


def triple_to_words(value: int, female: bool = False) -> list[str]:
    """Слова для числа от 0 до 999."""
    words: list[str] = []
    hundreds, rest = divmod(value, 100)
    if hundreds:
        words.append(HUNDREDS[hundreds])
    tens, units = divmod(rest, 10)
    if tens == 1:
        words.append(TEENS[units])
        return words
    if tens:
        words.append(TENS[tens])
    if units or not words:
        words.append((UNITS_FEMALE if female else UNITS)[units])
    return words


def integer_to_words(value: int) -> str:
    """Число словами, до миллиарда. Отрицательное — со словом «минус»."""
    if value == 0:
        return "ноль"
    if value < 0:
        return f"минус {integer_to_words(-value)}"
    parts: list[str] = []
    millions, rest = divmod(value, 1_000_000)
    thousands, units = divmod(rest, 1000)
    if millions:
        # «миллион» вместо «один миллион»: так о числе говорят, а не читают его.
        if millions == 1:
            parts.append(MILLION_FORMS[0])
        else:
            parts += triple_to_words(millions)
            parts.append(MILLION_FORMS[plural_index(millions)])
    if thousands:
        if thousands == 1:
            parts.append(THOUSAND_FORMS[0])
        else:
            parts += triple_to_words(thousands, female=True)
            parts.append(THOUSAND_FORMS[plural_index(thousands)])
    if units:
        parts += triple_to_words(units)
    return " ".join(parts)


def female_whole(value: int) -> str:
    """Целая часть в женском роде: одна, две, двадцать одна, сто сорок семь."""
    if value == 1:
        return "одна"
    if value == 2:
        return "две"
    words = integer_to_words(value)
    words = re.sub(r"\bодин$", "одна", words)
    words = re.sub(r"\bдва$", "две", words)
    return words


def decimal_to_words(text: str) -> str:
    """«0.26» → «ноль целых двадцать шесть сотых», «1,5» → «одна целая пять десятых»."""
    whole, fraction = re.split(r"[.,]", text, maxsplit=1)
    digits = len(fraction)
    fraction_forms = {1: ("десятая", "десятых"),
                      2: ("сотая", "сотых"),
                      3: ("тысячная", "тысячных")}.get(digits, ("десятитысячная", "десятитысячных"))
    whole_value = int(whole)
    fraction_value = int(fraction)
    whole_words = female_whole(whole_value)
    whole_form = "целая" if whole_value % 10 == 1 and whole_value % 100 != 11 else "целых"
    if fraction_value == 0:
        return f"{whole_words} {whole_form}"
    fraction_words = female_whole(fraction_value)
    fraction_form = fraction_forms[0] if fraction_value % 10 == 1 and fraction_value % 100 != 11 \
        else fraction_forms[1]
    return f"{whole_words} {whole_form} {fraction_words} {fraction_form}"


def percent_words(value: int) -> str:
    """«процент», «процента», «процентов» по числу."""
    return ("процент", "процента", "процентов")[plural_index(value)]


def numbers_to_words(text: str) -> str:
    """Заменить числа в тексте на слова. Разряды через пробел считаются одним числом."""
    result = text
    # Время вида 12:30 — до остальных чисел, иначе двоеточие разрежет его на два.
    result = re.sub(r"\b(\d{1,2}):(\d{2})\b",
                    lambda m: f"{integer_to_words(int(m.group(1)))} {integer_to_words(int(m.group(2)))}",
                    result)
    # Проценты.
    result = re.sub(r"\b(\d+)\s*%",
                    lambda m: f"{integer_to_words(int(m.group(1)))} {percent_words(int(m.group(1)))}",
                    result)
    # Версии до остальных чисел: `32.0.16.1088` — это не дробь.
    result = re.sub(VERSION_LIKE, lambda m: version_to_words(m.group(0)), result)
    # Дробные: 0.26 и 1,5.
    result = re.sub(r"\b\d+[.,]\d+\b", lambda m: decimal_to_words(m.group(0)), result)
    # Разряды через пробел или неразрывный пробел: 1 447.
    result = re.sub(r"\b\d{1,3}(?:[ \u00a0]\d{3})+\b",
                    lambda m: integer_to_words(int(re.sub(r"[ \u00a0]", "", m.group(0)))), result)
    # Обычные целые.
    result = re.sub(r"\b\d+\b",
                    lambda m: integer_to_words(int(m.group(0))) if len(m.group(0)) < 10
                    else " ".join(integer_to_words(int(digit)) for digit in m.group(0)), result)
    return result


def load_aliases(path: Path = ALIAS_FILE) -> list[tuple[str, str]]:
    """Прочитать файл алиасов: строки вида `DSH = ди эс эйч`."""
    pairs: list[tuple[str, str]] = []
    if not path.exists():
        return pairs
    for line in path.read_text("utf-8").splitlines():
        line = line.strip()
        if line == "" or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        pairs.append((key.strip(), value.strip()))
    # Длинные ключи первыми: иначе `API` съест начало `API-ключ`.
    pairs.sort(key=lambda pair: len(pair[0]), reverse=True)
    return pairs


def apply_aliases(text: str, aliases: list[tuple[str, str]] | None = None) -> str:
    """Заменить латинские сокращения на русское произношение."""
    pairs = load_aliases() if aliases is None else aliases
    result = text
    for key, value in pairs:
        result = re.sub(rf"(?<![\w-]){re.escape(key)}(?![\w-])", value, result)
    return result


# ГОТОВЫЙ НОРМАЛИЗАТОР. `ru-normalizr` (режим tts) делает числа, даты, годы, проценты
# и перевод английских слов через фонетику лучше, чем написано здесь руками. Поэтому он
# главный, а правила ниже остаются запасным путём: чтение вслух не должно зависеть от
# того, стоит ли пакет в питоне.
_ENGINE: object | bool | None = None


def normalizer_engine():
    """Нормализатор `ru-normalizr`, или None, если пакета нет."""
    global _ENGINE
    if _ENGINE is None:
        try:
            from ru_normalizr import NormalizeOptions, Normalizer
            _ENGINE = Normalizer(NormalizeOptions.tts())
        except Exception:  # noqa: BLE001 — нет пакета значит нет, работаем своими правилами
            _ENGINE = False
    return _ENGINE or None


def normalize_russian_run(text: str) -> str:
    """Числа и сокращения в русском куске: сначала готовый нормализатор, потом свой."""
    if text.strip() == "":
        return text
    engine = normalizer_engine()
    if engine is not None:
        try:
            return engine.normalize(text)
        except Exception:  # noqa: BLE001
            pass
    return numbers_to_words(text)


# Даты и годы распознаём ДО перевода чисел, чтобы отдать их готовому нормализатору:
# он умеет падеж («две тысячи двадцать шестой год»), а наши правила не умеют.
# Проверка СТРОГАЯ: день, месяц и год. Раньше бралось любое «число.число», и версия
# `32.0.16.1088` уходила в нормализатор как дата, а `5.27` читалось дробью.
DATE_LIKE = re.compile(
    r"\b[0-3]?\d[./-](?:1[0-2]|0?[1-9])[./-](?:19|20)?\d{2}\b"
    r"|\b(?:1\d{3}|20\d{2})\b\s*(?:год|году|года|годов|г\.)",
    re.IGNORECASE,
)

# Версия: три и больше чисел через точку. Читается «точка» между числами, а не дробью.
VERSION_LIKE = re.compile(r"\b\d{1,4}(?:\.\d{1,5}){2,}\b")

# Версия ПОСЛЕ СЛОВА. Двухкомпонентную версию (`5.27`) от дроби (`0.26 секунды`) отличает
# только контекст: после «версия», «драйвер», «сборка» это версия, и читать её надо «точка».
VERSION_CONTEXT = re.compile(
    r"\b(верси\w*|драйвер\w*|сборк\w*|build|v)\s+(\d+(?:\.\d+)+)",
    re.IGNORECASE,
)


def version_to_words(text: str) -> str:
    """`32.0.16.1088` → «тридцать два точка ноль точка шестнадцать точка тысяча восемьдесят восемь»."""
    return " точка ".join(integer_to_words(int(part)) for part in text.split("."))


# Русские сокращения единиц: без них «12 ГБ» звучит как «двенадцать гэ бэ».
# Формы нужны все три: «один гигабайт», «два гигабайта», «пять гигабайтов» — иначе
# «32 ГБ» читается как «тридцать два гигабайт», что по-русски не говорят.
RUSSIAN_UNITS = {
    "ГБ": ("гигабайт", "гигабайта", "гигабайтов"),
    "МБ": ("мегабайт", "мегабайта", "мегабайтов"),
    "КБ": ("килобайт", "килобайта", "килобайтов"),
    "ТБ": ("терабайт", "терабайта", "терабайтов"),
    "ГГц": ("гигагерц", "гигагерца", "гигагерц"),
    "МГц": ("мегагерц", "мегагерца", "мегагерц"),
    "кГц": ("килогерц", "килогерца", "килогерц"),
    "Гц": ("герц", "герца", "герц"),
    "мс": ("миллисекунда", "миллисекунды", "миллисекунд"),
    "сек": ("секунда", "секунды", "секунд"),
    "мин": ("минута", "минуты", "минут"),
    "км": ("километр", "километра", "километров"),
    "кг": ("килограмм", "килограмма", "килограммов"),
    "см": ("сантиметр", "сантиметра", "сантиметров"),
    "мм": ("миллиметр", "миллиметра", "миллиметров"),
    "мл": ("миллилитр", "миллилитра", "миллилитров"),
    "шт": ("штука", "штуки", "штук"),
    "руб": ("рубль", "рубля", "рублей"),
    "тыс": ("тысяча", "тысячи", "тысяч"),
    "млн": ("миллион", "миллиона", "миллионов"),
    "млрд": ("миллиард", "миллиарда", "миллиардов"),
    "вт": ("ватт", "ватта", "ватт"),
    "кВт": ("киловатт", "киловатта", "киловатт"),
}

# Последние слова числа, после которых единица идёт в форме «гигабайта».
SMALL_NUMBER_TAILS = ("один", "одна", "два", "две", "три", "четыре")


def expand_units(text: str) -> str:
    """Раскрыть русские сокращения единиц и согласовать их с числом.

    Числа к этому моменту уже слова, поэтому форма выбирается по последнему слову:
    «двадцать два» → «гигабайта», «шестнадцать» → «гигабайтов».
    """
    result = text
    for short, forms in RUSSIAN_UNITS.items():
        pattern = re.compile(
            rf"([\w\u0400-\u04ff-]+(?:\s+[\w\u0400-\u04ff-]+)?)\s+(?<![\w]){re.escape(short)}(?![\w])")

        def pick(match: re.Match, forms: tuple[str, str, str] = forms) -> str:
            phrase = match.group(1).split()
            tail = phrase[-1].lower() if phrase else ""
            if tail in SMALL_NUMBER_TAILS:
                return f"{match.group(1)} {forms[1]}"
            return f"{match.group(1)} {forms[0]}"

        result = pattern.sub(pick, result)
    return result


def prepare(text: str) -> str:
    """Полная подготовка текста к синтезу.

    Порядок важен и проверен замером:

    1. файл оператора `алиасы-речи.txt` — его решение главнее любого правила;
    2. латинские токены отдельно (`латиница.py`): пути, имена файлов, расширения,
       аббревиатуры — готовый нормализатор их ломает;
    3. кусок с датой или годом отдаём готовому нормализатору целиком: он умеет падеж
       («две тысячи двадцать шестой год»), а наши правила не умеют;
    4. остальные числа переводим САМИ. Готовый нормализатор на «на 3080» выдал
       «на трёх тысячи восемьдесят»: падеж через край хуже ровного «на три тысячи»;
    5. пробелы по краям кусков сохраняем: нормализатор их срезает, и слова слипались.
    """
    import латиница

    aliases = load_aliases()
    # ФАЙЛ ОПЕРАТОРА ПРИМЕНЯЕМ ДО РАЗБОРА НА ТОКЕНЫ. Иначе запись из двух слов
    # («American Megatrends = американ мегатрендс») не совпадает никогда: текст уже
    # порезан на латинские токены, и фразы целиком в нём не остаётся.
    text = apply_aliases(text, aliases)
    out: list[str] = []
    for is_latin, chunk in латиница.split_runs(text):
        if is_latin:
            out.append(латиница.convert_latin_runs(chunk, aliases))
            continue
        lead = chunk[:len(chunk) - len(chunk.lstrip())]
        trail = chunk[len(chunk.rstrip()):]
        core = chunk.strip()
        if core == "":
            out.append(chunk)
            continue
        prepared = VERSION_CONTEXT.sub(
            lambda m: f"{m.group(1)} {version_to_words(m.group(2))}", core)
        # Дата или год — нормализатору целиком: он ставит падеж и читает годы порядковым.
        # Иначе числа переводим сами, и только ПОТОМ пускаем нормализатор: он раскрывает
        # русские сокращения («ГБ» → «гигабайт»), а цифр к тому времени уже нет, поэтому
        # склонять ему нечего. Это и проверяется случаем «на 3080» ниже.
        spoken = normalize_russian_run(prepared) if DATE_LIKE.search(prepared) \
            else normalize_russian_run(expand_units(numbers_to_words(prepared)))
        out.append(lead + spoken + trail)
    # СКЛЕЙКА БЕЗ ПОТЕРИ РАЗДЕЛИТЕЛЯ. Латиница и русский приходят разными кусками, и раньше они
    # сшивались вплотную: «плагин» и «bundle» давали на слух одно слово «плагинбэндэл». Если на
    # стыке нет ни пробела, ни знака, ставим пробел; лишние пробелы сжимаем.
    joined = ""
    for piece in out:
        if (joined != "" and piece != ""
                and re.search(r"[\wА-Яа-я]$", joined) and re.match(r"^[\wА-Яа-я]", piece)):
            joined += " "
        joined += piece
    prepared = re.sub(r"[ \t]{2,}", " ", joined)
    # УДАРЕНИЯ ПОСЛЕДНИМ ШАГОМ. Раньше нельзя: готовый нормализатор и наши правила работают с
    # текстом, а пометка «+» для них чужой знак. Дальше текст идёт прямо в синтез.
    start_stress_loading()
    return stress_marks(prepared)


def selftest() -> int:
    """Проверка подготовки текста.

    Главное требование оператора проверяется свойством, а не строкой: в том, что уходит
    синтезатору, не должно остаться НИ ЦИФР, НИ ЛАТИНИЦЫ — именно их голос и пропускал.
    Точные строки проверяем там, где правило наше и потому устойчиво: имена файлов,
    аббревиатуры, расширения. Числа и падежи отданы готовому нормализатору, и его
    формулировки могут отличаться от наших запасных — это записано, а не спрятано.
    """
    exact = [
        ("dsh_voice.mjs", "ди эс эйч войс эм джей эс"),
        ("GPU и RTX 5070", "джи пи ю и эр ти икс пять тысяч семьдесят"),
        ("DSH на 3080", "ди эс эйч на три тысячи восемьдесят"),
        ("Подождём 12 секунд.", "Подождём двенадцать секунд."),
        ("GigaAM и Whisper", "ГигаАМ и виспер"),
        ("voice-stream.mod", "войс стрим мод"),
        ("ds1", "ди эс один"),
        # Проверка на «падеж через край»: готовый нормализатор не должен трогать числа,
        # которые мы уже перевели, иначе «на 3080» станет «на трёх тысячи восемьдесят».
        ("на 3080 стоит плата", "на три тысячи восемьдесят стоит плата"),
        ("карта на 12 ГБ", "карта на двенадцать гигабайт"),
    ]
    properties = [
        "dsh_voice.mjs",
        "Так, смотрю _voice\\dsh_voice.mjs и правлю client.js",
        "порт 3080 отвечал 401",
        "синтез 0.26 секунды, всего 1 447 знаков",
        "2026 год",
        "5% случаев",
        "GPU RTX 5070, 12 ГБ",
        "http://127.0.0.1:3080/api/voice-stream.mod",
    ]
    failed = 0
    for source, expected in exact:
        got = prepare(source)
        if got != expected:
            failed += 1
        print(f"{'ПРОШЛО' if got == expected else 'ПРОВАЛ'}  {source!r} -> {got!r}")
        if got != expected:
            print(f"        ждал: {expected!r}")
    print()
    for source in properties:
        got = prepare(source)
        clean = not re.search(r"[0-9A-Za-z]", got)
        if not clean:
            failed += 1
        print(f"{'ПРОШЛО' if clean else 'ПРОВАЛ'}  без цифр и латиницы: {source!r}")
        print(f"        звучит: {got!r}")
    total = len(exact) + len(properties)
    # УДАРЕНИЯ: пока акцентуатор грузится или его нет, текст обязан уйти без пометок. Состояние
    # выставляем сами: проверка не должна зависеть от того, успел ли фон загрузить модель.
    global _ACCENT_STATE
    saved = _ACCENT_STATE
    _ACCENT_STATE = "loading"
    quiet = "+" not in prepare("Он стоит дорого.")
    _ACCENT_STATE = "unavailable"
    passthrough = stress_marks("Он стоит дорого.") == "Он стоит дорого."
    _ACCENT_STATE = saved
    for title, ok in (("пока акцентуатор грузится, пометок нет", quiet),
                      ("без акцентуатора текст уходит без пометок", passthrough)):
        failed += 0 if ok else 1
        total += 1
        print(f"{'ПРОШЛО' if ok else 'ПРОВАЛ'}  {title}")
    print(f"\nпроверок: {total}, провалов: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    text = " ".join(sys.argv[1:]) or "Подождём 12 секунд, синтез 0.26 с, порт 3080"
    print(prepare(text))
