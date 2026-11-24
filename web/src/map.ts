import { geoAlbersUsa, geoCircle, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';

import {
  FIT_EXTENT,
  LABEL_FONT_SIZE,
  MAP_HEIGHT,
  MAP_WIDTH,
  STATE_ABBR_FILL,
  hostStarRadius,
  insetSeparatorPath,
  planMapLabels,
  planStateAbbr,
  type Box,
  type LabelPlacement,
  type Obstacle,
} from './mapLayout';
import type {
  AppState,
  ClubRecord,
  DatasetBundle,
  MetroRecord,
  Selection,
} from './types';

export { MAP_HEIGHT, MAP_WIDTH };

/** Zoom level at which labels that yielded at 1x (to avoid collisions) reappear. */
const HIDDEN_LABEL_ZOOM = 2.2;

const FONT_SANS = "'IBM Plex Sans', system-ui, sans-serif";
const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace";

const BALANCE_COLORS = { fencers: '#163656', events: '#b42318' } as const;

function labelStyle(p: LabelPlacement): { fill: string; leader: string } {
  if (p.kind === 'com') {
    const c = p.role === 'events' ? BALANCE_COLORS.events : BALANCE_COLORS.fencers;
    return { fill: c, leader: c };
  }
  if (p.kind === 'host') return { fill: '#4f2710', leader: '#6e5232' };
  return { fill: '#142a44', leader: '#3d546d' };
}

export function starPath(rOuter: number, rInner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(Math.cos(angle) * r).toFixed(2)},${(Math.sin(angle) * r).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

export function colorForCompShare(share: number | null): string {
  if (share === null || Number.isNaN(share)) return '#94a3b8';
  if (share >= 0.72) return '#0f2e4f';
  if (share >= 0.62) return '#1d5280';
  if (share >= 0.52) return '#2d7a89';
  if (share >= 0.40) return '#6b9071';
  return '#d19a36';
}

export function colorForPerCapita(per100k: number): string {
  if (per100k >= 25) return '#0f2e4f';
  if (per100k >= 16) return '#1c4f7a';
  if (per100k >= 10) return '#377aa1';
  if (per100k >= 5) return '#6da0bd';
  return '#a8c2d2';
}

export function metroRadius(m: MetroRecord, metric: AppState['metric']): number {
  let val = 0;
  let refMax = 5000;
  let maxR = 26;
  if (metric === 'competitive') {
    val = m.competitive;
    refMax = 5000;
    maxR = 26;
  } else if (metric === 'non_competitive') {
    val = m.non_competitive;
    refMax = 2200;
    maxR = 24;
  } else if (metric === 'total') {
    val = m.total;
    refMax = 7000;
    maxR = 27;
  } else if (metric === 'comp_per_100k') {
    val = Math.max(0, m.comp_per_100k);
    refMax = 70;
    maxR = 22;
  }
  if (val <= 0) return 0;
  return Math.max(2.4, Math.sqrt(val / refMax) * maxR);
}

export function clubRadius(c: ClubRecord, metric: AppState['metric']): number {
  const val =
    metric === 'non_competitive'
      ? c.non_competitive
      : metric === 'total'
        ? c.total
        : c.competitive;
  if (val <= 0) return 0;
  const refMax = metric === 'total' ? 560 : 375;
  return Math.max(2.0, Math.sqrt(val / refMax) * 14.5);
}

export interface MapCallbacks {
  onHover: (sel: Selection, clientX: number, clientY: number) => void;
  onLeave: () => void;
  onSelect: (sel: Selection) => void;
  onZoomChange?: (k: number) => void;
}

/** Short readable label for zoomed-in club callouts. */
function shortClubLabel(c: ClubRecord): string {
  const name = c.name.trim();
  if (name.length <= 22) return name;
  const shortened = name
    .replace(/\bFencing\s+(Club|Center|Academy|Institute|Salle|School)\b/gi, 'FC')
    .replace(/\bFencing\b/gi, 'Fenc.')
    .trim();
  if (shortened.length <= 24) return shortened;
  if (c.abbreviation && c.abbreviation.length >= 2 && c.abbreviation.length <= 8) {
    return c.abbreviation;
  }
  return `${shortened.slice(0, 21).trimEnd()}…`;
}

/**
 * Compute deterministic screen-pixel offsets for clubs that share nearly identical
 * projected coordinates (e.g., same ZIP centroid) so zooming in fans them out cleanly.
 */
function computeClubSpread(
  clubs: Array<{ c: ClubRecord; r: number; pt: [number, number] }>,
): Map<string, [number, number]> {
  const offsets = new Map<string, [number, number]>();
  const assigned = new Set<string>();
  const CLUSTER_DIST_SQ = 1.8 * 1.8;

  for (let i = 0; i < clubs.length; i++) {
    const seed = clubs[i];
    if (assigned.has(seed.c.club_id)) continue;
    const group = [seed];
    assigned.add(seed.c.club_id);

    for (let j = i + 1; j < clubs.length; j++) {
      const other = clubs[j];
      if (assigned.has(other.c.club_id)) continue;
      const dx = other.pt[0] - seed.pt[0];
      const dy = other.pt[1] - seed.pt[1];
      if (dx * dx + dy * dy <= CLUSTER_DIST_SQ) {
        group.push(other);
        assigned.add(other.c.club_id);
      }
    }

    if (group.length <= 1) continue;

    // Largest club stays at the center; co-located peers fan out in a tight ring/spiral
    group.sort((a, b) => b.r - a.r || a.c.club_id.localeCompare(b.c.club_id));
    offsets.set(group[0].c.club_id, [0, 0]);
    const peers = group.length - 1;
    for (let k = 1; k < group.length; k++) {
      const ring = Math.floor((k - 1) / 6);
      const posInRing = (k - 1) % 6;
      const slots = Math.min(6, peers - ring * 6);
      const angle = (posInRing / slots) * Math.PI * 2 + ring * 0.52 - Math.PI / 4;
      const distPx = 11 + ring * 9;
      offsets.set(group[k].c.club_id, [Math.cos(angle) * distPx, Math.sin(angle) * distPx]);
    }
  }

  return offsets;
}

export class CensusMapController {
  private svgEl: SVGSVGElement;
  private projection = geoAlbersUsa();
  private pathGen = geoPath(this.projection);
  private zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
  private currentTransform: ZoomTransform = zoomIdentity;
  private statesGeo: GeoPermissibleObjects;
  private statesFeatures: Array<{ id: string; feature: GeoPermissibleObjects }>;
  private nationGeo: GeoPermissibleObjects;
  private countyMeshPathD: string | null = null;
  private countyLoading = false;
  private dataset: DatasetBundle;
  private callbacks: MapCallbacks;
  private lastState: AppState | null = null;
  private forceLabelScale: number | null = null;
  private lastLabelScale = 1;
  private lastZoomBucket = 0;

  constructor(
    svgEl: SVGSVGElement,
    topoData: Topology,
    dataset: DatasetBundle,
    callbacks: MapCallbacks,
  ) {
    this.svgEl = svgEl;
    this.dataset = dataset;
    this.callbacks = callbacks;

    const statesObj = topoData.objects.states as GeometryCollection;
    const nationObj = topoData.objects.nation as GeometryCollection;
    const statesFc = topojson.feature(topoData, statesObj);
    this.statesGeo = statesFc;
    this.statesFeatures = statesFc.features.map((f) => ({
      id: String(f.id ?? '').padStart(2, '0'),
      feature: f,
    }));
    this.nationGeo = topojson.feature(topoData, nationObj);

    this.projection.fitExtent(FIT_EXTENT, this.nationGeo);

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 14])
      .translateExtent([
        [-120, -80],
        [MAP_WIDTH + 120, MAP_HEIGHT + 80],
      ])
      .on('zoom', (event) => {
        this.currentTransform = event.transform;
        this.applyZoomTransform();
      });

    select(this.svgEl).call(this.zoomBehavior);
  }

  public getTransform(): ZoomTransform {
    return this.currentTransform;
  }

  public getProjection() {
    return this.projection;
  }

  public zoomIn(): void {
    select(this.svgEl).transition().duration(220).call(this.zoomBehavior.scaleBy, 1.55);
  }

  public zoomOut(): void {
    select(this.svgEl).transition().duration(220).call(this.zoomBehavior.scaleBy, 1 / 1.55);
  }

  public resetZoom(): void {
    select(this.svgEl).transition().duration(260).call(this.zoomBehavior.transform, zoomIdentity);
  }

  public flyTo(lat: number, lng: number, targetScale = 4.2): void {
    const pt = this.projection([lng, lat]);
    if (!pt) return;
    const t = zoomIdentity
      .translate(MAP_WIDTH / 2 - pt[0] * targetScale, MAP_HEIGHT / 2 - pt[1] * targetScale)
      .scale(targetScale);
    select(this.svgEl).transition().duration(420).call(this.zoomBehavior.transform, t);
  }

  private ensureCountiesLoaded(): void {
    if (this.countyMeshPathD !== null || this.countyLoading) return;
    this.countyLoading = true;
    fetch('./data/counties-10m.json')
      .then((res) => (res.ok ? (res.json() as Promise<Topology>) : null))
      .then((topo) => {
        if (!topo || !topo.objects.counties) return;
        const countiesObj = topo.objects.counties as GeometryCollection;
        const mesh = topojson.mesh(topo, countiesObj, (a, b) => a !== b);
        this.countyMeshPathD = this.pathGen(mesh) ?? '';
        const pathEl = this.svgEl.querySelector<SVGPathElement>('#layer-counties-path');
        if (pathEl && this.countyMeshPathD) {
          pathEl.setAttribute('d', this.countyMeshPathD);
          this.applyZoomTransform();
        }
      })
      .catch(() => {
        // Non-critical basemap enhancement; fail silently if offline
      })
      .finally(() => {
        this.countyLoading = false;
      });
  }

  private applyZoomTransform(): void {
    const g = this.svgEl.querySelector<SVGGElement>('#map-viewport');
    if (!g) return;
    const isExport = this.forceLabelScale !== null;
    const t = isExport ? zoomIdentity : this.currentTransform;
    g.setAttribute('transform', t.toString());
    const k = t.k;
    const spreadT = k <= 1.6 ? 0 : Math.min(1, (k - 1.6) / 3.0);

    // 1. Lazy-load & fade subtle county boundaries past 2.2x zoom
    if (k >= 2.2 && !isExport) this.ensureCountiesLoaded();
    const countyPath = g.querySelector<SVGPathElement>('#layer-counties-path');
    if (countyPath) {
      if (k >= 2.2 && this.countyMeshPathD) {
        const op = Math.min(0.6, ((k - 2.2) / 2.2) * 0.6);
        countyPath.style.display = '';
        countyPath.style.opacity = op.toFixed(2);
      } else {
        countyPath.style.display = 'none';
      }
    }

    // 2. Fade out giant state abbreviations as user zooms into local city/club detail
    const abbrLayer = g.querySelector<SVGGElement>('.layer-state-abbr');
    if (abbrLayer) {
      const abbrOp = k <= 1.6 ? 1 : k >= 2.8 ? 0 : 1 - (k - 1.6) / 1.2;
      abbrLayer.style.opacity = abbrOp.toFixed(2);
      abbrLayer.style.display = abbrOp <= 0.02 ? 'none' : '';
    }

    // 3. Counter-scale proportional bubbles (and gently fan out co-located clubs) on zoom
    g.querySelectorAll<SVGCircleElement>('[data-base-r]').forEach((el) => {
      const baseR = Number(el.dataset.baseR ?? '0');
      const exp = Number(el.dataset.scaleExp ?? '0.72');
      el.setAttribute('r', (baseR / Math.pow(k, exp)).toFixed(2));
      if (el.dataset.spreadX !== undefined) {
        const bx = Number(el.dataset.baseX ?? '0');
        const by = Number(el.dataset.baseY ?? '0');
        const sx = Number(el.dataset.spreadX ?? '0');
        const sy = Number(el.dataset.spreadY ?? '0');
        el.setAttribute('cx', (bx + (sx * spreadT) / k).toFixed(2));
        el.setAttribute('cy', (by + (sy * spreadT) / k).toFixed(2));
      }
    });

    // 4. Keep stars, balance reticles, and labels crisp as user zooms in
    g.querySelectorAll<SVGElement>('[data-inv-scale="true"]').forEach((el) => {
      let baseX = Number(el.dataset.x ?? '0');
      let baseY = Number(el.dataset.y ?? '0');
      if (el.dataset.spreadX !== undefined) {
        baseX += (Number(el.dataset.spreadX) * spreadT) / k;
        baseY += (Number(el.dataset.spreadY) * spreadT) / k;
      }
      const s = 1 / Math.pow(k, 0.72);
      el.setAttribute('transform', `translate(${baseX.toFixed(2)},${baseY.toFixed(2)}) scale(${s.toFixed(3)})`);
    });

    // 5. Progressive zoom-in visibility for deferred labels, city anchors, and club names
    g.querySelectorAll<SVGElement>('[data-zoom-show]').forEach((el) => {
      const minK = Number(el.dataset.zoomShow ?? '1');
      el.style.display = k >= minK ? '' : 'none';
    });

    if (!isExport && this.callbacks.onZoomChange) {
      const bucket = k >= 13.5 ? 3 : k >= 2.0 ? 2 : k > 1.15 ? 1 : 0;
      if (bucket !== this.lastZoomBucket) {
        this.lastZoomBucket = bucket;
        this.callbacks.onZoomChange(k);
      }
    }
  }

  /** Labels grow on narrow screens so they stay readable (~8.5 CSS px); the layout engine then drops whatever no longer fits. */
  private computeLabelScale(): number {
    if (this.forceLabelScale !== null) return this.forceLabelScale;
    const w = this.svgEl.getBoundingClientRect().width;
    if (!w) return 1;
    const s = (8.5 / LABEL_FONT_SIZE) * (MAP_WIDTH / w);
    return Math.min(2.4, Math.max(1, Number(s.toFixed(2))));
  }

  /** On-map zoom buttons (desktop) are a hard no-go zone for labels. */
  private reservedRects(): Box[] {
    if (this.forceLabelScale !== null) return [];
    const ctrl = this.svgEl.parentElement?.querySelector<HTMLElement>('.map-zoom-controls');
    if (!ctrl || getComputedStyle(ctrl).position !== 'absolute') return [];
    const sr = this.svgEl.getBoundingClientRect();
    if (!sr.width) return [];
    const cr = ctrl.getBoundingClientRect();
    const k = MAP_WIDTH / sr.width;
    return [
      {
        x0: (cr.left - sr.left) * k - 6,
        y0: (cr.top - sr.top) * k - 6,
        x1: (cr.right - sr.left) * k + 6,
        y1: (cr.bottom - sr.top) * k + 6,
      },
    ];
  }

  /** Re-run label layout when the map's on-screen width changes enough to need a different label size. */
  public handleResize(): void {
    if (!this.lastState) return;
    if (Math.abs(this.computeLabelScale() - this.lastLabelScale) > 0.04) this.render(this.lastState);
  }

  /** Render at desktop label size with no on-map buttons reserved, clone it for export, then restore the live view. */
  public renderForExport(state: AppState): SVGSVGElement {
    this.forceLabelScale = 1;
    try {
      this.render(state);
      return this.svgEl.cloneNode(true) as SVGSVGElement;
    } finally {
      this.forceLabelScale = null;
      this.render(state);
    }
  }

  private visibleMetros(state: AppState): Array<{ m: MetroRecord; r: number; pt: [number, number] }> {
    return this.dataset.metros
      .filter((m) => {
        if (m.lat === null || m.lng === null) return false;
        if (state.metric === 'comp_per_100k') {
          return (m.pop_2025 ?? 0) >= 250_000 && m.competitive >= Math.max(10, state.minCount);
        }
        const val =
          state.metric === 'non_competitive'
            ? m.non_competitive
            : state.metric === 'total'
              ? m.total
              : m.competitive;
        return val > 0 && val >= state.minCount;
      })
      .map((m) => ({ m, r: metroRadius(m, state.metric), pt: this.projection([m.lng!, m.lat!]) }))
      .filter((d): d is { m: MetroRecord; r: number; pt: [number, number] } => d.pt !== null && d.r > 0)
      // Draw largest circles underneath smaller ones so every metro stays clickable
      .sort((a, b) => b.r - a.r);
  }

  public render(state: AppState): void {
    this.lastState = state;
    const labelScale = this.computeLabelScale();
    this.lastLabelScale = labelScale;
    const svg = select(this.svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);

    // Crisp white canvas background & hairline border
    svg
      .append('rect')
      .attr('width', MAP_WIDTH)
      .attr('height', MAP_HEIGHT)
      .attr('fill', '#ffffff');

    const frame = svg.append('g').attr('class', 'archival-frame').attr('pointer-events', 'none');
    const pad = 10;
    frame
      .append('rect')
      .attr('x', pad)
      .attr('y', pad)
      .attr('width', MAP_WIDTH - pad * 2)
      .attr('height', MAP_HEIGHT - pad * 2)
      .attr('fill', 'none')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 1);

    const vp = svg.append('g').attr('id', 'map-viewport');

    // 1. US States basemap (+ lazy-loaded county borders on deep zoom)
    const landG = vp.append('g').attr('class', 'layer-states');
    landG
      .append('path')
      .datum(this.nationGeo)
      .attr('d', this.pathGen)
      .attr('fill', '#eef2f6')
      .attr('stroke', '#64748b')
      .attr('stroke-width', 1.15)
      .attr('vector-effect', 'non-scaling-stroke');

    landG
      .append('path')
      .attr('id', 'layer-counties-path')
      .attr('d', this.countyMeshPathD ?? '')
      .attr('fill', 'none')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 0.65)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('pointer-events', 'none')
      .style('display', 'none');

    landG
      .append('path')
      .datum(this.statesGeo)
      .attr('d', this.pathGen)
      .attr('fill', 'none')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 0.85)
      .attr('vector-effect', 'non-scaling-stroke');

    // Dashed separator framing the Alaska & Hawaii insets (derived from their projected bounds)
    landG
      .append('path')
      .attr('d', insetSeparatorPath((id) => this.stateBounds(id)))
      .attr('fill', 'none')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-dasharray', '3 3')
      .attr('stroke-width', 0.85)
      .attr('vector-effect', 'non-scaling-stroke');

    // Plan every callout up front (2D collision-avoiding layout shared with the static plates)
    const metros = state.unit === 'metros' ? this.visibleMetros(state) : [];
    const metroMarkers = metros.map(({ m, r, pt }) => ({ key: m.cbsa_code, x: pt[0], y: pt[1], r }));
    const placements = planMapLabels({
      dataset: this.dataset,
      cfg: state,
      project: (p) => this.projection(p),
      metroMarkers,
      labelScale,
      reserved: this.reservedRects(),
    });

    // State abbreviations: shown at 1x only where they touch no marker or label; revealed on zoom.
    if (state.showStateAbbr) {
      const obstacles: Obstacle[] = metroMarkers.map((mk) => ({ x: mk.x, y: mk.y, r: mk.r + 2 }));
      if (state.showHosts) {
        for (const h of this.dataset.host_cities) {
          const pt = this.projection([h.lng, h.lat]);
          if (pt) obstacles.push({ x: pt[0], y: pt[1], r: hostStarRadius(h.major_stops) + 2 });
        }
      }
      for (const p of placements) if (p.kind === 'com') obstacles.push({ x: p.x, y: p.y, r: 11 });
      const abbrs = planStateAbbr({
        states: this.statesFeatures,
        centroid: (f) => this.pathGen.centroid(f) as [number, number],
        obstacles,
        labelBoxes: placements.filter((p) => p.visible).map((p) => p.box),
      });
      const crowded = labelScale > 1.25;
      const abbrG = vp.append('g').attr('class', 'layer-state-abbr').attr('pointer-events', 'none');
      for (const a of abbrs) {
        const txt = abbrG
          .append('text')
          .attr('x', a.x.toFixed(1))
          .attr('y', a.y.toFixed(1))
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', STATE_ABBR_FILL)
          .attr('font-family', FONT_MONO)
          .attr('font-size', '9px')
          .attr('font-weight', '600')
          .attr('letter-spacing', '0.06em')
          .text(a.abbr);
        if (!a.visible || crowded) txt.attr('data-zoom-show', '2.1');
      }
    }

    // 2. Straight-line catchment rings (150 mi & 500 mi) sit beneath every marker and label
    if (state.ringHostKey) {
      const host = this.dataset.host_cities.find(
        (h) => `${h.city}, ${h.state}` === state.ringHostKey,
      );
      if (host) {
        const ringG = vp.append('g').attr('class', 'layer-rings').attr('pointer-events', 'none');
        const rings: Array<{ miles: number; dash: string; fillOpacity: number }> = [
          { miles: 500, dash: '5 4', fillOpacity: 0.05 },
          { miles: 150, dash: 'none', fillOpacity: 0.09 },
        ];
        for (const r of rings) {
          const deg = r.miles / 69.047;
          const circleGeo = geoCircle().center([host.lng, host.lat]).radius(deg)();
          ringG
            .append('path')
            .datum(circleGeo)
            .attr('d', this.pathGen)
            .attr('fill', '#b42318')
            .attr('fill-opacity', r.fillOpacity)
            .attr('stroke', '#b42318')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', 1.2)
            .attr('stroke-dasharray', r.dash)
            .attr('vector-effect', 'non-scaling-stroke');

          // Place a crisp distance label right on the northern arc (or southern arc for northern hosts like Minneapolis)
          const useSouth = host.lat + deg > 48.5;
          const arcPt = this.projection([host.lng, useSouth ? host.lat - deg : host.lat + deg]);
          if (arcPt) {
            const lbl = ringG
              .append('g')
              .attr('data-inv-scale', 'true')
              .attr('data-x', arcPt[0].toFixed(2))
              .attr('data-y', arcPt[1].toFixed(2))
              .attr('transform', `translate(${arcPt[0].toFixed(2)},${arcPt[1].toFixed(2)})`);
            lbl
              .append('text')
              .attr('x', 0)
              .attr('y', useSouth ? 9 : -3)
              .attr('text-anchor', 'middle')
              .attr('dominant-baseline', 'auto')
              .attr('fill', '#991b1b')
              .attr('font-family', FONT_MONO)
              .attr('font-size', '8px')
              .attr('font-weight', '600')
              .attr('paint-order', 'stroke')
              .attr('stroke', '#ffffff')
              .attr('stroke-width', '2.8')
              .attr('stroke-linejoin', 'round')
              .text(`${r.miles} mi`);
          }
        }
      }
    }

    // 3. Primary data marks (Metros OR Individual Clubs)
    const dataG = vp.append('g').attr('class', 'layer-data');
    let clubSpread = new Map<string, [number, number]>();
    let visibleClubs: Array<{ c: ClubRecord; r: number; pt: [number, number] }> = [];
    if (state.unit === 'metros') {
      this.renderMetros(dataG, state, metros);
    } else {
      const rendered = this.renderClubs(dataG, state);
      visibleClubs = rendered.clubs;
      clubSpread = rendered.spread;
    }

    // 4. National Event Host Cities (2021-27, hosted & scheduled)
    if (state.showHosts) {
      this.renderHosts(vp.append('g').attr('class', 'layer-hosts'), state);
    }

    // 5. Geographic Balance Points (Competitive Fencers vs. National Event Stops)
    if (state.showCentersOfMass) {
      this.renderCentersOfMass(vp.append('g').attr('class', 'layer-com'));
    }

    // 6. Zoom-in city anchors & club names (hidden at 1x and exports; appear smoothly as user zooms in)
    if (this.forceLabelScale === null) {
      const clubLabelBoxes =
        state.unit === 'clubs'
          ? this.renderZoomClubLabels(
              vp.append('g').attr('class', 'layer-zoom-clubs').attr('pointer-events', 'none'),
              visibleClubs,
              clubSpread,
              state,
            )
          : [];
      this.renderZoomCityAnchors(
        vp.append('g').attr('class', 'layer-zoom-cities').attr('pointer-events', 'none'),
        placements,
        clubLabelBoxes,
      );
    }

    // 7. Collision-free labels, always layered above every dot, star, and ring
    this.renderLabels(vp.append('g').attr('class', 'layer-labels').attr('pointer-events', 'none'), placements);

    this.applyZoomTransform();
  }

  private stateBounds(id: string): [[number, number], [number, number]] | null {
    const sf = this.statesFeatures.find((s) => s.id === id);
    return sf ? (this.pathGen.bounds(sf.feature) as [[number, number], [number, number]]) : null;
  }

  private renderMetros(
    g: ReturnType<typeof select<SVGGElement, unknown>>,
    state: AppState,
    metros: Array<{ m: MetroRecord; r: number; pt: [number, number] }>,
  ): void {
    const q = state.searchQuery.trim().toLowerCase();

    for (const { m, r, pt } of metros) {
      let fill = '#164677';
      if (state.colorMode === 'comp_share') fill = colorForCompShare(m.comp_share);
      else if (state.colorMode === 'per_capita') fill = colorForPerCapita(m.comp_per_100k);

      const isSelected =
        state.selection?.kind === 'metro' && state.selection.data.cbsa_code === m.cbsa_code;
      const isMatch = q.length > 0 && m.cbsa_name.toLowerCase().includes(q);
      const dimmed = q.length > 0 && !isMatch;

      const circle = g
        .append('circle')
        .attr('cx', pt[0].toFixed(2))
        .attr('cy', pt[1].toFixed(2))
        .attr('r', r.toFixed(2))
        .attr('data-base-r', r.toFixed(2))
        .attr('data-scale-exp', '0.62')
        .attr('fill', fill)
        .attr('fill-opacity', dimmed ? 0.16 : isSelected ? 0.92 : 0.72)
        .attr('stroke', isSelected ? '#14191f' : isMatch ? '#b42318' : '#ffffff')
        .attr('stroke-width', isSelected ? 2.2 : isMatch ? 1.8 : 0.9)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('cursor', 'pointer');

      circle
        .on('mouseenter', (ev: MouseEvent) => {
          circle.attr('fill-opacity', 0.95).attr('stroke', '#14191f').attr('stroke-width', 1.8);
          this.callbacks.onHover({ kind: 'metro', data: m }, ev.clientX, ev.clientY);
        })
        .on('mousemove', (ev: MouseEvent) => {
          this.callbacks.onHover({ kind: 'metro', data: m }, ev.clientX, ev.clientY);
        })
        .on('mouseleave', () => {
          circle
            .attr('fill-opacity', dimmed ? 0.16 : isSelected ? 0.92 : 0.72)
            .attr('stroke', isSelected ? '#14191f' : isMatch ? '#b42318' : '#ffffff')
            .attr('stroke-width', isSelected ? 2.2 : isMatch ? 1.8 : 0.9);
          this.callbacks.onLeave();
        })
        .on('click', (ev: MouseEvent) => {
          ev.stopPropagation();
          this.callbacks.onSelect({ kind: 'metro', data: m });
        });
    }
  }

  private renderClubs(
    g: ReturnType<typeof select<SVGGElement, unknown>>,
    state: AppState,
  ): {
    clubs: Array<{ c: ClubRecord; r: number; pt: [number, number] }>;
    spread: Map<string, [number, number]>;
  } {
    const q = state.searchQuery.trim().toLowerCase();
    const clubs = this.dataset.clubs
      .filter((c) => {
        if (state.weapon === 'epee' && !c.has_epee) return false;
        if (state.weapon === 'foil' && !c.has_foil) return false;
        if (state.weapon === 'saber' && !c.has_saber) return false;
        if (state.weapon === 'para' && !c.has_para) return false;
        const val =
          state.metric === 'non_competitive'
            ? c.non_competitive
            : state.metric === 'total'
              ? c.total
              : c.competitive;
        return val > 0 && val >= state.minCount;
      })
      .map((c) => ({ c, r: clubRadius(c, state.metric), pt: this.projection([c.lng, c.lat]) }))
      .filter((d): d is { c: ClubRecord; r: number; pt: [number, number] } => d.pt !== null && d.r > 0)
      .sort((a, b) => b.r - a.r);

    const spread = computeClubSpread(clubs);

    for (const { c, r, pt } of clubs) {
      const fill = state.colorMode === 'comp_share' ? colorForCompShare(c.comp_share) : '#164677';
      const isSelected =
        state.selection?.kind === 'club' && state.selection.data.club_id === c.club_id;
      const isMatch =
        q.length > 0 &&
        (c.name.toLowerCase().includes(q) ||
          (c.city ?? '').toLowerCase().includes(q) ||
          c.abbreviation.toLowerCase().includes(q));
      const dimmed = q.length > 0 && !isMatch;
      const off = spread.get(c.club_id);

      if (isSelected) {
        // High-contrast double selection halo so selection never blends with fill colors
        const halo = g
          .append('circle')
          .attr('cx', pt[0].toFixed(2))
          .attr('cy', pt[1].toFixed(2))
          .attr('r', (r + 3.2).toFixed(2))
          .attr('data-base-r', (r + 3.2).toFixed(2))
          .attr('data-scale-exp', '0.74')
          .attr('data-base-x', pt[0].toFixed(2))
          .attr('data-base-y', pt[1].toFixed(2))
          .attr('fill', 'none')
          .attr('stroke', '#0f172a')
          .attr('stroke-width', 2.2)
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('pointer-events', 'none');
        if (off && (off[0] !== 0 || off[1] !== 0)) {
          halo.attr('data-spread-x', off[0].toFixed(2)).attr('data-spread-y', off[1].toFixed(2));
        }
      }

      const circle = g
        .append('circle')
        .attr('cx', pt[0].toFixed(2))
        .attr('cy', pt[1].toFixed(2))
        .attr('r', r.toFixed(2))
        .attr('data-base-r', r.toFixed(2))
        .attr('data-scale-exp', '0.74')
        .attr('data-base-x', pt[0].toFixed(2))
        .attr('data-base-y', pt[1].toFixed(2))
        .attr('fill', fill)
        .attr('fill-opacity', dimmed ? 0.14 : isSelected ? 0.98 : 0.74)
        .attr('stroke', isSelected ? '#ffffff' : isMatch ? '#b42318' : '#ffffff')
        .attr('stroke-width', isSelected ? 2.2 : isMatch ? 1.8 : 0.75)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('cursor', 'pointer');

      if (off && (off[0] !== 0 || off[1] !== 0)) {
        circle.attr('data-spread-x', off[0].toFixed(2)).attr('data-spread-y', off[1].toFixed(2));
      }

      circle
        .on('mouseenter', (ev: MouseEvent) => {
          circle.attr('fill-opacity', 0.98).attr('stroke', '#14191f').attr('stroke-width', 1.7);
          this.callbacks.onHover({ kind: 'club', data: c }, ev.clientX, ev.clientY);
        })
        .on('mousemove', (ev: MouseEvent) => {
          this.callbacks.onHover({ kind: 'club', data: c }, ev.clientX, ev.clientY);
        })
        .on('mouseleave', () => {
          circle
            .attr('fill-opacity', dimmed ? 0.14 : isSelected ? 0.95 : 0.74)
            .attr('stroke', isSelected ? '#14191f' : isMatch ? '#b42318' : '#ffffff')
            .attr('stroke-width', isSelected ? 2.0 : isMatch ? 1.6 : 0.75);
          this.callbacks.onLeave();
        })
        .on('click', (ev: MouseEvent) => {
          ev.stopPropagation();
          this.callbacks.onSelect({ kind: 'club', data: c });
        });
    }

    return { clubs, spread };
  }

  private renderHosts(
    g: ReturnType<typeof select<SVGGElement, unknown>>,
    state: AppState,
  ): void {
    for (const h of this.dataset.host_cities) {
      const pt = this.projection([h.lng, h.lat]);
      if (!pt) continue;
      const key = `${h.city}, ${h.state}`;
      const isSelected =
        (state.selection?.kind === 'host' &&
          `${state.selection.data.city}, ${state.selection.data.state}` === key) ||
        state.ringHostKey === key;

      const rOuter = hostStarRadius(h.major_stops);
      const rInner = rOuter * 0.44;

      const node = g
        .append('g')
        .attr('data-inv-scale', 'true')
        .attr('data-x', pt[0].toFixed(2))
        .attr('data-y', pt[1].toFixed(2))
        .attr('transform', `translate(${pt[0].toFixed(2)},${pt[1].toFixed(2)})`)
        .style('cursor', 'pointer');

      if (isSelected) {
        node
          .append('circle')
          .attr('r', (rOuter + 4.5).toFixed(1))
          .attr('fill', 'none')
          .attr('stroke', '#b42318')
          .attr('stroke-width', 1.6)
          .attr('stroke-dasharray', '3 2');
      }

      node
        .append('path')
        .attr('d', starPath(rOuter, rInner))
        .attr('fill', isSelected ? '#b42318' : '#d97706')
        .attr('stroke', '#2a1c10')
        .attr('stroke-width', 1.0);

      node
        .on('mouseenter', (ev: MouseEvent) => {
          this.callbacks.onHover({ kind: 'host', data: h }, ev.clientX, ev.clientY);
        })
        .on('mousemove', (ev: MouseEvent) => {
          this.callbacks.onHover({ kind: 'host', data: h }, ev.clientX, ev.clientY);
        })
        .on('mouseleave', () => this.callbacks.onLeave())
        .on('click', (ev: MouseEvent) => {
          ev.stopPropagation();
          this.callbacks.onSelect({ kind: 'host', data: h });
        });
    }
  }

  private renderCentersOfMass(g: ReturnType<typeof select<SVGGElement, unknown>>): void {
    const com = this.dataset.summary.centers_of_mass;
    if (!com.competitive_fencers || !com.major_event_stops) return;
    const pF = this.projection([com.competitive_fencers.lng, com.competitive_fencers.lat]);
    const pE = this.projection([com.major_event_stops.lng, com.major_event_stops.lat]);
    if (!pF || !pE) return;

    g.append('line')
      .attr('x1', pF[0].toFixed(2))
      .attr('y1', pF[1].toFixed(2))
      .attr('x2', pE[0].toFixed(2))
      .attr('y2', pE[1].toFixed(2))
      .attr('stroke', '#2b3440')
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '2.5 2')
      .attr('vector-effect', 'non-scaling-stroke');

    const drawReticle = (pt: [number, number], color: string) => {
      const node = g
        .append('g')
        .attr('data-inv-scale', 'true')
        .attr('data-x', pt[0].toFixed(2))
        .attr('data-y', pt[1].toFixed(2))
        .attr('transform', `translate(${pt[0].toFixed(2)},${pt[1].toFixed(2)})`)
        .attr('pointer-events', 'none');
      node
        .append('circle')
        .attr('r', 6)
        .attr('fill', '#ffffff')
        .attr('fill-opacity', 0.85)
        .attr('stroke', color)
        .attr('stroke-width', 1.6);
      node
        .append('path')
        .attr('d', 'M -9 0 L 9 0 M 0 -9 L 0 9')
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
    };

    drawReticle(pF, BALANCE_COLORS.fencers);
    drawReticle(pE, BALANCE_COLORS.events);
  }

  /** Subtle city anchor labels that appear once zoomed in (k >= 2.0) to provide local bearings. */
  private renderZoomCityAnchors(
    g: ReturnType<typeof select<SVGGElement, unknown>>,
    placements: LabelPlacement[],
    clubBoxes: Array<{ x0: number; y0: number; x1: number; y1: number; minZoom: number }> = [],
  ): void {
    const existingPts = placements.map((p) => ({ x: p.x, y: p.y }));
    const placed: Array<{ x: number; y: number; tier: number }> = [];

    const candidates = this.dataset.metros
      .filter((m) => m.lat !== null && m.lng !== null && ((m.pop_2025 ?? 0) >= 250_000 || m.competitive >= 40))
      .sort((a, b) => (b.pop_2025 ?? 0) - (a.pop_2025 ?? 0));

    for (const m of candidates) {
      const pt = this.projection([m.lng!, m.lat!]);
      if (!pt) continue;
      // Skip if an active host or metro label already anchors this exact city
      if (existingPts.some((e) => Math.hypot(e.x - pt[0], e.y - pt[1]) < 9)) continue;

      const isMajor = (m.pop_2025 ?? 0) >= 950_000 || m.competitive >= 200;
      const minZoom = isMajor ? 2.0 : 3.2;
      const minGap = isMajor ? 24 : 14;
      if (placed.some((p) => Math.hypot(p.x - pt[0], p.y - pt[1]) < minGap)) continue;

      const cityOnly = m.display_name.split(',')[0].trim();
      // Approximate label box in map units at k=4.2 and skip if it collides with a club label
      const estW = (cityOnly.length * 4.8 + 8) / 4.2;
      const estH = 11 / 4.2;
      const cx0 = pt[0] + 1;
      const cy0 = pt[1] - estH - 1;
      const cx1 = cx0 + estW;
      const cy1 = pt[1] + 1;
      if (
        clubBoxes.some(
          (b) => !(cx1 < b.x0 - 1.2 || cx0 > b.x1 + 1.2 || cy1 < b.y0 - 1.2 || cy0 > b.y1 + 1.2),
        )
      ) {
        continue;
      }

      placed.push({ x: pt[0], y: pt[1], tier: isMajor ? 1 : 2 });

      const node = g
        .append('g')
        .attr('data-inv-scale', 'true')
        .attr('data-x', pt[0].toFixed(2))
        .attr('data-y', pt[1].toFixed(2))
        .attr('data-zoom-show', String(minZoom))
        .attr('transform', `translate(${pt[0].toFixed(2)},${pt[1].toFixed(2)})`)
        .style('display', 'none');

      node
        .append('circle')
        .attr('r', 1.6)
        .attr('fill', '#475569')
        .attr('fill-opacity', 0.7);

      node
        .append('text')
        .attr('x', 4)
        .attr('y', -4)
        .attr('text-anchor', 'start')
        .attr('dominant-baseline', 'central')
        .attr('fill', '#475569')
        .attr('font-family', FONT_SANS)
        .attr('font-size', isMajor ? '8.5px' : '7.8px')
        .attr('font-weight', isMajor ? '600' : '500')
        .attr('letter-spacing', '0.03em')
        .attr('paint-order', 'stroke')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', '3')
        .attr('stroke-linejoin', 'round')
        .text(cityOnly);
    }
  }

  /** Concise club callouts that appear on deep zoom in Clubs mode so users aren't clicking blind. */
  private renderZoomClubLabels(
    g: ReturnType<typeof select<SVGGElement, unknown>>,
    clubs: Array<{ c: ClubRecord; r: number; pt: [number, number] }>,
    spread: Map<string, [number, number]>,
    state: AppState,
  ): Array<{ x0: number; y0: number; x1: number; y1: number; minZoom: number }> {
    const selectedId = state.selection?.kind === 'club' ? state.selection.data.club_id : null;
    const ordered = [...clubs].sort((a, b) => {
      if (a.c.club_id === selectedId) return -1;
      if (b.c.club_id === selectedId) return 1;
      return b.c.competitive - a.c.competitive || b.c.total - a.c.total;
    });

    const placedBoxes: Array<{ x0: number; y0: number; x1: number; y1: number; minZoom: number }> = [];
    for (const { c, r, pt } of ordered) {
      const isSelected = c.club_id === selectedId;
      if (!isSelected && c.competitive < 25) continue;

      const labelText = shortClubLabel(c);
      const off = spread.get(c.club_id) ?? [0, 0];
      const labelOffset = Math.max(6.0, r * 0.55 + 4.0);
      // 2D bounding-box collision check in map units at k=4.5
      const effX = pt[0] + off[0] / 4.5;
      const effY = pt[1] + off[1] / 4.5;
      const estW = (labelText.length * 4.8 + labelOffset + 4) / 4.5;
      const estH = 12 / 4.5;
      const box = {
        x0: effX + labelOffset / 4.5 - 1,
        y0: effY - estH / 2,
        x1: effX + estW,
        y1: effY + estH / 2,
        minZoom: isSelected ? 2.2 : c.competitive >= 70 ? 3.8 : 5.2,
      };
      if (
        !isSelected &&
        placedBoxes.some(
          (b) => !(box.x1 < b.x0 - 1.2 || box.x0 > b.x1 + 1.2 || box.y1 < b.y0 - 0.8 || box.y0 > b.y1 + 0.8),
        )
      ) {
        continue;
      }
      placedBoxes.push(box);

      const node = g
        .append('g')
        .attr('data-inv-scale', 'true')
        .attr('data-x', pt[0].toFixed(2))
        .attr('data-y', pt[1].toFixed(2))
        .attr('data-zoom-show', String(box.minZoom))
        .attr('transform', `translate(${pt[0].toFixed(2)},${pt[1].toFixed(2)})`)
        .style('display', 'none');

      if (off[0] !== 0 || off[1] !== 0) {
        node.attr('data-spread-x', off[0].toFixed(2)).attr('data-spread-y', off[1].toFixed(2));
      }

      node
        .append('text')
        .attr('x', labelOffset.toFixed(1))
        .attr('y', '0.5')
        .attr('text-anchor', 'start')
        .attr('dominant-baseline', 'central')
        .attr('fill', isSelected ? '#0f172a' : '#1e3a5f')
        .attr('font-family', FONT_SANS)
        .attr('font-size', isSelected ? '9px' : '8px')
        .attr('font-weight', isSelected ? '700' : '600')
        .attr('paint-order', 'stroke')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', '3.4')
        .attr('stroke-linejoin', 'round')
        .text(labelText);
    }
    return placedBoxes;
  }

  private renderLabels(
    g: ReturnType<typeof select<SVGGElement, unknown>>,
    placements: LabelPlacement[],
  ): void {
    for (const p of placements) {
      const node = g
        .append('g')
        .attr('data-inv-scale', 'true')
        .attr('data-x', p.x.toFixed(2))
        .attr('data-y', p.y.toFixed(2))
        .attr('transform', `translate(${p.x.toFixed(2)},${p.y.toFixed(2)})`);
      if (!p.visible) node.attr('data-zoom-show', String(HIDDEN_LABEL_ZOOM));

      const style = labelStyle(p);
      if (p.leader) {
        node
          .append('line')
          .attr('x1', p.leader[0][0].toFixed(1))
          .attr('y1', p.leader[0][1].toFixed(1))
          .attr('x2', p.leader[1][0].toFixed(1))
          .attr('y2', p.leader[1][1].toFixed(1))
          .attr('stroke', style.leader)
          .attr('stroke-width', 0.75);
      }

      // Single line, or (in crowded spots) a compact stack: city name over "N stops"
      const lines = p.lines ?? [p.text];
      const lineH = p.fontSize * 1.12;
      lines.forEach((line, i) => {
        node
          .append('text')
          .attr('x', p.dx.toFixed(1))
          .attr('y', (p.dy + (i - (lines.length - 1) / 2) * lineH).toFixed(1))
          .attr('text-anchor', p.anchor)
          .attr('dominant-baseline', 'central')
          .attr('fill', style.fill)
          .attr('font-family', p.mono ? FONT_MONO : FONT_SANS)
          .attr('font-size', `${p.fontSize.toFixed(2)}px`)
          .attr('font-weight', i === 0 ? '600' : '500')
          .attr('letter-spacing', p.letterSpacingEm ? `${p.letterSpacingEm}em` : null)
          .attr('paint-order', 'stroke')
          .attr('stroke', '#ffffff')
          .attr('stroke-width', (p.fontSize * 0.36).toFixed(2))
          .attr('stroke-linejoin', 'round')
          .text(line);
      });
    }
  }

  public getLastState(): AppState | null {
    return this.lastState;
  }
}
