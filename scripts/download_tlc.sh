#!/bin/bash
# Downloads TLC from either official URL, accepting only the expected hash.
set -u

readonly OUTPUT="$1"
readonly SHA256="$2"
readonly DIRECT='https://github.com/tlaplus/tlaplus/releases/download/'
readonly API='https://api.github.com/repos/tlaplus/tlaplus/releases/assets/'
readonly -a CURL_ARGS=(--fail --silent --show-error --location --retry 3
  --retry-all-errors --connect-timeout 20 --max-time 300 --retry-max-time 600
  -H 'Accept: application/octet-stream' -H 'X-GitHub-Api-Version: 2022-11-28'
  -o "${OUTPUT}")

if curl "${CURL_ARGS[@]}" "${DIRECT}v1.8.0/tla2tools.jar" \
  && echo "${SHA256}  ${OUTPUT}" | sha256sum -c -; then
  exit 0
fi
rm -f "${OUTPUT}"
if curl "${CURL_ARGS[@]}" "${API}749260120" \
  && echo "${SHA256}  ${OUTPUT}" | sha256sum -c -; then
  exit 0
fi
rm -f "${OUTPUT}"
echo 'Could not download TLC with the expected checksum' >&2
exit 1
