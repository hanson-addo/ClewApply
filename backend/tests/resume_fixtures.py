"""The made-up resumes in tests/fixtures/resumes. No real person's data."""

import json
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).parent / "fixtures" / "resumes"
NAMES = sorted(p.stem for p in FIXTURES.glob("*.txt"))


def resume_text(name: str) -> str:
    return (FIXTURES / f"{name}.txt").read_text(encoding="utf-8")


def expected_profile(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / f"{name}.expected.json").read_text("utf-8"))
    return data
