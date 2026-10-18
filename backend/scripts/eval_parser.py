"""Checks the real LLM parser against the made-up fixture resumes. Not run in CI: it needs
CLEW_ANTHROPIC_API_KEY and spends a little API credit.

    cd backend && uv run python scripts/eval_parser.py

For each resume it prints the fields that differ from `<name>.expected.json` and the fields
flagged "check this". Only made-up resumes are ever sent.
"""

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from clew.resumes.files import PDF
from clew.resumes.parser import filled_paths, get_resume_parser
from clew.resumes.text import extract_text

FIXTURES = Path(__file__).parents[1] / "tests" / "fixtures" / "resumes"
sys.path.insert(0, str(Path(__file__).parents[1]))
from tests.file_helpers import text_pdf  # noqa: E402


def leaves(value: Any, prefix: str = "") -> dict[str, Any]:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            out |= leaves(item, f"{prefix}.{key}" if prefix else key)
        return out
    if isinstance(value, list) and value and all(isinstance(i, dict) for i in value):
        out = {}
        for index, item in enumerate(value):
            out |= leaves(item, f"{prefix}[{index}]")
        return out
    return {prefix: value} if value not in (None, "", []) else {}


async def main() -> int:
    parser = get_resume_parser()
    if parser is None:
        print("Set CLEW_ANTHROPIC_API_KEY first.")
        return 2
    total = wrong = 0
    for source in sorted(FIXTURES.glob("*.txt")):
        expected = json.loads(source.with_suffix(".expected.json").read_text("utf-8"))
        text = extract_text(text_pdf(source.read_text("utf-8")), PDF)
        parsed = await parser.parse(text)
        got = leaves(parsed.profile.model_dump(mode="json", exclude_none=True))
        want = leaves(expected)
        diffs = sorted(p for p in set(got) | set(want) if got.get(p) != want.get(p))
        total += len(want)
        wrong += len(diffs)
        print(f"\n{source.stem}: {len(diffs)} of {len(filled_paths(expected))} fields differ")
        for path in diffs:
            print(f"  {path}: expected {want.get(path)!r}, got {got.get(path)!r}")
        print(f"  check this: {', '.join(parsed.check) or 'none'}")
    print(f"\n{total - wrong} of {total} expected fields matched exactly")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
