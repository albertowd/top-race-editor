/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** the engine's tests that build the whole Velopark, by hand (src/engine) */
const VELOPARK_CHECKS = ["trackfloor.spot.test.ts", "trackbuild.test.ts", "beamng/velopark-level.test.ts"];

export default defineConfig({
	plugins: [react()],
	// (its files found from where each page is, so the desktop app can serve them itself: app://)
	base: "./",
	// (three pages: the editor, the new-track wizard, and the desktop app's engine window)
	build: {
		sourcemap: true,
		// (the engine window's bundle and its merge worker carry the whole engine and its geometry libraries, about 3 MB each: loaded once, from the disk, by the
		// desktop app: no smaller pieces to be had by splitting them)
		chunkSizeWarningLimit: 3500,
		rollupOptions: { input: { main: "index.html", wizard: "wizard.html", engine: "engine.html" } },
	},
	test: {
		environment: "jsdom",
		setupFiles: ["src/test/setup.ts"],
		// (the page's tests drive whole dialogs; with the engine's beside them, 5 s is short on a busy computer; with coverage, the geometry's run a few
		// times slower)
		testTimeout: process.argv.includes("--coverage") ? 60_000 : 15_000,
		include: ["src/**/*.test.{ts,tsx}"],
		// (the Velopark built whole: only when asked, TOP_RACE_VELOPARK=1)
		exclude: ["**/node_modules/**", ...(process.env.TOP_RACE_VELOPARK === "1" ? [] : VELOPARK_CHECKS.map((f) => `src/engine/${f}`))],
		coverage: {
			provider: "v8",
			reporter: ["text-summary", "lcov"],
			reportsDirectory: "coverage/web",
			include: ["src/**/*.{ts,tsx}"],
			exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/main.tsx", "src/**/*.d.ts"],
		},
	},
});
