import { CATEGORIES, othersAlpha } from '../domain/categories';
import { CONTEXT_COLOURS, DEFAULT_MATERIAL, MARK_PX, MATERIAL_COLOURS, SURFACE_COLOURS } from '../domain/constants';
import type { Box, Road } from '../domain/types';
import { endHandles, type NodeHandle, nodeHandles } from '../editing/handles';
import { isLayoutKind, isMarkKind, marksOf, OBJECT_KINDS, OBJECT_LABELS } from '../editing/objects';
import { placingInto } from '../editing/strands';
import { band, kerbPieces, lineOffsets, pieceOffsets } from '../geometry/paint';
import { alongHandles, geo, type Lookup, lookup } from '../geometry/roads';
import { boxesMeet, pointAt, span } from '../geometry/samples';
import { roadShapes } from '../geometry/shapes';
import { meshDeps, sameDeps, wiredRoads } from '../store/meshes';
import type { EditorState, MeshEntry, SurfaceCheck } from '../store/state';
import { drawBumps } from './bumps';
import { drawLining, drawObjectsScreen, drawObjectsWorld } from './objects';
import { paintInView, paintOf, strokePaint } from './paint';
import { type Cell, contextCells, pathOf, roadPaths, surfaceCells, wireCells } from './paths';
import { drawStartLineLabels, drawStartLines, LABELS_PPM, startLinesOf } from './startlines';
import { type TileCache, visibleTiles } from './tiles';
import { type Size, toScreen, viewBox } from './viewport';

const SELECTED = '#4fa3ff';

/** What the renderer keeps between frames: the context's and the surface's cells, the wireframes' cells. */
export class RenderCache {
  private ctxKey = '';
  private ctxItems: unknown = null;
  private ctx: Cell[] = [];
  private surfaceOf: unknown = null;
  private surface: Cell[] = [];
  private readonly wires = new WeakMap<MeshEntry, Cell[]>();

  contextCells(s: EditorState): Cell[] {
    const key = s.roads.map((r) => r.name).join('\n');
    if (key !== this.ctxKey || s.context !== this.ctxItems) {
      this.ctxKey = key;
      this.ctxItems = s.context;
      this.ctx = contextCells(s.context, new Set(s.roads.map((r) => r.name)));
    }
    return this.ctx;
  }

  surfaceCells(s: EditorState): Cell[] {
    if (s.surface?.regions !== this.surfaceOf) {
      this.surfaceOf = s.surface?.regions ?? null;
      this.surface = s.surface ? surfaceCells(s.surface.regions) : [];
    }
    return this.surface;
  }

  wireCells(m: MeshEntry): Cell[] {
    let c = this.wires.get(m);
    if (!c && m.P && m.F) {
      c = wireCells(m.P, m.F);
      this.wires.set(m, c);
    }
    return c ?? [];
  }
}

export interface Frame {
  g: CanvasRenderingContext2D;
  size: Size;
  dpr: number;
  state: EditorState;
  tiles: TileCache | null;
  cache: RenderCache;
  /** another layer (the terrain): drawn in pixels over the satellite, and over the rest; its message, if any */
  extra?: ExtraLayer;
}

export interface ExtraLayer {
  under: (g: CanvasRenderingContext2D) => void;
  over: (g: CanvasRenderingContext2D) => void;
  message: () => string;
}

/** What every layer is drawn with. */
interface Layer {
  g: CanvasRenderingContext2D;
  f: Frame;
  s: EditorState;
  find: Lookup;
  ppm: number;
  /** the world in view (and a margin) */
  b: Box;
  sel: Road | undefined;
  scr: Scr;
  /** drawing in pixels */
  screenT: () => void;
  /** drawing in metres: the canvas turned so x grows to the left, z up, ppm pixels a metre */
  worldT: () => void;
  msgs: string[];
}

