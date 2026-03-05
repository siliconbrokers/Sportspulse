import type { TreemapContainer, TreemapInput, TreemapTile, Rect } from './types.js';

interface InternalTile {
  entityId: string;
  area: number;
}

/**
 * Squarified treemap v1 — deterministic layout.
 *
 * Algorithm:
 * 1. Compute usable area from container minus outerPadding
 * 2. Normalize weights to areas
 * 3. Build rows using squarified aspect ratio optimization
 * 4. Round to integer pixels with deterministic residual distribution
 * 5. Last tile in each row absorbs remaining residual (closure rule)
 */
export function squarify(
  inputs: readonly TreemapInput[],
  container: TreemapContainer,
): TreemapTile[] {
  if (inputs.length === 0) return [];

  const usableWidth = container.width - 2 * container.outerPadding;
  const usableHeight = container.height - 2 * container.outerPadding;

  if (usableWidth <= 0 || usableHeight <= 0) return [];

  const totalArea = usableWidth * usableHeight;
  const sumWeights = inputs.reduce((sum, t) => sum + t.layoutWeight, 0);

  const tiles: InternalTile[] = inputs.map(t => ({
    entityId: t.entityId,
    area: sumWeights > 0
      ? totalArea * (t.layoutWeight / sumWeights)
      : totalArea / inputs.length,
  }));

  const rows = buildRows(tiles, usableWidth, usableHeight);
  return layoutRows(rows, container.outerPadding, usableWidth, usableHeight, container.innerGutter);
}

interface Row {
  tiles: InternalTile[];
  totalArea: number;
}

function worstAspectRatio(row: InternalTile[], totalArea: number, sideLength: number): number {
  if (row.length === 0) return Infinity;
  const rowArea = row.reduce((s, t) => s + t.area, 0);
  if (rowArea <= 0 || sideLength <= 0) return Infinity;

  const rowWidth = rowArea / sideLength;
  let worst = 0;
  for (const tile of row) {
    const tileHeight = tile.area / rowWidth;
    const ratio = Math.max(rowWidth / tileHeight, tileHeight / rowWidth);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

function buildRows(tiles: InternalTile[], width: number, height: number): Row[] {
  const rows: Row[] = [];
  let remaining = [...tiles];
  let currentSide = width >= height ? height : width;
  let remainingArea = tiles.reduce((s, t) => s + t.area, 0);

  while (remaining.length > 0) {
    const currentRow: InternalTile[] = [remaining[0]];
    remaining = remaining.slice(1);

    while (remaining.length > 0) {
      const candidate = [...currentRow, remaining[0]];
      const currentWorst = worstAspectRatio(currentRow, remainingArea, currentSide);
      const candidateWorst = worstAspectRatio(candidate, remainingArea, currentSide);

      if (candidateWorst <= currentWorst) {
        currentRow.push(remaining[0]);
        remaining = remaining.slice(1);
      } else {
        break;
      }
    }

    const rowArea = currentRow.reduce((s, t) => s + t.area, 0);
    rows.push({ tiles: currentRow, totalArea: rowArea });

    remainingArea -= rowArea;
    if (remainingArea > 0 && currentSide > 0) {
      const usedFraction = rowArea / (rowArea + remainingArea);
      if (width >= height) {
        currentSide = height; // rows stack along width axis
      } else {
        currentSide = width;
      }
    }
  }

  return rows;
}

function layoutRows(
  rows: Row[],
  padding: number,
  usableWidth: number,
  usableHeight: number,
  gutter: number,
): TreemapTile[] {
  const result: TreemapTile[] = [];
  const totalArea = rows.reduce((s, r) => s + r.totalArea, 0);
  const isHorizontal = usableWidth >= usableHeight;

  let offset = padding;

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const isLastRow = ri === rows.length - 1;

    // Row dimension along stacking axis
    const idealRowDim = totalArea > 0
      ? (row.totalArea / totalArea) * (isHorizontal ? usableWidth : usableHeight)
      : (isHorizontal ? usableWidth : usableHeight) / rows.length;

    let rowDim: number;
    if (isLastRow) {
      // Last row absorbs remaining space
      rowDim = (isHorizontal ? usableWidth : usableHeight) + padding - offset;
    } else {
      rowDim = Math.floor(idealRowDim);
    }

    // Layout tiles within the row along the cross axis
    const crossLength = isHorizontal ? usableHeight : usableWidth;
    const gutterSpace = row.tiles.length > 1 ? gutter * (row.tiles.length - 1) : 0;
    const availableCross = crossLength - gutterSpace;

    let crossOffset = isHorizontal ? padding : padding;
    let residual = 0;

    for (let ti = 0; ti < row.tiles.length; ti++) {
      const tile = row.tiles[ti];
      const isLastTile = ti === row.tiles.length - 1;

      const idealTileDim = row.totalArea > 0
        ? (tile.area / row.totalArea) * availableCross
        : availableCross / row.tiles.length;

      let tileDim: number;
      if (isLastTile) {
        // Last tile absorbs remaining cross space
        tileDim = crossLength + (isHorizontal ? padding : padding) - crossOffset;
      } else {
        tileDim = Math.floor(idealTileDim);
        residual += idealTileDim - tileDim;
        if (residual >= 1) {
          const extra = Math.floor(residual);
          tileDim += extra;
          residual -= extra;
        }
      }

      const rect: Rect = isHorizontal
        ? { x: offset, y: crossOffset, w: rowDim, h: tileDim }
        : { x: crossOffset, y: offset, w: tileDim, h: rowDim };

      result.push({ entityId: tile.entityId, rect });
      crossOffset += tileDim + gutter;
    }

    offset += rowDim + gutter;
  }

  return result;
}
