#!/usr/bin/env python3
"""Rebuild $DSH_HOME/skill-registry.json — the human summaries that had gone empty.

The registry holds, per skill, two different descriptions: the MODEL-FACING one, which lives in the
SKILL.md frontmatter and is what the harness matches on, and a HUMAN SUMMARY, one line, which stays in
the registry and is never shown to a model. The file had been reduced to `{"version":1,"skills":{}}`, so
every Russian line was gone while every skill still worked - nothing breaks when a human summary
disappears, which is exactly why it went unnoticed.

    python build-skill-registry.py [--dry-run]

Writes the same shape the skill-manager plugin writes, so the panel reads it without a restart.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

SKILLS = Path(r"C:\Users\admin\Documents\ds1\deepseek-harness-skills\skills")
REGISTRY = Path(r"C:\Users\admin\.dsh\skill-registry.json")

# Одна строка по-русски на скилл: для чего он. Это то, что видит человек в панели.
SUMMARY = {
    "check-hardware": "Прочитать, что железо о себе сообщает, и отличить больную деталь от нечитаемой",
    "create-a-skill": "Написать скилл для агента: ворота, проверка, испытание; скилл — программа для модели",
    "design-a-reward": "Устроить награду для обучения: что мерить, как оценивать, почему кривая не растёт",
    "draw-a-diagram": "Нарисовать схему файлом: draw.io — это XML, редактор не автоматизируют",
    "find-a-skill": "Найти готовый скилл, прежде чем писать свой, и испытать его на своём случае",
    "judge-a-skill": "Суд над скиллом: обвинение, защита, приговор из закрытого списка",
    "learn-an-interface": "Дойти до интерфейса без хардкода координат: API, файл, дерево, и лишь потом пиксели",
    "manage-vk": "Работа с ВК: прочитать сообщество прежде чем писать, и отличить отказ от пустого ответа",
    "manage-windows": "Скриптовать Windows так, чтобы ничего не отказывало молча",
    "route-a-task": "Регламент: какой скилл обязателен, а какой по желанию; восемь ворот",
}


def frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if not text.startswith("---"):
        return {}
    block = text.split("---", 2)[1]
    out: dict[str, str] = {}
    for line in block.splitlines():
        if ":" in line and not line.startswith((" ", "\t")):
            key, _, value = line.partition(":")
            out[key.strip()] = value.strip()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    old = json.loads(REGISTRY.read_text(encoding="utf-8")) if REGISTRY.exists() else {"skills": {}}
    skills: dict[str, dict] = {}

    for folder in sorted(p for p in SKILLS.iterdir() if (p / "SKILL.md").exists()):
        front = frontmatter(folder / "SKILL.md")
        name = front.get("name", folder.name)
        previous = old.get("skills", {}).get(name, {})
        skills[name] = {
            "id": name,
            "file": str(folder / "SKILL.md"),
            "workspace": previous.get("workspace"),
            "modelDescription": front.get("description", ""),
            "humanSummary": SUMMARY.get(name, previous.get("humanSummary", "")),
            "enabled": True,
            "registeredAt": previous.get("registeredAt", now),
            "updatedAt": now,
        }

    missing = [n for n, v in skills.items() if not v["humanSummary"]]
    payload = {"version": 1, "skills": skills}
    if args.dry_run:
        print(f"  было записей: {len(old.get('skills', {}))}   стало: {len(skills)}")
        for name, entry in skills.items():
            print(f"    {name:20} {entry['humanSummary'][:70]}")
        return 0

    REGISTRY.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  реестр перезаписан: {len(skills)} скиллов  ({REGISTRY})")
    for name, entry in skills.items():
        print(f"    {name:20} {entry['humanSummary'][:66] or 'НЕТ ОПИСАНИЯ'}")
    if missing:
        print(f"  БЕЗ РУССКОГО ОПИСАНИЯ: {missing}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
