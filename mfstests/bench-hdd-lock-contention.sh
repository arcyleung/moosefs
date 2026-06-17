#!/bin/bash
#
# bench-hdd-lock-contention.sh
# Benchmark / stress for the hddspacemgr sharded hashlock refactor
# (plan: Excessive Fine-Grained but Contended Locking in hddspacemgr.c).
#
# The key perf win is reducing contention on the single hashlock that
# protects the 16M-slot chunk hashtab. With 64 shards, independent chunks
# rarely serialize on the same lock word even under hundreds of concurrent
# client reads/writes + internal rebalance/test jobs.
#
# Practical usage (requires a running test chunkserver with a temp hdd dir):
#   # start a chunkserver on a tmp dir with -- some test hdd
#   MFS_CS_TEST_DIR=/tmp/cs-hdd ./mfstests/bench-hdd-lock-contention.sh
#
# Or just run it to see the documented recommendations + current shard count.
#
set -euo pipefail

echo "=== MooseFS Chunkserver HDD Lock Contention Benchmark ==="
echo "Shard count compiled in: (grep HASHLOCK_SHARD_COUNT mfschunkserver/hddspacemgr.c)"
grep -o 'HASHLOCK_SHARD_COUNT [0-9]*' mfschunkserver/hddspacemgr.c || echo " (see source)"
echo
echo "To measure: use a dedicated test chunkserver + parallel fio or"
echo "many 'mfschunktool' or custom writers against different chunkids."
echo "Watch for reduced 'lock' time in perf or /proc/lock_stat before/after."
echo "Recommended stress (example):"
echo "  for i in {1..64}; do (fio --name=randrw --filename=/mnt/mfs/testfile$i --rw=randrw --bs=64k --size=1g --numjobs=4 --iodepth=8 --runtime=30 --time_based &) ; done; wait"
echo
echo "After sharded migration of the hot lock sites (read/write_block etc.),"
echo "this workload should show higher aggregate IOPS and lower lock wait %."
