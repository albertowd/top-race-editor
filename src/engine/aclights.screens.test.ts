// @vitest-environment node
// The track's screens in AC's config (aclights.ts): each the editor's script (models/scripts/ac/screens) between the
// config's single quotes, its data put in, its comment lines left out, so nothing in it ends the quotes early (CSP
// then fails it: "unfinished string"); a script with an apostrophe left in it refused.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acLightsText, type LightsData } from './aclights';
import type { HostFiles } from './placehost';

const SCRIPTS = join(__dirname, '..', '..', 'models', 'scripts').split('\\').join('/');

function host(more: Record<string, string> = {}): HostFiles {
  const text: Record<string, string> = {
    'P/source/track/extension/ext_config.ini': '[BASIC]\nIGNORE_OTHER_CONFIGS = 0\n',
    'P/source/materials.json': '{"materials": {}}',
    ...more,
  };
  return {
    read: async (p) => (p in text ? new TextEncoder().encode(text[p]) : new Uint8Array(readFileSync(p))),
    list: async () => [],
    size: async () => 0,
    exists: async (p) => p in text,
    write: async () => {},
  };
}

const screen = (shows: string, data: Record<string, unknown> = {}) =>
  ({ material: `M_${shows}`, shows, pixels: [512, 512], data }) as unknown as LightsData['screens'][number];

describe("the track's screens in AC's config", () => {
  it('writes every script of the editor between its quotes whole: no comment lines, no apostrophe', async () => {
    const shows = readdirSync(`${SCRIPTS}/ac/screens`).map((f) => f.replace(/\.lua$/, ''));
    expect(shows.length).toBeGreaterThan(0);
    const dt: LightsData = {
      series: {},
      lights: [],
      // (data with an apostrophe of its own, as a driver's name may have)
      screens: shows.map((s) =>
        screen(s, { prices: ['4.55'], times: [[1, 'Ford', 'Ka', '2010', "D'Avila", 71000, 3]] }),
      ),
    };
    const ini = await acLightsText(host(), 'P', 'M', { nodeIn: () => [''] } as never, dt, SCRIPTS);
    const scripts = [...ini.matchAll(/SCRIPT = '\n([\s\S]*?)'\nBACKGROUND/g)].map((m) => m[1] as string);
    expect(scripts).toHaveLength(shows.length);
    for (const s of scripts) {
      expect(s).not.toContain("'");
      expect(s.split('\n').some((l) => /^\s*--/.test(l))).toBe(false);
    }
    // (the data put in where the script asks for it)
    expect(ini).toContain('local PRICES = { "4.55" }');
  });

  it('refuses a script with an apostrophe left in its code', async () => {
    const files = host({ 'S/ac/screens/bad.lua': "function update(dt)\n  local s = 'x'\nend\n" });
    const dt: LightsData = { series: {}, lights: [], screens: [screen('bad')] };
    await expect(acLightsText(files, 'P', 'M', { nodeIn: () => [''] } as never, dt, 'S')).rejects.toThrow(
      "the bad screen's script has an apostrophe",
    );
  });
});
