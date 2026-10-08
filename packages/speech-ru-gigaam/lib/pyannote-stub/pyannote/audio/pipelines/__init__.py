"""Заглушка `pyannote.audio.pipelines`: см. `pyannote/__init__.py` рядом."""


def __getattr__(name: str):
    raise RuntimeError(
        f"pyannote.audio.pipelines.{name} вызван, а установлена заглушка: настоящий пакет не установлен."
    )
