// Grid geometry shared by the runtime renderer and the editor canvas: 12
// columns over the available width, 40px rows, 8px gaps, absolute cells.
// Children of a container/tabs live in the parent's own 12-column grid
// (layout relative to the parent).
import { z } from 'zod'
import type { Component, Layout } from '../model/document'
import { GRID_COLUMNS, literalProp, tabSpecSchema } from '../model/document.schema'

export { GRID_COLUMNS }
export const ROW_HEIGHT = 40
export const GRID_GAP = 8
/** Below this grid width cells stack full-width in (y, x) order (phones). */
export const STACK_BELOW_PX = 640

export type CellRect = { left: number; top: number; width: number; height: number }

/** Pixel box of a layout in a grid `width` px wide. */
export function cellRect(layout: Layout, width: number): CellRect {
  const column = (width - (GRID_COLUMNS - 1) * GRID_GAP) / GRID_COLUMNS
  return {
    left: layout.x * (column + GRID_GAP),
    top: layout.y * (ROW_HEIGHT + GRID_GAP),
    width: layout.w * column + (layout.w - 1) * GRID_GAP,
    height: gridHeight(layout.h),
  }
}

/** Pixel height of `rows` grid rows including the gaps between them. */
export function gridHeight(rows: number): number {
  return rows <= 0 ? 0 : rows * ROW_HEIGHT + (rows - 1) * GRID_GAP
}

/** Rows a set of cells occupies (bottom edge of the lowest), at least `minRows`. */
export function gridRows(components: readonly Component[], minRows = 0): number {
  return components.reduce((rows, component) => Math.max(rows, component.layout.y + component.layout.h), minRows)
}

/** Direct children of `parentId` (undefined → top level), in document order. */
export function childrenOf(components: readonly Component[], parentId?: string): Component[] {
  return components.filter((component) => component.parentId === parentId)
}

/** Reading order for the stacked (phone) layout. */
export function readingOrder(components: readonly Component[]): Component[] {
  return [...components].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
}

/** The tab a child of `tabsComponent` shows under: its `tab` prop when it names a tab, else the first tab. */
export function tabOf(child: Component, tabsComponent: Component): string | undefined {
  const tabs = literalProp(tabsComponent, 'tabs', z.array(tabSpecSchema)) ?? []
  const own = literalProp(child, 'tab', z.string())
  return tabs.some((tab) => tab.id === own) ? own : tabs[0]?.id
}

/** `child` moved under tab `tabId` of its tabs parent. */
export function withTab(child: Component, tabId: string): Component {
  return { ...child, props: { ...child.props, tab: { kind: 'value', value: tabId } } }
}
