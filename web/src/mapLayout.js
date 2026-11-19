/**
 * Shared map geometry + label placement used by BOTH the live web map (src/map.ts)
 * and the static plate renderer (scripts/render-plates.mjs), so the two never drift.
 *
 * Plain ES module (typed via mapLayout.d.ts) so Node can import it without a build step.
 */

export const MAP_WIDTH = 980;
export const MAP_HEIGHT = 540;

/** Albers USA fit box: width-limited, so the vertical slack is split evenly (~40 top / ~33 bottom). */
export const FIT_EXTENT = [
  [76, 24],
  [872, 524],
];

/** Inner archival frame inset; labels must stay inside it. */
export const FRAME_PAD = 10;

export const STATE_FIPS_ABBR = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
  '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
};

/** Tiny crowded Northeast states: abbreviation only appears once zoomed in. */
export const HIDE_STATE_ABBR_1X = new Set(['CT', 'DE', 'DC', 'MA', 'MD', 'NH', 'NJ', 'RI', 'VT']);

/** State abbreviation styling (muted but legible on phones and projectors). */
export const STATE_ABBR_FILL = '#64748b';

/**
 * Preferred callout offsets [dx, dy, anchor] at 1x. These are only first choices:
 * the layout engine below falls back to other positions (or hides the label until
 * the user zooms in) whenever a preferred spot would collide with another label.
 */
export const HOST_LABEL_OFFSETS = {
  'Salt Lake City, UT': [12, -11, 'start'],
  'Richmond, VA': [44, 10, 'start'],
  'Charlotte, NC': [16, 12, 'start'],
  'Fort Worth, TX': [-14, 16, 'end'],
  'Columbus, OH': [0, -16, 'middle'],
  'San Jose, CA': [-16, 15, 'end'],
  'Portland, OR': [-14, -10, 'end'],
  'Minneapolis, MN': [13, -10, 'start'],
  'Kansas City, MO': [-12, -14, 'end'],
  'St. Louis, MO': [0, 24, 'middle'],
  'Louisville, KY': [0, 22, 'middle', 'stack'],
  'Cincinnati, OH': [-12, -9, 'end'],
  'Cleveland, OH': [14, -14, 'start'],
  'Atlantic City, NJ': [38, 4, 'start'],
  'Orlando, FL': [13, 4, 'start'],
  'Denver, CO': [-13, -9, 'end'],
  'Los Angeles, CA': [-16, 14, 'end'],
  'Phoenix, AZ': [13, 11, 'start'],
  'Milwaukee, WI': [13, -11, 'start'],
  'Oklahoma City, OK': [13, 7, 'start'],
  'Atlanta, GA': [13, 9, 'start'],
};

export const METRO_LABEL_OFFSETS = {
  'New York, NY': [40, -18, 'start'],
  'Boston, MA': [22, -16, 'start'],
  'Washington, DC': [68, 8, 'start'],
  'Philadelphia, PA': [54, -13, 'start'],
  'San Francisco, CA': [-20, -14, 'end'],
  'San Jose, CA': [-20, 14, 'end'],
  'Los Angeles, CA': [-24, 12, 'end'],
  'San Diego, CA': [-14, 16, 'end'],
  'Seattle, WA': [16, -8, 'start'],
  'Chicago, IL': [-16, -12, 'end'],
  'Houston, TX': [16, 12, 'start'],
  'Dallas, TX': [16, -10, 'start'],
  'Austin, TX': [-16, 10, 'end'],
  'Atlanta, GA': [16, 6, 'start'],
  'Detroit, MI': [-14, -14, 'end'],
  'Miami, FL': [-14, 8, 'end'],
  'Phoenix, AZ': [14, 8, 'start'],
  'Minneapolis, MN': [14, -8, 'start'],
  'Denver, CO': [14, -8, 'start'],
  'Riverside, CA': [14, -4, 'start'],
  'Indianapolis, IN': [-14, -12, 'end'],
  'Cincinnati, OH': [14, 12, 'start'],
  'St. Louis, MO': [-14, 14, 'end'],
  'Portland, OR': [-14, -8, 'end'],
  'Salt Lake City, UT': [14, -8, 'start'],
  'Raleigh, NC': [14, 8, 'start'],
  'Boulder, CO': [-14, -10, 'end'],
  'Bridgeport, CT': [44, -6, 'start'],
  'Trenton, NJ': [46, 2, 'start'],
  'Hartford, CT': [38, -22, 'start'],
  'Ann Arbor, MI': [-14, 12, 'end'],
};

