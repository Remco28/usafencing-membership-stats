import { getSchedule, metricLabel } from './schedules';
import { estimateTextWidth, plateLayout } from './mapLayout';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  colorForCompShare,
  colorForPerCapita,
  starPath,
} from './map';
import type { AppState, DatasetBundle } from './types';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function atlasEmblemSvg(cx: number, cy: number, r: number): string {
  return `
    <g transform="translate(${cx},${cy})" opacity="0.88">
      <circle r="${r}" fill="none" stroke="#12355b" stroke-width="1.4"/>
      <circle r="${(r * 0.84).toFixed(1)}" fill="none" stroke="#12355b" stroke-width="0.7" stroke-dasharray="2 1.5"/>
      <line x1="-10" y1="8" x2="10" y2="-10" stroke="#12355b" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="10" y1="8" x2="-10" y2="-10" stroke="#12355b" stroke-width="1.3" stroke-linecap="round"/>
      <circle cx="-7.5" cy="5.5" r="2.2" fill="#ffffff" stroke="#12355b" stroke-width="1"/>
      <circle cx="7.5" cy="5.5" r="2.2" fill="#ffffff" stroke="#12355b" stroke-width="1"/>
      <rect x="-7" y="10" width="3" height="5" fill="#b42318"/>
      <rect x="-2" y="7" width="3" height="8" fill="#12355b"/>
      <rect x="3" y="4" width="3" height="11" fill="#12355b"/>
    </g>
  `;
}

