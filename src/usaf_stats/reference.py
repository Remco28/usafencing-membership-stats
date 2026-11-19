"""Build clean, reproducible US Census and map reference datasets.

Downloads official public Census Bureau datasets (zero API key required):
- 2025 CBSA (Metro/Micro) population estimates (`cbsa-est2025-alldata.csv`)
- 2025 County population estimates (`co-est2025-alldata.csv`)
- 2024 SAIPE county median household income (`est24all.xls`)
- 2024 Gazetteer CBSA & County centroids (`2024_Gaz_cbsa_national.zip`, `2024_Gaz_counties_national.zip`)
- 2023 OMB County-to-CBSA delineation (`list1_2023.xlsx`)
- us-atlas@3 10m US states TopoJSON (`states-10m.json`)
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import httpx
import pandas as pd

URLS = {
    "cbsa_pop": "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/metro/totals/cbsa-est2025-alldata.csv",
    "county_pop": "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv",
    "saipe_income": "https://www2.census.gov/programs-surveys/saipe/datasets/2024/2024-state-and-county/est24all.xls",
    "gaz_cbsa": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_cbsa_national.zip",
    "gaz_counties": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip",
    "omb_cbsa": "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx",
    "us_states_topo": "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json",
    "dataverse_clubs_cc0": "https://dataverse.harvard.edu/api/access/datafile/14030182",
}

HEADERS = {"User-Agent": "usafencing-membership-stats/0.1 (+https://github.com/Remco28)"}


def _download(url: str, dest: Path, force: bool = False) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not force:
        return dest
    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=60.0) as client:
        resp = client.get(url)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
    return dest


def _read_zipped_tsv(zip_path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(zip_path) as zf:
        txt_names = [n for n in zf.namelist() if n.endswith(".txt")]
        if not txt_names:
            raise ValueError(f"No .txt file in {zip_path}")
        with zf.open(txt_names[0]) as fh:
            df = pd.read_csv(fh, sep="\t", dtype=str, encoding="latin1")
    df.columns = [c.strip() for c in df.columns]
    return df


def build_census_reference(repo_root: Path, force: bool = False) -> dict[str, int]:
    """Download Census reference files and build clean CSVs under `data/reference/`."""
    cache_dir = repo_root / "data" / "cache" / "census"
    ref_dir = repo_root / "data" / "reference"
    geo_dir = ref_dir / "geo"
    ref_dir.mkdir(parents=True, exist_ok=True)
    geo_dir.mkdir(parents=True, exist_ok=True)

    paths = {
        "cbsa_pop": _download(URLS["cbsa_pop"], cache_dir / "cbsa-est2025-alldata.csv", force),
        "county_pop": _download(URLS["county_pop"], cache_dir / "co-est2025-alldata.csv", force),
        "saipe_income": _download(URLS["saipe_income"], cache_dir / "est24all.xls", force),
        "gaz_cbsa": _download(URLS["gaz_cbsa"], cache_dir / "2024_Gaz_cbsa_national.zip", force),
        "gaz_counties": _download(URLS["gaz_counties"], cache_dir / "2024_Gaz_counties_national.zip", force),
        "omb_cbsa": _download(URLS["omb_cbsa"], cache_dir / "list1_2023.xlsx", force),
        "us_states_topo": _download(URLS["us_states_topo"], geo_dir / "states-10m.json", force),
    }

    # 1. County population (SUMLEV == '050' => actual counties)
    co = pd.read_csv(paths["county_pop"], dtype=str, encoding="latin1")
    co = co[co["SUMLEV"] == "050"].copy()
    co["county_fips"] = co["STATE"].str.zfill(2) + co["COUNTY"].str.zfill(3)
    co["state_fips"] = co["STATE"].str.zfill(2)
    co["pop_2020"] = pd.to_numeric(co["POPESTIMATE2020"], errors="coerce")
    co["pop_2025"] = pd.to_numeric(co["POPESTIMATE2025"], errors="coerce")
    co_clean = co[["county_fips", "state_fips", "STNAME", "CTYNAME", "pop_2020", "pop_2025"]].rename(
        columns={"STNAME": "state_name", "CTYNAME": "county_name"}
    )

    # 2. County Gazetteer centroids
    gaz_co = _read_zipped_tsv(paths["gaz_counties"])
    gaz_co["county_fips"] = gaz_co["GEOID"].str.strip().str.zfill(5)
    gaz_co["state_abbr"] = gaz_co["USPS"].str.strip()
    gaz_co["lat"] = pd.to_numeric(gaz_co["INTPTLAT"].str.strip(), errors="coerce")
    gaz_co["lng"] = pd.to_numeric(gaz_co["INTPTLONG"].str.strip(), errors="coerce")
    gaz_co["land_sqmi"] = pd.to_numeric(gaz_co["ALAND_SQMI"].str.strip(), errors="coerce")
    co_clean = co_clean.merge(
        gaz_co[["county_fips", "state_abbr", "lat", "lng", "land_sqmi"]],
        on="county_fips",
        how="left",
    )

    # 3. 2024 SAIPE Median Household Income (skip 3 header rows)
    saipe = pd.read_excel(paths["saipe_income"], skiprows=3, dtype=str)
    saipe.columns = [str(c).strip() for c in saipe.columns]
    state_col = [c for c in saipe.columns if "State FIPS" in c][0]
    county_col = [c for c in saipe.columns if "County FIPS" in c][0]
    inc_col = [c for c in saipe.columns if "Median Household Income" in c][0]
    pov_col = [c for c in saipe.columns if "Poverty Percent, All Ages" in c][0]
    saipe["county_fips"] = saipe[state_col].str.zfill(2) + saipe[county_col].str.zfill(3)
    saipe["median_household_income_2024"] = pd.to_numeric(saipe[inc_col], errors="coerce")
    saipe["poverty_pct_2024"] = pd.to_numeric(saipe[pov_col], errors="coerce")
    saipe_co = saipe[saipe[county_col].str.zfill(3) != "000"][
        ["county_fips", "median_household_income_2024", "poverty_pct_2024"]
    ]
    co_clean = co_clean.merge(saipe_co, on="county_fips", how="left")

    # 4. OMB County -> CBSA crosswalk (skip 2 title rows)
    omb = pd.read_excel(paths["omb_cbsa"], skiprows=2, dtype=str)
    omb.columns = [str(c).strip() for c in omb.columns]
    omb = omb[omb["FIPS State Code"].notna() & omb["FIPS County Code"].notna()].copy()
    omb["county_fips"] = omb["FIPS State Code"].str.zfill(2) + omb["FIPS County Code"].str.zfill(3)
    omb["cbsa_code"] = omb["CBSA Code"].str.strip()
    omb["cbsa_title"] = omb["CBSA Title"].str.strip()
    omb["cbsa_type"] = omb["Metropolitan/Micropolitan Statistical Area"].str.strip()
    omb["csa_code"] = omb["CSA Code"].fillna("").str.strip()
    omb["csa_title"] = omb["CSA Title"].fillna("").str.strip()
    co_clean = co_clean.merge(
        omb[["county_fips", "cbsa_code", "cbsa_title", "cbsa_type", "csa_code", "csa_title"]],
        on="county_fips",
        how="left",
    )

    co_clean = co_clean.sort_values("county_fips")
    co_out = ref_dir / "census_counties.csv"
    co_clean.to_csv(co_out, index=False)

    # 5. CBSA population + Gazetteer centroids + pop-weighted median income
    cbsa_raw = pd.read_csv(paths["cbsa_pop"], dtype=str, encoding="latin1")
    cbsa_raw = cbsa_raw[cbsa_raw["LSAD"].isin(["Metropolitan Statistical Area", "Micropolitan Statistical Area"])].copy()
    cbsa_raw["cbsa_code"] = cbsa_raw["CBSA"].str.strip()
    cbsa_raw["cbsa_name"] = cbsa_raw["NAME"].str.strip()
    cbsa_raw["cbsa_type"] = cbsa_raw["LSAD"].str.strip()
    cbsa_raw["pop_2020"] = pd.to_numeric(cbsa_raw["POPESTIMATE2020"], errors="coerce")
    cbsa_raw["pop_2025"] = pd.to_numeric(cbsa_raw["POPESTIMATE2025"], errors="coerce")
    cbsa_clean = cbsa_raw[["cbsa_code", "cbsa_name", "cbsa_type", "pop_2020", "pop_2025"]].drop_duplicates("cbsa_code")

    gaz_cbsa = _read_zipped_tsv(paths["gaz_cbsa"])
    gaz_cbsa["cbsa_code"] = gaz_cbsa["GEOID"].str.strip()
    gaz_cbsa["lat"] = pd.to_numeric(gaz_cbsa["INTPTLAT"].str.strip(), errors="coerce")
    gaz_cbsa["lng"] = pd.to_numeric(gaz_cbsa["INTPTLONG"].str.strip(), errors="coerce")
    gaz_cbsa["land_sqmi"] = pd.to_numeric(gaz_cbsa["ALAND_SQMI"].str.strip(), errors="coerce")
    cbsa_clean = cbsa_clean.merge(
        gaz_cbsa[["cbsa_code", "lat", "lng", "land_sqmi"]],
        on="cbsa_code",
        how="left",
    )

    # Population-weighted median household income per CBSA from constituent counties
    inc_valid = co_clean.dropna(subset=["cbsa_code", "pop_2025", "median_household_income_2024"]).copy()
    inc_valid["weighted_inc"] = inc_valid["pop_2025"] * inc_valid["median_household_income_2024"]
    cbsa_inc = (
        inc_valid.groupby("cbsa_code", as_index=False)
        .agg(weighted_inc=("weighted_inc", "sum"), pop_w=("pop_2025", "sum"), county_count=("county_fips", "count"))
    )
    cbsa_inc["median_household_income_est_2024"] = (cbsa_inc["weighted_inc"] / cbsa_inc["pop_w"]).round(0)
    cbsa_clean = cbsa_clean.merge(
        cbsa_inc[["cbsa_code", "median_household_income_est_2024", "county_count"]],
        on="cbsa_code",
        how="left",
    )

    # Attach CSA code/title from OMB
    csa_map = omb[["cbsa_code", "csa_code", "csa_title"]].drop_duplicates("cbsa_code")
    cbsa_clean = cbsa_clean.merge(csa_map, on="cbsa_code", how="left")
    cbsa_clean["pop_growth_2020_2025_pct"] = (
        (cbsa_clean["pop_2025"] - cbsa_clean["pop_2020"]) / cbsa_clean["pop_2020"] * 100.0
    ).round(2)

    cbsa_clean = cbsa_clean.sort_values("pop_2025", ascending=False)
    cbsa_out = ref_dir / "census_cbsa.csv"
    cbsa_clean.to_csv(cbsa_out, index=False)

    # 6. Harvard Dataverse CC0 USA Fencing Clubs archive (doi:10.7910/DVN/AN2RB5)
    dv_xlsx = _download(URLS["dataverse_clubs_cc0"], cache_dir / "dataverse_usafencing_clubs.xlsx", force)
    dv = pd.read_excel(dv_xlsx, dtype=str)
    dv_cols = [
        "id", "name", "short_name", "slug", "division", "region",
        "address", "city", "state", "zip", "country", "lat", "lng",
        "specialties", "website", "nonprofit", "leased_daily", "inactive",
    ]
    dv_keep = [c for c in dv_cols if c in dv.columns]
    dv_clean = dv[dv_keep].copy()
    dv_clean["lat"] = pd.to_numeric(dv_clean["lat"], errors="coerce")
    dv_clean["lng"] = pd.to_numeric(dv_clean["lng"], errors="coerce")
    dv_clean.to_csv(ref_dir / "dataverse_usfa_clubs_cc0.csv", index=False)

    return {
        "counties": len(co_clean),
        "cbsas": len(cbsa_clean),
        "metros": int((cbsa_clean["cbsa_type"] == "Metropolitan Statistical Area").sum()),
        "dataverse_clubs": len(dv_clean),
    }
