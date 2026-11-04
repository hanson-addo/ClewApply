"""Normalizes job postings so the same job from different sources gets the same dedup key
(#20). Exact matching only: near matches ("Software Engineer II" vs "Software Engineer")
stay separate jobs until fuzzy matching lands.
"""

import hashlib
import re
from dataclasses import dataclass

# Trailing legal suffixes dropped from company names ("Example Corp." -> "example").
_COMPANY_SUFFIXES = {
    "co",
    "company",
    "corp",
    "corporation",
    "inc",
    "incorporated",
    "limited",
    "llc",
    "llp",
    "lp",
    "ltd",
    "plc",
    "pc",
}

# Whole-word title abbreviations and their spelled-out form.
_TITLE_WORDS = {
    "admin": "administrator",
    "assoc": "associate",
    "asst": "assistant",
    "dev": "developer",
    "dir": "director",
    "eng": "engineer",
    "engr": "engineer",
    "jr": "junior",
    "mgr": "manager",
    "mgmt": "management",
    "ops": "operations",
    "sr": "senior",
    "sre": "site reliability engineer",
    "svp": "senior vice president",
    "swe": "software engineer",
    "vp": "vice president",
}

# Work-mode words some sources add to the title; the location carries them instead.
_TITLE_NOISE = {"remote", "hybrid", "onsite"}

_STATES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "district of columbia": "DC",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
    "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI",
    "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "puerto rico": "PR", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA",
    "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}  # fmt: skip
_STATE_CODES = set(_STATES.values())
_COUNTRY = {"us", "usa", "united states", "united states of america"}

_SPACES = re.compile(r"\s+")
_ZIP = re.compile(r"\s+\d{5}(-\d{4})?$")


def _words(text: str) -> list[str]:
    """Lowercase words with punctuation turned into spaces. Keeps + and # (C++, C#)."""
    cleaned = re.sub(r"[^\w+#]+", " ", text.lower().replace("&", " and "))
    return cleaned.split()


def normalize_company(name: str) -> str:
    words = _words(name)
    while len(words) > 1 and words[-1] in _COMPANY_SUFFIXES:
        words.pop()
    return " ".join(words)


def normalize_title(title: str) -> str:
    # "on-site" and "on site" become "onsite" before splitting.
    title = re.sub(r"\bon[\s-]site\b", "onsite", title, flags=re.IGNORECASE)
    words: list[str] = []
    for word in _words(title):
        if word in _TITLE_NOISE:
            continue
        words.extend(_TITLE_WORDS.get(word, word).split())
    return " ".join(words)


@dataclass(frozen=True)
class Location:
    city: str | None
    region: str | None
    remote_type: str | None  # "onsite", "hybrid", "remote", or None when unknown

    @property
    def key(self) -> str:
        """The location part of the dedup key. A fully remote job has no place."""
        if self.remote_type == "remote" and self.city is None:
            return "remote"
        return f"{(self.city or '').lower()}|{self.region or ''}"


def parse_location(text: str | None) -> Location:
    """Reads a US location as sources show it: "Austin, TX", "Austin, Texas (Hybrid)",
    "Remote - US", "Hybrid: New York, NY, United States". Unknown parts stay None."""
    if not text or not text.strip():
        return Location(None, None, None)
    lowered = text.lower()
    remote_type: str | None = None
    if "hybrid" in lowered:
        remote_type = "hybrid"
    elif "remote" in lowered or "anywhere" in lowered:
        remote_type = "remote"
    elif re.search(r"\bon[\s-]?site\b", lowered):
        remote_type = "onsite"

    stripped = re.sub(
        r"\b(remote|hybrid|on[\s-]?site|anywhere(\s+in)?(\s+the)?)\b", " ", text, flags=re.I
    )
    # Hyphens split only with spaces around them, so "Winston-Salem" stays one city.
    parts = [
        _SPACES.sub(" ", p).strip(" .-") for p in re.split(r"[,()/:;|]|\s[-\u2013]\s", stripped)
    ]
    parts = [_ZIP.sub("", p) for p in parts]
    parts = [p for p in parts if p and p.lower() not in _COUNTRY]

    city: str | None = None
    region: str | None = None
    for index, part in enumerate(parts):
        code = state_code(part)
        if code and index > 0:
            city, region = parts[index - 1].title(), code
            break
    else:
        if len(parts) == 1 and state_code(parts[0]):
            region = state_code(parts[0])
        elif parts:
            city = parts[0].title()

    if remote_type is None and city is not None:
        remote_type = "onsite"
    return Location(city, region, remote_type)


def state_code(part: str) -> str | None:
    """The two-letter code for a US state, DC or Puerto Rico, given its code or name."""
    if part.upper() in _STATE_CODES and len(part) == 2:
        return part.upper()
    return _STATES.get(part.lower())


def dedup_key(company: str, title: str, location: str | None, scope: str | None = None) -> str:
    """Equal keys mean the same job: normalized company + title + location, hashed. A
    `scope` keeps a set of jobs apart from every other (an unverified board's own jobs)."""
    parts: tuple[str, ...] = (
        normalize_company(company),
        normalize_title(title),
        parse_location(location).key,
    )
    if scope is not None:
        parts = (scope, *parts)
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()
