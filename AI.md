# Top Race Editor: reference for AI assistants

A dense map of everything the editor does, where it keeps it, and the rules that trip people up. Read it before
helping someone use the editor, editing a track's files by hand, or changing the editor's code. The user guide is
[README.md](README.md); how it is built, tested and released is [DEVELOPMENT.md](DEVELOPMENT.md); the track's data
format is the track project's `TRACK_FORMAT.md` (the Velopark's: `../kart-velopark/TRACK_FORMAT.md`).

## What it is

- A Windows desktop app (Electron, React, TypeScript) for race tracks of any kind: draw the track from above over
  its satellite picture, place everything round it, and build it for **Assetto Corsa** (AC), **BeamNG.drive** and
  **rFactor 2** (rF2) from the same data.
- The editor's engine _is_ the track's build: what the editor shows is what the games get. There is no other build
  pipeline.
- One track is open at a time; each track is a folder (a "project"). The sample track is the Techspeed FuelTech
  Velopark (`../kart-velopark`).
- Version history: [CHANGELOG.md](CHANGELOG.md). Releases are GitHub releases of `albertowd/top-race-editor`
  (installer `.exe` and a `.zip` of the app).

## A track's folder

Coordinates: metres, y up, x west, z north, origin the point picked when the track was made. Headings are radians
from +z toward +x. Curves everywhere (roads, lines, walls, marks) are Bezier nodes `{p: [x, z], in, out}` with
handles relative to the node.

