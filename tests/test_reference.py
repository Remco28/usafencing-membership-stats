"""Tests validating the non-fencing reference datasets (national events + US Census)."""

from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
REF_DIR = REPO_ROOT / "data" / "reference"


def test_national_events_matches_44_major_stops_in_21_cities() -> None:
    df = pd.read_csv(REF_DIR / "national_events.csv")
    assert len(df) >= 44
    assert df["lat"].between(24.0, 50.0).all()
    assert df["lng"].between(-125.0, -66.0).all()

    major = df[df["is_major_stop"] == True]  # noqa: E712
    assert len(major) == 44
    assert major["city"].nunique() == 21

    # Spot-check key host counts matching 2021-22 through 2026-27 seasons
    counts = major["city"].value_counts().to_dict()
    assert counts["Salt Lake City"] == 5
    assert counts["Richmond"] == 4
    assert counts["Charlotte"] == 3
    assert counts["Fort Worth"] == 3
    assert counts["Columbus"] == 3


def test_census_reference_integrity() -> None:
    counties = pd.read_csv(REF_DIR / "census_counties.csv", dtype={"county_fips": str, "cbsa_code": str})
    cbsa = pd.read_csv(REF_DIR / "census_cbsa.csv", dtype={"cbsa_code": str})

    assert len(counties) >= 3140
    assert counties["county_fips"].is_unique
    assert counties["pop_2025"].sum() > 330_000_000

    metros = cbsa[cbsa["cbsa_type"] == "Metropolitan Statistical Area"]
    assert len(metros) >= 380
    assert cbsa["cbsa_code"].is_unique
    # Top metro is NYC > 19M
    assert cbsa.iloc[0]["cbsa_code"] == "35620"
    assert cbsa.iloc[0]["pop_2025"] > 19_000_000
    assert (REF_DIR / "geo" / "states-10m.json").exists()
