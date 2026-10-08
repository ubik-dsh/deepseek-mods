"""Заглушка `pyannote.audio`: см. `pyannote/__init__.py` рядом."""


def __getattr__(name: str):
    raise RuntimeError(
        f"pyannote.audio.{name} вызван, а установлена заглушка: настоящий пакет не установлен."
    )
