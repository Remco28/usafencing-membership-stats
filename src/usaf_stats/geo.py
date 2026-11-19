"""Geographic, projection, TopoJSON, and distance helpers."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Iterable

EARTH_RADIUS_MILES = 3958.7613


def haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in statute miles between two WGS84 points."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = (
        math.sin(dphi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    )
    return 2.0 * EARTH_RADIUS_MILES * math.asin(min(1.0, math.sqrt(a)))


def weighted_mean_distance_miles(
    club_points: Iterable[tuple[float, float, float]],
    target_lat: float,
    target_lng: float,
) -> float | None:
    """Member-weighted average great-circle distance (miles) from clubs to a target point.

    `club_points` yields `(lat, lng, weight)` tuples.
    """
    total_w = 0.0
    weighted_sum = 0.0
    for lat, lng, weight in club_points:
        if weight <= 0:
            continue
        dist = haversine_miles(lat, lng, target_lat, target_lng)
        weighted_sum += dist * weight
        total_w += weight
    if total_w <= 0:
        return None
    return weighted_sum / total_w


def weighted_center_of_mass(
    club_points: Iterable[tuple[float, float, float]],
) -> tuple[float, float] | None:
    """Spherical 3D member-weighted geographic centroid (lat, lng)."""
    sx = sy = sz = total_w = 0.0
    for lat, lng, weight in club_points:
        if weight <= 0:
            continue
        lat_r = math.radians(lat)
        lng_r = math.radians(lng)
        sx += weight * math.cos(lat_r) * math.cos(lng_r)
        sy += weight * math.cos(lat_r) * math.sin(lng_r)
        sz += weight * math.sin(lat_r)
        total_w += weight
    if total_w <= 0:
        return None
    hyp = math.hypot(sx, sy)
    return math.degrees(math.atan2(sz, hyp)), math.degrees(math.atan2(sy, sx))


def _albers_conic(
    lat_deg: float,
    lng_deg: float,
    lat1_deg: float,
    lat2_deg: float,
    lat0_deg: float,
    lng0_deg: float,
) -> tuple[float, float]:
    """Albers Equal-Area Conic projection (unit sphere)."""
    phi = math.radians(lat_deg)
    lam = math.radians(lng_deg)
    phi1 = math.radians(lat1_deg)
    phi2 = math.radians(lat2_deg)
    phi0 = math.radians(lat0_deg)
    lam0 = math.radians(lng0_deg)

    n = 0.5 * (math.sin(phi1) + math.sin(phi2))
    c = math.cos(phi1) ** 2 + 2.0 * n * math.sin(phi1)
    rho0 = math.sqrt(max(0.0, c - 2.0 * n * math.sin(phi0))) / n
    rho = math.sqrt(max(0.0, c - 2.0 * n * math.sin(phi))) / n
    theta = n * (lam - lam0)
    return rho * math.sin(theta), rho0 - rho * math.cos(theta)


def albers_usa_project(lat: float, lng: float) -> tuple[float, float] | None:
    """Project US (lat, lng) into a clean Albers USA composite canvas (CONUS + AK + HI).

    Returns `(x, y)` in standard cartesian coordinates (y upward) suited for Matplotlib/SVG,
    or `None` for points outside the 50 states + DC (e.g., territories/overseas).
    """
    # Contiguous US (plus DC)
    if 24.0 <= lat <= 50.0 and -125.5 <= lng <= -66.5:
        return _albers_conic(lat, lng, 29.5, 45.5, 37.5, -96.0)

    # Alaska inset (lower-left, scaled 0.35x)
    if 51.0 <= lat <= 72.0 and (-180.0 <= lng <= -129.0 or 170.0 <= lng <= 180.0):
        adj_lng = lng - 360.0 if lng > 0 else lng
        ax, ay = _albers_conic(lat, adj_lng, 55.0, 65.0, 60.0, -154.0)
        return ax * 0.35 - 0.31, ay * 0.35 - 0.24

    # Hawaii inset (lower-center-left)
    if 18.5 <= lat <= 23.0 and -161.0 <= lng <= -154.0:
        hx, hy = _albers_conic(lat, lng, 8.0, 18.0, 20.5, -157.0)
        return hx * 1.0 - 0.12, hy * 1.0 - 0.26

    return None


def decode_topojson_object(topo_path: Path, object_name: str = "states") -> list[dict[str, Any]]:
    """Decode a TopoJSON object into lightweight GeoJSON-like feature dicts."""
    topo = json.loads(topo_path.read_text(encoding="utf-8"))
    tf = topo.get("transform")
    scale = tf["scale"] if tf else [1.0, 1.0]
    translate = tf["translate"] if tf else [0.0, 0.0]

    decoded_arcs: list[list[tuple[float, float]]] = []
    for arc in topo["arcs"]:
        pts: list[tuple[float, float]] = []
        x = y = 0
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * scale[0] + translate[0], y * scale[1] + translate[1]))
        decoded_arcs.append(pts)

    def _ring(arc_indices: list[int]) -> list[tuple[float, float]]:
        ring: list[tuple[float, float]] = []
        for idx in arc_indices:
            pts = decoded_arcs[idx] if idx >= 0 else list(reversed(decoded_arcs[~idx]))
            if ring and pts and ring[-1] == pts[0]:
                ring.extend(pts[1:])
            else:
                ring.extend(pts)
        return ring

    features: list[dict[str, Any]] = []
    for geom in topo["objects"][object_name]["geometries"]:
        gtype = geom["type"]
        polys: list[list[list[tuple[float, float]]]] = []
        if gtype == "Polygon":
            polys = [[_ring(r) for r in geom["arcs"]]]
        elif gtype == "MultiPolygon":
            polys = [[_ring(r) for r in poly] for poly in geom["arcs"]]
        features.append(
            {
                "id": str(geom.get("id", "")),
                "properties": geom.get("properties", {}),
                "polygons": polys,
            }
        )
    return features
