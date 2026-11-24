import type { AppState, ColorMode, DatasetSummary, MetricId, ScheduleId, UnitMode } from './types';

/** One wording for every circle-size metric, shared by the on-screen legend and exported plates. */
export function metricLabel(metric: MetricId): string {
  switch (metric) {
    case 'comp_per_100k':
      return 'Fencers per 100,000 Residents';
    case 'total':
      return 'Total Club Members';
    case 'non_competitive':
      return 'Non-Competitive Members';
    default:
      return 'Competitive Fencers';
  }
}

export interface ScheduleDef {
  id: ScheduleId;
  index: string;
  tabLabel: string;
  title: string;
  subtitle: (sum: DatasetSummary) => string;
  howToRead: string;
  contextNote: string;
  defaults: {
    unit: UnitMode;
    metric: MetricId;
    colorMode: ColorMode;
    showHosts: boolean;
    showCentersOfMass: boolean;
    showHostLabels: boolean;
    showMetroLabels: boolean;
    ringHostKey: string | null;
    minCount: number;
  };
}

export const SCHEDULES: ScheduleDef[] = [
  {
    id: 'metros-and-hosts',
    index: '01',
    tabLabel: 'Fencers & National Hosts',
    title: 'Competitive Fencers by Metro Area & National Tournament Hosts',
    subtitle: (sum) =>
      `Paid competitive club members grouped by U.S. Census metro area · ${sum.national_events.major_stops} hosted & scheduled national stops (North American Cup, Junior Olympics, Summer Nationals, ${sum.national_events.seasons} seasons) in ${sum.national_events.host_cities} cities`,
    howToRead:
      'Circle size = paid competitive club fencers in that metro area. Gold stars = national tournament host cities (bigger star = more hosted & scheduled stops). Excludes Unattached fencers with no listed club.',
    contextNote:
      'Grouping clubs by U.S. Census metro area shows where fencers actually cluster instead of shading whole rural states by one nearby city.',
    defaults: {
      unit: 'metros',
      metric: 'competitive',
      colorMode: 'solid',
      showHosts: true,
      showCentersOfMass: true,
      showHostLabels: true,
      showMetroLabels: true,
      ringHostKey: null,
      minCount: 0,
    },
  },
  {
    id: 'comp-vs-noncomp',
    index: '02',
    tabLabel: 'Competitive vs. Non-Competitive',
    title: 'Competitive vs. Non-Competitive Club Membership by Metro',
    subtitle: () =>
      'Circle size = total club-affiliated members · Color = share holding paid Competitive memberships (separating tournament fencers from non-competitive trials, Access & beginner tiers)',
    howToRead:
      'Metros with 25+ total members: circle size = all club members (Competitive + Non-Competitive). Darker navy = higher share of paid Competitive fencers; gold = higher Non-Competitive share.',
    contextNote:
      'Total headcounts often run much higher in metros where some clubs register summer campers or school clinics on free 90-day trial memberships for liability coverage.',
    defaults: {
      unit: 'metros',
      metric: 'total',
      colorMode: 'comp_share',
      showHosts: false,
      showCentersOfMass: false,
      showHostLabels: false,
      showMetroLabels: true,
      ringHostKey: null,
      minCount: 25,
    },
  },
  {
    id: 'per-capita-density',
    index: '03',
    tabLabel: 'Fencers per 100,000',
    title: 'Competitive Fencers per 100,000 Residents by Metro Area',
    subtitle: () =>
      'U.S. metros with 250,000+ residents (2025 U.S. Census estimate) and 10+ competitive fencers · Adjusts club counts for metro population size',
    howToRead:
      'Circle size and darker blue = more paid competitive club fencers per 100,000 residents. Useful for comparing fencing participation across smaller and larger metros on equal footing.',
    contextNote:
      'Adjusting for population highlights mid-sized and college-adjacent metros with dense club participation alongside the largest coastal hubs.',
    defaults: {
      unit: 'metros',
      metric: 'comp_per_100k',
      colorMode: 'per_capita',
      showHosts: false,
      showCentersOfMass: false,
      showHostLabels: false,
      showMetroLabels: true,
      ringHostKey: null,
      minCount: 10,
    },
  },
  {
    id: 'clubs-registry',
    index: '04',
    tabLabel: 'Individual Clubs',
    title: 'Mapped USA Fencing Clubs Across the United States',
    subtitle: (sum) =>
      `${sum.coverage.geocoded_clubs.toLocaleString()} of ${sum.tracker_distinct_clubs.toLocaleString()} clubs mapped to U.S. locations · Filter by weapon or minimum club size · Scroll or click a dot to zoom in`,
    howToRead:
      'Each dot is one mapped fencing club. Circle size = paid competitive members at that club; color = share of members holding paid Competitive memberships. Use Weapon or Search to filter.',
    contextNote:
      'Includes mapped clubs of every size, from the largest multi-strip academies down to single-member clubs. Unmapped clubs are mostly very small.',
    defaults: {
      unit: 'clubs',
      metric: 'competitive',
      colorMode: 'comp_share',
      showHosts: false,
      showCentersOfMass: false,
      showHostLabels: false,
      showMetroLabels: false,
      ringHostKey: null,
      minCount: 1,
    },
  },
  {
    id: 'host-distance',
    index: '05',
    tabLabel: 'Host City Travel Distance',
    title: 'National Tournament Host Reach & Club-to-Event Distance',
    subtitle: () =>
      'Click any gold host star to draw 150-mile (~driving) and 500-mile (~short flight) straight-line rings around that city',
    howToRead:
      'Blue circles = paid competitive club fencers by metro. Gold stars = national host cities (2021–22 to 2026–27 seasons, hosted & scheduled). Click any star or table row to measure straight-line club distance.',
    contextNote:
      'Distances are measured straight-line from each mapped club location (each competitive member counted at their club’s location), not road distance or individual fencers’ home addresses.',
    defaults: {
      unit: 'metros',
      metric: 'competitive',
      colorMode: 'solid',
      showHosts: true,
      showCentersOfMass: true,
      showHostLabels: true,
      showMetroLabels: false,
      ringHostKey: 'Richmond, VA',
      minCount: 0,
    },
  },
];

export function getSchedule(id: ScheduleId): ScheduleDef {
  return SCHEDULES.find((s) => s.id === id) ?? SCHEDULES[0];
}

export function createInitialState(): AppState {
  const s = SCHEDULES[0];
  return {
    schedule: s.id,
    unit: s.defaults.unit,
    metric: s.defaults.metric,
    colorMode: s.defaults.colorMode,
    weapon: 'all',
    minCount: s.defaults.minCount,
    showHosts: s.defaults.showHosts,
    showCentersOfMass: s.defaults.showCentersOfMass,
    showHostLabels: s.defaults.showHostLabels,
    showMetroLabels: s.defaults.showMetroLabels,
    showStateAbbr: true,
    ringHostKey: s.defaults.ringHostKey,
    searchQuery: '',
    selection: null,
    compareSelection: null,
    focusMode: false,
    metroFilterCode: null,
  };
}
