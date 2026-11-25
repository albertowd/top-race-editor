// rFactor 2's text files of a track (its location), made from the track's data: the scene (SCN: where its meshes are looked for, its views, fog and lights,
// each mesh's instance), each layout's GDB (its names, length, place, sessions; its TDF), the location's TDF (each ground's grip, bumps and sound: the meshes'
// materials matched by the start of their names) and each layout's WET (its weather over a weekend). Their syntax as Studio 397's own tracks have them
// (ModDev/Locations/Joesville). Positions here are rFactor's already (rf2/axes.ts).

/** A ground's feedback in the TDF: the start of the names of the materials driven as it, and its line. */
export interface Ground {
	/** the start of its materials' names (no other ground's may start with it) */
	prefix: string;
	feedback: string;
	/** its tyres' marks and smoke (the TDF's Reaction lines) */
	reactions?: readonly string[];
}

const SMOKE =
	"Reaction=tiresmoke Tex=SMOKETire.tga Max=1024 Scale=(0.5,0.5,0.5) Growth=(2.5,2.0,2.0) ASDEnvelope=(0.1,0.7,3.8) Suspension=0.98 DestBlend=InvSrcAlpha SrcBlend=SrcAlpha";
const SKID = "Reaction=skid Tex=skidhard.tga Max=2500 Pixel=NoReduceDetail Particle=Plane+Deformable+SingleSided DestBlend=InvSrcAlpha SrcBlend=SrcAlpha";
const WET_SKID =
	"Reaction=wetskid Tex=skidwet.tga Max=1024 Duration=0.40 Pixel=NoReduceDetail Particle=Plane+Deformable+SingleSided DestBlend=One SrcBlend=SrcAlpha";
const SPRAY =
	"Reaction=spray Tex=rainspray.tga Max=1024 Scale=(1.3,0.02,0.02) Growth=(2.0,0.19,0.19) GrowthVel=(0.17,0.13,0.13) Power=0.41 RampSpeed=90 OffsetVel=0.10 ASDEnvelope=(0.01,3.0,2.0) DestBlend=InvSrcAlpha SrcBlend=SrcAlpha";
/** the effects every ground's feedback may call on (its sparks, smoke, flames, a wall's skid marks): the TDF's [LOOSE], as every sample's ends */
const LOOSE = [
	"Reaction=spark Tex=spark.tga Max=256 Duration=0.6 Scale=(.08,.05,.05) Particle=Plane+Deformable DestBlend=InvSrcAlpha SrcBlend=SrcAlpha Shader=AlphaChannel+NoShade",
	"Reaction=whitesmoke Tex=smokewhite.tga Max=256 Scale=(1.0,1.0,1.0) Growth=(2.5,2.0,2.0) ASDEnvelope=(1.0,1.2,3.3) DriftMult=0.15 Suspension=0.999 DestBlend=InvSrcAlpha SrcBlend=SrcAlpha",
	"Reaction=blacksmoke Tex=smokeblack.tga Max=1024 Scale=(1.5,1.5,1.5) Growth=(2.0,2.0,2.0) ASDEnvelope=(0.5,3.8,1.2) DriftMult=0.3 Suspension=0.99 DestBlend=Zero SrcBlend=SrcAlpha",
	"Reaction=flames Tex=fire.tga Max=256 Scale=(0.8,0.8,0.8) Growth=(6.3,1.75,1.0) ASDEnvelope=(0.08,0.17,0.05) DriftMult=0.75 Suspension=0.8 DestBlend=One SrcBlend=SrcAlpha Shader=AlphaChannel+NoShade",
	"Reaction=wallskid Tex=skidwall.tga Max=128 Scale=(3.25,1.10,1.0) Pixel=NoReduceDetail Particle=Plane+Deformable+SingleSided DestBlend=InvSrcAlpha SrcBlend=SrcAlpha",
];

/** The grounds the track's surfaces are driven as (surfaces.json's targets.rf2 names one; a surface without one, as its kind here), their values as rFactor's
 * own tracks have them for asphalt, a rumble strip, grass, a gravel trap and a concrete wall. */
