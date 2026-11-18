import { useCallback, useEffect, useRef } from 'react';
import { fromPx, latLonOf, TILE, toPx } from './geo';

export interface MapView {
  lat: number;
  lon: number;
  /** fractional: tiles at its whole zoom, scaled */
  zoom: number;
}

interface PlaceMapProps {
  view: MapView;
  onView: (v: MapView) => void;
  /** the track's origin, and the area round it (metres across, x, and deep, z) and its map picture's span */
  origin: { lat: number; lon: number };
  width: number;
  depth: number;
  span: number;
  onOrigin: (lat: number, lon: number) => void;
  /** a tile's address */
  tileUrl: (z: number, x: number, y: number) => string;
  /** what a tile's address is shown from, where not itself (the engine window's tile, as a blob's URL) */
  tileSrc?: (url: string) => Promise<string>;
  /** the tiles' provider, said on the map */
  attribution: string;
  /** the most the tiles zoom in */
  top: number;
}

const MIN_ZOOM = 2;
const tiles = new Map<string, HTMLImageElement>();

/** The map the track's place is picked on: the provider's tiles; drag to pan, the wheel (or + and -) to zoom, a click
 * (or Enter) to put the track's origin there (the middle with the keys); its area drawn round the origin, the
 * editor's map picture inside it dashed. */
