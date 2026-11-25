# Decisions

Dated record of architectural and methodological decisions in `usafencing-membership-stats`.

## 2026-11-18 — Separate repository consuming `fencing-api` (no direct upstream scraping)
- **Decision:** Keep `usafencing-membership-stats` separate from `fencing-api` and never scrape USA Fencing, FencingTracker, or AskFRED directly. Club directory and club membership counts are fetched exclusively through `fencing-api` `/v1` endpoints.
- **Why:** `fencing-api` handles polite rate limiting, raw-page archival, parser versioning, anomaly guards, and backups. Keeping this repository separate keeps it clean, zero-PII, and publishable as an open dataset + GitHub Pages static site with its own non-fencing reference data (US Census, NAC host calendar, map geometries) and long-term snapshot archive.

## 2026-11-18 — Zero PII anywhere in git
- **Decision:** Never store individual fencer names, member numbers, birth dates/years, emails, or addresses in this repository. Only club-, metro-, county-, division-, and region-level aggregates are committed.
- **Why:** Keeps the dataset ethical, lightweight, and safe to share publicly and host on GitHub Pages.

## 2026-11-18 — Competitive vs. Non-Competitive split as a first-class dimension
- **Decision:** Always track and visualize **Competitive**, **Non-Competitive**, and **Total** club memberships separately—treating **Competitive** as the primary metric for active tournament-going demand and national event access.
- **Why:** USA Fencing offers free 90-day trial memberships and bulk club uploads for liability coverage; clubs that upload every beginner/camper have inflated Non-Competitive totals compared to clubs using private insurance for introductory classes. Paid Competitive memberships ($99–$109/yr) are a much more comparable cross-club signal.

## 2026-11-18 — Include SJCC events in `national_events.csv` with explicit `is_major_stop` flag
- **Decision:** Record every official USA Fencing national-calendar stop from 2021–22 through 2026–27 (NACs, Junior Olympics, Summer Nationals & July Challenge, plus standalone SJCC stops) in `data/reference/national_events.csv`, using `is_major_stop=true` for the 44 NAC / JO / Summer Nationals / Para-NAC stops (21 host cities) and `is_major_stop=false` for standalone SJCC / TBA events.
- **Why:** Allows direct apples-to-apples comparison across major national stops while preserving the full national calendar for broader travel analyses.

## 2026-11-18 — Strict 1:1 club matching + three-tier geocoding cascade (98.47% coverage)
- **Decision:** Remove abbreviation-only automatic matching (which caused false 1:N collisions like `UMFC` Michigan vs. Minnesota), pair the USA Fencing public directory with the Harvard Dataverse CC0 club archive (`doi:10.7910/DVN/AN2RB5`) and a small verified supplement, and explicitly exclude non-geographic / overseas entries (including a South Korean club geocoded by USA Fencing to the U.S. centroid in Colorado).
- **Why:** Maximizes trustworthy coverage (98.47% of geographically eligible competitive members) while preserving full per-club provenance in `location_source`.

## 2026-11-19 — Census-atlas visual aesthetic with plain-English copy
- **Decision:** Build the interactive GitHub Pages site (`web/`) with a crisp white/navy/red census-atlas visual layout, five preset analytical views, one-click SVG / 2× PNG export, general U.S. Census demographic context, and plain-English terminology throughout. Omit GitHub repository and issue-tracker links from the web UI and exported maps.
- **Why:** The visual craft carries the editorial feel without forcing readers to decode jargon, and keeping the web UI self-contained keeps the project focused and low-maintenance.

## 2026-11-24 — Desktop-first interactive UX & object-first flow
- **Decision:** Optimize the interactive web app primarily for desktop screens (`1280×800`+) and display a friendly desktop-recommended notice on narrow mobile screens (`≤720px`) rather than compromising desktop layout for phones. Structure interaction around an object-first flow: universal typeahead search (clubs, metros, hosts), Focus/Isolate mode, non-destructive host rings with club-to-host distance connectors, unified map/sidebar/table filters with clickable metro weapon chips, side-by-side Metro and Host comparisons, and Current View vs. Full U.S. Plate export.
- **Why:** Multi-layer national maps, dense club corridors, and side-by-side comparisons are inherently desktop tools, and keeping the user's selected subject intact while asking follow-up questions removes the main friction of top-bar knob dashboards.

## 2026-11-24 — Umbrella scope: multi-topic USA Fencing data & infographics site
- **Decision:** Expand this repository's scope from a single membership-geography map into an umbrella home for independent USA Fencing data studies and interactive infographics — keeping Membership & Club Geography as Topic 01, folding in the existing USA Fencing Financials & Governance project (10-year Form 990s, peer NGBs, USOPC funding) as Topic 02, and designing `web/` and `data/` so future topics slot in cleanly under shared site navigation and consistent guardrails (zero PII, no direct scraping, evidence-first plain English, large raw archives kept out of git with provenance logs).
- **Why:** Maintaining separate repos and separate sites for related USA Fencing parent/fencer data projects fragments the audience and duplicates build/deploy plumbing. One shared repo and multi-page GitHub Pages site lets each topic stand on its own while building a cohesive reference resource.