export const GROUNDS: Readonly<Record<string, Ground>> = {
	road: {
		prefix: "road",
		feedback:
			"Wear=1.00 Dry=RoadDryGrip Wet=RoadWetGrip Roughness=(0.50,0.25) Resistance=0 BumpAmp=RoadBumpAmp BumpWavelen=RoadBumpLen Legal=true Spring=0 Damper=0 CollFrict=0.4 Sparks=1 Scraping=1 Sound=dry",
		reactions: [SMOKE, SKID, WET_SKID, SPRAY],
	},
	rumble: {
		prefix: "rmbl",
		feedback:
			"Wear=0.98 Dry=RumbleDryGrip Wet=RumbleWetGrip Roughness=(0.46,0.15) Resistance=0 BumpAmp=RumbleBumpAmp BumpWavelen=RumbleBumpLen Legal=true Spring=0 Damper=0 CollFrict=0.4 Sparks=0 Scraping=1 Sink=-0.001 Sound=rumble",
		reactions: [SMOKE, SKID, WET_SKID, SPRAY],
	},
	grass: {
		prefix: "gras",
		feedback:
			"Wear=0.6 Dry=0.5 Wet=0.3 Resistance=2000 BumpAmp=0.039 BumpWavelen=2.0 Legal=false Spring=300 Damper=300 CollFrict=2 Sparks=0 Scraping=0 Sink=0.032 Sound=grass",
	},
	sand: {
		prefix: "grvl",
		feedback:
			"Wear=0.80 Dry=0.7 Wet=0.5 Resistance=40000 BumpAmp=0.056 BumpWavelen=1.2 Legal=false Spring=400 Damper=200 CollFrict=5 Sparks=0 Scraping=0 Sink=0.048 Sound=gravel",
	},
	wall: {
		prefix: "wall",
		feedback: "Legal=false Spring=0 Damper=0 CollFrict=0.18 Sparks=0 Scraping=1 Sound=solidwall",
	},
};

/** The track's surfaces' grounds: surfaces.json's targets.rf2, else the surface's own name, else asphalt's. */
export function groundOf(surface: string, surfaces: Record<string, { targets?: { rf2?: string } }>): Ground {
	const name = surfaces[surface]?.targets?.rf2 ?? surface;
	return GROUNDS[name] ?? (GROUNDS.road as Ground);
}

/** a material's name in rFactor's files: its ground's prefix first where it is driven on (the TDF matches it so) */
export const materialName = (name: string, ground: Ground | null): string => {
	const prefix = ground ? `${ground.prefix}_` : "";
	return `${prefix}${name}`.replaceAll(/\W/g, "_");
};

const TRACKVARS = [
	"RoadDryGrip=1.00",
	"RoadWetGrip=0.85",
	"RoadBumpAmp=0.001",
	"RoadBumpLen=3.0",
	"RumbleDryGrip=0.96",
	"RumbleWetGrip=0.60",
	"RumbleBumpAmp=0.003",
	"RumbleBumpLen=2.0",
	"HATFilterMaxOffset=0.003",
];

/** The location's TDF: its track variables, then each ground's feedback (each once, in the order given), then the effects they call on ([LOOSE]). */
export function tdfText(grounds: readonly Ground[]): string {
	const out = ["// Grounds: each material driven on matched by the start of its name", "", "[TRACKVARS]", ...TRACKVARS];
	const seen = new Set<string>();
	for (const g of grounds) {
		if (seen.has(g.prefix)) continue;
		seen.add(g.prefix);
		out.push("", "[FEEDBACK]", g.feedback, ...(g.reactions ?? []), `Materials=${g.prefix}`);
	}
	out.push("", "[LOOSE]", ...LOOSE);
	return `${out.join("\r\n")}\r\n`;
}

/** A mesh's instance in the scene. */
export interface Instance {
	name: string;
	/** its GMT */
	mesh: string;
	/** driven on or hit (its faces' grounds the TDF's); a HAT target: the ground cars stand on */
	collide: boolean;
	hat: boolean;
	/** drawn (false: only hit, as the timing beams and the walls unseen) */
	render?: boolean;
	/** what it does when hit (the timing beams': VEHICLE,TIMING) */
	response?: string;
	/** casts shadows */
	shadows?: boolean;
	/** knocked about (a cone) */
	moveable?: boolean;
	/** RealRoad's: rubbered in, wetted, dried (every sample's scene has one at least: Joesville's race surface, LochDrummond's garage floor) */
	deformable?: boolean;
	/** drawn no further than (metres) */
	lodOut?: number;
}

