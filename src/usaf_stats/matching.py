"""Transparent, auditable 1:1 matching between FencingTracker clubs, USA Fencing directory clubs,
archived CC0 directory records, verified manual location supplements, and US Census counties/CBSAs.

Design rule: never guess silently. Every match records `match_method` and `location_source`,
and enforces strict 1:1 directory matching so no two clubs silently collide on a shared abbreviation.
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

from usaf_stats.geo import haversine_miles

_CORP_SUFFIX_RE = re.compile(
    r"\b(inc|incorporated|llc|llp|ltd|corp|corporation|co|org|nfp|pllc|pc)\b\.?",
    re.IGNORECASE,
)
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
_COUNTY_SUFFIX_RE = re.compile(
    r"\b(county|parish|borough|census area|municipality|city and borough)\b",
    re.IGNORECASE,
)


def normalize_name(name: str | None) -> str:
    """Lowercase alphanumeric normalization preserving meaningful words."""
    if not name:
        return ""
    s = name.lower().replace("&", " and ").replace("'", "").replace("’", "")
    s = _NON_ALNUM_RE.sub(" ", s).strip()
    return s


def normalize_core_name(name: str | None) -> str:
    """Normalized name with common legal entity suffixes stripped."""
    if not name:
        return ""
    s = _CORP_SUFFIX_RE.sub(" ", name)
    return normalize_name(s)


def normalize_abbr(abbr: str | None) -> str:
    """Compact alphanumeric club abbreviation key."""
    if not abbr:
        return ""
    return re.sub(r"[^a-z0-9]", "", abbr.lower())


def normalize_county(county: str | None) -> str:
    """Normalize county/parish name for Census lookup."""
    if not county:
        return ""
    s = _COUNTY_SUFFIX_RE.sub(" ", county)
    s = s.lower().replace("saint ", "st ").replace("st. ", "st ")
    return _NON_ALNUM_RE.sub(" ", s).strip()


def deduplicate_tracker_clubs(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Deduplicate FencingTracker club rows by `club_id` (9-digit USFA club ID).

    Returns `(deduped_clubs, duplicate_audit_log)`.
    When multiple rows share a `club_id`, keeps the row with the highest `total` (tie-break:
    lowest `rank`, then longest name) and records all alternate names in `alternate_names`.
    """
    by_id: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        cid = str(row["club_id"]).strip()
        by_id.setdefault(cid, []).append(row)

    deduped: list[dict[str, Any]] = []
    audit: list[dict[str, Any]] = []

    for cid, group in by_id.items():
        group_sorted = sorted(
            group,
            key=lambda r: (
                -int(r.get("total") or 0),
                int(r.get("rank") or 999999),
                -len(str(r.get("name") or "")),
            ),
        )
        primary = dict(group_sorted[0])
        alts = [str(r.get("name") or "") for r in group_sorted[1:] if r.get("name") != primary.get("name")]
        primary["duplicate_row_count"] = len(group_sorted)
        primary["alternate_names"] = " | ".join(alts)
        deduped.append(primary)
        if len(group_sorted) > 1:
            audit.append(
                {
                    "club_id": cid,
                    "kept_name": primary.get("name"),
                    "dropped_names": alts,
                    "row_count": len(group_sorted),
                    "total": primary.get("total"),
                }
            )

    deduped.sort(key=lambda r: (-int(r.get("competitive") or 0), -int(r.get("total") or 0), str(r.get("name") or "")))
    return deduped, audit


def _usfa_id(club: dict[str, Any]) -> int | None:
    val = club.get("directory_id")
    if val is None:
        val = club.get("id")
    return int(val) if val is not None and str(val).strip() != "" else None


