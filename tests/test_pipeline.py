"""Integration and data-integrity tests for derived club/metro/host datasets."""

import json
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
DERIVED = REPO_ROOT / "data" / "derived"


def test_derived_dataset_coverage_and_sanity() -> None:
    summary = json.loads((DERIVED / "summary.json").read_text(encoding="utf-8"))
    clubs = pd.read_csv(DERIVED / "clubs.csv")
    metros = pd.read_csv(DERIVED / "metros.csv")
    hosts = pd.read_csv(DERIVED / "host_cities.csv")

    # Coverage bar: >= 98% of geographically eligible competitive fencers mapped
    assert summary["coverage"]["geocoded_competitive_pct"] >= 98.0
    assert summary["totals"]["competitive"] > 25_000
    assert summary["totals"]["total"] > 45_000

    # Zero duplicate FencingTracker club_ids
    ft_clubs = clubs[clubs["club_id"].notna()]
    assert ft_clubs["club_id"].is_unique

    # Zero bogus (0,0) or US-centroid-in-Colorado anomalies
    geo = ft_clubs[ft_clubs["lat"].notna() & ft_clubs["lng"].notna()]
    assert not ((geo["lat"].abs() < 1.0) & (geo["lng"].abs() < 1.0)).any()
    assert not (geo["name"].str.contains("Nam Hyun Hee", na=False)).any()
    assert not (geo["name"].str.contains("Sports Medicine Team", na=False)).any()

    # Key previously-missing anchor clubs are properly resolved into their metros
    for expected_club, expected_state in [
        ("Rochester Fencing Club", "NY"),
        ("Kansas City Fencing Center", "KS"),
        ("PISTE Fencing Academy", "NY"),
        ("Birmingham Fencing Club", "AL"),
        ("Connecticut Fencers Club", "CT"),
    ]:
        row = geo[geo["name"] == expected_club]
        assert len(row) == 1, f"Missing or duplicate {expected_club}"
        assert row.iloc[0]["state"] == expected_state
        assert pd.notna(row.iloc[0]["cbsa_code"])

    # National event hosts integrity
    assert len(hosts) == 21
    assert int(hosts["major_stops"].sum()) == 44
    assert (hosts["weighted_mean_comp_miles"] > 700).all()
    assert (hosts["weighted_mean_comp_miles"] < 2000).all()

    # Top metro sanity: NYC > LA > Boston
    assert metros.iloc[0]["display_name"] == "New York, NY"
    assert metros.iloc[1]["display_name"] == "Los Angeles, CA"
    assert metros.iloc[2]["display_name"] == "Boston, MA"

    # Web data bundle exists and parses cleanly
    web_json = REPO_ROOT / "web" / "public" / "data" / "dataset.json"
    assert web_json.exists()
    bundle = json.loads(web_json.read_text(encoding="utf-8"))
    assert len(bundle["clubs"]) == len(geo)
    assert len(bundle["host_cities"]) == 21