export interface Light {
	name: string;
	pos: [number, number, number];
	range: number;
	intensity: number;
	colour: [number, number, number];
}

export interface Scene {
	/** the folders its files are looked for in, from the game's Locations */
	searchPaths: readonly string[];
	masFiles?: readonly string[];
	/** the sun's way (rFactor's axes) */
	sun?: [number, number, number];
	lights?: readonly Light[];
	instances: readonly Instance[];
	/** where its fixed reflections are seen from (STATIC01's cube, the global irradiance probe): its start, a little over the road (rFactor's axes) */
	centre?: [number, number, number];
}

const f3 = (v: readonly number[], d = 3) => v.map((x) => x.toFixed(d)).join(", ");

/** An instance's lines in the scene, the blank line before it first. */
function instanceLines(i: Instance): string[] {
	const flags = [
		`MeshFile=${i.mesh}`,
		...(i.deformable ? ["Deformable=True"] : []),
		`CollTarget=${i.collide ? "True" : "False"}`,
		`HATTarget=${i.hat ? "True" : "False"}`,
		...(i.shadows ? ["ShadowCaster=(Static, Solid)"] : []),
		...(i.lodOut ? [`LODOut=(${i.lodOut.toFixed(1)})`] : []),
	];
	const L = ["", `Instance=${i.name}`, "{"];
	if (i.render === false) L.push("  Render=False");
	if (i.moveable) L.push("  Moveable=True");
	L.push(`  ${flags.join(" ")}`);
	if (i.response) L.push(`  Response=${i.response}`);
	L.push("}");
	return L;
}

/** The layout's scene (SCN). */
export function scnText(s: Scene): string {
	// (its first line as every one of Studio 397's tracks has it)
	const L: string[] = ["CUBEASF", ""];
	for (const p of s.searchPaths) L.push(`SearchPath=${p}`);
	L.push("");
	for (const m of s.masFiles ?? ["COMMONMAPS.MAS"]) L.push(`MASFile=${m}`);
	L.push(
		"",
		"View=mainview",
		"{",
		"  Clear=False",
		"  Color=(0, 0, 0)",
		"  Size=(1.00, 1.00) Center=(0.5, 0.5)",
		"  FOV=(77.75, 31.25)",
		"  ClipPlanes=(0.50, 1500.00)",
		"  View=rearview",
		"  {",
		"    Clear=False",
		"    Color=(0, 0, 0)",
		"    Size=(0.200, 0.100) Center=(0.50, 0.01)",
		"    FOV=(62.5, 62.5)",
		"    ClipPlanes=(0.50, 150.00)",
		"  }",
		"}",
		"",
		"GroupMethod=Dynamic",
		"MaxShadowRange=(450.00)",
		"AmbientColor=(126, 126, 126)",
		"FogMode=LINEAR FogIn=(50.00) FogOut=(5000.00) FogDensity=(0.00015) FogColor=(205, 215, 235)",
		"",
		"Light=Direct00",
		"{",
		` Type=Directional Color=(220, 220, 220) Dir=(${f3(s.sun ?? [0.5, -0.9, 0.5], 1)})`,
		"}",
	);
	for (const l of s.lights ?? [])
		L.push(
			`Light=${l.name}`,
			"{",
			` Type=Omni Pos=(${f3(l.pos, 6)}) Range=(0.000000, ${l.range.toFixed(6)}) Active=True Intensity=(${l.intensity.toFixed(6)}) Color=(${l.colour.map((c) => Math.round(c)).join(", ")})`,
			"}",
		);
	for (const i of s.instances) L.push(...instanceLines(i));
	// (the reflections the game needs at least, as LochDrummond has them: STATIC01, a cube still at the track's centre, and REFMAP0, one following the car;
	// without them it warns that its background mappers are not defined)
	const c = f3(s.centre ?? [0, 2, 0], 2);
	L.push(
		"",
		"ReflectionMapper=STATIC01",
		"{",
		"  Type=Cubic",
		"  TextureSize=(512)",
		"  UpdateRate=(0.100)",
		"  StaticSwitch=(300.000)",
		`  Pos=(${c})`,
		"}",
		"",
		"ReflectionMapper=REFMAP0",
		"{",
		"  Type=Cubic",
		"  TextureSize=(1024)",
		"  UpdateRate=(100.000)",
		"  StaticSwitch=(300.000)",
		"  TrackingIns=True",
		"}",
		"",
		"IRRADIANCE_PROBE=IRRAD_GLOBAL",
		"{",
		"  INFLUENCE_RANGE = (0.0)",
		`  PROBE_POSITION = (${c})`,
		"}",
	);
	return `${L.join("\r\n")}\r\n`;
}

