// Subsequence match with bonuses for word starts and consecutive runs.
export interface FuzzyHit<T> { item: T; score: number; positions: number[] }

export function fuzzyScore(query: string, text: string): { score: number; positions: number[] } | null {
  if (!query) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const positions: number[] = [];
  let score = 0; let ti = 0; let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    if (ch === ' ') continue;
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] !== ch) continue;
      found = i; break;
    }
    if (found < 0) return null;
    const before = found > 0 ? text[found - 1] : '/';
    let bonus = 1;
    if (found === prev + 1) bonus += 5;
    if ('/_-. '.includes(before)) bonus += 4;
    else if (before === before.toLowerCase() && text[found] !== text[found].toLowerCase()) bonus += 2;
    score += bonus;
    positions.push(found);
    prev = found; ti = found + 1;
  }
  const lastSlash = text.lastIndexOf('/');
  if (positions.length && positions[0] > lastSlash) score += 6;
  score -= text.length * 0.01;
  return { score, positions };
}

export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string, limit = 80): FuzzyHit<T>[] {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, score: 0, positions: [] }));
  const hits: FuzzyHit<T>[] = [];
  for (const item of items) {
    const r = fuzzyScore(query, key(item));
    if (r) hits.push({ item, score: r.score, positions: r.positions });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
