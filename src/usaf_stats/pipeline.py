"""Snapshot ingestion, club/directory/Census enrichment, spatial analytics, and web bundle builder."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from usaf_stats.api_client import FencingApiClient
from usaf_stats.geo import (
    haversine_miles,
    weighted_center_of_mass,
    weighted_mean_distance_miles,
)
from usaf_stats.matching import (
    CensusCountyLookup,
    deduplicate_tracker_clubs,
    match_clubs_to_directory,
    normalize_core_name,
    normalize_name,
)


def _float_or_none(v: Any) -> float | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    if not s or s.lower() == "nan":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _str_or_none(v: Any) -> str | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    return s if s and s.lower() != "nan" else None


def pull_snapshot(
    repo_root: Path,
    snapshot_date: str | None = None,
    live: bool = False,
    base_url: str | None = None,
) -> Path:
    """Fetch current club snapshots from `fencing-api` and persist to `data/snapshots/YYYY-MM-DD/`."""
    with FencingApiClient(base_url=base_url, repo_root=repo_root) as client:
        ft = client.get_tracker_clubs(live=live)
        usfa = client.get_usfa_clubs(live=live)
        snaps = client.get_tracker_snapshots()

    date_str = snapshot_date
    if not date_str:
        fetched = ft.get("fetched_at") or datetime.now(timezone.utc).isoformat()
        date_str = str(fetched)[:10]

    snap_dir = repo_root / "data" / "snapshots" / date_str
    snap_dir.mkdir(parents=True, exist_ok=True)
    (snap_dir / "tracker_clubs.json").write_text(json.dumps(ft, indent=2), encoding="utf-8")
    (snap_dir / "usfa_clubs.json").write_text(json.dumps(usfa, indent=2), encoding="utf-8")
    (snap_dir / "tracker_snapshots.json").write_text(json.dumps(snaps, indent=2), encoding="utf-8")
    return snap_dir


def latest_snapshot_dir(repo_root: Path) -> Path:
    snaps_root = repo_root / "data" / "snapshots"
    dirs = sorted(p for p in snaps_root.iterdir() if p.is_dir() and (p / "tracker_clubs.json").exists())
    if not dirs:
        raise FileNotFoundError(f"No snapshots found under {snaps_root}. Run `usaf-stats pull-snapshot` first.")
    return dirs[-1]


def _load_overrides(ref_dir: Path) -> dict[str, int]:
    path = ref_dir / "club_overrides.csv"
    if not path.exists():
        return {}
    df = pd.read_csv(path, dtype=str)
    out: dict[str, int] = {}
    for row in df.to_dict("records"):
        cid = _str_or_none(row.get("tracker_club_id"))
        uid = _str_or_none(row.get("usfa_directory_id"))
        if cid and uid:
            out[cid] = int(uid)
    return out


def _load_supplement(ref_dir: Path) -> dict[str, dict[str, Any]]:
    path = ref_dir / "club_locations_supplement.csv"
    if not path.exists():
        return {}
    df = pd.read_csv(path, dtype=str)
    out: dict[str, dict[str, Any]] = {}
    for row in df.to_dict("records"):
        cid = _str_or_none(row.get("club_id"))
        if cid:
            out[cid] = row
    return out


def _load_dataverse_index(ref_dir: Path) -> tuple[dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]:
    path = ref_dir / "dataverse_usfa_clubs_cc0.csv"
    if not path.exists():
        return {}, {}
    df = pd.read_csv(path, dtype=str)
    by_exact: dict[str, list[dict[str, Any]]] = {}
    by_core: dict[str, list[dict[str, Any]]] = {}
    for row in df.to_dict("records"):
        if _float_or_none(row.get("lat")) is None or _float_or_none(row.get("lng")) is None:
            continue
        nm = _str_or_none(row.get("name")) or ""
        n1 = normalize_name(nm)
        n2 = normalize_core_name(nm)
        if n1:
            by_exact.setdefault(n1, []).append(row)
        if n2:
            by_core.setdefault(n2, []).append(row)
    return by_exact, by_core


def build_derived(repo_root: Path, snapshot_dir: Path | None = None) -> dict[str, Any]:
    """Run full deterministic enrichment & spatial analysis, writing `data/derived/` and `web/public/data/`."""
    snap_dir = snapshot_dir or latest_snapshot_dir(repo_root)
    ref_dir = repo_root / "data" / "reference"
    derived_dir = repo_root / "data" / "derived"
    derived_dir.mkdir(parents=True, exist_ok=True)

    ft_raw = json.loads((snap_dir / "tracker_clubs.json").read_text(encoding="utf-8"))
    usfa_raw = json.loads((snap_dir / "usfa_clubs.json").read_text(encoding="utf-8"))
    snaps_raw = (
        json.loads((snap_dir / "tracker_snapshots.json").read_text(encoding="utf-8"))
        if (snap_dir / "tracker_snapshots.json").exists()
        else {"items": []}
    )

    counties_df = pd.read_csv(
        ref_dir / "census_counties.csv",
        dtype={"county_fips": str, "state_fips": str, "cbsa_code": str, "csa_code": str},
    )
    cbsa_df = pd.read_csv(
        ref_dir / "census_cbsa.csv",
        dtype={"cbsa_code": str, "csa_code": str},
    )
    events_df = pd.read_csv(ref_dir / "national_events.csv")

    county_lookup = CensusCountyLookup(counties_df)
    cbsa_by_code = {str(r["cbsa_code"]): r for r in cbsa_df.to_dict("records")}
    overrides = _load_overrides(ref_dir)
    supplement = _load_supplement(ref_dir)
    dv_exact, dv_core = _load_dataverse_index(ref_dir)

    deduped, dup_audit = deduplicate_tracker_clubs(ft_raw["items"])
    joined = match_clubs_to_directory(deduped, usfa_raw["items"], overrides=overrides)

    # Major host cities (2021-22 through 2026-27)
    major_events = events_df[events_df["is_major_stop"] == True].copy()  # noqa: E712
    host_cities_agg = (
        major_events.groupby(["city", "state", "lat", "lng"], as_index=False)
        .agg(
            major_stops=("event_name", "count"),
            seasons=("season", lambda s: ", ".join(dict.fromkeys(s))),
            events=("event_name", lambda s: " | ".join(s)),
            sn_count=("event_type", lambda s: int((s == "SN").sum())),
            jo_count=("event_type", lambda s: int((s == "JO").sum())),
            nac_count=("event_type", lambda s: int((s == "NAC").sum())),
        )
        .sort_values(["major_stops", "city"], ascending=[False, True])
    )
    host_city_records = host_cities_agg.to_dict("records")

    club_rows: list[dict[str, Any]] = []
    for item in joined:
        tc = item["tracker"]
        u = item["usfa"]
        match_method = item["match_method"]

        cid = str(tc["club_id"]).strip() if tc else None
        sup = supplement.get(cid) if cid else None

        is_geographic = True
        if sup and str(sup.get("is_geographic", "true")).lower() == "false":
            is_geographic = False

        # Resolve coordinates & metadata in strict provenance order
        lat = lng = None
        city = state = county = zip_code = division = region = website = None
        specialties: list[str] = []
        nonprofit = leased_daily = inactive = None
        directory_id = None
        location_source = "unlocated"

        if u is not None:
            directory_id = u.get("directory_id")
            division = _str_or_none(u.get("division"))
            region = _str_or_none(u.get("region"))
            website = _str_or_none(u.get("website"))
            city = _str_or_none(u.get("city"))
            state = _str_or_none(u.get("state"))
            county = _str_or_none(u.get("county"))
            zip_code = _str_or_none(u.get("zip"))
            specialties = [str(s) for s in (u.get("specialties") or [])]
            nonprofit = bool(u.get("nonprofit")) if u.get("nonprofit") is not None else None
            leased_daily = bool(u.get("leased_daily")) if u.get("leased_daily") is not None else None
            inactive = bool(u.get("inactive")) if u.get("inactive") is not None else None

            if _float_or_none(u.get("lat")) is not None and _float_or_none(u.get("lng")) is not None:
                lat, lng = _float_or_none(u.get("lat")), _float_or_none(u.get("lng"))
                location_source = "usfa_directory_exact"
            elif _float_or_none(u.get("zip_lat")) is not None and _float_or_none(u.get("zip_lng")) is not None:
                lat, lng = _float_or_none(u.get("zip_lat")), _float_or_none(u.get("zip_lng"))
                location_source = "usfa_directory_zip"

        if not is_geographic:
            lat = lng = None
            location_source = "non_geographic"
        elif lat is None and sup is not None:
            lat = _float_or_none(sup.get("lat"))
            lng = _float_or_none(sup.get("lng"))
            city = city or _str_or_none(sup.get("city"))
            state = state or _str_or_none(sup.get("state"))
            county = county or _str_or_none(sup.get("county"))
            if lat is not None and lng is not None:
                location_source = "supplement_verified"
        elif lat is None and tc is not None:
            # Check Harvard Dataverse CC0 archive by exact or core name
            dv_hits = dv_exact.get(normalize_name(tc["name"])) or dv_core.get(normalize_core_name(tc["name"]))
            if dv_hits and len(dv_hits) == 1:
                dv = dv_hits[0]
                lat = _float_or_none(dv.get("lat"))
                lng = _float_or_none(dv.get("lng"))
                city = city or _str_or_none(dv.get("city"))
                state = state or _str_or_none(dv.get("state"))
                zip_code = zip_code or _str_or_none(dv.get("zip"))
                division = division or _str_or_none(dv.get("division"))
                region = region or _str_or_none(dv.get("region"))
                website = website or _str_or_none(dv.get("website"))
                if not specialties and _str_or_none(dv.get("specialties")):
                    specialties = [s.strip() for s in str(dv["specialties"]).split(",") if s.strip()]
                if lat is not None and lng is not None:
                    location_source = "dataverse_cc0_archive"

        # Sanity bounds check: reject broken (0, 0) coordinates
        if lat is not None and lng is not None and abs(lat) < 1.0 and abs(lng) < 1.0:
            lat = lng = None
            location_source = "unlocated"

        # County & CBSA enrichment
        c_hit = county_lookup.lookup(state, county, lat, lng) if is_geographic else None
        county_fips = _str_or_none(c_hit.get("county_fips")) if c_hit else None
        county_name = _str_or_none(c_hit.get("county_name")) if c_hit else county
        cbsa_code = _str_or_none(c_hit.get("cbsa_code")) if c_hit else None
        cbsa_title = _str_or_none(c_hit.get("cbsa_title")) if c_hit else None
        cbsa_type = _str_or_none(c_hit.get("cbsa_type")) if c_hit else None
        if c_hit and _str_or_none(c_hit.get("state_abbr")):
            state = _str_or_none(c_hit.get("state_abbr"))

        # Nearest major NAC/JO/SN host city
        nearest_host_city = None
        nearest_host_miles = None
        if lat is not None and lng is not None:
            best_d = 1e9
            best_h = None
            for h in host_city_records:
                d = haversine_miles(lat, lng, float(h["lat"]), float(h["lng"]))
                if d < best_d:
                    best_d = d
                    best_h = f"{h['city']}, {h['state']}"
            nearest_host_city = best_h
            nearest_host_miles = round(best_d, 1)

        comp = int(tc["competitive"]) if tc else 0
        non_comp = int(tc["non_competitive"]) if tc else 0
        tot = int(tc["total"]) if tc else 0
        comp_share = round(comp / tot, 4) if tot > 0 else None

        club_rows.append(
            {
                "club_id": cid,
                "directory_id": directory_id,
                "name": tc["name"] if tc else u["name"],
                "abbreviation": (tc["abbreviation"] if tc else u.get("short_name")) or "",
                "competitive": comp,
                "non_competitive": non_comp,
                "total": tot,
                "comp_share": comp_share,
                "is_geographic": is_geographic,
                "match_method": match_method,
                "location_source": location_source,
                "city": city,
                "state": state,
                "zip": zip_code,
                "county": county_name,
                "county_fips": county_fips,
                "cbsa_code": cbsa_code,
                "cbsa_title": cbsa_title,
                "cbsa_type": cbsa_type,
                "division": division,
                "region": region,
                "lat": round(lat, 5) if lat is not None else None,
                "lng": round(lng, 5) if lng is not None else None,
                "specialties": "|".join(specialties),
                "has_epee": "Epee" in specialties,
                "has_foil": "Foil" in specialties,
                "has_saber": "Saber" in specialties,
                "has_para": "Para" in specialties,
                "nonprofit": nonprofit,
                "leased_daily": leased_daily,
                "inactive": inactive,
                "website": website,
                "nearest_host_city": nearest_host_city,
                "nearest_host_miles": nearest_host_miles,
                "duplicate_row_count": int(tc.get("duplicate_row_count", 1)) if tc else 0,
            }
        )

    clubs_df = pd.DataFrame(club_rows)
    clubs_df = clubs_df.sort_values(["competitive", "total", "name"], ascending=[False, False, True]).reset_index(drop=True)
    clubs_df.to_csv(derived_dir / "clubs.csv", index=False)

    # Filter to FencingTracker-counted clubs for membership rollups (avoid double counting directory_only zeros)
    ft_clubs_df = clubs_df[clubs_df["club_id"].notna()].copy()
    geo_ft_df = ft_clubs_df[ft_clubs_df["lat"].notna() & ft_clubs_df["lng"].notna()].copy()

    # Map major host cities onto their CBSA code so each metro knows how many major stops it hosted
    host_stops_by_cbsa: dict[str, int] = {}
    for h in host_city_records:
        ch = county_lookup.lookup(str(h["state"]), None, float(h["lat"]), float(h["lng"]))
        if ch and _str_or_none(ch.get("cbsa_code")):
            code = str(ch["cbsa_code"])
            host_stops_by_cbsa[code] = host_stops_by_cbsa.get(code, 0) + int(h["major_stops"])
            h["cbsa_code"] = code
        else:
            h["cbsa_code"] = None

    # Compute fencer-weighted travel burden for every major host city
    comp_pts = [
        (float(r["lat"]), float(r["lng"]), float(r["competitive"]))
        for r in geo_ft_df.to_dict("records")
        if r["competitive"] > 0
    ]
    tot_pts = [
        (float(r["lat"]), float(r["lng"]), float(r["total"]))
        for r in geo_ft_df.to_dict("records")
        if r["total"] > 0
    ]
    total_geo_comp = sum(w for _, _, w in comp_pts)

    for h in host_city_records:
        hlat, hlng = float(h["lat"]), float(h["lng"])
        h["weighted_mean_comp_miles"] = round(weighted_mean_distance_miles(comp_pts, hlat, hlng) or 0.0, 1)
        h["weighted_mean_total_miles"] = round(weighted_mean_distance_miles(tot_pts, hlat, hlng) or 0.0, 1)
        w150 = sum(w for lat, lng, w in comp_pts if haversine_miles(lat, lng, hlat, hlng) <= 150.0)
        w500 = sum(w for lat, lng, w in comp_pts if haversine_miles(lat, lng, hlat, hlng) <= 500.0)
        h["comp_within_150mi"] = int(round(w150))
        h["comp_within_150mi_pct"] = round(w150 / total_geo_comp * 100.0, 1) if total_geo_comp else 0.0
        h["comp_within_500mi"] = int(round(w500))
        h["comp_within_500mi_pct"] = round(w500 / total_geo_comp * 100.0, 1) if total_geo_comp else 0.0

    hosts_df = pd.DataFrame(host_city_records)
    hosts_df.to_csv(derived_dir / "host_cities.csv", index=False)

    # Metro (CBSA) rollup — include ALL CBSAs with clubs PLUS top 75 US metros even if 0 clubs (for club-opening lens!)
    club_cbsa_agg = (
        geo_ft_df[geo_ft_df["cbsa_code"].notna()]
        .groupby("cbsa_code", as_index=False)
        .agg(
            club_count=("club_id", "count"),
            competitive=("competitive", "sum"),
            non_competitive=("non_competitive", "sum"),
            total=("total", "sum"),
            top_club=("name", "first"),
            top_club_comp=("competitive", "first"),
            epee_clubs=("has_epee", "sum"),
            foil_clubs=("has_foil", "sum"),
            saber_clubs=("has_saber", "sum"),
            para_clubs=("has_para", "sum"),
        )
    )
    agg_by_code = {str(r["cbsa_code"]): r for r in club_cbsa_agg.to_dict("records")}

    top_metro_codes = set(
        cbsa_df[cbsa_df["cbsa_type"] == "Metropolitan Statistical Area"].head(100)["cbsa_code"].astype(str)
    )
    target_codes = set(agg_by_code.keys()) | top_metro_codes

    metro_rows: list[dict[str, Any]] = []
    for code in sorted(target_codes):
        meta = cbsa_by_code.get(code)
        if not meta:
            continue
        agg = agg_by_code.get(code)
        comp = int(agg["competitive"]) if agg else 0
        non_comp = int(agg["non_competitive"]) if agg else 0
        tot = int(agg["total"]) if agg else 0
        club_count = int(agg["club_count"]) if agg else 0
        pop = _float_or_none(meta.get("pop_2025")) or 0.0
        inc = _float_or_none(meta.get("median_household_income_est_2024"))
        growth = _float_or_none(meta.get("pop_growth_2020_2025_pct"))
        mlat = _float_or_none(meta.get("lat"))
        mlng = _float_or_none(meta.get("lng"))

        comp_per_100k = round(comp / pop * 100_000.0, 2) if pop > 0 else 0.0
        total_per_100k = round(tot / pop * 100_000.0, 2) if pop > 0 else 0.0
        comp_share = round(comp / tot, 4) if tot > 0 else None

        # Nearest host city
        nearest_host_city = None
        nearest_host_miles = None
        if mlat is not None and mlng is not None:
            best_d = 1e9
            best_h = None
            for h in host_city_records:
                d = haversine_miles(mlat, mlng, float(h["lat"]), float(h["lng"]))
                if d < best_d:
                    best_d = d
                    best_h = f"{h['city']}, {h['state']}"
            nearest_host_city = best_h
            nearest_host_miles = round(best_d, 1)

        # Clean short display name (first city + primary state)
        raw_name = str(meta["cbsa_name"])
        short_name = raw_name.split(",")[0].split("-")[0].strip()
        states_part = raw_name.split(",")[1].strip() if "," in raw_name else ""
        primary_state = states_part.split("-")[0].strip() if states_part else ""
        display_name = f"{short_name}, {primary_state}" if primary_state else short_name

        metro_rows.append(
            {
                "cbsa_code": code,
                "cbsa_name": raw_name,
                "display_name": display_name,
                "cbsa_type": meta["cbsa_type"],
                "lat": round(mlat, 5) if mlat is not None else None,
                "lng": round(mlng, 5) if mlng is not None else None,
                "pop_2025": int(pop) if pop else None,
                "pop_growth_2020_2025_pct": growth,
                "median_household_income_2024": int(inc) if inc else None,
                "club_count": club_count,
                "competitive": comp,
                "non_competitive": non_comp,
                "total": tot,
                "comp_share": comp_share,
                "comp_per_100k": comp_per_100k,
                "total_per_100k": total_per_100k,
                "major_stops_hosted": host_stops_by_cbsa.get(code, 0),
                "nearest_host_city": nearest_host_city,
                "nearest_host_miles": nearest_host_miles,
                "top_club": agg["top_club"] if agg else None,
                "top_club_comp": int(agg["top_club_comp"]) if agg else 0,
                "epee_clubs": int(agg["epee_clubs"]) if agg else 0,
                "foil_clubs": int(agg["foil_clubs"]) if agg else 0,
                "saber_clubs": int(agg["saber_clubs"]) if agg else 0,
                "para_clubs": int(agg["para_clubs"]) if agg else 0,
            }
        )

    metros_df = pd.DataFrame(metro_rows).sort_values(["competitive", "total", "pop_2025"], ascending=[False, False, False]).reset_index(drop=True)
    metros_df.to_csv(derived_dir / "metros.csv", index=False)

    # Division rollup (for clubs with a known USA Fencing division)
    div_df = (
        ft_clubs_df[ft_clubs_df["division"].notna()]
        .groupby(["division", "region"], as_index=False, dropna=False)
        .agg(
            club_count=("club_id", "count"),
            competitive=("competitive", "sum"),
            non_competitive=("non_competitive", "sum"),
            total=("total", "sum"),
        )
        .sort_values("competitive", ascending=False)
        .reset_index(drop=True)
    )
    div_df.to_csv(derived_dir / "divisions.csv", index=False)

    # National centers of mass
    comp_com = weighted_center_of_mass(comp_pts)
    tot_com = weighted_center_of_mass(tot_pts)
    host_pts = [(float(h["lat"]), float(h["lng"]), float(h["major_stops"])) for h in host_city_records]
    host_com = weighted_center_of_mass(host_pts)

    # Coverage & provenance audit
    tot_comp_all = int(ft_clubs_df["competitive"].sum())
    tot_non_comp_all = int(ft_clubs_df["non_competitive"].sum())
    tot_all = int(ft_clubs_df["total"].sum())
    geo_comp_all = int(geo_ft_df["competitive"].sum())
    geo_tot_all = int(geo_ft_df["total"].sum())
    non_geo_comp = int(ft_clubs_df[~ft_clubs_df["is_geographic"]]["competitive"].sum())

    # Effective geographic denominator excludes non-geographic entities (e.g. National Sports Medicine Team)
    elig_comp = tot_comp_all - non_geo_comp
    elig_tot = tot_all - int(ft_clubs_df[~ft_clubs_df["is_geographic"]]["total"].sum())

    loc_breakdown = (
        ft_clubs_df.groupby("location_source", as_index=False)
        .agg(clubs=("club_id", "count"), competitive=("competitive", "sum"), total=("total", "sum"))
        .to_dict("records")
    )

    summary = {
        "snapshot_date": snap_dir.name,
        "tracker_fetched_at": ft_raw.get("fetched_at"),
        "usfa_fetched_at": usfa_raw.get("fetched_at"),
        "tracker_raw_rows": int(ft_raw.get("row_count", len(ft_raw["items"]))),
        "tracker_distinct_clubs": int(len(ft_clubs_df)),
        "duplicate_club_ids_merged": dup_audit,
        "usfa_directory_clubs": int(len(usfa_raw["items"])),
        "totals": {
            "competitive": tot_comp_all,
            "non_competitive": tot_non_comp_all,
            "total": tot_all,
            "comp_share_pct": round(tot_comp_all / tot_all * 100.0, 1) if tot_all else 0.0,
        },
        "coverage": {
            "geocoded_clubs": int(len(geo_ft_df)),
            "geocoded_competitive": geo_comp_all,
            "geocoded_competitive_pct": round(geo_comp_all / elig_comp * 100.0, 2) if elig_comp else 0.0,
            "geocoded_total": geo_tot_all,
            "geocoded_total_pct": round(geo_tot_all / elig_tot * 100.0, 2) if elig_tot else 0.0,
            "non_geographic_clubs": int((~ft_clubs_df["is_geographic"]).sum()),
            "non_geographic_competitive": non_geo_comp,
            "unlocated_clubs": int((ft_clubs_df["location_source"] == "unlocated").sum()),
            "unlocated_competitive": int(ft_clubs_df[ft_clubs_df["location_source"] == "unlocated"]["competitive"].sum()),
            "by_location_source": loc_breakdown,
        },
        "centers_of_mass": {
            "competitive_fencers": {"lat": round(comp_com[0], 4), "lng": round(comp_com[1], 4)} if comp_com else None,
            "total_fencers": {"lat": round(tot_com[0], 4), "lng": round(tot_com[1], 4)} if tot_com else None,
            "major_event_stops": {"lat": round(host_com[0], 4), "lng": round(host_com[1], 4)} if host_com else None,
            "fencer_to_events_gap_miles": (
                round(haversine_miles(comp_com[0], comp_com[1], host_com[0], host_com[1]), 1)
                if comp_com and host_com
                else None
            ),
        },
        "national_events": {
            "seasons": "2021-22 through 2026-27",
            "major_stops": int(len(major_events)),
            "host_cities": int(len(host_city_records)),
            "all_calendar_stops": int(len(events_df)),
        },
        "snapshots_history": snaps_raw.get("items", []),
    }

    (derived_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    # Clean JSON bundle for the GitHub Pages interactive web app
    def _clean_records(df: pd.DataFrame) -> list[dict[str, Any]]:
        return json.loads(df.to_json(orient="records"))

    web_bundle = {
        "schema_version": "1.0",
        "summary": summary,
        "metros": _clean_records(metros_df),
        "clubs": _clean_records(
            geo_ft_df[
                [
                    "club_id", "name", "abbreviation", "competitive", "non_competitive", "total",
                    "comp_share", "city", "state", "county", "cbsa_code", "cbsa_title",
                    "division", "region", "lat", "lng", "specialties", "has_epee", "has_foil",
                    "has_saber", "has_para", "location_source", "nearest_host_city", "nearest_host_miles",
                ]
            ]
        ),
        "host_cities": _clean_records(hosts_df),
        "events": _clean_records(events_df),
        "divisions": _clean_records(div_df),
    }

    (derived_dir / "dataset.json").write_text(json.dumps(web_bundle, separators=(",", ":")), encoding="utf-8")

    # Sync directly into web/public/data/ if web directory exists (or create it)
    web_data_dir = repo_root / "web" / "public" / "data"
    web_data_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(derived_dir / "dataset.json", web_data_dir / "dataset.json")
    states_src = ref_dir / "geo" / "states-10m.json"
    if states_src.exists():
        shutil.copy2(states_src, web_data_dir / "states-10m.json")

    return summary
