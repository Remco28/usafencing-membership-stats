# USA Fencing Stats & Public Data

Independent, reproducible datasets, spatial & financial analyses, static high-resolution graphics, and interactive web infographics about **USA Fencing** — built for fencing parents, fencers, coaches, and anyone curious about how the sport works by the numbers.

**Live site:** https://remco28.github.io/usafencing-membership-stats/

> **Independent project:** Not affiliated with USA Fencing, the U.S. Census Bureau, or the USOPC.

---

## Purpose & Scope

This repository is the **umbrella home for independent USA Fencing data studies and interactive infographics**. Rather than spinning up a separate repository for each question about USA Fencing, each topic lives here as a reproducible dataset plus a dedicated page/visual on the same static GitHub Pages site.

### Topics
| # | Topic | Status | What It Covers |
|---|---|---|---|
| **01** | **Membership & Club Geography** | **Live** | Club-level competitive vs. non-competitive membership counts, U.S. Census metro demographics, weapon offerings, and 2021–22 to 2026–27 national tournament host reach & travel distance. |
| **02** | **USA Fencing Financials & Governance** | **Planned** *(folding in `usafencing-financials`)* | 10-year IRS Form 990 (FY2016–FY2025) financial health, reserves/runway, revenue & event money flow, executive pay vs. program spend, and peer Olympic NGB / USOPC funding comparisons. |
| **03+** | **Future Topics** | **Open** | Additional evidence-based USA Fencing infographics and analyses added here as ideas come up. |

### Scope Guardrails (Apply to Every Topic)
- **Zero PII in git:** Never store individual fencer names, member numbers, birth dates, emails, or personal addresses. Only public organizational, club-, metro-, county-, division-, and national-level data.
- **No direct upstream scraping:** Club directory and membership snapshots are consumed exclusively from `fencing-api` (`/v1` endpoints). Other topics use free public filings and official published documents (U.S. Census, IRS Form 990s, USOPC statements, USA Fencing event calendars).
- **Evidence first, plain English:** Visual polish carries the editorial feel; copy stays plain, factual, and honest about caveats and what the data cannot show.
- **Keep git lightweight:** Clean extracted CSV/JSON datasets, scripts, and provenance logs are committed; large raw upstream downloads (Census zips, 990 PDF/XML archives) stay out of git in `data/cache/`.
- **Desktop-first interactive graphics:** Interactive pages are designed primarily for desktop screens (mobile visitors are advised to use desktop). Web UIs and exported graphics omit GitHub repo/issue links.

---

## Current Topic 01: Membership & Club Geography

The live interactive web app in `web/` (`web/dist/` deployed to GitHub Pages) offers five preset analytical views plus object-first exploration:

- **01 Fencers & National Hosts:** Metro-level proportional circles of paid competitive club fencers overlaid with hosted and scheduled NAC / Junior Olympics / Summer Nationals stops (2021–22 to 2026–27 seasons) and geographic balance points.
- **02 Competitive vs. Non-Competitive:** Separates paid tournament-active memberships from non-competitive trial, Access, and beginner rosters.
- **03 Fencers per 100,000:** Population-adjusted competitive fencer density across U.S. metros with 250,000+ residents and 10+ competitive fencers.
- **04 Individual Clubs:** All mapped clubs individually plotted with weapon filters (Épée / Foil / Saber / Parafencing), zoom-responsive bubble counter-scaling, county boundaries, and clickable metro club lists.
- **05 Host City Travel Distance:** Interactive 150-mile (~driving) and 500-mile (~short flight) straight-line rings, average club distances, and largest metros within 500 miles for every national tournament host city.

**Interactive workflow highlights:**
- **Universal Find:** Typeahead search across clubs, metros, and host cities from any tab.
- **Focus / Isolate & Non-Destructive Host Rings:** Isolate a single club or metro on the map, draw host distance rings and straight-line connectors without losing your selection, and filter metro clubs by clickable weapon chips.
- **Side-by-Side Compare:** Compare any two metros or any two national host cities (with dual ring overlays).
- **Export:** Download either your **Current View** (zoom, focus, connector, and rings) or a **Full U.S. Plate** as **PNG** or **SVG**.

---

## Repository Layout

```text
data/
  reference/             # Public reference datasets (national_events.csv, US Census CBSAs & counties, Dataverse CC0 clubs, verified supplement, us-atlas states & counties TopoJSON)
  snapshots/YYYY-MM-DD/  # Immutable dated snapshots pulled from fencing-api
  derived/               # Reproducibly built clubs, metros, divisions, host_cities CSVs + summary.json + dataset.json
src/usaf_stats/          # Data pipeline, fencing-api client, spatial analysis, matching, and CLI
tests/                   # Automated verification of reference data, joins, and metrics
visuals/                 # Static high-resolution maps (SVG + 2800px PNG)
web/                     # Static GitHub Pages site (Vite + TypeScript + d3-geo)
```

*(As Topic 02 — Financials — and future topics are folded in, each topic will add its own derived data slice under `data/` and its own page/route inside `web/` sharing a lightweight top-level site navigation bar.)*

## Setup & Pipeline Commands

```bash
# 1. Python data pipeline
uv sync --extra dev
cp .env.example .env     # set FENCING_API_URL (default http://127.0.0.1:8780) and optional FENCING_API_KEY
uv run usaf-stats build-reference
uv run usaf-stats pull-snapshot
uv run usaf-stats build-derived
uv run pytest -q

# 2. Interactive web app & static maps
cd web
npm install
npm run dev              # local dev server
npm run build            # static GitHub Pages bundle -> web/dist/
npm run render-plates    # regenerate visuals/usaf_*.svg and .png (requires resvg)
```

See [`METHODOLOGY.md`](METHODOLOGY.md) for full sources, geocoding coverage audit, and caveats, and [`decisions.md`](decisions.md) for architectural decisions.
