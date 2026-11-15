#!/bin/sh
# Uploads one picture to a public Vercel Blob store and prints its web address. Astrolabe runs this for each
# picture put into a note when the `imageUpload` setting names it:
#
#   "imageUpload": "/path/to/astrolabe/scripts/upload-image.sh"
#
# The store's read-write token is read from $BLOB_READ_WRITE_TOKEN, or from the file ~/.astrolabe/blob-token.
# A picture's address comes from its contents, so the same picture uploaded twice has one address, and nobody
# can find a picture without being given its address. Anyone who is given it can see the picture.
set -eu
file="${1:-}"
[ -n "$file" ] && [ -f "$file" ] || { echo "upload-image: not a file: $file" >&2; exit 1; }
token="${BLOB_READ_WRITE_TOKEN:-}"
if [ -z "$token" ] && [ -r "$HOME/.astrolabe/blob-token" ]; then token=$(tr -d '[:space:]' < "$HOME/.astrolabe/blob-token"); fi
[ -n "$token" ] || { echo "upload-image: no token. Put the Blob store's read-write token in ~/.astrolabe/blob-token" >&2; exit 1; }
command -v vercel >/dev/null 2>&1 || { echo "upload-image: the vercel command is not on the PATH" >&2; exit 1; }
hash=$(shasum -a 256 "$file" | cut -c1-24)
name=$(printf %s "$(basename "$file")" | tr -c 'A-Za-z0-9._-' '-')
out=$(BLOB_READ_WRITE_TOKEN="$token" vercel blob put "$file" --access public --pathname "notes/$hash/$name" --allow-overwrite true --non-interactive 2>&1) || { echo "$out" >&2; exit 1; }
url=$(printf '%s\n' "$out" | grep -Eo 'https://[A-Za-z0-9.-]+\.blob\.vercel-storage\.com/[^[:space:]"]+' | tail -1)
[ -n "$url" ] || { echo "upload-image: the upload printed no address:" >&2; echo "$out" >&2; exit 1; }
printf '%s\n' "$url"
