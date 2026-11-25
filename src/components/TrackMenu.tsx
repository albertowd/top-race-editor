import { type SubmitEvent, useEffect, useRef, useState } from "react";
import type { TrackEntry, TracksResponse } from "../api/types";
import { useEditor } from "../store/EditorContext";

/** The track's name, as the window's title; it opens the tracks the editor can open instead: those found next to this one and opened before, a folder of one's
 * own, or a new track made (the wizard). */
export function TrackMenu({ name }: Readonly<{ name: string }>) {
	const ed = useEditor();
	const [open, setOpen] = useState(false);
	const [list, setList] = useState<TracksResponse | null>(null);
	const [error, setError] = useState("");
	const [folder, setFolder] = useState("");
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		setError("");
		ed.listTracks().then(setList, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
		const away = (e: MouseEvent) => {
			if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
		};
		const esc = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", away);
		document.addEventListener("keydown", esc);
		return () => {
			document.removeEventListener("mousedown", away);
			document.removeEventListener("keydown", esc);
		};
	}, [open, ed]);
	const go = (t: TrackEntry) => {
		setOpen(false);
		void ed.openTrack(t);
	};
	const byFolder = (e: SubmitEvent) => {
		e.preventDefault();
		const f = folder.trim().replace(/^"|"$/g, "");
		if (!f) return;
		go({ name: f.split(/[\\/]/).findLast(Boolean) ?? f, folder: f });
	};
	return (
		<div className="menu track-menu" ref={box}>
			<h1>
				<button type="button" className="track-button" aria-expanded={open} aria-controls="trackmenu" title="Open another track" onClick={() => setOpen(!open)}>
					{name}
				</button>
			</h1>
			{open ? (
				<section id="trackmenu" className="popover tracks" aria-label="Tracks">
					<h2>Open a Track</h2>
					{error ? <p className="wizard-failed">{error}</p> : null}
					{!list && !error ? <p className="hint">Looking for tracks…</p> : null}
					{list ? (
						<ul className="list" aria-label="Tracks found">
							{list.tracks.map((t) => (
								<li key={t.folder} className={t.open ? "sel" : undefined}>
									<button type="button" className="row-button" disabled={t.open} aria-current={t.open} title={t.folder} onClick={() => go(t)}>
										<span className="row-title">{t.name}</span>
										<span className="row-detail">{t.open ? "open now" : t.folder}</span>
									</button>
								</li>
							))}
						</ul>
					) : null}
					<form className="row" aria-label="Open a folder" onSubmit={byFolder}>
						<input aria-label="A track's folder" placeholder="A track's folder (its whole path)" value={folder} onChange={(e) => setFolder(e.target.value)} />
						<button type="submit" disabled={!folder.trim()}>
							Open
						</button>
					</form>
					<a className="new-track" href="wizard.html">
						New Track…
					</a>
				</section>
			) : null}
		</div>
	);
}