export const LABEL_FONT_SIZE = 9.5;
export const BALANCE_FONT_SIZE = 8.5;

// ---------------------------------------------------------------------------
// Text metrics (deterministic estimate so browser + Node layouts are identical)
// ---------------------------------------------------------------------------

const NARROW = new Set(['i', 'l', 'j', 't', 'f', 'r', 'I', '.', ',', ':', ';', '(', ')', "'", '|', '!']);

/** Approximate rendered width of IBM Plex Sans SemiBold (or Plex Mono) text. Slightly generous on purpose. */
export function estimateTextWidth(text, fontSize, mono = false, letterSpacingEm = 0) {
  if (mono) return text.length * fontSize * (0.6 + letterSpacingEm);
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.27;
    else if (NARROW.has(ch)) em += 0.31;
    else if (/[0-9]/.test(ch)) em += 0.58;
    else if (ch === '×') em += 0.58;
    else if (/[MW]/.test(ch)) em += 0.86;
    else if (/[A-Z]/.test(ch)) em += 0.66;
    else if (/[mw]/.test(ch)) em += 0.82;
    else em += 0.55;
  }
  return em * fontSize * 1.03;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function boxFor(x, y, dx, dy, anchor, w, h) {
  const left = anchor === 'start' ? x + dx : anchor === 'end' ? x + dx - w : x + dx - w / 2;
  return { x0: left, y0: y + dy - h / 2, x1: left + w, y1: y + dy + h / 2 };
}

function padBox(b, p) {
  return { x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p };
}

