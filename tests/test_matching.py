"""Tests for club deduplication, directory matching, and Census county lookup."""

from pathlib import Path

import pandas as pd

from usaf_stats.matching import (
    CensusCountyLookup,
    deduplicate_tracker_clubs,
    match_clubs_to_directory,
)

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_deduplicate_tracker_clubs_merges_duplicate_ids() -> None:
    rows = [
        {"rank": 100, "club_id": "100352440", "name": "Miami Fencing Academy", "abbreviation": "MFA", "competitive": 42, "non_competitive": 24, "total": 66},
        {"rank": 101, "club_id": "100352440", "name": "Mia Fencing Academy North", "abbreviation": "MFA", "competitive": 42, "non_competitive": 24, "total": 66},
        {"rank": 1, "club_id": "100063710", "name": "Alliance Fencing Academy", "abbreviation": "ALLIANCEFA", "competitive": 374, "non_competitive": 185, "total": 559},
    ]
    deduped, audit = deduplicate_tracker_clubs(rows)
    assert len(deduped) == 2
    assert len(audit) == 1
    assert audit[0]["club_id"] == "100352440"
    assert deduped[0]["club_id"] == "100063710"
    assert deduped[1]["duplicate_row_count"] == 2
    assert "Mia Fencing Academy North" in deduped[1]["alternate_names"]


def test_match_clubs_to_directory_tiers() -> None:
    tracker = [
        {"club_id": "100025090", "name": "Fencers Club Inc.", "abbreviation": "FENCERSCLUB", "competitive": 270, "non_competitive": 50, "total": 320, "alternate_names": ""},
        {"club_id": "100063710", "name": "Alliance Fencing Academy", "abbreviation": "ALLIANCEFA", "competitive": 374, "non_competitive": 185, "total": 559, "alternate_names": ""},
        {"club_id": "100999999", "name": "Mystery College Club", "abbreviation": "MCC", "competitive": 5, "non_competitive": 10, "total": 15, "alternate_names": ""},
    ]
    usfa = [
        {"id": 10, "name": "Fencers Club", "short_name": "FC"},
        {"id": 20, "name": "Alliance Fencing Academy", "short_name": "ALLIANCEFA"},
        {"id": 30, "name": "Brand New Club", "short_name": "BNC"},
    ]
    joined = match_clubs_to_directory(tracker, usfa)
    by_method = {r["match_method"]: r for r in joined}
    assert by_method["core_name"]["usfa"]["id"] == 10
    assert by_method["exact_name"]["usfa"]["id"] == 20
    assert by_method["unmatched"]["tracker"]["club_id"] == "100999999"
    assert by_method["directory_only"]["usfa"]["id"] == 30


def test_census_county_lookup_exact_and_fallback() -> None:
    df = pd.read_csv(REPO_ROOT / "data" / "reference" / "census_counties.csv", dtype={"county_fips": str, "cbsa_code": str})
    lookup = CensusCountyLookup(df)

    # Exact county match: Hartford County, CT
    h = lookup.lookup("CT", "Hartford County", 41.77, -72.70)
    assert h is not None
    assert h["cbsa_code"] == "25540"  # Hartford-West Hartford-East Hartford, CT

    # Fallback by lat/lng when county is blank: Houston, TX (Harris County -> 26420)
    hou = lookup.lookup("TX", None, 29.7604, -95.3698)
    assert hou is not None
    assert hou["cbsa_code"] == "26420"
