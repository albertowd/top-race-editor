# The engine in TypeScript

The goal: the editor builds a track on its own, in TypeScript, with no Python and without kart-velopark's tools.
Until then, kart-velopark's Python is the reference. The track the port builds is checked against the one the
Python builds, and a fix found on either side is made on both. When the port builds a track that matches,
kart-velopark's build is retired.

## The pipeline

The Python build goes over the whole map again and again: a full build spends about 19 of its 23 minutes in three
whole-map steps (merging the floor, 7 min; restyling the paddock, 6 min; draping everything over the terrain,
5.5 min). The port does not copy its steps. It builds the track in layers, each made from the one under it and only
where something changed:

1. **The place** (the whole map, made once): the heights, the satellite picture and the height filter map (the
   zones where buildings and trees stand). They hardly change once made. A new building or tree zone remakes only
   the tiles under it. Only this layer works on the whole map.
2. **The roads**: each road's mesh from its curve, its heights from the place. Each road is cut into the ground and
   merged with the roads it meets only inside its own footprint. A road changed remakes that road, the ground
   under it and its joins, nothing else.
3. **The lines and the rumbles**: laid on the roads, each on its own road's surface (where it is along the road
   and across it). No search of the map.
4. **The objects**: placed as they are. They do not change the ground or merge with anything, so each only needs
   the height under its points (the road there, or the ground).

