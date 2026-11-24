import { castDraft, current, produce } from 'immer';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { EngineClient } from '../api/client';
import type { BuildOptions, RoadMesh, TrackEntry } from '../api/types';
import { viewBox } from '../canvas/viewport';
import { CATEGORIES, type Category, categoryOf, type Others } from '../domain/categories';
import { KERB_TAPER, KERB_WIDTH, kindOf, SURFACE_WINDOW, UNDO_DEPTH } from '../domain/constants';
import {
  type Gate,
  type LayerName,
  type LayoutObjects,
  type LineKind,
  type Mode,
  type ModelKind,
  NO_SELECTION,
  type ObjectKind,
  type ObjectPick,
  type PaintMark,
  type RacingLines,
  type Road,
  type RubberMark,
  type RubberWear,
  type Selection,
  type Side,
  type Spot,
  type StartLineStyle,
  type TrackObjects,
  type Vec2,
  type WallNode,
} from '../domain/types';
import { parkingMarks } from '../editing/areas';
import {
  type BumpBrush,
  type Bumps,
  bumpDab,
  bumpPoint,
  bumpsFrom,
  bumpsJson,
  hasBumps,
  noBumps,
} from '../editing/bumps';
import {
  addNode,
  addProfilePoint,
  autoHandles,
  newRoad,
  reverseRoad,
  snapEnds as snapEndsOnto,
} from '../editing/curves';
import { joinNearest as joinEnds, renameInJoints, touch, unjoin as unjoinEnds } from '../editing/joints';
import { addLayout, removeLayout, renameLayout } from '../editing/layouts';
import { FORK, keepPitOn, lineFromRoads, MERGE, pitFromRoads } from '../editing/lines';
import {
  type BoxPaint,
  boxMarks,
  isPaint,
  type LineUp,
  type LineUpKind,
  lastPaintNumber,
  lineUp,
  PAINT_PREFIX,
  paintAt,
} from '../editing/lineup';
import { markThrough, rubberWidth } from '../editing/marks';
import {
  addObject,
  emptyLayout,
  exists,
  freeName,
  headingOf,
  isCurve,
  isLayoutKind,
  isModelKind,
  names,
  OBJECT_LABELS,
  objectsOf,
  poseOf,
  removeObject,
  reorderObject,
  setKey,
} from '../editing/objects';
import { CAR_WIDTH, optimiseLine } from '../editing/racingline';
import {
  addObjectNode as addObjectNodeTo,
  keptWhy,
  offStrand,
  onNode,
  placedAlong,
  placingInto,
  smoothObject,
  strandOf,
} from '../editing/strands';
import { splitTrees, withTrees } from '../editing/trees';
import { geo, lookup } from '../geometry/roads';
import { nearestOn, pointAt } from '../geometry/samples';
import { browserDialogs, type Dialogs } from '../ui/dialogs';
import { meshDeps, sameDeps, wiredRoads } from './meshes';
import { type EditorState, initialState, type Snapshot } from './state';

/** A change to the roads (on a draft); what it gives back is not used. */
export type RoadsRecipe = (roads: Road[]) => unknown;

export interface EditorOptions {
  dialogs?: Dialogs;
  /** milliseconds after an edit before the wireframes are asked for */
  meshDelay?: number;
  /** another track open: the page loaded again (default: the window's) */
  reload?: () => void;
  /** milliseconds between asking how a build goes */
  pollMs?: number;
}

/** The roads changed by a recipe (on a draft), and what the recipe said. */
export function produceWith<T>(roads: Road[], recipe: (d: Road[]) => T): [Road[], T] {
  let out: T | undefined;
  const after = produce(roads, (d) => {
    out = recipe(d as Road[]);
  });
  return [after, out as T];
}

