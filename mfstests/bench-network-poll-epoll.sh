#!/bin/bash
#
# bench-network-poll-epoll.sh
# Benchmark for the networking layer poll->epoll refactor
# (plan: Networking Layer: poll() Scalability and Per-Packet Overhead).
#
# Specific functionality: the central pollfd building + poll() wait used by
# all *serv (matoclserv, mainserv on CS, client mastercomm, etc.).
# The O(N) scan hurts when thousands of clients or chunkservers are connected.
#
# This script documents the current state (epollfd reserved in main.c) and
# gives a way to measure connection scale / latency under many fds.
#
# Example (run on a test master with thousands of simulated clients or use
# netperf/wrk like tools + many mfsmounts):
#   MFS_MASTER=127.0.0.1:9421 ./mfstests/bench-network-poll-epoll.sh
#
set -euo pipefail

echo "=== MooseFS Networking poll/epoll scalability benchmark ==="
echo "Epoll support skeleton added in main.c (see epollfd)."
echo "Current implementation still uses poll(2) from sockets + per-module desc()."
echo "Recommended measurement:"
echo "  - Use 'ss -s' or 'netstat' + many netcat or custom clients to master/cs port."
echo "  - perf record -e 'syscalls:sys_enter_poll' -a sleep 10 while under load."
echo "  - After full epoll migration expect much better scaling past ~4k fds and"
echo "    lower CPU in the event loop for sparse activity."
echo
echo "Per-packet overhead is also visible in matoclserv_create_packet etc.;"
echo "the epoll change mainly attacks the fd scalability part of the plan item."
