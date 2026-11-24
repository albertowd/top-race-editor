// BeamNG's shapes as Collada (the track's export_beamng.write_dae, beamng_races.boards_dae): meshes in BeamNG's axes, laid out as BeamNG's own shapes are:
// base00 with the detail levels, then start01 with the meshes, each named with the detail it belongs to as the number its name ends in.

/** A mesh as a shape takes it, in BeamNG's axes: its name, material, points (x y z), normals, uvs, triangles. */
export interface DaeMesh {
	name: string;
	material: string;
	P: ArrayLike<number>;
	N: ArrayLike<number>;
	U: ArrayLike<number>;
	F: ArrayLike<number>;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A number as Python's '%.<p>g' writes it, near enough for a reader: p significant digits, no trailing zeros. */
const g = (x: number, p: number) => {
	if (!Number.isFinite(x)) return "0";
	const s = Number(x.toPrecision(p));
	return Object.is(s, -0) ? "0" : String(s);
};

const floats = (a: ArrayLike<number>, p: number) => {
	const out = new Array<string>(a.length);
	for (let i = 0; i < a.length; i++) out[i] = g(a[i] as number, p);
	return out.join(" ");
};

const ints = (a: ArrayLike<number>) => {
	const out = new Array<string>(a.length);
	for (let i = 0; i < a.length; i++) out[i] = String(a[i]);
	return out.join(" ");
};

function geometry(id: string, m: DaeMesh): string {
	const nv = m.P.length / 3;
	return `<geometry id="${id}" name="${esc(m.name)}"><mesh>
<source id="${id}-p"><float_array id="${id}-pa" count="${m.P.length}">${floats(m.P, 5)}</float_array><technique_common><accessor source="#${id}-pa" count="${nv}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="${id}-n"><float_array id="${id}-na" count="${m.N.length}">${floats(m.N, 4)}</float_array><technique_common><accessor source="#${id}-na" count="${nv}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="${id}-t"><float_array id="${id}-ta" count="${m.U.length}">${floats(m.U, 6)}</float_array><technique_common><accessor source="#${id}-ta" count="${nv}" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>
<vertices id="${id}-v"><input semantic="POSITION" source="#${id}-p"/><input semantic="NORMAL" source="#${id}-n"/></vertices>
<triangles material="${esc(m.material)}" count="${m.F.length / 3}"><input semantic="VERTEX" source="#${id}-v" offset="0"/><input semantic="TEXCOORD" source="#${id}-t" offset="0" set="0"/><p>${ints(m.F)}</p></triangles>
</mesh></geometry>`;
}

const bind = (mat: string) =>
	`<bind_material><technique_common><instance_material symbol="${esc(mat)}" target="#${esc(mat)}"/></technique_common></bind_material>`;

function document(mats: Iterable<string>, geo: string[], scene: string): string {
	const ms = [...new Set(mats)];
	const effects = ms.map((m) => `<effect id="${esc(m)}-fx"><profile_COMMON><technique sid="common"><lambert/></technique></profile_COMMON></effect>`).join("");
	const materials = ms.map((m) => `<material id="${esc(m)}" name="${esc(m)}"><instance_effect url="#${esc(m)}-fx"/></material>`).join("");
	return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>
<library_effects>${effects}</library_effects>
<library_materials>${materials}</library_materials>
<library_geometries>${geo.join("")}</library_geometries>
<library_visual_scenes><visual_scene id="scene">${scene}</visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
}

/** A shape of meshes. All drawn at one detail, 2 (a name ending in a number does not make a detail of its own), or sizes gives each mesh's: the shape's size on
 * screen in pixels from which it is drawn. collide: each mesh also a Colmesh at detail -1 (what vehicles hit, with its material for the ground); collision:
 * meshes only hit, drawn at no detail (with no meshes, the shape is only hit: its one detail drawing nothing). */
export function writeDae(meshes: DaeMesh[], o: { collide?: boolean; sizes?: number[]; collision?: DaeMesh[] } = {}): string {
	const sizes = o.sizes ?? meshes.map(() => 2);
	const collision = o.collision ?? [];
	const collide = !!o.collide || collision.length > 0;
	const geo: string[] = [];
	const nodes: string[] = [];
	const all: [DaeMesh, number | null][] = [
		...meshes.map((m, i): [DaeMesh, number | null] => [m, sizes[i] ?? 2]),
		...collision.map((m): [DaeMesh, number | null] => [m, null]),
	];
	all.forEach(([m, size], k) => {
		const id = `g${k}`;
		geo.push(geometry(id, m));
		if (size !== null)
			nodes.push(
				`<node id="n${k}" name="${m.name.replace(/[^A-Za-z0-9_]/g, "_")}_${k}_L${size}"><instance_geometry url="#${id}">${bind(m.material)}</instance_geometry></node>`,
			);
		if (size === null || (collide && !collision.length))
			nodes.push(`<node id="c${k}" name="Colmesh_${k}-1"><instance_geometry url="#${id}">${bind(m.material)}</instance_geometry></node>`);
	});
	let details = [...new Set(sizes)]
		.sort((a, b) => b - a)
		.map((x) => `<node id="detail${x}" name="detail${x}"/>`)
		.join("");
	// (a shape only hit: a detail with nothing to draw, as BeamNG's own are)
	if (!meshes.length) details += '<node id="nulldetail1" name="nulldetail1"/>';
	if (collide) details += '<node id="collision-1" name="collision-1"/>';
	return document(
		all.map(([m]) => m.material),
		geo,
		`<node id="base00" name="base00">${details}<node id="start01" name="start01">${nodes.join("")}</node></node>`,
	);
}

/** The boards' meshes for a vehicle's flexbodies: each a node of its own name, in the vehicle's axes. */
export function boardsDae(meshes: { name: string; P: ArrayLike<number>; N: ArrayLike<number>; U: ArrayLike<number>; F: ArrayLike<number> }[]): string {
	const mat = "tsvp_marker_boards";
	const geo = meshes.map((m, k) => geometry(`g${k}`, { ...m, material: mat }));
	const nodes = meshes.map((m, k) => `<node id="${m.name}" name="${m.name}"><instance_geometry url="#g${k}">${bind(mat)}</instance_geometry></node>`);
	return document([mat], geo, nodes.join(""));
}
