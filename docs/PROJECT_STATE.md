# Project state

## Implemented capabilities

Wilderness Almanac provides editable isometric maps, a campaign library, Low poly
and optional Pixelart rendering, palettes and time-of-day lighting, a draggable party
token, fog of war, and Party Journal notes, dice, oracle and abstract draws. Campaigns
save in browser IndexedDB; optional self-hosted accounts provide explicit remote
copies. See the [user guide](USER_GUIDE.md), [development guide](DEVELOPMENT.md),
[storage contract](BROWSER_STORAGE.md), and [self-hosting guide](SELF_HOSTING.md).

The generation rules below describe the checked-in implementation. They do not
claim validation of every seed, palette or physical device. Names and rule data
come from `src/data/world-rules.json`; there is no runtime spreadsheet connection.

## Coordinates, version and topology

Only generator **10** is supported. Older versions and unversioned seed links are
rejected; there is no cross-version conversion. Generation and dressing replay are fixed for version 10. JSON transfer envelope
versions are separate from the generator number.

Ordinary maps use a radius-12 footprint of **469 hexes**, with six Voronoi regions
of 76/77/89/88/73/66 cells. Region borders are not drawn and do not interrupt geography.
World axial `q,r` coordinates and cell keys are seed-independent. Region-local axial
`x,y` coordinates combine with `regionId` as `#region:x,y`; region origins convert
them back to world coordinates. Hex centres are roughly 18 km apart.

Directions are N `(0,-1)`, NE `(1,-1)`, SE `(1,0)`, S `(0,1)`, SW `(-1,1)`, NW `(-1,0)`.
The reserved `heliotest` seed has seven hexes in one region: a central unnamed
level-1 town, then clockwise from north mountain/nest (4), dense pine forest (3),
light ash forest/abbey (2), ocean (0), meadow (0), vineyards/encampment (1).
It uses the same editing, dressing, fog, party and rendering paths.

The website footer has a separate 14-hex scene at `/embed/footer/`, prepared at
build time from an explicit winding coastal-to-mountain trail. It shares ordinary
dressing and Pixelart rendering without adding a campaign seed or persistence
format. Its selection is independent of the hero; their time of day is shared
by the website.

## Generation rules

Each stage uses a seed-derived named random stream. String seeds of 1-128 characters are accepted, with surrounding whitespace trimmed. The world is JSON-compatible and has schema/generator versions. Dressing has a separate variant and placement seed per cell, so its regeneration cannot consume geography randomness.