/** Draws the map; the message to show over it (or ''). */
export function drawFrame(f: Frame): string {
  const { g, size, state: s } = f;
  const v = s.view;
  const L: Layer = {
    g,
    f,
    s,
    find: lookup(s.roads),
    ppm: v.ppm,
    b: viewBox(v, size, 40),
    sel: s.roads[s.sel.r],
    scr: (x, z) => toScreen(v, size, x, z),
    screenT: () => g.setTransform(f.dpr, 0, 0, f.dpr, 0, 0),
    worldT: () =>
      g.setTransform(
        -v.ppm * f.dpr,
        0,
        0,
        -v.ppm * f.dpr,
        f.dpr * (size.w / 2 + v.cx * v.ppm),
        f.dpr * (size.h / 2 + v.cz * v.ppm),
      ),
    msgs: [],
  };
  L.screenT();
  g.fillStyle = '#2a2d33';
  g.fillRect(0, 0, size.w, size.h);
  if (s.layers.sat) drawSatellite(L);
  f.extra?.under(g);
  if (s.layers.ctx) drawContext(L);
  if (s.layers.draw) drawDrawings(g, s, L.scr);
  // (the category worked on drawn as it is; the rest as the others are shown: as they are, faded or not at all)
  const cat = CATEGORIES[s.focus];
  const fade = othersAlpha(s.others);
  const shape = cat.roads === 'shape';
  const roadsAlpha = cat.roads === 'none' ? fade && Math.max(fade, 0.55) : 1;
  L.worldT();
  if (roadsAlpha) {
    g.globalAlpha = roadsAlpha;
    drawRoads(L);
    g.globalAlpha = 1;
  }
  if (L.sel && shape && s.layers.wire) drawWires(L);
  if (L.sel) drawWrongFaces(L);
  drawPaint(L, cat.kerbs ? 1 : fade, cat.lines ? 1 : fade);
  // (the roads' bumps made by hand: over the roads while they are worked on (Bumps), or in Roads)
  if (s.mode === 'bumps' || s.focus === 'roads') drawBumps(g, s, L.b, L.ppm);
  // (the layouts' start lines, painted on the ground as the build paints them: every layout's, all seen in each)
  const startAlpha = cat.lines ? 1 : fade;
  if (s.objects && startAlpha) {
    g.globalAlpha = startAlpha;
    drawStartLines(g, startLinesOf(s.objects, s.roads), L.b);
    g.globalAlpha = 1;
  }
  if (L.sel) drawSelectedItem(g, s, L.sel, L.find);
  const objects = s.layers.objects &&
    s.objects && {
      g,
      o: s.objects,
      layout: s.layout,
      picked: s.obj,
      b: L.b,
      ppm: L.ppm,
      catalogue: s.catalogue,
      paint: paintOf(s.roads, s.objects.marks, L.find),
    };
  const mine = new Set(cat.kinds);
  const rest = new Set(OBJECT_KINDS.filter((k) => !mine.has(k)));
  const eachObjects = (draw: (kinds: ReadonlySet<(typeof OBJECT_KINDS)[number]>) => void) => {
    if (fade && rest.size) {
      g.globalAlpha = fade;
      draw(rest);
      g.globalAlpha = 1;
    }
    if (mine.size) draw(mine);
  };
  if (objects) eachObjects((kinds) => drawObjectsWorld({ ...objects, kinds }));
  drawLining(g, s.lining, L.ppm);
  L.screenT();
  if (s.layers.surface && s.surface) drawSurface(L, s.surface);
  // (the start lines named by their layouts, where the paint is worked on and near enough to read)
  if (s.objects && cat.lines && L.ppm >= LABELS_PPM)
    drawStartLineLabels(g, startLinesOf(s.objects, s.roads), L.b, L.scr);
  if (s.layers.names && roadsAlpha) {
    g.globalAlpha = roadsAlpha;
    drawNames(g, s.roads, L.find, L.b, L.scr);
    g.globalAlpha = 1;
  }
  if (L.sel) drawHandles(g, s, L.sel, L.find, L.scr, shape);
  if (objects) eachObjects((kinds) => drawObjectsScreen({ ...objects, kinds }, L.scr));
  drawOverlays(g, s, L.scr);
  f.extra?.over(g);
  L.msgs.push(...modeMessages(s, L.sel));
  const extra = f.extra?.message();
  if (extra) L.msgs.push(extra);
  return L.msgs.at(-1) ?? '';
}

function drawSatellite({ g, f, s, scr, ppm }: Layer) {
  if (!s.track || !f.tiles) return;
  for (const t of visibleTiles(s.view, f.size, s.track)) {
    const im = f.tiles.get(t.level, t.tx, t.ty);
    if (!im.complete || !im.naturalWidth) continue;
    const [sx, sy] = scr(t.x, t.z);
    g.drawImage(im, sx, sy, (im.naturalWidth / t.k) * ppm, (im.naturalHeight / t.k) * ppm);
  }
}

