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
    cells.append('<mxCell id="h" value="ПЛАГИНЫ DSH" style="rounded=0;whiteSpace=wrap;html=1;'
                 'fillColor=#DAE8FC;strokeColor=#6C8EBF;fontSize=16;fontStyle=1;" vertex="1" parent="1">'
                 '<mxGeometry x="70" y="30" width="480" height="48" as="geometry" /></mxCell>')

    # Общая форма: у каждого плагина две стороны.
    cells.append('<mxCell id="shape" value="ОБЩАЯ ФОРМА: у плагина ДВЕ СТОРОНЫ" style="text;html=1;'
                 'align=left;fontSize=13;fontStyle=1;strokeColor=none;fillColor=none;" vertex="1" '
                 'parent="1"><mxGeometry x="70" y="100" width="480" height="26" as="geometry" /></mxCell>')
    for i, (name, why, colours) in enumerate([
            ("lib/index.js", "серверная сторона: то, что живёт в процессе DSH", GREEN),
            ("lib/client.js", "клиентская сторона: кнопка, панель, то, что видно на странице", BLUE),
            ("package.json", "объявляет обе стороны — без него плагин не смонтируется", GREY)]):
        label = (f'<b>{name}</b><br><font color="#444444" style="font-size:11px">{why}</font>')
        cells.append(f'<mxCell id="f{i}" value="{esc(label)}" style="rounded=1;whiteSpace=wrap;html=1;'
                     f'fillColor={colours[0]};strokeColor={colours[1]};align=left;spacingLeft=10;'
                     f'fontSize=12;" vertex="1" parent="1"><mxGeometry x="70" y="{140 + i * 66}" '
                     f'width="480" height="56" as="geometry" /></mxCell>')

    y = 380
    for index, (name, english, lib) in enumerate(plugins):
        russian, why, colours = WHAT.get(name, (name, "", GREY))
        files = ", ".join(lib) if lib else "—"
        label = (f'<b>{russian}</b><br>'
                 f'<font color="#444444" style="font-size:11px">{why}</font><br>'
                 f'<font color="#999999" style="font-size:9px">{name} · {files}</font><br>'
                 f'<font color="#AAAAAA" style="font-size:8px">{english[:110]}</font>')
        cells.append(f'<mxCell id="p{index}" value="{esc(label)}" style="rounded=1;whiteSpace=wrap;'
                     f'html=1;fillColor={colours[0]};strokeColor={colours[1]};align=left;spacingLeft=10;'
                     f'fontSize=12;" vertex="1" parent="1"><mxGeometry x="70" y="{y}" width="900" '
                     f'height="86" as="geometry" /></mxCell>')
        y += 102

    legend = ["ЧТО ЭТО ЗА СХЕМА",
              "Пять плагинов DSH: что каждый делает и какая форма у них общая.",
              "Это НЕ схема скиллов (family.drawio) и НЕ ворота регламента (gates.drawio).",
              "",
              "КАК ЧИТАТЬ",
              "Сверху — общая форма плагина: две стороны и манифест, который их объявляет.",
              "Ниже — каждый плагин: что он даёт человеку, как называется, из чего состоит.",
              "",
              "ЧТО У НИХ ОБЩЕГО",
              "Все пять монтируются БЕЗ перезапуска и все показываются в Настройках.",
              "Три из них — панели одного вида: список, состояние и переключатель."]
    for row, text in enumerate(legend):
        bold = "1" if (text.isupper() or text.startswith("ЧТО") or text.startswith("КАК")) else "0"
        # row is in the Y COORDINATE - see draw-a-skill-flow.py, where leaving it out drew the whole
        # legend on one spot.
        cells.append(f'<mxCell id="l{row}" value="{esc(text)}" style="text;html=1;align=left;'
                     f'verticalAlign=middle;fontSize=12;fontStyle={bold};strokeColor=none;fillColor=none;"'
                     f' vertex="1" parent="1"><mxGeometry x="1010" y="{140 + row * 30}" width="660" '
                     f'height="26" as="geometry" /></mxCell>')

    model = ('<mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" '
             'arrows="1" fold="1" page="1" pageScale="1" pageWidth="1700" pageHeight="1000" math="0" '
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
