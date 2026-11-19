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
