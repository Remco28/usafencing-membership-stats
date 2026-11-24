import './styles.css';
import type { Topology } from 'topojson-specification';

import { composeExportMapSvg, downloadPng, downloadSvg } from './exporter';
import {
  CensusMapController,
  colorForCompShare,
  colorForPerCapita,
  starPath,
} from './map';
import { SCHEDULES, createInitialState, getSchedule, metricLabel } from './schedules';
import type {
  AppState,
  ColorMode,
  DatasetBundle,
  MetricId,
  ScheduleId,
  Selection,
  UnitMode,
  WeaponFilter,
} from './types';

type TableTab = 'metros' | 'hosts' | 'clubs';

const SOURCE_LABELS: Record<string, string> = {
  usfa_directory_exact: 'USA Fencing Public Directory',
  dataverse_cc0_archive: 'Public-Domain Club Archive (Harvard Dataverse)',
  supplement_verified: 'Verified Club Website Supplement',
  non_geographic: 'Excluded (Non-Geographic / Overseas)',
  unlocated: 'Unlocated Small Clubs',
};

/** Coverage-table order: mapped sources first, then unlocated, then excluded. */
const SOURCE_ORDER: Record<string, number> = {
  usfa_directory_exact: 0,
  dataverse_cc0_archive: 1,
  supplement_verified: 2,
  unlocated: 3,
  non_geographic: 4,
};

function esc(val: string | number | null | undefined): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString();
}

function fmtPct(frac: number | null | undefined, digits = 1): string {
  if (frac === null || frac === undefined || Number.isNaN(frac)) return '—';
  return `${(frac * 100).toFixed(digits)}%`;
}

/** Signed percent with one decimal; rounds first so tiny negatives never print as "-0.0%". */
function fmtSignedPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const r = Math.round(n * 10) / 10;
  if (r === 0) return '0.0%';
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}%`;
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtPop(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString()}k`;
  return n.toLocaleString();
}

function fmtStops(n: number): string {
  return `${n} stop${n === 1 ? '' : 's'}`;
}

/** e.g. "1–5": range of national stops per host city, from data. */
function hostStopsRange(ds: DatasetBundle): string {
  const stops = ds.host_cities.map((h) => h.major_stops);
  if (stops.length === 0) return '0';
  const lo = Math.min(...stops);
  const hi = Math.max(...stops);
  return lo === hi ? String(hi) : `${lo}–${hi}`;
}

function seasonStageLabel(snapshotDate: string): string {
  const month = Number(snapshotDate.split('-')[1]);
  if (month >= 8 && month <= 10) return 'EARLY SEASON · RENEWS AUG 1';
  if (month === 6 || month === 7) return 'LATE SEASON · RENEWS AUG 1';
  return 'MID-SEASON · RENEWS AUG 1';
}

function atlasEmblemMarkup(): string {
  return `
    <svg class="bureau-seal" viewBox="0 0 60 60" aria-hidden="true">
      <circle cx="30" cy="30" r="27" fill="#ffffff" stroke="#12355b" stroke-width="1.8"/>
      <circle cx="30" cy="30" r="22.5" fill="none" stroke="#12355b" stroke-width="0.9" stroke-dasharray="2.4 1.6"/>
      <line x1="17" y1="36" x2="43" y2="15" stroke="#12355b" stroke-width="1.6" stroke-linecap="round"/>
      <line x1="43" y1="36" x2="17" y2="15" stroke="#12355b" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="20.5" cy="33.2" r="2.8" fill="#ffffff" stroke="#12355b" stroke-width="1.2"/>
      <circle cx="39.5" cy="33.2" r="2.8" fill="#ffffff" stroke="#12355b" stroke-width="1.2"/>
      <rect x="21" y="40" width="4" height="6" fill="#b42318"/>
      <rect x="28" y="36" width="4" height="10" fill="#12355b"/>
      <rect x="35" y="32" width="4" height="14" fill="#12355b"/>
    </svg>
  `;
}

class FencingMapApp {
  private root: HTMLElement;
  private dataset!: DatasetBundle;
  private topo!: Topology;
  private state: AppState = createInitialState();
  private map!: CensusMapController;
  private tableTab: TableTab = 'metros';
  private tableSortKey = 'competitive';
  private tableSortAsc = false;
  private toastTimer: number | null = null;
  private renderRaf: number | null = null;
  private filterNotice: string | null = null;

  // Cached element handles
  private mapSvgEl!: SVGSVGElement;
  private tooltipEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private modalEl!: HTMLElement;
  private keyTermsModalEl!: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  public async boot(): Promise<void> {
    this.root.innerHTML = `
      <div class="status-card">
        <strong>USA Fencing Membership &amp; Club Geography</strong><br/><br/>
        Loading U.S. fencing club and metro data…
      </div>
    `;

    try {
      const [dsRes, topoRes] = await Promise.all([
        fetch('./data/dataset.json'),
        fetch('./data/states-10m.json'),
      ]);
      if (!dsRes.ok) throw new Error(`Could not load map data (HTTP ${dsRes.status})`);
      if (!topoRes.ok) throw new Error(`Could not load U.S. map boundaries (HTTP ${topoRes.status})`);
      this.dataset = (await dsRes.json()) as DatasetBundle;
      this.topo = (await topoRes.json()) as Topology;
    } catch (err) {
      this.root.innerHTML = `
        <div class="status-card">
          <strong>Could not load map data</strong><br/><br/>
          Please try refreshing the page.<br/>
          <span class="mono" style="font-size:11px;color:#475569">${esc(err instanceof Error ? err.message : String(err))}</span>
        </div>
      `;
      return;
    }

    this.buildShell();
    this.initMap();
    this.syncAll();
    this.revealActiveTab(false);
  }

  private scheduleInputRender(includeTable = false): void {
    if (this.renderRaf !== null) window.cancelAnimationFrame(this.renderRaf);
    this.renderRaf = window.requestAnimationFrame(() => {
      this.renderRaf = null;
      this.map.render(this.state);
      if (includeTable) this.renderTable();
    });
  }