export function PlaceMap(p: Readonly<PlaceMapProps>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; view: MapView; moved: boolean } | null>(null);
  const frame = useRef(0);
  const props = useRef(p);
  props.current = p;

  const draw = useCallback(() => {
    frame.current = 0;
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const { view, origin, width, depth, span, tileUrl, attribution } = props.current;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1c1c1e';
    g.fillRect(0, 0, w, h);
    const z = Math.max(MIN_ZOOM, Math.min(Math.floor(view.zoom), props.current.top));
    const k = 2 ** (view.zoom - z);
    const [cx, cy] = toPx(view.lat, view.lon, z);
    const size = TILE * k;
    const x0 = cx - w / 2 / k;
    const y0 = cy - h / 2 / k;
    const n = 2 ** z;
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + h / k) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + w / k) / TILE); tx++) {
        const url = tileUrl(z, ((tx % n) + n) % n, ty);
        let im = tiles.get(url);
        if (!im) {
          im = new Image();
          im.onload = () => {
            if (!frame.current) frame.current = requestAnimationFrame(draw);
          };
          const shown = im;
          const src = props.current.tileSrc;
          if (src)
            src(url).then(
              (u) => {
                shown.src = u;
              },
              () => tiles.delete(url),
            );
          else im.src = url;
          tiles.set(url, im);
        }
        if (im.complete && im.naturalWidth) g.drawImage(im, (tx * TILE - x0) * k, (ty * TILE - y0) * k, size, size);
      }
    }
    // (the track's x and z on the map)
    const at = (x: number, zz: number): [number, number] => {
      const [la, lo] = latLonOf(origin.lat, origin.lon, x, zz);
      const [px, py] = toPx(la, lo, view.zoom);
      const [vx, vy] = toPx(view.lat, view.lon, view.zoom);
      return [w / 2 + px - vx, h / 2 + py - vy];
    };
    const rect = (hw: number, hd: number) => {
      g.beginPath();
      const pts = [at(hw, hd), at(-hw, hd), at(-hw, -hd), at(hw, -hd)];
      g.moveTo(...pts[0]);
      for (const q of pts.slice(1)) g.lineTo(...q);
      g.closePath();
    };
    rect(width / 2, depth / 2);
    g.fillStyle = 'rgba(10,132,255,0.12)';
    g.fill();
    g.strokeStyle = '#0a84ff';
    g.lineWidth = 2;
    g.stroke();
    rect(span / 2, span / 2);
    g.setLineDash([6, 4]);
    g.strokeStyle = '#ffd60a';
    g.lineWidth = 1.5;
    g.stroke();
    g.setLineDash([]);
    const [ox, oy] = at(0, 0);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(ox - 9, oy);
    g.lineTo(ox + 9, oy);
    g.moveTo(ox, oy - 9);
    g.lineTo(ox, oy + 9);
    g.stroke();
    // (north: z)
    const [nx, ny] = at(0, Math.min(width, depth) / 2);
    g.font = '600 12px system-ui, sans-serif';
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.fillText('N  (+z)', nx, ny - 6);
    g.textAlign = 'right';
    g.font = '11px system-ui, sans-serif';
    const tw = g.measureText(attribution).width;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(w - tw - 12, h - 20, tw + 12, 20);
    g.fillStyle = '#f5f5f7';
    g.fillText(attribution, w - 6, h - 6);
  }, []);

  const redraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    redraw();
  });
  useEffect(() => {
    const c = canvas.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(redraw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [redraw]);

  /** The latitude and longitude under a point of the canvas. */
  const under = (sx: number, sy: number): [number, number] => {
    const c = canvas.current;
    const { view } = props.current;
    const [vx, vy] = toPx(view.lat, view.lon, view.zoom);
    return fromPx(vx + sx - (c?.clientWidth ?? 0) / 2, vy + sy - (c?.clientHeight ?? 0) / 2, view.zoom);
  };
  const zoomTo = (zoom: number, sx?: number, sy?: number) => {
    const { view, onView, top } = props.current;
    const zz = Math.max(MIN_ZOOM, Math.min(top + 1, zoom));
    const c = canvas.current;
    if (sx === undefined || sy === undefined || !c) {
      onView({ ...view, zoom: zz });
      return;
    }
    // (the point under the mouse kept there)
    const [la, lo] = under(sx, sy);
    const [px, py] = toPx(la, lo, zz);
    const [lat, lon] = fromPx(px - (sx - c.clientWidth / 2), py - (sy - c.clientHeight / 2), zz);
    onView({ lat, lon, zoom: zz });
  };
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.current?.getBoundingClientRect();
    return [e.clientX - (r?.left ?? 0), e.clientY - (r?.top ?? 0)];
  };

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const [sx, sy] = local(e);
      zoomTo(props.current.view.zoom - Math.sign(e.deltaY) * 0.5, sx, sy);
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  });

  const pan = (dx: number, dy: number) => {
    const { view, onView } = props.current;
    const [vx, vy] = toPx(view.lat, view.lon, view.zoom);
    const [lat, lon] = fromPx(vx + dx, vy + dy, view.zoom);
    onView({ ...view, lat, lon });
  };

  /** What a key does on the map; whether it did anything. */
  const keyed = (key: string): boolean => {
    const step = 80;
    const { view } = props.current;
    switch (key) {
      case 'ArrowLeft':
        pan(-step, 0);
        return true;
      case 'ArrowRight':
        pan(step, 0);
        return true;
      case 'ArrowUp':
        pan(0, -step);
        return true;
      case 'ArrowDown':
        pan(0, step);
        return true;
      case '+':
      case '=':
        zoomTo(view.zoom + 1);
        return true;
      case '-':
        zoomTo(view.zoom - 1);
        return true;
      case 'Enter':
        props.current.onOrigin(view.lat, view.lon);
        return true;
      default:
        return false;
    }
  };

  return (
    <canvas
      ref={canvas}
      className="place-map"
      tabIndex={0}
      aria-label="The map: drag to move it, the wheel or + and - to zoom, click (or Enter at its middle) to put the track there; arrows move it"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, view: props.current.view, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.moved = true;
        if (!d.moved) return;
        const [vx, vy] = toPx(d.view.lat, d.view.lon, d.view.zoom);
        const [lat, lon] = fromPx(vx - (e.clientX - d.x), vy - (e.clientY - d.y), d.view.zoom);
        props.current.onView({ ...d.view, lat, lon });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) props.current.onOrigin(...under(...local(e)));
      }}
      onKeyDown={(e) => {
        if (keyed(e.key)) e.preventDefault();
      }}
    />
  );
}