function boxesOverlap(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function distPointToBox(px, py, b) {
  const cx = Math.max(b.x0, Math.min(px, b.x1));
  const cy = Math.max(b.y0, Math.min(py, b.y1));
  return Math.hypot(px - cx, py - cy);
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentHitsBox(a, b, box) {
  const inside = (p) => p[0] > box.x0 && p[0] < box.x1 && p[1] > box.y0 && p[1] < box.y1;
  if (inside(a) || inside(b)) return true;
  const c = [
    [box.x0, box.y0],
    [box.x1, box.y0],
    [box.x1, box.y1],
    [box.x0, box.y1],
  ];
  for (let i = 0; i < 4; i++) {
    if (segmentsIntersect(a, b, c[i], c[(i + 1) % 4])) return true;
  }
  return false;
}

/** Leader from the marker edge to the nearest point of the label box (absolute coords), or null if the label hugs its marker. */
function leaderFor(x, y, markerR, box) {
  const nx = Math.max(box.x0, Math.min(x, box.x1));
  const ny = Math.max(box.y0, Math.min(y, box.y1));
  const dist = Math.hypot(nx - x, ny - y);
  if (dist <= markerR + 7) return null;
  const ux = (nx - x) / dist;
  const uy = (ny - y) / dist;
  const start = [x + ux * (markerR + 1.5), y + uy * (markerR + 1.5)];
  const end = [nx - ux * 2, ny - uy * 2];
  return [start, end];
}

function candidateOffsets(markerR, h, preferred, scale, maxRing = 2) {
  const out = [];
  if (preferred) {
    out.push({ dx: preferred[0] * scale, dy: preferred[1] * scale, anchor: preferred[2], cost: 0 });
  }
  const angles = [0, 180, -35, 35, -145, 145, -90, 90, -60, 60, -120, 120];
  const rings = [markerR + 4.5, markerR + 16 * scale, markerR + 30 * scale].slice(0, maxRing + 1);
  rings.forEach((d, ri) => {
    angles.forEach((deg, ai) => {
      const rad = (deg * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const px = d * c;
      const py = d * s;
      const anchor = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle';
      const dy = s < -0.3 ? py - h / 2 : s > 0.3 ? py + h / 2 : py;
      out.push({ dx: px, dy, anchor, cost: 3 + ri * 5 + ai * 0.4 });
    });
  });
  return out;
}

/**
 * Greedy priority-ordered label placement with 2D bounding-box collision avoidance.
 *
 * @param {object} opts
 * @param {Array} opts.requests  [{ id, x, y, text, fontSize, mono?, letterSpacingEm?, markerR, preferred?, scale? }] in priority order
 * @param {Array} opts.obstacles [{ x, y, r, owner?, hard? }] map markers (soft: labels avoid them; hard: never covered)
 * @param {Array} [opts.reserved] [{ x0, y0, x1, y1 }] hard no-go rectangles (e.g. on-map buttons)
 * @param {object} opts.bounds   { x0, y0, x1, y1 }
 * @returns {Array} placements in request order: { ...request, dx, dy, anchor, visible, leader, box }
 */
export function layoutLabels({ requests, obstacles, reserved = [], bounds }) {
  // Greedy pass, then a few repair passes: any label that had to hide is promoted ahead of
  // its neighbours and the layout re-run, keeping the result only if fewer labels hide.
  let order = requests.slice();
  let best = greedyLayout(order, obstacles, reserved, bounds);
  for (let iter = 0; iter < 6; iter++) {
    const hidden = best.filter((r) => !r.visible);
    if (hidden.length === 0) break;
    const hiddenIds = new Set(hidden.map((r) => r.id));
    const fixed = order.filter((r) => r.kind === 'com');
    order = [
      ...fixed,
      ...order.filter((r) => r.kind !== 'com' && hiddenIds.has(r.id)),
      ...order.filter((r) => r.kind !== 'com' && !hiddenIds.has(r.id)),
    ];
    const trial = greedyLayout(order, obstacles, reserved, bounds);
    const trialHidden = trial.filter((r) => !r.visible).length;
    if (trialHidden < hidden.length) best = trial;
    else break;
  }
  const byId = new Map(best.map((r) => [r.id, r]));
  return requests.map((r) => byId.get(r.id));
}

function greedyLayout(requests, obstacles, reserved, bounds) {
  const placedBoxes = [];
  const placedLeaders = [];
  const results = [];

  for (const req of requests) {
    const scale = req.scale ?? 1;
    const ls = req.letterSpacingEm ?? 0;
    // Variant 1: single line. Variant 2 (only if offered): compact two-line stack, used when crowded.
    const variants = [
      {
        lines: null,
        w: estimateTextWidth(req.text, req.fontSize, !!req.mono, ls),
        h: req.fontSize * 1.18,
        extra: 0,
      },
    ];
    if (req.stackLines) {
      variants.push({
        lines: req.stackLines,
        w: Math.max(...req.stackLines.map((t) => estimateTextWidth(t, req.fontSize, !!req.mono, ls))),
        h: req.fontSize * 1.12 * req.stackLines.length + 1,
        extra: 2.5,
      });
    }
    const cands = [];
    for (const v of variants) {
      const wantsStack = req.preferred && req.preferred[3] === 'stack';
      const pref = req.preferred && (v.lines ? wantsStack : !wantsStack) ? req.preferred : null;
      for (const c of candidateOffsets(req.markerR, v.h, pref, scale, req.maxRing ?? 2)) {
        cands.push({ ...c, cost: c.cost === 0 ? 0 : c.cost + v.extra, w: v.w, h: v.h, lines: v.lines });
      }
    }

    let best = null;
    for (const cand of cands) {
      const { w, h } = cand;
      const box = boxFor(req.x, req.y, cand.dx, cand.dy, cand.anchor, w, h);
      const halo = padBox(box, 1.6);
      if (halo.x0 < bounds.x0 || halo.y0 < bounds.y0 || halo.x1 > bounds.x1 || halo.y1 > bounds.y1) continue;
      if (reserved.some((r) => boxesOverlap(halo, r))) continue;
      if (placedBoxes.some((b) => boxesOverlap(halo, b))) continue;
      if (placedLeaders.some(([a, b]) => segmentHitsBox(a, b, halo))) continue;
      const leader = leaderFor(req.x, req.y, req.markerR, box);
      if (leader && placedBoxes.some((b) => segmentHitsBox(leader[0], leader[1], b))) continue;
      // Hard markers (host stars, balance reticles) are never covered by any label text.
      if (obstacles.some((o) => o.hard && distPointToBox(o.x, o.y, halo) < o.r * 0.9)) continue;

      // Association: a leaderless host label must clearly belong to its own star — never nearer
      // (or nearly as near) to a neighbouring host star than to its own. A leader line makes the
      // link explicit, so it is exempt.
      const ownDist = distPointToBox(req.x, req.y, halo) + req.markerR * 0.5;
      if (
        req.kind === 'host' &&
        !leader &&
        obstacles.some(
          (o) =>
            o.hard &&
            o.owner !== req.id &&
            o.owner?.startsWith('host:') &&
            ownDist > 0.7 * (distPointToBox(o.x, o.y, halo) + o.r * 0.5),
        )
      ) {
        continue;
      }
      let cost = cand.cost;
      for (const o of obstacles) {
        if (o.hard) continue;
        const dist = distPointToBox(o.x, o.y, halo);
        const depth = o.r - dist;
        if (depth <= 0) continue;
        const own = o.owner !== undefined && o.owner === req.id;
        cost += Math.min(depth, o.r) * (own ? 6 : o.r < 4 ? 0.5 : o.r < 8 ? 1.4 : 2.4);
      }
      if (leader) cost += 0.6;
      if (!best || cost < best.cost) best = { ...cand, cost, box, leader };
      if (cand.cost === 0 && cost === 0) break; // preferred spot is perfectly clean
    }

    if (best) {
      placedBoxes.push(padBox(best.box, 1.2));
      if (best.leader) placedLeaders.push(best.leader);
      results.push({
        ...req,
        dx: best.dx,
        dy: best.dy,
        anchor: best.anchor,
        visible: true,
        lines: best.lines,
        box: best.box,
        leader: best.leader
          ? [
              [best.leader[0][0] - req.x, best.leader[0][1] - req.y],
              [best.leader[1][0] - req.x, best.leader[1][1] - req.y],
            ]
          : null,
      });
    } else {
      // No clean spot at 1x: yield (hidden until zoomed in) instead of garbling neighbours.
      const fb = cands[0];
      const box = boxFor(req.x, req.y, fb.dx, fb.dy, fb.anchor, fb.w, fb.h);
      const leader = leaderFor(req.x, req.y, req.markerR, box);
      results.push({
        ...req,
        dx: fb.dx,
        dy: fb.dy,
        anchor: fb.anchor,
        visible: false,
        lines: null,
        box,
        leader: leader
          ? [
              [leader[0][0] - req.x, leader[0][1] - req.y],
              [leader[1][0] - req.x, leader[1][1] - req.y],
            ]
          : null,
      });
    }
  }
  return results;
}

/** Host-star outer radius, shared by the live map and plates. */
export function hostStarRadius(majorStops) {
  return 5.4 + majorStops * 0.95;
}

/**
 * Plan every map callout (balance points, host cities, top metros) in one pass.
 *
 * @param {object} p
 * @param {object} p.dataset          dataset bundle (metros, host_cities, summary)
 * @param {object} p.cfg              { unit, metric, showHosts, showHostLabels, showMetroLabels, showCentersOfMass }
 * @param {Function} p.project        ([lng, lat]) => [x, y] | null
 * @param {Array} p.metroMarkers      [{ key: cbsa_code, x, y, r }] metros actually drawn
 * @param {number} [p.labelScale]     >1 enlarges labels for narrow screens
 * @param {Array} [p.reserved]        hard no-go rectangles
 */
export function planMapLabels({ dataset, cfg, project, metroMarkers, labelScale = 1, reserved = [] }) {
  const requests = [];
  // Narrow screens (enlarged labels): only labels that hug their marker; the rest appear on zoom.
  const compact = labelScale > 1.25;
  const compactOpts = (kind) =>
    compact ? { maxRing: kind === 'com' ? 1 : 0, preferred: null } : {};
  const obstacles = [];

  for (const mk of metroMarkers) {
    obstacles.push({ x: mk.x, y: mk.y, r: mk.r, owner: `metro:${mk.key}` });
  }

  const hostPts = [];
  if (cfg.showHosts) {
    for (const h of dataset.host_cities) {
      const pt = project([h.lng, h.lat]);
      if (!pt) continue;
      const r = hostStarRadius(h.major_stops);
      hostPts.push({ h, pt, r });
      obstacles.push({ x: pt[0], y: pt[1], r, owner: `host:${h.city}, ${h.state}`, hard: true });
    }
  }

  // 1. Geographic balance points (highest priority — two fixed reticles)
  if (cfg.showCentersOfMass) {
    const com = dataset.summary.centers_of_mass;
    if (com.competitive_fencers && com.major_event_stops) {
      const pF = project([com.competitive_fencers.lng, com.competitive_fencers.lat]);
      const pE = project([com.major_event_stops.lng, com.major_event_stops.lat]);
      if (pF && pE) {
        obstacles.push({ x: pF[0], y: pF[1], r: 9, owner: 'com:fencers', hard: true });
        obstacles.push({ x: pE[0], y: pE[1], r: 9, owner: 'com:events', hard: true });
        // Put each label on the side facing away from the other reticle.
        const fencersEast = pF[0] >= pE[0];
        requests.push({
          id: 'com:fencers',
          kind: 'com',
          role: 'fencers',
          x: pF[0],
          y: pF[1],
          text: 'FENCERS BALANCE POINT',
          fontSize: BALANCE_FONT_SIZE * labelScale,
          mono: true,
          letterSpacingEm: 0.02,
          markerR: 9,
          scale: labelScale,
          preferred: fencersEast ? [12, -12, 'start'] : [-12, -12, 'end'],
          ...compactOpts('com'),
        });
        requests.push({
          id: 'com:events',
          kind: 'com',
          role: 'events',
          x: pE[0],
          y: pE[1],
          text: 'EVENTS BALANCE POINT',
          fontSize: BALANCE_FONT_SIZE * labelScale,
          mono: true,
          letterSpacingEm: 0.02,
          markerR: 9,
          scale: labelScale,
          preferred: fencersEast ? [-10, 16, 'end'] : [10, 16, 'start'],
          ...compactOpts('com'),
        });
      }
    }
  }

  // 2. Host city labels (more stops = higher priority)
  if (cfg.showHosts && cfg.showHostLabels) {
    const sorted = [...hostPts].sort((a, b) => b.h.major_stops - a.h.major_stops || a.h.city.localeCompare(b.h.city));
    for (const { h, pt, r } of sorted) {
      const key = `${h.city}, ${h.state}`;
      requests.push({
        id: `host:${key}`,
        kind: 'host',
        x: pt[0],
        y: pt[1],
        text: `${h.city} · ${h.major_stops} stop${h.major_stops === 1 ? '' : 's'}`,
        stackLines: [h.city, `${h.major_stops} stop${h.major_stops === 1 ? '' : 's'}`],
        fontSize: LABEL_FONT_SIZE * labelScale,
        markerR: r,
        scale: labelScale,
        preferred: HOST_LABEL_OFFSETS[key] ?? null,
        ...compactOpts('host'),
      });
    }
  }

  // 3. Top metro callouts (skip metros whose city already carries a host label)
  if (cfg.unit === 'metros' && cfg.showMetroLabels) {
    const hostCityNames = new Set(
      cfg.showHosts && cfg.showHostLabels ? dataset.host_cities.map((h) => h.city.toLowerCase()) : [],
    );
    const drawn = new Map(metroMarkers.map((mk) => [mk.key, mk]));
    const valueOf = (m) =>
      cfg.metric === 'comp_per_100k'
        ? m.comp_per_100k
        : cfg.metric === 'total'
          ? m.total
          : cfg.metric === 'non_competitive'
            ? m.non_competitive
            : m.competitive;
    const topMetros =
      cfg.metric === 'comp_per_100k'
        ? dataset.metros
            .filter((m) => (m.pop_2025 ?? 0) >= 500_000 && m.competitive >= 50)
            .sort((a, b) => b.comp_per_100k - a.comp_per_100k)
            .slice(0, 14)
        : dataset.metros
            .filter((m) => m.competitive >= 500)
            .sort((a, b) => valueOf(b) - valueOf(a))
            .slice(0, 14);

    for (const m of topMetros) {
      const mk = drawn.get(m.cbsa_code);
      if (!mk) continue;
      const shortCity = m.display_name.split(',')[0];
      if (hostCityNames.has(shortCity.toLowerCase())) continue;
      const v = valueOf(m);
      const valText = cfg.metric === 'comp_per_100k' ? v.toFixed(1) : Math.round(v).toLocaleString('en-US');
      requests.push({
        id: `metro:${m.cbsa_code}`,
        kind: 'metro',
        x: mk.x,
        y: mk.y,
        text: `${shortCity} (${valText})`,
        fontSize: LABEL_FONT_SIZE * labelScale,
        markerR: mk.r,
        scale: labelScale,
        preferred: METRO_LABEL_OFFSETS[m.display_name] ?? null,
        ...compactOpts('metro'),
      });
    }
  }

  const inset = FRAME_PAD + 3;
  return layoutLabels({
    requests,
    obstacles,
    reserved,
    bounds: { x0: inset, y0: inset, x1: MAP_WIDTH - inset, y1: MAP_HEIGHT - inset },
  });
}

/**
 * Decide which state abbreviations show at 1x: skip any that would touch a marker or a placed label.
 * @returns {Array<{ abbr, x, y, visible }>}
 */
export function planStateAbbr({ states, centroid, obstacles, labelBoxes, fontSize = 9 }) {
  const out = [];
  for (const sf of states) {
    const abbr = STATE_FIPS_ABBR[sf.id];
    if (!abbr) continue;
    const c = centroid(sf.feature);
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const w = estimateTextWidth(abbr, fontSize, true, 0.06);
    const box = padBox(boxFor(c[0], c[1], 0, 0, 'middle', w, fontSize * 1.1), 2);
    const hitsMarker = obstacles.some((o) => distPointToBox(o.x, o.y, box) < o.r);
    const hitsLabel = labelBoxes.some((b) => boxesOverlap(box, b));
    out.push({ abbr, x: c[0], y: c[1], visible: !HIDE_STATE_ABBR_1X.has(abbr) && !hitsMarker && !hitsLabel });
  }
  return out;
}

/** Dashed separator ticks framing the Alaska & Hawaii insets, computed from their projected bounds. */
export function insetSeparatorPath(bounds) {
  const ak = bounds('02');
  const hi = bounds('15');
  if (!ak || !hi) return '';
  const sepX = (ak[1][0] + hi[0][0]) / 2;
  const top = Math.min(ak[0][1], hi[0][1]) - 6;
  const bottom = Math.max(ak[1][1], hi[1][1]) + 6;
  const hiTop = hi[0][1] - 10;
  const hiRight = hi[1][0] + 10;
  const f = (n) => n.toFixed(1);
  return `M ${f(sepX)} ${f(top)} L ${f(sepX)} ${f(bottom)} M ${f(sepX)} ${f(hiTop)} L ${f(hiRight)} ${f(hiTop)} L ${f(hiRight)} ${f(bottom)}`;
}

/**
 * Geometry for the 1600px-wide export / static plate. Everything below the map is derived
 * from the map's height, and the right-hand table + KPI cards are sized to end flush with
 * the map so neither column leaves a blank void.
 */
export function plateLayout(rowCount = 10) {
  const plateW = 1600;
  const mapX = 36;
  const mapY = 128;
  const mapW = 1086;
  const mapH = Math.round((mapW * MAP_HEIGHT) / MAP_WIDTH);
  const mapBottom = mapY + mapH;

  const annexX = 1145;
  const annexY = mapY;
  const annexW = 415;
  const rowH = 32;
  const firstRowBaseline = annexY + 77;
  const tableH = 53 + rowCount * rowH + 8;

  const kpiGap = 10;
  const kpiY = annexY + tableH + 14;
  const kpiH = Math.max(72, Math.floor((mapBottom - kpiY - kpiGap) / 2));

  const legendRuleY = mapBottom + 19;
  const legendY = mapBottom + 41;
  const footerRuleY = legendY + 84;
  const plateH = footerRuleY + 142;

  return {
    plateW,
    plateH,
    mapX,
    mapY,
    mapW,
    mapH,
    annexX,
    annexY,
    annexW,
    rowH,
    firstRowBaseline,
    tableH,
    kpiY,
    kpiH,
    kpiGap,
    legendRuleY,
    legendY,
    footerRuleY,
  };
}