function drawContext({ g, f, s, b, ppm, worldT, screenT }: Layer) {
  worldT();
  g.lineWidth = 1 / ppm;
  for (const c of f.cache.contextCells(s)) {
    if (!boxesMeet(c.box, b)) continue;
    const col = CONTEXT_COLOURS[c.kind] ?? 'rgba(255,255,255,0.5)';
    if (c.kind === 'tyre') {
      g.fillStyle = col;
      g.fill(c.path);
    } else {
      g.strokeStyle = col;
      g.stroke(c.path);
    }
  }
  screenT();
}

/** The roads in view, the selected one over the rest. */
function drawRoads({ g, s, find, b, ppm, sel }: Layer) {
  s.roads.forEach((r, i) => {
    const o = geo(r, find);
    if (o && boxesMeet(o.box, b) && i !== s.sel.r) drawRoad(g, r, find, ppm, false);
  });
  if (sel) drawRoad(g, sel, find, ppm, true);
}

/** The wireframes of the selected road and those joined to it, as the track's build makes their meshes. */
function drawWires({ g, f, s, find, b, ppm, msgs }: Layer) {
  for (const r of wiredRoads(s.roads, s.sel, find)) {
    const m = s.meshes[r.name];
    if (m?.state !== 'ready' || !sameDeps(m.deps, meshDeps(r, s.roads, find))) continue;
    if (ppm < 5) {
      msgs.push('Zoom in to see the wireframe');
      continue;
    }
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = 0.6 / ppm;
    for (const c of f.cache.wireCells(m)) if (boxesMeet(c.box, b)) g.stroke(c.path);
  }
}

/** The faces of the selected roads' meshes that would be wrong in the game (the engine checks each mesh made): those
 * facing down filled red, those without area (no normal) ringed red. */
