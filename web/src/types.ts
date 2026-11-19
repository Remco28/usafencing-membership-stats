export interface LocationSourceStat {
  location_source: string;
  clubs: number;
  competitive: number;
  total: number;
}

export interface DuplicateAudit {
  club_id: string;
  kept_name: string;
  dropped_names: string[];
  row_count: number;
  total: number;
}

export interface DatasetSummary {
  snapshot_date: string;
  tracker_fetched_at: string | null;
  usfa_fetched_at: string | null;
  tracker_raw_rows: number;
  tracker_distinct_clubs: number;
  duplicate_club_ids_merged: DuplicateAudit[];
  usfa_directory_clubs: number;
  totals: {
    competitive: number;
    non_competitive: number;
    total: number;
    comp_share_pct: number;
  };
  coverage: {
    geocoded_clubs: number;
    geocoded_competitive: number;
    geocoded_competitive_pct: number;
    geocoded_total: number;
    geocoded_total_pct: number;
    non_geographic_clubs: number;
    non_geographic_competitive: number;
    unlocated_clubs: number;
    unlocated_competitive: number;
    by_location_source: LocationSourceStat[];
  };
  centers_of_mass: {
    competitive_fencers: { lat: number; lng: number } | null;
    total_fencers: { lat: number; lng: number } | null;
    major_event_stops: { lat: number; lng: number } | null;
    fencer_to_events_gap_miles: number | null;
  };
  national_events: {
    seasons: string;
    major_stops: number;
    host_cities: number;
    all_calendar_stops: number;
  };
}

export interface MetroRecord {
  cbsa_code: string;
  cbsa_name: string;
  display_name: string;
  cbsa_type: string;
  lat: number | null;
  lng: number | null;
  pop_2025: number | null;
  pop_growth_2020_2025_pct: number | null;
  median_household_income_2024: number | null;
  club_count: number;
  competitive: number;
  non_competitive: number;
  total: number;
  comp_share: number | null;
  comp_per_100k: number;
  total_per_100k: number;
  major_stops_hosted: number;
  nearest_host_city: string | null;
  nearest_host_miles: number | null;
  top_club: string | null;
  top_club_comp: number;
  epee_clubs: number;
  foil_clubs: number;
  saber_clubs: number;
  para_clubs: number;
}

export interface ClubRecord {
  club_id: string;
  name: string;
  abbreviation: string;
  competitive: number;
  non_competitive: number;
  total: number;
  comp_share: number | null;
  city: string | null;
  state: string | null;
  county: string | null;
  cbsa_code: string | null;
  cbsa_title: string | null;
  division: string | null;
  region: string | null;
  lat: number;
  lng: number;
  specialties: string;
  has_epee: boolean;
  has_foil: boolean;
  has_saber: boolean;
  has_para: boolean;
  location_source: string;
  nearest_host_city: string | null;
  nearest_host_miles: number | null;
}

export interface HostCityRecord {
  city: string;
  state: string;
  lat: number;
  lng: number;
  major_stops: number;
  seasons: string;
  events: string;
  sn_count: number;
  jo_count: number;
  nac_count: number;
  cbsa_code: string | null;
  weighted_mean_comp_miles: number;
  weighted_mean_total_miles: number;
  comp_within_150mi: number;
  comp_within_150mi_pct: number;
  comp_within_500mi: number;
  comp_within_500mi_pct: number;
}

export interface DatasetBundle {
  schema_version: string;
  summary: DatasetSummary;
  metros: MetroRecord[];
  clubs: ClubRecord[];
  host_cities: HostCityRecord[];
}

export type ScheduleId =
  | 'metros-and-hosts'
  | 'comp-vs-noncomp'
  | 'per-capita-density'
  | 'clubs-registry'
  | 'host-distance';

export type MetricId = 'competitive' | 'non_competitive' | 'total' | 'comp_per_100k';

export type UnitMode = 'metros' | 'clubs';
export type WeaponFilter = 'all' | 'epee' | 'foil' | 'saber' | 'para';
export type ColorMode = 'solid' | 'comp_share' | 'per_capita';

export type Selection =
  | { kind: 'metro'; data: MetroRecord }
  | { kind: 'club'; data: ClubRecord }
  | { kind: 'host'; data: HostCityRecord }
  | null;

export interface AppState {
  schedule: ScheduleId;
  unit: UnitMode;
  metric: MetricId;
  colorMode: ColorMode;
  weapon: WeaponFilter;
  minCount: number;
  showHosts: boolean;
  showCentersOfMass: boolean;
  showHostLabels: boolean;
  showMetroLabels: boolean;
  showStateAbbr: boolean;
  ringHostKey: string | null; // "City, ST" for 150 mi / 500 mi straight-line rings
  searchQuery: string;
  selection: Selection;
}
