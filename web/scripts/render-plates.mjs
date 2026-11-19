#!/usr/bin/env node
/**
 * Reproducible static map image renderer for USA Fencing Membership & Club Geography.
 * Mirrors the exact d3-geo Albers USA projection, bubble sizing, palettes, and
 * layout used in the interactive web app's SVG/PNG exporter.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoAlbersUsa, geoCircle, geoPath } from 'd3-geo';
import * as topojson from 'topojson-client';
import {
  FIT_EXTENT,
  MAP_HEIGHT,
  MAP_WIDTH,
  STATE_ABBR_FILL,
  hostStarRadius,
  insetSeparatorPath,
  planMapLabels,
  estimateTextWidth,
  planStateAbbr,
  plateLayout,
} from '../src/mapLayout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const datasetPath = path.join(repoRoot, 'data/derived/dataset.json');
const topoPath = path.join(repoRoot, 'data/reference/geo/states-10m.json');
const outDir = path.join(repoRoot, 'visuals');

fs.mkdirSync(outDir, { recursive: true });

const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
const topo = JSON.parse(fs.readFileSync(topoPath, 'utf-8'));

const FONT_SERIF = "'Source Serif 4', 'Liberation Serif', Georgia, serif";
const FONT_SANS = "'IBM Plex Sans', 'Liberation Sans', 'DejaVu Sans', sans-serif";
const FONT_MONO = "'IBM Plex Mono', 'Liberation Mono', 'DejaVu Sans Mono', monospace";

const MAP_W = MAP_WIDTH;
const MAP_H = MAP_HEIGHT;
const BALANCE_COLORS = { fencers: '#163656', events: '#b42318' };

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function starPath(rOuter, rInner) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(Math.cos(angle) * r).toFixed(2)},${(Math.sin(angle) * r).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function colorForPerCapita(per100k) {
  if (per100k >= 25) return '#0f2e4f';
  if (per100k >= 16) return '#1c4f7a';
  if (per100k >= 10) return '#377aa1';
  if (per100k >= 5) return '#6da0bd';
  return '#a8c2d2';
}

function metroRadius(m, metric) {
  let val = 0;
  let refMax = 5000;
  let maxR = 26;
  if (metric === 'competitive') {
    val = m.competitive;
    refMax = 5000;
    maxR = 26;
  } else if (metric === 'comp_per_100k') {
    val = Math.max(0, m.comp_per_100k);
    refMax = 70;
    maxR = 22;
  }
  if (val <= 0) return 0;
  return Math.max(2.4, Math.sqrt(val / refMax) * maxR);
}

const statesFc = topojson.feature(topo, topo.objects.states);
const nationFc = topojson.feature(topo, topo.objects.nation);
const projection = geoAlbersUsa().fitExtent(FIT_EXTENT, nationFc);
const pathGen = geoPath(projection);

const statesList = statesFc.features.map((f) => ({ id: String(f.id ?? '').padStart(2, '0'), feature: f }));
const stateBounds = (id) => {
  const sf = statesList.find((s) => s.id === id);
  return sf ? pathGen.bounds(sf.feature) : null;
};

function buildMapInner(cfg) {
  const parts = [];
  parts.push(`<rect width="${MAP_W}" height="${MAP_H}" fill="#ffffff"/>`);
  parts.push(
    `<rect x="10" y="10" width="${MAP_W - 20}" height="${MAP_H - 20}" fill="none" stroke="#cbd5e1" stroke-width="1"/>`,
  );

  // States & nation paths
  parts.push(`<path d="${pathGen(nationFc)}" fill="#eef2f6" stroke="#64748b" stroke-width="1.1"/>`);
  parts.push(`<path d="${pathGen(statesFc)}" fill="none" stroke="#cbd5e1" stroke-width="0.75"/>`);
  parts.push(
    `<path d="${insetSeparatorPath(stateBounds)}" fill="none" stroke="#cbd5e1" stroke-dasharray="3 3" stroke-width="0.8"/>`,
  );

  // Metro bubbles actually drawn on this plate (shared obstacle list for label layout)
  const metros = dataset.metros
    .filter((m) => {
      if (m.lat === null || m.lng === null) return false;
      if (cfg.metric === 'comp_per_100k') return (m.pop_2025 ?? 0) >= 250_000 && m.competitive >= 10;
      return m.competitive > 0;
    })
    .map((m) => ({ m, r: metroRadius(m, cfg.metric), pt: projection([m.lng, m.lat]) }))
    .filter((d) => d.pt && d.r > 0)
    .sort((a, b) => b.r - a.r);
  const metroMarkers = metros.map(({ m, r, pt }) => ({ key: m.cbsa_code, x: pt[0], y: pt[1], r }));

  // Collision-free label plan (identical engine to the live web map)
  const placements = planMapLabels({
    dataset,
    cfg: { ...cfg, unit: 'metros' },
    project: (p) => projection(p),
    metroMarkers,
    labelScale: 1,
  });

  // State abbreviations (only where they touch no marker or label)
  const abbrObstacles = metroMarkers.map((mk) => ({ x: mk.x, y: mk.y, r: mk.r + 2 }));
  if (cfg.showHosts) {
    for (const h of dataset.host_cities) {
      const pt = projection([h.lng, h.lat]);
      if (pt) abbrObstacles.push({ x: pt[0], y: pt[1], r: hostStarRadius(h.major_stops) + 2 });
    }
  }
  for (const p of placements) if (p.kind === 'com') abbrObstacles.push({ x: p.x, y: p.y, r: 11 });
  const abbrs = planStateAbbr({
    states: statesList,
    centroid: (f) => pathGen.centroid(f),
    obstacles: abbrObstacles,
    labelBoxes: placements.filter((p) => p.visible).map((p) => p.box),
  });
  for (const a of abbrs) {
    if (!a.visible) continue;
    parts.push(
      `<text x="${a.x.toFixed(1)}" y="${a.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="${STATE_ABBR_FILL}" font-family="${FONT_MONO}" font-size="9" font-weight="600" letter-spacing="0.06em">${a.abbr}</text>`,
    );
  }

  // Optional straight-line rings (beneath every marker and label)
  if (cfg.ringHostKey) {
    const host = dataset.host_cities.find((h) => `${h.city}, ${h.state}` === cfg.ringHostKey);
    if (host) {
      for (const r of [
        { miles: 500, dash: '5 4', fillOpacity: 0.05 },
        { miles: 150, dash: 'none', fillOpacity: 0.09 },
      ]) {
        const circleGeo = geoCircle().center([host.lng, host.lat]).radius(r.miles / 69.047)();
        parts.push(
          `<path d="${pathGen(circleGeo)}" fill="#b42318" fill-opacity="${r.fillOpacity}" stroke="#b42318" stroke-opacity="0.6" stroke-width="1.2" stroke-dasharray="${r.dash}"/>`,
        );
      }
    }
  }

  for (const { m, r, pt } of metros) {
    const fill = cfg.colorMode === 'per_capita' ? colorForPerCapita(m.comp_per_100k) : '#164677';
    parts.push(
      `<circle cx="${pt[0].toFixed(2)}" cy="${pt[1].toFixed(2)}" r="${r.toFixed(2)}" fill="${fill}" fill-opacity="0.72" stroke="#ffffff" stroke-width="0.9"/>`,
    );
  }

  // National Tournament Host Stars
  if (cfg.showHosts) {
    for (const h of dataset.host_cities) {
      const pt = projection([h.lng, h.lat]);
      if (!pt) continue;
      const rOuter = hostStarRadius(h.major_stops);
      parts.push(
        `<g transform="translate(${pt[0].toFixed(2)},${pt[1].toFixed(2)})"><path d="${starPath(rOuter, rOuter * 0.44)}" fill="#d88c28" stroke="#2a1c10" stroke-width="1"/></g>`,
      );
    }
  }

  // Geographic Balance Points (reticles; their labels come from the shared plan)
  if (cfg.showCentersOfMass) {
    const com = dataset.summary.centers_of_mass;
    const pF = projection([com.competitive_fencers.lng, com.competitive_fencers.lat]);
    const pE = projection([com.major_event_stops.lng, com.major_event_stops.lat]);
    if (pF && pE) {
      parts.push(
        `<line x1="${pF[0].toFixed(2)}" y1="${pF[1].toFixed(2)}" x2="${pE[0].toFixed(2)}" y2="${pE[1].toFixed(2)}" stroke="#2b3440" stroke-width="1.2" stroke-dasharray="2.5 2"/>`,
      );
      const reticle = (pt, color) => `
        <g transform="translate(${pt[0].toFixed(2)},${pt[1].toFixed(2)})">
          <circle r="6" fill="#ffffff" fill-opacity="0.88" stroke="${color}" stroke-width="1.6"/>
          <path d="M -9 0 L 9 0 M 0 -9 L 0 9" stroke="${color}" stroke-width="1.2"/>
        </g>`;
      parts.push(reticle(pF, BALANCE_COLORS.fencers));
      parts.push(reticle(pE, BALANCE_COLORS.events));
    }
  }

  // Labels last, so they always sit above dots, stars, and rings
  for (const p of placements) {
    if (!p.visible) continue;
    const style =
      p.kind === 'com'
        ? { fill: BALANCE_COLORS[p.role], leader: BALANCE_COLORS[p.role] }
        : p.kind === 'host'
          ? { fill: '#4f2710', leader: '#6e5232' }
          : { fill: '#142a44', leader: '#3d546d' };
    const leader = p.leader
      ? `<line x1="${p.leader[0][0].toFixed(1)}" y1="${p.leader[0][1].toFixed(1)}" x2="${p.leader[1][0].toFixed(1)}" y2="${p.leader[1][1].toFixed(1)}" stroke="${style.leader}" stroke-width="0.75"/>`
      : '';
    const ls = p.letterSpacingEm ? ` letter-spacing="${p.letterSpacingEm}em"` : '';
    parts.push(`
      <g transform="translate(${p.x.toFixed(2)},${p.y.toFixed(2)})">
        ${leader}
        ${(p.lines ?? [p.text])
          .map((line, i, all) => {
            const y = p.dy + (i - (all.length - 1) / 2) * p.fontSize * 1.12;
            return `<text x="${p.dx.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${p.anchor}" dominant-baseline="central" fill="${style.fill}" font-family="${p.mono ? FONT_MONO : FONT_SANS}" font-size="${p.fontSize}" font-weight="${i === 0 ? 600 : 500}"${ls} paint-order="stroke" stroke="#ffffff" stroke-width="${(p.fontSize * 0.36).toFixed(2)}" stroke-linejoin="round">${esc(line)}</text>`;
          })
          .join('')}
      </g>`);
  }

  return parts.join('\n');
}

function buildPlateSvg(cfg) {
  const L = plateLayout();
  const { plateW, plateH, annexX, annexY, annexW } = L;
  const sum = dataset.summary;
  const mapInner = buildMapInner(cfg);
  const clubPct = Math.round((sum.coverage.geocoded_clubs / sum.tracker_distinct_clubs) * 100);
  const dupCount = sum.duplicate_club_ids_merged.length;
  const gapMiles = sum.centers_of_mass.fencer_to_events_gap_miles;
  const fmtStops = (n) => `${n} stop${n === 1 ? '' : 's'}`;
  const stopCounts = dataset.host_cities.map((h) => h.major_stops);
  const lo = Math.min(...stopCounts);
  const hi = Math.max(...stopCounts);
  const stopsRange = lo === hi ? String(hi) : `${lo}–${hi}`;
  const seasonStageLabel = (d) => {
    const m = Number(d.split('-')[1]);
    if (m >= 8 && m <= 10) return 'EARLY SEASON · RENEWS AUG 1';
    if (m === 6 || m === 7) return 'LATE SEASON · RENEWS AUG 1';
    return 'MID-SEASON · RENEWS AUG 1';
  };


  const annexRows =
    cfg.metric === 'comp_per_100k'
      ? [...dataset.metros]
          .filter((m) => (m.pop_2025 ?? 0) >= 250_000 && m.competitive >= 10)
          .sort((a, b) => b.comp_per_100k - a.comp_per_100k)
          .slice(0, 10)
          .map((m) => ({
            label: m.display_name,
            c1: m.comp_per_100k.toFixed(1),
            c2: m.competitive.toLocaleString(),
          }))
      : [...dataset.metros]
          .sort((a, b) => b.competitive - a.competitive)
          .slice(0, 10)
          .map((m) => ({
            label: m.display_name,
            c1: m.competitive.toLocaleString(),
            c2: m.major_stops_hosted > 0 ? fmtStops(m.major_stops_hosted) : '—',
          }));

  const annexTitle =
    cfg.metric === 'comp_per_100k'
      ? 'TOP METROS PER 100,000 RESIDENTS (250K+ POP)'
      : 'TOP 10 METROS · COMPETITIVE FENCERS';
  const c1Head = cfg.metric === 'comp_per_100k' ? '/100,000' : 'COMPETITIVE';
  const c2Head = cfg.metric === 'comp_per_100k' ? 'COMPETITIVE' : 'STOPS';

  const c2Width = Math.max(
    estimateTextWidth(c2Head, 9.5, true),
    ...annexRows.map((r) => estimateTextWidth(r.c2, 12, true)),
  );
  const c1Right = annexX + annexW - 12 - Math.max(90, c2Width + 26);

  const annexRowsSvg = annexRows
    .map((r, i) => {
      const ry = L.firstRowBaseline + i * L.rowH;
      const stripe =
        i % 2 === 1
          ? `<rect x="${annexX + 1}" y="${ry - 21}" width="${annexW - 2}" height="${L.rowH}" fill="#f8fafc"/>`
          : '';
      return `${stripe}
        <text x="${annexX + 10}" y="${ry}" font-family="${FONT_MONO}" font-size="11" fill="#6b7280">${String(i + 1).padStart(2, '0')}</text>
        <text x="${annexX + 34}" y="${ry}" font-family="${FONT_SANS}" font-size="12.5" font-weight="500" fill="#0f172a">${esc(r.label)}</text>
        <text x="${c1Right}" y="${ry}" text-anchor="end" font-family="${FONT_MONO}" font-size="12" font-weight="600" fill="#0f2e4f">${esc(r.c1)}</text>
        <text x="${annexX + annexW - 12}" y="${ry}" text-anchor="end" font-family="${FONT_MONO}" font-size="12" fill="#7a3e1c">${esc(r.c2)}</text>
        <line x1="${annexX}" y1="${ry + L.rowH - 21}" x2="${annexX + annexW}" y2="${ry + L.rowH - 21}" stroke="#e2e8f0" stroke-width="0.7"/>`;
    })
    .join('\n');

  const kpiY = L.kpiY;
  const kpis = [
    { k: 'COMPETITIVE FENCERS', v: sum.totals.competitive.toLocaleString(), s: `${sum.totals.comp_share_pct.toFixed(1)}% of club members` },
    { k: 'NON-COMPETITIVE', v: sum.totals.non_competitive.toLocaleString(), s: 'Trials, Access & other tiers' },
    { k: 'MAPPED COMPETITIVE', v: `${sum.coverage.geocoded_competitive_pct.toFixed(1)}%`, s: `${sum.coverage.geocoded_clubs} of ${sum.tracker_distinct_clubs} clubs (${clubPct}%)` },
    { k: 'BALANCE-POINT GAP', v: gapMiles !== null ? `${gapMiles} mi` : '—', s: 'Fencers vs. hosts (not avg travel)' },
  ];
  const kpiSvg = kpis
    .map((item, idx) => {
      const bx = annexX + (idx % 2) * 212;
      const by = kpiY + Math.floor(idx / 2) * (L.kpiH + L.kpiGap);
      return `
        <rect x="${bx}" y="${by}" width="202" height="${L.kpiH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>
        <text x="${bx + 12}" y="${by + 22}" font-family="${FONT_MONO}" font-size="9" font-weight="600" fill="#475569" letter-spacing="0.05em">${esc(item.k)}</text>
        <text x="${bx + 12}" y="${by + Math.round(L.kpiH * 0.56)}" font-family="${FONT_MONO}" font-size="23" font-weight="600" fill="#0f2e4f">${esc(item.v)}</text>
        <text x="${bx + 12}" y="${by + L.kpiH - 16}" font-family="${FONT_SANS}" font-size="10" fill="#475569">${esc(item.s)}</text>`;
    })
    .join('\n');

  // Legend
  const lx = 40;
  const ly = L.legendY;
  const samples =
    cfg.metric === 'comp_per_100k'
      ? [
          { label: '10', r: 8.3 },
          { label: '30', r: 14.4 },
          { label: '65', r: 21.2 },
        ]
      : [
          { label: '250', r: 5.8 },
          { label: '1,000', r: 11.6 },
          { label: '4,500', r: 24.7 },
        ];
  const legendParts = [];
  legendParts.push(
    `<text x="${lx}" y="${ly}" font-family="${FONT_MONO}" font-size="10" font-weight="600" fill="#334155" letter-spacing="0.06em">${cfg.metric === 'comp_per_100k' ? 'CIRCLE SIZE = FENCERS PER 100,000 RESIDENTS' : 'CIRCLE SIZE = COMPETITIVE FENCERS PER METRO'}</text>`,
  );
  let cx = lx + 16;
  const baseline = ly + 54;
  for (const s of samples) {
    cx += s.r;
    legendParts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${(baseline - s.r).toFixed(1)}" r="${s.r.toFixed(1)}" fill="#164677" fill-opacity="0.65" stroke="#163656" stroke-width="1"/>`,
    );
    legendParts.push(
      `<text x="${cx.toFixed(1)}" y="${baseline + 14}" text-anchor="middle" font-family="${FONT_MONO}" font-size="10" fill="#0f172a">${esc(s.label)}</text>`,
    );
    cx += s.r + 22;
  }

  const colX = lx + 335;
  if (cfg.colorMode === 'per_capita') {
    legendParts.push(
      `<text x="${colX}" y="${ly}" font-family="${FONT_MONO}" font-size="10" font-weight="600" fill="#334155" letter-spacing="0.06em">COMPETITIVE FENCERS PER 100,000 RESIDENTS</text>`,
    );
    const stops = [
      { label: '<5', c: colorForPerCapita(3) },
      { label: '5–10', c: colorForPerCapita(7) },
      { label: '10–16', c: colorForPerCapita(12) },
      { label: '16–25', c: colorForPerCapita(20) },
      { label: '25+', c: colorForPerCapita(30) },
    ];
    stops.forEach((st, i) => {
      const bx = colX + i * 54;
      legendParts.push(`<rect x="${bx}" y="${ly + 18}" width="50" height="14" fill="${st.c}" stroke="#ffffff" stroke-width="1"/>`);
      legendParts.push(`<text x="${bx + 25}" y="${ly + 46}" text-anchor="middle" font-family="${FONT_MONO}" font-size="9.5" fill="#0f172a">${esc(st.label)}</text>`);
    });
  } else if (cfg.showHosts) {
    legendParts.push(
      `<text x="${colX}" y="${ly}" font-family="${FONT_MONO}" font-size="10" font-weight="600" fill="#334155" letter-spacing="0.06em">NATIONAL TOURNAMENT HOST CITIES (2021–22 TO 2026–27)</text>`,
    );
    legendParts.push(
      `<g transform="translate(${colX + 10},${ly + 26})"><path d="${starPath(7.5, 3.3)}" fill="#d88c28" stroke="#2a1c10" stroke-width="1"/></g>`,
    );
    legendParts.push(
      `<text x="${colX + 24}" y="${ly + 30}" font-family="${FONT_SANS}" font-size="11.5" fill="#0f172a">North American Cup (NAC), Junior Olympics (JO), or Summer Nationals (${stopsRange} hosted &amp; scheduled stops)</text>`,
    );
    if (gapMiles !== null) {
      legendParts.push(
        `<g transform="translate(${colX + 10},${ly + 50})"><circle r="5" fill="#ffffff" stroke="#163656" stroke-width="1.4"/><path d="M-7 0H7M0 -7V7" stroke="#163656" stroke-width="1.1"/></g>`,
      );
      legendParts.push(
        `<text x="${colX + 24}" y="${ly + 54}" font-family="${FONT_SANS}" font-size="11.5" fill="#0f172a">Geographic balance points: where fencers vs. event stops balance on the map (${gapMiles} mi apart — not avg travel)</text>`,
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${plateW}" height="${plateH}" viewBox="0 0 ${plateW} ${plateH}">
  <rect width="${plateW}" height="${plateH}" fill="#ffffff"/>
  <rect x="20" y="20" width="${plateW - 40}" height="${plateH - 40}" fill="none" stroke="#cbd5e1" stroke-width="1.2"/>

  <!-- Geometric Emblem (visual atlas accent) -->
  <g transform="translate(62,64)" opacity="0.9">
    <circle r="24" fill="#ffffff" stroke="#12355b" stroke-width="1.5"/>
    <circle r="20" fill="none" stroke="#12355b" stroke-width="0.7" stroke-dasharray="2 1.5"/>
    <line x1="-10" y1="8" x2="10" y2="-10" stroke="#12355b" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="10" y1="8" x2="-10" y2="-10" stroke="#12355b" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="-7.5" cy="5.5" r="2.2" fill="#ffffff" stroke="#12355b" stroke-width="1"/>
    <circle cx="7.5" cy="5.5" r="2.2" fill="#ffffff" stroke="#12355b" stroke-width="1"/>
    <rect x="-7" y="10" width="3" height="5" fill="#b42318"/>
    <rect x="-2" y="7" width="3" height="8" fill="#12355b"/>
    <rect x="3" y="4" width="3" height="11" fill="#12355b"/>
  </g>

  <text x="100" y="50" font-family="${FONT_MONO}" font-size="10.5" font-weight="600" fill="#334155" letter-spacing="0.11em">USA FENCING MEMBERSHIP &amp; CLUB GEOGRAPHY · INDEPENDENT / UNOFFICIAL</text>
  <text x="100" y="79" font-family="${FONT_SERIF}" font-size="24" font-weight="700" fill="#0b223d">${esc(cfg.title)}</text>
  <text x="100" y="102" font-family="${FONT_SANS}" font-size="12.8" fill="#334155">${esc(cfg.subtitle)}</text>

  <g transform="translate(1390, 44)">
    <rect width="170" height="44" fill="#ffffff" stroke="#b42318" stroke-width="1.2" stroke-dasharray="3 1.5"/>
    <text x="85" y="18" text-anchor="middle" font-family="${FONT_MONO}" font-size="9.5" font-weight="600" fill="#b42318" letter-spacing="0.06em">DATA AS OF ${esc(sum.snapshot_date)}</text>
    <text x="85" y="34" text-anchor="middle" font-family="${FONT_MONO}" font-size="8.7" fill="#7f1d1d">${esc(seasonStageLabel(sum.snapshot_date))}</text>
  </g>
  <line x1="36" y1="116" x2="${plateW - 36}" y2="116" stroke="#12355b" stroke-width="2"/>

  <svg x="${L.mapX}" y="${L.mapY}" width="${L.mapW}" height="${L.mapH}" viewBox="0 0 ${MAP_W} ${MAP_H}">
    ${mapInner}
  </svg>

  <rect x="${annexX}" y="${annexY}" width="${annexW}" height="${L.tableH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>
  <rect x="${annexX}" y="${annexY}" width="${annexW}" height="34" fill="#12355b"/>
  <text x="${annexX + 12}" y="${annexY + 21}" font-family="${FONT_MONO}" font-size="10.2" font-weight="600" fill="#ffffff" letter-spacing="0.05em">${esc(annexTitle)}</text>
  <text x="${c1Right}" y="${annexY + 47}" text-anchor="end" font-family="${FONT_MONO}" font-size="9.5" font-weight="600" fill="#334155">${esc(c1Head)}</text>
  <text x="${annexX + annexW - 12}" y="${annexY + 47}" text-anchor="end" font-family="${FONT_MONO}" font-size="9.5" font-weight="600" fill="#334155">${esc(c2Head)}</text>
  <line x1="${annexX}" y1="${annexY + 53}" x2="${annexX + annexW}" y2="${annexY + 53}" stroke="#94a3b8" stroke-width="1"/>
  ${annexRowsSvg}
  ${kpiSvg}

  <line x1="36" y1="${L.legendRuleY}" x2="${plateW - 36}" y2="${L.legendRuleY}" stroke="#cbd5e1" stroke-width="1"/>
  ${legendParts.join('\n')}

  <line x1="36" y1="${L.footerRuleY}" x2="${plateW - 36}" y2="${L.footerRuleY}" stroke="#94a3b8" stroke-width="1.2"/>
  <text x="40" y="${L.footerRuleY + 20}" font-family="${FONT_MONO}" font-size="10.5" font-weight="600" fill="#12355b" letter-spacing="0.06em">DATA SOURCES &amp; NOTES</text>
  <text x="40" y="${L.footerRuleY + 40}" font-family="${FONT_SANS}" font-size="11.2" fill="#1e293b">Club counts: FencingTracker (independent tracker aggregating USA Fencing public rosters), data as of ${esc(sum.snapshot_date)} (${sum.tracker_distinct_clubs.toLocaleString()} clubs; ${dupCount} duplicate IDs merged).</text>
  <text x="40" y="${L.footerRuleY + 58}" font-family="${FONT_SANS}" font-size="11.2" fill="#1e293b">Locations &amp; demographics: USA Fencing Club Directory + public-domain club archive + club websites (${sum.coverage.geocoded_clubs} of ${sum.tracker_distinct_clubs} clubs, holding ${sum.coverage.geocoded_competitive_pct.toFixed(1)}% of U.S.-based competitive fencers); U.S. Census 2025 Pop. Estimates &amp; 2024 Median Household Income.</text>
  <text x="40" y="${L.footerRuleY + 76}" font-family="${FONT_SANS}" font-size="11.2" fill="#1e293b">National events: USA Fencing calendars, ${esc(sum.national_events.seasons)} seasons (${sum.national_events.major_stops} hosted &amp; scheduled North American Cup / Junior Olympics / Summer Nationals stops in ${sum.national_events.host_cities} cities). Independent project; not affiliated with USA Fencing or U.S. Census.</text>
  <text x="40" y="${L.footerRuleY + 96}" font-family="${FONT_SANS}" font-size="10.8" font-style="italic" fill="#334155">Notes: Competitive = paid tier required for sanctioned tournaments. Club-affiliated members only (excludes Unattached; dual-club members may appear under both clubs). Memberships renew each Aug 1.</text>
</svg>`;
}

const sum = dataset.summary;
const PLATES = [
  {
    slug: 'usaf_fencers_and_hosts',
    title: 'Competitive Fencers by Metro Area & National Tournament Hosts',
    subtitle: `Paid competitive club members grouped by U.S. Census metro area · ${sum.national_events.major_stops} hosted & scheduled national stops (North American Cup, Junior Olympics, Summer Nationals, ${sum.national_events.seasons} seasons) in ${sum.national_events.host_cities} cities`,
    metric: 'competitive',
    colorMode: 'solid',
    showHosts: true,
    showCentersOfMass: true,
    showHostLabels: true,
    showMetroLabels: true,
    ringHostKey: null,
  },
  {
    slug: 'usaf_fencers_per_100k',
    title: 'Competitive Fencers per 100,000 Residents by Metro Area',
    subtitle: 'U.S. metros with 250,000+ residents (2025 U.S. Census estimate) and 10+ competitive fencers · Adjusts club counts for metro population size',
    metric: 'comp_per_100k',
    colorMode: 'per_capita',
    showHosts: false,
    showCentersOfMass: false,
    showHostLabels: false,
    showMetroLabels: true,
    ringHostKey: null,
  },
];

function findResvg() {
  const local = path.join(os.homedir(), '.local/bin/resvg');
  if (fs.existsSync(local)) return local;
  return 'resvg';
}

const resvgBin = findResvg();
for (const cfg of PLATES) {
  const svg = buildPlateSvg(cfg);
  const svgPath = path.join(outDir, `${cfg.slug}.svg`);
  const pngPath = path.join(outDir, `${cfg.slug}.png`);
  fs.writeFileSync(svgPath, svg, 'utf-8');
  execFileSync(resvgBin, [svgPath, pngPath, '--width', '2800'], { stdio: 'inherit' });
  console.log(`Rendered ${pngPath}`);
}
