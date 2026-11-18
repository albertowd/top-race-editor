// @vitest-environment node
// rFactor 2's text files of a track (rf2/text.ts): written as Studio 397's own tracks have them.
import { describe, expect, it } from 'vitest';
import { GROUNDS, gdbText, groundOf, materialName, scnText, tdfText, wetText } from './text';

const lines = (t: string) => t.split('\r\n');

describe("rFactor 2's text files", () => {
  it('match each material driven on to its ground by the start of its name', () => {
    const surfaces = { asphalt: { targets: { rf2: 'road' } }, kerb: { targets: { rf2: 'rumble' } }, mud: {} };
    expect(groundOf('asphalt', surfaces).prefix).toBe('road');
    expect(groundOf('kerb', surfaces).prefix).toBe('rmbl');
    // (a surface rFactor has no ground for: asphalt; one named as a ground: that one)
    expect(groundOf('mud', surfaces).prefix).toBe('road');
    expect(groundOf('grass', surfaces).prefix).toBe('gras');
    expect(materialName('Kerb Red.2', groundOf('kerb', surfaces))).toBe('rmbl_Kerb_Red_2');
    expect(materialName('OutRoofDark', null)).toBe('OutRoofDark');
    // (no ground's prefix the start of another's: the TDF would take the first)
    const prefixes = Object.values(GROUNDS).map((g) => g.prefix);
    for (const a of prefixes) for (const b of prefixes) if (a !== b) expect(b.startsWith(a)).toBe(false);
  });

  it('write the TDF with each ground once, its materials last', () => {
    const t = lines(tdfText([GROUNDS.road, GROUNDS.grass, GROUNDS.road] as never));
    expect(t[2]).toBe('[TRACKVARS]');
    expect(t.filter((l) => l === '[FEEDBACK]')).toHaveLength(2);
    expect(t.filter((l) => l.startsWith('Materials='))).toEqual(['Materials=road', 'Materials=gras']);
    // (a feedback block: its line, its reactions, then its materials)
    const at = t.indexOf('Materials=road');
    expect(t[at - 1]?.startsWith('Reaction=spray')).toBe(true);
    // (then the effects the feedback calls on: the sparks, smoke, flames and a wall's skids, as the samples end)
    const loose = t.indexOf('[LOOSE]');
    expect(loose).toBeGreaterThan(at);
    expect(t.slice(loose + 1, loose + 6).map((l) => l.split(' ')[0])).toEqual([
      'Reaction=spark',
      'Reaction=whitesmoke',
      'Reaction=blacksmoke',
      'Reaction=flames',
      'Reaction=wallskid',
    ]);
  });

  it('write the scene: its paths, views, lights and instances', () => {
    const t = scnText({
      searchPaths: ['.', 'Velopark', 'Velopark\\Assets\\GMT'],
      lights: [{ name: 'Lamp0', pos: [1, 2, 3], range: 30, intensity: 1.5, colour: [255, 240, 210] }],
      instances: [
        { name: 'Road', mesh: 'Road.gmt', collide: true, hat: true, shadows: false, deformable: true },
        { name: 'xfinish', mesh: 'xfinish.gmt', collide: true, hat: false, render: false, response: 'VEHICLE,TIMING' },
        { name: 'Cone_0', mesh: 'Cone_0.gmt', collide: true, hat: false, moveable: true, shadows: true },
      ],
    });
    const L = lines(t);
    expect(L[0]).toBe('CUBEASF');
    expect(L).toContain('SearchPath=Velopark\\Assets\\GMT');
    expect(L).toContain('MASFile=COMMONMAPS.MAS');
    expect(L).toContain(
      ' Type=Omni Pos=(1.000000, 2.000000, 3.000000) Range=(0.000000, 30.000000) Active=True Intensity=(1.500000) Color=(255, 240, 210)',
    );
    expect(t).toContain(
      'Instance=Road\r\n{\r\n  MeshFile=Road.gmt Deformable=True CollTarget=True HATTarget=True\r\n}',
    );
    expect(t).toContain(
      'Instance=xfinish\r\n{\r\n  Render=False\r\n  MeshFile=xfinish.gmt CollTarget=True HATTarget=False\r\n  Response=VEHICLE,TIMING\r\n}',
    );
    expect(t).toContain(
      '  Moveable=True\r\n  MeshFile=Cone_0.gmt CollTarget=True HATTarget=False ShadowCaster=(Static, Solid)',
    );
    // (the reflections the game needs at least: STATIC01 and REFMAP0, a cube each)
    expect(t).toContain('ReflectionMapper=STATIC01\r\n{\r\n  Type=Cubic');
    expect(t).toContain('ReflectionMapper=REFMAP0\r\n{\r\n  Type=Cubic');
    expect(L).toContain('  TrackingIns=True');
    // (its braces even)
    expect(L.filter((l) => l.trim() === '{').length).toBe(L.filter((l) => l.trim() === '}').length);
  });

  it("write a layout's GDB and WET", () => {
    const g = lines(
      gdbText({
        id: 'VP_1500',
        trackName: 'Velopark 1500',
        eventName: 'Velopark 1500',
        venueName: 'Velopark',
        length: 1512.4,
        tdf: '..\\Velopark.tdf',
        latitude: -29.85,
        longitude: -51.3,
      }),
    );
    expect(g[0]).toBe('VP_1500');
    expect(g[1]).toBe('{');
    expect(g.at(-2)).toBe('}');
    expect(g).toContain('  Length = 1.512 KM / 0.94 Miles');
    expect(g).toContain('  TerrainDataFile=..\\Velopark.tdf');
    expect(g).toContain('  Latitude = -29.8500');
    const w = lines(wetText());
    expect(w[0]?.startsWith('//[[gMa1.002f')).toBe(true);
    expect(w[1]).toBe('[Weather Info]');
    expect(w.filter((l) => l.endsWith(' Info]'))).toEqual([
      '[Weather Info]',
      '[Practice Info]',
      '[Qualifying Info]',
      '[Race Info]',
    ]);
    expect(w.filter((l) => l.startsWith('StartTime='))).toHaveLength(15);
    expect(w.find((l) => l.startsWith('StartTime='))).toBe('StartTime=(540)');
  });
});
