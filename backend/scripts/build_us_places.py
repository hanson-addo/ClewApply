"""Builds src/clew/catalog/data/us_places.csv, the table that puts jobs on the map (#119).

Run by hand when the source changes. The CSV is committed, so the app never fetches place
data at runtime (R19: workers only reach a fixed list of hosts).

    # From the US Census Gazetteer places file (public domain):
    python scripts/build_us_places.py --gazetteer 2024_Gaz_place_national.txt

    # Or from GeoNames' US cities of 15,000+ people (CC BY 4.0), via geonamescache:
    pip install geonamescache && python scripts/build_us_places.py

Each row is one US place: region (two-letter state), city, latitude, longitude, rounded to
3 decimals (about 100 m), which is plenty for a city pin.
"""

import argparse
import csv
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "src/clew/catalog/data/us_places.csv"

# Census place names end in their legal type ("Austin city", "Brandon CDP").
_PLACE_TYPE = re.compile(
    r"\s+(city|town|village|borough|CDP|municipality|city and borough|"
    r"consolidated government|metropolitan government|unified government|"
    r"urban county|comunidad|zona urbana)(\s*\(balance\))?$",
    re.IGNORECASE,
)


def from_gazetteer(path: Path) -> list[tuple[str, str, float, float]]:
    rows = []
    with path.open(encoding="utf-8") as handle:
        for raw in csv.DictReader(handle, delimiter="\t"):
            row = {key.strip(): value.strip() for key, value in raw.items()}
            name = _PLACE_TYPE.sub("", row["NAME"])
            rows.append((row["USPS"], name, float(row["INTPTLAT"]), float(row["INTPTLONG"])))
    return rows


def from_geonames() -> list[tuple[str, str, float, float]]:
    import geonamescache  # type: ignore[import-not-found]  # build-time only

    cities = geonamescache.GeonamesCache().get_cities().values()
    return [
        (c["admin1code"], c["name"], float(c["latitude"]), float(c["longitude"]))
        for c in cities
        if c["countrycode"] == "US" and len(c["admin1code"]) == 2
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gazetteer", type=Path, help="Census Gazetteer places file (.txt)")
    args = parser.parse_args()
    rows = from_gazetteer(args.gazetteer) if args.gazetteer else from_geonames()
    # One row per state and city name; the first in sorted order wins.
    seen: set[tuple[str, str]] = set()
    kept = []
    for region, city, lat, lng in sorted(rows):
        key = (region, city.lower())
        if key in seen:
            continue
        seen.add(key)
        kept.append((region, city, round(lat, 3), round(lng, 3)))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["region", "city", "lat", "lng"])
        writer.writerows(kept)
    print(f"Wrote {len(kept)} places to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
