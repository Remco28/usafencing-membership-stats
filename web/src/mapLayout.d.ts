import type { DatasetBundle } from './types';

export type TextAnchor = 'start' | 'end' | 'middle';
export type Offset = [number, number, TextAnchor] | [number, number, TextAnchor, 'stack'];
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Obstacle {
  x: number;
  y: number;
  r: number;
  owner?: string;
  hard?: boolean;
}

export const MAP_WIDTH: number;
export const MAP_HEIGHT: number;
export const FIT_EXTENT: [[number, number], [number, number]];
export const FRAME_PAD: number;
export const STATE_FIPS_ABBR: Record<string, string>;
export const HIDE_STATE_ABBR_1X: Set<string>;
export const STATE_ABBR_FILL: string;
export const HOST_LABEL_OFFSETS: Record<string, Offset>;
export const METRO_LABEL_OFFSETS: Record<string, Offset>;
export const LABEL_FONT_SIZE: number;
export const BALANCE_FONT_SIZE: number;

export function estimateTextWidth(
  text: string,
  fontSize: number,
  mono?: boolean,
  letterSpacingEm?: number,
): number;

export interface LabelRequest {
  id: string;
  kind?: 'com' | 'host' | 'metro';
  role?: 'fencers' | 'events';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  mono?: boolean;
  letterSpacingEm?: number;
  markerR: number;
  scale?: number;
  preferred?: Offset | null;
  /** Optional two-line fallback used only when no single-line spot fits. */
  stackLines?: string[];
  /** Furthest candidate ring (0 = hugging the marker, 2 = long leader). Default 2. */
  maxRing?: number;
}

export interface LabelPlacement extends LabelRequest {
  dx: number;
  dy: number;
  anchor: TextAnchor;
  visible: boolean;
  /** Set when the stacked (multi-line) variant was chosen. */
  lines: string[] | null;
  box: Box;
  leader: [[number, number], [number, number]] | null;
}

export function layoutLabels(opts: {
  requests: LabelRequest[];
  obstacles: Obstacle[];
  reserved?: Box[];
  bounds: Box;
}): LabelPlacement[];

export function hostStarRadius(majorStops: number): number;

export interface LabelConfig {
  unit: 'metros' | 'clubs';
  metric: string;
  showHosts: boolean;
  showHostLabels: boolean;
  showMetroLabels: boolean;
  showCentersOfMass: boolean;
}

export function planMapLabels(p: {
  dataset: DatasetBundle;
  cfg: LabelConfig;
  project: (lngLat: [number, number]) => [number, number] | null;
  metroMarkers: Array<{ key: string; x: number; y: number; r: number }>;
  labelScale?: number;
  reserved?: Box[];
}): LabelPlacement[];

export function planStateAbbr<F>(p: {
  states: Array<{ id: string; feature: F }>;
  centroid: (f: F) => [number, number];
  obstacles: Obstacle[];
  labelBoxes: Box[];
  fontSize?: number;
}): Array<{ abbr: string; x: number; y: number; visible: boolean }>;

export function insetSeparatorPath(
  bounds: (stateId: string) => [[number, number], [number, number]] | null,
): string;

export interface PlateLayout {
  plateW: number;
  plateH: number;
  mapX: number;
  mapY: number;
  mapW: number;
  mapH: number;
  annexX: number;
  annexY: number;
  annexW: number;
  rowH: number;
  firstRowBaseline: number;
  tableH: number;
  kpiY: number;
  kpiH: number;
  kpiGap: number;
  legendRuleY: number;
  legendY: number;
  footerRuleY: number;
}
export function plateLayout(rowCount?: number): PlateLayout;
