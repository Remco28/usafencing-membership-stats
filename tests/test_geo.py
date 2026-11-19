"""Tests for geographic distance and member-weighted centroid math."""

import pytest

from usaf_stats.geo import (
    haversine_miles,
    weighted_center_of_mass,
    weighted_mean_distance_miles,
)


def test_haversine_nyc_to_la() -> None:
    # NYC (40.7128, -74.0060) to LA (34.0522, -118.2437) is ~2,446 statute miles
    dist = haversine_miles(40.7128, -74.0060, 34.0522, -118.2437)
    assert dist == pytest.approx(2446.0, abs=15.0)
    assert haversine_miles(40.0, -75.0, 40.0, -75.0) == pytest.approx(0.0, abs=1e-9)


def test_weighted_center_and_distance() -> None:
    clubs = [
        (40.0, -75.0, 100.0),
        (40.0, -75.0, 0.0),
        (34.0, -118.0, 100.0),
    ]
    lat, lng = weighted_center_of_mass(clubs)
    assert 37.0 < lat < 41.0
    assert -100.0 < lng < -94.0

    # Equal weights at two points -> weighted mean distance to first point is half the separation
    d_between = haversine_miles(40.0, -75.0, 34.0, -118.0)
    d_mean = weighted_mean_distance_miles(clubs, 40.0, -75.0)
    assert d_mean == pytest.approx(d_between / 2.0, rel=1e-6)
    assert weighted_mean_distance_miles([], 40.0, -75.0) is None


def test_albers_usa_projection_and_topojson() -> None:
    from pathlib import Path
    from usaf_stats.geo import albers_usa_project, decode_topojson_object

    # CONUS, Alaska, Hawaii all project; overseas returns None
    ny = albers_usa_project(40.7128, -74.0060)
    la = albers_usa_project(34.0522, -118.2437)
    ak = albers_usa_project(61.2181, -149.9003)
    hi = albers_usa_project(21.3069, -157.8583)
    assert ny is not None and la is not None and ak is not None and hi is not None
    assert ny[0] > la[0]  # East coast right of West coast
    assert albers_usa_project(48.8566, 2.3522) is None  # Paris

    states_path = Path(__file__).resolve().parents[1] / "data" / "reference" / "geo" / "states-10m.json"
    feats = decode_topojson_object(states_path, "states")
    assert len(feats) >= 51
    names = {f["properties"]["name"] for f in feats}
    assert {"California", "New York", "Texas", "Alaska", "Hawaii"} <= names

