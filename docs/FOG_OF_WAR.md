# Fog of War

Fog of War is a local presentation mode for showing the campaign map to players. The switch in the desktop map header or mobile map’s top-right corner remembers its state per campaign and defaults to off for new and older campaigns. It does not create a separate player link or remove information from campaign backups. Seed copying and sharing are available only in the campaign list; those links recreate the full generated world without its visited flags.

## Discovery and sight

The existing visited flags are the only exploration record. Each visited hex supplies sight; visible neighbours are **unvisited**, and everything else is **undiscovered**. Unvisited hexes never supply additional sight. Removing a visit or undoing it can therefore hide an area again. A manually unvisited party position does not supply sight merely because the piece is there. Moving the party marks its destination visited as before.

Sight radius is one hex by default, two at elevation 3, and three on mountains or at elevation 4. A watchtower (including its lighthouse variant) or stronghold adds one hex; multiple landmarks do not stack. A town or city adds another hex, stacking with the landmark bonus. A mountain town with a watchtower therefore has a five-hex radius. Villages add no bonus. An intermediate hex at least two elevation levels above the source blocks farther sight; the blocker itself can still be visible. Sight uses actual edited world data, independent of placeholder heights, model sizes and camera direction.

Sightlines run from source centres to target centres over the complete hex footprint, including between the six axial directions. Segment clipping includes edge and corner contacts; an intervening high hex touching the line blocks it. Tied contacts are treated together to avoid orientation-dependent openings.

Ocean and lake water reached within ordinary sight radius extends the line across the continuous water stretch to its first land hex, even beyond normal range. That first shore is revealed but does not extend the line further. Islands stop the extension; rivers do not start it. At a tied contact, land stops the water extension. Another visited source can independently reveal land behind a blocker or island.

An inland visited hex above elevation 1 can also look over lower land to reach open water beyond its ordinary radius. Each elevation level above 1 adds one hex to the distance at which the first ocean/lake hex may be reached: elevation 2 adds one, elevation 3 adds two, and elevation 4 adds three. Normal landmark/settlement bonuses still apply. An elevation-3 source with a normal radius of two can therefore reach water four hexes away, then see along its continuous water stretch. Every intervening hex must be lower than the source; equal or higher terrain blocks this additional water view, including corner contacts. A source adjacent to any ocean/lake hex is coastal and receives no inland allowance; rivers do not make a source coastal.

The additional inland view reveals only water. It does not uncover the skipped land, reveal a new far shore or hop over islands. Ordinary land visibility and water/shore visibility already available within the original rules remain unchanged. As with other sight, every visited source contributes; moving away from a visited high point retains its view until that visit is removed.

## Presentation and editing

- **Undiscovered:** a complete blank elevation-1 hex in the palette's UI-background family, retaining borders and shadows. Its Inspector and dropdown expose only “Undiscovered hex” and coordinates, plus the action to mark it visited. Proximity rows and terrain/feature fields are hidden.
- **Unvisited:** real terrain, elevation, natural props and settlements in grayscale. Only watchtowers/lighthouses, abbeys, ruins, strongholds and crossings are visible. Other POI models, foundations and labels are omitted.
- **Visited:** ordinary full-colour geometry and information.

While fog is on, Hex and Party Inspector proximity calculations consider only discovered features. Switching fog off immediately restores proximity to all actual features; switching it on filters them again. Hidden POIs on unvisited tiles do not qualify; empty results say “None discovered”. Joined settlements retain their existing identity and distance rules, using only discovered footprint hexes as targets. Party visited-land totals use the actual world, including river-bank hexes and excluding open water.

Fog mode supports single/batch visited marking, selection and party movement. Terrain/feature editing, Join, Reset, dressing actions and setting world icons require fog off. Undo of visits and party moves remains available; structural Undo requires fog off. Toggling fog does not enter Undo history and uses the existing dirty-form guard.

Drag-and-drop party placement works on desktop and mobile in either fog mode. On mobile only, tapping a destination with the party selected opens a confirmation. Party placement keeps its fresh-pointer activation guard and Cancel-to-select behaviour. Confirmation names come from the filtered dropdown, so unknown destinations remain unnamed. Unknown shells also supply the heights used for selection, focus, picking and party placement.

## Implementation boundaries

`application/fog-of-war.js` computes visibility without DOM or Three.js. The session caches its result by effective world and visited flags. `application/fog-view.js` produces masked display cells and numeric render descriptors without changing the authoritative world, dressing or saved locks. It closes shared sides at undiscovered boundaries and removes hidden-owned props before batching and shadow rendering.

The main coordinator retains the full numeric layout for campaign-library thumbnails and a separate display projection for the campaign map and Inspector previews. Tracking does not regenerate worlds or dressing. Identical classifications reuse the display layout; changed classifications rebuild map meshes once while preserving camera framing. Creation previews and menu thumbnail caches remain ordinary GM views.

The renderer keeps one map build per role (`rendering/map-builds.js`): the source layout's full meshes, glow batches and picker stay resident while a fog projection of it is shown, so turning fog off reattaches them instead of rebuilding and re-uploading the map, and the previous projection is restored the same way when nothing changed. The coordinator passes the source layout with each projection; a new source layout (world edits, regeneration) or art style releases every build. Memory while fog is on therefore matches the ordinary GM view rather than shrinking with the fog. `createFogViewer` in `application/fog-view.js` reuses the plain view and the fog projection while world, layout and the session's visibility map are unchanged, which is what gives the renderer a stable layout reference in both directions.

The renderer's material registry owns cached grayscale and placeholder variants, including tinted props. Grayscale materials retain foliage/wave shaders and update with palette changes; disposal includes all variants. The shared still preview renderer uses the same descriptors, and hidden previews clear immediately to avoid stale full-map details.

Only an optional boolean `fogOfWar` is added to campaign saves/exports. No computed visibility, generator-version change, new envelope version or external service is introduced. Existing campaign imports and visited flags remain compatible.

## Focused verification

`node --test tests/fog-of-war.test.js tests/campaign-session.test.js tests/map-controls.test.js tests/rendering.test.js` covers visibility, coastline/blocker rules, projection, material lifecycles, persistence, allowed actions and existing renderer fixtures. Browser inspection should cover desktop/phone layouts, cached previews, visit/Undo updates, dirty-form toggles, saved-mode reloads, palette changes and party confirmation/cancellation. Viewport emulation does not establish physical-device touch correctness. Automatic GitHub workflow runs remain paused.
