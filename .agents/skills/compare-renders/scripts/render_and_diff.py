"""Сравнить две отрендеренные версии одного документа — постранично.

ЗАЧЕМ. Ворота считают числа (кегль, итоги, расхождения формы), глаза говорят «вроде
нормально». Ни то, ни другое не отвечает на вопрос «правка не сломала вид». Для этого
нужна прежняя версия: сравнить страницу с страницей и увидеть, где поехало.

Идея из плагина documents Кодекса-десктопа (scripts/render_and_diff.py, лицензия
Proprietary); скрипт свой, на pymupdf.

    python render_and_diff.py старое.pdf новое.pdf --out различия
    python render_and_diff.py папка-до папка-после --out различия
    python render_and_diff.py старое.pptx новое.pptx --out различия     # отрендерит сам

Выход: строка на страницу с процентом изменившихся пикселей и вердикт. Код возврата 1,
если хоть одна страница изменилась больше порога. Рядом — ДВА вида картинок на каждую
изменившуюся страницу:

    стр-002.png            overlay: ГДЕ изменилось (изменённое красным, остальное приглушено)
    стр-002-бок-о-бок.png  пара: «до» слева, «после» справа, изменение подсвечено на обеих

Overlay показывает где, но не куда: по одной картинке нельзя понять, блок уехал вниз или
вверх. Пара отвечает на это глазами, а строка «сдвиг изменившейся части» — числом:
направление и величина в pt, с уверенностью (насколько перенос объясняет разницу лучше,
чем «ничего не двигалось»).
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

if sys.stdout is not None:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

import pymupdf  # noqa: E402

IMAGES = {".png": None, ".jpg": None, ".jpeg": None}
DOCUMENTS = {".pptx", ".docx", ".xlsx", ".ppt", ".doc", ".xls", ".odt", ".odp", ".ods"}
# Ниже этого порога разница — шум рендерера, а не правка.
DEFAULT_THRESHOLD = 0.5
SOFFICE = shutil.which("soffice") or r"C:\Program Files\LibreOffice\program\soffice.exe"


def render_document(path: Path, workdir: Path) -> Path:
    """Отдать документ LibreOffice и получить PDF. Без него сравнение невозможно."""
    if Path(SOFFICE).exists() is False and shutil.which("soffice") is None:
        raise SystemExit("LibreOffice не найден — конвертировать документ нечем")
    workdir.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([SOFFICE, "--headless", "--convert-to", "pdf",
                             "--outdir", str(workdir), str(path)],
                            capture_output=True, text=True, timeout=600)
    pdf = workdir / (path.stem + ".pdf")
    if not pdf.exists():
        raise SystemExit(f"LibreOffice не сделал PDF из {path.name}: {result.stderr.strip()[:200]}")
    return pdf


def pages_of(path: Path, workdir: Path, scale: float) -> list:
    """Страницы как картинки в оттенках серого: цвет мешает видеть сдвиг, а не помогает."""
    if path.suffix.lower() in IMAGES:
        image = pymupdf.open(path) if path.suffix.lower() != ".png" else None
        if image is None:
            page = pymupdf.open()
            rect = pymupdf.Rect(0, 0, 1, 1)
            page.new_page(width=rect.width, height=rect.height)
            page[0].insert_image(rect, filename=str(path))
            return [page[0].get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY)]
        return []
    if path.suffix.lower() in DOCUMENTS:
        path = render_document(path, workdir / (path.stem + "-render"))
    document = pymupdf.open(path)
    shots = []
    for page in document:
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY)
        shots.append(pixmap)
    return shots


def image_pages(folder: Path, scale: float) -> list:
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGES)
    shots = []
    for file in files:
        document = pymupdf.open()
        rect = pymupdf.Rect(0, 0, *pymupdf.Pixmap(str(file)).irect[2:])
        page = document.new_page(width=rect.width, height=rect.height)
        page.insert_image(rect, filename=str(file))
        shots.append(page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY))
    return shots


def compare(before, after, out_dir: Path, page_number: int, scale: float,
            threshold: int = 12) -> dict:
    """Доля изменившихся пикселей, картинка различий, пара «до/после» и оценка сдвига.

    Пиксель считается изменившимся, если он отличается больше чем на `threshold`
    градаций серого: иначе сглаживание шрифта даёт «изменения» на пустом месте.
    """
    import numpy as np

    a = np.frombuffer(before.samples, dtype=np.uint8).reshape(before.height, before.width)
    b = np.frombuffer(after.samples, dtype=np.uint8).reshape(after.height, after.width)
    height = min(a.shape[0], b.shape[0])
    width = min(a.shape[1], b.shape[1])
    a = a[:height, :width].astype(int)
    b = b[:height, :width].astype(int)

    changed = np.abs(a - b) > threshold
    share = float(changed.mean())

    mask = np.stack([np.where(changed, 255, a // 3)] * 3, axis=-1).astype("uint8")
    mask[changed] = (220, 40, 40)
    target = out_dir / f"стр-{page_number:03d}.png"
    _save_rgb(mask, target)

    side = side_by_side(a, b, changed, out_dir, page_number)
    dx, dy, confidence = estimate_shift(a, b, changed)
    return {
        "share": share,
        "overlay": target,
        "side": side,
        "shift": shift_words(dx, dy, scale, confidence),
    }


def _shrink(array, factor: int, how: str = "min"):
    """Уменьшить картинку в `factor` раз. `min` — самый тёмный пиксель блока.

    Не среднее: тонкая линия рамки при усреднении в восемь раз бледнеет до еле
    заметной полосы, и грубый поиск сдвига уходит на ложный минимум (проверено:
    рамка 2 pt давала оценку 101 pt вместо 50). Минимум линию сохраняет.
    """
    import numpy as np

    height, width = array.shape
    height -= height % factor
    width -= width % factor
    if height < factor or width < factor:
        return array
    blocks = array[:height, :width].reshape(height // factor, factor,
                                            width // factor, factor)
    reducer = blocks.max if how == "max" else blocks.min
    return reducer(axis=(1, 3))


def _shift_error(a, b, pixels, dy: int, dx: int):
    """Насколько хуже совпадение, если содержимое `b` уехало из `a` на (dx, dy).

    Положительный `dy` значит: то, что лежало в `a` выше, стоит в `b` ниже, —
    то есть содержимое уехало ВНИЗ. Считается только там, где было изменение,
    и только по «чернилам»: белое на белом совпадает при любом сдвиге, и без
    этого ограничения оценка уезжает на ложный минимум по пустому месту.
    """
    import numpy as np

    ys, xs = pixels
    ty, tx = ys + dy, xs + dx
    inside = (ty >= 0) & (ty < a.shape[0]) & (tx >= 0) & (tx < a.shape[1])
    # Сдвиг, выкинувший половину точек за край, сравнивать нечестно: у него меньше
    # слагаемых и средняя выходит меньше просто от этого.
    if inside.sum() < 0.5 * len(ys):
        return None
    source = a[ty[inside], tx[inside]]
    target = b[ys[inside], xs[inside]]
    ink = (source < 250) | (target < 250)
    if ink.sum() < 20:
        return None
    return float(np.abs(source[ink] - target[ink]).mean())


def estimate_shift(a, b, changed) -> tuple[int, int, float]:
    """Куда уехала изменившаяся часть: (dx, dy) в пикселях и уверенность 0..1.

    Положительный `dy` — содержимое уехало ВНИЗ по странице. Поиск ищет обратное:
    смещение, с которым `b` совпадает с `a`, поэтому в конце знак переворачивается.
    Это ровно та ошибка, ради которой всё и делалось: перепутанный знак говорит
    «вверх» там, где блок уехал вниз, и читается как факт.

    Оценка, а не измерение по объектам: ищется один общий перенос для всех
    изменившихся пикселей. Ищется грубо-точно (в 8, 4, 2 и 1 раз меньше), потому
    что полный перебор по всему разрешению — это сотни тысяч сравнений.

    Возвращает (0, 0, 0), если изменившихся пикселей нет.
    """
    import numpy as np

    height, width = a.shape
    radius = int(max(24, 0.35 * min(height, width)))
    guess_x = guess_y = 0
    best = (0, 0)
    first = True

    for factor in (8, 4, 2, 1):
        if min(height, width) // factor < 16:
            continue
        a_small = _shrink(a.astype("float32"), factor, "min")
        b_small = _shrink(b.astype("float32"), factor, "min")
        changed_small = _shrink(changed.astype("float32"), factor, "max") > 0.5
        pixels = np.nonzero(changed_small)
        if len(pixels[0]) < 20:
            continue
        span = max(1, radius // factor) if first else 3
        centre_y, centre_x = guess_y // factor, guess_x // factor
        best_error = None
        for dy_small in range(centre_y - span, centre_y + span + 1):
            for dx_small in range(centre_x - span, centre_x + span + 1):
                error = _shift_error(a_small, b_small, pixels, dy_small, dx_small)
                if error is None:
                    continue
                if best_error is None or error < best_error:
                    best_error = error
                    best = (dx_small * factor, dy_small * factor)
        guess_x, guess_y = best
        first = False

    pixels = np.nonzero(changed)
    if len(pixels[0]) == 0:
        return 0, 0, 0.0
    a_float, b_float = a.astype("float32"), b.astype("float32")
    at_zero = _shift_error(a_float, b_float, pixels, 0, 0)
    at_best = _shift_error(a_float, b_float, pixels, best[1], best[0])
    confidence = 0.0
    if at_zero and at_best is not None:
        confidence = max(0.0, (at_zero - at_best) / at_zero)
    # `best` — на сколько строк и столбцов назад смотреть в `a`; куда уехало
    # содержимое, это то же число с обратным знаком.
    return -best[0], -best[1], confidence


def shift_words(dx: int, dy: int, scale: float, confidence: float) -> str:
    """Словами то, что показала оценка сдвига. Молчит, когда сдвига не видно."""
    if confidence < 0.15 or (abs(dx) < 2 and abs(dy) < 2):
        return ("сдвиг изменившейся части: цельного переноса не видно — изменение "
                f"на месте, а не уехало (уверенность {confidence:.2f})")
    parts = []
    if abs(dy) >= 2:
        parts.append(f"{'вниз' if dy > 0 else 'вверх'} на {abs(dy) / scale:.0f} pt ({abs(dy)} px)")
    if abs(dx) >= 2:
        parts.append(f"{'вправо' if dx > 0 else 'влево'} на {abs(dx) / scale:.0f} pt ({abs(dx)} px)")
    return (f"сдвиг изменившейся части: {', '.join(parts)}; "
            f"уверенность {confidence:.2f}")


def _label_font(size: int):
    """Шрифт для подписей на картинке. Кириллица есть не в каждом — тогда латиница."""
    from PIL import ImageFont

    for name in ("segoeui.ttf", "arial.ttf", "calibri.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size), ("до", "после")
        except OSError:
            continue
    return ImageFont.load_default(), ("before", "after")


def side_by_side(a, b, changed, out_dir: Path, page_number: int) -> Path:
    """Парная картинка: слева «до», справа «после», изменение подсвечено на обеих.

    ЗАЧЕМ ВТОРОЙ ВИД. Overlay отвечает на вопрос «где», но по нему не видно, куда
    уехал блок: красное пятно на одном и том же месте выглядит одинаково и при
    сдвиге вниз, и при сдвиге вверх. Пара показывает одно и то же место на обеих
    версиях рядом — и направление читается глазами, без догадок.
    """
    import numpy as np
    from PIL import Image, ImageDraw

    height, width = a.shape
    gap, strip = 16, 30
    left = np.stack([a] * 3, axis=-1).astype("float32")
    right = np.stack([b] * 3, axis=-1).astype("float32")
    # Красным помечается только то, что на САМОЙ картинке нарисовано: иначе на
    # обеих половинах появляется бледный призрак чужого положения, и глаз читает
    # его как ещё один блок. Так на левой половине красный стоит там, где блок был,
    # на правой — где он стал, и направление видно без призраков.
    for panel, gray in ((left, a), (right, b)):
        tint = changed & (gray < 250)
        panel[tint] = panel[tint] * 0.35 + np.array([220, 40, 40]) * 0.65

    canvas = Image.new("RGB", (width * 2 + gap, height + strip), "white")
    canvas.paste(Image.fromarray(left.astype("uint8")), (0, strip))
    canvas.paste(Image.fromarray(right.astype("uint8")), (width + gap, strip))
    draw = ImageDraw.Draw(canvas)
    font, (before_word, after_word) = _label_font(18)
    draw.text((6, 6), before_word, fill=(30, 30, 30), font=font)
    draw.text((width + gap + 6, 6), after_word, fill=(30, 30, 30), font=font)
    target = out_dir / f"стр-{page_number:03d}-бок-о-бок.png"
    canvas.save(target)
    return target


def _save_rgb(array, target: Path) -> None:
    from PIL import Image

    Image.fromarray(array).save(target)


def main() -> int:
    parser = argparse.ArgumentParser(description="Постраничное сравнение двух версий")
    parser.add_argument("before")
    parser.add_argument("after")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                        help="порог в процентах, выше которого страница считается изменённой")
    parser.add_argument("--scale", type=float, default=1.5)
    args = parser.parse_args()

    before_path, after_path = Path(args.before), Path(args.after)
    for path in (before_path, after_path):
        if not path.exists():
            print(f"нет пути: {path}")
            return 1
    args.out.mkdir(parents=True, exist_ok=True)

    work = args.out / "рендер"
    if before_path.is_dir():
        first = image_pages(before_path, args.scale)
    else:
        first = pages_of(before_path, work, args.scale)
    if after_path.is_dir():
        second = image_pages(after_path, args.scale)
    else:
        second = pages_of(after_path, work, args.scale)

    if len(first) != len(second):
        print(f"страниц разное число: было {len(first)}, стало {len(second)} — "
              f"это уже изменение, сравнивать нечего")

    total = max(len(first), len(second))
    worst = 0.0
    over = 0
    print(f"страниц: {total}, порог {args.threshold:g}%")
    for index in range(total):
        if index >= len(first) or index >= len(second):
            print(f"  стр. {index + 1:<3} ЕСТЬ ТОЛЬКО В ОДНОЙ ВЕРСИИ")
            over += 1
            worst = 100.0
            continue
        page = compare(first[index], second[index], args.out, index + 1, args.scale)
        percent = page["share"] * 100
        worst = max(worst, percent)
        verdict = "изменилась" if percent > args.threshold else "та же"
        if percent > args.threshold:
            over += 1
            print(f"  стр. {index + 1:<3} {percent:6.3f}%  {verdict:<12} {page['overlay'].name}"
                  f"  пара: {page['side'].name}")
            print(f"        {page['shift']}")
        else:
            print(f"  стр. {index + 1:<3} {percent:6.3f}%  {verdict:<12} {page['overlay'].name}")
    if len(first) != len(second):
        print("\nразное число страниц — состав документа изменился")

    print(f"\nбольше порога: {over} страниц(ы), худшая {worst:.3f}%")
    print("изменение — не порча: инструмент показывает ГДЕ и КУДА, а решает человек")
    return 1 if over else 0


if __name__ == "__main__":
    raise SystemExit(main())
