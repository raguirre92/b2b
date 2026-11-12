#!/bin/bash
# Download paths that the local server reported as 404 (lazy-loaded chunks) from the origin.
ORIGIN=$1; OUT=$2; LOG=$3
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
grep '^404 ' "$LOG" | awk '{print $2}' | sed 's/[?#].*//' | sort -u | while read p; do
  f="$OUT/public$(python3 -c 'import sys,urllib.parse;print(urllib.parse.unquote(sys.argv[1]))' "$p")"
  [ -f "$f" ] && continue
  mkdir -p "$(dirname "$f")"
  code=$(curl -s -A "$UA" -e "$ORIGIN/" -o "$f.tmp" -w "%{http_code}" "$ORIGIN$p")
  if [ "$code" = 200 ]; then sed -i "s#https://${ORIGIN#https://}/#/#g; s#https:\\\\/\\\\/${ORIGIN#https://}\\\\/#\\\\/#g" "$f.tmp" 2>/dev/null; mv "$f.tmp" "$f"; echo "OK $p"; else rm -f "$f.tmp"; echo "$code $p"; fi
  sleep 0.3
done
