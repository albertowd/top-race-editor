// Strings in order of their UTF-16 code units: the order a sort with no compare function gives, and Python's for the
// names the games' files are written in (not the locale's, which would set "a" and "B" otherwise).

/** a before b (-1), after it (1), or the same (0), by their code units */
export const byCodePoint = (a: string, b: string): number => Number(a > b) - Number(a < b);
