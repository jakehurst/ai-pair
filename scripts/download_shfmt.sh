#!/bin/bash
# Downloads shfmt from either official URL, accepting only the expected hash.
set -u

readonly OUTPUT="$1"
readonly SHA256="$2"
readonly DIRECT='https://github.com/mvdan/sh/releases/download/'
readonly API='https://api.github.com/repos/mvdan/sh/releases/assets/'
CURL_ARGS=(--fail --silent --show-error --location --retry 5)
CURL_ARGS+=(--retry-all-errors --connect-timeout 20 --max-time 300)
CURL_ARGS+=(--retry-max-time 600 -H 'Accept: application/octet-stream')
CURL_ARGS+=(-H 'X-GitHub-Api-Version: 2022-11-28' -o "${OUTPUT}")
readonly -a CURL_ARGS

# specs/ShfmtDownload.tla, Primary: accept only the pinned digest.
if curl "${CURL_ARGS[@]}" "${DIRECT}v3.14.1/shfmt_v3.14.1_linux_amd64" \
  && echo "${SHA256}  ${OUTPUT}" | sha256sum -c -; then
  exit 0
fi
rm -f "${OUTPUT}"
# specs/ShfmtDownload.tla, Fallback: remove failed output before retrying.
if curl "${CURL_ARGS[@]}" "${API}547320883" \
  && echo "${SHA256}  ${OUTPUT}" | sha256sum -c -; then
  exit 0
fi
rm -f "${OUTPUT}"
echo 'Could not download shfmt with the expected checksum' >&2
exit 1