function buildLegendSvg(
  state: AppState,
  x: number,
  y: number,
  gapMiles: number | null,
  stopsRange: string,
): string {
  const parts: string[] = [];

  // Circle size legend
  const samples =
    state.unit === 'clubs'
      ? state.metric === 'total'
        ? [
            { label: '25', r: 3.1 },
            { label: '150', r: 7.5 },
            { label: '500', r: 13.7 },
          ]
        : [
            { label: '25', r: 3.7 },
            { label: '100', r: 7.5 },
            { label: '350', r: 14.0 },
          ]
      : state.metric === 'comp_per_100k'
        ? [
            { label: '10', r: 8.3 },
            { label: '30', r: 14.4 },
            { label: '65', r: 21.2 },
          ]
        : state.metric === 'total'
          ? [
              { label: '250', r: 5.1 },
              { label: '1,500', r: 12.5 },
              { label: '5,000', r: 22.8 },
            ]
          : [
              { label: '250', r: 5.8 },
              { label: '1,000', r: 11.6 },
              { label: '4,500', r: 24.7 },
            ];

  // Same wording as the on-screen legend ("Circle size = …")
  const sizeHeading =
    state.metric === 'comp_per_100k'
      ? `CIRCLE SIZE = ${metricLabel(state.metric).toUpperCase()}`
      : `CIRCLE SIZE = ${metricLabel(state.metric).toUpperCase()} PER ${state.unit === 'clubs' ? 'CLUB' : 'METRO'}`;

  parts.push(
    `<text x="${x}" y="${y}" font-family="'IBM Plex Mono', monospace" font-size="10" font-weight="600" fill="#334155" letter-spacing="0.06em">${escapeXml(sizeHeading)}</text>`,
  );

  let cx = x + 16;
  const baseline = y + 54;
  for (const s of samples) {
    cx += s.r;
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${(baseline - s.r).toFixed(1)}" r="${s.r.toFixed(1)}" fill="#164677" fill-opacity="0.65" stroke="#163656" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${baseline + 14}" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="10" fill="#0f172a">${escapeXml(s.label)}</text>`,
    );
    cx += s.r + 22;
  }

  // Secondary color legend or host star legend
  const colX = x + 315;
  if (state.colorMode === 'comp_share') {
    parts.push(
      `<text x="${colX}" y="${y}" font-family="'IBM Plex Mono', monospace" font-size="10" font-weight="600" fill="#334155" letter-spacing="0.06em">SHARE COMPETITIVE (% OF TOTAL MEMBERS)</text>`,
    );
    const stops = [
      { label: '<40%', c: colorForCompShare(0.35) },
      { label: '45%', c: colorForCompShare(0.45) },
      { label: '55%', c: colorForCompShare(0.55) },
      { label: '65%', c: colorForCompShare(0.65) },
      { label: '75%+', c: colorForCompShare(0.78) },
    ];
    stops.forEach((st, i) => {
      const bx = colX + i * 48;
      parts.push(`<rect x="${bx}" y="${y + 18}" width="44" height="14" fill="${st.c}" stroke="#ffffff" stroke-width="1"/>`);
      parts.push(`<text x="${bx + 22}" y="${y + 46}" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="9.5" fill="#0f172a">${escapeXml(st.label)}</text>`);
    });
  } else if (state.colorMode === 'per_capita') {
    parts.push(
      `<text x="${colX}" y="${y}" font-family="'IBM Plex Mono', monospace" font-size="10" font-weight="600" fill="#334155" letter-spacing="0.06em">COMPETITIVE FENCERS PER 100,000 RESIDENTS</text>`,
    );
    const stops = [
      { label: '<5', c: colorForPerCapita(3) },
      { label: '5–10', c: colorForPerCapita(7) },
      { label: '10–16', c: colorForPerCapita(12) },
      { label: '16–25', c: colorForPerCapita(20) },
      { label: '25+', c: colorForPerCapita(30) },
    ];
    stops.forEach((st, i) => {
      const bx = colX + i * 52;
      parts.push(`<rect x="${bx}" y="${y + 18}" width="48" height="14" fill="${st.c}" stroke="#ffffff" stroke-width="1"/>`);
      parts.push(`<text x="${bx + 24}" y="${y + 46}" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="9.5" fill="#0f172a">${escapeXml(st.label)}</text>`);
    });
  }

  if (state.showHosts) {
    const hx = state.colorMode === 'solid' ? colX : colX + 340;
    parts.push(
      `<text x="${hx}" y="${y}" font-family="'IBM Plex Mono', monospace" font-size="10" font-weight="600" fill="#334155" letter-spacing="0.06em">NATIONAL TOURNAMENT HOST CITIES (2021–22 TO 2026–27)</text>`,
    );
    parts.push(
      `<g transform="translate(${hx + 10},${y + 26})"><path d="${starPath(7.5, 3.3)}" fill="#d88c28" stroke="#2a1c10" stroke-width="1"/></g>`,
    );
    parts.push(
      `<text x="${hx + 24}" y="${y + 30}" font-family="'IBM Plex Sans', sans-serif" font-size="11" fill="#0f172a">North American Cup (NAC), Junior Olympics (JO), or Summer Nationals (${stopsRange} hosted &amp; scheduled stops)</text>`,
    );
    if (state.showCentersOfMass && gapMiles !== null) {
      parts.push(
        `<g transform="translate(${hx + 10},${y + 50})"><circle r="5" fill="#ffffff" stroke="#163656" stroke-width="1.4"/><path d="M-7 0H7M0 -7V7" stroke="#163656" stroke-width="1.1"/></g>`,
      );
      parts.push(
        `<text x="${hx + 24}" y="${y + 54}" font-family="'IBM Plex Sans', sans-serif" font-size="11" fill="#0f172a">Geographic balance points: where fencers vs. event stops balance on the map (${gapMiles} mi apart — not avg travel)</text>`,
      );
    }
  }

  return parts.join('\n');
}

function seasonStageLabel(snapshotDate: string): string {
  const month = Number(snapshotDate.split('-')[1]);
  if (month >= 8 && month <= 10) return 'EARLY SEASON · RENEWS AUG 1';
  if (month === 6 || month === 7) return 'LATE SEASON · RENEWS AUG 1';
  return 'MID-SEASON · RENEWS AUG 1';
}

function stopsRange(ds: DatasetBundle): string {
  const stops = ds.host_cities.map((h) => h.major_stops);
  if (stops.length === 0) return '0';
  const lo = Math.min(...stops);
  const hi = Math.max(...stops);
  return lo === hi ? String(hi) : `${lo}–${hi}`;
}

function fmtStops(n: number): string {
  return `${n} stop${n === 1 ? '' : 's'}`;
}

