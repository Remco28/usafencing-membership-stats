"""CLI entrypoint for usafencing-membership-stats."""

from __future__ import annotations

import argparse
from pathlib import Path

from usaf_stats.pipeline import build_derived, pull_snapshot
from usaf_stats.reference import build_census_reference


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="usaf-stats",
        description="USA Fencing membership statistics data pipeline and analysis CLI.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_ref = sub.add_parser("build-reference", help="Download and build US Census, map, and CC0 club reference datasets.")
    p_ref.add_argument("--force", action="store_true", help="Re-download cached upstream reference files.")

    p_pull = sub.add_parser("pull-snapshot", help="Pull current club snapshots from fencing-api into data/snapshots/.")
    p_pull.add_argument("--live", action="store_true", help="Request live upstream refresh (requires FENCING_API_KEY).")
    p_pull.add_argument("--date", dest="snapshot_date", default=None, help="Override snapshot directory date (YYYY-MM-DD).")
    p_pull.add_argument("--api-url", default=None, help="Override FENCING_API_URL.")

    p_build = sub.add_parser("build-derived", help="Enrich latest snapshot with Census & NAC metrics and emit web bundle.")
    p_build.add_argument("--snapshot", default=None, help="Specific snapshot folder name (YYYY-MM-DD).")

    args = parser.parse_args(argv)
    root = _repo_root()

    if args.command == "build-reference":
        counts = build_census_reference(root, force=args.force)
        print(
            f"Built reference datasets: {counts['counties']:,} counties, "
            f"{counts['cbsas']:,} CBSAs ({counts['metros']:,} metros), "
            f"{counts['dataverse_clubs']:,} CC0 archived directory clubs."
        )
        return 0

    if args.command == "pull-snapshot":
        snap_dir = pull_snapshot(root, snapshot_date=args.snapshot_date, live=args.live, base_url=args.api_url)
        print(f"Saved fencing-api snapshot to {snap_dir}")
        return 0

    if args.command == "build-derived":
        snap_dir = (root / "data" / "snapshots" / args.snapshot) if args.snapshot else None
        summary = build_derived(root, snapshot_dir=snap_dir)
        cov = summary["coverage"]
        tot = summary["totals"]
        com = summary["centers_of_mass"]
        print(
            f"Built derived dataset ({summary['snapshot_date']}): "
            f"{tot['competitive']:,} comp + {tot['non_competitive']:,} non-comp = {tot['total']:,} total "
            f"across {summary['tracker_distinct_clubs']:,} clubs.\n"
            f"Geocoded coverage: {cov['geocoded_clubs']:,} clubs | "
            f"{cov['geocoded_competitive']:,} comp ({cov['geocoded_competitive_pct']:.2f}%) | "
            f"{cov['geocoded_total']:,} total ({cov['geocoded_total_pct']:.2f}%).\n"
            f"Centers of mass: Comp ({com['competitive_fencers']['lat']}, {com['competitive_fencers']['lng']}) vs "
            f"Events ({com['major_event_stops']['lat']}, {com['major_event_stops']['lng']}) — "
            f"{com['fencer_to_events_gap_miles']} mi apart."
        )
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
