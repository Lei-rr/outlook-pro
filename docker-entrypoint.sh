#!/bin/sh
set -e

# A host directory mounted at $DATA_DIR arrives with the host's ownership, which
# the non-root appuser cannot write. Fix ownership as root, then drop privileges.
if [ "$(id -u)" = "0" ]; then
  chown -R appuser:appuser "${DATA_DIR:-/data}"
  exec gosu appuser "$@"
fi

exec "$@"