1. **Coast selection:** 60% chance of any coast. Further continuation probabilities are `0.7553 * 0.94^i` for i=0..4, giving approximately 8% unconditional probability of all six edges. Neighbouring selected edges receive higher weights. All boundary cells facing a selected side are ocean; unselected outer sides remain land, including their boundary steps, except shared coastline corners.
2. **Land shape:** ocean grows from those sides through a smooth, multi-scale spatial field. Targets and ocean caps use the actual regional cell counts. The target ranges from 20-80% relative to coastal regions, with an 80% per-region ocean cap before coastline cleanup. Connectivity, mandatory edge water and cleanup can constrain the final ratio. Region boundaries do not restart the field. A connected mainland remains, with irregular bays and peninsulas. One-cell-wide tip chains are limited to two cells: interior tips are shortened, while protected map-edge arms are widened without disconnecting the ocean. Coastlines are clean hex borders.
3. **Coastal islands:** only interior ocean cells with an ocean buffer are eligible. Island groups have 1-5 cells, with declining size weights 58/23/11/5/3. Separate islands retain at least one ocean hex between them and any other land. Nearby groups can form an archipelago when space permits.
4. **Lakes:** 0/1/2 attempts per region, weighted 55/35/10. Size weights for 1-5 cells are 50/25/13/8/4. Growth is connected and chooses a round or elongated bias. Lakes avoid coastlines, the map boundary, islands and other lakes. Candidates are outside the central 62% of the map radius so they do not truncate most central river sources. Single-cell lakes are the exception to the same-lake-neighbour rule. A fully inland map receives at least one lake as an outlet.
5. **Rivers:** a world-scale least-cost drainage field starts at open water. Cubic noise-based routing costs form winding drainage corridors. Sources favour longer paths in the central 45% of the radius, with at least five cells to an initial outlet. Paths remove tight triangular detours and join existing rivers without lateral unconnected contacts. When four or more steps follow one axis, a local one-cell bow is attempted on either side, keeping the same endpoints and rejecting self-touching paths or occupied cells. Constrained reaches may remain straight. A 100-seed comparison reduced four-step-or-longer straight reaches from 236 to 2 (maximum 11 steps reduced to 4). Every river cell has exactly one downstream neighbour. The directed network is acyclic and terminates in a lake or ocean; it supports confluences and never splits downstream. The drainage rank is available as a constraint for future elevation. Width grows gently with downstream progress and accumulated flow, capped at a half-width of 0.255. Attempts may be omitted when there is insufficient inland room.
6. **Bank geometry:** smooth curves share world-space widths and island fields. Small sinusoidal meanders have zero offset/derivative at their ports, preserving smooth joins. Barriers retain land along every dry neighbour of a river cell. Clipped bank tops join adjacent land at its actual height, with sharp shoreline walls. Terminal river widths no longer jump to 0.7: rounded bank extensions flare inside the receiving open-water hex instead. River isles use smooth capsule fields. Ocean/lake tiles keep clean hex borders outside mouth patches. Tile body rings meet at the full hex radius, eliminating the 0.995-radius gap. River banks use the exact land bevel crease at radius 0.92, the same 0.075 drop, the same bevel material, and separate face normals. An aligned mesh ring prevents smoothing across that crease. Water triangles are clipped to the wet channel using the same shoreline intersections as the bank, removing the full-hex water plane that could show through dry corners. Land/water triangles cover the whole tile without gaps. Adjacent dry land keeps its ordinary bevel.

7. **Elevation:** level-4 mountain ranges are placed first in connected, elongated groups of 4–12 hexes. Inland sites favor deep land away from water and small islands are excluded. A second range, when land area permits one, has a 35% chance of favoring a water-adjacent site for dramatic cliffs. Insufficient inland space can omit a range. Lower terrain combines coherent noise with water distance; relaxation limits ordinary slopes to one step. Three land-connected rings of foothills descend from the ranges, without crossing water. Larger distance from water generally means higher land, capped at level 3 outside ranges.
8. **Local relief:** islands independently choose a summit of level 0/1/2/3 with weights 4/4/2/1, descending by one step within their 1–5-cell footprint. They never use level 4. Mainland canyon attempts occur on 65% of seeds: a bending, non-self-touching dry path of 4–7 level-0 cells has a complete rim of level 2 or more. Cliff attempts occur on 80% of seeds, raising 1–4 connected water-adjacent cells to level 2 or 3. Hill attempts occur on 80%, with 1–3 connected cells at least two levels above every surrounding cell, capped at 3. Features reserve space around each other; attempts can be omitted when no suitable site fits. Mountain ranges are never carved or raised by these accents.

Rendering uses `0.34 + min(elevation, 3) * 0.22` for dry land: level-4 mountain tiles have exactly the level-3 base height, with mountain props above it. This preserves visibility behind higher ground; these are stylized mesh units, not real-world altitude. Rivers, lakes and ocean stay at level 0 with water top 0.2 and river banks 0.14 above it. Raised adjacent tiles form cliffs using their existing side walls, while the river tile keeps its matched bevel and clipped water. Level-4 cells identify their mountain range in data and the selection label.

Mountain props use one continuous height field per range, shared full-radius edges inside it, and a taper to the tile base around its perimeter. Mountain dressing follows a wandering main crest with secondary ridges rather than every hex-centre connection. Coherent summit heights and variable ridge widths mix broad rounded ranges with occasional taller, steeper sections. The base field stays under 1.2 mesh units above the tile. `mountain-ridges.js`, `ridge-surface.js` and `mountain-surfaces.js` prepare plain numeric geometry; Three.js only renders it. Regenerate reshapes the ridges without moving their footprint or changing elevations. Saved mountain locks without a profile retain their low-relief shape.

