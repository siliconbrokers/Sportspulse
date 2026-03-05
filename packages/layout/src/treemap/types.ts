export interface TreemapContainer {
  width: number;
  height: number;
  outerPadding: number;
  innerGutter: number;
}

export interface TreemapInput {
  entityId: string;
  layoutWeight: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreemapTile {
  entityId: string;
  rect: Rect;
}

export interface LayoutMetadata {
  algorithmKey: string;
  algorithmVersion: number;
  container: TreemapContainer;
}

export const LAYOUT_ALGORITHM_KEY = 'treemap.squarified';
export const LAYOUT_ALGORITHM_VERSION = 1;
