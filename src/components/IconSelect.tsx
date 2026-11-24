import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

export interface IconOption<T extends string> {
	value: T;
	label: string;
	/** its picture's address */
	icon: string;
	/** a word more, quieter (a size...) */
	hint?: string;
}

interface IconSelectProps<T extends string> {
	value: T;
	options: readonly IconOption<T>[];
	onChange: (v: T) => void;
	/** what is chosen, for those who cannot see the pictures */
	label: string;
}

/** A drop-down whose choices are shown by their picture and their name (a model, a kind): a button showing the one chosen, opening the choices under it, each a
 * button (Tab or the arrows move between them, Escape closes, a click away too). */
export function IconSelect<T extends string>({ value, options, onChange, label }: Readonly<IconSelectProps<T>>) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const list = useRef<HTMLFieldSetElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	const chosen = Math.max(
		0,
		options.findIndex((o) => o.value === value),
	);
	useEffect(() => {
		if (!open) return;
		list.current?.querySelectorAll("button")[chosen]?.focus();
		const away = (e: MouseEvent) => {
			if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", away);
		return () => document.removeEventListener("mousedown", away);
	}, [open, chosen]);
	const current = options[chosen];
	if (!current) return null;
	const close = () => {
		setOpen(false);
		button.current?.focus();
	};
	const choose = (v: T) => {
		onChange(v);
		close();
	};
	const keys = (e: KeyboardEvent<HTMLFieldSetElement>) => {
		const buttons = [...(list.current?.querySelectorAll("button") ?? [])];
		const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
		let to = -1;
		switch (e.key) {
			case "Escape":
				e.preventDefault();
				e.stopPropagation();
				close();
				return;
			case "ArrowDown":
				to = Math.min(at + 1, buttons.length - 1);
				break;
			case "ArrowUp":
				to = Math.max(at - 1, 0);
				break;
			case "Home":
				to = 0;
				break;
			case "End":
				to = buttons.length - 1;
				break;
			default:
				return;
		}
		e.preventDefault();
		e.stopPropagation();
		buttons[to]?.focus();
	};
	return (
		<div className="iconselect" ref={box}>
			<button
				type="button"
				ref={button}
				className="iconselect-button"
				aria-expanded={open}
				aria-controls={open ? id : undefined}
				aria-label={`${label}: ${current.label}`}
				title={current.hint ? `${current.label} (${current.hint})` : current.label}
				onClick={() => setOpen(!open)}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown") {
						e.preventDefault();
						setOpen(true);
					}
				}}
			>
				<img src={current.icon} alt="" width={24} height={24} />
				<span className="iconselect-label">{current.label}</span>
			</button>
			{open ? (
				<fieldset id={id} ref={list} className="iconselect-list" onKeyDown={keys}>
					<legend className="sr-only">{label}</legend>
					{options.map((o) => (
						<button key={o.value} type="button" aria-pressed={o.value === value} className="iconselect-option" onClick={() => choose(o.value)}>
							<img src={o.icon} alt="" width={40} height={40} />
							<span>
								{o.label}
								{o.hint ? <span className="dim"> {o.hint}</span> : null}
							</span>
						</button>
					))}
				</fieldset>
			) : null}
		</div>
	);
}
