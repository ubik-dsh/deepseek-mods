"""Проверка ворот: чистая колода проходит, испорченная — ловится по каждой поломке.

Смысл не в том, что «скрипт запустился», а в том, что он РАЗЛИЧАЕТ. Колода
портится нарочно пятью способами, и ворота обязаны назвать каждый.

Пятая поломка — метаданные: колода, собранная из шаблона python-pptx и не
правившая свойства пакета, уезжает с `lastModifiedBy: Steve Canny`, датой
27.01.2013 и подписью «generated using python-pptx» в описании. Найти это
глазами можно, а ворота этого не видели.

    python test-deck-gates.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from pptx import Presentation
from pptx.util import Cm, Pt

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "deck_gates.py"


def blank_deck(path: Path, *, broken: bool) -> None:
    deck = Presentation()
    deck.slide_width, deck.slide_height = Cm(33.87), Cm(19.05)

    slide = deck.slides.add_slide(deck.slide_layouts[5])
    slide.shapes.title.text = "Заголовок"
    for paragraph in slide.shapes.title.text_frame.paragraphs:
        for run in paragraph.runs:
            run.font.size = Pt(30)
    body = slide.shapes.add_textbox(Cm(2), Cm(5), Cm(20), Cm(4))
    body.text_frame.text = "Обычный текст на слайде, кегль нормальный."
    for paragraph in body.text_frame.paragraphs:
        for run in paragraph.runs:
            run.font.size = Pt(14)

    if not broken:
        # У готовой колоды свойства пакета заполнены. Без них ворота справедливо
        # ругаются: даты из шаблона описывают не этот файл.
        core = deck.core_properties
        core.title = "Проверочная колода"
        core.author = "test-deck-gates"
        core.last_modified_by = "test-deck-gates"
        core.comments = "собрана тестом ворот"
        core.created = core.modified = datetime.now()

    if broken:
        # 1. слишком мелкий шрифт
        tiny = slide.shapes.add_textbox(Cm(2), Cm(10), Cm(10), Cm(2))
        tiny.text_frame.text = "Мелкий текст"
        for paragraph in tiny.text_frame.paragraphs:
            for run in paragraph.runs:
                run.font.size = Pt(6)

        # 2. фигура за краем слайда
        outside = slide.shapes.add_textbox(Cm(-4), Cm(12), Cm(8), Cm(2))
        outside.text_frame.text = "Уехало влево"
        for paragraph in outside.text_frame.paragraphs:
            for run in paragraph.runs:
                run.font.size = Pt(14)

        # 3. остаток-заглушка
        todo = slide.shapes.add_textbox(Cm(20), Cm(14), Cm(10), Cm(2))
        todo.text_frame.text = "TODO: дописать"
        for paragraph in todo.text_frame.paragraphs:
            for run in paragraph.runs:
                run.font.size = Pt(14)

        # 4. таблица с неверным «Итого»
        table = slide.shapes.add_table(3, 2, Cm(2), Cm(15), Cm(12), Cm(3)).table
        table.cell(0, 0).text = "статья"
        table.cell(0, 1).text = "сумма"
        table.cell(1, 0).text = "первое"
        table.cell(1, 1).text = "100"
        table.cell(2, 0).text = "Итого"
        table.cell(2, 1).text = "250"

        # 5. шапка шаблона python-pptx: чужое имя, подпись генератора, дата 2013
        core = deck.core_properties
        core.comments = "generated using python-pptx"
        core.last_modified_by = "Steve Canny"

    deck.save(str(path))


def run(deck: Path) -> tuple[int, dict]:
    result = subprocess.run([sys.executable, str(SCRIPT), str(deck), "--json"],
                            capture_output=True, text=True, encoding="utf-8")
    return result.returncode, json.loads(result.stdout)


def main() -> int:
    work = Path(tempfile.mkdtemp(prefix="deck-gates-test-"))
    try:
        clean = work / "clean.pptx"
        blank_deck(clean, broken=False)
        code, clean_report = run(clean)
        assert code == 0, f"чистая колода не прошла: {clean_report['findings']}"
        assert not clean_report["findings"], \
            f"на чистой колоде выдуманы находки: {clean_report['findings']}"
        print("ok  1. чистая колода проходит, находок нет")

        broken = work / "broken.pptx"
        blank_deck(broken, broken=True)
        code, report = run(broken)
        kinds = {item["kind"] for item in report["findings"]}
        assert code == 1, "испорченная колода прошла как чистая"
        for kind in ("шрифт", "за краем", "заглушка", "числа", "метаданные"):
            assert kind in kinds, f"ворота не заметили «{kind}»; нашли только {kinds}"
        print(f"ok  2. испорченная колода не проходит: {sorted(kinds)}")

        numbers = next(item for item in report["findings"] if item["kind"] == "числа")
        assert "250" in numbers["text"] and "100" in numbers["text"], \
            f"в находке про числа нет самих чисел: {numbers['text']}"
        print("ok  3. арифметика названа числами: заявлено против суммы слагаемых")

        edge = next(item for item in report["findings"] if item["kind"] == "за краем")
        assert "слева" in edge["text"], f"не сказано, куда уехала фигура: {edge['text']}"
        print("ok  4. сказано, куда именно вышла фигура")

        tiny = next(item for item in report["findings"] if item["kind"] == "шрифт")
        assert "6" in tiny["text"], f"в находке про шрифт нет размера: {tiny['text']}"
        print("ok  5. назван размер шрифта")

        meta = [item["text"] for item in report["findings"] if item["kind"] == "метаданные"]
        assert len(meta) >= 3, f"метаданные-наследие названы не все: {meta}"
        joined = " | ".join(meta)
        for mark in ("Steve Canny", "generated using python-pptx", "2013"):
            assert mark in joined, f"в находках про метаданные нет «{mark}»: {joined}"
        assert all(item["slide"] == 0 for item in report["findings"]
                   if item["kind"] == "метаданные"), \
            "метаданные — свойство пакета, а не слайда: слайд должен быть 0"
        print("ok  6. метаданные-наследие названы: чужое имя, подпись генератора, дата 2013")

        core = clean_report["package"]
        assert core["author"] == "test-deck-gates", \
            f"в отчёт не попали свойства пакета: {core}"
        assert core["last_modified_by"] == "test-deck-gates", \
            f"в отчёте чужое имя последнего автора: {core}"
        print("ok  7. свойства пакета попадают в отчёт, а не только в находки")

        print("\nPASS — ворота проверены")
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
