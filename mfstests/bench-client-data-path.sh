#!/bin/bash
#
# bench-client-data-path.sh
# Dedicated benchmark for MooseFS client data path performance refactor
# (plan item: Client Read/Write Path improvements).
#
# This exercises the specific functionality changed:
#   - readdata.c: READAHEAD_MAX (now 8), SUSTAIN/HEAVY/MAX_WORKERS
#   - writedata.c: same worker counts + MAX_SIM_CHUNKS (32) + NEXT_BLOCK_DELAY
#
# The benchmark is intentionally simple/portable so it can be used in CI or
# by developers. It does not require a full cluster to *compile*, but to get
# real numbers you mount MooseFS and point it at a test file/dir.
#
# Usage:
#   MFS_MOUNT=/mnt/mfs/testdir ./mfstests/bench-client-data-path.sh
#   (or set MFS_MOUNTPOINT)
#
# It will:
#   1. If a mountpoint is provided and writable, run sequential + random-ish
#      read/write timings using dd (and fio if present) to measure the
#      effect of the worker/readahead/sim-chunks tunables.
#   2. Always report the current compiled-in values (by grepping the sources).
#   3. Provide a "unit" style smoke: just exercise some local computation if
#      no mount (to keep it runnable in limited envs).
#
# After any client data path refactor, run this + "make -C mfstests check"
# before committing the checkpoint.
#
set -euo pipefail

MOUNT="${MFS_MOUNT:-${MFS_MOUNTPOINT:-}}"
OUTDIR="${MOUNT:-/tmp/mfs-bench-$$}"
FIO=$(command -v fio || true)
DD="dd bs=1M iflag=fullblock oflag=direct conv=fsync status=none"

echo "=== MooseFS Client Data Path Benchmark (refactor verification) ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Tunables (from sources at benchmark creation time):"
grep -E 'READAHEAD_MAX|SUSTAIN_WORKERS|HEAVYLOAD_WORKERS|MAX_WORKERS|MAX_SIM_CHUNKS|NEXT_BLOCK_DELAY' \
     mfsclient/readdata.c mfsclient/writedata.c | cat
echo

if [[ -z "$MOUNT" || ! -d "$MOUNT" ]]; then
  echo "No writable MFS mountpoint supplied (MFS_MOUNT=/path or MFS_MOUNTPOINT)."
  echo "Creating a local temp dir for smoke test only (no real network I/O)."
  mkdir -p "$OUTDIR"
  MOUNT="$OUTDIR"
  REAL_MFS=0
else
  REAL_MFS=1
  echo "Using mount: $MOUNT"
fi

TESTFILE="$MOUNT/bench-client-data-$$.bin"
TESTSIZE_MB=256
READSIZE_MB=256

cleanup() {
  rm -f "$TESTFILE" || true
  if (( REAL_MFS == 0 )); then rmdir "$OUTDIR" 2>/dev/null || true; fi
}
trap cleanup EXIT

echo "Writing ${TESTSIZE_MB} MiB test file..."
if (( REAL_MFS == 1 )); then
  time $DD if=/dev/zero of="$TESTFILE" count=$TESTSIZE_MB 2>&1 | cat
  sync
else
  # local smoke: just allocate
  head -c $((TESTSIZE_MB*1024*1024)) /dev/zero > "$TESTFILE"
fi

echo
echo "Sequential read timing (${READSIZE_MB} MiB)..."
if (( REAL_MFS == 1 )); then
  time $DD if="$TESTFILE" of=/dev/null count=$READSIZE_MB 2>&1 | cat
else
  time cat "$TESTFILE" > /dev/null
fi

echo
echo "Random-ish 4k reads (limited) to exercise readahead/worker paths..."
if (( REAL_MFS == 1 )) && [[ -n "$FIO" ]]; then
  "$FIO" --name=randread --filename="$TESTFILE" --rw=randread --bs=4k --size=64m \
         --iodepth=16 --numjobs=4 --runtime=5 --time_based --group_reporting \
         --output-format=terse | cat
elif (( REAL_MFS == 1 )); then
  echo "(fio not found; skipping advanced random read)"
  for i in $(seq 1 200); do
    offset=$(( (RANDOM * 12345 + i*4096) % (TESTSIZE_MB*1024*1024 - 8192) ))
    dd if="$TESTFILE" of=/dev/null bs=4k count=1 skip=$((offset/4096)) status=none 2>/dev/null || true
  done
else
  echo "Local smoke: skipping I/O heavy random."
fi

echo
echo "Write (append) timing to exercise writedata workers / MAX_SIM_CHUNKS..."
if (( REAL_MFS == 1 )); then
  time $DD if=/dev/zero of="$TESTFILE" bs=1M count=64 conv=notrunc oflag=append status=none 2>&1 | cat
  sync
fi

echo
echo "=== Benchmark complete ==="
echo "Re-run with a real high-performance MooseFS mount + many cores/NVMe/CSes"
echo "to observe the benefit of the raised readahead + worker pool tunables."
echo "Remember: after edit + this benchmark, run 'make -C mfstests check' before commit."
