import { useEffect, useMemo, useRef } from "react";
import { useEditor } from "../store/EditorContext";
import { TerrainInteractions } from "../terrain/interactions";
import { terrainLayer } from "../terrain/layer";
import { TerrainRenderCache } from "../terrain/render";
import { useTerrainMaybe } from "../terrain/TerrainContext";
import { MapInteractions, type Pointer } from "./interactions";
import { onPicture } from "./pictures";
import { drawFrame, RenderCache } from "./renderer";
import { TileCache } from "./tiles";
import { toWorld } from "./viewport";

const pointer = (e: MouseEvent, canvas: HTMLCanvasElement): Pointer => {
	const r = canvas.getBoundingClientRect();
	return {
		sx: e.clientX - r.left,
		sy: e.clientY - r.top,
		button: e.button,
		shift: e.shiftKey,
		alt: e.altKey,
		ctrl: e.ctrlKey || e.metaKey,
	};
};

/** The map: drawn from the editor's state whenever it changes, and the mouse on it. */
export function MapCanvas() {
	const editor = useEditor();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const msgRef = useRef<HTMLOutputElement>(null);
	const interactions = useMemo(() => new MapInteractions(editor), [editor]);
	const terrain = useTerrainMaybe();
	const terrainMouse = useMemo(
		() =>
			terrain &&
			new TerrainInteractions(terrain, () => {
				const s = editor.get();
				return { view: s.view, size: s.size, space: s.space };
			}),
		[terrain, editor],
	);

	useEffect(() => {
		const canvas = canvasRef.current;
		const g = canvas?.getContext("2d");
		if (!canvas || !g) return;
		const cache = new RenderCache();
		const terrainCache = new TerrainRenderCache(() => redraw());
		let queued = 0;
		const draw = () => {
			queued = 0;
			const msg = drawFrame({
				g,
				size: editor.get().size,
				dpr: window.devicePixelRatio || 1,
				state: editor.get(),
				tiles,
				cache,
				extra: terrain ? terrainLayer(terrain, editor.get(), terrainCache) : undefined,
			});
			const box = msgRef.current;
			if (box) {
				box.hidden = !msg;
				box.textContent = msg;
			}
		};
		const redraw = () => {
			if (!queued) queued = requestAnimationFrame(draw);
		};
		const tiles = new TileCache((l, x, y) => editor.api.tile(l, x, y), redraw);

		const resize = () => {
			const r = canvas.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			canvas.width = Math.round(r.width * dpr);
			canvas.height = Math.round(r.height * dpr);
			editor.set({ size: { w: r.width, h: r.height } });
			redraw();
		};
		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		resize();
		const unsubscribe = editor.store.subscribe(redraw);
		const unsubscribeTerrain = terrain?.store.subscribe(redraw);
		const unlisten = onPicture(redraw);

		const cursor = (c: string | null) => {
			if (c) canvas.style.cursor = c;
		};
		// (while the terrain is worked on, its mouse first: what it does not take, the map's own has)
		const onTerrain = () => !!terrainMouse && editor.get().focus === "terrain" && editor.get().mode === "select";
		const onDown = (e: MouseEvent) => {
			canvas.focus();
			const p = pointer(e, canvas);
			if (onTerrain() && terrainMouse?.down(p)) return;
			interactions.down(p);
		};
		const onMove = (e: MouseEvent) => {
			const p = pointer(e, canvas);
			if (terrainMouse?.dragging) {
				const s = editor.get();
				editor.set({ mouse: toWorld(s.view, s.size, p.sx, p.sy) });
				cursor(terrainMouse.move(p));
				return;
			}
			if (e.target !== canvas && !interactions.dragging) return;
			const c = interactions.move(p);
			cursor((onTerrain() && !interactions.dragging ? terrainMouse?.move(p) : null) ?? c);
		};
		const onUp = () => {
			if (terrainMouse?.dragging) {
				terrainMouse.up();
				cursor(null);
			} else cursor(interactions.up());
		};
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const p = pointer(e, canvas);
			interactions.wheel(p.sx, p.sy, e.deltaY);
		};
		const onMenu = (e: Event) => e.preventDefault();
		const onDouble = (e: MouseEvent) => {
			if (onTerrain() && terrain?.get().draft) terrain.finishDraft();
			else if (editor.get().newRoad) editor.finishNewRoad();
			else interactions.double(pointer(e, canvas));
		};
		canvas.addEventListener("mousedown", onDown);
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		canvas.addEventListener("wheel", onWheel, { passive: false });
		canvas.addEventListener("contextmenu", onMenu);
		canvas.addEventListener("dblclick", onDouble);
		return () => {
			cancelAnimationFrame(queued);
			unsubscribe();
			unsubscribeTerrain?.();
			unlisten();
			observer.disconnect();
			canvas.removeEventListener("mousedown", onDown);
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			canvas.removeEventListener("wheel", onWheel);
			canvas.removeEventListener("contextmenu", onMenu);
			canvas.removeEventListener("dblclick", onDouble);
		};
	}, [editor, interactions, terrain, terrainMouse]);

	// (the cursor follows the mode)
	useEffect(
		() =>
			editor.store.subscribe((s, before) => {
				if (s.mode !== before.mode && canvasRef.current) canvasRef.current.style.cursor = s.mode === "select" ? "default" : "crosshair";
			}),
		[editor],
	);

	return (
		<>
			<canvas id="map" ref={canvasRef} tabIndex={0} aria-label="Map" />
			<output id="msg" ref={msgRef} hidden />
		</>
	);
}
