# Bugs

Open problems the editor owns: where things are drawn or placed. Those of a track's build stay in its project.

## Velopark (kart-velopark)

Moved here from kart-velopark's BUGS.md on 2026-11-16.

- **Pit lane yellow lines.** Draw them as yellow lines on the pit lane roads (roads.json), in the editor. The old
  `LINE_VP_*_PIT` meshes are not coming back: only lines the editor has are built.
  - The 1500 pit entry's side road line.
  - The outer line, from the side road's east edge up to race control, turning east into it.
  - Their ends fork from the track's white lines.
- **Pit marks off the asphalt.** The build paints a mark only where it lies on asphalt.
  - `MARK_PIT_4` (-103.3, -45.7) and `MARK_PIT_9` (-97.6, -39.1) lie entirely off it, so they are not painted.
  - `MARK_PIT_2`, `3`, `10` and `11` lie only partly on it.
- **Hotlap pit lane by the boxes.** No tyre walls on either side; it needs them from the fence to the building's
  corner.
- **1500 pit entry island.**
  - It should have one tyre wall only, round the island, with the pit road's inner edge along it.
  - Today it has two on its west side and two on its east.
  - The line was to be drawn on `island_map.png`.
- **R10.** A yellow kerb along the inside of its curve that turns north (its north bend, inner edge near x 15,
  z 143).
- **Hotlap pit entry by the building's corner.** A jog of a few centimetres in the yellow line where the lane's edge
  meets the building's front.
- **To check in the game, against the editor's data:**
  - A cone at the 1500 pit entry by the side road (x -31.1, z 61.6).
  - The 1500 entry's tyre walls: one round the island's grass, one along its outer edge from the side road to race
    control.
  - The 1500 entry road and its left tyre wall, 2.2 m west under the pit building.
  - The 1500 entry's east leg, 0.8 m west by z 74, with a tighter curve.
