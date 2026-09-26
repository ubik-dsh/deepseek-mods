"""Ворота для презентации: измеримые проверки колоды .pptx, а не взгляд «вроде норм».

ОТКУДА ИДЕЯ. У плагина presentations Кодекса-десктопа
(`%USERPROFILE%\\.cache\\codex-runtimes\\...\\plugins\\presentations`, лицензия
Proprietary) главное — не сборка слайдов, а ВОРОТА: арифметика в таблицах
(`native_table_arithmetic_gate.py`), значения на графиках
(`native_quantitative_chart_gate.py`), заголовки графиков, геометрия вёрстки
(`inspect_presentation_layout_geometry.py`, 102 КБ), целостность пакета, верность
шаблону. Колода не считается готовой, пока ворота не пройдены.

Здесь то же по смыслу, но нашим инструментом и без их кода: `python-pptx` плюс
`zipfile`, никаких зависимостей сверх обычного Python.

ЧТО ПРОВЕРЯЕТСЯ

    пакет      файл открывается, слайды есть, размеры слайда заданы
    геометрия  фигуры за краем слайда; текстовые блоки, налезающие друг на друга
    шрифт      размеры ниже порога (по умолчанию 12 пт)
    текст      остатки-заглушки (TODO, lorem, XXX), слишком много слов на слайде
    числа      суммы в таблицах против заявленного «Итого»
    заголовки  разнобой размеров заголовков между слайдами
    метаданные наследие шаблона: чужое имя в lastModifiedBy, дата 2013 года,
               подпись «generated using python-pptx» в описании пакета

ЧЕГО НЕ ДЕЛАЕТ. Не оценивает смысл и красоту. «Абзац не влез» здесь — ОЦЕНКА по
площади и кеглю, а не измерение переноса строк: честно помечается словом оценка.
Размер шрифта, унаследованный от макета, python-pptx не отдаёт — такие прогоны
считаются отдельно и не выдумываются.

    python deck_gates.py КОЛОДА.pptx [--min-font 12] [--max-words 60] [--json]
    python deck_gates.py КОЛОДА.pptx --render папка   # ещё и картинки через LibreOffice
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

if sys.stdout is not None:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

from pptx import Presentation  # noqa: E402
from pptx.util import Emu  # noqa: E402

PLACEHOLDER = re.compile(r"\b(TODO|FIXME|lorem ipsum|xxx+|заполнить|рыба)\b", re.IGNORECASE)
TOTAL_WORD = re.compile(r"^(итого|всего|total|sum)\b", re.IGNORECASE)
# Зазор на «вылет» за край: тень, обводка и выноски иногда выходят на пару
# миллиметров намеренно. Всё, что дальше, — уже ошибка вёрстки.
BLEED_EMU = Emu(91440)  # 0,1 дюйма

# Наследие шаблона python-pptx. Колода, собранная из `Presentation()` без правки
# свойств пакета, уезжает с шапкой 2013 года: в описании — подпись генератора, в
# `lastModifiedBy` — имя автора шаблона, в датах — день, когда шаблон собрали.
# Получатель открывает свойства файла и читает там чужое имя и чужой год.
# Проверка машинная: это строки, а не впечатление.
TEMPLATE_LEFTOVERS = (
    ("описание пакета", re.compile(r"generated using python-pptx", re.IGNORECASE),
     "так python-pptx подписывает колоду, собранную из его шаблона"),
    ("последний автор", re.compile(r"^Steve Canny$", re.IGNORECASE),
     "имя автора шаблона python-pptx, а не того, кто собрал колоду"),
)

# Дата из шаблона стареет молча, поэтому ловится не по числу, а по сравнению с
# самим файлом: метаданные, написанные больше года назад, описывают не его.
STALE_DAYS = 365


def gate_metadata(path: Path, deck) -> tuple[list[dict], list[dict]]:
    """Свойства пакета: не осталось ли в колоде шапки чужого шаблона.

    Возвращает (находки, замечания). Находка — чужое имя, подпись генератора или
    даты, которые не описывают этот файл. Замечание — метаданные просто пустые.
    """
    findings: list[dict] = []
    warns: list[dict] = []
    try:
        core = deck.core_properties
        fields = {
            "описание пакета": core.comments,
            "последний автор": core.last_modified_by,
            "автор": core.author,
        }
    except Exception as error:  # свойства пакета не читаются — это тоже находка
        return [{"kind": "метаданные", "slide": 0,
                 "text": f"свойства пакета не читаются: {type(error).__name__}"}], warns

    for label, pattern, why in TEMPLATE_LEFTOVERS:
        value = fields.get(label) or ""
        if pattern.search(value.strip()):
            findings.append({
                "kind": "метаданные", "slide": 0,
                "text": f"{label}: «{value.strip()}» — {why}",
            })

    # Тот же след, но без списка имён: даты из шаблона не совпадают с файлом.
    for label, when in (("создано", core.created), ("изменено", core.modified)):
        if when is None:
            continue
        try:
            age = datetime.fromtimestamp(path.stat().st_mtime) - when
        except (OSError, OverflowError, ValueError):
            continue
        if age > timedelta(days=STALE_DAYS):
            findings.append({
                "kind": "метаданные", "slide": 0,
                "text": f"{label} {when:%d.%m.%Y} — раньше самого файла на {age.days} дн.; "
                        f"похоже, дата досталась от шаблона, а не от сборки",
            })

    if not (core.title or "").strip():
        warns.append({"kind": "метаданные", "slide": 0,
                      "text": "в свойствах пакета не назван заголовок колоды"})
    if not (core.author or "").strip():
        warns.append({"kind": "метаданные", "slide": 0,
                      "text": "в свойствах пакета не назван автор колоды"})
    return findings, warns


def emu_to_cm(value: int) -> float:
    return round(value / 360000, 2)


def text_of(shape) -> str:
    if not shape.has_text_frame:
        return ""
    return "\n".join(paragraph.text for paragraph in shape.text_frame.paragraphs)


def font_sizes(shape) -> tuple[list[float], int]:
    """Размеры шрифта в фигуре. Возвращает (размеры, сколько прогонов без размера).

    Размер может наследоваться от макета — тогда python-pptx отдаёт None.
    Выдумывать его нельзя, поэтому такие прогоны считаем отдельно.
    """
    sizes: list[float] = []
    unknown = 0
    if not shape.has_text_frame:
        return sizes, unknown
    for paragraph in shape.text_frame.paragraphs:
        for run in paragraph.runs:
            size = run.font.size
            if size is None:
                size = paragraph.font.size
            if size is None:
                unknown += 1
            else:
                sizes.append(size.pt)
    return sizes, unknown


def boxes(slide):
    """Прямоугольники фигур с текстом — для пересечений."""
    result = []
    for shape in slide.shapes:
        if not shape.has_text_frame or not text_of(shape).strip():
            continue
        if None in (shape.left, shape.top, shape.width, shape.height):
            continue
        result.append((shape, shape.left, shape.top, shape.width, shape.height))
    return result


def overlap(a, b) -> float:
    """Доля меньшего прямоугольника, закрытая большим."""
    ax, ay, aw, ah = a[1], a[2], a[3], a[4]
    bx, by, bw, bh = b[1], b[2], b[3], b[4]
    left, top = max(ax, bx), max(ay, by)
    right, bottom = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    if right <= left or bottom <= top:
        return 0.0
    inter = (right - left) * (bottom - top)
    return inter / max(1, min(aw * ah, bw * bh))


def check_tables(slide, number: int) -> list[dict]:
    """Суммы в таблицах против заявленного «Итого» — их идея, наша проверка."""
    findings = []
    for shape in slide.shapes:
        if not getattr(shape, "has_table", False) or not shape.has_table:
            continue
        table = shape.table
        rows = [[cell.text.strip() for cell in row.cells] for row in table.rows]

        def as_number(value: str):
            cleaned = value.replace("\u00a0", " ").replace(" ", "").replace(",", ".")
            cleaned = re.sub(r"[^\d.\-]", "", cleaned)
            try:
                return float(cleaned)
            except ValueError:
                return None

        for index, row in enumerate(rows):
            if index == 0 or not row or not TOTAL_WORD.match(row[0]):
                continue
            for column in range(1, len(row)):
                stated = as_number(row[column])
                if stated is None:
                    continue
                cells = [rows[r][column] for r in range(1, index) if column < len(rows[r])]
                filled = [cell for cell in cells if cell.strip()]
                numbers = [p for p in (as_number(cell) for cell in cells) if p is not None]
                # Столбец считаем числовым, только если ВСЕ его непустые клетки —
                # числа. Первая версия требовала минимум два слагаемых, и ошибка
                # в таблице из одной строки от ворот пряталась (поймал тест).
                if not filled or len(numbers) != len(filled):
                    continue
                computed = round(sum(numbers), 6)
                if abs(computed - stated) > 0.01:
                    findings.append({
                        "kind": "числа",
                        "slide": number,
                        "text": f"«{row[0]}» столбец {column + 1}: заявлено {stated:g}, "
                                f"сумма слагаемых {computed:g}",
                    })
    return findings


def gates(path: Path, min_font: float, max_words: int) -> dict:
    deck = Presentation(str(path))
    width, height = deck.slide_width, deck.slide_height
    findings: list[dict] = []
    warns: list[dict] = []
    unknown_runs = 0
    slide_count = 0

    # Свойства пакета проверяются один раз на файл, а не на слайд.
    metadata_findings, metadata_warns = gate_metadata(path, deck)
    findings.extend(metadata_findings)
    warns.extend(metadata_warns)

    for number, slide in enumerate(deck.slides, start=1):
        slide_count += 1
        words = 0
        title_sizes: list[float] = []
        for shape in slide.shapes:
            text = text_of(shape)
            sizes, unknown = font_sizes(shape)
            unknown_runs += unknown
            words += len(text.split())

            if text.strip():
                if PLACEHOLDER.search(text):
                    findings.append({"kind": "заглушка", "slide": number,
                                     "text": f"в тексте осталось «{PLACEHOLDER.search(text).group(0)}»"})
                for size in sizes:
                    if size < min_font:
                        findings.append({"kind": "шрифт", "slide": number,
                                         "text": f"{size:g} пт — ниже порога {min_font:g}"})
                        break
                if None not in (shape.left, shape.top) and shape.top < height / 4:
                    if sizes:
                        title_sizes.append(max(sizes))

            if None in (shape.left, shape.top, shape.width, shape.height):
                continue
            outside = []
            if shape.left < -BLEED_EMU:
                outside.append(f"слева на {emu_to_cm(-shape.left)} см")
            if shape.top < -BLEED_EMU:
                outside.append(f"сверху на {emu_to_cm(-shape.top)} см")
            if shape.left + shape.width > width + BLEED_EMU:
                outside.append(f"справа на {emu_to_cm(shape.left + shape.width - width)} см")
            if shape.top + shape.height > height + BLEED_EMU:
                outside.append(f"снизу на {emu_to_cm(shape.top + shape.height - height)} см")
            if outside:
                findings.append({"kind": "за краем", "slide": number,
                                 "text": f"фигура «{text.strip()[:30] or shape.shape_type}» выходит "
                                         + ", ".join(outside)})

        if words > max_words:
            warns.append({"kind": "много слов", "slide": number,
                          "text": f"{words} слов при пороге {max_words}"})

        boxes_on_slide = boxes(slide)
        for index, first in enumerate(boxes_on_slide):
            for second in boxes_on_slide[index + 1:]:
                share = overlap(first, second)
                if share > 0.25:
                    warns.append({
                        "kind": "налезают (оценка)", "slide": number,
                        "text": f"«{text_of(first[0]).strip()[:24]}» и «{text_of(second[0]).strip()[:24]}» "
                                f"перекрываются на {share:.0%} площади меньшего",
                    })

        if slide.has_notes_slide and not slide.notes_slide.notes_text_frame.text.strip():
            warns.append({"kind": "пустые заметки", "slide": number, "text": "заметок нет"})

        findings.extend(check_tables(slide, number))

    title_report = "разнобой" if len(set(title_sizes)) > 1 else "одинаковые"
    core = deck.core_properties
    return {
        "file": str(path),
        "slides": slide_count,
        "slide_cm": [emu_to_cm(width), emu_to_cm(height)],
        "package": {
            "title": core.title,
            "author": core.author,
            "last_modified_by": core.last_modified_by,
            "comments": core.comments,
            "created": core.created.isoformat() if core.created else None,
            "modified": core.modified.isoformat() if core.modified else None,
        },
        "runs_without_size": unknown_runs,
        "title_sizes": sorted(set(title_sizes)),
        "title_consistency": title_report,
        "findings": findings,
        "warnings": warns,
    }


def render(path: Path, outdir: Path) -> str:
    """Картинки слайдов через LibreOffice — чтобы посмотреть глазами после ворот."""
    soffice = shutil.which("soffice") or r"C:\Program Files\LibreOffice\program\soffice.exe"
    if not Path(soffice).exists() and shutil.which("soffice") is None:
        return "LibreOffice не найден — рендер пропущен"
    outdir.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [soffice, "--headless", "--convert-to", "pdf", "--outdir", str(outdir), str(path)],
        capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        return f"LibreOffice отказался: {result.stderr.strip()[:120]}"
    pdf = outdir / (path.stem + ".pdf")
    return f"PDF для просмотра: {pdf}" if pdf.exists() else "PDF не появился"


def main() -> int:
    parser = argparse.ArgumentParser(description="Ворота для .pptx")
    parser.add_argument("deck", type=Path)
    parser.add_argument("--min-font", type=float, default=12.0)
    parser.add_argument("--max-words", type=int, default=60)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--render", type=Path, default=None)
    args = parser.parse_args()

    if not args.deck.is_file():
        print(f"колоды нет: {args.deck}")
        return 1
    try:
        report = gates(args.deck, args.min_font, args.max_words)
    except Exception as error:
        print(f"колода не открылась: {type(error).__name__} {error}")
        return 1

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"колода: {args.deck.name}")
        print(f"слайдов: {report['slides']}, размер {report['slide_cm'][0]}x{report['slide_cm'][1]} см")
        package = report["package"]
        print(f"свойства пакета: автор {package['author'] or '—'}, "
              f"последним правил {package['last_modified_by'] or '—'}, "
              f"создано {package['created'] or '—'}")
        print(f"размеры в верхней четверти: {report['title_sizes']} — {report['title_consistency']} "
              f"(разнобой сам по себе не дефект: заголовок и подзаголовок разного кегля — норма)")
        if report["runs_without_size"]:
            print(f"прогонов без своего размера (наследуют макет): {report['runs_without_size']}")
        if report["findings"]:
            print(f"\nНЕ ПРОХОДИТ ({len(report['findings'])}):")
            for item in report["findings"]:
                where = "пакет" if item["slide"] == 0 else f"слайд {item['slide']}"
                print(f"  {where:<6} {item['kind']:<10} {item['text']}")
        else:
            print("\nжёсткие ворота пройдены")
        if report["warnings"]:
            print(f"\nзамечания ({len(report['warnings'])}):")
            for item in report["warnings"][:12]:
                where = "пакет" if item["slide"] == 0 else f"слайд {item['slide']}"
                print(f"  {where:<6} {item['kind']:<18} {item['text']}")
    if args.render:
        print(render(args.deck, args.render))

    return 1 if report["findings"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
