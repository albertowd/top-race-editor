# Top Race editor

A track editor, as a desktop app (Electron). It shows a track's roads as curves over its satellite picture, with their
lines, rumbles and run-offs, and the meshes the track's build makes from them. Edits are saved back to the track's
files.

It opens the **Techspeed FuelTech Velopark** track (`../kart-velopark`) the first time, and the track opened last
after that.

## Layout

```
src/                  the page: TypeScript, React
  domain/             the roads' types and constants
  geometry/           curves sampled, run-offs, lines and rumbles, road shapes (pure, tested)
  editing/            joints, curve edits, snapping, handles, what the mouse is on (pure, tested)
  store/              the editor's state (zustand, immer: edits never change roads in place, undo keeps states)
  canvas/             the map: view, satellite tiles, renderer, mouse
  components/         toolbar, sidebar, inspector, road list, forms, dialogs, the pointer's readout
  api/                the engine's API, typed, and the page's channel to the engine window
  engine/             the engine: the track's files, its geometry, the terrain, the wizard, the builds (TypeScript)
  engine-window/      the desktop app's engine window: the engine answering the editor's windows
  wizard/             the new-track wizard: a page of its own (wizard.html)
  test/               fixtures (a made-up terrain and roads), and the parity tests against the editor this was made from
models/               the models the editor places and the build lays (.glb), their one catalogue, the games'
                      scripts (models/scripts)
public/models/        their pictures: icons, and seen from above for the map (npm run pictures)
scripts/              the models' pictures drawn (model-pictures.mjs), the coverage report made Sonar's
desktop/              the desktop app (Electron): its window, and the engine window started with it
```

The engine makes the meshes, merged surfaces and fitted curves as the track project's own build makes them, so the
editor always shows what the build makes.

## Setup

Needs Node 20+ and, for Sonar, Docker.

```sh
npm install
```

## Running

```sh
npm run desktop  # the page built, and the desktop app (npm start does the same)
```

The desktop app ([desktop/main.mjs](desktop/main.mjs), Electron) serves the built page itself and shows it in its
own window. The engine runs in a window of its own that is never shown (the engine window,
[src/engine-window/main.ts](src/engine-window/main.ts)), with the computer open to it from Node
([desktop/engine-preload.cjs](desktop/engine-preload.cjs)): each of the editor's windows calls it on a port of its
own. It opens the track opened last, or the one named: `npm run desktop -- --project ../another-track` (a path with
spaces in quotes). With no track yet, it opens the new-track wizard.