export function composeExportMapSvg(
  liveSvg: SVGSVGElement,
  dataset: DatasetBundle,
  state: AppState,
): string {
  const L = plateLayout();
  const { plateW, plateH, annexX, annexY, annexW } = L;
  const sched = getSchedule(state.schedule);
  const sum = dataset.summary;
  const clubPct = Math.round((sum.coverage.geocoded_clubs / sum.tracker_distinct_clubs) * 100);
  const dupCount = sum.duplicate_club_ids_merged.length;
  const gapMiles = sum.centers_of_mass.fencer_to_events_gap_miles;

  // Serialize live map inner content inside a nested scaled viewport
  const clone = liveSvg.cloneNode(true) as SVGSVGElement;
  const mapInner = clone.innerHTML;

  // Right-hand ranked summary table
  let annexTitle = 'TOP 10 METROS · COMPETITIVE FENCERS';
  let annexRows: Array<{ label: string; c1: string; c2: string }> = [];
  let c1Head = 'COMPETITIVE';
  let c2Head = 'STOPS';

  if (state.schedule === 'host-distance') {
    annexTitle = 'SHORTEST AVG CLUB DISTANCE · HOST CITIES';
    c1Head = 'AVG MI';
    c2Head = 'FENCERS ≤500 MI';
    annexRows = [...dataset.host_cities]
      .sort((a, b) => a.weighted_mean_comp_miles - b.weighted_mean_comp_miles)
      .slice(0, 10)
      .map((h) => ({
        label: `${h.city}, ${h.state} (${fmtStops(h.major_stops)})`,
        c1: `${Math.round(h.weighted_mean_comp_miles)} mi`,
        c2: `${h.comp_within_500mi_pct.toFixed(0)}%`,
      }));
  } else if (state.metric === 'comp_per_100k') {
    annexTitle = 'TOP METROS PER 100,000 RESIDENTS (250K+ POP)';
    c1Head = '/100,000';
    c2Head = 'COMPETITIVE';
    annexRows = [...dataset.metros]
      .filter((m) => (m.pop_2025 ?? 0) >= 250_000 && m.competitive >= 10)
      .sort((a, b) => b.comp_per_100k - a.comp_per_100k)
      .slice(0, 10)
      .map((m) => ({
        label: m.display_name,
        c1: m.comp_per_100k.toFixed(1),
        c2: m.competitive.toLocaleString(),
      }));
  } else {
    annexRows = [...dataset.metros]
      .sort((a, b) => b.competitive - a.competitive)
      .slice(0, 10)
      .map((m) => ({
        label: m.display_name,
        c1: m.competitive.toLocaleString(),
        c2: m.major_stops_hosted > 0 ? fmtStops(m.major_stops_hosted) : '—',
      }));
  }

  // Right column hugs the edge; first value column sits left of the widest second-column text
  const c2Width = Math.max(
    estimateTextWidth(c2Head, 9.5, true),
    ...annexRows.map((r) => estimateTextWidth(r.c2, 12, true)),
  );
  const c1Right = annexX + annexW - 12 - Math.max(90, c2Width + 26);

  const annexRowsSvg = annexRows
    .map((r, i) => {
      const ry = L.firstRowBaseline + i * L.rowH;
      const stripe = i % 2 === 1 ? `<rect x="${annexX + 1}" y="${ry - 21}" width="${annexW - 2}" height="${L.rowH}" fill="#f8fafc"/>` : '';
      return `${stripe}
        <text x="${annexX + 10}" y="${ry}" font-family="'IBM Plex Mono', monospace" font-size="11" fill="#6b7280">${String(i + 1).padStart(2, '0')}</text>
        <text x="${annexX + 34}" y="${ry}" font-family="'IBM Plex Sans', sans-serif" font-size="12.5" font-weight="500" fill="#0f172a">${escapeXml(r.label)}</text>
        <text x="${c1Right}" y="${ry}" text-anchor="end" font-family="'IBM Plex Mono', monospace" font-size="12" font-weight="600" fill="#0f2e4f">${escapeXml(r.c1)}</text>
        <text x="${annexX + annexW - 12}" y="${ry}" text-anchor="end" font-family="'IBM Plex Mono', monospace" font-size="12" fill="#7a3e1c">${escapeXml(r.c2)}</text>
        <line x1="${annexX}" y1="${ry + L.rowH - 21}" x2="${annexX + annexW}" y2="${ry + L.rowH - 21}" stroke="#e2e8f0" stroke-width="0.7"/>`;
    })
    .join('\n');

  // National KPI cards beneath the ranked table
  const kpiY = L.kpiY;
  const kpis = [
    { k: 'COMPETITIVE FENCERS', v: sum.totals.competitive.toLocaleString(), s: `${sum.totals.comp_share_pct.toFixed(1)}% of club members` },
    { k: 'NON-COMPETITIVE', v: sum.totals.non_competitive.toLocaleString(), s: 'Trials, Access & other tiers' },
    { k: 'MAPPED COMPETITIVE', v: `${sum.coverage.geocoded_competitive_pct.toFixed(1)}%`, s: `${sum.coverage.geocoded_clubs} of ${sum.tracker_distinct_clubs} clubs (${clubPct}%)` },
    { k: 'BALANCE-POINT GAP', v: gapMiles !== null ? `${gapMiles} mi` : '—', s: 'Fencers vs. hosts (not avg travel)' },
  ];
  const kpiSvg = kpis
    .map((item, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const bx = annexX + col * 212;
      const by = kpiY + row * (L.kpiH + L.kpiGap);
      return `
        <rect x="${bx}" y="${by}" width="202" height="${L.kpiH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>
        <text x="${bx + 12}" y="${by + 22}" font-family="'IBM Plex Mono', monospace" font-size="9" font-weight="600" fill="#475569" letter-spacing="0.05em">${escapeXml(item.k)}</text>
        <text x="${bx + 12}" y="${by + Math.round(L.kpiH * 0.56)}" font-family="'IBM Plex Mono', monospace" font-size="23" font-weight="600" fill="#0f2e4f">${escapeXml(item.v)}</text>
        <text x="${bx + 12}" y="${by + L.kpiH - 16}" font-family="'IBM Plex Sans', sans-serif" font-size="10" fill="#475569">${escapeXml(item.s)}</text>
      `;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${plateW}" height="${plateH}" viewBox="0 0 ${plateW} ${plateH}">
  <rect width="${plateW}" height="${plateH}" fill="#ffffff"/>
  <rect x="20" y="20" width="${plateW - 40}" height="${plateH - 40}" fill="none" stroke="#cbd5e1" stroke-width="1.2"/>

  <!-- Header -->
  ${atlasEmblemSvg(62, 64, 24)}
  <text x="100" y="50" font-family="'IBM Plex Mono', monospace" font-size="10.5" font-weight="600" fill="#334155" letter-spacing="0.11em">USA FENCING MEMBERSHIP &amp; CLUB GEOGRAPHY · INDEPENDENT / UNOFFICIAL</text>
  <text x="100" y="79" font-family="'Source Serif 4', Georgia, serif" font-size="24" font-weight="700" fill="#0b223d">${escapeXml(sched.title)}</text>
  <text x="100" y="102" font-family="'IBM Plex Sans', sans-serif" font-size="12.8" fill="#334155">${escapeXml(sched.subtitle(sum))}</text>

  <!-- Data Date Stamp -->
  <g transform="translate(1390, 44)">
    <rect width="170" height="44" fill="#ffffff" stroke="#b42318" stroke-width="1.2" stroke-dasharray="3 1.5"/>
    <text x="85" y="18" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="9.5" font-weight="600" fill="#b42318" letter-spacing="0.06em">DATA AS OF ${escapeXml(sum.snapshot_date)}</text>
    <text x="85" y="34" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="8.7" fill="#7f1d1d">${escapeXml(seasonStageLabel(sum.snapshot_date))}</text>
  </g>
  <line x1="36" y1="116" x2="${plateW - 36}" y2="116" stroke="#12355b" stroke-width="2"/>

  <!-- Main Albers USA Map Frame -->
  <svg x="${L.mapX}" y="${L.mapY}" width="${L.mapW}" height="${L.mapH}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}">
    ${mapInner}
  </svg>

  <!-- Right-hand Ranked Table -->
  <rect x="${annexX}" y="${annexY}" width="${annexW}" height="${L.tableH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>
  <rect x="${annexX}" y="${annexY}" width="${annexW}" height="34" fill="#12355b"/>
  <text x="${annexX + 12}" y="${annexY + 21}" font-family="'IBM Plex Mono', monospace" font-size="10.2" font-weight="600" fill="#ffffff" letter-spacing="0.05em">${escapeXml(annexTitle)}</text>
  <text x="${c1Right}" y="${annexY + 47}" text-anchor="end" font-family="'IBM Plex Mono', monospace" font-size="9.5" font-weight="600" fill="#334155">${escapeXml(c1Head)}</text>
  <text x="${annexX + annexW - 12}" y="${annexY + 47}" text-anchor="end" font-family="'IBM Plex Mono', monospace" font-size="9.5" font-weight="600" fill="#334155">${escapeXml(c2Head)}</text>
  <line x1="${annexX}" y1="${annexY + 53}" x2="${annexX + annexW}" y2="${annexY + 53}" stroke="#94a3b8" stroke-width="1"/>
  ${annexRowsSvg}
  ${kpiSvg}

  <!-- Legend Strip -->
  <line x1="36" y1="${L.legendRuleY}" x2="${plateW - 36}" y2="${L.legendRuleY}" stroke="#cbd5e1" stroke-width="1"/>
  ${buildLegendSvg(state, 40, L.legendY, gapMiles, stopsRange(dataset))}

  <!-- Data Sources & Caveats Footer -->
  <line x1="36" y1="${L.footerRuleY}" x2="${plateW - 36}" y2="${L.footerRuleY}" stroke="#94a3b8" stroke-width="1.2"/>
  <text x="40" y="${L.footerRuleY + 20}" font-family="'IBM Plex Mono', monospace" font-size="10.5" font-weight="600" fill="#12355b" letter-spacing="0.06em">DATA SOURCES &amp; NOTES</text>
  <text x="40" y="${L.footerRuleY + 40}" font-family="'IBM Plex Sans', sans-serif" font-size="11.2" fill="#1e293b">
    Club counts: FencingTracker (independent tracker aggregating USA Fencing public rosters), data as of ${escapeXml(sum.snapshot_date)} (${sum.tracker_distinct_clubs.toLocaleString()} clubs; ${dupCount} duplicate IDs merged).
  </text>
  <text x="40" y="${L.footerRuleY + 58}" font-family="'IBM Plex Sans', sans-serif" font-size="11.2" fill="#1e293b">
    Locations &amp; demographics: USA Fencing Club Directory + public-domain club archive + club websites (${sum.coverage.geocoded_clubs} of ${sum.tracker_distinct_clubs} clubs, holding ${sum.coverage.geocoded_competitive_pct.toFixed(1)}% of U.S.-based competitive fencers); U.S. Census 2025 Pop. Estimates &amp; 2024 Median Household Income.
  </text>
  <text x="40" y="${L.footerRuleY + 76}" font-family="'IBM Plex Sans', sans-serif" font-size="11.2" fill="#1e293b">
    National events: USA Fencing calendars, ${escapeXml(sum.national_events.seasons)} seasons (${sum.national_events.major_stops} hosted &amp; scheduled North American Cup / Junior Olympics / Summer Nationals stops in ${sum.national_events.host_cities} cities). Independent project; not affiliated with USA Fencing or U.S. Census.
  </text>
  <text x="40" y="${L.footerRuleY + 96}" font-family="'IBM Plex Sans', sans-serif" font-size="10.8" font-style="italic" fill="#334155">
    Notes: Competitive = paid tier required for sanctioned tournaments. Club-affiliated members only (excludes Unattached; dual-club members may appear under both clubs). Memberships renew each Aug 1.
  </text>
</svg>`;
}

export function downloadSvg(svgMarkup: string, filename: string): void {
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function downloadPng(
  svgMarkup: string,
  filename: string,
  scale = 2,
): Promise<void> {
  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = (e) => reject(e);
      i.src = url;
    });
    const { plateW, plateH } = plateLayout();
    const canvas = document.createElement('canvas');
    canvas.width = plateW * scale;
    canvas.height = plateH * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, plateW, plateH);

    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG export failed'));
          return;
        }
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(dlUrl), 4000);
        resolve();
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
