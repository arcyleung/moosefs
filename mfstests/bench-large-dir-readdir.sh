#!/bin/bash
#
# bench-large-dir-readdir.sh
# Benchmark for MooseFS large directory performance refactor
# (plan item 4: Directory Children as Linked Lists + Chained Hash Lookups).
#
# Specific functionality tested:
#   - fsnode ddata.children + childrentail (append instead of prepend)
#   - readdir walking the list (fsnodes_readdir* family)
#   - name lookup still via global edge hash (fast path unchanged)
#
# The change makes append O(1) and returns entries in creation order,
# which helps cache behavior and usability for large dirs (logs, object
# buckets, build dirs, maildirs with 100k+ entries).
#
# Run against a real mount with a large dir for numbers:
#   mkdir -p /mnt/mfs/benchdir
#   MFS_LARGE_DIR=/mnt/mfs/benchdir ./mfstests/bench-large-dir-readdir.sh
#
set -euo pipefail

LDIR="${MFS_LARGE_DIR:-}"
NFILES="${NFILES:-20000}"   # 20k is already painful for pure list walks on slow impls; scale up for real measurement

echo "=== MooseFS Large Directory Readdir Benchmark ==="
echo "This exercises the children list + tail append optimization."
echo

if [[ -z "$LDIR" || ! -d "$LDIR" ]]; then
  echo "MFS_LARGE_DIR not set to a writable dir on a MooseFS mount."
  echo "Example: MFS_LARGE_DIR=/mnt/mfs/largebench $0"
  echo "Falling back to local /tmp simulation (list maintenance only, no real FS cost)."
  LDIR=$(mktemp -d /tmp/mfs-large-dir-bench-XXXX)
  SIM=1
else
  SIM=0
fi

echo "Target dir: $LDIR"
echo "Creating $NFILES files (this may take a while)..."

START=$(date +%s)
for i in $(seq -w 1 $NFILES); do
  touch "$LDIR/file-$i"
done
END=$(date +%s)
echo "Create time: $((END-START))s"

echo
echo "Timing full readdir (ls -1 or find)..."
if (( SIM == 0 )); then
  time ls -1 "$LDIR" > /dev/null
  time find "$LDIR" -maxdepth 1 -type f | wc -l
else
  echo "(simulation - skipping expensive ls)"
fi

echo
echo "Name lookup timing (many random lookups inside the large dir)..."
# This hits fsnodes_edge_find (global hash + short chain) — already fast.
python3 - "$LDIR" "$NFILES" << 'PY'
import os, sys, time, random
d, n = sys.argv[1], int(sys.argv[2])
names = [f"file-{i:05d}" for i in range(1, n+1)]
random.shuffle(names)
t0 = time.time()
hits = 0
for nm in names[:2000]:
    try:
        os.stat(os.path.join(d, nm))
        hits += 1
    except OSError:
        pass
dt = time.time() - t0
print(f"2000 random name lookups: {dt:.3f}s ({hits} hits)")
PY

echo
echo "Cleanup..."
if (( SIM == 1 )); then
  rm -rf "$LDIR"
else
  # do not auto-rm a real user dir; user can rm -rf after
  echo "(left $LDIR in place; rm -rf it when finished)"
fi

echo "Done. Re-run with bigger NFILES and a real fast master+CS to see readdir scaling improvement from the tail-append change."
