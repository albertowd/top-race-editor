import { createContext, type ReactNode, useContext } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Terrain, TerrainState } from './store';

const TerrainContext = createContext<Terrain | null>(null);

export function TerrainProvider({ terrain, children }: Readonly<{ terrain: Terrain | null; children: ReactNode }>) {
  return <TerrainContext.Provider value={terrain}>{children}</TerrainContext.Provider>;
}

/** The terrain's editor, if the page has one (null: none given, as in tests of the rest). */
export const useTerrainMaybe = (): Terrain | null => useContext(TerrainContext);

export function useTerrain(): Terrain {
  const t = useContext(TerrainContext);
  if (!t) throw new Error('useTerrain: no TerrainProvider above');
  return t;
}

export function useTerrainState<T>(select: (s: TerrainState) => T): T {
  return useStore(useTerrain().store, select);
}

export function useTerrainShallow<T extends object>(select: (s: TerrainState) => T): T {
  return useStore(useTerrain().store, useShallow(select));
}