function drawWrongFaces({ g, s, find, ppm }: Layer) {
  for (const r of wiredRoads(s.roads, s.sel, find)) {
    const m = s.meshes[r.name];
    const w = m?.state === 'ready' ? m.wrong : undefined;
    const { P, F } = m ?? {};
    if (!w || !P || !F || (!w.down.length && !w.thin.length)) continue;
    if (!sameDeps(m.deps, meshDeps(r, s.roads, find))) continue;
    const at = (i: number, k: number): [number, number] => [P[F[i * 3 + k] * 2], P[F[i * 3 + k] * 2 + 1]];
    g.fillStyle = 'rgba(255,69,58,0.8)';
    for (const i of w.down) {
      g.beginPath();
      g.moveTo(...at(i, 0));
      g.lineTo(...at(i, 1));
      g.lineTo(...at(i, 2));
      g.closePath();
      g.fill();
    }
    g.strokeStyle = '#ff453a';
    g.lineWidth = 1.5 / ppm;
    for (const i of w.thin) {
      const [a, b, c] = [at(i, 0), at(i, 1), at(i, 2)];
      g.beginPath();
      g.arc((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, 4 / ppm, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

/** Every road's rumbles in view, over all the roads; then the edge lines as painted, over them. */
function drawPaint({ g, s, find, b, ppm }: Layer, kerbsAlpha = 1, linesAlpha = 1) {
  if (!kerbsAlpha && !linesAlpha) return;
  g.globalAlpha = kerbsAlpha;
  if (s.layers.kerbs && kerbsAlpha)
    for (const r of s.roads) {
      const o = geo(r, find);
      const sh = o && boxesMeet(o.box, b) ? roadShapes(r, find) : null;
      if (!sh) continue;
      for (const [col, path] of roadPaths(sh).kerbs) {
        g.fillStyle = col;
        g.fill(path);
      }
    }
  g.globalAlpha = linesAlpha;
  if (s.layers.lines && linesAlpha) {
    for (const { chain: c } of paintInView(paintOf(s.roads, s.objects?.marks, find), b, true))
      strokePaint(g, c, c.colour === 'yellow' ? '#ffd21f' : '#ffffff', 1 / ppm);
  }
  g.globalAlpha = 1;
}

/** The surface checked: its window, its faces (zoomed in), its problems ringed. */
function drawSurface(L: Layer, sf: SurfaceCheck) {
  const { g, f, s, b, ppm, scr } = L;
  L.worldT();
  const [x0, z0, x1, z1] = sf.window;
  g.setLineDash([8 / ppm, 5 / ppm]);
  g.strokeStyle = sf.stale ? 'rgba(255,200,0,0.8)' : 'rgba(120,200,255,0.8)';
  g.lineWidth = 1.5 / ppm;
  g.strokeRect(x0, z0, x1 - x0, z1 - z0);
  g.setLineDash([]);
  if (ppm >= 3) {
    g.lineWidth = 0.7 / ppm;
    for (const c of f.cache.surfaceCells(s)) {
      if (!boxesMeet(c.box, b)) continue;
      g.strokeStyle = sf.stale ? 'rgba(200,200,200,0.25)' : (SURFACE_COLOURS[c.kind] ?? SURFACE_COLOURS.road);
      g.stroke(c.path);
    }
  }
  L.screenT();
  for (const [, x, z] of sf.issues) {
    const [sx, sy] = scr(x, z);
    g.beginPath();
    g.arc(sx, sy, 9, 0, Math.PI * 2);
    g.strokeStyle = '#ff3030';
    g.lineWidth = 2.5;
    g.stroke();
    g.lineWidth = 1;
  }
  if (sf.stale) L.msgs.push('The surface shown is out of date: C to check again');
}

/** What the mode asks of the mouse. */
function modeMessages(s: EditorState, sel: Road | undefined): string[] {
  const out: string[] = [];
  if (s.newRoad) out.push('New road: click its points, Enter to finish, Esc to drop it');
  if (s.mode === 'measure') out.push('Measure: drag from one point to another (they snap; Ctrl: not), Esc to stop');
  if (s.lining.drawing)
    out.push(
      s.lining.lines[s.lining.kind].a
        ? 'Line: click the way the rest go (they snap; Ctrl: not), Esc to stop'
        : 'Line: click where the first one stands',
    );
  if (s.mode === 'add' && !s.newRoad)
    out.push(sel ? `Add node: click on ${sel.name}, or past one of its ends` : 'Add node: select a road first');
  if (s.mode === 'place') {
    const what = OBJECT_LABELS[s.place].one.toLowerCase();
    const where = isLayoutKind(s.place) ? ` to ${s.layout}` : '';
    // (the one this placing made, its nodes added; else a new one)
    const into = placingInto(s);
    const on =
      into === undefined
        ? undefined
        : s.place === 'areas'
          ? s.objects?.areas?.[into]
          : isMarkKind(s.place) && s.objects
            ? marksOf(s.objects, s.place)[into]
            : s.objects?.objects[into];
    const wall = on ? ` (on ${on.name})` : '';
    if (s.place === 'marks' && s.markAcross)
      out.push('Place: click on a road to paint a line across it, edge to edge; Esc to stop');
    else if (isMarkKind(s.place))
      out.push(
        `Place: drag from its start to its end (Shift: its way by 15°) to add a ${what}${on ? `, or click to carry ${on.name} on to there` : ''}; Esc to stop`,
      );
    else out.push(`Place: click to add a ${what}${where}${wall}; Esc to stop`);
  }
  return out;
}

type Scr = (x: number, z: number) => [number, number];

function drawDrawings(g: CanvasRenderingContext2D, s: EditorState, scr: Scr) {
  const colours = [
    ['blue', 'rgba(60,90,255,0.9)'],
    ['yellow', 'rgba(255,220,0,0.9)'],
  ] as const;
  for (const d of Object.values(s.drawings)) {
    for (const [col, css] of colours) {
      for (const st of d[col] ?? []) {
        g.beginPath();
        st.forEach((p, i) => {
          const [x, y] = scr(p[0], p[1]);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.strokeStyle = css;
        g.lineWidth = 3;
        g.stroke();
      }
    }
  }
}

function drawRoad(g: CanvasRenderingContext2D, road: Road, find: Lookup, ppm: number, selected: boolean) {
  const sh = roadShapes(road, find);
  if (!sh) return;
  const p = roadPaths(sh);
  g.fillStyle = MATERIAL_COLOURS[road.material ?? ''] ?? MATERIAL_COLOURS[DEFAULT_MATERIAL];
  g.fill(p.outline);
  let edge = '#ffe14d';
  if (selected) edge = SELECTED;
  else if (road.along) edge = '#ffaa3c';
  else if (road.joins?.some(Boolean)) edge = '#7dff9a';
  g.strokeStyle = edge;
  g.lineWidth = (selected ? 2 : 1.2) / ppm;
  g.stroke(p.sides);
  if (!road.along) {
    g.setLineDash([6 / ppm, 4 / ppm]);
    g.strokeStyle = selected ? 'rgba(79,163,255,0.9)' : 'rgba(255,255,255,0.35)';
    g.lineWidth = 1 / ppm;
    g.stroke(p.mid);
    g.setLineDash([]);
  }
}

/** The selected line or rumble outlined. */
function drawSelectedItem(g: CanvasRenderingContext2D, s: EditorState, road: Road, find: Lookup) {
  const o = geo(road, find);
  if (!o || road.along) return;
  g.strokeStyle = SELECTED;
  g.lineWidth = 2 / s.view.ppm;
  const ln = s.sel.line >= 0 ? road.lines?.[s.sel.line] : undefined;
  if (ln) {
    const [s0, s1] = span(o, ln.from, ln.to);
    const off = lineOffsets(ln);
    if (s1 > s0)
      g.stroke(
        pathOf(
          band(
            o,
            s0,
            s1,
            (q) => off.a(q) + off.sgn * 0.25,
            (q) => off.b(q) - off.sgn * 0.25,
            0.5,
          ),
          true,
        ),
      );
  }
  const k = s.sel.kerb >= 0 ? road.kerbs?.[s.sel.kerb] : undefined;
  if (k)
    for (const pc of kerbPieces(road, k, find)) {
      const off = pieceOffsets(k, pc);
      g.stroke(pathOf(band(pc.o, pc.s0, pc.s1, off.a, off.c, 0.25), true));
    }
}

function drawNames(g: CanvasRenderingContext2D, roads: readonly Road[], find: Lookup, b: Box, scr: Scr) {
  g.font = '12px system-ui';
  g.textAlign = 'center';
  for (const r of roads) {
    const o = geo(r, find);
    if (!o || !boxesMeet(o.box, b)) continue;
    const q = pointAt(o, o.length / 2);
    const [x, y] = scr(q.x, q.z);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.strokeText(r.name, x, y);
    g.fillStyle = '#fff';
    g.fillText(r.name, x, y);
  }
  g.textAlign = 'left';
}

function diamond(g: CanvasRenderingContext2D, x: number, y: number) {
  const r = MARK_PX.point;
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
}

function triangle(g: CanvasRenderingContext2D, x: number, y: number) {
  const r = MARK_PX.point;
  g.moveTo(x, y - r * 1.15);
  g.lineTo(x + r, y + r * 0.8);
  g.lineTo(x - r, y + r * 0.8);
  g.closePath();
}

/** A node's handles: their arms to the node, then each mark (node square, handle circle, width diamond). */
function drawNodeHandles(g: CanvasRenderingContext2D, s: EditorState, road: Road, find: Lookup, scr: Scr) {
  const hs = nodeHandles(road, find);
  drawArms(g, road, hs, scr);
  for (const h of hs) drawNodeMark(g, h, h.kind === 'p' && h.n === s.sel.n, scr);
}

/** The handles' arms, each from its node. */
function drawArms(g: CanvasRenderingContext2D, road: Road, hs: NodeHandle[], scr: Scr) {
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(79,163,255,0.8)';
  for (const h of hs) {
    const nd = h.kind === 'in' || h.kind === 'out' ? road.curve?.[h.n] : undefined;
    if (!nd) continue;
    const [ax, ay] = scr(nd.p[0], nd.p[1]);
    const [bx, by] = scr(h.x, h.z);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
  }
}

const HANDLE_FILLS = { p: '#ffffff', wl: '#7dff9a', wr: '#ff8ad0', in: '#cfe6ff', out: '#cfe6ff' } as const;

/** A node's square, a handle's circle, a width's diamond (L or R). */
function drawNodeMark(g: CanvasRenderingContext2D, h: NodeHandle, selected: boolean, scr: Scr) {
  const [x, y] = scr(h.x, h.z);
  g.beginPath();
  if (h.kind === 'p') g.rect(x - MARK_PX.node / 2, y - MARK_PX.node / 2, MARK_PX.node, MARK_PX.node);
  else if (h.kind === 'in' || h.kind === 'out') g.arc(x, y, MARK_PX.dot, 0, Math.PI * 2);
  else diamond(g, x, y);
  g.fillStyle = selected ? SELECTED : HANDLE_FILLS[h.kind];
  g.fill();
  g.strokeStyle = '#000';
  g.stroke();
  if (h.kind === 'wl' || h.kind === 'wr') {
    g.fillStyle = '#000';
    g.font = 'bold 10px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(h.kind === 'wl' ? 'L' : 'R', x, y + 0.5);
    g.textAlign = 'start';
    g.textBaseline = 'alphabetic';
  }
}

/** A selected line's or rumble's ends, and a run-off's ends and width points. */
function drawEndHandles(g: CanvasRenderingContext2D, s: EditorState, road: Road, find: Lookup, scr: Scr, shape = true) {
  const mark = (x: number, y: number, fill: string, shape: typeof triangle) => {
    g.beginPath();
    shape(g, x, y);
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = '#000';
    g.lineWidth = 1;
    g.stroke();
  };
  for (const h of endHandles(road, s.sel, find))
    mark(...scr(h.x, h.z), h.kind.endsWith('from') ? SELECTED : '#ff9f43', triangle);
  for (const h of shape ? alongHandles(road, find) : []) {
    const [x, y] = scr(h.x, h.z);
    if (h.kind === 'aw') mark(x, y, h.n === s.sel.n ? SELECTED : '#ffaa3c', diamond);
    else mark(x, y, h.kind === 'afrom' ? SELECTED : '#ff9f43', triangle);
  }
}

/** Joined ends ringed; the first node marked: the road's start. */
function drawEnds(g: CanvasRenderingContext2D, road: Road, scr: Scr) {
  g.strokeStyle = '#7dff9a';
  g.lineWidth = 2;
  for (const nd of road.curve ?? []) {
    if (!nd.joint) continue;
    const [x, y] = scr(nd.p[0], nd.p[1]);
    g.beginPath();
    g.arc(x, y, 10, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 1;
  const first = road.curve?.[0];
  if (first) {
    const [x, y] = scr(first.p[0], first.p[1]);
    g.fillStyle = '#fff';
    g.font = 'bold 11px system-ui';
    g.fillText('start', x + 8, y - 8);
  }
}

/** The selected road's handles: its lines' and rumbles' ends; its nodes and its start too while its shape is edited. */
function drawHandles(g: CanvasRenderingContext2D, s: EditorState, road: Road, find: Lookup, scr: Scr, shape = true) {
  if (shape) drawNodeHandles(g, s, road, find, scr);
  drawEndHandles(g, s, road, find, scr, shape);
  if (shape) drawEnds(g, road, scr);
}

function drawOverlays(g: CanvasRenderingContext2D, s: EditorState, scr: Scr) {
  if (s.snapMark) {
    const [x, y] = scr(s.snapMark.x, s.snapMark.z);
    g.beginPath();
    g.arc(x, y, 8, 0, Math.PI * 2);
    g.strokeStyle = '#3ee8ff';
    g.lineWidth = 2;
    g.stroke();
    g.lineWidth = 1;
    g.font = '11px system-ui';
    g.fillStyle = '#3ee8ff';
    g.fillText(s.snapMark.label, x + 11, y - 9);
  }
  if (s.measure) {
    const m = s.measure;
    const [ax, ay] = scr(m.a[0], m.a[1]);
    const [bx, by] = scr(m.b[0], m.b[1]);
    const dx = m.b[0] - m.a[0];
    const dz = m.b[1] - m.a[1];
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.strokeStyle = '#ffe14d';
    g.lineWidth = 2;
    g.stroke();
    g.lineWidth = 1;
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
    ]) {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fillStyle = '#ffe14d';
      g.fill();
    }
    const label = `${Math.hypot(dx, dz).toFixed(2)} m  (dx ${dx.toFixed(2)}, dz ${dz.toFixed(2)})`;
    g.font = 'bold 12px system-ui';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.strokeText(label, (ax + bx) / 2 + 8, (ay + by) / 2 - 8);
    g.fillStyle = '#ffe14d';
    g.fillText(label, (ax + bx) / 2 + 8, (ay + by) / 2 - 8);
    g.lineWidth = 1;
  }
  if (s.newRoad) {
    const pts = s.newRoad.points.concat(s.mouse ? [s.mouse] : []);
    g.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = scr(p[0], p[1]);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.strokeStyle = '#ffe14d';
    g.lineWidth = 2;
    g.setLineDash([5, 4]);
    g.stroke();
    g.setLineDash([]);
    for (const p of s.newRoad.points) {
      const [x, y] = scr(p[0], p[1]);
      g.fillStyle = '#ffe14d';
      g.fillRect(x - 4, y - 4, 8, 8);
    }
  }
}