## Names, terrain and props

Names use their own seed stream and a 30-by-30 vocabulary based on the checked-in rule snapshot. Local display-word substitutions, including Timeless in place of Pale, retain every entry's original position and modifiers. These rename generated worlds without changing their terrain, dressing or generator version; saved campaign names remain unchanged. The UI uses sentence case. For each terrain code (M, LW, DW, W, PL, F), opposing modifiers cancel; each net positive multiplies its weight by 2.1, bounded to 0.3–3.2. This makes effects visible without overriding water, slope or settlement constraints.

Terrain and settlements follow the snapshot order and suitability rules:

1. Dry land starts as meadow, except level 4, which stays mountains. A coherent canopy field selects woodland, favouring inland cells and fresh water; woodland coverage is bounded to 10–64% of eligible land. Coherent parts of these clusters become dense woodland, with an upland/range-edge bias. A separate smooth field chooses deciduous/evergreen species, with evergreen trees favoured at higher elevation.
2. Wetlands replace meadow at levels 0–1, within two hexes of fresh water or on canyon floors. They favour water proximity and coherent wet patches. A minimum of 28% of all dry land remains unsettled meadow/farmland, clearing wooded edges first if needed.
3. The generator rolls regional settlement plans before choosing sites: one city, two town and five village opportunities, capped at two cities/towns combined and four villages. If all three major opportunities succeed, a uniformly random one is removed, so cities do not reserve a slot ahead of towns. Placement still handles larger footprints first. Regional open-water coverage reduces rolls after name/slider modifiers, reaching zero at 90% ocean/lakes; footprints may occupy at most 20% of dry regional land. Sites favour water, meadow/light woodland and gentle elevation. Elevation 3 and adjacent jumps greater than one use one combined 0.3 suitability multiplier. Villages additionally permit level-4 mountain slopes with that same multiplier; towns/cities do not. Wetlands and dense forest remain excluded. Separate settlements retain two intervening hex steps. Default city size rolls remain 50/40/10 for one/two/three cells. Multi-hex footprints remain connected, level and within one region; an unplaceable size is skipped, not shrunk.
4. Farmland replaces remaining meadow within two hexes of any settlement footprint, at levels 0–2, favouring water and closer settlements. Name modifiers affect its conversion probability. Settlements are an overlay (`pointOfLight` and `world.settlements`), preserving their underlying terrain.

`props.js` generates plain descriptors from the seed plus a separate dressing variant. It shares `prop-placement.js` fit/spacing rules and renderer components, preserves light bottom-right token clearance, dense touching crowns, occasional sparse tiles and optional equal-height forest connections. Low grass and rocks can occupy the token clearance. Forest dressing keeps species coherent; mountains retain a few flank trees. New components add wetland puddles and reeds, farmland wheat fields, and a city hall assembled from the existing house and tower components. Cities use smaller, denser buildings than towns/villages.

Farmland dressing has a 20% vineyard opportunity on elevations above zero. All remaining farmland uses golden wheat fields. Existing wheat/vineyard selection rolls and descriptors are preserved; retired crop-row choices now generate wheat. Wheat uses broad, irregular convex patches fitted to the hex edges and clipped around roads, POIs, trees and the small token reservation. A close, staggered carpet plants the full outline, including corners, with dense stalk sampling; a stationary golden ground layer closes visual gaps beneath the canopy. Grain patches and vineyards have subtle local rolling relief that returns to the tile surface around each reserved footprint; gameplay elevation, tile edges, roads and POI clearance remain unchanged. Vineyards add trellises, foliage and small grape clusters, and read as Vineyards in map labels and read-only Inspector terrain metadata. Edit mode offers Farmlands and Vineyards as cosmetic choices over farmland terrain; Regenerate releases unlocked overrides. Half of optional farmland trees bear round fruit, using a deciduous crown and an accent colour selected for contrast against the current palette. Crop styles and fruit choices survive locks and JSON replay. Frozen crop descriptors retain their saved placement data; retired rows render as rectangular wheat fields. Import compatibility retains the legacy plots value, but new farmland never generates it.