**Finding the right point** is direct, not a search of the map: the heights are a raster read by position, the
road meshes are in a grid of tiles (a point's tile, then the few faces in it), and a line or rumble knows its
road. **No validation in the build**: the meshes are made right as they are generated (no holes, faces looking
up), and the checks run in the tests and the parity cases, not in every build. Each layer's results are kept by
their inputs (each tile, each road), so a build after an edit remakes only what the edit reaches.

## Using the whole computer

The work in each layer is split into parts that do not depend on each other, and the parts run at the same time:

- the place's tiles;
- the roads, each in its own footprint (roads that meet are joined after, only where they meet);
- the lines and rumbles, each on its own road;
- the objects, in batches, each only reading heights.

## Where the engine runs

There is no server and no Python. In the desktop app the engine runs in a window of its own that is never shown
(the engine window): our TypeScript, with the files on disk open to it, its workers and the graphics card in the
same process. It outlives a reload of the editor's window, so a build goes on. The editor's window talks to it
through a message channel (one module, [src/api/client.ts](src/api/client.ts), the page's way to the engine as
today). Outside the app (`npm run dev`, the tests, CI) the same engine code runs in Node, on the processor only.

The engine's code does not reach for files, the network or workers itself: it is handed them (the files of a
track's folder, a way to fetch, a pool), so the same code runs in the engine window, in Node and in the tests.

**How many at once is not fixed.** The engine runs the parts on a pool of workers (web workers in the engine
window; worker threads in Node), so neither window ever waits. It measures the computer as it goes:

- **Processors:** at most one worker per processor the system offers, less one for the window.
- **Memory:** before it hands a worker a part, it checks the memory free against what that part needs (estimated
  from its size: its points and faces). It waits instead when that would leave too little, and starts more as
  memory comes free.

Each part costs only its own memory. The big inputs (the heights raster, the picture's zones, the road meshes
already made) are shared between the workers, read-only, not copied to each. The build dialog shows the workers
at work: how many, what each is on, the memory used.

**The graphics card** (WebGPU, which Electron's Chromium has, in the engine window and its workers; not in Node) is
used where it is clearly faster and the work suits it:

- reading heights for very many points at once;
- drawing the roads' footprints and the zones into the height filter map;
- laying meshes' points on the surface under them;
- working out normals.

Triangulation and outlines stay on the processor. The processor's path is always there and is the one the parity
cases check; a part goes to the card only when it has been measured faster there and comes out the same within the
tolerances. The card works in 32-bit floats: about 0.1 mm a kilometre from the origin, well inside the 1 cm the
track is compared to, and as precise as the games' own models.

## How the two are kept in sync

- **Parity cases** (`parity/`): each case is an input (a track's data) and what the Python makes from it.
  `npm run parity` makes the references again from the Python on this computer, runs the TypeScript on the same
  inputs and compares.
- **The same track, not the same steps**: the layers make the track differently from the Python's steps, so the
  comparison is of what a driver gets.
  - Heights sampled on a grid over the roads and the ground: within 1 cm.
  - Each road's outline: within 1 cm.
  - Where each line and rumble lies, and how high: within 5 mm.
  - Where each object stands, and its height: within 1 cm.
  - The models' names, materials and layouts: exactly.
    A difference is a failure, named by case, place and value.
- **Where the code is the same**, as reading models or a road's curve to its points, outputs are compared exactly
  (positions within 1e-6 m).
- **When it runs**: on every change to the TypeScript engine (the tests run the cases against the committed
  references, also in CI), and again whenever the Python changes. Each reference records a hash of the Python
  files that made it, and `npm run check` fails while they have changed and the references have not been made
  again.
- **The same libraries**: Shewchuk's Triangle (`triangle-wasm`, as Python's `triangle`) and GEOS (`geos-wasm`, as
  shapely) are the same C code built for WebAssembly. A grid index and union-find stand in for scipy's kd-tree and
  graphs; plain typed arrays for numpy.

## What is not ported

What only Velopark needs (restyling its paddock, its outside buildings, shifting its pit entry, merging its old
models) is not ported. The buildings and other models already made become models placed on the map, as the
scenery is.

## Objects as placements, not meshes

What stands on the map many times over is kept as where it stands, not as its meshes: one model each (a tyre stack,
a tree, a kart, a pole) and a list of placements in the track's data, as objects.json already has the tyre walls
(curves), the poles (spots) and the scenery ({model, x, z, heading}). Velopark keeps them baked: velopark_tyres.glb
is 140 MB (2.6 million vertices of tyre stacks), velopark_trees.glb 92 MB (1.7 million of a few trees); as
placements they are a few kilobytes and one small model each.

The copies are made only by the build, into its output, never kept as sources: in parallel (each tile's), merged by
material in each tile for Assetto Corsa (few draw calls, each mesh under its 65536 corners; trees drawn only to a
distance), as BeamNG's own forest items where it places copies itself. One-off shapes (the paddock's buildings, the
judges' tower) stay models.

## The steps

Each step is done when its parity cases pass; the next starts after.

| #   | Step                                                                                                                                                                                         | From the Python                                                        | State     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------- |
| 1   | Foundation: the parity harness, the vector helpers, reading and writing glTF and kn5 models, the tile grid, the worker pool, the engine window and its message channel                       | `gltf_source`, `kn5tree`, `build_paths` (its mesh helpers and surface) | done      |
| 2   | The place: the heights raster, the picture, the height filter map and its zones, read by position                                                                                            | `terrain`, `elevation`, `terrain.py`                                   | done      |
| 3   | The roads: a curve to its mesh, the ground cut and the roads merged inside each road's footprint                                                                                             | `roads`, `surface` (its full merge), `track_surface`, `read_road`      | done      |
| 4   | The lines and the rumbles on their roads                                                                                                                                                     | `build_kerbs`, `paint_roads`                                           | under way |
| 5   | The objects: grid, pits, timing, poles, tyre walls, marks and scenery, each at the height under it; the copies made from placements (Velopark's tyres and trees turned into placements once) | `place_objects`, `place_karts`, `place_trees`, `objects.py`            | done      |
| 6   | Out to the games: the AC track and the BeamNG level, packed                                                                                                                                  | `build_tracks`, `export_beamng`, `kn5io`, `build.py`                   | done      |
| 7   | The rest of the engine in TypeScript (the track's files, the wizard, the tracks opened); the page on the engine window only. The app ships no Python                                         | `server.py`, `geometry.py`, `wizard.py`, `providers.py`, the rest      | done      |
| 8   | kart-velopark's build retired                                                                                                                                                                |                                                                        | to do     |

## Step 1

In [src/engine/](src/engine), all of it run in Node by the tests:

- `kn5tree.ts`, `gltf.ts`: the game's models read and written, glTF to kn5 and back (`kn5tree`, `gltf_source`). The
  editor's 16 models and two Velopark fixtures (`parity/fixtures/`) come out byte for byte as the Python makes them:
  as a kn5, as a glTF again, every node's vertices and faces. Normals, tangents and spheres are worked out in 32-bit
  floats one operation at a time, as numpy does.
- `mesh.ts`, `surface.ts`: a model's meshes and triangles, a mesh's sphere and split, and the surface over triangles
  (`build_paths`: `meshes`, `triangles`, `sphere`, `split`, `Surface` with `y`, `ys`, `near`, `nearest_y`). The
  heights on a grid over each model match the Python's within 1e-9 m.
- `pool.ts`, `node-pool.ts`: the worker pool, sized by the processors and the memory free before each part.
- `tiles.ts`: the map in 64 m tiles, and things filed by the tiles they lie on.
- `host.ts` and [src/api/engineport.ts](src/api/engineport.ts): the engine's calls over a message port. The desktop
  app runs the engine window (`engine.html`, served by the app itself at `app://top-race/`) and hands each editor
  window a port to it. Its one call so far, `info`, is shown in the Build dialog (the processors and the memory).

`npm run parity` makes the references again from the track's Python (parity/make_refs.py) and runs the parity tests:
the editor's models and the fixtures always (their references are committed), and every Velopark model when the
track is next to the editor (parity/out/, not committed). Every Velopark model
(23, 348 MB, the tyres' 140 MB among them) comes out the same: the Python makes their references in 20 s, the
TypeScript reads and checks them all in 30 s.

## Step 2

- `ndimage.ts`: scipy.ndimage as the terrain uses it (gaussian, uniform, minimum and maximum filters, grey opening,
  map_coordinates linear and cubic, its spline prefilter and padding), against scipy on a grid in and round it
  (parity/refs/ndimage.json), within 1e-9. The uniform filter keeps scipy's running sum, so a mean on a rule's edge
  (a pixel exactly as dark as the tree rule) falls on the same side of it.
- `pictures.ts`: Pillow's grey from colour and its box shrink, in its integer arithmetic: the Velopark photo (8192
  pixels a side to 1060) comes out byte for byte.
- `npz.ts`: numpy's .npz files (the raster edits), deflated or not.
- `polygon.ts`: inside and distance to a ring, exactly (shapely's contains_xy and distance). A building's buffer is
  the ground within its metres of it, exactly; shapely draws its rounded corners in short straight pieces, so a height
  within a few centimetres of a corner's line may fall the other side (none do at the Velopark).
- `place.ts`: the place (terrain.py): the heights, why each is not the ground (trees in the picture and the photo,
  buildings, over the ground round it, areas), the grids filled from them, the edits (raster, offset, flat, smooth) and
  the ground, cubic or linear, read by position.

Checked on a small terrain made up for it (`parity/terrain_fixture.py`: something of every filter and edit;
committed, so in CI) and on the Velopark's: its 25,822 heights get the same reasons, and the grids and the ground on
61 x 61 points over it and past its edges come out within 1e-9 m. The pictures are read as Pillow decodes them
(saved beside the references); in the app the engine window decodes them (Chromium), which is left to check.

- Read fast and the same: an edit changes the ground only in its box (its ring and its easing, its raster's or smooth's
  grid), so a point works out only the edits whose boxes it lies in (`Ground`, by the tiles): the very same heights
  as every edit everywhere, checked on both terrains.
- Kept between builds: the layers by a key of the description, the files it reads (by name and size; the edits' by
  their bytes) and a version, in the engine's own cache folder (`%APPDATA%/top-race-editor/cache/place`, not the
  track's). A new zone or filter makes the place again whole: the fills blur over up to 320 m, so a zone reaches far
  past its tiles; worked out again it takes 8 s at the Velopark.
- In the app: the engine window reads the track's files through its preload, decodes the pictures with Chromium
  (every pixel of the Velopark's two the same as Pillow's) and answers `place.heights`. The Velopark's ground there
  is the Python's within 1.6e-14 m: 8 s worked out, 25 ms from what it kept, 3 ms after that.

## Step 3

Checked first on the kids layout (its roads 1ROAD_KIDS_0, _0B, _1, _2 and _5: almost done, so what a build of it
gives is known), then on every road.

**3a, a road's mesh** (`roads.ts`, the track's roads.py): its middle (Bezier pieces, or a Catmull-Rom spline through
points), its fine rows square to it every 10 cm (turned at its ends into the rows of the roads it joins), its inside
narrowed where it turns tighter than it is wide, its lines every 0.5 m each keeping its own points, the strips
zipped between them, its heights (recorded, or from a ground), its mapping; a run-off as the road along its road's
edge it is; the roads' order. numpy's own ways are kept where the mesh's shape hangs on them (its interp, gradient
over uneven steps, unwrap, arange, linspace), so every one of the Velopark's 43 roads comes out with the same points
and faces (counted, its faces by their SHA-1), and the kids layout's and the run-off point for point within 1e-9 m.
Done.

**3b, the merge**: the roads cut into the ground and into each other, edge to edge, point for point, one height a
point. The Python merges the whole map at once (every outline noded with every other, 7 minutes); over the kids
layout alone it takes 2.2 s, so the time is in doing the whole map every time, not in the way. The port:

- each road's part not under a road before it, from only the roads whose boxes meet its own (the tiles);
- polygons on the Python's 0.1 mm grid as whole numbers (Clipper2: no rounding to go wrong), shared edges noded and
  cut every 0.5 m the same way from both sides;
- each part filled as the Python fills it: its own triangles wholly inside kept, the rest by Triangle (the same C
  library as the Python's `triangle`, built for WebAssembly), the ground with a point every 2 m and no triangle
  over 4 m²;
- the ground in tiles, each filled by itself (in parallel), its heights eased from what borders it over 1.5 m;
- a road changed: only its part, the parts of the roads it meets and the ground tiles under it made again;
- proved as the Python proves it (every edge of two faces, but on the window's edge; one height a point; the window
  covered once), in the tests, not in every build.

Its targets: the Python's merge (parity/merge_refs.py: its roads and the place's ground, no rumbles yet) of the kids
layout (6 regions, 64,232 faces, 2.2 s) and of every road (`--all`, by hand: a window round them all, 44 regions,
1.6 million faces, 106 s), both without a problem in its proof. The Python's merge is not right everywhere either,
so the two are judged by what each is made from, the top every 0.25 m (the kids) or 0.5 m (every road): the ground by
the place's own ground (but within 2 m of a road, where it eases into it), each road by its own mesh. The port is to
be no further from them than the Python's overall, further by over 1 cm at under 0.1% of the points, with the same
region over each point.

So far for 3b:

- Triangle runs as WebAssembly (`triangle.ts`) with glue of our own, the same in Node and the engine window (the
  package's own loader fetches its file, which Node cannot, and ends the process on an error): on the same input and
  switches it makes the very same points and triangles as the Python's `triangle`. Its memory is fixed at 16 MB, so
  the ground is to be filled a tile at a time.
- Polygons by Clipper2 (`clipper2-js`) on the 0.1 mm grid as whole numbers. Two faults of that port worked round: its
  tree of polygons fails (its flat result is used, each hole put in the smallest outer ring round it), and its union
  of a mesh's triangles leaves the mesh's inner edges in as slits of no width (taken out of every ring).
- `merge.ts`: the Python's merge (outlines, seen parts, an outline's points snapped onto what is over it, the edges
  noded and cut every 0.5 m alike from both sides, each face filled, the heights, the ground eased) and its proof.
  Over the kids layout it gives what the Python's gives: every region's area to the 0.1 m², its faces within a few,
  no problem in the proof, and of the 128,000 points every 0.25 m none more than 1 cm off (the most 6 mm), none of
  another region. 4.7 s, of which 2.9 s is the outlines (a union of each road's 20,000 triangles at once).
- The outlines from each mesh's own edges (those no two of its triangles share, chained into rings): the union of its
  triangles where none overlaps another. A mesh folded over itself on a tight turn (the Python's `folded`: its
  triangles whose insides meet another's, found exactly on the grid's whole numbers) has its folded triangles made one
  with the rest's rings, and they are never kept as they are in its fill (the fill covers them), as the Python does;
  without that the fixture's roads came out with 191 open edges.
- Each road cut only by the roads before it whose outlines come within 1 m of its own, not by all of them; a ground
  point's height looked for only in the roads whose outlines are over it; a point in a face found by its band of
  edges, not all of them.
- The ground in tiles (64 m), each a face of its own (the tile less the roads' feet near it); a tile's edges cut at
  the ground's own spacing (2 m from 0), the same from both sides, and the world's edge too (the Python's has no point
  on it but its corners, so its ground runs straight from one to the next: 0.45 m off the place's at the kids window).
- Each face a job of its own (its rings, its road's triangles near it, the ground's spacing), filled where the filler
  says: here, or on the worker pool (`merge-worker.ts`; each worker its own Triangle). The kids layout: 0.9 s here
  (the Python's 2.1 s).
- What a merge made kept for the next (`MergeCache`): each outline by its mesh's triangles, each face by what it is
  made from. A road edited: its faces, those it meets and the ground's tiles under it filled again, the rest kept;
  the same surface as a merge from nothing (tested).
- In the app: the engine's call `roads.merge` (a track's roads.json, its place; a road without heights of its own
  laid on the ground), on the engine window's web workers, its cache kept a track at a time.
- Faults the whole map found, each mended: a folded mesh's union of its thousands of folded triangles at once
  (minutes in clipper2-js: made a few at a time, then two by two, each union's paths cleaned before the next, as
  clipper2-js fails on its own repeated points and slits given back); a hole thinner than the grid (no point in it for
  Triangle, its triangles out after, as the Python's); a pocket of the outside a ring touching itself closes (Clipper
  gives that where shapely gives a hole: the fill's triangles whose middles are outside the face out); a ring the
  noding left of no area, or with a spike out and back (both sides alike: gone from both); and the noding itself:
  Clipper rounds each operation's crossings by itself, so the same edge from two operations can lie a unit or so
  apart (GEOS's fixed grid, the Python's, leaves them noded): a point within 2 units of an edge put in it, and again
  after the edges are cut, until none is.

Where 3b stands (every road, 19 workers): 17.5 s (the Python's 106 s), no problem in the proof. The ground 0.28 cm
rms off the place's (the Python's 4.32 cm), further than the Python's by over 1 cm at 134 of 453,113 points, nearer at
7,580; the roads 0.07 cm rms off their own meshes (the Python's 0.06 cm), further at 2 of 158,476 points. The kids
layout: 2.4 s on workers (0.9 s here; the Python's 2.2 s), the ground 0.09 cm rms off the place's (the Python's
3.60 cm). In the app (the Build dialog's "Merge the roads (new engine)": the engine window's `roads.merge` on its web
workers, the track as saved, proved, nothing written): every road in 14.8 s, the roads read and their meshes made
included, no problem; again with nothing changed 8.4 s, every face kept (of which the proof 2.5 s).

Faster again (every road, 19 workers, in Node): 13.4 s, again with nothing changed 2.7 s (was 10 s). A point of the
heights and meshes stages keyed by a number of its own (two grid coordinates from the world's middle, exact within
3.3 km of it), not a string: those stages 9 s to 2.7 s; a region's triangles on the grid and in cells kept in the
MergeCache by its triangles as given: the outlines stage 1.2 s to 40 ms when kept. In the app: 15 s, again 7.4 s (the
merge 2.2 s of it; the roads' meshes and the place 1.3 s, the lines 1 s, the proof the rest). And points closer than
WELD (1 mm) made one, every region's alike (the one on the world's edge kept): the whole map's 8 faces without area
(of 1.6 million: a rumble's tip, tiny ground triangles) gone; the Velopark's merges proved to have no face down or
without area (`previews.ts`'s `wrongFaces`), the ground and roads as near what they are made from as before.

## Step 4, so far

- `paint.ts`: each road's edge lines as the Python lays them (roads.py's `line_strip`, `line_runs`, `dashes`;
  build_roads.py's `keeps`: a road's lines forked where a branch leaves and joins it, its line areas grown or shrunk
  as the points within that of them), and each rumble's geometry (build_kerbs.py's `geometry`: its kind's profile, its
  back ramp, its tapering ends, its reach inside a curve, near another road its end down to that road, its pieces on
  one road and the next made one strip). Against the Python (parity/refs/paint.json: lines and a rumble of each kind
  added to the made-up roads; parity/out/velopark_paint.json: the Velopark's 51 lines and 41 rumbles) point for point,
  within 1e-9.
- The rumbles merged first, over everything (merge_floor's order), laid on the roads' own meshes (their surface, the
  nearest road point's height where none is under them): `roadRegions`, for the app and the tests alike. The Python's
  merge references made again with them: the kids layout (11 regions, 2.3 s) and every road (85 regions, 104 s). The
  port: the kids layout 1.4 s, every road 18.9 s, each region's area the Python's to 0.1 m²; the roads and rumbles
  0.06 cm rms off their own meshes (the Python's 0.05 cm), the ground 0.28 cm off the place's (the Python's 4.33 cm).
- The edge lines laid on the merged roads and rumbles (paint_roads' `lay_on_roads`): each from its road's own mesh,
  every point onto the surface under it nearest its height (within 0.5 m), LINE_LIFT over it; its faces under a
  rumble's raised part out (by their middles: the Python cuts them along the rumble, the paint's rows 0.1 m apart).
  Every road's: 0.10 mm rms off LINE_LIFT over their own roads.

- The marks and start lines (place_objects' `marks`, `start_lines`): laid on the road only, LINE_LIFT over the floor,
  in `roads.merge` (`markPaint`, `startLinePaint`).

- The track's floor made by the engine (`trackfloor.ts`; merge_floor.py in the editor's layers, TRACK_FORMAT's
  track/models): the hand-made floors of the models laid on the place by drape_track's rule (a paved top ROAD over the
  ground, the grass on it; an old kerb moved by what the road beside it moved, carried out to it within CARRY, else by
  what the ground moved under it), the old kerbs along roads with rumbles described out (build_kerbs' old_kerbs,
  parts_of), merged with the roads described and their rumbles and the place's ground over a window round all of it;
  each region's mesh written back into the model it came from, in its material, one normal at each point across the
  seams (`floorwrite.ts`). The far ground made again round it (far_terrain.py's: from the merged floor's own edge
  points out to the land round the pictures, a point every 20 m on the place's ground, mapped onto FarGround.dds).
  The Velopark's whole floor in about 34 s, proved (no open edge, none of three faces, the far ground meeting it with
  no gap); against the track's own (a 2 m grid): the roads described 0.01 to 0.02 cm (median), the old kerbs 0.01 to
  0.9 cm, the paddock 0.2 cm, 89% of all points within 1 cm. The ground's bigger differences (to 53 cm) are far from any
  floor, where the track's near ground is its hand-made mesh draped by its points, the engine's the place every 2 m.
- `geos.ts`: the merge's booleans on whole polygons by GEOS (geos-wasm 3.13: the C library under the track's
  shapely), each polygon made valid as buffer(0) makes it, each result put on the grid as set_precision(GRID) puts it;
  a folded mesh's outline GEOS's union of its triangles. clipper2-js's booleans never ended on some of the Velopark's
  hand-made shapes (the paddock's floor, an old kerb's top, a ground tile less the paddock's feet). Still clipper's: the
  outline of a mesh not folded (its edges chained, exact) and the road previews (`previews.ts`).
- The merge on hand-made meshes: a mesh's points within 1 mm of one put on the grid before it made that one (its
  modeller's unwelded seams closed, else cracks a unit wide the ground filled as spikes); a region's outline without
  holes thinner than a sliver (a seam left open is the region's); the noding within 0.75 grid units (GEOS's rounding
  reach) where clipper's needed 2 (more pulled a neighbour's point a few units off an edge into it).
- `trackbuild.ts`: the track made by the engine from its source: the hand-made models read, the floor, the paint laid
  on it into the paint's model, the objects into the shared model and the layouts' own, places.json and the objects'
  lights, every model written as glTF. Not yet run in place of the track's model steps (the Build dialog's).

Left for step 4: the engine's track build checked against the track's own, model by model, and the build running it
in place of the track's model steps.

## Step 5, so far

The objects as objects.json (version 3) has them, laid on the merged floor: place_objects.py's game-neutral part.
What each game makes of them (AC's dummies, its physics objects, its models' lists, the Custom Shaders Patch's
lights; BeamNG's) is that game's build's, step 6, as TRACK_FORMAT.md has it.

- `templates.ts`: the catalogue (the editor's one, models/catalogue.json, each model a .glb beside it; the track's
  templates' .npz made .glb, the same points), each model's parts read, templates' `world`.
- `laying.ts`: where an object's copies stand (`wall_stacks`, `object_places`), its model shaped (scaled, a bent
  one turned along its curve), placed on the floor under each copy (`object_placed`, less its sink) or bent along its
  curve end to end (`object_bent`), a wall's collision band (`wall_band`), a static one's boxes; the trees whose
  trunks stand on a solid object's ground (`clear_trees`' gone). Against the Python (parity/out/velopark_objects.json:
  the Velopark's 336 objects on a tilted floor: each one's places, each laid part's counts, faces, sums and first and
  last points, its band and boxes; its 3,447 trees, the one cleared) within 1e-9.
- In the app: `roads.merge` lays them on the floor as merged (all 336 of the Velopark's in 0.4 s); the editor's own
  models shipped beside the app (electron-builder's resources), the engine window told where (`modelsDir`).

- `places.ts`: the layouts' places (TRACK_FORMAT's places.json; place_objects' `layouts` and its physics objects, 2b):
  each layout's grid slots, pit boxes, hotlap start and timing gates on the floor, its dynamic objects (the knockable
  cones and boards) on the floor less their sinks, in objects.json's order; `roads.merge` makes them on the merged
  floor, a dynamic object no longer laid as a mesh. A spot stands as high over the floor as it stood in the places
  before (the Python keeps each marker's height over the floor, from the old track's models its build restores); agreed
  with the track's tools: every spot 0.5 m over the floor once the format says so (`SPOT_LIFT`, the `lift` option).
  Against the Velopark's places.json: every spot's name, place and heading, every pit count; the physics objects in
  its order and places, within 1 cm on the roads, within 6.7 cm on the ground (the Python's merged ground is 4.3 cm
  rms off the place's; these stand on the place's).

- Taken in from the track's place_objects (kart-velopark, step 8): a copy rests where it would (rest_heights: a
  model on feet, its base in three pieces or more, on the highest floor under its base's middle and corners; one on a
  base of a piece, under its middle), its static boxes as high; the copies of a model with nothing to hit merged, a mesh
  each (model, part, material, draw), past MERGE_MAX points another; a catalogue model's `draw` (the kart's [0, 60]) its
  parts' distances unless its lods name them.

- The trees as placements (`tracktrees.ts`, the track's place_trees.py; `treesfile.ts`, the editor's trees.py): the
  track file's `trees`, [{model, x, z, heading, scale}], each a catalogue model of kind "tree" (the Velopark's 53
  variants and its understory, made once into templates by its tools; or an editor's tree, of kind "trees"); laid by
  the build sized by its scale (its hull too), turned and stood on the floor under its middle, those on a solid
  object's ground cleared (`treesGone`); merged in TREE_TILE (50 m) squares by part, under MERGE_MAX points a mesh
  (EUCA_<PART>_<i>_<j>_<n>), then the trunks' unseen walls of every square (1WALL_EUCA_TRUNKS_<i>_<j>_<n>), into
  `<id>_trees.glb`. The page edits them as single objects of the trees' kind among the others (`editing/trees.ts`:
  read in, saved apart), the track's own tree models learned from its catalogue and from the trees placed, drawn as
  their crowns.

## Step 6, so far

- `dds.ts`: a track's PNG textures made DDS for AC as its build makes them (materials.py's `ac_dds`, kn5io.py's
  `dds`, Pillow 13): the PNG read (8-bit RGB or RGBA, as the track keeps them), a normal map's green turned down, a
  DXT mip chain down to 4 pixels (each level the one before halved by Pillow's LANCZOS: its coefficients, its two
  passes, down first where the height shrinks most, as Pillow 13 does; RGBA premultiplied for it, its integer
  formulas) or one level (sides not powers of two, uncompressed), each as Pillow's DDS writer and BCn encoder write it
  (its float32 arithmetic). Against the track's own (parity/refs/dds.json: made-up textures of each kind, always;
  out/velopark_dds.json: the Velopark's 101): byte for byte. (pictures.ts's box resize given Pillow 13's pass order
  too.) The track's build reuses the last DDS of an unchanged texture (build/cache/dds: the old track's own DDS, so
  its AC build stays as it was); the editor's build reuses it too.
- `acbuild.ts`: the AC build (build_tracks.py's `build_ac`, ac_places.py): each model of source/models read with the
  material library (its AC names and flags), a layout's places put in as AC's nodes (an empty node a spot; a physics
  object an AC_POBJECT_n of its hull, unseen, and its parts under a node named after it, a material brought from the
  model that has it), its textures made DDS, written as a .kn5; source/track copied beside them (what it has no more
  taken out, the models' kn5s kept); each layout's pit boxes in its ui_track.json; only what changed made again (each
  model by the SHA-1 of what it is made of). Against the track's own build: the Velopark's 24 kn5s and 89 track files
  byte for byte, in 7.9 s; built again, nothing made. In the app: the Build dialog's "Build for AC (new engine)", the
  engine window's `build.ac`.

- `beamng/`: the BeamNG level (export_beamng.py, beamng_races.py, beamng_board.py, beamng_grass.py, track_models.py),
  made by the engine from what it makes for the track (track/models, places.json, the trees' places beside their
  model) and the AC build's AI lines (the layouts' racing lines), in build/beamng, packed as
  build/dist/<track>_beamng.zip, every file dated now: `trackmodel.ts` (a model's meshes with what they are, as
  extras.track says), `dae.ts` (the shapes as Collada, BeamNG's layout of details and collision meshes), `images.ts`
  (8-bit PNGs, opacity maps), `grass.ts` (clumps on the green ground near the racing lines), `board.ts` (the gantry's
  LED characters and board.json), `races.ts` (the time trials, the races against karts, the cone sets as vehicles),
  `network.ts` (the road network, one road where layouts share one; each race's checkpoints kept on its lap),
  `level.ts` (the rest, and the zip). Only what changed is written again. Its random places (grass) seeded, not
  numpy's; its names' ids stable, not uuid5's bytes. What was the Velopark's own in the Python (its footpaths across
  the infield, its pit lanes' widths) is the track's data: track.json's `beamng`. The pictures (JPEG read and made,
  the starts' maps with their names) are Chromium's, in the engine window. On the Velopark: the same shapes as the
  Python's (300 detail shapes of the tyre stacks, the same triangles), 8 starts, 762 waypoints, every race's AI on its
  lap, in 17 s (20 s again, every shape as before). In the app: the Build dialog's BeamNG.drive, with the editor's
  engine.

## Step 7, so far

The Python engine's calls moved into the engine window a few at a time, the app working all the while: the page's
client (src/api/client.ts) asks the engine window first (its `api` call: src/engine/api.ts), which answers the calls
it has and says `handled: false` of the rest, which go to the Python (outside the app: `npm run dev` still runs it).
In the desktop app the page waits for its engine port (handed over as it loads: the preload's `topRaceDesktop`)
before its first call, and asks the engine window which track is open (its `project` call).

Every call is the engine window's now, and the desktop app runs no Python (desktop/main.mjs): it serves its own page
(app://top-race), starts the engine window on the track named (--project), else the one opened last, else the
Velopark next to the editor, and packages no Python (electron-builder.yml; scripts/bundle-python.mjs is left unused).

- `pyjson.ts`: JSON as Python's json writes it (a number as it was read, a new one as repr writes it, ASCII escaped,
  json.dump's indent and separators; the file's own line endings): the track's roads.json, objects.json,
  terrain.json and materials.json read and written again byte for byte.
- `trackfiles.ts`: the track's settings (config.py: its track file, where its files are, its cache), the roads
  file (roads_store.py: the roads for the page; a page's edits merged, each key popped and put back as the Python's
  dict does; the file before kept in backups), a road given by points fitted a curve (geometry.fit_curve), Python's
  round(x, 4). Against the Python's roads store on a page's edits (parity/refs/roads_store.json, the made-up roads;
  out/velopark_roads_store.json, the Velopark's): the file it writes, byte for byte.
- `objectsfile.ts`: the objects file (objects.py's clean, version 3: checked, rounded, written as it writes it, its
  numbers floats where it makes them; the file before kept). Against the Python's clean (parity/refs/objects_store.json,
  made-up objects; out/velopark_objects_store.json, the Velopark's 336): byte for byte. A file of version 2 read as
  version 3 (objects.py's clean_v2 and convert): against the Python's on made-up objects of every way it goes
  (parity/refs/objects_store_v2.json; the Velopark's file was version 3 from its first commit), byte for byte. None yet:
  read from the models (read_models), each layout's places from places.json; the markers inside a layout's model
  (before the format's step 2b) and the poles' and tyres' meshes (empty since the track's e014f13) not read.
- `previews.ts`: the page's looks at the roads as built, level (geometry.py's mesh and surface). A road's mesh cut
  where it lies under the roads above it (roads.py's `above`: built before it, its extent met, not joined end to end):
  the roads above (within its box and half a metre) cut in cells, each halved till its part has few points (a face in
  none kept, one wholly in a cell it fills gone, any other clipped by the parts it meets: the Velopark's 41 roads in
  13 s, not minutes), the faces across the edge kept as their parts outside, ear by ear, the roundest first, no sliver
  (under THIN) nor one turned over made. Judged by what it should come to: each road's own mesh less what of its
  outline the roads above cover (2 cm along the covered edge), no face wrong but its own mesh's. The surface: the
  roads' merge over a window, level, proved (`check`) and its wrong faces added (down, without area); over the
  Velopark's middle, covered once, nothing wrong. (clipper2-js's offset is wrong on a road's outline, 1833 m² for 727:
  not used.)
- `satellite.ts` (the engine window's): the satellite picture's tiles cut by Chromium (decoded once, each level half
  the one before, JPEG at satellite.py's quality, the last picture's tiles kept); `/api/tracks` from recent.json and
  the folders next to the track.
- `context.ts`: the track now, seen from above (geometry.py's context, version 3): each model's meshes welded (5 mm),
  their edges no two faces share chained into lines (a line's points simplified from the segment, as GEOS does: 2 cm),
  the tyres' rings by the pieces they make. Against the Python's (out/velopark_context.json): the same items, compared
  by name (a mesh in kn5 pieces all at once), every point within the simplifying of the other's but a few where three
  short edges meet and the two chain them apart (1 in 10,000, a foot at most).
- `bringin.ts`: the road meshes offered and brought in (geometry.py's road_meshes and bring_in, read_road.py,
  describe_roads.py, road_grid.py): by their rows (u -1 to 0), as a strip from the outline, or a ring round an infield;
  each road's widths capped, its curve fitted. The strip: road_grid's four corners of its outline (as it walks it,
  by their turns from point to point), unless another four read a road lying on the mesh much more nearly (what both
  cover over what either does, 0.05 more). The others: of road_grid's outline and of the mesh's three longest loops
  (two touching at a point each its own), among the 20 sharpest corners turning over a metre each side (a car park's
  jags and slits, centimetres, none) and the 12 sharpest point to point; every four judged on a coarse raster of the
  mesh's top faces, the best ten and road_grid's again on cells the mesh covers 4000 of, the widths capped as brought
  in. road_grid's strip of a car park takes a notch in its edge for an end and fans its rows out from it; of a mesh in
  pieces, its longest loop's only. Judged against the mesh by that fit, the Python's by it too, every Velopark mesh
  as near or nearer: the car park 0.45 to 0.83, the paddock 0.21 to 0.40, its pits 0.15 to 0.62, its south way on
  0.21 to 0.93, the pit entry 0.04 to 0.56; the clean strips (the shed floor, the cut path) the same.
- `merge.ts`'s outline of a folded mesh: the folded triangles thinner than the grid's unit left out of their union
  (clipper2-js's union of a few such along a line never ends: the paddock's mesh hung the bring-in's judging).
- `terrain.ts`: the terrain as the page edits it (the editor's terrain.py, on the place): its description checked as
  the Python checks it (the same file, written as json.dumps writes it; the same 34 reasons to refuse one), its
  layers for a description not saved yet (the filters worked out once for each set of rules, the edits each time, a
  brush's raster not saved yet sent with its data), a raster edit's file, and the description saved: its rasters
  written (as .npz), the one before kept with its rasters, then what terrain.py's write makes (original, filtered
  and ground as 16-bit PNGs, heights.json, points.json). Against the Python's (parity/refs/terrain_api.json, the
  made-up terrain, saved on a copy; out/velopark_terrain_api.json, the Velopark's): what it says, the points and
  rasters byte for byte, the grids within one in 65535, the files written the same (the pictures within one, the
  fingerprint of what the ground hangs on the same). A save's fingerprint takes in its rasters' bytes, numpy's zip
  there and the engine's here, so it is proved on the files as they were. The picture of the ground round the track:
  Chromium's, made smaller and JPEG (the engine window's).
- `build.ts`: the build from the editor (build.py): a job in the background, one at a time (the track's
  build/build.lock respected, taken round what the editor does itself), its stages, log, estimate, activity (a step's
  own log read), stopping it. The track's model steps are its own tools still (build_models.py, its checks left out,
  `--until` its last step), run by the engine window (desktop/system.cjs: Node's processes); then the AC track made
  by `acbuild.ts`, installed in the game as build_tracks.py installs it (what changed by size and time copied, what is
  gone taken out), the BeamNG level by the track's build_tracks.py (from the AC build, till BeamNG is ported), the AC
  track packed (7-Zip, else a zip made here). A track whose build_models.py takes no `--until` is built all through
  by its own build, as before. Tested as build.py is (its tests ported: fake builds of the track's kind).
- `providers.ts`, `wizard.ts`: the new-track wizard (wizard.py, providers.py): the providers' keys (on this computer,
  never given to the page), a place found (Nominatim), the map's tiles, a plan checked and estimated, a track made:
  its place, its picture sampled from the provider's tiles, its heights, OpenStreetMap's buildings, its terrain
  (terrain.new() written, its layers made by `terrain.ts`: the track's tools are not run), its map picture and track
  file. The network asked from Node as the editor (its user agent alone, retried as http_fetch is), the pictures
  decoded and made JPEG by Chromium. Against the Python's on tiles made the same on both sides
  (parity/refs/wizard.json): the picture's pixels (its SHA-1), the heights within 1e-9, the track's files the same
  (the JSON byte for byte, the terrain's pictures within one, the ground's lo and hi within 1e-9; the pictures' JPEG
  Chromium's, not Pillow's). The wizard's page asks the engine window too (its tiles as blobs).
- The track open (tracks.py's open): kept by the engine window, another opened at once (no engine started again),
  remembered first in recent.json, the page loaded again on it.
- Moved: every call. /api/track, /api/roads, /api/save, /api/objects (read and written), /api/objects/catalogue,
  /api/drawings, /api/tile, /api/tracks, /api/open, /api/mesh, /api/surface, /api/fit, /api/context, /api/meshes,
  /api/bring, /api/terrain (read and saved), /api/terrain/image, /api/terrain/raster, /api/terrain/layers, /api/build
  (and its job, its cancel), /api/wizard (its search, tiles, keys, estimate, start, job, cancel).

Left for step 7: a first track made with the wizard where no track is open yet (the app opens the wizard then, but
its calls need a track open: they are of the tracks next to it); the Build dialog's "new engine" buttons, which the
build itself now is, taken out once it has been tried.

## rFactor 2

Begun (TRACK_FORMAT.md's `build_rf2`), in `src/engine/rf2`, from the track's data only, never another game's build:

- `gmt.ts`: GMT read and written, every one of ModDev's 762 samples again byte for byte (one encrypted, kept as its
  bytes); the format as found at its top. The 16 bytes at 0x1BC are the exporter's mark, the same in every file of
  a layout, not a signature.
- `aiw.ts`: a layout's AIW from its racing lines as aimake.ts makes them, its grid, pits and timing gates; and where
  its timing beams stand.
- `text.ts`: the SCN, GDB, TDF (each ground's materials matched by the start of their names: surfaces.json's
  `targets.rf2`) and WET.
- `build.ts`: the location, build/rf2/Locations/<venue>, every layout of it: each model's meshes as GMTs in rFactor's
  axes (x, y, -z; faces wound as rFactor's), their textures as the AC build's DDS, drawn with L2DIFFUSET0; copied
  into rFactor 2's ModDev/Locations when asked (the Build dialog's rFactor 2), to try in its Mod Mode.

Not yet tried in the game. Still to do: the lamps, the knockable cones (a GMT each, its pivot its place), the
trackside cameras, the gantry's lights, a lighter ground, and packing (ModMgr's MAS, an rFCMP).
rFactor 2 is installed on this computer (D:/SteamLibrary/steamapps/common/rFactor 2).

What a track is (Studio 397's documentation, and what the game ships):

- Text files: the SCN (search paths, MAS files, views, fog, lights, every object's instance with its shadows and
  draw distances), each layout's GDB (its name, length, place, sessions; its TDF), the location's TDF (each surface's
  grip, sound and bumps), the AIW (the AI's waypoints, the grid, the pits), the CAM (trackside cameras), the WET
  (weather and the road's grip over a weekend). The timing beams (XSectors, the GMTs xfinish, xsector1, xsector2,
  xpitin, xpitout) are a must: a track without them does not load.
- Textures as DDS (Support/Tools/MapConverter, texconv; materials.py's `ac_dds` does as much for AC).
- Meshes as GMT, rFactor's own binary: its layout is not published, the only official writer is Studio 397's 3ds Max
  plugin (Support/Tools/Plugins: Max 2017, 2021; Converter, Material, Texture). No converter from FBX or OBJ.
- Packaging scripted: ModMgr's command line (Support/CLI.txt): `-m<file.mas> files` makes a MAS (`-z1-9`: zlib),
  `-x` takes one apart, `-i` installs a mod; for the game, an rFCMP. Trying a track: its loose files in
  ModDev/Locations, opened in ModDev's viewer or the game's dev mode.
- Two whole tracks to learn from, every file loose: ModDev/Locations/Joesville (Joesville Speedway: its SCN, GDB,
  TDF, AIW, CAM, WET, 86 GMTs) and ModDev/Locations/LochDrummond (581 GMTs), written by Studio 397's own tools. And
  Support/Tools/ModMaker.chm, the tools' help (hh.exe could not unpack it here: try 7-Zip).

What is known of a GMT so far (the smallest of the samples, LochDrummond's xfinish.gmt, 1,964 bytes; and an
open-source importer, haunetal1990's Blender rFactor 2 GMT Importer 0.80, which finds its parts by searching more
than by reading a known layout): a 32-bit number first (1,516 there, where the materials start), a bounding box
from 0x08 (its corners, x y z); the object's position at 0x114; at 0x13C twelve 32-bit numbers, counts and offsets
(vertices, indices, meshes, faces, a 16-byte record each of some kind, materials; each part 4 bytes after its
offset; there: 4 vertices, 6 indices, 1 mesh, 2 faces); the object's name at 0x17C, and 16 bytes at 0x1BC that look
encoded; a vertex 96 or 128 bytes (its position at 0, normal at 12, tangent at 40, binormal at 52, texture places at
64 and 88); a face 32 bytes (three 16-bit corners, a 16-bit, its mesh's number (32-bit), its middle (three floats));
then the materials: their count, each its name (SWHEEL_TRACKMAP), its shader (L2DIFFUSET0) and its textures
(SWHEEL_TRACKMAP.DDS), with their settings.

The plan, when it comes:

1. A GMT reader and writer, proved as the kn5 port was: every one of the 667 samples read and written again byte for
   byte (this does not wait on the format: it can start any time).
2. The text files from the track's data (build/track/ and the source, as TRACK_FORMAT.md has them): the SCN from
   the meshes' roles, draw distances, shadows and lights; the TDF from surfaces.json (its `targets.rf2`); the GDB from
   the layouts; the AIW from the racing lines, the grid and the pits (objects.json); the timing beams from the
   timing gates. Joesville's files as the pattern.
3. The track tried in ModDev's viewer and the game; then packed with ModMgr, and its rFCMP.

## Not a reference yet

- **The merge by regions** (`merge_state.plan`: only the changed zone merged again, in `surface.build`) is wrong
  today (BUGS 48). It has left open edges at the zone's edge and edges shared by 3 or 4 faces, and GEOS has failed
  on its overlay. References are made from the full merge only, until kart-velopark says it is fixed.

## Changes on the Python side to take in

The port follows the Python as it is when each step is done. Changes made to tools on the list before their step
starts:

- kart-velopark's TRACK_FORMAT.md (agreed with the editor): the track's data the same for every game, each game's
  files made only by its own build. For the port: what the build makes (the merged floor, rumbles, lines, objects'
  copies) goes to `build/track/*.glb`, not source/models, which keeps the hand-made one-offs; each node's
  `extras.track` (role visual, surface or wall; its surface; draw [near, far]; shadows) in place of AC's name
  prefixes; the markers made by each game's build from objects.json; a made region's surface from its material's
  `surface` in source/materials.json (the ground grass, paint visual), every material name used (roads.json's, the
  rumbles' Kerb*, the catalogue's) a key there; UVs in the texture's units, exact (a material's `metres`: the
  metres one unit covers; UVs in metres were tried and dropped: float32 does not take uv * m / m back exactly, and
  the tangents made from them flipped where a face's mapping is nearly flat); glow as glTF emissive; a version in every
  JSON. The editor writes terrain.json, roads.json and objects.json; the tools only read them (steps 5 and 6).
- TRACK_FORMAT's step 1 (kart-velopark 2aecacc), taken in: `gltf.ts`'s `MaterialLibrary` (gltf_source's LIBRARY: a
  model holding only its material's name read with the library's data, its own kept there as it is written), its
  textures as PNG (a model's X.dds read as X.png beside it), `materials.ts` reading source/materials.json (read only:
  the track's tools write it). The parity references read the Velopark's models through it (never writing it), the
  editor's own models and the fixtures without, as the track's templates read the editor's. Still to take in, with
  step 6: materials.py's `ac_dds` (a PNG made DDS for AC, in the format the library records for it).
- TRACK_FORMAT's step 2a (kart-velopark 5e0964a), taken in: each mesh of the models carries `extras.track` (its role:
  visual, surface or wall; its ground of source/surfaces.json; `draw` [near, far or null]; `shadows`, `visible` false
  where so) and its own name (1ROAD_KIDS_0 kept as KIDS_0), AC's name and flags made from them: materials.py's Hook
  `node_out` / `node_in`, `materials.ts`'s `nodeOut` / `nodeIn`, called by `gltf.ts` both ways. The parity references
  read the Velopark's models through the track's Hook; every model reads back with the Python's names and flags.
- TRACK_FORMAT's step 2b (kart-velopark 76b5913): a layout's markers (START_i, PIT_i, HOTLAP_START_0, TIME_i_L/R) and
  its physics objects (cones, boards) are no longer nodes of its vp_*.glb but source/models/places.json, made from
  objects.json; AC's nodes made of it by its build (tools/ac_places.py). The editor's Python reads a layout's places
  from it where its model holds no markers (objects.py's read_models, for a track without objects.json). The poles'
  and tyres' models hold empty meshes only since e014f13 (they are objects.json's): nothing read of them.
- TRACK_FORMAT's step 6 (kart-velopark, not committed yet), taken in: each layout's model list is the track file's
  (`layouts.<layout>.models`); the AC build writes models_<layout>.ini from it (track_data.ac_models: CRLF, a [MODEL_n]
  block each), refuses a model the track's models have not, and takes no list from track/ac.
- The racing lines (TRACK_FORMAT's "Racing lines", its step 9): a layout's `lines` (fast, pit: curves in the
  objects' form, closed or not; the pit line's leaves and joins, metres along the fast line) kept by both objects
  stores, written alike. Edited in the page beside the layout's grid and pits (Grid, timing & lines;
  `editing/lines.ts`): each line's nodes and handles as a tyre wall's; the pit line's ends kept on the fast line where
  it leaves and joins it, their handles along it, the fork and merge dragged along the fast line (or typed), the pit
  line following the fast line moved. A layout with none gets its first lines from the AI files the track has
  (`ailines.ts`: track/ac/<layout>/ai, else source/track; fast_lane.ai and pit_lane.ai fitted within FIT_TOL, 5 cm),
  kept when saved. AC's AI files made from them by its build when asked (the Build dialog's "AI lines from the
  racing lines"; else the recorded ones): acai.ts (ac_ai.py's format, byte for byte, its grid made again) and
  aimake.ts (a point every half metre on the floor; its turn, sides, camber, normal and way; its speed from the
  settings the recorded lines were made with: GRIP 12.5, BRAKE 9.1, ACCEL 4 m/s2, TOP 30 m/s). Still to come: a layout
  with no AI files given lines from its roads' middles.
- The comparisons with the Velopark's old build and its Python tools run only when asked (TOP_RACE_VELOPARK=1, the
  list in vite.config.ts): the editor's own output is the reference now.
- TRACK_FORMAT's step 7, taken in: the track's source in one file (`trackdoc.ts`, the editor's trackdoc.py, byte for
  byte: parity/refs/track_doc.json). Each part (`roads`, `objects`, `terrain`, `trees`) read from the track file where
  it holds it, else from the file its key names (or its own file where it names none), in that file's form (the
  objects' and the terrain's versions; a terrain raster edit's file named from its folder in its file, from the
  track's root inline); written only into the track file, its `version` first, its settings where they were, the one
  before kept (track-<stamp>.json), one change at a time. The roads, objects, trees and terrain stores, the merge, the
  build, the bring-in and the place read through it. The wizard still writes a new track's parts as files (the
  Python's wizard, through the track's tools, does): moved in at their first save.
- TRACK_FORMAT's step 5 (kart-velopark), taken in for AC: OCCLUDING_MATERIALS made as GRASS_MESHES is (AC's own list,
  then the library's covers_grass names), each name once in both; a mesh's grass flag kept both ways (gltf.ts).
- TRACK_FORMAT's steps 3 and 4 (kart-velopark, not committed yet), taken in. Step 4: what the steps make is no
  longer in source/: their models in track/models (with places.json, lights_outside.json, velopark_trees.json,
  merged_floors.json; the track file's `models` says so), AC's files they change in track/ac (the layouts' model
  lists, AI lines), laid over source/track by the AC build; a model there points at ../textures, which is
  source/textures where track/ has none (`loadKn5`, as gltf_source's texture_at). Step 3, lights as data:
  source/lights.json (series, lights, screens; colours 0 to 1), places.json's `lights` and lights_outside.json
  (track_lights.py's data); AC's Custom Shaders Patch config made by the AC build (`aclights.ts`, ac_lights.py's:
  AC's own settings, grass on the meshes flagged `extras.track.grass` too, a LIGHT_SERIES each series, a
  MATERIAL_ADJUSTMENT each material glowing only at night and each night response, a SCRIPTABLE_DISPLAY each
  screen, its script tools/ac/screens/<shows>.lua). The Hook's `grass` both ways (`nodeOut`, `nodeIn`); its KEPT
  (what a model's put keeps of an entry) changes nothing here, the library being read only. The editor's AC build
  of the Velopark is the track's byte for byte again, ext_config.ini too; every model of track/models as the
  Python reads it. Still to take in: the catalogue objects' lights (place_objects' object_lights) in the places the
  editor's merge makes.
- `build_kerbs.geometry`: a tapering end rises over its whole taper and is lowered within `OTHER_EASE` of another
  road (`build_kerbs.other_roads`); paint is cut only under rumble faces higher than `RAISED` (step 4).
- `build_kerbs.geometry`: a back ramp (`BACK_RAMP`, 0.15 m, or the rumble's `back_ramp`; its foot's texture v the
  rumble's own scale across it, mirrored back from its outer edge) behind a rumble whose
  profile ends higher than `RAISED` (ramp, concrete), down to the road; the profile set in metres and scaled by the
  whole width. The page already draws and picks it, and offers `back_ramp` in the rumble's form (step 4).
- `build_paths.Surface.nearest_y(P, Y, tol)`: the surface under each point nearest its height (step 1).
- `paint_roads.lay_on_roads(L)`, `LAY_NEAR`: paint laid on the road under it nearest its height (step 4).
- `templates.py` (new: the catalogue's models as templates, `tools/reference/templates/models.json` and its `.npz`
  files; `load`, `world`, and `dress` with its helpers `mapped`, `tangents`, `unshared`, `lens_texture`): the light
  pole's points unshared a face, its mast's mapping round it in metres, its frame box-mapped, its lamps' glass
  planar-mapped onto a generated `pole_lens.dds`; `scan_materials` gives the pole PoleMast and PoleFrame (step 5).
- `scan_materials`: a material's `calm` (PoleMast and PoleFrame 0.35): its colour blurred (sigma size / 96) and that
  share of its contrast round its mean kept, its normals blurred (size / 256) and flattened toward (0.5, 0.5, 1) by
  the same share, its gloss as its colour; only the `scan_pole*.dds` textures change (step 6).
- `place_objects`: objects.json version 3, one kind of object (a model, a curve or a spot, fit, collision, layouts).
  The editor reads a version 2 file as version 3 and writes version 3. The Velopark's file is version 3 now (315
  objects), and its build lays them as version 2 did, each layout's cones and boards and each wall's stacks (step 5).
- `place_objects.shared_in_layouts`: the objects in one `velopark_objects.kn5`, a `MODEL` entry for it in every
  layout's `models_*.ini` (step 6).
- `place_objects`: the checkered start line (`START_LINES`, hardcoded for vp_kids for now) (step 5).

## Fixes on both sides

A bug found in either is fixed in both while both exist, with a parity case that shows it. Velopark's open bugs are
in [BUGS.md](BUGS.md).
