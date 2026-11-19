# usafencing-membership-stats

Long-term reproducible dataset, spatial analysis pipeline, static high-resolution maps, and interactive U.S. map web app for **USA Fencing Membership & Club Geography**.

**Live interactive map:** https://remco28.github.io/usafencing-membership-stats/

> **Architecture note:** This repository never scrapes USA Fencing, FencingTracker, or AskFRED directly. Club directory and club membership snapshots are consumed exclusively from `fencing-api` (`/v1` endpoints), then joined with public U.S. Census demographic files, the Harvard Dataverse CC0 USA Fencing club archive, and the official USA Fencing national event calendar. Zero PII is stored anywhere in git.

## Layout

```text
data/
  reference/             # Non-fencing reference datasets (national_events.csv, US Census CBSAs & counties, Dataverse CC0 clubs, verified supplement, us-atlas TopoJSON)
  snapshots/YYYY-MM-DD/  # Immutable dated snapshots pulled from fencing-api
  derived/               # Reproducibly built clubs, metros, divisions, host_cities CSVs + summary.json + dataset.json
src/usaf_stats/          # Data pipeline, fencing-api client, spatial analysis, matching, and CLI
tests/                   # Automated verification of reference data, joins, and metrics
visuals/                 # Static high-resolution maps (SVG + 2800px PNG)
web/                     # Static GitHub Pages interactive map web app (Vite + TypeScript + d3-geo)
```

## Setup & Pipeline Commands

```bash
# 1. Python data pipeline
uv sync --extra dev
cp .env.example .env     # set FENCING_API_URL (default http://127.0.0.1:8780) and optional FENCING_API_KEY
uv run usaf-stats build-reference
uv run usaf-stats pull-snapshot
uv run usaf-stats build-derived
uv run pytest -q

# 2. Interactive map web app & static maps
cd web
npm install
npm run dev              # local dev server
npm run build            # static GitHub Pages bundle -> web/dist/
npm run render-plates    # regenerate visuals/usaf_*.svg and .png (requires resvg)
```

## Interactive Map Web App

The static web app in `web/` (`web/dist/` for GitHub Pages) uses a crisp census-atlas visual layout with plain-English terminology and five preset views:

- **01 Fencers & National Hosts:** Metro-level proportional circles of paid competitive club fencers overlaid with hosted and scheduled NAC / Junior Olympics / Summer Nationals stops (2021–22 to 2026–27 seasons) and geographic balance points.
- **02 Competitive vs. Non-Competitive:** Separates paid tournament-active memberships from non-competitive trial, Access, and beginner rosters.
- **03 Fencers per 100,000:** Population-adjusted competitive fencer density across U.S. metros with 250,000+ residents and 10+ competitive fencers.
- **04 Individual Clubs:** All mapped clubs individually plotted with weapon filters (Épée / Foil / Saber / Parafencing) and zoomable corridor exploration.
- **05 Host City Travel Distance:** Interactive 150-mile (~driving) and 500-mile (~short flight) straight-line rings and average distances from fencers’ clubs for every national tournament host city.

Any view can be exported directly from the browser as a high-resolution **PNG** or **SVG** map.

See [`METHODOLOGY.md`](METHODOLOGY.md) for full sources, geocoding coverage audit, and caveats, and [`decisions.md`](decisions.md) for architectural decisions.