Settlement dressing distinguishes sizes. Villages target two to four cottages (mean three), retaining their optional tower; all village roofs use light straw material roles and cottages add low-poly thatch strips. Cottage walls are 15% lower than their town equivalents, retaining the same roof size. A separate stream adds a short timber fence to 60% of eligible villages, still excluding mountain slopes and respecting POI/token/road clearance. Town placement, counts and models are preserved. Cities target 14 houses on the centre hex and 12 on other footprint hexes, at scales 0.31–0.38; 85% of houses have two or three storeys, with upper windows. Their ambient grass and rocks are omitted. `settlement-props.js` reserves two or three consecutive outer perimeter edges for a simple crenellated stone wall, excluding edges shared by the same city. Fence/wall capsules reserve their actual narrow shape before building placement and yield POI/token areas. The renderer's shared settlement builder retains existing town/POI components.

Forest placement is prepared by `forest-props.js` over entire connected, equal-height woodland components. Randomly rotated, overlapping canopy lobes span the component in world space, with no hex-centre or side-direction anchors. A component-wide tree budget and spatial index distribute trunks through these patches, enforcing spacing across shared edges. Dense/light/sparse woodland weights retain different densities; occasional outliers and gaps break up the canopy. Trees are then stored under their owning hex for the existing renderer and picking. Shared-edge `links` are boolean permissions for crowns to meet, rather than instructions to plant straight connector rows. Water, settlements and height changes bound components; trees yield token spaces and POI footprints, including POIs in adjoining hexes. Canonical component traversal makes tree placement independent of cell iteration order. Tree dressing is independent of world geography, names, settlements and POIs.

`forest-types.js` derives cosmetic profiles from the seed and final woodland footprint without mutating the world. Connected cells of the same deciduous/evergreen family share a type and cluster ID, across light/dense terrain and elevation changes. European flavour types are oak, beech, birch, ash, pine, spruce, fir and taiga. Taiga requires at least seven connected evergreen hexes; smaller clusters that roll it fall back to pine, spruce or fir without changing other clusters’ names. The selector reads “Dense pine forest”, for example, while taiga always reads “Taiga”; existing POI suffixes remain. Names are independent of dressing variants. Forest cells directly adjoining the opposite tree family have a 42% seed-bound chance of mixing. Mixed cells retain their cluster name, start with one tree of each silhouette when at least two fit, then roll a 30% minority contribution. Interior cells stay in their original family; canopy placement still clips cliffs and preserves spacing and reserved areas.

In Pixelart mode, the renderer gives these species distinct lit 3D foliage models and richer colours. About 40% of eligible light-forest, lone or outlying deciduous trees render as birch, while names and generation stay unchanged; fruit-bearing trees keep an orchard form. Crown batches use coarser solid geometry once their original voxels become subpixel, while close-ups retain the detailed models. Simplified crown shadows, packed vertex attributes and compact atlases reduce forest rendering and memory costs without changing placements, wind or picking. The accepted evergreen rules, weighted taiga mix and shared tree-rendering constraints are collected in [ART_STYLES.md](ART_STYLES.md).

Pixelart also converts grass, stones, wetland puddles/cattails and both farmland appearances to restrained pixel textures. Coarse solid forms handle stones, puddles and vine foliage; indexed crossing cutout blades handle grass and dense wheat without increasing triangles per wheat plant. Seeded placements, coverage, relief, names, crop styles, saved locks and all clearances remain unchanged. Texture/material variants share the existing palette, fog, lighting, wind and disposal lifecycle.

Remaining settlements, landmarks and crossings use pixel masonry, plaster, timber, roof and detail textures, with selected stepped roofs, towers, arches and radial forms. Props retain weaker palette influence and native material identity. Rivers/banks, roads and mountains use projected pixel textures over unchanged numeric surfaces. Ground receives palette-led soil patches and sparse meadow/woodland foliage marks; rivers and open water share pixel ripples, with open-water depth shading and stepped drifting waves. Mountains use the palette ridge colours and irregular stone patches instead of bands. Tile-base geometry remains unchanged, while sides/bevels gain quiet dirt pixels. Cairn, Warden and Waystone use stepped, textured models and retain their original selection ring and interactions. POI glows have 50% larger radii and 30% more strength. Cities retain the larger radii with softer windows and substantially dimmer ground pools, extending across adjacent visited dry ground/bevels at matching heights; lighthouse reach, width and landing radius grow by 50% with 30% more strength. The smooth lighting style, village/town glows, fog restrictions, selection and hover remain unchanged. Bridge and ferry components join the prop batches to reduce draw calls. See the pixelart guide for ownership and review constraints.