| File                                           | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Written by       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `tools/reference/track.json`                   | the one file of what the editor edits: settings, `roads` (curves, widths, joints, branches, run-offs, lines, rumbles, material, build order), `objects` (every placed object; each layout's grid, pits, hotlap start, timing gates, safety car start, racing lines; paint marks; rubber; paved areas; `wear`, `ai.width`, `surface` roughness, `ground.picture`), `layouts` (each layout's model list), `trees`, `drawings`, `beamng.spawns`. An older track may still name `roads.json` / `objects.json` there by path | editor           |
| `tools/reference/terrain/`                     | `terrain.json` (heights' sources, filters, edits) and raster edits (`.npz`)                                                                                                                                                                                                                                                                                                                                                                                                                                             | editor           |
| `source/bumps.json`                            | hand-made bumps on the road surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | editor           |
| `source/materials.json`                        | material library (textures, alpha, glow, surface, per-game `targets`)                                                                                                                                                                                                                                                                                                                                                                                                                                                   | by hand / tools  |
| `source/lights.json`                           | light series, free-standing lights, screens (start boards, timing TVs, fuel prices)                                                                                                                                                                                                                                                                                                                                                                                                                                     | by hand          |
| `source/surfaces.json`                         | what each ground kind is to drive on, per game                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | by hand          |
| `source/models/*.glb`, `source/textures/*.png` | hand-made models, textures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | by hand          |
| `source/map/`                                  | the satellite picture and heights                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | new-track wizard |
| `track/`                                       | made by the build (`track/models` not committed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | build            |
| `build/`                                       | each game's output, `build/dist/*` archives, `build/cache`, `build/build.lock`                                                                                                                                                                                                                                                                                                                                                                                                                                          | build            |

Saving keeps the previous file in the track's backups. Every JSON file has a `version`.

## The window

- **Toolbar**: Select, Add Node, New Road, Measure, Place; Undo/Redo; Layers (what the map shows); Build for the
  games; New Track (globe); Help (`?`); Save. The track's name (top left) opens another track.
- **Categories** (sidebar, keys `1`–`9`, `0`, `-`, `=`): Overview, Roads, Rumbles, Paint, Grid timing & lines,
  Light poles, Tyre walls, Cones & boards, Scenery, Buildings, Static objects, Terrain. Only the category's own
  things can be picked; the rest is shown, dimmed or hidden. `\` hides the sidebar.
- **Map**: wheel zooms, drag empty map / right or middle drag / `Space`+drag pans. The status bar shows the
  cursor's position and distance along a road.
- **Inspector** (right): what is picked, its form, and the category's tools.

## Features by category

### Roads (also paved areas)

- Drag nodes (white squares; snap to other roads' ends and edges, `Ctrl` to not), handles (blue dots; `Alt` for a
  sharp corner), widths (`L`/`R` diamonds; `Shift` for both sides).
- `A` + click or double-click adds a node (past an end extends the road); `N`, clicks, `Enter` makes a new road;
  `J` joins an end to the nearest other road's end; `S` smooths a node or the whole road; `Delete` / `Shift+Delete`.
- Road form: length, material, texture direction, joints, branches (`Joins` / `Leaves`), run-offs (along a road or
  a side, from–to, ease), build **Order** (a road built earlier lies over later ones; later ones are cut away where
  they run under it), its mesh. Node form: position, handles, widths, end edge angle (or Square), joint.
- Draft roads with few nodes; a link road runs _into_ the road it meets and the join plus build order cut it.
- **Bring In**: turn a mesh the track has but the editor does not describe into a road.
- **Bumps** (`U`): hand-made bumps in millimetres on a 10 cm grid: drag or type a mesh point, or Raise / Lower /
  Smooth brushes; red up, blue down; **Clear All Bumps**. Applied to the merged floor in every game, so paint,
  rumbles, objects and racing lines follow.
- **Surface roughness** (in Roads' inspector): None, Light, Medium, Heavy or its own millimetres of long waves
  (8–20 m), bumps (1.5–4 m), ripple, and bends lower on their inside; **New Pattern** reseeds it. Optional per-place
  roughness map. Eases out 1 m past the roads; where roads meet, one road's roughness blends into the other's.
- **Check Surface** (`C`): builds the ground in view as the build will and rings seam problems in red. Road meshes
  are checked for wrong faces (down-facing, edge-on, no area), shown red when the road is picked.
- **Paved areas**: polygons with their own material (car parks, lanes); **Parking bays** paints a row of bays along
  the longest edge.

### Rumbles and paint

- Per road: rumbles (kind, width, colour; ramp, concrete, round, floor) and lines along it (side, from/to, colour,
  width, dashes). Drag along the road; drag the orange end triangle to move an end.
- **Paint Marks**: free paint as curves (start lines, grid boxes, pit box marks, lines across a road). **Place** and
  drag start to end; nodes snap to other marks' ends. **Paint Round** paints round a layout's grid slots or pit
  boxes. **Paint a Line Across a Road**. **Start lines**: chequered or solid, every layout.
- Paint of one kind whose ends meet is painted as one line with mitred corners, closed into rings; overlaps are
  painted once; ends within 10 cm merge.
- **Wear**: New, Almost new, Used, Very used for all the paint.
- **Rubber**: rubber marks are curves with width and darkness; the build lays most in braking zones, apexes and
  exits. **Lay Rubber Along the Racing Lines** copies a layout's fast and pit lines in as rubber. Rubber belongs to
  the track, not a layout; overlaps never get darker than the darkest mark.

### Grid, timing & lines (per layout)

- Pick the layout at the top. Layouts can be added (copied from one), renamed and removed; their model lists are
  kept with them. **with the same** applies an edit to every layout with the same set; **Copy from another layout**.
- Grid slots, pit boxes, hotlap start, timing gates (two posts), **Safety car start** (rF2 only, optional).
- **Lay Out Along a Line**: count, rows of 1–3 (staggered, first on left/right), spacing or spread, facing, lean.
- **Racing lines**: the fast line (closed) and the pit lane (forks off and merges into the fast line at two
  diamonds, `leaves`/`joins` in metres along the fast line). **Line from roads**: click the lap's roads in order,
  and a fast line is fitted within the road less half the cars' width.
- **Cars' width** (`ai.width`, 1.4 m default): AI lines keep half of it plus 0.3 m off road edges, may use a
  rumble's low ramp, never concrete or a rumble's back.
- A track builds only when every layout is whole: fast line, pit line, grid, pits, timing gates, hotlap start.

### Objects (Light poles, Tyre walls, Cones & boards, Scenery, Buildings, Static objects)

- **Place** (`O`), choose a model by its picture, click to drop; it faces like the last one or along the nearest
  road. Drag to move, drag the white handle to turn; `Shift` moves or turns all of that kind in the layout.
- Form: position, heading, scale, model, collision (none, box, wall along it, knocked about), layouts it is in.
  **Find one in the list** searches by name.
- Curved objects (tyre walls, fences, anything with copies): nodes and handles like a road; **Copies** with spacing,
  rows, and **Fit** (upright copies along it, or bent along it).
- **Marker boards**: their **Text** is drawn on the card (`|` for a second line); empty uses the name
  (`BOARD_PIT` says PIT).
- **Light poles**: lit at night or not; reset to their series' strength, reach and colour.
- Cones and boards are a layout's own and knockable; everything else is for every layout. The start gantry is in
  Grid timing & lines.
- Models come from the editor's catalogue ([models/catalogue.json](models/catalogue.json)); trees live in
  `track.json`'s `trees`.

### Terrain

- **Shown**: original heights, filtered ground, ground with edits, the edits, or what the filters removed; relief,
  height colours, contours, points.
- **Filters**: rules to tell ground from tree and roof tops, plus areas that are or are not ground.
- **Edits** in order: Flat, Raise, Smooth areas, and the **Brush** (raise, lower, smooth, flatten; `Alt`-click picks
  the height). **Save terrain** (`Ctrl+S` in Terrain).
- **Ground picture**: _The photo_ or _Generated from it_ (rebuilt from the photo's covers, so none of its pixels
  ship; use it when the photo's licence forbids passing it on). AC adds close-up grass, sand or gravel detail.

## Building for the games

**Build for the games** saves, makes the track's models, then each ticked game's track. Only what changed is made
again; **Make every step again** forces all. It runs in the background, shows stages, time left and a log, and can
be cancelled.

- **Assetto Corsa**: every layout as `.kn5` models and `models_<layout>.ini`, AI files from the racing lines, pit
  boxes, Custom Shaders Patch config (lights, night materials, scripted screens, grass), previews and outlines.
  Options: install in AC (`AC_TRACKS` or found in Steam), pack `build/dist/<track>_ac.7z`.
- **BeamNG.drive**: one level with every layout's races and time trials, spawns (`beamng.spawns`), coarse collision,
  lights; `build/dist/<track>_beamng.zip`. Option: install in mods (`BEAMNG_MODS`).
- **rFactor 2**: a location for ModDev with each layout's SCN, GDB, AIW, timing beams, moveable cones and boards,
  start lights, screens as still pictures, icons, maps and loading screens. Option: copy to
  `ModDev/Locations` (`RF2_FOLDER`). Not packed as MAS/rFCMP yet; no trackside cameras yet.
- Layout pictures are rendered from the built track (from its start gantry, else from above).
- Close the game before installing; the build refuses while it runs.

Command line, no window (0 built, 1 failed, 2 bad arguments):

```sh
npm run build-track -- --project <folder> [--games ac,beamng,rf2] [--install] [--install-beamng] [--install-rf2] [--no-pack] [--all]
"Top Race Editor.exe" --build --project <folder> --games ac,beamng,rf2   # the released app; run it from bash, PowerShell does not wait
```

A track's own CI downloads the editor's release zip (its workflow's `EDITOR_VERSION`) and runs that.

## Making a new track

**New Track** wizard: place (search or click; becomes the origin), area in metres, picture source (Esri free,
Mapbox, Google) and sharpness, heights source (AWS Terrain Tiles free, Mapbox, Google) and spacing, optional
OpenStreetMap buildings, name and folder. It estimates requests first. API keys are only for the map pictures and
heights, kept on this computer (`%APPDATA%/top-race-editor/keys.json` or `TOP_RACE_KEYS`), never in a track. The new
track has terrain and no roads.

## Lights, screens and materials (hand-edited data)

- `materials.json`: `glow`, `glow_strength`, `night_only` make a material glow (AC writes a night
  `MATERIAL_ADJUSTMENT`; the glow covers the material's whole texture, so put only what should light on its own
  material). `targets.ac.night` sets AC values by night and by day. `covers_grass` keeps grass off.
- `lights.json` screens' `shows`: `start_board`, `session_times`, `hotlap_times`, `prices` (with `data`). AC draws
  them with scripts in [models/scripts](models/scripts); rF2 gets still pictures; BeamNG its own board.

## Keys

`1`–`9` `0` `-` `=` categories · `\` sidebar · `A` add node · `N` new road · `J` join · `S` smooth · `O` place ·
`M` measure · `U` bumps · `C` check surface · `Delete` / `Shift+Delete` · `Esc` select · `Ctrl+Z` / `Ctrl+Y` /
`Ctrl+S` · `?` all keys.

## Troubleshooting

- "… is running: close it before installing": close the game (Content Manager can stay open).
- Build stops with a layout not whole: the message names what is missing; add it in Grid timing & lines.
- Looks right in the editor, wrong in a game: build with **Make every step again**.
- AC: a pit lane must run the same way as the lap. A pit lane that rejoins behind where it leaves gets no
  `pit_lane.ai`, so AC's AI won't pit there.
- Two copies of the app on the same track overwrite each other's saves.

## Working on the editor's code

- Layout: `src/domain` (types), `src/geometry` and `src/editing` (pure, tested), `src/store` (zustand + immer),
  `src/canvas` (map), `src/components` (UI), `src/engine` (track files, geometry, terrain, builds; `engine/rf2`,
  `engine/beamng`), `src/engine-window`, `src/wizard`, `desktop/` (Electron), `models/` (catalogue, scripts).
- The page talks to the engine window over a small HTTP-like API ([src/engine/api.ts](src/engine/api.ts), table in
  DEVELOPMENT.md).
- Checks: `npm run check` (types, Biome at 160 columns, Vitest). On Windows run Vitest from an upper-case `D:\`
  path or every suite fails. Tests that need the Velopark or rF2's ModDev skip when those are absent.
- Release: push a `v<version>` tag; the workflow checks, packages and publishes.
- UI text and docs speak of race tracks in general, not one kind of vehicle.
