'use strict';
const artistKey = (name) => String(name || '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const cleanTitle = (title) => String(title || '').replace(/\s*[([](?:official\s*(?:audio|video|lyrics)?|lyrics?|audio|hd|hq|\d{3,4}p)[)\]]/gi, '').replace(/\s+/g, ' ').trim();
function splitArtistCredit(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  const protectedComma = /^(earth, wind|tyler, the creator|crosby, stills)/i;
  const result = [];
  for (const item of list) {
    const parts = String(item).split(/\s*(?:;|\n|\s\/\s|\bfeat\.?\s|\bft\.?\s|\bfeaturing\s|\bпри\s+уч\.?\s)\s*/i);
    for (const part of parts.flatMap((p) => protectedComma.test(p.trim()) ? [p] : p.split(/,\s+/))) {
      const name = part.replace(/^[\s([]+|[\s)\]]+$/g, '').trim();
      if (name && !result.some((r) => artistKey(r) === artistKey(name))) result.push(name);
    }
  }
  return result;
}
function albumIdentity(track) {
  const primary = track.compilation ? 'Разные исполнители' : (track.albumArtist || splitArtistCredit(track.artists?.length ? track.artists : track.artist)[0] || 'Неизвестный исполнитель');
  return { primary, key: `${artistKey(track.album)}|${track.musicbrainzAlbumId || artistKey(primary)}` };
}
module.exports = { artistKey, cleanTitle, splitArtistCredit, albumIdentity };