Warm props include deciduous trees, settlement buildings and crops; evergreen/wetland props use cool variations. Per-prop temperature has four strength levels, shifts OKLCH hue at most eight degrees toward red or blue, and preserves each role's lightness/chroma. The three palette seeds and unshifted colours are unchanged. Materials are cached by role and temperature and update when the palette changes.

Deciduous canopy scales span 0.55–0.80, preserving approximately the same mean and using the actual size for spacing. Evergreen scales retain 0.57–0.77. Deciduous crowns alone add one of three cached foliage tones: −0.014/0/+0.014 OKLCH lightness and −2/0/+2 degrees of hue, on top of their existing temperature. Trunks and evergreen crowns retain their prior colour rules. Tones stay bounded and update with palette changes; materials share the existing wind/shadow path and remain batched.

Existing mesh components are baked into global material/shadow batches to avoid thousands of prop draw calls. Triangle ranges retain the original hex identity for picking. Tree sway uses per-vertex height weights so roots stay anchored, with matching shadow deformation. It has a six-second sway. Dawn, dusk and night retain the original strength and one brief stronger gust every 24 seconds; Day has 20% stronger sway and a gust every 18 seconds. Sparse wave marks appear only on open water, away from river mouths, with at least one intervening hex between sites. They drift in one seed-bound direction, fading at each end of a 14-second loop. Motion renders at up to 20 fps, pauses in hidden documents, respects reduced-motion settings and can be paused with the saved Movement switch without advancing the world or dressing.

Hover picking uses spatial bounds over tile ranges within those batches, avoiding a scan through distant prop triangles while retaining exact visible-mesh selection and foliage detail ranges. The latest mouse position is picked immediately before the shared frame renders its highlight, without a separate picking-frame delay. Input frames remain independent of the ambient-motion frame cap.

Wetland reed stalks, heads, blades and low grass use the same wind time/direction and gust cycle, with shorter height normalization and lower displacement than trees. Roots retain zero sway weight. Separate reed/head material roles retain the former colours, so ordinary grass, rocks and buildings stay static. Animated materials and their tinted clones use the same wind shader and matching depth material; all vegetation shares Movement, reduced-motion and hidden-document handling.

## Responsive map palettes

`map-palette.js` resolves the named material roles used by the renderer. Ground lightness shifts by −0.11 to +0.24 OKLCH L, water initially by −0.09 to +0.12 and elements by −0.045 to +0.035. Smoothstep responses soften at both ends; quiet input bands preserve the three retained original presets. Tops, bevels, ridge faces, shore surfaces and water shades share family offsets. The side/trunk/door/bridgeDark/soil/riverCliff/ridgeDark roles keep their fixed colour path, including warm/cool variants. Shadows, lighting, geometry and world generation are unchanged. This preserves the Thronefall-inspired dark anchors while supporting brighter, darker and saturated surfaces.

Material contrast safeguards adjust the nearest usable water-family shade to maintain at least 1.35:1 against ground and between waterEdge/riverShore, main foliage at least 1.5:1 against ground, and selection at least 2.5:1 against ground/water. Wave and hover colours also have separate safeguards. These ratios describe material colours before lighting and transparency; sample browser checks complement the numerical checks. Family shading remains coordinated; protected shadow faces deliberately retain deeper contrast on brighter maps. Twenty-step chroma fitting preserves hue/lightness and avoids unnecessary desaturation from coarse gamut reduction. Raw seed colours remain the saved/exported/shared values. UI colours are independent of renderer material colours; see the design-system guide for light/dark schemes.