  private buildShell(): void {
    const sum = this.dataset.summary;
    const isNarrow = window.innerWidth <= 720;
    const hostOptions = [...this.dataset.host_cities]
      .sort((a, b) => b.major_stops - a.major_stops || a.city.localeCompare(b.city))
      .map((h) => {
        const key = `${h.city}, ${h.state}`;
        return `<option value="${esc(key)}">${esc(key)} (${fmtStops(h.major_stops)})</option>`;
      })
      .join('');

    this.root.innerHTML = `
      <div class="bureau-shell">
        <div class="desktop-notice">
          <strong>Desktop recommended:</strong> This interactive map and data explorer is designed for desktop screens. Some controls and labels work best on a wider display.
        </div>

        <header class="masthead">
          <div class="masthead-left">
            ${atlasEmblemMarkup()}
            <div>
              <div class="masthead-kicker">Independent Project · Not affiliated with USA Fencing or U.S. Census</div>
              <h1 class="masthead-title">USA Fencing Membership &amp; Club Geography</h1>
              <p class="masthead-sub">
                ${sum.coverage.geocoded_competitive_pct.toFixed(1)}% of U.S.-based competitive fencers mapped across
                ${sum.coverage.geocoded_clubs.toLocaleString()} of ${sum.tracker_distinct_clubs.toLocaleString()} clubs ·
                ${sum.totals.competitive.toLocaleString()} competitive memberships
              </p>
            </div>
          </div>
          <div class="masthead-right">
            <div class="form-stamp" title="USA Fencing memberships renew each August 1 (expiring July 31); totals build through the season and peak around July.">
              <span class="form-stamp-code">DATA AS OF ${esc(sum.snapshot_date)}</span>
              <span class="form-stamp-date">${esc(seasonStageLabel(sum.snapshot_date))}</span>
            </div>
            <div class="masthead-actions">
              <button type="button" class="btn btn-sm" id="btn-key-terms">Key Terms</button>
              <button type="button" class="btn btn-sm" id="btn-methodology">Data &amp; Notes</button>
              <button type="button" class="btn btn-sm" id="btn-export-svg" title="Download scalable vector graphic (SVG) for editing or printing">SVG</button>
              <button type="button" class="btn btn-sm btn-primary" id="btn-export-png" title="Download high-resolution image (PNG)">PNG</button>
            </div>
          </div>
        </header>

        <div class="schedule-tabs-wrap" id="schedule-tabs-wrap">
        <nav class="schedule-tabs" id="schedule-tabs" aria-label="Preset Map Views">
          ${SCHEDULES.map(
            (s) => `
              <button type="button" class="schedule-tab" data-schedule="${s.id}">
                <span class="schedule-tab-code">${esc(s.index)}</span>
                <span class="schedule-tab-label">${esc(s.tabLabel)}</span>
              </button>
            `,
          ).join('')}
        </nav>
        </div>

        <section class="schedule-banner" id="schedule-banner"></section>

        <details class="controls-drawer" id="controls-drawer" ${isNarrow ? '' : 'open'}>
          <summary class="controls-drawer-summary">Map Filters &amp; Overlays</summary>
          <section class="controls-bar" aria-label="Map Controls">
            <div class="ctrl-group">
              <label class="ctrl-label" for="ctrl-search">Search</label>
              <input
                id="ctrl-search"
                class="ctrl-input"
                type="search"
                placeholder="City, metro, or club…"
                autocomplete="off"
              />
              <span id="ctrl-search-count" class="search-count" aria-live="polite"></span>
            </div>

            <div class="ctrl-group">
              <label class="ctrl-label" for="ctrl-metric">Size</label>
              <select id="ctrl-metric" class="ctrl-select ctrl-select-metric"></select>
            </div>

            <div class="ctrl-group">
              <label class="ctrl-label" for="ctrl-color">Color</label>
              <select id="ctrl-color" class="ctrl-select ctrl-select-color"></select>
            </div>

            <div class="ctrl-group ctrl-group-min">
              <label class="ctrl-label" for="ctrl-min">Min</label>
              <input id="ctrl-min" class="ctrl-range" type="range" min="0" max="200" step="5" value="0" />
              <span id="ctrl-min-val" class="ctrl-min-val mono" aria-live="polite">No min</span>
            </div>

            <div class="ctrl-group" id="ctrl-weapon-wrap">
              <label class="ctrl-label" for="ctrl-weapon">Weapon</label>
              <select id="ctrl-weapon" class="ctrl-select">
                <option value="all">All Weapons</option>
                <option value="epee">Épée</option>
                <option value="foil">Foil</option>
                <option value="saber">Saber</option>
                <option value="para">Parafencing</option>
              </select>
            </div>

            <div class="ctrl-group">
              <label class="ctrl-label" for="ctrl-rings">Host Rings</label>
              <select id="ctrl-rings" class="ctrl-select ctrl-select-rings">
                <option value="">None</option>
                ${hostOptions}
              </select>
            </div>

            <details class="layers-popover" id="layers-popover">
              <summary class="layers-popover-btn">Layers ▾</summary>
              <div class="layers-popover-panel">
                <div class="layers-popover-section">Map Unit</div>
                <div class="segmented" id="ctrl-unit">
                  <button type="button" data-unit="metros">Metros</button>
                  <button type="button" data-unit="clubs">Clubs</button>
                </div>
                <div class="layers-popover-section">Map Overlays</div>
                <div class="ctrl-checks">
                  <label class="ctrl-check"><input type="checkbox" id="chk-hosts" /> National Host Cities</label>
                  <label class="ctrl-check"><input type="checkbox" id="chk-com" /> Balance Points</label>
                  <label class="ctrl-check"><input type="checkbox" id="chk-host-labels" /> Host Labels</label>
                  <label class="ctrl-check"><input type="checkbox" id="chk-metro-labels" /> Metro Labels</label>
                  <label class="ctrl-check"><input type="checkbox" id="chk-state-abbr" /> State Abbreviations</label>
                </div>
              </div>
            </details>

            <button type="button" class="reset-preset-btn" id="btn-reset-preset" title="Restore this view's default filters and overlays">Reset view</button>
          </section>
        </details>

        <main class="workspace-grid">
          <div class="map-card">
            <div class="how-to-read-bar" id="how-to-read-bar"></div>
            <div class="map-stage">
              <svg id="census-map" role="img" aria-label="USA Fencing Membership Map"></svg>
              <div class="map-zoom-controls">
                <button type="button" class="zoom-btn" id="btn-zoom-in" title="Zoom in">+</button>
                <button type="button" class="zoom-btn" id="btn-zoom-out" title="Zoom out">−</button>
                <button type="button" class="zoom-btn reset-btn" id="btn-zoom-reset" title="Fit U.S. map">Fit US</button>
              </div>
            </div>
            <div class="map-hint">Scroll to zoom · Drag to pan · Click any metro, club, or gold host star for details</div>
            <div class="legend-bar" id="legend-bar"></div>
          </div>

          <aside class="inspector-card" aria-label="Selection Details">
            <div class="inspector-header">
              <span class="inspector-header-title" id="inspector-header-title">National Overview</span>
              <button type="button" class="inspector-clear" id="btn-inspector-clear" style="display:none">Clear Selection</button>
            </div>
            <div class="inspector-body" id="inspector-body"></div>
          </aside>
        </main>

        <section class="ledger-section" id="ledger-section" aria-label="Data Tables">
          <div class="ledger-header">
            <div class="ledger-tabs" id="ledger-tabs">
              <button type="button" class="ledger-tab" data-ledger="metros">Metro Areas</button>
              <button type="button" class="ledger-tab" data-ledger="hosts">National Host Cities (${sum.national_events.host_cities})</button>
              <button type="button" class="ledger-tab" data-ledger="clubs">Mapped Clubs (${sum.coverage.geocoded_clubs})</button>
            </div>
            <div class="ledger-meta" id="ledger-meta">Click any row to locate on map</div>
          </div>
          <div class="table-scroll-frame" id="ledger-scroll-frame">
            <div class="table-scroll" id="ledger-table-wrap"></div>
          </div>
        </section>

        <footer class="bureau-footer">
          <div>
            USA Fencing Membership &amp; Club Geography · Data as of ${esc(sum.snapshot_date)} ·
            Independent project — not affiliated with USA Fencing or the U.S. Census Bureau
          </div>
          <div class="bureau-footer-right">
            Club-affiliated counts only · Excludes Unattached members · Season resets July 31
          </div>
        </footer>
      </div>

      <div class="map-tooltip" id="map-tooltip"></div>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>

      <div class="modal-backdrop" id="key-terms-modal" role="dialog" aria-modal="true" aria-labelledby="key-terms-title">
        <div class="modal-dialog">
          <div class="modal-header">
            <h2 class="modal-title" id="key-terms-title">Key Terms &amp; Definitions</h2>
            <button type="button" class="inspector-clear" id="btn-key-terms-close">Close [Esc]</button>
          </div>
          <div class="modal-body">
            <div class="key-terms-grid">
              <div><strong>Competitive Membership:</strong> Paid USA Fencing tier required to compete in sanctioned tournaments. Default metric here.</div>
              <div><strong>Non-Competitive:</strong> Lower-tier and trial memberships (including free 90-day trials, Access, and other non-competitive tiers) that don’t allow national tournament entry.</div>
              <div><strong>Metro Area:</strong> U.S. Census Core-Based Statistical Area — includes metropolitan areas (50k+ urban core) and smaller micropolitan areas (10k–50k) with surrounding commuter counties.</div>
              <div><strong>Balance Points:</strong> The point where all competitive fencers balance on the map, each fencer counted once at their club (blue crosshair), vs. the point where all national tournament stops balance, each stop counted once (red crosshair). A small gap means events are centrally placed overall — not average travel distance.</div>
              <div><strong>National Host Cities (2021–22 to 2026–27):</strong> Cities with hosted or scheduled North American Cup (NAC), Junior Olympics (JO), or Summer Nationals stops.</div>
              <div><strong>Parafencing &amp; Limits:</strong> <em>Parafencing</em> is wheelchair fencing for athletes with physical disabilities. Counts cover club-affiliated members only (excluding Unattached fencers); memberships renew each Aug 1.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-backdrop" id="methodology-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-dialog">
          <div class="modal-header">
            <h2 class="modal-title" id="modal-title">Data Sources, Definitions &amp; Notes</h2>
            <button type="button" class="inspector-clear" id="btn-modal-close">Close [Esc]</button>
          </div>
          <div class="modal-body" id="methodology-body"></div>
        </div>
      </div>
    `;

    this.mapSvgEl = this.root.querySelector<SVGSVGElement>('#census-map')!;
    this.tooltipEl = this.root.querySelector<HTMLElement>('#map-tooltip')!;
    this.toastEl = this.root.querySelector<HTMLElement>('#toast')!;
    this.modalEl = this.root.querySelector<HTMLElement>('#methodology-modal')!;
    this.keyTermsModalEl = this.root.querySelector<HTMLElement>('#key-terms-modal')!;

    this.renderMethodologyContent();
    this.bindEvents();
  }

  private initMap(): void {
    this.map = new CensusMapController(this.mapSvgEl, this.topo, this.dataset, {
      onHover: (sel, x, y) => this.showTooltip(sel, x, y),
      onLeave: () => this.hideTooltip(),
      onSelect: (sel) => {
        this.filterNotice = null;
        this.state.selection = sel;
        if (sel?.kind === 'host') {
          this.state.ringHostKey = `${sel.data.city}, ${sel.data.state}`;
          this.state.showHosts = true;
          this.syncControls();
          this.renderLegend();
        }
        this.map.render(this.state);
        this.renderInspector();
      },
      onZoomChange: () => {
        if (this.state.selection?.kind === 'club') this.renderInspector();
      },
    });
  }

