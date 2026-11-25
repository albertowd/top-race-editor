import { type SubmitEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import type { Estimate, JobInfo, Place, Plan, ProviderInfo, WizardApi, WizardInfo } from "./api";
import { metresAPixel, zoomToShow } from "./geo";
import { type MapView, PlaceMap } from "./PlaceMap";

/** A text without the dashes it starts and ends with. */
function trimDashes(s: string): string {
	let a = 0;
	let b = s.length;
	while (a < b && s[a] === "-") a++;
	while (b > a && s[b - 1] === "-") b--;
	return s.slice(a, b);
}

/** The folder a track's name makes (as the engine's wizard.slug). */
export const slug = (name: string): string => trimDashes(name.toLowerCase().replace(/[^a-z0-9]+/g, "-")) || "new-track";

const STEP_LABELS: Record<string, string> = {
	place: "Place",
	picture: "Picture",
	heights: "Heights",
	buildings: "Buildings",
	terrain: "Terrain",
	track: "Track file",
};

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

/** Metres across a place found (the wider of its box's two ways), or the width given where it has no box. */
const metresAcross = (p: Place, width: number): number =>
	p.box
		? Math.max(((p.box[1] - p.box[0]) * Math.PI * 6378137) / 180, ((p.box[3] - p.box[2]) * Math.PI * 6378137 * Math.cos((p.lat * Math.PI) / 180)) / 180)
		: width;

type Draft = Omit<Plan, "lat" | "lon"> & { lat: number | null; lon: number | null };

const START: Draft = {
	name: "",
	folder: "",
	lat: null,
	lon: null,
	width: 1500,
	depth: 1500,
	image: "esri",
	mpp: 1,
	heights: "terrarium",
	step: 10,
	buildings: true,
	span: 1000,
};

interface WizardProps {
	api: WizardApi;
	/** milliseconds between asking how the making goes */
	pollMs?: number;
	/** milliseconds a change waits before its estimate is asked for */
	settleMs?: number;
}

/** The new-track wizard: a place picked on the map (or found by its name), the area round it, where its picture and its heights come from (the keys they need
 * kept on the engine's computer), its name; then made, the track's own tools making its terrain, and the command that opens it in the editor. */
export function Wizard({ api, pollMs = 800, settleMs = 400 }: Readonly<WizardProps>) {
	const [info, setInfo] = useState<WizardInfo | null>(null);
	const [failed, setFailed] = useState("");
	const [plan, setPlan] = useState<Draft>(START);
	const [view, setView] = useState<MapView>({ lat: 0, lon: 0, zoom: 2 });
	const [estimate, setEstimate] = useState<Estimate | null>(null);
	const [planError, setPlanError] = useState("");
	const [job, setJob] = useState<JobInfo | null>(null);

	useEffect(() => {
		api.info().then(setInfo, (e: unknown) => setFailed(message(e)));
	}, [api]);

	const set = (patch: Partial<Draft>) => setPlan((p) => ({ ...p, ...patch }));
	const ready = plan.lat !== null && plan.lon !== null && plan.name.trim() !== "";
	const full: Plan | null = plan.lat !== null && plan.lon !== null ? { ...plan, lat: plan.lat, lon: plan.lon, name: plan.name || "x" } : null;
	const key = JSON.stringify(full);

	// (the estimate, once the plan settles)
	useEffect(() => {
		const asked = JSON.parse(key) as Plan | null;
		if (!asked) {
			setEstimate(null);
			return;
		}
		const t = setTimeout(() => {
			api.estimate(asked).then(
				(e) => {
					setEstimate(e);
					setPlanError("");
				},
				(e: unknown) => {
					setEstimate(null);
					setPlanError(message(e));
				},
			);
		}, settleMs);
		return () => clearTimeout(t);
	}, [key, api, settleMs]);

	// (the making, asked after while it runs)
	const running = job?.state === "running";
	useEffect(() => {
		if (job?.state !== "running") return;
		const t = setTimeout(() => {
			api.job(job.id).then(setJob, (e: unknown) => setFailed(message(e)));
		}, pollMs);
		return () => clearTimeout(t);
	}, [job, api, pollMs]);

	const image = info?.image.find((p) => p.id === plan.image);
	// (the map shows the picture's provider when it can, else Esri's)
	const mapProvider = image?.ready ? image : info?.image.find((p) => p.id === "esri");

	const make = async () => {
		if (!full || !ready) return;
		setFailed("");
		try {
			setJob(await api.start({ ...full, name: plan.name.trim(), folder: plan.folder?.trim() || undefined }));
		} catch (e) {
			setFailed(message(e));
		}
	};

	if (!info)
		return (
			<div className="wizard">
				<WizardBar />
				{asking(failed)}
			</div>
		);

	return (
		<div className="wizard">
			<WizardBar />
			<main className="wizard-main">
				<div className="wizard-form">
					<Section n={1} title="Place">
						<Search
							api={api}
							onPick={(p) => {
								set({ lat: p.lat, lon: p.lon, name: plan.name || p.name.split(",")[0] });
								const across = metresAcross(p, plan.width);
								setView({ lat: p.lat, lon: p.lon, zoom: zoomToShow(p.lat, Math.max(across, plan.width) * 1.3, 700) });
							}}
						/>
						<p className="hint">Or click the map to put the track's origin (its 0, 0) there.</p>
						<div className="row">
							<span>Origin</span>
							<Num label="Latitude" value={plan.lat} step={0.000001} onChange={(lat) => set({ lat })} />
							<Num label="Longitude" value={plan.lon} step={0.000001} onChange={(lon) => set({ lon })} />
						</div>
						<div className="row">
							<span>Area</span>
							<Num label="Width, metres (x)" value={plan.width} step={50} onChange={(width) => width && set({ width })} />
							<span>×</span>
							<Num label="Depth, metres (z)" value={plan.depth} step={50} onChange={(depth) => depth && set({ depth })} />
							<span>m</span>
						</div>
					</Section>

					<Section n={2} title="Picture">
						<Providers label="Where the picture comes from" list={info.image} value={plan.image} onChange={(image) => set({ image })} />
						<div className="row">
							<span>Detail</span>
							<Num label="Metres a pixel" value={plan.mpp} step={0.25} onChange={(mpp) => mpp && set({ mpp })} />
							<span>m a pixel</span>
						</div>
					</Section>

					<Section n={3} title="Heights">
						<Providers label="Where the heights come from" list={info.heights} value={plan.heights} onChange={(heights) => set({ heights })} />
						<div className="row">
							<span>Apart</span>
							<Num label="Metres between heights" value={plan.step} step={1} onChange={(step) => step && set({ step })} />
							<span>m</span>
						</div>
						<label className="check">
							<input type="checkbox" checked={plan.buildings} onChange={(e) => set({ buildings: e.target.checked })} />
							{"Buildings from OpenStreetMap (their roofs are not the ground)"}
						</label>
					</Section>

					<Section n={4} title="Keys">
						<Keys info={info} api={api} onInfo={setInfo} />
					</Section>

					<Section n={5} title="Track">
						<div className="row">
							<span>Name</span>
							<input aria-label="The track's name" value={plan.name} placeholder="New Track" onChange={(e) => set({ name: e.target.value })} />
						</div>
						<div className="row">
							<span>Folder</span>
							<input aria-label="Its folder" value={plan.folder} placeholder={slug(plan.name)} onChange={(e) => set({ folder: e.target.value })} />
						</div>
						<p className="hint">
							In {info.root}, unless a whole path. Its tools: {info.tools}.
						</p>
						<div className="row">
							<span>Map picture</span>
							<Num label="The editor's map picture, metres" value={plan.span} step={50} onChange={(span) => span && set({ span })} />
							<span>m square (dashed)</span>
						</div>
					</Section>

					<Section n={6} title="Make">
						<EstimateLines estimate={estimate} error={planError} lat={plan.lat} />
						<div className="actions">
							<button type="button" className="primary" disabled={!ready || running || !estimate || estimate.exists} onClick={make}>
								Make the Track
							</button>
							{running && job ? (
								<button type="button" onClick={() => api.cancel(job.id).then(setJob)}>
									Stop
								</button>
							) : null}
						</div>
						{!ready ? <p className="hint">It needs a place and a name.</p> : null}
						{failed ? (
							<p className="wizard-failed" role="alert">
								{failed}
							</p>
						) : null}
						{job ? <Progress job={job} /> : null}
					</Section>
				</div>
				<div className="wizard-map">
					{mapProvider ? (
						<WizardMap
							api={api}
							provider={mapProvider}
							plan={plan}
							view={view}
							onView={setView}
							onOrigin={(lat, lon) => set({ lat: round6(lat), lon: round6(lon) })}
						/>
					) : null}
				</div>
			</main>
		</div>
	);
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

interface WizardMapProps {
	api: WizardApi;
	/** whose tiles the map shows */
	provider: ProviderInfo;
	plan: Draft;
	view: MapView;
	onView: (v: MapView) => void;
	onOrigin: (lat: number, lon: number) => void;
}

/** The map the origin is put on: the area round it and the editor's map picture's square drawn once there is one, the view where there is not. */
function WizardMap({ api, provider, plan, view, onView, onOrigin }: Readonly<WizardMapProps>) {
	return (
		<PlaceMap
			view={view}
			onView={onView}
			origin={{ lat: plan.lat ?? view.lat, lon: plan.lon ?? view.lon }}
			width={plan.lat === null ? 0 : plan.width}
			depth={plan.lat === null ? 0 : plan.depth}
			span={plan.lat === null ? 0 : plan.span}
			onOrigin={onOrigin}
			tileUrl={(z, x, y) => api.tileUrl(provider.id, z, x, y)}
			tileSrc={(url) => api.tileSrc(url)}
			attribution={provider.attribution}
			top={provider.top}
		/>
	);
}

/** What the wizard says while the engine is asked what it offers: that it waits, or why it failed. */
function asking(failed: string) {
	return (
		<p className={failed ? "wizard-failed" : "empty-state"} role={failed ? "alert" : "status"}>
			{failed ? `The engine's wizard is not there: ${failed}` : "Asking the engine…"}
		</p>
	);
}

function WizardBar() {
	return (
		<header className="wizard-bar">
			<a className="back" href="./">
				‹ Editor
			</a>
			<h1>New Track</h1>
		</header>
	);
}

function Section({ n, title, children }: Readonly<{ n: number; title: string; children: React.ReactNode }>) {
	return (
		<section className="wizard-step" aria-labelledby={`step-${n}`}>
			<h2 id={`step-${n}`}>
				<span className="step-number" aria-hidden="true">
					{n}
				</span>
				{title}
			</h2>
			{children}
		</section>
	);
}

function Num({ label, value, step, onChange }: Readonly<{ label: string; value: number | null; step: number; onChange: (v: number | null) => void }>) {
	// (what is typed shown as it is while typing, the value given each time it is a number; the value again after)
	const [text, setText] = useState<string | null>(null);
	return (
		<input
			type="number"
			aria-label={label}
			step={step}
			value={text ?? value ?? ""}
			onChange={(e) => {
				setText(e.target.value);
				const v = e.target.value === "" ? null : Number(e.target.value);
				if (v === null || Number.isFinite(v)) onChange(v);
			}}
			onBlur={() => setText(null)}
		/>
	);
}

function Search({ api, onPick }: Readonly<{ api: WizardApi; onPick: (p: Place) => void }>) {
	const [text, setText] = useState("");
	const [found, setFound] = useState<Place[] | null>(null);
	const [error, setError] = useState("");
	const go = async (e: SubmitEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError("");
		try {
			setFound(await api.search(text));
		} catch (err) {
			setError(message(err));
		}
	};
	return (
		<>
			<form className="row find" aria-label="Search by name" onSubmit={go}>
				<input type="search" aria-label="Find a place" placeholder="Find a place (OpenStreetMap)" value={text} onChange={(e) => setText(e.target.value)} />
				<button type="submit" disabled={!text.trim()}>
					Find
				</button>
			</form>
			{error ? <p className="wizard-failed">{error}</p> : null}
			{found ? <PlacesFound found={found} onPick={onPick} onPicked={() => setFound(null)} /> : null}
		</>
	);
}

/** The places a search found, each picked by a click; or that none was. */
function PlacesFound({ found, onPick, onPicked }: Readonly<{ found: Place[]; onPick: (p: Place) => void; onPicked: () => void }>) {
	if (!found.length) return <p className="hint">Nothing found by that name.</p>;
	return (
		<ul className="list places" aria-label="Places found">
			{found.map((p) => (
				<li key={`${p.lat},${p.lon},${p.name}`}>
					<button
						type="button"
						className="row-button"
						onClick={() => {
							onPick(p);
							onPicked();
						}}
					>
						<span className="row-title">{p.name}</span>
					</button>
				</li>
			))}
		</ul>
	);
}

function Providers({ label, list, value, onChange }: Readonly<{ label: string; list: ProviderInfo[]; value: string; onChange: (id: string) => void }>) {
	return (
		<fieldset className="providers">
			<legend className="sr-only">{label}</legend>
			{list.map((p) => (
				<label // NOSONAR: its text is in its spans, the provider's name and about
					key={p.id}
					className={p.id === value ? "provider on" : "provider"}
				>
					<input type="radio" name={label} checked={p.id === value} onChange={() => onChange(p.id)} />
					<span className="provider-text">
						<span className="provider-name">
							{p.label}
							{p.key ? <span className={p.ready ? "badge" : "badge needs"}>{p.ready ? "key set" : "needs a key"}</span> : null}
						</span>
						<span className="hint">{p.about}</span>
					</span>
				</label>
			))}
		</fieldset>
	);
}

function Keys({ info, api, onInfo }: Readonly<{ info: WizardInfo; api: WizardApi; onInfo: (i: WizardInfo) => void }>) {
	const [typed, setTyped] = useState<Record<string, string>>({});
	const [error, setError] = useState("");
	const save = async (name: string, value: string) => {
		setError("");
		try {
			onInfo(await api.setKey(name, value));
			setTyped((t) => ({ ...t, [name]: "" }));
		} catch (e) {
			setError(message(e));
		}
	};
	return (
		<>
			{Object.entries(info.keys).map(([name, k]) => (
				<div className="row" key={name}>
					<span>{k.label}</span>
					<input
						type="password"
						autoComplete="off"
						aria-label={k.label}
						placeholder={k.set ? "set (type to change)" : "not set"}
						value={typed[name] ?? ""}
						onChange={(e) => setTyped((t) => ({ ...t, [name]: e.target.value }))}
					/>
					<button type="button" disabled={!typed[name]?.trim()} onClick={() => save(name, typed[name] ?? "")}>
						Keep
					</button>
					{k.set ? (
						<button type="button" aria-label={`Forget the ${k.label}`} onClick={() => save(name, "")}>
							Forget
						</button>
					) : null}
				</div>
			))}
			<p className="hint">Kept on this computer ({info.keys_file}); the page never gets them back.</p>
			{error ? <p className="wizard-failed">{error}</p> : null}
		</>
	);
}

function EstimateLines({ estimate, error, lat }: Readonly<{ estimate: Estimate | null; error: string; lat: number | null }>) {
	if (error)
		return (
			<p className="wizard-failed" role="alert">
				{error}
			</p>
		);
	if (!estimate) return null;
	const { image, heights } = estimate;
	return (
		<ul className="estimate" aria-label="What it asks for">
			<li>
				A picture {image.size[0]} × {image.size[1]} px, from {image.requests} tiles at zoom {image.zoom} (theirs{" "}
				{lat === null ? image.metres_a_pixel : Math.round(metresAPixel(lat, image.zoom) * 100) / 100} m a pixel)
			</li>
			<li>
				{heights.points.toLocaleString("en")} heights, in {heights.requests} requests
				{heights.apart_m ? ` (the provider's some ${heights.apart_m} m apart)` : ""}
			</li>
			<li className={estimate.exists ? "wizard-failed" : undefined}>
				Into {estimate.folder}
				{estimate.exists ? ": it is there already, not empty" : ""}
			</li>
		</ul>
	);
}

function Progress({ job }: Readonly<{ job: JobInfo }>) {
	const at = job.steps.indexOf(job.step);
	const log = useRef<HTMLPreElement>(null);
	const lines = useMemo(() => job.log.join("\n"), [job.log]);
	// (the log kept at its end as it grows)
	useEffect(() => {
		const el = log.current;
		if (el) el.scrollTop = el.scrollHeight;
	});
	return (
		<div className="progress" aria-live="polite">
			<ol className="steps">
				{job.steps.map((s, i) => {
					let state = "to-do";
					if (i < at || job.state === "done") state = "done";
					else if (i === at) state = job.state === "running" ? "now" : job.state;
					return (
						<li key={s} className={state}>
							{STEP_LABELS[s] ?? s}
							{i === at && job.state === "running" && job.total ? (
								<progress max={job.total} value={job.done} aria-label={`${STEP_LABELS[s] ?? s}: ${job.done} of ${job.total}`} />
							) : null}
						</li>
					);
				})}
			</ol>
			{job.state === "done" ? (
				<div className="made">
					<p>
						Made in {job.folder} ({job.seconds} s). Open it in the editor with:
					</p>
					<code>{job.open}</code>
					<button type="button" className="small" onClick={() => navigator.clipboard?.writeText(job.open)}>
						Copy
					</button>
				</div>
			) : null}
			{job.state === "failed" || job.state === "stopped" ? (
				<p className="wizard-failed" role="alert">
					{job.state === "stopped" ? "Stopped." : `It failed: ${job.error}`}
				</p>
			) : null}
			<pre ref={log} className="log">
				{lines}
			</pre>
		</div>
	);
}