Another track is opened from the editor: the track's name in the toolbar is a menu of the tracks found (those next to
this one's project, and those opened before) and takes any track's folder. The engine window keeps it open from then
on, and the page loads again on it. Several copies of the app can run at once. A copy started while another runs
keeps its Chromium data in a temporary folder of its own. Two copies on the same track would save over each other's
changes, so open another track in the second. [desktop/launch.mjs](desktop/launch.mjs) starts it without
`ELECTRON_RUN_AS_NODE` (VS Code's terminals set it, and Electron would then run as plain Node).

What the app keeps on this computer (the wizard's keys, the tracks opened before, the engine's cache) is in
`%APPDATA%/top-race-editor` (`~/.config/top-race-editor` elsewhere), or beside the file `TOP_RACE_KEYS` names.
`TOP_RACE_DEBUG_PORT` opens Chromium's debugging port, to drive the app from outside.

## Packaging and releases

```sh
npm run package  # the app for Windows x64 in release/: an installer (NSIS) and a zip
```

[electron-builder.yml](electron-builder.yml) puts the built page (the engine in it) and the editor's own models in the
app's resources folder, beside the Electron files. The page's packages are bundled by Vite, so the app ships no
`node_modules`. Packing a build for Assetto Corsa uses 7-Zip where it is installed, else a zip. The installer isn't
code-signed, so Windows SmartScreen warns on first run.

A release is made by pushing a tag ([.github/workflows/release.yml](.github/workflows/release.yml)):

```sh
git tag v0.2.0 && git push origin v0.2.0      # v0.2.0-beta.1 makes a pre-release
```

The workflow then:

1. runs the checks (types, Biome, the tests) on Windows;
2. packages the app with the tag's version;
3. makes a GitHub release of that tag, with the installer, the zip and notes generated from the changes since the
   last release.

Run by hand from the Actions tab, it runs the checks and the package only, and keeps the package as the run's
artifact for 14 days.

The editor shows the roads, objects and drawings as soon as they are in. The track's models seen from above are read
after, while the editor is used (the first time after the models change, that takes a while): a note at the top says
so, as for other work that goes on (the surface checked, the meshes listed). Work the window must wait for (the track
opening, saving, a road brought in, the terrain saved) shows a loading screen after a moment.

## Checks

```sh
npm run check         # types, Biome, the tests
npm run lint:fix      # Biome's fixes (format, imports)
npm run test:coverage # the tests with coverage (coverage/web)
```

When the Velopark track is next to the editor, more tests run. The parity tests run the old editor (kept in
`src/test/legacy/`) on the real roads and check that this one samples, draws, snaps and hits exactly the same. The
engine's tests that read the Velopark's files (its AI lines, its buildings) run too. Elsewhere they are skipped.
The tests that build the whole Velopark run only when asked (`TOP_RACE_VELOPARK=1`).

## Sonar

SonarQube runs in Docker ([docker-compose.yml](docker-compose.yml), settings in
[sonar-project.properties](sonar-project.properties)):

```sh
npm run sonar:up      # SonarQube at http://localhost:9000 (the first login: admin / admin)
npm run sonar         # tests with coverage, then a scan; needs SONAR_TOKEN
npm run sonar:down    # stopped (its data kept)
```

For the token, use My Account → Security → Generate a token (a Global Analysis Token), then
`export SONAR_TOKEN=...` before `npm run sonar`.

## The engine's API

The page asks the engine window each call by its path (as a GET, or a POST with a body), on the track it has open
([src/engine/api.ts](src/engine/api.ts)):

| Request                     | Body               | Answer                                             |
| --------------------------- | ------------------ | -------------------------------------------------- |
| `GET /api/track`            |                    | name, folder, satellite span and size, materials   |
| `GET /api/tracks`           |                    | the track open, and the others found               |
| `POST /api/open`            | `{folder}`         | that track kept open from now on                   |
| `GET /api/build`            |                    | whether it can build, for which games, its last    |
| `POST /api/build`           | `{games?, ...}`    | a build for the games, begun                       |
| `GET /api/build/job`        | `?id=`             | the build: its step, log, archive                  |
| `POST /api/build/cancel`    | `{id}`             | the build, stopped                                 |
| `GET /api/roads`            |                    | the roads (as the page has them) and the track     |
| `GET /api/context`          |                    | the track's models seen from above                 |
| `GET /api/drawings`         |                    | strokes drawn over the map                         |
| `GET /api/meshes`           |                    | road meshes not described yet                      |
| `GET /api/tile`             | `?l=&x=&y=`        | a satellite tile (JPEG)                            |
| `POST /api/save`            | `{roads, deleted}` | `{ok, changed, roads}`                             |
| `POST /api/mesh`            | `{road, roads}`    | a road's mesh as the build makes it                |
| `POST /api/surface`         | `{roads, window}`  | the merged surface there, and its seam problems    |
| `POST /api/bring`           | `{model, name}`    | a mesh read as roads                               |
| `POST /api/fit`             | `{road}`           | a curve fitted to a road's points                  |
| `GET /api/objects`          |                    | the objects placed, `{objects, seeded}`            |
| `POST /api/objects`         | `{objects}`        | `{ok, objects}`: checked, written                  |
| `GET /api/terrain`          |                    | the terrain as saved: `{exists, doc, why, image}`  |
| `GET /api/terrain/image`    |                    | the picture of the ground round the track (JPEG)   |
| `GET /api/terrain/raster`   | `?file=`           | a raster edit's values (float32, base64)           |
| `POST /api/terrain/layers`  | `{doc?, want?}`    | its grids (16 bit, base64) and heights, worked out |
| `POST /api/terrain`         | `{doc}`            | `{ok, ...}`: checked, written, its pictures made   |
| `GET /api/wizard`           |                    | the providers, which keys are set, where tracks go |
| `GET /api/wizard/search`    | `?q=`              | places found by name (OpenStreetMap)               |
| `GET /api/wizard/tile`      | `?p=&z=&x=&y=`     | a picture provider's tile for its map (JPEG)       |
| `GET /api/wizard/job`       | `?id=`             | a track being made: its step, progress and log     |
| `POST /api/wizard/keys`     | `{name, value}`    | a key kept on this computer (blank: forgotten)     |
| `POST /api/wizard/estimate` | `{plan}`           | what making it asks of the providers               |
| `POST /api/wizard/start`    | `{plan}`           | the job, made in the background                    |
| `POST /api/wizard/cancel`   | `{id}`             | the job, stopping                                  |

The types are in [src/api/types.ts](src/api/types.ts). A call that fails says why, and the page shows it.

## The objects

Besides the roads, the editor places the track's objects: each layout's grid, pit boxes, hotlap start, timing
gates, cones and boards, and the light poles and tyre walls of every layout. They are kept in the track's
`tools/reference/objects.json` (the track file's `objects`), which the track's build reads to place them. The format
is in [src/engine/objectsfile.ts](src/engine/objectsfile.ts). A tyre wall is a curve of Bezier pieces,
edited as a road's middle is (nodes, handles, corners): the build lays a stack every `spacing` metres along it,
`rows` deep (each row further to its right). Read from the models, each wall's curve is fitted to its stacks. Marks
are paint on the roads for every layout (a start, a heading, a length, width, colour, solid or dotted), laid by the
build on the road surface.

While the track has no objects file, the engine reads the objects from its models (`vp_*.glb`, `velopark_poles.glb`,
`velopark_tyres.glb`) and the page says so; saving writes the file. Edits to a layout's grid, pits... go to every
other layout with the same set too, unless "with the same" is off in the Objects panel.

## The categories

The sidebar splits the work into categories (keys 1 to 9, then 0, - and =): the Overview (everything at once), Roads (shapes, joints,
run-offs), Rumbles, Paint (the lines along the roads and the paint marks), Grid & timing (grid, pits, hotlap, gates),
Light poles, Tyre walls, Cones & boards, Scenery, Buildings, Static objects, and Terrain. In a category only its own things can be picked on the map, the toolbar
offers only its tools, and the inspector on the right holds its flow; the rest of the map is shown, dimmed or hidden.
They are in [src/domain/categories.ts](src/domain/categories.ts).

Each kind has a picture: in the kinds' table, in the list of what is placed, and in the drop-downs that choose a
kind or a model.

Things are shown by what they are and their number (Road 3, Grid slot 2). Their names are the game's and matter only
to the export: each form keeps them under Export name.

## Laying out along a line

In Grid & timing, "Lay Out Along a Line" puts down a layout's grid slots or pit boxes at once. You set:

- how many, in one line or in rows of 2 or 3 (staggered or not, the first on the left or the right);
- how far apart, or spread to fit the line;
- which way they face (back to the line's start, as a grid behind its pole, or along it);
- a lean, for boxes set at a slant.

Draw the line on the map: click where the first one stands, then the way the rest go. A preview follows the mouse
until you place them. Placing replaces the layout's set, and those of the layouts with the same set.

Their paint is apart: in Paint, Paint Marks has the same panel for the grid's and the pit boxes' paint. Each kind
has its own line and settings, and a shape (a box, open at the back, or a front line), its size, line width and
colour. "Paint Round" paints round the layout's own slots or boxes as they stand. Paint is every layout's: laying it
out again replaces what was laid out before (marks named `MARK_GRID_` and `MARK_PIT_`). "Paint a Line Across a
Road" paints a line from one edge of the road clicked to the other, such as a start line.

A road's start and end edges turn with their Bezier handle. The node form shows how far an end's edge is off
square; type an angle, or Square to make it follow the road again.

## The scenery

The Scenery category (key 9) places models as they are, for every layout: trees (eucalyptus, young eucalyptus, broad
leaf, palm, bamboo, and the Velopark's own) and fence panels (concrete or steel posts). Buildings (key 0) places the
buildings (a white shed, the judges' tower, the paddock's, the farm's, the houses), and Static objects (key -) the
rest that stands as it is (a marshal's shelter, a chair, a timing table, banners, flagpoles, bins, a gate, a lamp)
and parked karts; a model the catalogue has not is a static object. The start gantry is Grid & timing's. Each kind's
drop-down chooses the model that Place adds, and a placed one's form can change its model. The map draws each one
seen from above, at scale, turned its way. A new fence panel faces the nearest road, so it runs along it.

They are kept in the objects file under `scenery`, by kind: `{model, x, z, heading}`, where `model` is an id from
[models/catalogue.json](models/catalogue.json). The models and how they are made are in
[models/README.md](models/README.md). The track's build does not place the scenery yet; it is in the file for when
it does.

## The terrain

The Terrain category (key =) edits the ground the track lies on: the track's `tools/reference/terrain` folder, which
the ground is made from, as the first step of its build. Its `terrain.json` says where the heights come from, the
filters that tell the ground from the tops of trees and roofs among them, and the edits to the ground. The engine
works them out as the track's build does ([src/engine/terrain.ts](src/engine/terrain.ts)), so the page shows what the
build makes, and keeps its previews in its own cache, never the build's.

- **Shown:** a layer over the satellite: the original heights, the filtered (the ground the filters keep, filled
  in), the ground (with the edits), the edits' change (red up, blue down) or what the filters took out. It is lit
  (relief, made taller to read), coloured by height, with contours if asked. The wider picture of the ground round
  the track goes under it. The heights can be shown as points, coloured by why the filters took each out. Under
  the mouse, the inspector gives each layer's height.
- **Filters:** their rules' numbers, and areas drawn on the map that are the ground (or not) whatever the rules
  find. Each change is worked out again a moment after (about 2 s).
- **Edits,** in order, each made over the ground the ones before it left: Flat (at a height, or at its point's
  height and some metres over it, sloped if asked), Raise (by some metres) and Smooth rings, each easing out over
  some metres; and the Brush (raise, lower, smooth, flatten to a height; Alt-click takes the height there). The
  brush paints a raster edit (an `.npz` in the folder) and shows each stroke at once. The engine works the ground
  out again when the stroke ends.
- **Drawing:** click a ring's points; its first point, a double-click or Enter ends it, Esc drops it. Picked, a
  ring is dragged whole or by its points; Shift on a side adds a point, Alt on one takes it out.
- **Saving:** Ctrl+S while the terrain is worked on writes `terrain.json` and the rasters painted. The one before
  goes to the backups. The terrain's pictures and points are made again, and the track's next build starts from
  them.

## Faces checked as they are made

Each road mesh the engine makes (as the track's build makes it, for the wireframe) is checked for faces that would be
wrong in the game: facing down or on edge, or without area (no normal: the game's normals go wrong round them). The
road's form says what was found, all right or not, and the map shows those faces in red while the road is selected.
The meshes are made whatever the View menu shows. The surface check reports them too, with its seam problems. The
models of [models/](models/) were checked the same way when they were made (the catalogue's `wrong_faces`).

## Building for the games

The box in the toolbar builds the track for the games ticked in its dialog: Assetto Corsa, BeamNG.drive or both. The
engine makes the track's models again from what is saved, then the AC track from them (only what changed is made
again), and the BeamNG level from the AC track (one map of every layout, each its activities, packed as
`build/dist/<track>_beamng.zip`). Assetto Corsa's is packed as the project's `release.ps1` does
(`build/dist/<track>_ac.7z` with 7-Zip, else a `.zip`). It can install the AC track in the game too (`AC_TRACKS`
names its tracks folder, else it is looked for in Steam's libraries), put the BeamNG level in BeamNG's mods
(`BEAMNG_MODS`, else BeamNG's own user folder), or make every step again. A track is built only with every layout
whole (its racing lines, grid, pits, timing and hotlap start).

While it builds, the dialog shows how far it is: one bar for all of it, each stage weighed by what it took the last
time (kept in `build/cache/editor_build.json`), and the time it may still take; every stage; what it is doing now,
its last line and how long ago it said it; and 7-Zip's percentage while it packs. The build goes on in the engine
with the dialog closed (a note at the top says so), can be stopped, and does not begin while another build holds the
build's lock (`build/build.lock`, which the editor takes round all it does).

The marker boards' faces are drawn by the build: each board's text (its form's Text, else what its name says:
`BOARD_PIT_2` says PIT) on a card of its own, as large as fits it (a `|` breaks a line), the cards on one sheet
(`BoardCards.png`), each board's back a blank card.

### From the command line (CI)

A saved track is built with no window shown, its log printed as it goes, the exit code its end's (0 built, 1 failed
or stopped, 2 wrong arguments):

```sh
npm run build-track -- --project <folder> [--games ac,beamng,rf2] [--install] [--install-beamng] [--install-rf2] [--no-pack] [--all]
```

It is the desktop app's engine (`desktop/main.mjs --build`, `desktop/buildcli.mjs`), so it builds just as the dialog
does: by default for AC, packed. `--install` and the others are the dialog's ticks; `--all` makes every step again.
On Linux it needs a display: `xvfb-run npm run build-track -- ...` (and `--no-sandbox` where it runs as root).

## A new track

The wizard (the globe in the toolbar, or `/wizard.html`) makes a new track's folder. You pick:

- **its place:** find it by name (OpenStreetMap), or click the map; the click is the track's origin (0, 0), x running
  west and z north from it;
- **the area round it:** metres across and deep;
- **where its picture comes from:** Esri World Imagery (no key), Mapbox or Google; and how many metres a pixel;
- **where its heights come from:** AWS Terrain Tiles (no key), Mapbox Terrain or Google Elevation; and how far
  apart;
- **whether to take OpenStreetMap's buildings** (their roofs are not the ground);
- **its name, its folder** (next to this track's project unless a whole path) and how wide the editor's map picture
  is.

Keys are kept on this computer (`%APPDATA%/top-race-editor/keys.json`, `~/.config/top-race-editor/` elsewhere, or
`TOP_RACE_KEYS`), never in a project, and the page never gets them back. Before making it, the wizard says how many
tiles and requests it will take. Making it fetches the picture and the heights, then the engine makes its terrain
(`terrain.json` and its layers) in the new folder. It ends with the command that opens the track:
`npm run desktop -- --project <folder>` (or open its folder from the track menu).

A track the wizard made names the tools of the project the editor had open (its `track.json`'s `tools`). Its terrain
opens in the Terrain category; its roads start empty.
