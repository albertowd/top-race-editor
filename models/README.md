# Models

Every thing the editor places and the track's build lays (its objects, its trees, its buildings) is a model here:
one glTF binary (`.glb`) each, `<id>.glb`, listed in the one catalogue, [catalogue.json](catalogue.json). The page
reads the catalogue for its model choices; the build lays each object and plants each tree with its model's file and
what the catalogue says of it. Nothing of the catalogue is read from the track's folder.

Every model:

- stands at the origin with its foot on the ground (y 0; trunks and posts go a little into the ground, as built);
- has its front looking along +z, with y up;
- is in metres.

A placed thing's `heading` (radians from +z towards +x) turns the model about y.

## The catalogue

`catalogue.json` is `{ "about": ..., "models": [...] }`, the models in the order the page lists them (each kind's
first is the one a new one of it is). Each model:

| Field         | What                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | its name: what a track's objects and trees say they are                                                                                                              |
| `file`        | its `.glb`, here: `<id>.glb`                                                                                                                                         |
| `kind`        | what the page places it as: `cones`, `boards`, `poles`, `tyres`, `trees`, `fences`, `sheds` (buildings), `statics` (the rest standing as it is), `gantries`, `karts` |
| `label`       | its name on the page                                                                                                                                                 |
| `description` | what it is, at more length (where said)                                                                                                                              |
| `materials`   | where its materials are, so how it is read (below)                                                                                                                   |
| `size`        | metres across (x), high (y), deep (z)                                                                                                                                |
| `top`         | metres across its picture from above, the origin in its middle (written by `npm run pictures`)                                                                       |
| `triangles`   | its faces, its hull's not counted                                                                                                                                    |
| `fits`        | how it may be placed: `place` (one where clicked), `bend` (panels along a curve)                                                                                     |
| `collision`   | the collisions it may have, its default first: `none`, `static`, `dynamic` (knocked about), `wall`, `model` (its own meshes')                                        |
| `hull`        | its part the games' collisions are of, unseen (`hull`)                                                                                                               |
| `lights`      | its lamps: each `{ series, at, facing }` in its own frame (right, up, forward), the series the track's `source/lights.json` names; no `facing`, all round            |
| `draw`        | the metres it is drawn from and to, near and far (`null`: as far as the game draws); none, always                                                                    |
| `lods`        | each part's own `draw` (a far stand-in, say)                                                                                                                         |
| `source`      | where it was made from                                                                                                                                               |
| `wrong_faces` | faces wound against their normals (`against`) or without area (`thin`), where they were counted                                                                      |

`materials` is one of:

- `own`: its materials are its own, their textures inside its file (made in Blender). Its meshes are its parts,
  their names lower-cased.
- `library`: its materials are named only; the track's material library (`source/materials.json`) gives each, by its
  name. Each mesh is a part as its node is named, its points as they are kept (position, normal, UV, the tangent's
  first three); its hull is the mesh named `hull`. The trees, the cone, the board, the light pole, the tyre stack and
  the small sheds are so.
- `track`: as the track's own models keep them: its nodes carry the kn5 data (`extras.kn5`) and what each mesh is
  (`extras.track`), read with the track's material library and textures (`source/textures`) for AC's names and flags.
  The paddock's buildings are so; the map draws each one's outline round its picture.

A fence model is one panel: a post at each end and the mesh between them, along x. Panels set end to end make a
fence. Alpha-tested materials (leaves, fence mesh) use glTF's `MASK` mode, cut off at half.

The start gantry (`gantry`) is written by the build as a model of its own for each one placed: working
(`KS_START_LIGHT_<n>`, `GANTRY_FLAG`) in the layouts whose start and finish line (their first timing gate) it is
the nearest gantry to, within 30 m, and still (`NO_START_LIGHT_<n>`, `STATIC_FLAG`, its board in the library's
still material where it has one) in the others. Each layout lists its own of each: `track_<name>` or
`track_<name>_still`.

## Pictures

Each model has two pictures in [public/models](../public/models), drawn from its `.glb` by
[scripts/model-pictures.mjs](../scripts/model-pictures.mjs) (`npm run pictures`):

- `<id>.png`: its icon, 128 pixels square, seen from its front-left and above;
- `<id>.top.png`: seen from straight above, its front at the picture's top, `top` metres across (12 pixels a metre,
  48 to 1024 pixels), as the map draws it.

They are drawn as the build reads the model (its parts but its hull, those it draws only far left out), flat shaded,
on nothing: each material coloured by its own texture, else by the track's material library's colour picture
(sampled at the model's UVs), else a plain colour of its name. The script reads the library from the Velopark beside
the editor (`../kart-velopark`), or `npm run pictures -- --track <folder>`; without one the track's own models
(`materials` `track`) are left out. `npm run pictures -- <id> ...` draws only those. Each run writes the models'
`top` into the catalogue.

`kind-<kind>.webp` is each kind's icon, for the kinds the editor places (a grid slot: a kart on its white box...); the
static objects' is the chair's own, `chair.png`.

## Adding a model

1. Make its `.glb` as every model is (at the origin, its front along +z, metres) and put it here as `<id>.glb`:
   with its textures inside (`own`), or its materials named as the track's library names them (`library`, a mesh named
   `hull` for its collisions).
2. Add its entry to `catalogue.json` where the page should list it: at least `id`, `file`, `kind`, `label`,
   `materials`, `size`, `fits`, `collision` and `lights` (`[]`).
3. Run `npm run pictures -- <id>`: it draws its pictures and writes its `top`.

## Scripts

[scripts/](scripts) holds what the games run:

- `ac/screens/<shows>.lua`: each screen's Custom Shaders Patch script, for a screen of the track's `source/lights.json`
  that shows it. The screen's data (prices, times) stays in the track's `lights.json`.
- `beamng/board.lua` and `beamng/modScript.lua`: the BeamNG level's start gantry board. The build writes them into
  the level as `lua/ge/extensions/<level in camelCase>/board.lua` and `scripts/<level>/modScript.lua`, filling in
  `{{track}}` (the track's name), `{{level}}` (the level's folder) and `{{extension}}` (`<level in camelCase>_board`).

## Where they came from

The models were made once from the Velopark's sources. The editor's own (`own`) were made with Blender, the script
that made them not kept: the eucalyptus, young eucalyptus, broad leaf tree, palm and bamboo, the fences, the white shed
and the judges' tower were built by the track's own code on flat ground; the gantry cut out of its models; the kart
from the kart project (the rental kart's third level of detail, as the track parks it). Their textures are kept at
1024 pixels at most, as JPEG unless their alpha is used. The library's models (`library`) are the Velopark's
templates (`tools/reference/templates`, once NumPy archives), each part a mesh of its name with the same points and
faces; the paddock's buildings (`track`) are as the track's gltf_source wrote them. What stood round the track
(`track`: the east sheds, the farm's house, barn, low building, tent and bins, the blue shed, the two houses, the
Velogrill, the sports court's fence, the south fence's sliding gate, the globe lamp) is velopark_outside.glb's meshes
moved to their own origins: each building's floor's middle (its foot), turned back from its heading; the tent's poles,
the blue shed's posts and wall and the court's posts and mesh made longer into the ground, for the slopes they stand
on.

Each of the editor's own models was checked for faces that would be wrong in a game: wound against their normals, or
without area (`wrong_faces`). Cut-out cards (the trees' leaves) were not checked for their winding: their normals
point out from their clump's middle on purpose, so a clump is lit as one. The kart, from the kart project, has 99
faces against their normals and 2274 without area.