/** A layout's GDB: its names, its length, where the track is (its sun), its TDF. */
export interface Layout {
	/** the GDB's name (its file's, and its block's) */
	id: string;
	trackName: string;
	eventName: string;
	venueName: string;
	/** metres a lap */
	length: number;
	/** its TDF, from the layout's folder */
	tdf: string;
	location?: string;
	latitude?: number;
	longitude?: number;
	altitude?: number;
	timezone?: number;
	maxVehicles?: number;
	pitKph?: number;
	/** the venue's icon, from rFactor's Locations (<venue>\<venue>Icon.dds) */
	venueIcon?: string;
	/** the steps its start lights count (its gantry's lamps and all out); none: 5 */
	startingLights?: number;
}

/** cars a race takes where a layout does not say */
export const MAX_VEHICLES = 20;

export function gdbText(l: Layout): string {
	const km = l.length / 1000;
	const L = [
		l.id,
		"{",
		// (the series it is open to: every one, karts named as LochDrummond names them)
		"  Filter Properties = * Kart",
		`  TrackName = ${l.trackName}`,
		`  EventName = ${l.eventName}`,
		`  VenueName = ${l.venueName}`,
		...(l.venueIcon ? [`  VenueIcon = ${l.venueIcon}`] : []),
		...(l.location ? [`  Location = ${l.location}`] : []),
		`  Length = ${km.toFixed(3)} KM / ${(km / 1.609344).toFixed(2)} Miles`,
		"  TrackType = Road Course",
		`  TerrainDataFile=${l.tdf}`,
		"  HeadlightsRequired = false",
		`  Max Vehicles = ${l.maxVehicles ?? MAX_VEHICLES}`,
		"  PitlaneBoundary = 1",
		"  GarageDepth = 2.0",
		`  RacePitKPH = ${(l.pitKph ?? 30).toFixed(1)}`,
		`  NormalPitKPH = ${(l.pitKph ?? 30).toFixed(1)}`,
		`  NumStartingLights = ${l.startingLights ?? 5}`,
		...(l.latitude !== undefined ? [`  Latitude = ${l.latitude.toFixed(4)}`] : []),
		...(l.longitude !== undefined ? [`  Longitude = ${l.longitude.toFixed(4)}`] : []),
		...(l.altitude !== undefined ? [`  Altitude = ${l.altitude.toFixed(1)}`] : []),
		...(l.timezone !== undefined ? [`  TimezoneRelativeGMT = ${l.timezone.toFixed(1)}`] : []),
		`  SettingsFolder = ${l.trackName}`,
		"}",
	];
	return `${L.join("\r\n")}\r\n`;
}

/** A session's weather: from StartTime (minutes into the day) for Duration minutes, its sky (0 clear .. 4 overcast). */
const SESSION = (start: number) => [
	`StartTime=(${start})`,
	"Duration=(30)",
	"Sky=(1)",
	"RainChange=(0)",
	"RainDensity=(0)",
	"Temperature=(24)",
	"Humidity=(60)",
	"WindSpeed=(3)",
	"WindDirection=(0)",
];

/** A layout's WET: the road as the game makes it (natural) and a fair day for every session. */
export function wetText(): string {
	const sessions = ["Practice", "Qualifying", "Race"];
	// (its first line and its sessions' times as the samples': from 9:00, half an hour each, to 11:30)
	const L = ["//[[gMa1.002f (c)2016    ]] [[            ]]", "[Weather Info]", "abstractnodes=1"];
	for (const s of ["TD", "P1", "P2", "P3", "P4", "Q1", "Q2", "Q3", "Q4", "WU", "R1", "R2", "R3", "R4"]) L.push(`RealRoad${s}="natural"`);
	for (const s of sessions) L.push("", `[${s} Info]`, ...[540, 570, 600, 630, 660].flatMap(SESSION));
	return `${L.join("\r\n")}\r\n`;
}