The nine presets are Verdant Kingdoms, Autumn copper, Dusk & gold, Ember coast, Forbidden Lands, Frozen synapse, Moss & bone, Sands of time and Thronefall. The Palette manager inside Settings pins Verdant Kingdoms first, sorts all other bundled and custom palettes alphabetically, supports inline custom colour/name edits and saves a default for new campaigns. Verdant Kingdoms is the initial default and renderer fallback; deleting a custom default restores it. Undo deletion restores the palette and its default setting unless a newer default was chosen. Existing campaigns retain their saved colours. Raw colours from removed presets remain replayable as custom palettes. Changing a campaign's palette does not change the library default.

House/tower plaster is brighter (base L 0.87), with element chroma scaled to 0.12 and capped at 0.022. Its lightness follows the palette weakly and increases when needed to separate it from crowns. Roof finishes derive a stable five-way choice from existing building detail seeds, consuming no placement randomness. Clay, ochre, slate and timber tones mix their hues with the element seed; slate has a wider hue allowance but lower chroma. Roof components of the same house/tower share a finish. Village straw keeps narrow hue/lightness variations. Colour variants remain cached with the existing prop material/wind/shadow batching and recolour on palette changes. Existing replay saves remain compatible; their rendered colours gain these safeguards.

## Points of interest and crossings

`points-of-interest.js` runs after farmland, using independent seed streams and keeping terrain, settlement and elevation data intact.

Each region rolls 1–4 ordinary POIs; regions with at most two settlements gain one slot. Ordinary POIs have at least one intervening hex within their region, and one POI at most occupies a cell. Availability can reduce the budget in constrained regions. Mystic sites and ordinary battlefields have one-quarter the base type weight. A watchtower or stronghold has a separate 12% chance of a neighbouring meadow battlefield, which does not consume a regional slot.

Suitability follows the checked-in rules: ruins favour mountains/dense forest/islands/wetlands and avoid settlement proximity/farmland; camps favour meadow/light forest; watchtowers favour elevated meadow, settlements and especially cliffs; strongholds favour levels 2–3, mountains and farmland, avoid wetlands, and are capped at one per region. Lairs favour wetlands/mountains/canyons/peninsulas/islands and strongly avoid settlements. Mystic sites favour peninsulas/islands/lakes. Abbeys favour farmland and nearby villages/towns. Battlefields favour meadow. Dungeons strongly favour mountains. Current generation allows mines alongside watchtowers and mystic sites on settlement cells; dungeons within three hexes of any settlement become mines. Coastal watchtowers use a lighthouse 50% of the time, and lairs split 40% cave / 60% nest.

Current generation uses a bounded deep-forest multiplier for ruins and mystic sites. On dense-forest hexes, count the 18 surrounding positions within two hex steps: zero extra weight through nine dense neighbours, rising by 1/6 per additional dense neighbour to a maximum multiplier of 2 at fifteen. This caps the ordinary ruins forest weight at 8 before settlement/farmland penalties; it is not a quota on forest ruins. Encampments gain 1.5× weight within one step of rivers/lakes, 1.2× within two, otherwise unchanged. Abbeys gain 3× weight on whole islands of one to three hexes, retaining existing farmland and settlement-distance factors. Stronghold and lair weights, POI budgets/rarity, wilderness bonus slots, spacing and crossing rules are unchanged.

Mountain villages fit house/tower footprints to the numeric ridge surface, reject sampled height spreads above 0.12 mesh units, and use terrain-matched footings without flattening or breaking the mountain mesh. Fences are omitted on these mountain hexes. These footing descriptors retain the existing lock/export/import validation and follow locked mountain surfaces during replay.

POIs are seeded overlays (`cell.pointsOfInterest`, `world.pointsOfInterest`); their locations, kinds and named subtypes remain fixed through Regenerate. Local hex regeneration cycles unnamed cosmetic model variants and detail seeds without changing the world feature. Watchtower detail seeds choose between roofed and battlemented models; local regeneration can change that cosmetic appearance while retaining the Watchtower subtype, and lighthouses retain their model. Locks and saved local dressing preserve those cosmetic choices through export/import. Models include ruined gatehouses, temple arches and broken tower walls; 1–3 canvas tents with a campfire; roofed watchtowers, battlemented watchtowers with a rooftop banner, and lighthouses; fortified keeps, round-tower fortresses and walled halls; caves/nests; portals/altars/standing stones; unmarked chapel-style abbeys; banners with 1–5 larger skulls; and mine/dungeon entrances. Stronghold variants change central buildings, corner towers, roofs and battlements. Encampments and abbeys use warm hues; other ordinary POIs use cool hues. The renderer shares the existing material cache, building components and global prop batches.

