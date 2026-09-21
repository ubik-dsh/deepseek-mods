#!/usr/bin/env python3
"""Draw the DSH plugins: what each one does, and the shape they all share.

    python draw-the-plugins.py [--out <path>]

A plugin is not a skill and does not belong in the skills repo, so this lives with the mods and its
output goes wherever it is told. Own file, own window - it is a fifth picture, not a fifth panel of an
existing one.
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

REPO = Path(r"C:\Users\admin\Documents\ds1\dsh-mods")
GREY = ("#F5F5F5", "#666666")
BLUE = ("#DAE8FC", "#6C8EBF")
GREEN = ("#D5E8D4", "#82B366")
PURPLE = ("#E1D5E7", "#9673A6")
ORANGE = ("#FFE6CC", "#D79B00")

# ── LOOK. Not taste - the answers to "it reads like a book description: boxes stacked tightly,
# no air". Every number is copied from draw-a-skill-flow.py, where the operator looked at the
# result and called it beautiful.
TITLE_H = 78        # the diagram's title box: bigger than everything, because it is the entrance
CARD_H = 106        # a plugin card: what it gives a person, how, its name with files, and the
                    # English description - four lines, so it is taller than a row of the flow
SHAPE_H = 66        # a card in the shared-shape column: a name and one line
GAP = 42            # air between boxes. Below 30 the frames read as one block
TITLE_GAP = 88      # air under the title - more than GAP, so the entrance reads as an entrance
BAND_H = 34         # the column header band: it names the column without being a card
PAD_L = 20          # padding inside a frame: 10 left the text touching the border
PAD_T = 10          # top padding: 0 pressed the first line against the frame
MARGIN_X, MARGIN_Y = 90, 60     # page margins: the diagram must not start at the sheet edge

SHAPE_W = 620       # the shared-shape column
CARD_W = 1180       # the plugin cards - wider, because a card carries three lines
CARD_X = MARGIN_X + SHAPE_W + GAP

# The vendor palette only, from jgraph/drawio-mcp/shared/style-reference.md.
BOX = "rounded=1;arcSize=10;whiteSpace=wrap;html=1;shadow=1;strokeWidth=1;"
TITLE = "rounded=1;arcSize=10;whiteSpace=wrap;html=1;shadow=1;strokeWidth=2;"
BAND = ("rounded=1;arcSize=10;whiteSpace=wrap;html=1;fillColor=#F5F5F5;strokeColor=#666666;"
        "align=left;verticalAlign=middle;spacingLeft=20;fontStyle=1;")

# Font ladder: four sizes and each means exactly one thing - the diagram title, a card's title,
# its explanation, and its name and file list. Not one size for everything.
F_TITLE, F_STEP, F_DETAIL, F_PATH, F_BAND = 18, 13, 11, 9, 12

# По-русски: что каждый плагин делает для человека. Английское описание остаётся мелким снизу.
WHAT = {
    "mod-manager": ("Показывает установленные моды и включает/выключает их",
                    "без перезапуска: панель в Настройках", PURPLE),
    "skill-manager": ("Показывает скиллы, которые видит харнесс, и ставит любой на паузу",
                      "пауза = переименование файла; удаления нет", PURPLE),
    "skill-scout": ("Доска поиска скиллов: что искать, поиск, суд, запись в каталог",
                    "с приговором, оценкой и ссылкой на источник", ORANGE),
    "system-prompt-mod": ("Кнопка в шапке чата: показать живой системный промпт и подменить его",
                          "применяется без перезапуска", GREEN),
    "locale-ru": ("Русский язык для веб-интерфейса DSH",
                  "регистрирует локаль и словари для всех пространств имён", BLUE),
}


def esc(text: str) -> str:
    return html.escape(str(text), quote=True)


def box(cells: list[str], cell_id: str, label: str, x: int, y: int, w: int, h: int,
        colours: tuple[str, str]) -> None:
    """One bordered cell with real padding. The HTML is escaped ONCE, here, on the way in."""
    cells.append(f'<mxCell id="{esc(cell_id)}" value="{esc(label)}" style="{BOX}'
                 f'fillColor={colours[0]};strokeColor={colours[1]};align=left;'
                 f'verticalAlign=middle;spacingLeft={PAD_L};spacingTop={PAD_T};'
                 f'spacingBottom={PAD_T};fontSize={F_STEP};" vertex="1" parent="1">'
                 f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry" /></mxCell>')


def band(cells: list[str], cell_id: str, label: str, x: int, y: int, w: int) -> None:
    """A column header band: it says what the column IS, without being a card."""
    cells.append(f'<mxCell id="{esc(cell_id)}" value="{esc(label)}" style="{BAND}'
                 f'fontSize={F_BAND};" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" '
                 f'width="{w}" height="{BAND_H}" as="geometry" /></mxCell>')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=r"C:\Users\admin\Documents\ds1\_graph\plugins.drawio")
    args = ap.parse_args()

    plugins = []
    for folder in sorted((REPO / "packages").iterdir()):
        package = folder / "package.json"
        if not package.exists():
            continue
        data = json.loads(package.read_text(encoding="utf-8"))
        lib = sorted(p.name for p in (folder / "lib").glob("*.js")) if (folder / "lib").exists() else []
        plugins.append((folder.name, data.get("description", ""), lib))

    cells: list[str] = []
    # The diagram's own title box: TITLE_H and strokeWidth 2, so it reads as the entrance and not
    # as one more card.
    cells.append(f'<mxCell id="h" value="{esc("ПЛАГИНЫ DSH")}" style="{TITLE}'
                 f'fillColor=#DAE8FC;strokeColor=#6C8EBF;fontSize={F_TITLE};fontStyle=1;'
                 f'align=center;verticalAlign=middle;" vertex="1" parent="1">'
                 f'<mxGeometry x="{MARGIN_X}" y="{MARGIN_Y}" width="{CARD_X + CARD_W - MARGIN_X}" '
                 f'height="{TITLE_H}" as="geometry" /></mxCell>')
    # A COLUMN HEADER BAND per column, so the reader is told what each column is instead of having
    # to work it out from the cards.
    band_y = MARGIN_Y + TITLE_H + TITLE_GAP
    band(cells, "band_shape", "ОБЩАЯ ФОРМА: у плагина ДВЕ СТОРОНЫ", MARGIN_X, band_y, SHAPE_W)
    band(cells, "band_cards", "ПЯТЬ ПЛАГИНОВ — что каждый делает для человека",
         CARD_X, band_y, CARD_W)

    # The shared shape: a name and one line each, the same GAP as everywhere else.
    y = band_y + BAND_H + GAP
    for i, (name, why, colours) in enumerate([
            ("lib/index.js", "серверная сторона: то, что живёт в процессе DSH", GREEN),
            ("lib/client.js", "клиентская сторона: кнопка, панель, то, что видно на странице", BLUE),
            ("package.json", "объявляет обе стороны — без него плагин не смонтируется", GREY)]):
        label = (f'<b>{name}</b><br>'
                 f'<font color="#444444" style="font-size:{F_DETAIL}px">{why}</font>')
        box(cells, f"f{i}", label, MARGIN_X, y, SHAPE_W, SHAPE_H, colours)
        y += SHAPE_H + GAP
    shape_bottom = y - GAP

    y = band_y + BAND_H + GAP
    for index, (name, english, lib) in enumerate(plugins):
        russian, why, colours = WHAT.get(name, (name, "", GREY))
        files = ", ".join(lib) if lib else "—"
        # Three sizes doing three jobs: what it gives a person (13), how (11), and its name with
        # its files plus the English description (9) - never one size for all of it.
        label = (f'<b>{russian}</b><br>'
                 f'<font color="#444444" style="font-size:{F_DETAIL}px">{why}</font><br>'
                 f'<font color="#999999" style="font-size:{F_PATH}px">{name} · {files}</font><br>'
                 f'<font color="#999999" style="font-size:{F_PATH}px">{english[:110]}</font>')
        box(cells, f"p{index}", label, CARD_X, y, CARD_W, CARD_H, colours)
        y += CARD_H + GAP
    cards_bottom = y - GAP

    # ЛЕГЕНДА ПАНЕЛЬЮ, А НЕ СПИСКОМ СТРОК: строки без рамки читаются как продолжение карточек и
    # глазом не отделяются от них. HTML собирается НАСТОЯЩИМИ <b> и <br> и экранируется РОВНО
    # ОДИН РАЗ, в legend_value - двойное экранирование рисует разметку текстом.
    legend_rows = [
        ("ЧТО ЭТО ЗА СХЕМА",
         ["Пять плагинов DSH: что каждый делает и какая форма у них общая.",
          "Это НЕ схема скиллов (family.drawio) и НЕ ворота регламента (gates.drawio)."]),
        ("КАК ЧИТАТЬ",
         ["Сверху — общая форма плагина: две стороны и манифест, который их объявляет.",
          "Ниже — каждый плагин: что он даёт человеку, как называется, из чего состоит."]),
        ("ЧТО У НИХ ОБЩЕГО",
         ["Все пять монтируются БЕЗ перезапуска и все показываются в Настройках.",
          "Три из них — панели одного вида: список, состояние и переключатель."]),
    ]
    parts: list[str] = []
    for heading, lines in legend_rows:
        parts.append(f'<b>{esc(heading)}</b>')
        parts.extend(esc(line) for line in lines)
        parts.append("&nbsp;")
    legend_html = "<br>".join(parts)
    legend_h = 34 + sum(len(lines) + 1 for _, lines in legend_rows) * 22 + 16
    legend_y = max(cards_bottom, shape_bottom) + GAP
    cells.append(f'<mxCell id="legend" value="{esc(legend_html)}" style="{BOX}'
                 f'fillColor=#FFFFFF;strokeColor=#B3B3B3;align=left;verticalAlign=top;'
                 f'spacingLeft={PAD_L};spacingTop={PAD_T};fontSize={F_DETAIL};" vertex="1" '
                 f'parent="1"><mxGeometry x="{MARGIN_X}" y="{legend_y}" '
                 f'width="{CARD_X + CARD_W - MARGIN_X}" height="{legend_h}" as="geometry" />'
                 f'</mxCell>')

    # The page is measured from the content, not fixed.
    page_w = CARD_X + CARD_W + MARGIN_X
    page_h = legend_y + legend_h + MARGIN_Y
    model = ('<mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" '
             'arrows="1" fold="1" page="1" pageScale="1" '
             f'pageWidth="{page_w}" pageHeight="{page_h}" math="0" '
             'shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" />' + "".join(cells)
             + '</root></mxGraphModel>')
    model = ('<mxfile host="dsh" agent="draw-the-plugins.py"><diagram id="plugins" name="Плагины">'
             + model + '</diagram></mxfile>')

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(model, encoding="utf-8")
    print(f"  плагинов {len(plugins)}: {', '.join(p[0] for p in plugins)}")
    print(f"  файл: {out}  ({len(model):,} байт)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
