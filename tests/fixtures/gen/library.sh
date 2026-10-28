#!/bin/sh
# A small music library for the desktop tests: tagged songs with covers, a sidecar .lrc (one with word timing), a song
# without lyrics, a file a streaming service encrypted (listed, never played), and an MV clip. Needs ffmpeg and python3.
set -e
C="$1"; OUT="$C/lib"; rm -rf "$OUT"; mkdir -p "$OUT/A" "$OUT/B"
python3 - "$OUT" <<'PY'
import sys
from PIL import Image, ImageDraw
o=sys.argv[1]
for name,c1,c2 in [('red',(220,60,70),(60,20,40)),('blue',(40,90,230),(10,20,60))]:
    im=Image.new('RGB',(600,600),c2); d=ImageDraw.Draw(im)
    for i in range(12): d.ellipse([60+i*20,60+i*20,540-i*20,540-i*20],outline=tuple(min(255,int(v*(0.6+i*0.04))) for v in c1),width=10)
    im.save(f'{o}/{name}.jpg',quality=90)
PY
ff() { ffmpeg -loglevel error -y "$@"; }
ff -t 40 -i "$C/songpop.wav" -i "$OUT/red.jpg" -map 0:a -map 1 -c:a libmp3lame -b:a 160k -c:v mjpeg -id3v2_version 3 \
  -metadata title="晨光" -metadata artist="測試樂團" -metadata album="第一張" -metadata genre="Pop" -metadata date="2024" -metadata track="1" \
  -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" "$OUT/A/01 晨光.mp3"
ff -t 30 -i "$C/song97.wav" -c:a flac -metadata title="無詞的歌" -metadata artist="測試樂團" -metadata album="第一張" -metadata genre="Pop" -metadata track="2" "$OUT/A/02 無詞的歌.flac"
ff -t 40 -i "$C/song138.wav" -i "$OUT/blue.jpg" -map 0:a -map 1 -c:a libmp3lame -b:a 160k -c:v mjpeg -id3v2_version 3 \
  -metadata title="Night Drive" -metadata artist="Neon Club" -metadata album="Midnight" -metadata genre="Electronic" -metadata date="2025" \
  -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" "$OUT/B/Night Drive.mp3"
printf '[ti:晨光]\n[00:02.00]清晨的光 落在窗邊\n[00:06.00]我們沿著 街道慢慢走\n[00:10.00]風輕輕 吹過\n[00:14.00]時間 一直往前\n[00:20.00]每一個 當下\n[00:26.00]都很好\n' > "$OUT/A/01 晨光.lrc"
printf '[00:01.00]<00:01.00>Driving <00:01.60>through <00:02.20>the <00:02.60>night\n[00:05.00]<00:05.00>City <00:05.70>lights <00:06.30>are <00:06.80>calling\n[00:10.00]<00:10.00>Never <00:10.80>stop\n' > "$OUT/B/Night Drive.lrc"
head -c 200000 /dev/urandom > "$OUT/B/Locked Song.ncm"
ff -f lavfi -i testsrc2=size=640x360:rate=30 -t 40 -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$C/mv.mp4"
rm -f "$OUT/red.jpg" "$OUT/blue.jpg"