Watchtowers, abbeys and strongholds retain local `x=0.5, z=0.16` with a 0.245-radius corner footprint. Encampments, ruins, lairs, dungeons, mystic sites and battlefields use `x=0.43, z=0.14` and radius 0.32, enlarging their models by about 31% while staying inside the lower-right tile corner. `poiAnchor` supplies the same per-kind reservation to dressing, neighbouring forest spacing and settlement barriers. All props, including low grass/rocks, yield their entire footprint plus clearance; trees have extra sway clearance. Mountain foundations use twelve sampled boundary heights and the ridge material, hiding their skirt in the slope rather than extending a uniform cylinder down to the lowest sample. Foundation orientation is independent of the model's facing. Empty POI-free tiles retain their existing light token clearance; world elevations and mountain-range meshes are unchanged.

Cave, mine and dungeon frames use extruded geometry with a genuine aperture. The dark tunnel backing matches that aperture and sits behind the frame, so surrounding rock/masonry occludes it. Mines add timber lintels/posts, sleepers, rails, a cart and ore; dungeons add a barred entry, steps, keystone and lanterns. Cave lairs have a rocky threshold and a skull; nests have layered twigs and larger eggs. Mystic sites have a full portal ring, raised altar/orb or three runed standing stones. Subtype names appear in hex labels without changing their seeded world kinds/variants.

Crossings are separate from POI budgets and stay on the river channel. Each settlement/nearby river network uses a 50% bridge / 30% ferry / 20% neither roll, triggered by a river within three hexes of any settlement cell. Sources redirect to their downstream neighbour; mouths redirect to their upstream neighbour. Only interior non-confluence river cells can receive a crossing, so very short rivers may receive none. A redirected site can be one hex farther from the settlement. Crossings on the same connected river network must be more than five hexes apart, regardless of crossing type. The existing numerical site finder validates dry banks and avoids river isles using exactly the same channel/bank field as rendering. Wooden bridges serve villages; towns/cities use stone (the rule snapshot allows either for towns, and this retains the existing size rule). Ferries retain two docks and a boat, scaled to fit narrow channels.

## Roads

Generation creates a sparse road network after settlements, POIs and crossings. The map-wide budget is `floor(dryLand * min(0.20, 0.10 * effectivePL))`, using the same positive and negative name/settlement-slider weights as settlement planning. Shared ordinary road hexes count once; settlement/POI interiors and crossing approaches do not consume the budget. Only complete connections are accepted. Manual roads are outside this generation budget.

Priority is cities, towns, crossings/strongholds, villages/abbeys/watchtowers/lighthouses, then ruins. Every eligible destination attempts a route; ruins have a seed-bound 10% eligibility roll. Destinations first seek the nearest reachable equal/higher-ranked location, falling back to lower ranks. Multi-hex settlements are single destinations with perimeter access. Weighted paths favour meadow/farmland, penalize dense forest/wetlands and share existing roads when a modest detour suffices. Mountains, mountain destinations and jumps of two or more elevation levels are forbidden. Successive one-level climbs are allowed. River routing separates the two dry banks and uses only existing bridge/ferry edges; a road may terminate at one bank. It never creates a new crossing.

Topology belongs to the world; curve shapes, junctions, small stones and local earth ramps belong to dressing. Shared edge ports remain fixed through global/local regeneration, and locks retain shape seeds. Roads use terrain-family materials with a 0.05 OKLCH lightness lift above their tile surface; small road stones are another 0.02 lighter. This keeps them subtly visible without a contrasting network overlay. Trunks, buildings and crops yield narrow corridors; walls/fences gain local openings. Short roads inside feature tiles preserve visual continuity without adding a road suffix. Ordinary hexes with one or two exits read “with a road”; three or more exits, including T-junctions, read “with crossroads”. Settlement, POI and crossing names retain precedence. Undiscovered fog tiles contain no road geometry.

