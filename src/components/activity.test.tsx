import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { EditorProvider } from "../store/EditorContext";
import { createEditor } from "../store/editor";
import { fakeDialogs, fakeEngine } from "../test/fixtures";
import { Activity, SHOW_AFTER } from "./Activity";

/** A promise and what lets it go. */
function gate() {
	let open = () => {};
	const p = new Promise<void>((r) => {
		open = r;
	});
	return { p, open };
}

describe("loading the track", () => {
	it("shows its roads before the models seen from above are in; those read after, a note at the top", async () => {
		const fe = fakeEngine();
		const models = gate();
		fe.hold["/api/context"] = models.p;
		const ed = createEditor(fe.client, { dialogs: fakeDialogs(), meshDelay: 0 });
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			render(<App editor={ed} />);
			// (the window waits for the roads: the loading screen)
			expect(screen.getByText("Opening the track")).toBeInTheDocument();
			await waitFor(() => expect(ed.get().roads).toHaveLength(3));
			expect(ed.get().booting).toBe(false);
			expect(ed.get().context).toEqual([]);
			expect(screen.queryByText("Opening the track")).toBeNull();
			// (the models still read: after a moment, said at the top)
			await act(async () => {
				vi.advanceTimersByTime(SHOW_AFTER + 300);
			});
			expect(screen.getByText(/Reading the track's models…/)).toBeInTheDocument();
			models.open();
			await waitFor(() => expect(ed.get().context).toHaveLength(1));
			expect(screen.queryByText(/Reading the track's models…/)).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("waits with a loading screen while saving, not for a quick one", async () => {
		const fe = fakeEngine();
		const ed = createEditor(fe.client, { dialogs: fakeDialogs(), meshDelay: 0 });
		await ed.load();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			render(
				<EditorProvider editor={ed}>
					<Activity />
				</EditorProvider>,
			);
			const slow = gate();
			fe.hold["/api/save"] = slow.p;
			let saved: Promise<void> = Promise.resolve();
			act(() => {
				saved = ed.save();
			});
			expect(screen.queryByRole("status")).toBeNull();
			await act(async () => {
				vi.advanceTimersByTime(SHOW_AFTER + 300);
			});
			expect(screen.getByRole("status")).toHaveTextContent("Saving…");
			slow.open();
			await act(async () => {
				await saved;
			});
			expect(screen.queryByRole("status")).toBeNull();
			expect(ed.get().tasks).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("another track", () => {
	it("is chosen in the track menu: opened by the engine, the page loaded again on it", async () => {
		const fe = fakeEngine();
		const reload = vi.fn();
		const ed = createEditor(fe.client, { dialogs: fakeDialogs(), meshDelay: 0, reload, pollMs: 5 });
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
		render(<App editor={ed} />);
		await waitFor(() => expect(ed.get().roads).toHaveLength(3));
		await userEvent.click(screen.getByRole("button", { name: "Test" }));
		const menu = screen.getByRole("region", { name: "Tracks" });
		const found = await within(menu).findByRole("list", { name: "Tracks found" });
		expect(within(found).getByRole("button", { name: /Test/ })).toBeDisabled();
		await userEvent.click(within(found).getByRole("button", { name: /Other Park/ }));
		expect(fe.calls.filter((c) => c.path === "/api/open").at(-1)?.body).toEqual({ folder: "D:/tracks/other" });
		expect(await screen.findByText("Opening Other Park")).toBeInTheDocument();
		await waitFor(() => expect(reload).toHaveBeenCalledOnce());
	});

	it("is opened by its folder; not without asking over changes not saved; a refusal said", async () => {
		const fe = fakeEngine();
		const dialogs = fakeDialogs({ confirm: false });
		const reload = vi.fn();
		const ed = createEditor(fe.client, { dialogs, meshDelay: 0, reload, pollMs: 5 });
		await ed.load();
		ed.set({ dirty: true });
		await ed.openTrack({ name: "x", folder: "D:/x" });
		expect(fe.calls.some((c) => c.path === "/api/open")).toBe(false);
		ed.set({ dirty: false });
		fe.fail["/api/open"] = "this engine cannot switch tracks by itself";
		await ed.openTrack({ name: "x", folder: "D:/x" });
		expect(dialogs.alerts.at(-1)).toBe("Could not open x: this engine cannot switch tracks by itself");
		expect(ed.get().opening).toBeNull();
		delete fe.fail["/api/open"];
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
		render(<App editor={ed} />);
		await userEvent.click(screen.getByRole("button", { name: "Test" }));
		await userEvent.type(screen.getByLabelText("A track's folder"), '"D:\\tracks\\far one"');
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(fe.calls.filter((c) => c.path === "/api/open").at(-1)?.body).toEqual({ folder: "D:\\tracks\\far one" });
		await waitFor(() => expect(reload).toHaveBeenCalledOnce());
	});
});