def match_clubs_to_directory(
    tracker_clubs: list[dict[str, Any]],
    usfa_clubs: list[dict[str, Any]],
    overrides: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    """Strict 1:1 join of deduplicated FencingTracker clubs to USA Fencing directory clubs.

    Matching tiers (strict 1:1 — a directory club can match at most one FencingTracker club,
    and abbreviation-only matching is intentionally omitted to prevent false collisions like
    UMFC Michigan vs. UMFC Minnesota):
    1. `override` — explicit `tracker club_id -> usfa directory_id` mapping
    2. `exact_name` — exact normalized full name (unique in directory)
    3. `core_name` — normalized name without legal suffixes (`LLC`, `Inc.`, etc.)
    4. `unmatched` — no directory match found (kept in output with null directory fields)
    """
    overrides = overrides or {}
    by_usfa_id: dict[int, dict[str, Any]] = {}
    by_exact_name: dict[str, list[dict[str, Any]]] = {}
    by_core_name: dict[str, list[dict[str, Any]]] = {}

    for c in usfa_clubs:
        uid = _usfa_id(c)
        if uid is not None:
            by_usfa_id[uid] = c
        n1 = normalize_name(c.get("name"))
        if n1:
            by_exact_name.setdefault(n1, []).append(c)
        n2 = normalize_core_name(c.get("name"))
        if n2:
            by_core_name.setdefault(n2, []).append(c)

    # Pass 1..3 in priority order so exact matches claim their directory club before core matches
    assigned: dict[str, tuple[dict[str, Any], str]] = {}
    claimed_usfa_ids: set[int] = set()

    def _cand_names(tc: dict[str, Any]) -> list[str]:
        out = [str(tc.get("name") or "")]
        for alt in str(tc.get("alternate_names") or "").split("|"):
            if alt.strip():
                out.append(alt.strip())
        return out

    # Tier 1: overrides
    for tc in tracker_clubs:
        cid = str(tc["club_id"]).strip()
        if cid in overrides and overrides[cid] in by_usfa_id:
            u = by_usfa_id[overrides[cid]]
            uid = _usfa_id(u)
            if uid is not None and uid not in claimed_usfa_ids:
                assigned[cid] = (u, "override")
                claimed_usfa_ids.add(uid)

    # Tier 2: exact normalized name
    for tc in tracker_clubs:
        cid = str(tc["club_id"]).strip()
        if cid in assigned:
            continue
        for nm in _cand_names(tc):
            hits = [u for u in by_exact_name.get(normalize_name(nm), []) if _usfa_id(u) not in claimed_usfa_ids]
            if len(hits) == 1:
                uid = _usfa_id(hits[0])
                assigned[cid] = (hits[0], "exact_name")
                if uid is not None:
                    claimed_usfa_ids.add(uid)
                break

    # Tier 3: core normalized name (without legal suffixes)
    for tc in tracker_clubs:
        cid = str(tc["club_id"]).strip()
        if cid in assigned:
            continue
        for nm in _cand_names(tc):
            hits = [u for u in by_core_name.get(normalize_core_name(nm), []) if _usfa_id(u) not in claimed_usfa_ids]
            if len(hits) == 1:
                uid = _usfa_id(hits[0])
                assigned[cid] = (hits[0], "core_name")
                if uid is not None:
                    claimed_usfa_ids.add(uid)
                break

    results: list[dict[str, Any]] = []
    for tc in tracker_clubs:
        cid = str(tc["club_id"]).strip()
        if cid in assigned:
            u, method = assigned[cid]
            results.append({"tracker": tc, "usfa": u, "match_method": method})
        else:
            results.append({"tracker": tc, "usfa": None, "match_method": "unmatched"})

    for c in usfa_clubs:
        uid = _usfa_id(c)
        if uid is not None and uid not in claimed_usfa_ids:
            results.append({"tracker": None, "usfa": c, "match_method": "directory_only"})

    return results


class CensusCountyLookup:
    """Maps a club's `(state_abbr, county_name, lat, lng)` to a US Census county & CBSA."""

    def __init__(self, counties_df: pd.DataFrame) -> None:
        self._by_state_county: dict[tuple[str, str], dict[str, Any]] = {}
        self._by_state_rows: dict[str, list[dict[str, Any]]] = {}
        self._all_rows: list[dict[str, Any]] = []

        for row in counties_df.to_dict("records"):
            st = str(row.get("state_abbr") or "").upper().strip()
            if not st:
                continue
            key = (st, normalize_county(str(row.get("county_name") or "")))
            self._by_state_county.setdefault(key, row)
            self._by_state_rows.setdefault(st, []).append(row)
            if not pd.isna(row.get("lat")) and not pd.isna(row.get("lng")):
                self._all_rows.append(row)

    def lookup(
        self,
        state_abbr: str | None,
        county_name: str | None,
        lat: float | None,
        lng: float | None,
    ) -> dict[str, Any] | None:
        st = (state_abbr or "").upper().strip()

        # 1. Exact state + normalized county name (verify coordinate isn't wildly in another state)
        if st and county_name:
            hit = self._by_state_county.get((st, normalize_county(county_name)))
            if hit is not None:
                if lat is None or lng is None or pd.isna(hit.get("lat")) or pd.isna(hit.get("lng")):
                    return hit
                if haversine_miles(lat, lng, float(hit["lat"]), float(hit["lng"])) <= 150.0:
                    return hit

        # 2. Nearest county centroid within the stated state (within 75 miles)
        if st and lat is not None and lng is not None and st in self._by_state_rows:
            best_row = None
            best_dist = 75.0
            for row in self._by_state_rows[st]:
                rlat = row.get("lat")
                rlng = row.get("lng")
                if pd.isna(rlat) or pd.isna(rlng):
                    continue
                d = haversine_miles(lat, lng, float(rlat), float(rlng))
                if d < best_dist:
                    best_dist = d
                    best_row = row
            if best_row is not None:
                return best_row

        # 3. Global nearest US county centroid within 50 miles (handles blank or typo state codes)
        if lat is not None and lng is not None:
            best_row = None
            best_dist = 50.0
            for row in self._all_rows:
                d = haversine_miles(lat, lng, float(row["lat"]), float(row["lng"]))
                if d < best_dist:
                    best_dist = d
                    best_row = row
            return best_row

        return None
