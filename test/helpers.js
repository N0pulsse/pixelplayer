'use strict';
// Помощники для тестов: делаем настоящие аудиофайлы через ffmpeg и «парсер» тегов через ffprobe,
// чтобы проверять сканер без пакета music-metadata.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function mktmp(prefix = 'pp-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Создаёт аудиофайл с тегами и (необязательно) обложкой. */
function makeAudio(file, { seconds = 20, freq = 440, tags = {}, cover = null, codec = null } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ext = path.extname(file).toLowerCase();
  const args = ['-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`];
  if (cover) args.push('-i', cover);
  args.push('-map', '0:a');
  if (cover) {
    args.push('-map', '1:v');
    if (ext === '.mp3' || ext === '.m4a') args.push('-c:v', 'copy', '-disposition:v', 'attached_pic');
    else if (ext === '.flac') args.push('-c:v', 'copy', '-disposition:v', 'attached_pic');
  }
  if (codec) args.push('-c:a', codec);
  else if (ext === '.mp3') args.push('-c:a', 'libmp3lame', '-b:a', '128k');
  else if (ext === '.m4a') args.push('-c:a', 'aac', '-b:a', '128k');
  else if (ext === '.ogg') args.push('-c:a', 'libvorbis');
  else if (ext === '.opus') args.push('-c:a', 'libopus');
  for (const [k, v] of Object.entries(tags)) args.push('-metadata', `${k}=${v}`);
  if (ext === '.mp3') args.push('-id3v2_version', '3');
  args.push(file);
  ffmpeg(args);
}

function makeCover(file, color = 'red') {
  ffmpeg(['-f', 'lavfi', '-i', `color=c=${color}:s=600x600`, '-frames:v', '1', file]);
}

/** Парсер тегов на основе ffprobe в том же формате, что возвращает electron/meta.js */
function ffprobeParser() {
  return async (file) => {
    const out = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' });
    const j = JSON.parse(out);
    const t = Object.fromEntries(Object.entries(j.format.tags || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const audio = j.streams.find((s) => s.codec_type === 'audio') || {};
    let picture = null;
    if (j.streams.some((s) => s.codec_type === 'video')) {
      try {
        const data = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-an', '-c:v', 'mjpeg', '-frames:v', '1', '-f', 'image2pipe', 'pipe:1'], { maxBuffer: 20 * 1024 * 1024 });
        if (data.length) picture = { data, format: 'image/jpeg' };
      } catch { /* */ }
    }
    return {
      title: t.title || null,
      artist: t.artist || null,
      artists: t.artist ? [t.artist] : [],
      albumArtist: t.album_artist || t.albumartist || null,
      album: t.album || null,
      year: t.date ? parseInt(t.date, 10) : null,
      genre: t.genre || null,
      track: t.track ? parseInt(t.track, 10) : null,
      disc: t.disc ? parseInt(t.disc, 10) : null,
      duration: parseFloat(j.format.duration) || 0,
      bitrate: j.format.bit_rate ? Math.round(j.format.bit_rate / 1000) : null,
      sampleRate: audio.sample_rate ? parseInt(audio.sample_rate, 10) : null,
      lossless: audio.codec_name === 'flac',
      codec: audio.codec_name,
      picture,
      lyrics: null,
    };
  };
}

module.exports = { mktmp, makeAudio, makeCover, ffprobeParser };
