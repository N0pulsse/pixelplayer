# Synthetic audio fixtures

`a.wav`, `b.wav`, and `c.wav` contain only generated test tones (440 Hz, 554.37 Hz,
and 659.25 Hz). Each file is 40 seconds of mono PCM at 44.1 kHz, with low volume.
They contain no music recordings or personal audio.

Regenerate with FFmpeg:

```text
ffmpeg -y -f lavfi -i sine=frequency=440:duration=40:sample_rate=44100 -af volume=0.05 -c:a pcm_s16le test/media/a.wav
ffmpeg -y -f lavfi -i sine=frequency=554.37:duration=40:sample_rate=44100 -af volume=0.05 -c:a pcm_s16le test/media/b.wav
ffmpeg -y -f lavfi -i sine=frequency=659.25:duration=40:sample_rate=44100 -af volume=0.05 -c:a pcm_s16le test/media/c.wav
```
