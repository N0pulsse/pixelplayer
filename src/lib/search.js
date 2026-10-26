const EN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./~@#$^&QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?";
const RU = 'ёйцукенгшщзхъфывапролджэячсмитьбю.Ё"№;:?ЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,';
const EN2RU = new Map([...EN].map((c, i) => [c, RU[i]]));
const RU2EN = new Map([...RU].map((c, i) => [c, EN[i]]));

const swap = (s, map) => [...s].map((c) => map.get(c) ?? c).join('');

/** Нормализация для поиска: регистр, «ё»→«е», диакритика, пунктуация. */
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Варианты запроса: как набрано + как если бы раскладка была другой («ghbdtn» ↔ «привет»). */
export function queryVariants(q) {
  const base = norm(q);
  if (!base) return [];
  const set = new Set([base]);
  const a = norm(swap(q, EN2RU)); const b = norm(swap(q, RU2EN));
  if (a) set.add(a);
  if (b) set.add(b);
  return [...set];
}

/** Оценка совпадения: 0 — нет; больше — лучше. */
export function scoreText(hay, variants) {
  let best = 0;
  for (const q of variants) {
    if (!q) continue;
    if (hay === q) best = Math.max(best, 100);
    else if (hay.startsWith(q)) best = Math.max(best, 80);
    else if (hay.includes(' ' + q)) best = Math.max(best, 60);
    else if (hay.includes(q)) best = Math.max(best, 35);
    else {
      // каждое слово запроса должно встречаться (в любом порядке)
      const words = q.split(' ');
      if (words.length > 1 && words.every((w) => hay.includes(w))) best = Math.max(best, 45);
    }
  }
  return best;
}