Inspector road exits edit reciprocal connections and reject impassable sides. Added destinations do not trigger generation. Removed destinations or invalidated routes remove only their original generated links, retaining shared segments used by surviving links. Version-3 edit records keep removed-link IDs, so re-adding a destination does not resurrect its roads or reallocate budget. Undo restores the previous network; reset restores generated defaults.

## Interaction and rendering contracts

Hex and party selections are exclusive. Hex selection shows Inspector and the
reserved Journal panel; party selection shows one combined Party panel. Multiselect
edits commit atomically with one Undo action. Party movement marks destinations
visited without moving the camera. Find party explicitly focuses the token.
Mobile panels begin closed below the map; desktop supports remembered sizing and
folding. Unsaved forms guard navigation and selection changes.

Party Journal artwork derives from saved result text, including older entries
without command metadata. The newest abstract and newest oracle entry across the
campaign show artwork by default; older entries start as compact text. Clicking
an entry, or using its keyboard disclosure, toggles artwork. Manual choices last
while that campaign remains open and are not saved in campaign data. Entry actions
and mentions do not toggle the artwork. Expanded entries have two columns with
shared spacing and padding: artwork on the left, top-aligned result text on the right,
and actions at the lower right. A shared 94-pixel artwork column aligns result
text across both kinds. Cards render at 94 by 194 CSS pixels; oracle dice at 64 by
64, centered in that column. The die's top face matches the displayed result
after modifiers and clamping. The numeric badge remains available for reading
and copying.
Artwork retains pixelated scaling. Local PNGs belong in
`public/images/major-arcana/` and `public/images/oracle-dice/`.
A light, chroma-limited color derived from the UI surface hue supplies a 33% CSS
multiply wash, masked by the same PNG's alpha. One isolated wrapper keeps the
tint within the artwork; black pixels remain black. Oracle dice are desaturated
before the tint layer is applied.
Unavailable images fall back to the saved text; artwork adds no campaign fields
or backend requests. The 22 card images are by YY Game and retain their
[separate usage terms](../public/images/major-arcana/README.md). Oracle dice are by
Ävos Grosimbourg and retain their [usage terms](../public/images/oracle-dice/README.md).

Fog derives visited, visible-unvisited and undiscovered presentation from saved
visits; structural editing requires fog off. See [fog rules](FOG_OF_WAR.md).
Campaign maps render incrementally through retained React Three Fiber chunks;
creation previews, thumbnails and embeds keep the synchronous renderer. Fog
concealment and stale-work cancellation are immediate, while uncached reveals
arrive over multiple frames. Chunking favors early progress and localized visits,
not minimum draw calls or the shortest full-map reveal. See the
[renderer ownership contract](DEVELOPMENT.md#incremental-campaign-rendering).
The UI theme is independent of map palette and lighting. Appearance choices stage
until Save, except immediate map regeneration. See [design system](DESIGN_SYSTEM.md).
Low poly remains the default; Pixelart carries a resource warning and shares the
same generation and campaign data. See [art styles](ART_STYLES.md).

Preserve orthographic/isometric composition, low-poly geometry, saturated accents,
deep tile sides/trunks/recesses and light token clearance. Shared renderer owners
must dispose geometry, materials, textures, listeners and scheduled work.

## Current limitations

- Hex exploration and the hex Journal are reserved UI; Explore hex and `/explore` do nothing.
- No automatic cloud synchronization, recovery-file import, or cross-generator conversion.
- No additional tokens, billing, arbitrary map sizes, ground-level walking, rainfall/erosion,
  elevated watercourses, waterfalls or through-flow river lakes.
- Renderer bundle size can trigger the build's chunk-size advisory; map code loads lazily.
- Automated checks are available, but automatic CI and mobile CI runs remain paused.
  See [verification commands and limits](DEVELOPMENT.md#setup-and-verification).