/** How the engine read a mesh brought in. */
const READ_AS: Record<string, string> = {
  ring: 'as a ring: two halves joined end to end',
  strip: 'from its outline',
  rows: 'by its rows',
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The roads as loaded: each with its name as loaded ('was'), its rumbles' kinds as the editor names them. */
export function prepareRoads(list: Road[]): Road[] {
  return list.map((r) => ({
    ...r,
    was: r.name,
    ...(r.kerbs ? { kerbs: r.kerbs.map((k) => ({ ...k, kind: kindOf(k.kind) })) } : {}),
  }));
}

/** A change to the objects (on a draft); what it gives back is not used. */
/** metres: a line painted across a road (a start line), its width */
export const ACROSS_WIDTH = 0.3;

export type ObjectsRecipe = (objects: TrackObjects) => unknown;

/** The layout shown first: the one named so, else the first. */
const firstLayout = (o: TrackObjects | null, prefer = 'vp_1500'): string => {
  const names = Object.keys(o?.layouts ?? {});
  return names.includes(prefer) ? prefer : (names[0] ?? '');
};

/** The road nearest (x, z): the way it goes there (its heading) and its point there; null if none. */
export function roadNear(roads: Road[], x: number, z: number) {
  const find = lookup(roads);
  let best: { heading: number; at: ReturnType<typeof pointAt>; d: number } | null = null;
  for (const r of roads) {
    const o = geo(r, find);
    if (!o || o.X.length < 2) continue;
    const n = nearestOn(o, x, z);
    if (best && n.d >= best.d) continue;
    const i = Math.min(n.i, o.X.length - 2);
    best = { heading: headingOf(o.X[i + 1] - o.X[i], o.Z[i + 1] - o.Z[i]), at: pointAt(o, n.s), d: n.d };
  }
  return best;
}

/** The editor: its state (a store the page draws from) and what can be done to it. */
export function createEditor(api: EngineClient, options: EditorOptions = {}) {
  const ui = options.dialogs ?? browserDialogs;
  const meshDelay = options.meshDelay ?? 350;
  const store: StoreApi<EditorState> = createStore<EditorState>()(() => initialState());
  const get = store.getState;
  const set = store.setState;

  const selected = (): Road | undefined => get().roads[get().sel.r];
  const status = (text: string) => set({ status: text });
  // (what was last loaded or saved: what differs from it is what is saved)
  let savedRoads: Road[] | null = null;
  let savedObjects: TrackObjects | null = null;
  let savedBumps: Bumps | null = null;
  // (whether the track's trees were read: only then are they saved, among the objects or none)
  let treesRead = false;
  // (the layouts' models as read or last saved, and whether they were read: only then are they saved)
  let savedLists = '';
  let listsRead = false;

  // ---------------------------------------------------------------- history

  const snapshot = (): Snapshot => ({ roads: get().roads, objects: get().objects, bumps: get().bumps });

  function remember() {
    const s = get();
    const undo = [...s.undo, snapshot()];
    if (undo.length > UNDO_DEPTH) undo.shift();
    set({ undo, redo: [] });
  }

  /** The last remembered state dropped (nothing came of what it was remembered for). */
  function forget() {
    set({ undo: get().undo.slice(0, -1) });
  }

  function restore(to: Snapshot, undo: Snapshot[], redo: Snapshot[]) {
    const { sel, obj, layout } = get();
    const keep = obj && to.objects && exists(to.objects, layout, obj) ? obj : null;
    set({
      roads: to.roads,
      ...(to.roads === get().roads ? {} : { meshes: {} }),
      objects: to.objects,
      bumps: to.bumps,
      obj: keep,
      undo,
      redo,
      sel: { ...NO_SELECTION, r: Math.min(sel.r, to.roads.length - 1) },
      dirty: true,
      status: 'not saved',
    });
    wantMeshes();
  }

  function undo() {
    const s = get();
    const to = s.undo.at(-1);
    if (to) restore(to, s.undo.slice(0, -1), [...s.redo, snapshot()]);
  }

  function redo() {
    const s = get();
    const to = s.redo.at(-1);
    if (to) restore(to, [...s.undo, snapshot()], s.redo.slice(0, -1));
  }

  // ---------------------------------------------------------------- edits

  /** New roads (and anything else that changes with them): not saved, the surface checked out of date. */
  function commit(roads: Road[], extra: Partial<EditorState> = {}) {
    set((s) => ({
      roads,
      dirty: true,
      status: 'not saved',
      surface: s.surface ? { ...s.surface, stale: true } : null,
      ...extra,
    }));
    wantMeshes();
  }

  /** The roads changed by a recipe (on a draft); false if it changed nothing. */
  function edit(recipe: RoadsRecipe, extra: Partial<EditorState> = {}): boolean {
    const before = get().roads;
    const after = produce(before, (d) => {
      recipe(d as Road[]);
    });
    if (after === before && !Object.keys(extra).length) return false;
    commit(after, extra);
    return true;
  }

  /** The selected road changed (remembered first): in shape, its joined ends following, or not. */
  function change(fn: (road: Road, roads: Road[]) => void, shape = false) {
    const i = get().sel.r;
    if (!get().roads[i]) return;
    remember();
    edit((d) => {
      fn(d[i], d);
      touch(d, d[i], shape);
    });
  }

  // ---------------------------------------------------------------- the objects

  /** The objects changed by a recipe (on a draft), not saved; false if it changed nothing. Of a layout's kind (and
   * the editor's together on): every other layout whose set of that kind was the layout's gets its new set too. */
  function editObjects(recipe: ObjectsRecipe, extra: Partial<EditorState> = {}, kind?: ObjectKind): boolean {
    const s = get();
    const before = s.objects;
    if (!before) return false;
    const layout = s.layout;
    const linked = kind && isLayoutKind(kind) && s.together ? kind : null;
    const key = linked ? setKey(before.layouts[layout], linked) : '';
    const after = produce(before, (d) => {
      recipe(d as TrackObjects);
      const mine = linked ? d.layouts[layout] : undefined;
      if (!linked || !mine) return;
      for (const l of Object.keys(d.layouts)) {
        const other = d.layouts[l];
        if (l !== layout && setKey(before.layouts[l], linked) === key)
          Object.assign(other, { [linked]: structuredClone(current(mine)[linked]) });
      }
    });
    if (after === before && !Object.keys(extra).length) return false;
    set({ objects: after, dirty: true, status: 'not saved', ...extra });
    return true;
  }

  /** The objects changed (remembered first), with the layouts that share the kind's set (editObjects). */
  function changeObjects(recipe: ObjectsRecipe, kind?: ObjectKind, extra: Partial<EditorState> = {}) {
    if (!get().objects) return;
    remember();
    if (!editObjects(recipe, extra, kind)) forget();
  }

  function selectObject(obj: ObjectPick | null) {
    const { focus } = get();
    if (obj && !CATEGORIES[focus].kinds.includes(obj.kind)) setFocus(categoryOf(obj.kind));
    set({ obj, placing: null, ...(obj ? { sel: { ...NO_SELECTION } } : {}) });
  }

  function setLayout(layout: string) {
    if (get().objects?.layouts[layout]) set({ layout, obj: null });
  }

  /** The heading a new object of a kind at (x, z) gets: its set's last one's, else the nearest road's way. */
  function headingFor(kind: ObjectKind, x: number, z: number): number {
    const s = get();
    const lay = s.objects?.layouts[s.layout];
    let last: { heading: number } | null | undefined = null;
    if (isModelKind(kind) && s.objects) {
      // (the last single one of its kind in the layout)
      const mine = objectsOf(s.objects, s.layout, kind)
        .map((i) => s.objects?.objects[i])
        .filter((it) => it && !isCurve(it));
      const it = mine.at(-1);
      last = it ? { heading: it.heading ?? 0 } : null;
    } else if (kind === 'grid' || kind === 'pits') last = lay?.[kind].at(-1);
    if (last) return last.heading;
    // (a fence panel runs along the road: it faces it)
    const way = roadNear(s.roads, x, z)?.heading ?? 0;
    return kind === 'fences' ? way + Math.PI / 2 : way;
  }

  /** A timing gate across the road nearest (x, z), from its left edge to its right; undefined if no road. */
  function gateAcross(x: number, z: number): Gate | undefined {
    const q = roadNear(get().roads, x, z)?.at;
    return (
      q && {
        left: { x: q.x + q.nx * q.l, z: q.z + q.nz * q.l },
        right: { x: q.x - q.nx * q.r, z: q.z - q.nz * q.r },
      }
    );
  }

  /** An object of the kind being placed added at (wx, wz), picked. One laid along nodes (a tyre wall, a fence, an
   * area): its first click a new one, whatever was picked before; the next clicks its nodes (into the piece clicked on,
   * else on at its nearer end) while it is still picked. */
  function placeAt(wx: number, wz: number) {
    const s = get();
    if (!s.objects) return;
    const kind = s.place;
    if (isLayoutKind(kind) && !s.layout) {
      ui.alert('Pick a layout first.');
      return;
    }
    if (kind === 'marks' && s.markAcross) {
      placeAcross(wx, wz);
      return;
    }
    const heading = headingFor(kind, wx, wz);
    const gate = kind === 'timing' ? gateAcross(wx, wz) : undefined;
    // (a curve's node, or an area's corner, into the one this placing made; one picked before: a new one)
    const within = placingInto(s);
    let picked: ObjectPick | null = null;
    changeObjects((d) => {
      picked = addObject(d, s.layout, kind, wx, wz, heading, {
        within,
        gate,
        tol: 6 / s.view.ppm,
        ...(isModelKind(kind) ? { model: s.models[kind] } : {}),
        // (an area: of the track's first material)
        ...(kind === 'areas' && s.track?.materials?.[0] ? { model: s.track.materials[0] } : {}),
        // (rubber: as dark as new rubber is laid, as wide as such a band along the racing line)
        ...(kind === 'rubber' ? { rubber: newRubberPaint() } : {}),
      });
    }, kind);
    if (!picked) return;
    selectObject(picked);
    set({ placing: placedAlong(kind) ? { kind, i: (picked as ObjectPick).i } : null });
    status(
      `${within === undefined ? OBJECT_LABELS[kind].one : 'A node'} added${isLayoutKind(kind) ? ` to ${s.layout}` : ''}; not saved yet`,
    );
  }

  /** A line painted across the road at (wx, wz), from its left edge to its right (a start line), picked. */
  function placeAcross(wx: number, wz: number) {
    // (on a road: within its width, and a metre)
    const near = roadNear(get().roads, wx, wz);
    const g = near && near.d <= Math.max(near.at.l, near.at.r) + 1 ? gateAcross(wx, wz) : undefined;
    if (!g) {
      status('No road there: click on a road to paint a line across it');
      return;
    }
    let i = -1;
    changeObjects((d) => {
      const taken = names(d);
      d.marks.push(
        markThrough(
          freeName('MARK_START_', taken, 1),
          [
            [g.left.x, g.left.z],
            [g.right.x, g.right.z],
          ],
          { width: ACROSS_WIDTH, colour: 'white' },
        ),
      );
      i = d.marks.length - 1;
    }, 'marks');
    if (i < 0) return;
    selectObject({ kind: 'marks', i, j: -1 });
    status('A line painted across the road; not saved yet');
  }

  function deleteObject(obj = get().obj) {
    const s = get();
    if (!obj || !s.objects) return;
    let gone = false;
    changeObjects(
      (d) => {
        gone = removeObject(d, s.layout, obj);
      },
      obj.kind,
      { obj: null },
    );
    // (a node of a line, a curve or an area taken away (picked by it or by one of its handles): the line, curve or
    // area still picked, to go on editing it; nothing taken away: the pick kept)
    const whole: ObjectPick = { kind: obj.kind, i: obj.i, j: -1 };
    const o = get().objects;
    const node = obj.j >= 0 || obj.j === FORK || obj.j === MERGE;
    if (!gone) {
      set({ obj });
      if (node) status(keptWhy(obj));
      return;
    }
    if (node && o && exists(o, s.layout, whole)) set({ obj: whole });
    status(`${node ? 'its node' : OBJECT_LABELS[obj.kind].one} deleted; not saved yet`);
  }

  /** What is picked smoothed, whatever it is (strands.ts): the node picked, else every node; a road's (the road
   * selected's node, else all). */
  function smoothPicked() {
    const s = get();
    const st = strandOf(s);
    if (st?.of === 'road') {
      smooth();
      return;
    }
    const obj = s.obj;
    if (!st || !obj) return;
    let did = false;
    changeObjects((d) => {
      did = smoothObject(d, s.layout, obj.kind, obj.i, obj.h ? -1 : obj.j);
    }, obj.kind);
    if (did)
      status(`${obj.j >= 0 ? 'its node' : `the ${OBJECT_LABELS[obj.kind].one.toLowerCase()}`} smoothed; not saved yet`);
  }

  /** The object picked earlier or later in its list (a grid slot's number, a pit box's). */
  function reorder(by: number) {
    const { obj, layout } = get();
    if (!obj) return;
    let to: ObjectPick | null = null;
    changeObjects((d) => {
      to = reorderObject(d, layout, obj, by);
    }, obj.kind);
    if (to) set({ obj: to });
  }

  /** The layout's set of a kind made the same as another layout's. */
  function copyFrom(from: string, kind: ObjectKind) {
    const { objects, layout } = get();
    const src = objects?.layouts[from];
    if (!src || !isLayoutKind(kind) || from === layout) return;
    changeObjects(
      (d) => {
        const lay = d.layouts[layout];
        if (lay) Object.assign(lay, { [kind]: structuredClone(src[kind]) });
      },
      undefined,
      { obj: null },
    );
    status(`${OBJECT_LABELS[kind].many} of ${layout} made as ${from}'s; not saved yet`);
  }

  /** The start line a layout (the one shown, unless named) has painted along its start and finish gate (else across
   * the road at the front of its grid): chequered, a single solid white line, or none. */
  function setStartLine(style: StartLineStyle | null, which?: string) {
    const { objects } = get();
    const layout = which ?? get().layout;
    const lay = objects?.layouts[layout];
    if (!lay || (lay.start_line ?? null) === style) return;
    changeObjects((d) => {
      const l = d.layouts[layout];
      if (!l) return;
      if (style) l.start_line = style;
      else delete l.start_line;
    });
    const what =
      style === 'checker' ? 'a chequered start line' : style === 'line' ? 'a solid start line' : 'no start line';
    status(`${layout}: ${what}; not saved yet`);
  }

  // ---------------------------------------------------------------- the wireframes

  let meshTimer: ReturnType<typeof setTimeout> | undefined;
  function wantMeshes() {
    clearTimeout(meshTimer);
    meshTimer = setTimeout(fetchMeshes, meshDelay);
  }

  function currentDeps(name: string): unknown[] | null {
    const s = get();
    const find = lookup(s.roads);
    const road = find(name);
    return road ? meshDeps(road, s.roads, find) : null;
  }

  function fetchMeshes() {
    const s = get();
    // (made whether the wireframe is shown or not: each mesh made is checked for faces wrong in the game)
    const find = lookup(s.roads);
    for (const road of wiredRoads(s.roads, s.sel, find)) {
      const deps = meshDeps(road, s.roads, find);
      const have = s.meshes[road.name];
      if (have && sameDeps(have.deps, deps)) continue;
      const name = road.name;
      set((st) => ({ meshes: { ...st.meshes, [name]: { deps, state: 'loading' } } }));
      api
        .mesh(road, s.roads)
        .then((res) => {
          const now = currentDeps(name);
          if (!now || !sameDeps(now, deps)) {
            wantMeshes();
            return;
          }
          const entry = {
            deps,
            state: 'ready' as const,
            P: new Float32Array(res.P),
            F: new Uint32Array(res.F),
            ...(res.wrong ? { wrong: res.wrong } : {}),
          };
          set((st) => ({ meshes: { ...st.meshes, [name]: entry } }));
        })
        .catch((e: unknown) => {
          set((st) => ({
            meshes: { ...st.meshes, [name]: { deps, state: 'error' } },
            status: `wireframe: ${errorText(e)}`,
          }));
        });
    }
  }

  // ---------------------------------------------------------------- loading and saving

  function setRoads(list: Road[], extra: Partial<EditorState> = {}) {
    const s = get();
    const keep = s.roads[s.sel.r]?.name;
    const roads = prepareRoads(list);
    const r = keep ? roads.findIndex((x) => x.name === keep) : -1;
    set({ roads, meshes: {}, sel: { ...NO_SELECTION, r }, ...extra });
  }

  // ---------------------------------------------------------------- what the editor waits on

  let taskId = 0;

  /** Something the engine works on, said while it runs (blocking: the window waits with it). */
  async function task<T>(label: string, blocking: boolean, run: () => Promise<T>): Promise<T> {
    const id = ++taskId;
    set({ tasks: [...get().tasks, { id, label, blocking, since: Date.now() }] });
    try {
      return await run();
    } finally {
      set({ tasks: get().tasks.filter((t) => t.id !== id) });
    }
  }

  /** Each layout with no racing lines given its first ones, read from the AI files the track has for it (not saved
   * yet: saving keeps them). */
  async function readFirstLines() {
    const o = get().objects;
    if (!o) return;
    const want = Object.keys(o.layouts).filter((l) => !o.layouts[l]?.lines);
    const got: [string, RacingLines][] = [];
    for (const l of want) {
      const r = await api.firstLines(l).catch(() => null);
      if (r?.lines) got.push([l, r.lines]);
    }
    const now = get().objects;
    if (!got.length || !now) return;
    const objects = produce(now, (d) => {
      for (const [l, lines] of got) {
        const lay = d.layouts[l];
        if (lay && !lay.lines) lay.lines = castDraft(lines);
      }
    });
    set({ objects });
    status(`${get().status}; racing lines read from the AI files for ${got.length} layouts (saving keeps them)`);
  }

  /** The track loaded: its roads, objects and drawings first (the window waits for them); the track's models seen
   * from above after, while it is used (read again after the models change: a while). */
  async function load() {
    set({ booting: true });
    // (asked for at once, waited for after)
    const ctx = api.context();
    ctx.catch(() => undefined);
    try {
      let objectsFailed = '';
      let treesFailed = '';
      const [roads, drawings, objects, trees] = await task('Opening the track', true, () =>
        Promise.all([
          api.roads(),
          api.drawings(),
          api.objects().catch((e: unknown) => {
            objectsFailed = errorText(e);
            return null;
          }),
          api.trees().catch((e: unknown) => {
            treesFailed = errorText(e);
            return null;
          }),
        ]),
      );
      const lists = await api.layouts().catch(() => null);
      // (the roads' bumps: none read, none)
      const bumps = bumpsFrom(await api.bumps().catch(() => null));
      savedBumps = bumps;
      listsRead = !!lists;
      savedLists = JSON.stringify(lists?.layouts ?? {});
      const { roads: list, ...track } = roads;
      treesRead = !!trees;
      // (the trees among the objects, as the page edits them)
      const placed = objects?.objects
        ? { ...withTrees(objects.objects, trees?.trees ?? []), ...(lists ? { lists: lists.layouts } : {}) }
        : null;
      savedObjects = placed;
      setRoads(list, {
        track,
        drawings,
        dirty: false,
        objects: placed,
        objectsSeeded: objects?.seeded ?? false,
        layout: placed?.layouts[get().layout] ? get().layout : firstLayout(placed),
        obj: null,
        bumps,
        bumpPick: null,
      });
      savedRoads = get().roads;
      const first = get().roads[0];
      const o = first && geo(first, lookup(get().roads));
      if (o) set({ view: { ...get().view, cx: o.X[0], cz: o.Z[0] } });
      const loaded = `loaded ${get().roads.length} roads`;
      if (objectsFailed) status(`${loaded}; could not load the objects: ${objectsFailed}`);
      else if (objects?.seeded)
        status(`${loaded}; the objects read from the models (no objects file yet: saving writes one)`);
      else if (objects?.converted)
        status(`${loaded}; the objects read from a file of version 2, as version 3 (saving writes it so)`);
      else status(loaded);
      if (treesFailed) status(`${get().status}; could not load the trees (they are not saved): ${treesFailed}`);
      // (the catalogue as the engine has it: its models' lights, the fits and collisions they allow, a building's
      // outline; none, an empty one)
      api
        .catalogue()
        .then((c) => set({ catalogue: c.models, lightSeries: c.series ?? {} }))
        .catch(() => set({ catalogue: {} }));
    } catch (e) {
      status(`could not load: ${errorText(e)}`);
      set({ booting: false });
      return;
    }
    set({ booting: false });
    void readFirstLines();
    try {
      const items = (await task("Reading the track's models", false, () => ctx)).items;
      set({ context: items ?? [] });
    } catch (e) {
      status(`${get().status}; could not read the track's models: ${errorText(e)}`);
    }
  }

  // ---------------------------------------------------------------- the track built for Assetto Corsa

  const building = (patch: Partial<EditorState['building']>) => set({ building: { ...get().building, ...patch } });
  let following = '';

  /** The build dialog: what the engine says of building this track (a build running followed). */
  async function openBuild() {
    building({ open: true, error: '' });
    try {
      const info = await api.buildInfo();
      building({ info, job: get().building.job ?? info.last });
      if (info.running) void follow(info.running);
    } catch (e) {
      building({ error: errorText(e) });
    }
  }

  function closeBuild() {
    building({ open: false });
  }

  /** The track built (saved first, if asked: the build makes it from what is saved), and followed till it ends. */
  async function startBuild(opts: BuildOptions = {}) {
    if (get().dirty) {
      if (!ui.confirm('The build makes the track from what is saved. Save the changes first?')) return;
      await save();
      if (get().dirty) return;
    }
    building({ error: '' });
    try {
      const job = await api.startBuild(opts);
      building({ job });
      void follow(job.id);
    } catch (e) {
      building({ error: errorText(e) });
    }
  }

  /** A build asked after till it ends. */
  async function follow(id: string) {
    if (following === id) return;
    following = id;
    const wait = options.pollMs ?? 1000;
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, wait));
        const job = await api.buildJob(id);
        building({ job });
        if (job.state !== 'running') {
          if (job.state === 'done')
            status(`built: ${(job.archives ?? [{ path: job.archive }]).map((a) => a.path).join(', ')}`);
          return;
        }
      }
    } catch (e) {
      building({ error: errorText(e) });
    } finally {
      if (following === id) following = '';
    }
  }

  async function cancelBuild() {
    const job = get().building.job;
    if (job?.state !== 'running') return;
    try {
      building({ job: await api.cancelBuild(job.id) });
    } catch (e) {
      building({ error: errorText(e) });
    }
  }

  // ---------------------------------------------------------------- another track

  /** The tracks the engine can open: the one open, those found next to it and opened before. */
  function listTracks() {
    return api.tracks();
  }

  /** Another track opened (not without asking, if this one has changes not saved): the engine window keeps it open
   * from now on, and the page is loaded again on it. */
  async function openTrack(t: TrackEntry) {
    if (get().dirty && !ui.confirm(`Open ${t.name}? The changes not saved here are lost.`)) return;
    set({ opening: t });
    try {
      const opened = await api.openTrack(t.folder);
      set({ opening: { ...t, name: opened.name ?? t.name } });
    } catch (e) {
      set({ opening: null });
      ui.alert(`Could not open ${t.name}: ${errorText(e)}`);
      return;
    }
    (options.reload ?? (() => window.location.reload()))();
  }

  /** The roads and the objects saved: the roads unless only the objects changed; the objects if they changed, or
   * were only read from the models so far. */
  async function save() {
    const s = get();
    const names = s.roads.map((r) => r.name);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) {
      ui.alert(`Two roads are named ${dup}.`);
      return;
    }
    const objectsChanged = !!s.objects && (s.objects !== savedObjects || s.objectsSeeded);
    const bumpsChanged = s.bumps !== savedBumps;
    const roadsChanged = s.roads !== savedRoads || s.deleted.length > 0 || (!objectsChanged && !bumpsChanged);
    status('saving…');
    await task('Saving', true, async () => saving(s, names, objectsChanged, roadsChanged, bumpsChanged));
  }

  async function saving(
    s: EditorState,
    names: string[],
    objectsChanged: boolean,
    roadsChanged: boolean,
    bumpsChanged = false,
  ) {
    try {
      const said: string[] = [];
      if (bumpsChanged) {
        await api.saveBumps(bumpsJson(s.bumps));
        savedBumps = s.bumps;
        said.push('bumps saved');
      }
      if (roadsChanged) {
        const deleted = s.deleted.filter((n) => !names.includes(n));
        const res = await api.save(s.roads, deleted);
        setRoads(res.roads, { deleted: [] });
        savedRoads = get().roads;
        wantMeshes();
        const again = res.changed.join(', ');
        said.push(again ? `saved — heights recorded again at the next build for: ${again}` : 'saved');
      }
      if (objectsChanged && s.objects) {
        // (the trees apart, as the track keeps them, and the layouts' models; only those read)
        const { lists, ...rest } = s.objects;
        const { objects, trees } = splitTrees(rest);
        const res = await api.saveObjects(objects);
        const kept = treesRead ? (await api.saveTrees(trees)).trees : [];
        let models = lists;
        if (listsRead && lists && JSON.stringify(lists) !== savedLists) {
          models = (await api.saveLayouts(lists)).layouts;
          savedLists = JSON.stringify(models);
        }
        const back = { ...withTrees(res.objects, kept), ...(models ? { lists: models } : {}) };
        savedObjects = back;
        const { obj, layout } = get();
        set({ objects: back, objectsSeeded: false, obj: obj && exists(back, layout, obj) ? obj : null });
        said.push(treesRead ? `objects and ${kept.length} trees saved` : 'objects saved');
      }
      set({ dirty: false });
      status(said.join('; '));
    } catch (e) {
      ui.alert(`Not saved: ${errorText(e)}`);
      status('not saved');
    }
  }

  // ---------------------------------------------------------------- selection, modes, layers

  function select(sel: Partial<Selection>) {
    const before = get().sel.r;
    set({ sel: { ...get().sel, ...sel } });
    if (get().sel.r !== before) wantMeshes();
  }

  function selectRoad(r: number, center = false) {
    set({ sel: { ...NO_SELECTION, r }, obj: null });
    const road = get().roads[r];
    const o = road && geo(road, lookup(get().roads));
    if (center && o) {
      const q = pointAt(o, o.length / 2);
      set({ view: { ...get().view, cx: q.x, cz: q.z } });
    }
    wantMeshes();
  }

  function selectItem(which: 'line' | 'kerb', i: number) {
    set({ sel: { ...get().sel, line: which === 'line' ? i : -1, kerb: which === 'kerb' ? i : -1 } });
  }

  /** The category worked on: the tools it lacks put down, what it cannot pick let go, what it places chosen. */
  function setFocus(focus: Category) {
    const s = get();
    const c = CATEGORIES[focus];
    const sel =
      c.roads === 'none'
        ? { ...NO_SELECTION }
        : {
            ...s.sel,
            n: c.roads === 'shape' ? s.sel.n : -1,
            line: c.lines ? s.sel.line : -1,
            kerb: c.kerbs ? s.sel.kerb : -1,
          };
    set({
      focus,
      mode: c.modes.includes(s.mode) ? s.mode : 'select',
      newRoad: c.modes.includes('new') ? s.newRoad : null,
      measure: null,
      obj: s.obj && c.kinds.includes(s.obj.kind) ? s.obj : null,
      place: c.kinds.length && !c.kinds.includes(s.place) ? c.kinds[0] : s.place,
      sel,
    });
  }

  /** A tool: the category it belongs to worked on, if the one worked on has not got it. */
  function setMode(mode: Mode) {
    const { focus, place } = get();
    if (!CATEGORIES[focus].modes.includes(mode)) setFocus(mode === 'place' ? categoryOf(place) : 'roads');
    // (placing begun again: its first click makes a new one, whatever is picked)
    set({ mode, placing: null, ...(mode === 'new' ? {} : { newRoad: null }) });
    if (mode === 'place' && !get().layers.objects) setLayer('objects', true);
  }

  // ---------------------------------------------------------------- the roads' bumps

  /** How the bumps are made (a point at a time, a brush; its reach, its strength). */
  function setBumpBrush(b: Partial<BumpBrush>) {
    set({ bumpBrush: { ...get().bumpBrush, ...b } });
  }

  /** New bumps: not saved (remembered first, where asked: a stroke's first dab, a point's first move). */
  function editBumps(bumps: Bumps, first = false) {
    if (bumps === get().bumps) return;
    if (first) remember();
    set({ bumps, dirty: true, status: 'not saved' });
  }

  /** A dab of the brush at (x, z) (first: a stroke begun, remembered for undo). */
  function bumpDabAt(x: number, z: number, first = false) {
    const s = get();
    editBumps(bumpDab(s.bumps, x, z, s.bumpBrush), first);
  }

  /** The point of a road's mesh (of those loaded: the road picked's, and those it joins) nearest (x, z), within tol
   * metres, picked to bump; whether one was. */
  function pickBumpPoint(x: number, z: number, tol: number): boolean {
    let best: Vec2 | null = null;
    let bd = tol;
    for (const m of Object.values(get().meshes)) {
      const P = m.P;
      if (!P) continue;
      for (let i = 0; i < P.length; i += 2) {
        const d = Math.hypot((P[i] as number) - x, (P[i + 1] as number) - z);
        if (d <= bd) [bd, best] = [d, [P[i] as number, P[i + 1] as number]];
      }
    }
    set({ bumpPick: best });
    return best !== null;
  }

  /** The point picked's bump set to metres (first: remembered for undo), easing to nothing within the brush's reach
   * for a point. */
  function setBumpAtPick(metres: number, first = true) {
    const s = get();
    if (!s.bumpPick) return;
    editBumps(bumpPoint(s.bumps, s.bumpPick[0], s.bumpPick[1], metres, s.bumpBrush.reach), first);
  }

  /** Every bump taken away (remembered: undo brings them back). */
  function clearBumps() {
    if (!hasBumps(get().bumps)) return;
    editBumps(noBumps(), true);
    status('the bumps cleared; not saved yet');
  }

  /** What placing adds (and placing on). */
  function setPlace(kind: ObjectKind) {
    if (!CATEGORIES[get().focus].kinds.includes(kind)) setFocus(categoryOf(kind));
    set({ place: kind, markAcross: false });
    setMode('place');
  }

  /** Placing a line painted across the road clicked, edge to edge (a start line). */
  function paintAcross() {
    setPlace('marks');
    set({ markAcross: true });
  }

  /** What a new rubber mark is: as dark as the track lays new rubber (used where it says none), as wide as such a
   * band along the cars' racing line. */
  function newRubberPaint(): Pick<RubberMark, 'width' | 'wear'> {
    const o = get().objects;
    const w = o?.wear?.rubber;
    const wear: RubberWear = w && w !== 'new' ? w : 'used';
    return { wear, width: rubberWidth(wear, o?.ai?.width ?? CAR_WIDTH) };
  }

  /** Rubber laid along a layout's racing lines (its fast line, its pit lane line): each a rubber mark of the track's,
   * on in every layout (RUBBER_<LAYOUT>_FAST, _PIT; those laid from them before replaced), the first picked. */
  function rubberFromLines(layout = get().layout) {
    const s = get();
    const L = s.objects?.layouts[layout]?.lines;
    const lines = (['fast', 'pit'] as const).flatMap((k) => {
      const line = L?.[k];
      return line && line.curve.length > 1 ? [[k, line] as const] : [];
    });
    if (!s.objects || !lines.length) {
      status(`${layout || 'This layout'} has no racing lines to lay rubber along`);
      return;
    }
    const paint = newRubberPaint();
    let first = -1;
    let replaced = 0;
    changeObjects((d) => {
      d.rubber ??= [];
      for (const [k, line] of lines) {
        const name = `RUBBER_${layout.toUpperCase()}_${k.toUpperCase()}`;
        const m: RubberMark = {
          name,
          curve: structuredClone(line.curve),
          ...(line.closed && line.curve.length > 2 ? { closed: true } : {}),
          ...paint,
        };
        let at = d.rubber.findIndex((r) => r.name === name);
        if (at >= 0) {
          d.rubber[at] = m;
          replaced++;
        } else at = d.rubber.push(m) - 1;
        if (first < 0) first = at;
      }
    }, 'rubber');
    if (first >= 0) selectObject({ kind: 'rubber', i: first, j: -1 });
    status(
      `rubber laid along ${layout}'s ${lines.map(([k]) => (k === 'fast' ? 'fast line' : 'pit lane')).join(' and ')}${replaced ? ` (replacing ${replaced} laid before)` : ''}; not saved yet`,
    );
  }

  /** A kind's model chosen: what placing it adds, and placing it. */
  function placeModel(kind: ModelKind, model: string) {
    set({ models: { ...get().models, [kind]: model } });
    setPlace(kind);
  }

  /** The object picked made another model (of its kind). */
  function setModel(model: string) {
    const { obj } = get();
    if (!obj || !isModelKind(obj.kind)) return;
    const kind = obj.kind;
    changeObjects((d) => {
      const it = d.objects[obj.i];
      if (it) it.model = model;
    }, kind);
    set({ models: { ...get().models, [kind]: model } });
  }

  function setLayer(name: LayerName, on: boolean) {
    set({ layers: { ...get().layers, [name]: on } });
    if (name === 'wire') wantMeshes();
  }

  function cancel() {
    if (get().bring.open) {
      set({ bring: { ...get().bring, open: false } });
      return;
    }
    if (get().lining.drawing) {
      set({ lining: { ...get().lining, drawing: false } });
      return;
    }
    set({ newRoad: null, measure: null, mode: 'select', obj: null, sel: { ...get().sel, n: -1, line: -1, kerb: -1 } });
  }

  // ---------------------------------------------------------------- grid slots and pit boxes along a line

  /** What is laid out along the line (the grid or the pit boxes), and how (a change to its way of laying out). */
  function setLining(kind: LineUpKind, plan: Partial<LineUp> = {}) {
    const l = get().lining;
    set({ lining: { ...l, kind, plans: { ...l.plans, [kind]: { ...l.plans[kind], ...plan } } } });
  }

  /** The line of the kind laid out drawn again: its points clicked on the map (or stopped drawing). */
  function drawLine(on = true) {
    const l = get().lining;
    set({ lining: { ...l, lines: { ...l.lines, [l.kind]: { a: null, b: null } }, drawing: on } });
    if (on && get().mode !== 'select') setMode('select');
  }

  /** A point of the line clicked: its first, where the first stands; then its second, the way the rest go. */
  function linePoint(p: Vec2) {
    const l = get().lining;
    if (!l.drawing) return;
    const a = l.lines[l.kind].a;
    set({ lining: { ...l, lines: { ...l.lines, [l.kind]: { a: a ?? p, b: a ? p : null } }, drawing: !a } });
  }

  /** The mouse over the map while the line is drawn: its far end follows. */
  function lineHover(p: Vec2) {
    const l = get().lining;
    const a = l.lines[l.kind].a;
    if (l.drawing && a) set({ lining: { ...l, lines: { ...l.lines, [l.kind]: { a, b: p } } } });
  }

  /** What the kind laid out makes along its line: spots (the grid's slots, the pit boxes) or paint marks. */
  function lined(): { spots: Spot[]; marks: PaintMark[] } {
    const { kind, plans, lines } = get().lining;
    const { a, b } = lines[kind];
    const spots = a && b ? lineUp(plans[kind], a, b) : [];
    const box = plans[kind].box;
    return { spots, marks: isPaint(kind) && box ? boxMarks(spots, box, PAINT_PREFIX[kind]) : [] };
  }

  /** A box of a paint kind painted round each spot: the paint of that kind laid out before there gone (elsewhere kept:
   * another layout's grid on another straight), the new marks numbered on from the highest kept. */
  function repaint(kind: 'gridPaint' | 'pitPaint', spots: readonly Spot[], box: BoxPaint) {
    const prefix = PAINT_PREFIX[kind];
    let made = 0;
    let replaced = 0;
    changeObjects((d) => {
      const gone = new Set(paintAt(d.marks, spots, box, prefix).map((m) => m.name));
      replaced = gone.size;
      const kept = d.marks.filter((m) => !gone.has(m.name));
      const marks = boxMarks(spots, box, prefix, lastPaintNumber(kept, prefix));
      made = marks.length;
      d.marks = [...kept, ...castDraft(marks)];
    }, 'marks');
    set({ obj: null });
    status(
      `${made} paint marks laid out (${kind === 'gridPaint' ? 'the grid' : 'the pit boxes'})${replaced ? `, replacing ${replaced} there` : ''}; not saved yet`,
    );
  }

  /** What is laid out along the line put down: the layout's grid slots or pit boxes (the others with the same set
   * too), or their paint (every layout's, the paint laid out before replaced). */
  function placeLining() {
    const s = get();
    const { kind, drawing } = s.lining;
    if (!s.objects || drawing) return;
    const { spots } = lined();
    if (!spots.length) return;
    if (isPaint(kind)) {
      const box = s.lining.plans[kind].box;
      if (box) repaint(kind, spots, box);
      return;
    }
    if (!s.layout) {
      ui.alert('Pick a layout first.');
      return;
    }
    changeObjects((d) => {
      d.layouts[s.layout] ??= emptyLayout();
      d.layouts[s.layout][kind] = spots;
    }, kind);
    set({ obj: null });
    status(`${spots.length} ${kind === 'grid' ? 'grid slots' : 'pit boxes'} laid out on ${s.layout}; not saved yet`);
  }

  /** The paint (the kind laid out's) round each of the layout's own grid slots or pit boxes, as they are. */
  function paintRoundSpots() {
    const s = get();
    const { kind, plans } = s.lining;
    const box = plans[kind].box;
    const spots = s.objects?.layouts[s.layout]?.[kind === 'pitPaint' ? 'pits' : 'grid'];
    if (!isPaint(kind) || !box || !spots?.length) return;
    repaint(kind, spots, box);
  }

  // ---------------------------------------------------------------- nodes and roads

  /** A node added at (wx, wz) to what is picked, whatever it is laid along nodes (strands.ts): a road, a tyre wall,
   * a fence, an area, a racing line. */
  function addNodeAt(wx: number, wz: number) {
    const st = strandOf(get());
    if (!st) {
      status('pick what the node goes on first (Select, V): a road, a tyre wall, a fence, an area or a racing line');
      return;
    }
    if (st.of === 'road') addRoadNode(st.r, wx, wz);
    else addObjectNode(st.kind, st.i, wx, wz);
  }

  /** A double click while selecting, at (wx, wz): a node added there if it is on what is picked (within tol metres of
   * it), not on one of its nodes. Whether one was. */
  function doubleClickAt(wx: number, wz: number, tol: number): boolean {
    const s = get();
    const st = strandOf(s);
    if (!st || offStrand(s, st, wx, wz) > tol || onNode(s, st, wx, wz, tol)) return false;
    addNodeAt(wx, wz);
    return true;
  }

  function addRoadNode(i: number, wx: number, wz: number) {
    const s = get();
    const road = s.roads[i];
    if (!road) return;
    const find = lookup(s.roads);
    if (road.along) {
      const parent = find(road.along.road);
      const op = parent && geo(parent, find);
      if (!op) return;
      const at = Math.round(nearestOn(op, wx, wz).s * 10) / 10;
      if (at <= road.along.from || at >= road.along.to) return;
      remember();
      let n = -1;
      edit((d) => {
        n = addProfilePoint(d[i], at);
        touch(d, d[i]);
      });
      select({ n });
      return;
    }
    const o = geo(road, find);
    if (!road.curve || !o) return;
    remember();
    const [after, res] = produceWith(s.roads, (d) => {
      const out = addNode(d[i], o, wx, wz);
      if (out.ok) touch(d, d[i]);
      return out;
    });
    if (!res.ok) {
      forget();
      ui.alert(res.why);
      return;
    }
    commit(after, { sel: { ...get().sel, n: res.n } });
  }

  function addObjectNode(kind: ObjectKind, i: number, wx: number, wz: number) {
    const s = get();
    let picked: ObjectPick | null = null;
    changeObjects((d) => {
      picked = addObjectNodeTo(d, s.layout, kind, i, wx, wz, 6 / s.view.ppm);
    }, kind);
    if (!picked) return;
    set({ obj: picked });
    status(`a node added to the ${OBJECT_LABELS[kind].one.toLowerCase()}; not saved yet`);
  }

  function deleteSelected() {
    const s = get();
    if (s.obj) {
      deleteObject();
      return;
    }
    const i = s.sel.r;
    const road = s.roads[i];
    if (!road) return;
    const { n, line, kerb } = s.sel;
    remember();
    if (line >= 0) edit((d) => d[i].lines?.splice(line, 1), { sel: { ...s.sel, line: -1 } });
    else if (kerb >= 0) edit((d) => d[i].kerbs?.splice(kerb, 1), { sel: { ...s.sel, kerb: -1 } });
    else if (n >= 0 && road.curve && road.curve.length <= 2) {
      forget();
      status(keptWhy({ of: 'road' }));
    } else if (n >= 0 && road.curve)
      edit(
        (d) => {
          unjoinEnds(d, d[i], n);
          d[i].curve?.splice(n, 1);
          touch(d, d[i]);
        },
        { sel: { ...s.sel, n: -1 } },
      );
    else if (n >= 0 && road.along && road.profile?.length)
      edit(
        (d) => {
          const r = d[i];
          const w = r.profile?.[n]?.[1];
          r.profile?.splice(n, 1);
          if (!r.profile?.length) {
            delete r.profile;
            r.width = w;
          }
          touch(d, r);
        },
        { sel: { ...s.sel, n: -1 } },
      );
    else forget();
  }

  function deleteRoad() {
    const s = get();
    const i = s.sel.r;
    const road = s.roads[i];
    if (!road) {
      status('select a road to delete first');
      return;
    }
    if (!ui.confirm(`Delete ${road.name} from the described roads? (Its old mesh stays as it is.)`)) return;
    remember();
    edit(
      (d) => {
        const r = d[i];
        if (r.curve) {
          unjoinEnds(d, r, 0);
          unjoinEnds(d, r, r.curve.length - 1);
        }
        d.splice(i, 1);
      },
      { deleted: [...s.deleted, road.was ?? road.name], sel: { ...NO_SELECTION } },
    );
  }

  /** The selected road up or down the list: the order roads are built in, each over those after it. */
  function moveRoad(by: number) {
    const i = get().sel.r;
    const j = i + by;
    if (i < 0 || j < 0 || j >= get().roads.length) return;
    remember();
    edit(
      (d) => {
        [d[i], d[j]] = [d[j], d[i]];
      },
      { sel: { ...get().sel, r: j }, meshes: {} },
    );
  }

  function joinNearest(n = get().sel.n) {
    const i = get().sel.r;
    const road = get().roads[i];
    if (!road?.curve || n < 0) return;
    remember();
    const [after, res] = produceWith(get().roads, (d) => joinEnds(d, d[i], n));
    if (!res.ok) {
      forget();
      ui.alert(res.why);
      return;
    }
    const moved = res.moved > 0.01 ? ` (moved ${res.moved.toFixed(2)} m)` : '';
    commit(after);
    status(`joined ${road.name}'s ${n === 0 ? 'start' : 'end'} to ${res.other}'s ${res.otherEnd}${moved}`);
  }

  function unjoin(n = get().sel.n) {
    const i = get().sel.r;
    if (!get().roads[i]?.curve?.[n]?.joint) return;
    remember();
    edit((d) => unjoinEnds(d, d[i], n));
  }

  function smooth(only = get().sel.n) {
    const road = selected();
    if (!road?.curve || road.along) return;
    change((r) => autoHandles(r, only), true);
  }

  function reverse() {
    const road = selected();
    const o = road && geo(road, lookup(get().roads));
    if (!road?.curve || !o) return;
    change((r, d) => reverseRoad(d, r, o.length), true);
  }

  function snapEnds() {
    const find = lookup(get().roads);
    const geoOf = (name: string) => {
      const r = find(name);
      return r ? geo(r, find) : null;
    };
    change((r) => snapEndsOnto(r, geoOf), true);
  }

  function rename(name: string) {
    const now = name.trim();
    const road = selected();
    if (!road || !now || now === road.name) return;
    change((r, d) => {
      const was = r.name;
      r.name = now;
      renameInJoints(d, was, now);
    });
  }

  // ---------------------------------------------------------------- lines and rumbles

  function addLine(side: Side) {
    const road = selected();
    if (!road) return;
    const short = road.name.replace(/^1ROAD_/, '');
    const index = road.lines?.length ?? 0;
    change((r) => {
      r.lines ??= [];
      r.lines.push({
        name: `LINE_ROAD_${short}_${side === 'left' ? 'L' : 'R'}`,
        side,
        from: 0,
        to: null,
        colour: 'white',
      });
    });
    select({ line: index, kerb: -1 });
  }

  function addKerb(side: Side) {
    const road = selected();
    if (!road) return;
    const o = geo(road, lookup(get().roads));
    const index = road.kerbs?.length ?? 0;
    change((r) => {
      r.kerbs ??= [];
      r.kerbs.push({
        side,
        from: 0,
        to: Math.min(10, o ? o.length : 10),
        kind: 'ramp',
        width: KERB_WIDTH,
        inset: 0,
        start: 'square',
        end: 'square',
        taper: KERB_TAPER,
      });
    });
    select({ kerb: index, line: -1 });
  }

  function removeItem(which: 'line' | 'kerb', idx: number) {
    change((r) => {
      (which === 'line' ? r.lines : r.kerbs)?.splice(idx, 1);
    });
    select({ line: -1, kerb: -1 });
  }

  // ---------------------------------------------------------------- new roads, roads brought in

  function addNewRoadPoint(p: Vec2) {
    let nr = get().newRoad;
    if (!nr) {
      // (named the first 1ROAD_NEW_<n> no road has; renamed in its inspector)
      const taken = lookup(get().roads);
      let k = get().roads.length + 1;
      while (taken(`1ROAD_NEW_${k}`)) k++;
      nr = { name: `1ROAD_NEW_${k}`, points: [] };
    }
    set({ newRoad: { ...nr, points: [...nr.points, p] } });
  }

  function finishNewRoad() {
    const nr = get().newRoad;
    set({ newRoad: null });
    if (!nr || nr.points.length < 2) return;
    remember();
    edit((d) => d.push(castDraft(newRoad(nr.name, nr.points))), {
      sel: { ...NO_SELECTION, r: get().roads.length },
      mode: 'select',
    });
  }

  async function openBring() {
    set({ bring: { open: true, loading: true, meshes: [] } });
    try {
      const meshes = await task('Listing the meshes', false, () => api.meshes());
      const find = lookup(get().roads);
      set({ bring: { open: get().bring.open, loading: false, meshes: meshes.filter((m) => !find(m.name)) } });
    } catch (e) {
      set({ bring: { ...get().bring, loading: false } });
      status(`could not list the meshes: ${errorText(e)}`);
    }
  }

  function closeBring() {
    set({ bring: { ...get().bring, open: false } });
  }

  async function bringIn(m: RoadMesh) {
    status(`reading ${m.name}…`);
    let res: Awaited<ReturnType<EngineClient['bring']>>;
    try {
      res = await task(`Bringing in ${m.name}`, true, () => api.bring(m.model, m.name));
    } catch (e) {
      status(`could not bring in ${m.name}: ${errorText(e)}`);
      return;
    }
    if (!res.roads?.length) {
      status(`could not bring in ${m.name}: nothing read`);
      return;
    }
    remember();
    const find = lookup(get().roads);
    const fresh = res.roads.filter((r) => !find(r.name));
    const names = new Set(fresh.map((r) => r.name));
    const how = READ_AS[res.how] ?? READ_AS.rows;
    edit(
      (d) => {
        for (const r of fresh) d.push(castDraft({ lines: [], kerbs: [], ...r, moved: true }));
      },
      {
        deleted: get().deleted.filter((n) => !names.has(n)),
        bring: { ...get().bring, open: false },
        view: { ...get().view, cx: (m.box[0] + m.box[2]) / 2, cz: (m.box[1] + m.box[3]) / 2 },
      },
    );
    const first = get().roads.findIndex((r) => r.name === res.roads[0].name);
    if (CATEGORIES[get().focus].roads === 'none') setFocus('roads');
    set({ sel: { ...NO_SELECTION, r: first } });
    status(`brought in ${res.roads.map((r) => r.name).join(' and ')} (read ${how}); not saved yet`);
  }

  // ---------------------------------------------------------------- the surface, as the build makes it

  /** The surface where one looks (up to SURFACE_WINDOW across, round the middle of the view), built and checked. */
  async function checkSurface() {
    const s = get();
    const b = viewBox(s.view, s.size);
    const cx = (b.xmin + b.xmax) / 2;
    const cz = (b.zmin + b.zmax) / 2;
    const hw = Math.min((b.xmax - b.xmin) / 2, SURFACE_WINDOW / 2);
    const hz = Math.min((b.zmax - b.zmin) / 2, SURFACE_WINDOW / 2);
    const win: [number, number, number, number] = [cx - hw, cz - hz, cx + hw, cz + hz];
    status('checking the surface here…');
    try {
      const res = await task('Checking the surface', false, () => api.surface(s.roads, win));
      set({ surface: { window: win, regions: res.regions, issues: res.issues, stale: false } });
      status(
        res.issues.length
          ? `${res.issues.length} seam problems here (ringed red) — ${res.seconds} s`
          : `surface here: no seam problems (${res.regions.length} regions, ${res.seconds} s)`,
      );
    } catch (e) {
      status(`surface check: ${errorText(e)}`);
    }
  }

  // ---------------------------------------------------------------- the paved areas' parking

  /** A row of parking bays painted along the picked area's longest edge (its marks before, of the same names, made
   * again). */
  function parkArea(bay: number, depth: number) {
    const { obj, objects } = get();
    const a = obj?.kind === 'areas' ? objects?.areas?.[obj.i] : undefined;
    if (!a) return;
    const made = parkingMarks(a, bay, depth);
    if (!made.length) {
      ui.alert('No bay fits along its longest edge.');
      return;
    }
    changeObjects((d) => {
      const prefix = `PARK_${a.name}_`;
      d.marks = [...d.marks.filter((m) => !m.name.startsWith(prefix)), ...castDraft(made)];
    }, 'marks');
    status(`${made.length - 1} parking bays painted on ${a.name}; not saved yet`);
  }

  // ---------------------------------------------------------------- the layouts

  /** A layout made as the one shown is (its spots, gates, lines, objects and models), and shown. */
  function newLayout(name: string): string | null {
    const { layout } = get();
    let bad: string | null = null;
    changeObjects((d) => {
      bad = addLayout(d, name, layout);
    });
    if (bad) return bad;
    set({ layout: name, obj: null });
    status(`layout ${name} made as ${layout}; not saved yet`);
    return null;
  }

  /** The layout shown renamed. */
  function renameShownLayout(name: string): string | null {
    const { layout } = get();
    let bad: string | null = null;
    changeObjects((d) => {
      bad = renameLayout(d, layout, name);
    });
    if (bad) return bad;
    set({ layout: name, obj: null });
    status(`layout ${layout} renamed ${name}; not saved yet`);
    return null;
  }

  /** The layout shown taken away (asked first), and another shown. */
  function removeShownLayout() {
    const { layout, objects } = get();
    if (!objects?.layouts[layout]) return;
    if (Object.keys(objects.layouts).length < 2) {
      ui.alert('A track needs a layout: make another before taking this one away.');
      return;
    }
    if (!ui.confirm(`Take the layout ${layout} away, with its grid, pits, timing, lines and the objects only it has?`))
      return;
    changeObjects((d) => removeLayout(d, layout));
    const next = Object.keys(get().objects?.layouts ?? {})[0] ?? '';
    set({ layout: next, obj: null });
    status(`layout ${layout} taken away; not saved yet`);
  }

  // ---------------------------------------------------------------- racing lines made from roads

  /** A layout's racing line begun from roads: the user clicks them in the order the lap takes them. */
  function startRouting(kind: LineKind) {
    if (!get().layout) {
      ui.alert('Pick a layout first.');
      return;
    }
    if (kind === 'pit' && (get().objects?.layouts[get().layout]?.lines?.fast?.curve.length ?? 0) < 3) {
      ui.alert('Make the fast line first: the pit lane forks off it.');
      return;
    }
    set({ routing: { kind, roads: [] }, mode: 'select', obj: null });
    status(
      `click the roads the ${kind === 'fast' ? 'lap' : 'pit lane'} runs on, in order (again: taken off); then Make the line`,
    );
  }

  /** The road under (x, z) (within its width, and tol metres) added to the line being made, or taken off it if it is
   * the last one added. */
  function routeAt(x: number, z: number, tol: number) {
    const r = get().routing;
    if (!r) return;
    const find = lookup(get().roads);
    let best: { name: string; d: number } | null = null;
    for (const road of get().roads) {
      const o = geo(road, find);
      if (!o || o.X.length < 2) continue;
      const n = nearestOn(o, x, z);
      const half = Math.max(o.L[n.i] ?? 0, o.R[n.i] ?? 0);
      if (n.d <= half + tol && (!best || n.d < best.d)) best = { name: road.name, d: n.d };
    }
    if (!best) return;
    const name = best.name;
    const roads = r.roads.at(-1) === name ? r.roads.slice(0, -1) : [...r.roads, name];
    set({ routing: { ...r, roads } });
    status(roads.length ? `the ${r.kind === 'fast' ? 'lap' : 'pit lane'}: ${roads.join(' → ')}` : 'no roads yet');
  }

  function cancelRouting() {
    set({ routing: null });
  }

  /** The layout's fast line optimised (racingline.ts: across the roads, within what its cars may use, to bend as
   * little as it can); none yet: made along the roads clicked first (routing), optimised as it is made. */
  function optimiseFast() {
    const s = get();
    const fast = s.objects?.layouts[s.layout]?.lines?.fast;
    if (!fast || fast.curve.length < 3) {
      startRouting('fast');
      status('Click the roads of the lap in order, then Make: the fast line is made along them and optimised');
      return;
    }
    const find = lookup(s.roads);
    let done = false;
    changeObjects((d) => {
      const L = d.layouts[s.layout]?.lines;
      if (!L?.fast) return;
      const curve = optimiseLine(
        current(L.fast).curve as WallNode[],
        true,
        s.roads,
        find,
        s.objects?.ai?.width ?? CAR_WIDTH,
      );
      if (curve.length < 3) return;
      L.fast.curve = castDraft(curve);
      keepPitOn(L);
      done = true;
    }, 'fast');
    if (!done) {
      ui.alert('The fast line could not be optimised here.');
      return;
    }
    selectObject({ kind: 'fast', i: 0, j: -1 });
    status('the fast line optimised: out wide, its apexes, out wide again; not saved yet');
  }

  /** The line made along the roads clicked (for the layout shown): picked, to edit. */
  function makeRouted() {
    const s = get();
    const r = s.routing;
    if (!r || !s.objects) return;
    const find = lookup(s.roads);
    const paths = r.roads.flatMap((n) => {
      const road = find(n);
      const o = road && geo(road, find);
      return o ? [{ X: o.X, Z: o.Z }] : [];
    });
    if (!paths.length) {
      ui.alert('Click the roads first.');
      return;
    }
    const lay = s.objects.layouts[s.layout];
    // (a lap from its start line: its first timing gate, else its first grid slot)
    const gate = lay?.timing[0];
    const start: Vec2 | undefined = gate
      ? [(gate.left.x + gate.right.x) / 2, (gate.left.z + gate.right.z) / 2]
      : lay?.grid[0]
        ? [lay.grid[0].x, lay.grid[0].z]
        : undefined;
    let made = false;
    changeObjects((d) => {
      d.layouts[s.layout] ??= emptyLayout();
      const L = d.layouts[s.layout] as LayoutObjects;
      L.lines ??= {};
      if (r.kind === 'fast') {
        // (along the roads, then optimised: the line a car takes, not the roads' middles)
        const along = lineFromRoads(paths, true, start);
        if (along.length < 3) return;
        const curve = optimiseLine(along, true, s.roads, find, s.objects?.ai?.width ?? CAR_WIDTH);
        L.lines.fast = { curve: curve.length >= 3 ? curve : along, closed: true };
        keepPitOn(L.lines);
        made = true;
      } else {
        const pit = pitFromRoads(L.lines, paths);
        if (!pit) return;
        L.lines.pit = pit;
        keepPitOn(L.lines);
        made = true;
      }
    }, r.kind);
    if (!made) {
      ui.alert('These roads make no line: click more of them, in order.');
      return;
    }
    set({ routing: null });
    selectObject({ kind: r.kind, i: 0, j: -1 });
    status(
      `the ${r.kind === 'fast' ? 'fast line' : 'pit lane line'} made along ${r.roads.length} roads; not saved yet`,
    );
  }

  return {
    store,
    api,
    get,
    set,
    status,
    parkArea,
    newLayout,
    renameShownLayout,
    removeShownLayout,
    startRouting,
    routeAt,
    cancelRouting,
    makeRouted,
    remember,
    forget,
    undo,
    redo,
    edit,
    change,
    wantMeshes,
    load,
    save,
    select,
    selectRoad,
    selectItem,
    setMode,
    setLayer,
    setFocus,
    setOthers: (others: Others) => set({ others }),
    toggleSidebar: (open?: boolean) => set({ sidebar: open ?? !get().sidebar }),
    toggleObjectList: (open?: boolean) => set({ objectList: open ?? !get().objectList }),
    escape: cancel,
    task,
    listTracks,
    openTrack,
    openBuild,
    closeBuild,
    startBuild,
    cancelBuild,
    addNodeAt,
    deleteSelected,
    deleteRoad,
    moveRoad,
    joinNearest,
    unjoin,
    smooth,
    reverse,
    snapEnds,
    rename,
    addLine,
    addKerb,
    removeItem,
    addNewRoadPoint,
    finishNewRoad,
    openBring,
    closeBring,
    bringIn,
    checkSurface,
    editObjects,
    changeObjects,
    selectObject,
    setLayout,
    setPlace,
    optimiseFast,
    setBumpBrush,
    bumpDabAt,
    pickBumpPoint,
    setBumpAtPick,
    clearBumps,
    paintAcross,
    rubberFromLines,
    placeModel,
    setModel,
    setLining,
    drawLine,
    linePoint,
    lineHover,
    placeLining,
    paintRoundSpots,
    lined,
    setTogether: (on: boolean) => set({ together: on }),
    placeAt,
    deleteObject,
    reorder,
    smoothPicked,
    doubleClickAt,
    copyFrom,
    setStartLine,
    /** where the spot or single object picked stands and the way it looks (a grid slot, a board, a pole), or null */
    spotPicked: () => {
      const { objects, layout, obj } = get();
      return objects && obj ? poseOf(objects, layout, obj) : null;
    },
    toggleHelp: (open?: boolean) => set({ helpOpen: open ?? !get().helpOpen }),
  };
}

export type Editor = ReturnType<typeof createEditor>;
