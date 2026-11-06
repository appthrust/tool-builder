// Pixel ↔ grid-cell math for drag, drop and resize. It is the inverse of the
// renderer's `cellRect` (renderer/grid.ts): 12 columns of width
// colW = (W − 11·GAP) / 12, rows of ROW_HEIGHT, GAP between cells, no padding.
import type { Layout } from '../../../model/document'
import { GRID_COLUMNS } from '../../../model/document.schema'
import { GRID_GAP, ROW_HEIGHT } from '../../../renderer/grid'

/** Distance between the left edges of two neighbouring columns. */
export function columnPitch(gridWidth: number): number {
  return (gridWidth - (GRID_COLUMNS - 1) * GRID_GAP) / GRID_COLUMNS + GRID_GAP
}

const ROW_PITCH = ROW_HEIGHT + GRID_GAP

/** The cell whose top-left corner is nearest to a point (px, relative to the grid's top-left). */
export function nearestCell(point: { x: number; y: number }, gridWidth: number): { x: number; y: number } {
  return { x: Math.round(point.x / columnPitch(gridWidth)), y: Math.max(0, Math.round(point.y / ROW_PITCH)) }
}

/** The cell a point falls in (px, relative to the grid's top-left). */
export function cellUnder(point: { x: number; y: number }, gridWidth: number): { x: number; y: number } {
  return {
    x: Math.min(GRID_COLUMNS - 1, Math.max(0, Math.floor(point.x / columnPitch(gridWidth)))),
    y: Math.max(0, Math.floor(point.y / ROW_PITCH)),
  }
}

/** A pixel size snapped to whole cells (at least 1×1, at most 12 columns). */
export function snappedSize(size: { width: number; height: number }, gridWidth: number): { w: number; h: number } {
  return {
    w: Math.min(GRID_COLUMNS, Math.max(1, Math.round((size.width + GRID_GAP) / columnPitch(gridWidth)))),
    h: Math.max(1, Math.round((size.height + GRID_GAP) / ROW_PITCH)),
  }
}

/** A grid drop target found under the pointer: the grid element and the slot it renders. */
export type GridTarget = { element: HTMLElement; parentId: string | undefined; tab: string | undefined }

/**
 * The innermost grid under a viewport point, skipping grids inside `excludeFrameIds`
 * (a component cannot be dropped into itself or its children). Grids carry
 * `data-grid-parent` (renderer GridLayout); frames carry `data-frame-id`.
 */
export function gridTargetAt(clientX: number, clientY: number, excludeFrameIds: ReadonlySet<string>): GridTarget | undefined {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    if (!(element instanceof HTMLElement) || element.dataset.gridParent === undefined) continue
    const parentId = element.dataset.gridParent || undefined
    if (parentId && excludeFrameIds.has(parentId)) continue
    return { element, parentId, tab: element.dataset.gridTab || undefined }
  }
  return undefined
}

/** Client rect of `layout` drawn in `grid` (for the drop preview, which is fixed-positioned). */
export function clientRectOf(layout: Layout, grid: HTMLElement): { left: number; top: number; width: number; height: number } {
  const box = grid.getBoundingClientRect()
  const pitch = columnPitch(box.width)
  return {
    left: box.left + layout.x * pitch,
    top: box.top + layout.y * ROW_PITCH,
    width: layout.w * pitch - GRID_GAP,
    height: layout.h * ROW_PITCH - GRID_GAP,
  }
}
