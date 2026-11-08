// @ts-check

/**
 * Numeric metadata consumed by camera framing and selection outlines. Mesh
 * builders keep additional generation fields outside this boundary.
 * @typedef {{vertices: number[][], triangles: number[][]}} Surface
 * @typedef {{key: string, top: number, g: import('three').Group, surface?: Surface | null, riverSurface?: Surface | null, corners?: number[][], riverCorners?: number[][]}} ControlCell
 * @typedef {{notify?: boolean, additive?: boolean, fromMap?: boolean}} SelectionOptions
 * @typedef {{resetView?: boolean, fitContent?: boolean, preserveFraming?: boolean}} RefreshOptions
 * @typedef {{x: number, y: number}} PointerPosition
 * @typedef {PointerPosition & {time: number, selected?: boolean}} Tap
 * @typedef {(raycaster: import('three').Raycaster) => import('three').Intersection | null} Picker
 * @typedef {(key: string, options: SelectionOptions) => void} SelectHandler
 * @typedef {(key: string | null) => void} HoverHandler
 * @typedef {{key: string, style: string, color?: string, name?: string}} PartyToken
 * @typedef {string[]} PaletteSeeds
 * @typedef {ReturnType<typeof import('./party-token.js').createPartyToken>} PartyController
 */

/**
 * Common lifetime contract for synchronous and incremental build factories.
 * Incremental builders additionally flush pending chunks for snapshots and own
 * a disposal hook. The renderer owns the mesh/material resources in either case.
 * @typedef {object} MapBuilds
 * @property {() => import('./incremental-map-builds.js').Presentation | null} active
 * @property {(layout: import('./incremental-map-builds.js').Tile[], source: import('./incremental-map-builds.js').Tile[], style: string) => void} show
 * @property {() => void} clear
 * @property {() => void} [flush]
 * @property {() => void} [dispose]
 */

/**
 * @typedef {object} RendererOptions
 * @property {SelectHandler} [onSelect]
 * @property {HoverHandler} [onHover]
 * @property {(key: string) => void} [onPartyMove]
 * @property {() => boolean | void} [onPartySelect]
 * @property {boolean} [motion]
 * @property {boolean} [touchMultiSelect]
 * @property {boolean} [navigation]
 * @property {import('three').ColorRepresentation | null} [background]
 * @property {boolean} [transparent]
 * @property {boolean} [groundShadow]
 * @property {string} [artStyle]
 * @property {(context: import('./incremental-map-builds.js').BuildContext) => MapBuilds} [createBuilds]
 */

/**
 * @typedef {object} ControlsOptions
 * @property {HTMLElement} host
 * @property {import('three').WebGLRenderer} renderer
 * @property {import('three').Scene} scene
 * @property {import('three').Group} map
 * @property {ControlCell[]} cells
 * @property {{line: import('three').Material, hover: import('three').Material}} materials
 * @property {() => void} draw
 * @property {() => void} [requestHover]
 * @property {SelectHandler} onSelect
 * @property {HoverHandler} onHover
 * @property {PartyController | null} party
 * @property {boolean} [touchMultiSelect]
 * @property {boolean} [navigation]
 * @property {() => Picker} [picker]
 */

export {};
