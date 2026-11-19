# Methodology & Data Caveats

This repository tracks **where USA Fencing clubs and members are concentrated** across the United States, how that compares to **US metro populations and incomes**, and how well **USA Fencing's national event calendar** aligns with where fencers actually live.

Every figure in this repository is built reproducibly from dated snapshots and documented reference files. No personally identifiable information (PII) is stored.

---

## 1. Data Sources

| Dataset | Source | Scope & Freshness |
| :--- | :--- | :--- |
| **Club membership counts** | FencingTracker *Largest Clubs* via `fencing-api` | 908 unique USFA club IDs (after merging 6 upstream duplicate-ID rows) down to 1-member clubs; splits **Competitive**, **Non-Competitive**, and **Total**. |
| **Official club directory & locations (Tier 1)** | USA Fencing *Find a Club* (`member.usafencing.org/clubs`) via `fencing-api` | 652 active directory clubs with street address, city, state, ZIP, county, `lat`/`lng`, official `division`, `region`, `specialties` (Epee/Foil/Saber/Para), and `nonprofit`/`leased_daily` flags (623 matched exact/core -> 26,815 comp). |
| **Archived club directory (Tier 2)** | Harvard Dataverse CC0 archive (`doi:10.7910/DVN/AN2RB5`) | 589 geocoded USA Fencing clubs archived under CC0; recovers 80 additional active clubs absent from the current public finder (2,217 comp). |
| **Verified supplement (Tier 3)** | Audited `data/reference/club_locations_supplement.csv` | 43 major active clubs absent from both directories (verified from official club websites; 1,160 comp) plus 2 explicit non-geographic exclusions (USA Fencing National Sports Medicine Team; overseas club in Suwon-si, South Korea that upstream geocoded to rural Colorado). Brings total mapped coverage to **98.47% of geographically eligible competitive members** (745 clubs). |
| **National event hosts (2021–27)** | Official USA Fencing National Events Calendars (`data/reference/national_events.csv`) | 44 major stops (NACs, Junior Olympics, Summer Nationals, Para NACs) across 21 cities + standalone SJCC stops. |
| **Population & income** | US Census Bureau 2025 Population Estimates (`cbsa-est2025-alldata.csv`, `co-est2025-alldata.csv`), 2024 SAIPE Median Household Income (`est24all.xls`), 2024 Gazetteer centroids, 2023 OMB CBSA delineation (`list1_2023.xlsx`) | Covers all 3,144 US counties and 925 CBSAs (387 metros). |

---

## 2. Known Caveats & Honest Limitations

Any honest fencing membership analysis has to account for quirks in how USA Fencing records work:

1. **Competitive vs. Non-Competitive distortion:**
   - Paid **Competitive** memberships closely reflect active tournament fencers.
   - **Non-Competitive** counts are heavily affected by club policy: some clubs bulk-register every free 90-day trial student and summer camper under USA Fencing liability insurance, while others carry private insurance for beginners and show low non-competitive counts. We always show both metrics separately.
2. **Annual July 31 season reset:**
   - Standard USA Fencing memberships expire on **July 31**. Counts drop sharply in August–October and climb through spring/June as fencers renew before tournaments. Comparisons across years should match similar points in the season (e.g., November-to-November or June/July peak-to-peak).
3. **Unattached & non-club members:**
   - Club-level data excludes members who list no club affiliation ("Unattached", some coaches/referees/supporters). In USA Fencing's 2017–18 End-of-Season roster (30,407 members), 79.1% of competitive members and 66.4% of non-competitive members listed a primary club.
4. **Dual club affiliations (`Club 1` + `Club 2`):**
   - USA Fencing allows members to list up to two clubs (common for college fencers or athletes training at two academies; ~12.8% of competitive members in the 2017–18 baseline). Summing across clubs therefore slightly overstates unique national individuals to the extent FencingTracker credits both affiliations.
5. **Upstream duplicate club IDs:**
   - FencingTracker occasionally lists the same 9-digit USA Fencing club ID multiple times under alternate/renamed club names with identical member counts. Our pipeline deduplicates strictly on `club_id` and logs every merged duplicate row in the build audit report.
6. **Directory coverage gap (~652 directory clubs vs. ~908 FencingTracker clubs):**
   - Roughly a quarter of clubs on FencingTracker (mostly college/high-school clubs, opt-out clubs, and special affiliations like the Sports Medicine Team) do not appear in USA Fencing's public Find-a-Club directory. Our pipeline tracks exact match rates and geocoded coverage openly in every snapshot audit.
