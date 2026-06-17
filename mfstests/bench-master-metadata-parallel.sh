#!/bin/bash
#
# bench-master-metadata-parallel.sh
# Benchmark for the master single-threaded metadata event loop refactor
# (plan item: Single-Threaded Metadata Event Loop (Master Bottleneck)).
#
# Specific functionality: the matoclserv_serve + direct fs_* calls for
# lookup/getattr/readdir/create etc. Everything is serialized today.
#
# This script documents the readonly_workers_enabled hook added in
# matoclserv.c and gives guidance for measuring metadata QPS scaling.
#
# Real measurement requires a master + many parallel clients doing
# non-mutating ops (mfsmount + find / ls -lR in many shells, or a
# custom multi-threaded lookup tool using libmfsio).
# Suggested:
#   for i in {1..32}; do (find /mnt/mfs/some/deep/tree -type f | wc -l &) ; done
# Watch single core usage of mfsmaster and latency histograms.
#
# When workers are enabled for read-only, expect the master to use more
# cores and higher aggregate ops/sec with lower p99 latency under load.
set -euo pipefail
echo "=== MooseFS Master Metadata Parallelism Benchmark ==="
echo "readonly_workers_enabled hook present in matoclserv (currently 0)."
echo "See matoclserv.c and the plan for the phased approach:"
echo "  1. offload read-only (lookup,getattr,readdir,statfs...) to pool"
echo "  2. keep mutations on main serializer for changelog ordering"
echo "  3. add fine-grained or RCU locking inside filesystem.c later"
echo
echo "After full impl, re-run with high client concurrency to record before/after."
