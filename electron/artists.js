'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { artistKey } = require('./identity');
const hash = (s) => createHash('sha1').update(s).digest('hex');
class ArtistProfiles {
  constructor({ dir, fetch, nativeImage }) { this.dir = dir; this.fetch = fetch; this.nativeImage = nativeImage; this.jobs = new Map(); this.tail = Promise.resolve(); this.lastRequest = 0; }
  async json(url) {
    const job = this.tail.catch(() => {}).then(async () => {
      const wait = Math.max(0, 2050 - (Date.now() - this.lastRequest));
      if (wait) await new Promise((r) => setTimeout(r, wait));
      this.lastRequest = Date.now();
      const res = await this.fetch(url, { headers: { 'User-Agent': 'PixelPlayer/1.2 (https://github.com/N0pulsse/pixelplayer)' } });
      if (!res.ok) throw new Error(`Music data ${res.status}`);
      return res.json();
    });
    this.tail = job;
    return job;
  }
  async image(url) {
    if (!url) return null;
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/(^|\.)(theaudiodb\.com|dzcdn\.net|deezer\.com)$/.test(u.hostname)) return null;
    const key = hash(url).slice(0, 24); const file = path.join(this.dir, key + '.jpg');
    try { await fs.access(file); return `pp://app/artist/${key}`; } catch {}
    try {
      const res = await this.fetch(url);
      if (!res.ok || Number(res.headers?.get('content-length')) > 12 * 1024 * 1024) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 12 * 1024 * 1024) return null;
      const image = this.nativeImage.createFromBuffer(buf);
      if (image.isEmpty()) return null;
      await fs.mkdir(this.dir, { recursive: true });
      const size = image.getSize();
      await fs.writeFile(file, (size.width > 1600 ? image.resize({ width: 1600 }) : image).toJPEG(88));
      return `pp://app/artist/${key}`;
    } catch { return null; }
  }
  async get(name, { force = false, online = true, albums = [] } = {}) {
    name = String(name || '').trim().slice(0, 180);
    if (!name) return null;
    const key = artistKey(name);
    const file = path.join(this.dir, 'profile-' + hash(key).slice(0, 24) + '.json');
    let cached;
    try { cached = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
    if (cached && (!online || (!force && Date.now() - cached.fetchedAt < (cached.found ? 7 : 0.25) * 86400000))) return { ...cached, cached: true };
    if (!online) return null;
    if (this.jobs.has(key)) return this.jobs.get(key);
    const job = this.load(name, albums).then(async (data) => {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(file, JSON.stringify(data));
      return data;
    }).catch(() => cached ? { ...cached, cached: true, offline: true } : { name, found: false, offline: true, albums: [] }).finally(() => this.jobs.delete(key));
    this.jobs.set(key, job);
    return job;
  }
  async deezer(name, knownAlbums = []) {
    const data = await this.json(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=20`);
    const candidates = (data.data || []).filter((a) => artistKey(a.name) === artistKey(name)).sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0));
    let hit = candidates[0];
    if (candidates.length > 1 && knownAlbums.length) {
      try {
        const q = `artist:"${name.replace(/"/g, '')}" album:"${String(knownAlbums[0]).replace(/"/g, '')}"`;
        const matches = await this.json(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=10`);
        const match = matches.data?.find((a) => artistKey(a.title) === artistKey(knownAlbums[0]) && candidates.some((c) => c.id === a.artist?.id));
        if (match) hit = candidates.find((c) => c.id === match.artist.id);
      } catch {}
    }
    if (!hit) return null;
    let albums = [];
    try { const disc = await this.json(`https://api.deezer.com/artist/${hit.id}/albums?limit=100`); albums = (disc.data || []).map((a) => ({ title: a.title, year: a.release_date?.slice(0, 4), type: a.record_type, url: a.link })); } catch {}
    return { hit, albums };
  }
  async load(name, knownAlbums = []) {
    let artist;
    try { const data = await this.json(`https://www.theaudiodb.com/api/v1/json/123/search.php?s=${encodeURIComponent(name)}`); artist = data.artists?.find((a) => [a.strArtist, a.strArtistAlternate].filter(Boolean).some((n) => artistKey(n) === artistKey(name))); } catch {}
    if (artist) {
      let albums = [];
      try { const data = await this.json(`https://www.theaudiodb.com/api/v1/json/123/album.php?i=${encodeURIComponent(artist.idArtist)}`); albums = (data.album || []).slice(0, 60).map((a) => ({ title: a.strAlbum, year: a.intYearReleased, type: a.strReleaseFormat, url: `https://www.theaudiodb.com/album/${a.idAlbum}` })); } catch {}
      let extra;
      try { extra = await this.deezer(name, knownAlbums); } catch {}
      const merged = new Map(albums.map((a) => [artistKey(a.title), a]));
      for (const album of extra?.albums || []) if (!merged.has(artistKey(album.title))) merged.set(artistKey(album.title), album);
      albums = [...merged.values()].sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
      const [image, banner] = await Promise.all([this.image(artist.strArtistThumb), this.image(artist.strArtistFanart || artist.strArtistBanner || artist.strArtistWideThumb)]);
      return { name: artist.strArtist, found: true, image, banner, biography: String(artist.strBiographyRU || artist.strBiographyEN || '').slice(0, 14000), genre: artist.strGenre, country: artist.strCountry, formed: artist.intFormedYear, albums, source: extra?.albums?.length ? 'TheAudioDB + Deezer' : 'TheAudioDB', url: `https://www.theaudiodb.com/artist/${artist.idArtist}`, fetchedAt: Date.now() };
    }
    const extra = await this.deezer(name, knownAlbums);
    const hit = extra?.hit;
    if (!hit) return { name, found: false, albums: [], fetchedAt: Date.now() };
    return { name: hit.name, found: true, image: await this.image(hit.picture_xl || hit.picture_big), albums: extra.albums, source: 'Deezer', url: hit.link, fetchedAt: Date.now() };
  }
}
module.exports = { ArtistProfiles };
