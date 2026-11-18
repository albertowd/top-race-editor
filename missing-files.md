# What the editor still reads from the track's folder

The editor and its build read these files from the track's project folder (kart-velopark for the Velopark).
Paths are relative to that folder. Every model and script the build uses is the editor's own
([models/](models/README.md)): the one object catalogue and its models (`models/catalogue.json`, each model's `.glb`)
and the games' scripts (`models/scripts/ac/screens/`, `models/scripts/beamng/`). The build is the editor's engine
alone; the track's Python build is no longer run.

## The track's own data (expected to live there)

- `tools/reference/track.json`: the track file, with all of its data in it (the roads, the objects, the trees, the
  layouts, the road drawings).
- `source/map/`: the track's one map, as tiles at every level, with its `map.json`.
- The terrain: `tools/reference/terrain/terrain.json` and the sources it names:
  - the height measurements: `tools/reference/elevation/google_*.json`, `tools/reference/surroundings/google_heights_*.json`;
  - the pictures: `tools/reference/surroundings/surroundings.jpg`, `source/textures/GoogleMap.jpg`;
  - the building outlines: `tools/reference/elevation/osm_property_*.json`, `tools/reference/surroundings/osm_*.json`;
  - the place: `tools/reference/elevation/location.json`.

  The terrain worked out from them is kept in the app's own cache.
- The material library: `source/materials.json`, `source/surfaces.json`, and the pictures in `source/textures/`.

## Game files the builds copy or read

- Assetto Corsa:
  - `source/track/`: the track's UI, the Custom Shaders Patch config (`extension/ext_config.ini`), each layout's folder;
  - `track/ac/`: the layouts' AI lines;
  - `source/lights.json`: the track's lights, and its screens with their data (prices, times).
- BeamNG.drive: the same models, library and lights; its Lua is the editor's, written under the level's own names.

## Written there

- `track/models/`: the models the build makes.
- `build/`: each game's track, the archives, the caches, the build's lock.

## Being replaced

- The build's ground is still mapped with `source/textures/GoogleMap.jpg` (the `Background` material) until it is
  made from the map in `source/map/`.