  private bindEvents(): void {
    // Preset view tabs
    this.root.querySelectorAll<HTMLButtonElement>('#schedule-tabs .schedule-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.schedule as ScheduleId;
        this.applySchedule(id);
        this.revealActiveTab(true);
      });
    });

    // Show by toggle
    this.root.querySelectorAll<HTMLButtonElement>('#ctrl-unit button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const unit = btn.dataset.unit as UnitMode;
        if (unit === this.state.unit) return;
        this.state.unit = unit;
        if (unit === 'clubs' && this.state.metric === 'comp_per_100k') {
          this.state.metric = 'competitive';
        }
        if (unit === 'clubs' && this.state.colorMode === 'per_capita') {
          this.state.colorMode = 'comp_share';
        }
        this.state.minCount = unit === 'clubs' ? 1 : 0;
        this.syncAll();
      });
    });

    // Size metric select
    this.root.querySelector<HTMLSelectElement>('#ctrl-metric')!.addEventListener('change', (e) => {
      const m = (e.target as HTMLSelectElement).value as MetricId;
      this.state.metric = m;
      if (m === 'comp_per_100k') this.state.colorMode = 'per_capita';
      else if (this.state.colorMode === 'per_capita') this.state.colorMode = 'solid';
      this.syncAll();
    });

    // Color select
    this.root.querySelector<HTMLSelectElement>('#ctrl-color')!.addEventListener('change', (e) => {
      this.state.colorMode = (e.target as HTMLSelectElement).value as ColorMode;
      this.syncControls();
      this.renderScheduleChrome();
      this.map.render(this.state);
      this.renderLegend();
    });

    // Weapon select
    this.root.querySelector<HTMLSelectElement>('#ctrl-weapon')!.addEventListener('change', (e) => {
      this.state.weapon = (e.target as HTMLSelectElement).value as WeaponFilter;
      this.reconcileSelectionWithFilters();
      this.renderScheduleChrome();
      this.updateSearchCount();
      this.map.render(this.state);
      this.renderLegend();
      this.renderInspector();
      if (this.tableTab === 'clubs') this.renderTable();
    });

    // Min slider (rAF-throttled for smooth dragging)
    const minEl = this.root.querySelector<HTMLInputElement>('#ctrl-min')!;
    minEl.addEventListener('input', () => {
      this.state.minCount = Number(minEl.value);
      this.root.querySelector('#ctrl-min-val')!.textContent = this.minReadout();
      this.reconcileSelectionWithFilters();
      this.renderScheduleChrome();
      this.updateSearchCount();
      this.renderInspector();
      this.scheduleInputRender(false);
    });

    // Checkboxes
    const bindChk = (id: string, key: 'showHosts' | 'showCentersOfMass' | 'showHostLabels' | 'showMetroLabels' | 'showStateAbbr') => {
      this.root.querySelector<HTMLInputElement>(id)!.addEventListener('change', (e) => {
        this.state[key] = (e.target as HTMLInputElement).checked;
        this.renderScheduleChrome();
        this.map.render(this.state);
        this.renderLegend();
      });
    };
    bindChk('#chk-hosts', 'showHosts');
    bindChk('#chk-com', 'showCentersOfMass');
    bindChk('#chk-host-labels', 'showHostLabels');
    bindChk('#chk-metro-labels', 'showMetroLabels');
    bindChk('#chk-state-abbr', 'showStateAbbr');

    // Close Layers popover on outside click
    const layersPopover = this.root.querySelector<HTMLDetailsElement>('#layers-popover')!;
    document.addEventListener('click', (e) => {
      if (layersPopover.open && !layersPopover.contains(e.target as Node)) {
        layersPopover.open = false;
      }
    });

    // Reset view pill (restores current preset defaults)
    this.root.querySelector('#btn-reset-preset')!.addEventListener('click', () => {
      this.applySchedule(this.state.schedule);
    });

    // Distance rings dropdown (syncs sidebar host selection too)
    this.root.querySelector<HTMLSelectElement>('#ctrl-rings')!.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      this.state.ringHostKey = val || null;
      if (val) {
        this.state.showHosts = true;
        const host = this.dataset.host_cities.find((h) => `${h.city}, ${h.state}` === val);
        if (host) {
          this.filterNotice = null;
          this.state.selection = { kind: 'host', data: host };
        }
      } else if (this.state.selection?.kind === 'host') {
        this.state.selection = null;
      }
      this.syncControls();
      this.renderScheduleChrome();
      this.map.render(this.state);
      this.renderLegend();
      this.renderInspector();
    });

    // Search input (rAF-throttled for responsive typing + live match count)
    const searchEl = this.root.querySelector<HTMLInputElement>('#ctrl-search')!;
    searchEl.addEventListener('input', () => {
      this.state.searchQuery = searchEl.value;
      this.updateSearchCount();
      this.renderScheduleChrome();
      this.scheduleInputRender(true);
    });
    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.jumpToFirstSearchMatch();
      }
    });

    // Zoom controls
    this.root.querySelector('#btn-zoom-in')!.addEventListener('click', () => this.map.zoomIn());
    this.root.querySelector('#btn-zoom-out')!.addEventListener('click', () => this.map.zoomOut());
    this.root.querySelector('#btn-zoom-reset')!.addEventListener('click', () => this.map.resetZoom());

    // Inspector reset
    this.root.querySelector('#btn-inspector-clear')!.addEventListener('click', () => {
      this.state.selection = null;
      this.map.render(this.state);
      this.renderInspector();
    });

    // Table tabs
    this.root.querySelectorAll<HTMLButtonElement>('#ledger-tabs .ledger-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setTableTab(btn.dataset.ledger as TableTab);
      });
    });

    // Download SVG & PNG
    this.root.querySelector('#btn-export-svg')!.addEventListener('click', () => {
      const sched = getSchedule(this.state.schedule);
      const markup = composeExportMapSvg(this.map.renderForExport(this.state), this.dataset, this.state);
      const filename = `usaf-${sched.id}-${this.dataset.summary.snapshot_date}.svg`;
      downloadSvg(markup, filename);
      this.showToast(`Started SVG download: ${filename}`);
    });

    this.root.querySelector('#btn-export-png')!.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Rendering…';
      try {
        const sched = getSchedule(this.state.schedule);
        const markup = composeExportMapSvg(this.map.renderForExport(this.state), this.dataset, this.state);
        const filename = `usaf-${sched.id}-${this.dataset.summary.snapshot_date}.png`;
        await downloadPng(markup, filename, 2);
        this.showToast(`Started PNG download: ${filename}`);
      } catch (err) {
        this.showToast(`Export error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Download PNG';
      }
    });

    // Edge-fade scroll cues for the tab strip and wide tables
    const tabsEl = this.root.querySelector<HTMLElement>('#schedule-tabs')!;
    tabsEl.addEventListener('scroll', () => this.updateScrollCues(), { passive: true });
    this.root
      .querySelector<HTMLElement>('#ledger-table-wrap')!
      .addEventListener('scroll', () => this.updateScrollCues(), { passive: true });
    let resizeTimer: number | null = null;
    window.addEventListener('resize', () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        this.map.handleResize();
        this.updateScrollCues();
        this.revealActiveTab(false);
      }, 150);
    });

    // Data & Notes and Key Terms modals
    const openModal = () => this.modalEl.classList.add('open');
    const closeModal = () => this.modalEl.classList.remove('open');
    const openKeyTerms = () => this.keyTermsModalEl.classList.add('open');
    const closeKeyTerms = () => this.keyTermsModalEl.classList.remove('open');
    this.root.querySelector('#btn-methodology')!.addEventListener('click', openModal);
    this.root.querySelector('#btn-modal-close')!.addEventListener('click', closeModal);
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) closeModal();
    });
    this.root.querySelector('#btn-key-terms')!.addEventListener('click', openKeyTerms);
    this.root.querySelector('#btn-key-terms-close')!.addEventListener('click', closeKeyTerms);
    this.keyTermsModalEl.addEventListener('click', (e) => {
      if (e.target === this.keyTermsModalEl) closeKeyTerms();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
        closeKeyTerms();
        const lp = this.root.querySelector<HTMLDetailsElement>('#layers-popover');
        if (lp) lp.open = false;
      }
    });
  }

  /** Scroll the tab strip (not the page) so the active schedule tab is fully visible. */
  private revealActiveTab(smooth: boolean): void {
    const strip = this.root.querySelector<HTMLElement>('#schedule-tabs');
    const active = strip?.querySelector<HTMLElement>('.schedule-tab.active');
    if (!strip || !active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    const pad = 28;
    let target: number | null = null;
    if (left - pad < strip.scrollLeft) target = Math.max(0, left - pad);
    else if (right + pad > strip.scrollLeft + strip.clientWidth) target = right + pad - strip.clientWidth;
    if (target !== null) strip.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
    this.updateScrollCues();
  }

  /** Toggle left/right edge fades on horizontally scrollable strips so users can tell more content is off-screen. */
  private updateScrollCues(): void {
    const pairs: Array<[string, string]> = [
      ['#schedule-tabs-wrap', '#schedule-tabs'],
      ['#ledger-scroll-frame', '#ledger-table-wrap'],
    ];
    for (const [frameSel, scrollerSel] of pairs) {
      const frame = this.root.querySelector<HTMLElement>(frameSel);
      const scroller = this.root.querySelector<HTMLElement>(scrollerSel);
      if (!frame || !scroller) continue;
      const max = scroller.scrollWidth - scroller.clientWidth;
      frame.classList.toggle('can-scroll-left', max > 2 && scroller.scrollLeft > 2);
      frame.classList.toggle('can-scroll-right', max > 2 && scroller.scrollLeft < max - 2);
    }
  }

  private applySchedule(id: ScheduleId): void {
    const sched = getSchedule(id);
    const defaultHost = sched.defaults.ringHostKey
      ? this.dataset.host_cities.find((h) => `${h.city}, ${h.state}` === sched.defaults.ringHostKey) ?? null
      : null;
    this.filterNotice = null;
    this.state = {
      ...this.state,
      schedule: sched.id,
      unit: sched.defaults.unit,
      metric: sched.defaults.metric,
      colorMode: sched.defaults.colorMode,
      minCount: sched.defaults.minCount,
      showHosts: sched.defaults.showHosts,
      showCentersOfMass: sched.defaults.showCentersOfMass,
      showHostLabels: sched.defaults.showHostLabels,
      showMetroLabels: sched.defaults.showMetroLabels,
      ringHostKey: sched.defaults.ringHostKey,
      weapon: 'all',
      searchQuery: '',
      selection: defaultHost ? { kind: 'host', data: defaultHost } : null,
    };

    const searchInput = this.root.querySelector<HTMLInputElement>('#ctrl-search');
    if (searchInput) searchInput.value = '';
    this.updateSearchCount();

    if (id === 'host-distance') this.setTableTab('hosts', false);
    else if (id === 'clubs-registry') this.setTableTab('clubs', false);
    else if (id === 'per-capita-density') {
      this.tableTab = 'metros';
      this.tableSortKey = 'comp_per_100k';
      this.tableSortAsc = false;
    } else this.setTableTab('metros', false);

    this.map.resetZoom();
    this.syncAll();
  }

  /** Clear a selected club if the active Weapon or Min filter hides it, leaving an actionable note. */
  private reconcileSelectionWithFilters(): void {
    this.filterNotice = null;
    if (this.state.unit !== 'clubs' || this.state.selection?.kind !== 'club') return;
    const c = this.state.selection.data;
    const failsWeapon =
      (this.state.weapon === 'epee' && !c.has_epee) ||
      (this.state.weapon === 'foil' && !c.has_foil) ||
      (this.state.weapon === 'saber' && !c.has_saber) ||
      (this.state.weapon === 'para' && !c.has_para);
    const metricVal =
      this.state.metric === 'non_competitive'
        ? c.non_competitive
        : this.state.metric === 'total'
          ? c.total
          : c.competitive;
    const failsMin = metricVal < this.state.minCount;
    if (failsWeapon || failsMin) {
      const reason = failsWeapon
        ? `${c.name} is hidden by the ${this.state.weapon.toUpperCase()} filter (clubs without listed weapons are excluded).`
        : `${c.name} is hidden by the minimum size filter (${this.minReadout()}).`;
      this.state.selection = null;
      this.filterNotice = reason;
    }
  }

  private updateSearchCount(): void {
    const el = this.root.querySelector<HTMLElement>('#ctrl-search-count');
    if (!el) return;
    const q = this.state.searchQuery.trim().toLowerCase();
    if (!q) {
      el.textContent = '';
      return;
    }
    if (this.state.unit === 'clubs') {
      const n = this.dataset.clubs.filter((c) => {
        if (this.state.weapon === 'epee' && !c.has_epee) return false;
        if (this.state.weapon === 'foil' && !c.has_foil) return false;
        if (this.state.weapon === 'saber' && !c.has_saber) return false;
        if (this.state.weapon === 'para' && !c.has_para) return false;
        const val =
          this.state.metric === 'non_competitive'
            ? c.non_competitive
            : this.state.metric === 'total'
              ? c.total
              : c.competitive;
        if (val < this.state.minCount) return false;
        return (
          c.name.toLowerCase().includes(q) ||
          (c.city ?? '').toLowerCase().includes(q) ||
          c.abbreviation.toLowerCase().includes(q)
        );
      }).length;
      el.textContent = `${n} club${n === 1 ? '' : 's'}`;
    } else {
      const n = this.dataset.metros.filter((m) => m.competitive > 0 && m.cbsa_name.toLowerCase().includes(q)).length;
      el.textContent = `${n} metro${n === 1 ? '' : 's'}`;
    }
  }

  private setTableTab(tab: TableTab, rerender = true): void {
    this.tableTab = tab;
    if (tab === 'metros') {
      this.tableSortKey = 'competitive';
      this.tableSortAsc = false;
    } else if (tab === 'hosts') {
      this.tableSortKey = 'weighted_mean_comp_miles';
      this.tableSortAsc = true;
    } else {
      this.tableSortKey = 'competitive';
      this.tableSortAsc = false;
    }
    if (rerender) this.renderTable();
  }

  private syncAll(): void {
    this.renderScheduleChrome();
    this.syncControls();
    this.map.render(this.state);
    this.renderLegend();
    this.renderInspector();
    this.renderTable();
  }

  private renderScheduleChrome(): void {
    const sched = getSchedule(this.state.schedule);
    this.root.querySelectorAll<HTMLButtonElement>('#schedule-tabs .schedule-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.schedule === sched.id);
    });

    this.root.querySelector('#schedule-banner')!.innerHTML = `
      <div class="schedule-banner-main">
        <h2 class="schedule-plate-title">${esc(sched.title)}</h2>
        <p class="schedule-plate-sub">${esc(sched.subtitle(this.dataset.summary))}</p>
      </div>
      <div class="bureau-note">
        <strong>Note</strong>
        ${esc(sched.contextNote)}
      </div>
    `;

    const d = sched.defaults;
    const isCustom =
      this.state.unit !== d.unit ||
      this.state.metric !== d.metric ||
      this.state.colorMode !== d.colorMode ||
      this.state.showHosts !== d.showHosts ||
      this.state.showCentersOfMass !== d.showCentersOfMass ||
      this.state.showHostLabels !== d.showHostLabels ||
      this.state.showMetroLabels !== d.showMetroLabels ||
      this.state.minCount !== d.minCount ||
      this.state.weapon !== 'all' ||
      this.state.searchQuery.trim().length > 0;
    const resetBtn = this.root.querySelector<HTMLButtonElement>('#btn-reset-preset');
    if (resetBtn) resetBtn.classList.toggle('visible', isCustom);

    const howBar = this.root.querySelector('#how-to-read-bar')!;
    howBar.innerHTML = `
      <span class="how-to-read-text"><strong>How to read this:</strong>${esc(sched.howToRead)}</span>
      <button type="button" class="jump-table-btn" id="btn-jump-table">View Table ↓</button>
    `;
    howBar.querySelector('#btn-jump-table')?.addEventListener('click', () => {
      this.root.querySelector('#ledger-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  private syncControls(): void {
    // Show by buttons
    this.root.querySelectorAll<HTMLButtonElement>('#ctrl-unit button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.unit === this.state.unit);
    });

    // Metric options
    const metricEl = this.root.querySelector<HTMLSelectElement>('#ctrl-metric')!;
    const metricOpts: Array<[MetricId, string]> =
      this.state.unit === 'metros'
        ? [
            ['competitive', 'Competitive Fencers'],
            ['total', 'Total Club Members'],
            ['non_competitive', 'Non-Competitive Members'],
            ['comp_per_100k', 'Competitive per 100,000 Residents'],
          ]
        : [
            ['competitive', 'Competitive Fencers'],
            ['total', 'Total Club Members'],
            ['non_competitive', 'Non-Competitive Members'],
          ];
    metricEl.innerHTML = metricOpts
      .map(([v, label]) => `<option value="${v}" ${v === this.state.metric ? 'selected' : ''}>${label}</option>`)
      .join('');

    // Color options
    const colorEl = this.root.querySelector<HTMLSelectElement>('#ctrl-color')!;
    const colorOpts: Array<[ColorMode, string]> =
      this.state.unit === 'metros'
        ? [
            ['solid', 'Single Color (Navy)'],
            ['comp_share', '% Competitive Share'],
            ['per_capita', 'Fencers per 100,000 Residents'],
          ]
        : [
            ['comp_share', '% Competitive Share'],
            ['solid', 'Single Color (Navy)'],
          ];
    colorEl.innerHTML = colorOpts
      .map(([v, label]) => `<option value="${v}" ${v === this.state.colorMode ? 'selected' : ''}>${label}</option>`)
      .join('');

    // Weapon filter visibility
    const weaponWrap = this.root.querySelector<HTMLElement>('#ctrl-weapon-wrap')!;
    weaponWrap.style.display = this.state.unit === 'clubs' ? 'flex' : 'none';
    this.root.querySelector<HTMLSelectElement>('#ctrl-weapon')!.value = this.state.weapon;

    // Min slider bounds & label with clear units
    const minEl = this.root.querySelector<HTMLInputElement>('#ctrl-min')!;
    const maxVal = this.state.unit === 'clubs' ? 150 : 500;
    const stepVal = this.state.unit === 'clubs' ? 5 : 10;
    minEl.max = String(maxVal);
    minEl.step = String(stepVal);
    if (this.state.minCount > maxVal) this.state.minCount = 0;
    minEl.value = String(this.state.minCount);
    this.root.querySelector('#ctrl-min-val')!.textContent = this.minReadout();

    // Checkboxes & Rings
    this.root.querySelector<HTMLInputElement>('#chk-hosts')!.checked = this.state.showHosts;
    this.root.querySelector<HTMLInputElement>('#chk-com')!.checked = this.state.showCentersOfMass;
    this.root.querySelector<HTMLInputElement>('#chk-host-labels')!.checked = this.state.showHostLabels;
    this.root.querySelector<HTMLInputElement>('#chk-metro-labels')!.checked = this.state.showMetroLabels;
    this.root.querySelector<HTMLInputElement>('#chk-state-abbr')!.checked = this.state.showStateAbbr;
    this.root.querySelector<HTMLSelectElement>('#ctrl-rings')!.value = this.state.ringHostKey ?? '';
  }

  private minReadout(): string {
    if (this.state.minCount <= 0) return 'No min';
    const unitWord = this.state.metric === 'total' ? 'members' : 'fencers';
    return `${this.state.minCount}+ ${unitWord}`;
  }

  private renderLegend(): void {
    const el = this.root.querySelector<HTMLElement>('#legend-bar')!;
    const blocks: string[] = [];

    // 1. Circle size block (always matches active metric, for both Metros and Clubs)
    const sizeLabel = `Circle size = ${metricLabel(this.state.metric)}`;
    const samples =
      this.state.unit === 'clubs'
        ? [
            { l: '25', d: 8 },
            { l: '100', d: 15 },
            { l: '350', d: 24 },
          ]
        : this.state.metric === 'comp_per_100k'
          ? [
              { l: '10', d: 10 },
              { l: '30', d: 17 },
              { l: '65', d: 24 },
            ]
          : [
              { l: '250', d: 9 },
              { l: '1,000', d: 16 },
              { l: '4,500', d: 26 },
            ];
    blocks.push(`
      <div class="legend-block">
        <span class="legend-heading">${sizeLabel}</span>
        <span class="legend-bubbles">
          ${samples
            .map(
              (s) =>
                `<span class="bubble-sample"><span class="bubble-dot" style="width:${s.d}px;height:${s.d}px"></span>${s.l}</span>`,
            )
            .join('')}
        </span>
      </div>
    `);

    // 2. Color scale block
    if (this.state.colorMode === 'comp_share') {
      const items = [
        ['&lt;40%', colorForCompShare(0.35)],
        ['45%', colorForCompShare(0.45)],
        ['55%', colorForCompShare(0.55)],
        ['65%', colorForCompShare(0.65)],
        ['75%+', colorForCompShare(0.78)],
      ];
      blocks.push(`
        <div class="legend-block">
          <span class="legend-heading">% Competitive (of Total Members)</span>
          <span class="legend-swatches">
            ${items
              .map(
                ([l, c]) =>
                  `<span class="swatch-item"><span class="swatch-box" style="background:${c}"></span>${l}</span>`,
              )
              .join('')}
          </span>
        </div>
      `);
    } else if (this.state.colorMode === 'per_capita') {
      const items = [
        ['&lt;5', colorForPerCapita(3)],
        ['5–10', colorForPerCapita(7)],
        ['10–16', colorForPerCapita(12)],
        ['16–25', colorForPerCapita(20)],
        ['25+', colorForPerCapita(30)],
      ];
      blocks.push(`
        <div class="legend-block">
          <span class="legend-heading">Fencers per 100,000 Residents</span>
          <span class="legend-swatches">
            ${items
              .map(
                ([l, c]) =>
                  `<span class="swatch-item"><span class="swatch-box" style="background:${c}"></span>${l}</span>`,
              )
              .join('')}
          </span>
        </div>
      `);
    }

    // 3. Overlays & active weapon-filter note
    const gapMiles = this.dataset.summary.centers_of_mass.fencer_to_events_gap_miles;
    if (
      this.state.showHosts ||
      (this.state.showCentersOfMass && gapMiles !== null) ||
      this.state.ringHostKey ||
      (this.state.unit === 'clubs' && this.state.weapon !== 'all')
    ) {
      const overlayItems: string[] = [];
      const item = (icon: string, text: string, muted = false) => `
        <span class="legend-overlay-item${muted ? ' is-muted' : ''}">
          <span class="legend-icon">${icon}</span>
          <span class="legend-overlay-text">${text}</span>
        </span>
      `;
      if (this.state.showHosts) {
        overlayItems.push(
          item(
            `<svg width="16" height="16" viewBox="-9 -9 18 18"><path d="${starPath(7.5, 3.3)}" fill="#d97706" stroke="#2a1c10" stroke-width="1"/></svg>`,
            `National Host City: North American Cup (NAC), Junior Olympics (JO), Summer Nationals (${hostStopsRange(this.dataset)} hosted &amp; scheduled stops)`,
          ),
        );
      }
      if (this.state.showCentersOfMass && gapMiles !== null) {
        overlayItems.push(
          item(
            `<svg width="16" height="16" viewBox="-9 -9 18 18"><circle r="4.5" fill="#ffffff" stroke="#163656" stroke-width="1.4"/><path d="M-7 0H7M0 -7V7" stroke="#163656" stroke-width="1.1"/></svg>`,
            `Geographic Balance Points: fencers vs. event stops (${gapMiles} mi apart — not avg travel)`,
          ),
        );
      }
      if (this.state.ringHostKey) {
        overlayItems.push(
          item(
            `<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.6" fill="rgba(180,35,24,0.12)" stroke="#b42318" stroke-width="1.2" stroke-dasharray="2.4 1.6"/><circle cx="8" cy="8" r="2.8" fill="rgba(180,35,24,0.2)" stroke="#b42318" stroke-width="1"/></svg>`,
            `150 mi / 500 mi Straight-Line Rings (${esc(this.state.ringHostKey)})`,
          ),
        );
      }
      if (this.state.unit === 'clubs' && this.state.weapon !== 'all') {
        overlayItems.push(
          item('', 'Note: Weapon filter hides clubs whose weapons aren’t listed in the USA Fencing directory.', true),
        );
      }
      blocks.push(`<div class="legend-block legend-overlays">${overlayItems.join('')}</div>`);
    }

    el.innerHTML = blocks.join('');
  }

  private renderInspector(): void {
    const titleEl = this.root.querySelector<HTMLElement>('#inspector-header-title')!;
    const clearBtn = this.root.querySelector<HTMLButtonElement>('#btn-inspector-clear')!;
    const bodyEl = this.root.querySelector<HTMLElement>('#inspector-body')!;
    const sel = this.state.selection;

    if (!sel) {
      titleEl.textContent = 'National Overview';
      clearBtn.style.display = 'none';
      const sum = this.dataset.summary;
      const clubPct = Math.round((sum.coverage.geocoded_clubs / sum.tracker_distinct_clubs) * 100);

      // Compute Notable Examples dynamically from live dataset
      const ny = this.dataset.metros.find((m) => m.cbsa_code === '35620');
      const sj = this.dataset.metros.find((m) => m.cbsa_code === '41940');
      const dc = this.dataset.metros.find((m) => m.cbsa_code === '47900');
      const rich = this.dataset.host_cities.find((h) => h.city === 'Richmond' && h.state === 'VA');
      const slc = this.dataset.host_cities.find((h) => h.city === 'Salt Lake City' && h.state === 'UT');

      const notable = [
        ny && {
          label: ny.display_name,
          note: `${ny.competitive.toLocaleString()} competitive · #1 volume`,
          kind: 'metro',
          key: ny.cbsa_code,
        },
        sj && {
          label: sj.display_name,
          note: `${sj.comp_per_100k.toFixed(1)} per 100k · #1 (250k+ pop)`,
          kind: 'metro',
          key: sj.cbsa_code,
        },
        dc && {
          label: dc.display_name,
          note: `${dc.competitive.toLocaleString()} competitive · ${dc.club_count} clubs`,
          kind: 'metro',
          key: dc.cbsa_code,
        },
        rich && {
          label: `${rich.city}, ${rich.state}`,
          note: `${rich.comp_within_500mi_pct.toFixed(1)}% of club fencers within 500 mi`,
          kind: 'host',
          key: `${rich.city}, ${rich.state}`,
        },
        slc && {
          label: `${slc.city}, ${slc.state}`,
          note: `${fmtStops(slc.major_stops)} · ${Math.round(slc.weighted_mean_comp_miles).toLocaleString()} mi avg`,
          kind: 'host',
          key: `${slc.city}, ${slc.state}`,
        },
      ].filter(Boolean) as Array<{ label: string; note: string; kind: string; key: string }>;

      bodyEl.innerHTML = `
        ${
          this.filterNotice
            ? `<div class="filter-empty-note">${esc(this.filterNotice)} <button type="button" class="inline-link" id="btn-clear-filter-notice">Reset filters</button></div>`
            : ''
        }
        <div class="inspector-entity-type">United States · Summary</div>
        <h3 class="inspector-entity-title">National Totals</h3>
        <div class="inspector-entity-sub">
          ${sum.tracker_distinct_clubs.toLocaleString()} clubs · ${sum.national_events.major_stops} hosted &amp; scheduled national stops (${esc(sum.national_events.seasons)})
        </div>

        <div class="kpi-grid">
          <div class="kpi-box">
            <div class="kpi-label">Competitive Fencers</div>
            <div class="kpi-val">${fmtInt(sum.totals.competitive)}</div>
            <div class="kpi-sub">${sum.totals.comp_share_pct.toFixed(1)}% of club members</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Non-Competitive</div>
            <div class="kpi-val">${fmtInt(sum.totals.non_competitive)}</div>
            <div class="kpi-sub">Trials, Access &amp; other tiers</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Mapped Competitive</div>
            <div class="kpi-val">${sum.coverage.geocoded_competitive_pct.toFixed(1)}%</div>
            <div class="kpi-sub">${sum.coverage.geocoded_clubs} of ${sum.tracker_distinct_clubs} clubs (${clubPct}% — unmapped are tiny)</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Balance-Point Gap</div>
            <div class="kpi-val">${sum.centers_of_mass.fencer_to_events_gap_miles !== null ? `${sum.centers_of_mass.fencer_to_events_gap_miles} mi` : '—'}</div>
            <div class="kpi-sub">Fencers vs. hosts (not avg travel)</div>
          </div>
        </div>

        <div class="sublist-heading">Notable Examples (Click to Inspect)</div>
        <ul class="mini-list">
          ${notable
            .map(
              (n) => `
                <li class="mini-list-item is-stacked" data-notable-kind="${n.kind}" data-notable-key="${esc(n.key)}">
                  <span class="mini-list-name">${esc(n.label)}</span>
                  <span class="mini-list-detail">${esc(n.note)}</span>
                </li>
              `,
            )
            .join('')}
        </ul>
      `;

      bodyEl.querySelector('#btn-clear-filter-notice')?.addEventListener('click', () => {
        this.applySchedule(this.state.schedule);
      });
      bodyEl.querySelectorAll<HTMLElement>('[data-notable-key]').forEach((row) => {
        row.addEventListener('click', () => {
          const kind = row.dataset.notableKind;
          const key = row.dataset.notableKey!;
          if (kind === 'metro') {
            const m = this.dataset.metros.find((x) => x.cbsa_code === key);
            if (m) this.selectAndFocus({ kind: 'metro', data: m });
          } else if (kind === 'host') {
            const h = this.dataset.host_cities.find((x) => `${x.city}, ${x.state}` === key);
            if (h) {
              this.state.showHosts = true;
              this.state.ringHostKey = key;
              this.selectAndFocus({ kind: 'host', data: h });
            }
          }
        });
      });
      return;
    }

    clearBtn.style.display = 'inline-block';

    if (sel.kind === 'metro') {
      const m = sel.data;
      titleEl.textContent = 'Metro Area Details';
      const metroClubs = this.dataset.clubs
        .filter((c) => c.cbsa_code === m.cbsa_code)
        .sort((a, b) => b.competitive - a.competitive)
        .slice(0, 7);

      bodyEl.innerHTML = `
        <div class="inspector-entity-type">U.S. Census ${esc(m.cbsa_type)}</div>
        <h3 class="inspector-entity-title">${esc(m.display_name)}</h3>
        <div class="inspector-entity-sub">${esc(m.cbsa_name)}</div>

        <div class="kpi-grid">
          <div class="kpi-box">
            <div class="kpi-label">Competitive</div>
            <div class="kpi-val">${fmtInt(m.competitive)}</div>
            <div class="kpi-sub">${fmtPct(m.comp_share)} of club members</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Non-Competitive</div>
            <div class="kpi-val">${fmtInt(m.non_competitive)}</div>
            <div class="kpi-sub">${fmtInt(m.total)} total club members</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Per 100,000 Residents</div>
            <div class="kpi-val">${m.comp_per_100k.toFixed(1)}</div>
            <div class="kpi-sub">Competitive fencers</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Mapped Clubs</div>
            <div class="kpi-val">${m.club_count}</div>
            <div class="kpi-sub">${m.major_stops_hosted > 0 ? `${fmtStops(m.major_stops_hosted)} (national)` : 'No national stops'}</div>
          </div>
        </div>

        <dl class="detail-list">
          <div class="detail-row"><dt>2025 Census Pop. Estimate</dt><dd>${fmtPop(m.pop_2025)} (${m.pop_growth_2020_2025_pct !== null ? `${fmtSignedPct(m.pop_growth_2020_2025_pct)} 2020–25` : '—'})</dd></div>
          <div class="detail-row"><dt>2024 Median Household Income</dt><dd>${fmtMoney(m.median_household_income_2024)}</dd></div>
          <div class="detail-row"><dt>National Stops (2021–22 to 2026–27)</dt><dd>${m.major_stops_hosted > 0 ? fmtStops(m.major_stops_hosted) : 'None'}</dd></div>
          <div class="detail-row"><dt>Nearest National Host City</dt><dd>${esc(m.nearest_host_city ?? '—')} (${m.nearest_host_miles !== null ? `${Math.round(m.nearest_host_miles)} mi straight-line` : '—'})</dd></div>
          <div class="detail-row"><dt>Clubs by Weapon</dt><dd>Épée ${m.epee_clubs} · Foil ${m.foil_clubs} · Saber ${m.saber_clubs} · Para ${m.para_clubs}</dd></div>
        </dl>

        ${
          metroClubs.length > 0
            ? `
              <div class="sublist-heading">Largest Clubs in Metro (${m.club_count} total)</div>
              <ul class="mini-list">
                ${metroClubs
                  .map(
                    (c) => `
                      <li class="mini-list-item" data-club-id="${esc(c.club_id)}">
                        <span class="mini-list-name">${esc(c.name)}</span>
                        <span class="mini-list-detail is-inline">${c.competitive} competitive</span>
                      </li>
                    `,
                  )
                  .join('')}
              </ul>
            `
            : ''
        }

        <div class="inspector-actions">
          <button type="button" class="btn btn-sm" id="btn-inspect-zoom">Zoom to Metro</button>
          <button type="button" class="btn btn-sm" id="btn-inspect-clubs">${this.state.unit === 'clubs' ? 'Zoom to Metro Clubs' : 'View Individual Clubs'}</button>
        </div>
      `;

      bodyEl.querySelector('#btn-inspect-zoom')?.addEventListener('click', () => {
        if (m.lat !== null && m.lng !== null) this.map.flyTo(m.lat, m.lng, 4.8);
      });
      bodyEl.querySelector('#btn-inspect-clubs')?.addEventListener('click', () => {
        this.state.unit = 'clubs';
        this.state.metric = 'competitive';
        this.state.colorMode = 'comp_share';
        this.state.minCount = 1;
        this.syncControls();
        this.renderScheduleChrome();
        this.map.render(this.state);
        this.renderLegend();
        if (m.lat !== null && m.lng !== null) this.map.flyTo(m.lat, m.lng, 5.5);
      });
      bodyEl.querySelectorAll<HTMLElement>('[data-club-id]').forEach((row) => {
        row.addEventListener('click', () => {
          const c = this.dataset.clubs.find((x) => x.club_id === row.dataset.clubId);
          if (c) this.selectAndFocus({ kind: 'club', data: c });
        });
      });
      return;
    }

    if (sel.kind === 'club') {
      const c = sel.data;
      titleEl.textContent = 'Club Details';
      const weapons = [
        c.has_epee ? 'Épée' : null,
        c.has_foil ? 'Foil' : null,
        c.has_saber ? 'Saber' : null,
        c.has_para ? 'Parafencing' : null,
      ].filter(Boolean) as string[];

      const metro = c.cbsa_code
        ? this.dataset.metros.find((m) => m.cbsa_code === c.cbsa_code) ?? null
        : null;
      const sameMetroClubs = c.cbsa_code
        ? this.dataset.clubs
            .filter((x) => x.cbsa_code === c.cbsa_code)
            .sort((a, b) => b.competitive - a.competitive || b.total - a.total)
        : [];
      const currentZoom = this.map.getTransform().k;

      bodyEl.innerHTML = `
        <div class="inspector-entity-type">Fencing Club${c.abbreviation ? ` · ${esc(c.abbreviation)}` : ''}</div>
        <h3 class="inspector-entity-title">${esc(c.name)}</h3>
        <div class="inspector-entity-sub">
          ${esc([c.city, c.state].filter(Boolean).join(', ') || 'Location unverified')}
          ${c.division ? ` · ${esc(c.division)} Division` : ''}
        </div>

        <div class="kpi-grid">
          <div class="kpi-box">
            <div class="kpi-label">Competitive</div>
            <div class="kpi-val">${fmtInt(c.competitive)}</div>
            <div class="kpi-sub">${fmtPct(c.comp_share)} of club</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Non-Competitive</div>
            <div class="kpi-val">${fmtInt(c.non_competitive)}</div>
            <div class="kpi-sub">${fmtInt(c.total)} total members</div>
          </div>
        </div>

        <dl class="detail-list">
          <div class="detail-row">
            <dt>Census Metro Area</dt>
            <dd>
              ${
                metro
                  ? `<button type="button" class="inline-link" id="btn-club-metro">${esc(metro.display_name)}</button>`
                  : esc(c.cbsa_title ?? 'Outside metro areas')
              }
            </dd>
          </div>
          ${c.county ? `<div class="detail-row"><dt>County</dt><dd>${esc(c.county)}</dd></div>` : ''}
          ${c.region ? `<div class="detail-row"><dt>USA Fencing Region</dt><dd>${esc(c.region)}</dd></div>` : ''}
          <div class="detail-row"><dt>Nearest National Host</dt><dd title="Straight-line distance">${esc(c.nearest_host_city ?? '—')}${c.nearest_host_miles !== null ? ` · ${Math.round(c.nearest_host_miles)} mi` : ''}</dd></div>
        </dl>

        <div class="tag-row">
          ${
            weapons.length > 0
              ? weapons.map((w) => `<span class="badge">${esc(w)}</span>`).join('')
              : `<span class="badge">Weapons not listed in directory</span>`
          }
        </div>

        <div class="inspector-actions">
          ${
            currentZoom < 9.5
              ? `<button type="button" class="btn btn-sm" id="btn-club-zoom">${currentZoom >= 2.0 ? 'Zoom Closer' : 'Zoom to Club'}</button>`
              : ''
          }
          ${
            currentZoom >= 1.4
              ? `<button type="button" class="btn btn-sm" id="btn-club-reset">Fit US Map</button>`
              : ''
          }
        </div>

        ${
          sameMetroClubs.length > 1
            ? `
              <div class="sublist-heading">Clubs in ${esc(metro?.display_name ?? c.cbsa_title ?? 'this Metro')} (${sameMetroClubs.length})</div>
              <ul class="mini-list mini-list-scroll">
                ${sameMetroClubs
                  .map(
                    (peer) => `
                      <li class="mini-list-item${peer.club_id === c.club_id ? ' is-active' : ''}" data-peer-club-id="${esc(peer.club_id)}">
                        <span class="mini-list-name">${esc(peer.name)}</span>
                        <span class="mini-list-detail is-inline">${peer.competitive} comp</span>
                      </li>
                    `,
                  )
                  .join('')}
              </ul>
            `
            : ''
        }

        <div class="inspector-footnote">
          Location source: ${esc(SOURCE_LABELS[c.location_source] ?? c.location_source)}
        </div>
      `;

      bodyEl.querySelector('#btn-club-zoom')?.addEventListener('click', () => {
        const liveK = this.map.getTransform().k;
        const nextK = liveK >= 2.0 ? Math.min(12, Math.max(liveK * 1.65, 6.2)) : 6.2;
        this.map.flyTo(c.lat, c.lng, nextK);
      });
      bodyEl.querySelector('#btn-club-reset')?.addEventListener('click', () => {
        this.map.resetZoom();
      });
      bodyEl.querySelector('#btn-club-metro')?.addEventListener('click', () => {
        if (metro) this.selectAndFocus({ kind: 'metro', data: metro });
      });
      bodyEl.querySelectorAll<HTMLElement>('[data-peer-club-id]').forEach((row) => {
        row.addEventListener('click', () => {
          const peer = this.dataset.clubs.find((x) => x.club_id === row.dataset.peerClubId);
          if (!peer || peer.club_id === c.club_id) return;
          this.state.selection = { kind: 'club', data: peer };
          this.map.render(this.state);
          this.renderInspector();
          if (this.map.getTransform().k < 3.0) {
            this.map.flyTo(peer.lat, peer.lng, 5.8);
          }
        });
      });
      return;
    }

    // Host city
    const h = sel.data;
    const hostKey = `${h.city}, ${h.state}`;
    const ringsPinned = this.state.ringHostKey === hostKey;
    titleEl.textContent = `National Host City · ${fmtStops(h.major_stops)}`;
    bodyEl.innerHTML = `
      <div class="inspector-entity-type">National Host City (2021–22 to 2026–27)</div>
      <h3 class="inspector-entity-title">${esc(hostKey)}</h3>
      <div class="inspector-entity-sub">
        ${fmtStops(h.major_stops)}, hosted &amp; scheduled
        (${h.sn_count} Summer Nationals, ${h.jo_count} Junior Olympics, ${h.nac_count} North American Cup)
      </div>

      <div class="kpi-grid">
        <div class="kpi-box">
          <div class="kpi-label">Avg Club Distance</div>
          <div class="kpi-val">${Math.round(h.weighted_mean_comp_miles).toLocaleString()} mi</div>
          <div class="kpi-sub">Average distance from each competitive member’s club</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Fencers Within 500 mi</div>
          <div class="kpi-val">${h.comp_within_500mi_pct.toFixed(1)}%</div>
          <div class="kpi-sub">${fmtInt(h.comp_within_500mi)} club competitive fencers</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Fencers Within 150 mi</div>
          <div class="kpi-val">${h.comp_within_150mi_pct.toFixed(1)}%</div>
          <div class="kpi-sub">${fmtInt(h.comp_within_150mi)} (~driving range)</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Avg Distance (All Members)</div>
          <div class="kpi-val">${Math.round(h.weighted_mean_total_miles).toLocaleString()} mi</div>
          <div class="kpi-sub">Includes non-competitive tiers</div>
        </div>
      </div>

      <dl class="detail-list">
        <div class="detail-row"><dt>Seasons (Hosted &amp; Scheduled)</dt><dd>${esc(h.seasons)}</dd></div>
        <div class="detail-row"><dt>Events</dt><dd style="white-space:normal;text-align:right">${esc(h.events)}</dd></div>
      </dl>

      <div class="inspector-actions">
        <button type="button" class="btn btn-sm ${ringsPinned ? 'btn-stamp' : 'btn-primary'}" id="btn-toggle-rings">
          ${ringsPinned ? 'Clear 150 / 500 mi Rings' : 'Show 150 / 500 mi Rings'}
        </button>
        <button type="button" class="btn btn-sm" id="btn-host-zoom">Zoom to City</button>
      </div>
    `;

    bodyEl.querySelector('#btn-toggle-rings')?.addEventListener('click', () => {
      this.state.ringHostKey = ringsPinned ? null : hostKey;
      this.state.showHosts = true;
      this.syncControls();
      this.map.render(this.state);
      this.renderLegend();
      this.renderInspector();
    });
    bodyEl.querySelector('#btn-host-zoom')?.addEventListener('click', () => {
      this.map.flyTo(h.lat, h.lng, 4.2);
    });
  }

  private renderTable(): void {
    this.root.querySelectorAll<HTMLButtonElement>('#ledger-tabs .ledger-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.ledger === this.tableTab);
    });

    const wrap = this.root.querySelector<HTMLElement>('#ledger-table-wrap')!;
    const meta = this.root.querySelector<HTMLElement>('#ledger-meta')!;
    const q = this.state.searchQuery.trim().toLowerCase();

    const sortArrow = (k: string) =>
      this.tableSortKey === k ? (this.tableSortAsc ? ' ▲' : ' ▼') : '';

    if (this.tableTab === 'metros') {
      const perCapitaMode = this.state.unit === 'metros' && this.state.metric === 'comp_per_100k';
      const matched = this.dataset.metros.filter((m) => {
        if (m.competitive <= 0) return false;
        if (perCapitaMode && ((m.pop_2025 ?? 0) < 250_000 || m.competitive < 10)) return false;
        if (q && !m.cbsa_name.toLowerCase().includes(q)) return false;
        return true;
      });
      const rows = matched.sort((a, b) => this.compare(a, b, this.tableSortKey)).slice(0, 60);
      const outsideMetro = this.dataset.clubs.filter((c) => !c.cbsa_code).length;
      meta.textContent = perCapitaMode
        ? `Showing ${rows.length} of ${matched.length} metros (250k+ residents, 10+ competitive fencers — matches map)`
        : `Showing ${rows.length} of ${matched.length} U.S. Census metro areas (excludes ${outsideMetro} mapped club${outsideMetro === 1 ? '' : 's'} outside any Census metro or micropolitan area)`;

      wrap.innerHTML = `
        <table class="ledger-table">
          <thead>
            <tr>
              <th>#</th>
              <th data-sort="display_name">Metro Area${sortArrow('display_name')}</th>
              <th class="num" data-sort="competitive">Competitive${sortArrow('competitive')}</th>
              <th class="num" data-sort="non_competitive">Non-Competitive${sortArrow('non_competitive')}</th>
              <th class="num" data-sort="comp_share">% Competitive${sortArrow('comp_share')}</th>
              <th class="num" data-sort="club_count">Clubs${sortArrow('club_count')}</th>
              <th class="num" data-sort="comp_per_100k" title="Paid competitive fencers per 100,000 residents">Per 100,000${sortArrow('comp_per_100k')}</th>
              <th class="num" data-sort="pop_2025">2025 Pop. Est.${sortArrow('pop_2025')}</th>
              <th class="num" data-sort="pop_growth_2020_2025_pct" title="Metro population growth, 2020–2025 (U.S. Census estimates)">5-Yr Growth${sortArrow('pop_growth_2020_2025_pct')}</th>
              <th class="num" data-sort="median_household_income_2024">Med. Income${sortArrow('median_household_income_2024')}</th>
              <th class="num" data-sort="major_stops_hosted">Host Stops${sortArrow('major_stops_hosted')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (m, i) => `
                  <tr data-row-kind="metro" data-row-id="${esc(m.cbsa_code)}">
                    <td class="mono" style="color:#78818c">${String(i + 1).padStart(2, '0')}</td>
                    <td><strong>${esc(m.display_name)}</strong></td>
                    <td class="num"><strong>${fmtInt(m.competitive)}</strong></td>
                    <td class="num">${fmtInt(m.non_competitive)}</td>
                    <td class="num">${fmtPct(m.comp_share)}</td>
                    <td class="num">${m.club_count}</td>
                    <td class="num">${m.comp_per_100k.toFixed(1)}</td>
                    <td class="num">${fmtPop(m.pop_2025)}</td>
                    <td class="num">${fmtSignedPct(m.pop_growth_2020_2025_pct)}</td>
                    <td class="num">${fmtMoney(m.median_household_income_2024)}</td>
                    <td class="num">${m.major_stops_hosted > 0 ? m.major_stops_hosted : '—'}</td>
                  </tr>
                `,
              )
              .join('')}
          </tbody>
        </table>
      `;
    } else if (this.tableTab === 'hosts') {
      const sum = this.dataset.summary;
      const rows = this.dataset.host_cities
        .filter((h) => !q || `${h.city}, ${h.state}`.toLowerCase().includes(q))
        .sort((a, b) => this.compare(a, b, this.tableSortKey));
      meta.textContent = `${rows.length} national host cities (${sum.national_events.seasons} seasons, ${sum.national_events.major_stops} hosted & scheduled stops) · Straight-line distance from mapped clubs`;

      wrap.innerHTML = `
        <table class="ledger-table">
          <thead>
            <tr>
              <th>#</th>
              <th data-sort="city">Host City${sortArrow('city')}</th>
              <th class="num" data-sort="major_stops">Stops${sortArrow('major_stops')}</th>
              <th class="num" data-sort="weighted_mean_comp_miles" title="Average straight-line distance from each competitive member’s club">Avg Club Dist.${sortArrow('weighted_mean_comp_miles')}</th>
              <th class="num" data-sort="comp_within_150mi_pct" title="Share of competitive fencers whose mapped club is within 150 miles straight-line">Fencers ≤150 mi${sortArrow('comp_within_150mi_pct')}</th>
              <th class="num" data-sort="comp_within_500mi_pct" title="Share of competitive fencers whose mapped club is within 500 miles straight-line">Fencers ≤500 mi${sortArrow('comp_within_500mi_pct')}</th>
              <th>Seasons (Hosted &amp; Scheduled)</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (h, i) => `
                  <tr data-row-kind="host" data-row-id="${esc(`${h.city}, ${h.state}`)}">
                    <td class="mono" style="color:#78818c">${String(i + 1).padStart(2, '0')}</td>
                    <td><strong>${esc(h.city)}, ${esc(h.state)}</strong></td>
                    <td class="num">${h.major_stops}</td>
                    <td class="num"><strong>${Math.round(h.weighted_mean_comp_miles).toLocaleString()} mi</strong></td>
                    <td class="num">${h.comp_within_150mi_pct.toFixed(1)}%</td>
                    <td class="num">${h.comp_within_500mi_pct.toFixed(1)}%</td>
                    <td class="mono" style="font-size:11px;color:#525c67">${esc(h.seasons)}</td>
                  </tr>
                `,
              )
              .join('')}
          </tbody>
        </table>
      `;
    } else {
      const matched = this.dataset.clubs.filter((c) => {
        if (this.state.weapon === 'epee' && !c.has_epee) return false;
        if (this.state.weapon === 'foil' && !c.has_foil) return false;
        if (this.state.weapon === 'saber' && !c.has_saber) return false;
        if (this.state.weapon === 'para' && !c.has_para) return false;
        if (
          q &&
          !c.name.toLowerCase().includes(q) &&
          !(c.city ?? '').toLowerCase().includes(q) &&
          !c.abbreviation.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      });
      const rows = matched.sort((a, b) => this.compare(a, b, this.tableSortKey)).slice(0, 100);
      meta.textContent = `Showing ${rows.length} of ${matched.length} matching mapped clubs${this.state.weapon !== 'all' ? ' (clubs with no listed weapons are excluded)' : ''}`;

      wrap.innerHTML = `
        <table class="ledger-table">
          <thead>
            <tr>
              <th>#</th>
              <th data-sort="name">Club Name${sortArrow('name')}</th>
              <th data-sort="city">City / State${sortArrow('city')}</th>
              <th class="num" data-sort="competitive">Competitive${sortArrow('competitive')}</th>
              <th class="num" data-sort="non_competitive">Non-Competitive${sortArrow('non_competitive')}</th>
              <th class="num" data-sort="total">Total${sortArrow('total')}</th>
              <th class="num" data-sort="comp_share">% Competitive${sortArrow('comp_share')}</th>
              <th>Division</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (c, i) => `
                  <tr data-row-kind="club" data-row-id="${esc(c.club_id)}">
                    <td class="mono" style="color:#78818c">${String(i + 1).padStart(2, '0')}</td>
                    <td><strong>${esc(c.name)}</strong></td>
                    <td>${esc([c.city, c.state].filter(Boolean).join(', '))}</td>
                    <td class="num"><strong>${fmtInt(c.competitive)}</strong></td>
                    <td class="num">${fmtInt(c.non_competitive)}</td>
                    <td class="num">${fmtInt(c.total)}</td>
                    <td class="num">${fmtPct(c.comp_share)}</td>
                    <td style="color:#525c67">${esc(c.division ?? '—')}</td>
                  </tr>
                `,
              )
              .join('')}
          </tbody>
        </table>
      `;
    }

    this.updateScrollCues();

    // Bind sortable column headers
    wrap.querySelectorAll<HTMLElement>('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort!;
        if (this.tableSortKey === key) {
          this.tableSortAsc = !this.tableSortAsc;
        } else {
          this.tableSortKey = key;
          this.tableSortAsc =
            key === 'display_name' ||
            key === 'city' ||
            key === 'name' ||
            key === 'weighted_mean_comp_miles';
        }
        this.renderTable();
      });
    });

    // Bind row clicks (smoothly bring map + inspector back into view)
    wrap.querySelectorAll<HTMLElement>('tbody tr[data-row-kind]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const kind = tr.dataset.rowKind;
        const id = tr.dataset.rowId!;
        let acted = false;
        if (kind === 'metro') {
          const m = this.dataset.metros.find((x) => x.cbsa_code === id);
          if (m) {
            this.selectAndFocus({ kind: 'metro', data: m });
            acted = true;
          }
        } else if (kind === 'club') {
          const c = this.dataset.clubs.find((x) => x.club_id === id);
          if (c) {
            this.selectAndFocus({ kind: 'club', data: c });
            acted = true;
          }
        } else if (kind === 'host') {
          const h = this.dataset.host_cities.find((x) => `${x.city}, ${x.state}` === id);
          if (h) {
            this.state.showHosts = true;
            this.state.ringHostKey = id;
            this.selectAndFocus({ kind: 'host', data: h });
            acted = true;
          }
        }
        if (acted) {
          this.root.querySelector('.workspace-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  private compare<T extends object>(a: T, b: T, key: string): number {
    const va = (a as Record<string, unknown>)[key];
    const vb = (b as Record<string, unknown>)[key];
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    const cmp =
      typeof va === 'string' && typeof vb === 'string'
        ? va.localeCompare(vb)
        : Number(va) - Number(vb);
    return this.tableSortAsc ? cmp : -cmp;
  }

  private selectAndFocus(sel: Exclude<Selection, null>): void {
    this.state.selection = sel;
    if (sel.kind === 'club' && this.state.unit !== 'clubs') {
      this.state.unit = 'clubs';
      if (this.state.metric === 'comp_per_100k') {
        this.state.metric = 'competitive';
      }
      if (this.state.colorMode === 'per_capita') {
        this.state.colorMode = 'comp_share';
      }
      this.syncControls();
    } else if (sel.kind === 'metro' && this.state.unit !== 'metros') {
      this.state.unit = 'metros';
      this.syncControls();
    } else {
      this.syncControls();
    }

    this.map.render(this.state);
    this.renderLegend();
    this.renderInspector();

    if (sel.kind === 'metro' && sel.data.lat !== null && sel.data.lng !== null) {
      this.map.flyTo(sel.data.lat, sel.data.lng, 3.8);
    } else if (sel.kind === 'club') {
      this.map.flyTo(sel.data.lat, sel.data.lng, 5.8);
    } else if (sel.kind === 'host') {
      this.map.flyTo(sel.data.lat, sel.data.lng, 2.8);
    }
  }

  private jumpToFirstSearchMatch(): void {
    const q = this.state.searchQuery.trim().toLowerCase();
    if (!q) return;
    if (this.state.unit === 'clubs') {
      const matches = this.dataset.clubs.filter((c) => {
        if (this.state.weapon === 'epee' && !c.has_epee) return false;
        if (this.state.weapon === 'foil' && !c.has_foil) return false;
        if (this.state.weapon === 'saber' && !c.has_saber) return false;
        if (this.state.weapon === 'para' && !c.has_para) return false;
        const val =
          this.state.metric === 'non_competitive'
            ? c.non_competitive
            : this.state.metric === 'total'
              ? c.total
              : c.competitive;
        if (val < this.state.minCount) return false;
        return (
          c.name.toLowerCase().includes(q) ||
          (c.city ?? '').toLowerCase().includes(q) ||
          c.abbreviation.toLowerCase().includes(q)
        );
      });
      if (matches.length === 0) return;

      // If multiple clubs match a city/metro query (e.g. "Chicago" or "Madison"), show the metro's
      // clickable club list in the sidebar while keeping Individual Clubs visible on the map!
      if (matches.length > 1) {
        const metroMatch =
          this.dataset.metros.find((m) => m.display_name.toLowerCase().startsWith(q)) ??
          this.dataset.metros.find((m) => m.cbsa_name.toLowerCase().includes(q));
        if (metroMatch && metroMatch.lat !== null && metroMatch.lng !== null) {
          this.filterNotice = null;
          this.state.selection = { kind: 'metro', data: metroMatch };
          this.map.render(this.state);
          this.renderInspector();
          this.map.flyTo(metroMatch.lat, metroMatch.lng, 5.4);
          return;
        }
      }

      const best =
        matches.find((c) => c.name.toLowerCase().startsWith(q) || c.abbreviation.toLowerCase() === q) ??
        matches[0];
      this.selectAndFocus({ kind: 'club', data: best });
    } else {
      const match =
        this.dataset.metros.find((m) => m.competitive > 0 && m.display_name.toLowerCase().startsWith(q)) ??
        this.dataset.metros.find((m) => m.competitive > 0 && m.cbsa_name.toLowerCase().includes(q));
      if (match) this.selectAndFocus({ kind: 'metro', data: match });
    }
  }

  private showTooltip(sel: Selection, clientX: number, clientY: number): void {
    if (!sel) return;
    if (sel.kind === 'metro') {
      const m = sel.data;
      this.tooltipEl.innerHTML = `
        <div class="tooltip-kicker">Census Metro · ${m.club_count} club${m.club_count === 1 ? '' : 's'}</div>
        <div class="tooltip-title">${esc(m.display_name)}</div>
        <div class="tooltip-grid">
          <span>Competitive</span><span>${fmtInt(m.competitive)}</span>
          <span>Non-Competitive</span><span>${fmtInt(m.non_competitive)}</span>
          <span>% Competitive</span><span>${fmtPct(m.comp_share)}</span>
          <span>Per 100,000 Residents</span><span>${m.comp_per_100k.toFixed(1)}</span>
          <span>National Stops (2021–22 to 2026–27)</span><span>${m.major_stops_hosted > 0 ? fmtStops(m.major_stops_hosted) : 'None'}</span>
        </div>
      `;
    } else if (sel.kind === 'club') {
      const c = sel.data;
      const peerCount = c.cbsa_code
        ? this.dataset.clubs.filter((x) => x.cbsa_code === c.cbsa_code).length - 1
        : 0;
      const metroLabel = c.cbsa_code
        ? this.dataset.metros.find((m) => m.cbsa_code === c.cbsa_code)?.display_name ?? c.cbsa_title
        : null;
      this.tooltipEl.innerHTML = `
        <div class="tooltip-kicker">Club · ${esc([c.city, c.state].filter(Boolean).join(', '))}</div>
        <div class="tooltip-title">${esc(c.name)}</div>
        <div class="tooltip-grid">
          <span>Competitive</span><span>${fmtInt(c.competitive)}</span>
          <span>Non-Competitive</span><span>${fmtInt(c.non_competitive)}</span>
          <span>% Competitive</span><span>${fmtPct(c.comp_share)}</span>
          <span>Division</span><span>${esc(c.division ?? '—')}</span>
        </div>
        ${
          peerCount > 0 && metroLabel
            ? `<div class="tooltip-foot">+${peerCount} other club${peerCount === 1 ? '' : 's'} in ${esc(metroLabel)} · Click to browse</div>`
            : ''
        }
      `;
    } else {
      const h = sel.data;
      this.tooltipEl.innerHTML = `
        <div class="tooltip-kicker">National Host City · ${fmtStops(h.major_stops)}</div>
        <div class="tooltip-title">${esc(h.city)}, ${esc(h.state)}</div>
        <div class="tooltip-grid">
          <span>Avg Club Distance</span><span>${Math.round(h.weighted_mean_comp_miles).toLocaleString()} mi</span>
          <span>Fencers Within 150 mi</span><span>${h.comp_within_150mi_pct.toFixed(1)}%</span>
          <span>Fencers Within 500 mi</span><span>${h.comp_within_500mi_pct.toFixed(1)}%</span>
          <span>Seasons</span><span>${esc(h.seasons)}</span>
        </div>
      `;
    }

    this.tooltipEl.style.display = 'block';
    const margin = 16;
    const w = this.tooltipEl.offsetWidth;
    const h = this.tooltipEl.offsetHeight;
    let left = clientX + margin;
    let top = clientY + margin;
    if (left + w > window.innerWidth - 10) left = clientX - w - margin;
    if (top + h > window.innerHeight - 10) top = clientY - h - margin;
    this.tooltipEl.style.left = `${Math.max(8, left)}px`;
    this.tooltipEl.style.top = `${Math.max(8, top)}px`;
  }

  private hideTooltip(): void {
    this.tooltipEl.style.display = 'none';
  }

  private showToast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('visible');
    }, 3200);
  }

  private renderMethodologyContent(): void {
    const sum = this.dataset.summary;
    const gapMiles = sum.centers_of_mass.fencer_to_events_gap_miles;
    const body = this.root.querySelector<HTMLElement>('#methodology-body')!;
    const coverageRows = [...sum.coverage.by_location_source].sort(
      (a, b) =>
        (SOURCE_ORDER[a.location_source] ?? 9) - (SOURCE_ORDER[b.location_source] ?? 9) || b.clubs - a.clubs,
    );
    const coverageTotal = coverageRows.reduce(
      (t, r) => ({ clubs: t.clubs + r.clubs, competitive: t.competitive + r.competitive, total: t.total + r.total }),
      { clubs: 0, competitive: 0, total: 0 },
    );
    body.innerHTML = `
      <h3>1. Data Sources &amp; Date</h3>
      <ul>
        <li><strong>Club Membership Counts:</strong> FencingTracker (an independent community tracker aggregating USA Fencing public member rosters), data as of <code>${esc(sum.snapshot_date)}</code>. Contains <strong>${sum.tracker_distinct_clubs.toLocaleString()} clubs</strong> after deduplicating ${sum.duplicate_club_ids_merged.length} club IDs that appeared more than once under minor naming differences.</li>
        <li><strong>Club Locations:</strong> Matched in three steps: (1) USA Fencing’s public club finder (${sum.usfa_directory_clubs} listed clubs), (2) a public-domain archive of USA Fencing clubs on Harvard Dataverse (<code>doi:10.7910/DVN/AN2RB5</code>), and (3) a small verified set of active clubs missing from the finder, checked via their official club websites.</li>
        <li><strong>Demographics &amp; Metro Areas:</strong> U.S. Census Bureau 2025 Population Estimates, 2024 Median Household Income (Small Area Income and Poverty Estimates), and 2023 U.S. Census Core-Based Statistical Area (CBSA) boundaries — covering both metropolitan areas (50k+ urban core) and smaller micropolitan areas (10k–50k).</li>
        <li><strong>National Tournament Calendar:</strong> Official USA Fencing national event calendars covering <strong>${esc(sum.national_events.seasons)}</strong> seasons (${sum.national_events.major_stops} hosted &amp; scheduled North American Cup [NAC], Junior Olympics [JO], and Summer Nationals [SN] stops across ${sum.national_events.host_cities} host cities). Seasons run August 1 through July 31.</li>
      </ul>

      <h3>2. Mapping Coverage</h3>
      <p>
        Of ${sum.totals.competitive.toLocaleString()} club-affiliated competitive memberships across ${sum.tracker_distinct_clubs.toLocaleString()} clubs,
        <strong>${sum.coverage.geocoded_competitive.toLocaleString()} (${sum.coverage.geocoded_competitive_pct.toFixed(2)}% of U.S.-based competitive fencers)</strong>
        across <strong>${sum.coverage.geocoded_clubs} of ${sum.tracker_distinct_clubs} clubs</strong> are mapped to U.S. locations. “U.S.-based” excludes non-geographic or overseas entries (such as the Sports Medicine Team); the unmapped clubs are mostly very small:
      </p>
      <table class="audit-table">
        <thead>
          <tr>
            <th>Location Source</th>
            <th class="num">Clubs</th>
            <th class="num">Competitive</th>
            <th class="num">Total Members</th>
          </tr>
        </thead>
        <tbody>
          ${coverageRows
            .map(
              (s) => `
                <tr>
                  <td>${esc(SOURCE_LABELS[s.location_source] ?? s.location_source)}</td>
                  <td class="num">${s.clubs.toLocaleString()}</td>
                  <td class="num">${s.competitive.toLocaleString()}</td>
                  <td class="num">${s.total.toLocaleString()}</td>
                </tr>
              `,
            )
            .join('')}
        </tbody>
        <tfoot>
          <tr class="audit-total">
            <td>Total</td>
            <td class="num">${coverageTotal.clubs.toLocaleString()}</td>
            <td class="num">${coverageTotal.competitive.toLocaleString()}</td>
            <td class="num">${coverageTotal.total.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>

      <h3>3. Definitions &amp; How Metrics Work</h3>
      <ul>
        <li><strong>Competitive vs. Non-Competitive:</strong> <em>Competitive</em> is USA Fencing’s paid tier required for sanctioned tournaments. <em>Non-Competitive</em> combines free 90-day trials, Access, and other non-competitive tiers (often used for summer camps, school clinics, and beginners), so separating them prevents camp signups from skewing active tournament counts.</li>
        <li><strong>Per 100,000 Residents:</strong> Paid competitive club fencers per 100,000 metro residents (2025 Census population estimate), allowing size-adjusted comparisons across metros of different populations.</li>
        <li><strong>Geographic Balance Points:</strong> The point on the U.S. map where all competitive fencers balance, each fencer counted once at their club’s location (blue crosshair), vs. the point where all national tournament stops balance, each stop counted once (red crosshair).${gapMiles !== null ? ` Their ${gapMiles}-mile separation measures overall geographic alignment (smaller = more centrally placed) — not average travel distance per fencer.` : ''}</li>
        <li><strong>Host City Distances &amp; Rings:</strong> Both “Avg Club Distance” and the 150-mile (~driving) / 500-mile (~short flight) rings measure straight-line distance from each host city to mapped <em>club</em> locations, counting each competitive member at their club — not road distance or individual fencers’ home addresses.</li>
        <li><strong>USA Fencing Divisions, Regions &amp; Parafencing:</strong> USA Fencing organizes local clubs into roughly state- or metro-sized <em>Divisions</em> grouped into 6 broader U.S. <em>Regions</em>. <em>Parafencing</em> is wheelchair fencing for athletes with physical disabilities.</li>
      </ul>

      <h3>4. Important Caveats</h3>
      <ul>
        <li><strong>Club-affiliated members only:</strong> Fencers listed as <em>Unattached</em> (USA Fencing’s category for members with no club) are excluded. Conversely, fencers affiliated with two clubs may be counted under both clubs, so national totals reflect club memberships rather than strictly unique people.</li>
        <li><strong>Annual renewal (August 1):</strong> USA Fencing memberships expire July 31 and renew each August 1. Totals climb through the season toward Summer Nationals in July, so snapshots at different points in the year are not directly comparable.</li>
        <li><strong>Independent &amp; unofficial:</strong> Built as an independent project, not affiliated with USA Fencing or the U.S. Census Bureau. While obvious directory errors were cleaned up (such as removing an overseas club mapped to rural Colorado and fixing state-code typos), upstream directory errors may still exist.</li>
      </ul>
    `;
  }
}

const appRoot = document.getElementById('app');
if (appRoot) {
  const app = new FencingMapApp(appRoot);
  void app.boot();
}
