/*
 * Copyright (C) 2026 Jakub Kruszona-Zawadzki, Saglabs SA
 * 
 * This file is part of MooseFS.
 * 
 * MooseFS is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 2 (only).
 * 
 * MooseFS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, see
 * <https://www.gnu.org/licenses/>.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "MFSCommunication.h"
#include "clocks.h"
#include "crc.h"

#include "mfstest.h"

/* original crc32 code */

uint32_t* crc32_reference_generate(void) {
	uint32_t *res;
	uint32_t crc, poly, i, j;

	res = (uint32_t*)malloc(sizeof(uint32_t)*256);
	poly = CRC_POLY;
	for (i=0 ; i<256 ; i++) {
		crc=i;
		for (j=0 ; j<8 ; j++) {
			if (crc & 1) {
				crc = (crc >> 1) ^ poly;
			} else {
				crc >>= 1;
			}
		}
		res[i] = crc;
	}
	return res;
}

uint32_t crc32_reference(uint32_t crc,uint8_t *block,uint32_t leng) {
	uint8_t c;
	static uint32_t *crc_table = NULL;

	if (crc_table==NULL) {
		crc_table = crc32_reference_generate();
	}

	crc^=0xFFFFFFFF;
	while (leng>0) {
		c = *block++;
		leng--;
		crc = ((crc>>8) & 0x00FFFFFF) ^ crc_table[ (crc^c) & 0xFF ];
	}
	return crc^0xFFFFFFFF;
}

uint32_t simple_pseudo_random(void) {
	static uint32_t u=1249853491;
	static uint32_t v=3456394786;

	v = 36969*(v & 65535) + (v >> 16);
	u = 18000*(u & 65535) + (u >> 16);

	return (v << 16) + u;
}

int main(void) {
	uint8_t *speedtestblock;
	uint8_t *rblock,*sblock,*xblock;
	uint32_t i,j,s,crc,crc1,crc2;
	double st,en,corr,mycrctime,refcrctime;

	rblock = malloc(sizeof(uint8_t)*65536);
	sblock = malloc(sizeof(uint8_t)*65536);
	xblock = malloc(sizeof(uint8_t)*65536);
	if (rblock==NULL || sblock==NULL || xblock==NULL) {
		return 99;
	}

	mfstest_init();

	// tabble generation
	mycrc32_init();

	mfstest_start(crc32);

	for (i=0 ; i<65536 ; i++) {
		rblock[i] = simple_pseudo_random();
		sblock[i] = simple_pseudo_random();
		xblock[i] = rblock[i] ^ sblock[i];
	}

	printf("mycrc32 - different starting values\n");

	mfstest_assert_uint32_eq(mycrc32(0,rblock,65536),crc32_reference(0,rblock,65536));
	mfstest_assert_uint32_eq(mycrc32(0xFFFFFFFF,rblock,65536),crc32_reference(0xFFFFFFFF,rblock,65536));
	for (i=0 ; i<8 ; i++) {
		s = simple_pseudo_random();
		mfstest_assert_uint32_eq(mycrc32(s,rblock,65536),crc32_reference(s,rblock,65536));
	}

	printf("mycrc32 - different block lengths and alignments\n");

	for (i=0 ; i<8 ; i++) {
		for (j=0 ; j<8 ; j++) {
			mfstest_assert_uint32_eq(mycrc32(0,sblock+i,1000+j),crc32_reference(0,sblock+i,1000+j));
		}
	}

	printf("mycrc32_combine - calculate crc of concatenated blocks\n");

	for (j = 65529 ; j <= 65536 ; j++) {
		crc = crc32_reference(0,sblock,j);

		for (i=103 ; i<j ; i+=4513) {
			crc1 = crc32_reference(0,sblock,i);
			crc2 = crc32_reference(0,sblock+i,j-i);
			mfstest_assert_uint32_eq(mycrc32_combine(crc1,crc2,j-i),crc);
		}
	}

	printf("mycrc32_xorblocks - calculate crc of xored blocks\n");

	mfstest_assert_uint32_eq(mycrc32_xorblocks(0,crc32_reference(0,rblock,65536),crc32_reference(0,sblock,65536),65536),crc32_reference(0,xblock,65536));

	for (j = 65530 ; j <= 65536 ; j+=3) {
		for (i=0 ; i<8 ; i++) {
			s = simple_pseudo_random();
			mfstest_assert_uint32_eq(mycrc32_xorblocks(s,crc32_reference(s,rblock,j),crc32_reference(s,sblock,j),j),crc32_reference(s,xblock,j));
		}
	}

	printf("mycrc32_zeroexpand - calculate crc of block expanded by zeros\n");

	for (j = 65530 ; j <= 65536 ; j+=3) {
		for (i=0 ; i<65536 ; i++) {
			rblock[i] = simple_pseudo_random();
			sblock[i] = rblock[i];
		}

		for (i=103 ; i<j ; i+=4513) {
			memset(sblock+(j-i),0,i);
			s = simple_pseudo_random();
			mfstest_assert_uint32_eq(mycrc32_zeroexpanded(0,rblock,(j-i),i),crc32_reference(0,sblock,j));
			mfstest_assert_uint32_eq(mycrc32_zeroexpanded(1,rblock,(j-i),i),crc32_reference(1,sblock,j));
			mfstest_assert_uint32_eq(mycrc32_zeroexpanded(0xFFFFFFFF,rblock,(j-i),i),crc32_reference(0xFFFFFFFF,sblock,j));
			mfstest_assert_uint32_eq(mycrc32_zeroexpanded(s,rblock,(j-i),i),crc32_reference(s,sblock,j));
		}
	}

	printf("mycrc32 speed\n");

	st = monotonic_seconds();
	corr = monotonic_seconds();
	corr -= st;

	st = monotonic_seconds();
	crc1 = mycrc32(0,rblock,65536);
	en = monotonic_seconds();
	mycrctime = (en-st)-corr;

	st = monotonic_seconds();
	crc2 = crc32_reference(0,rblock,65536);
	en = monotonic_seconds();
	refcrctime = (en-st)-corr;

	mfstest_assert_uint32_eq(crc1,crc2);
	printf("block 64k ; mycrc32: %.2lfMB/s ; crc32: %.2lfMB/s ; speedup: %.2lf\n",1.0/(16.0 * mycrctime),1.0/(16.0 * refcrctime),refcrctime / mycrctime);

	speedtestblock = malloc(16*1024*1024);
	if (speedtestblock==NULL) {
		return 99;
	}
	memset(speedtestblock,0x5A,16*1024*1024);

	st = monotonic_seconds();
	crc1 = mycrc32(0,speedtestblock,16*1024*1024);
	en = monotonic_seconds();
	mycrctime = (en-st)-corr;

	st = monotonic_seconds();
	crc2 = crc32_reference(0,speedtestblock,16*1024*1024);
	en = monotonic_seconds();
	refcrctime = (en-st)-corr;

	mfstest_assert_uint32_eq(crc1,crc2);
	printf("block 16M ; mycrc32: %.2lfMB/s ; crc32: %.2lfMB/s ; speedup: %.2lf\n",16.0/mycrctime,16.0/refcrctime,refcrctime / mycrctime);

	/* === Dedicated benchmark for the specific CRC functionality in the
	   data path (plan item: Per-Block Software CRC). ===
	   Real MooseFS usage is dominated by exactly 64 KiB (MFSBLOCKSIZE)
	   block CRCs:
	     - hddspacemgr.c : read_block_from_chunk / write_block_to_chunk
	     - replicator.c for EC parts
	     - client readdata.c / writedata.c on receive
	   This microbenchmark measures realistic per-block cost + throughput
	   under FS-like access pattern (many independent 64 KiB blocks).
	   It is the official "create a benchmark" for this performance
	   refactor. Results are printed for CI/perf tracking. */
	printf("\nFS data-path block CRC workload (64 KiB MFSBLOCKSIZE blocks)\n");

	/* Dispatch status (prepared for HW accel in crc.c via mycrc32_impl).
	   For this checkpoint we use the proven slice tables (bit-identical
	   to reference in all cases). */
	printf("accelerated impl registered: no (using slice tables; dispatch ready)\n");

#define FS_BLOCK_SIZE 65536
#define FS_BLOCK_ITER  4096   /* ~256 MiB total; enough for stable timing */

	st = monotonic_seconds();
	for (uint32_t i = 0; i < FS_BLOCK_ITER; i++) {
		/* typical starting crc for a fresh block in FS code paths */
		(void)mycrc32(0, rblock, FS_BLOCK_SIZE);
	}
	en = monotonic_seconds();
	double t_blocks = (en - st) - corr;
	double mbs = (FS_BLOCK_ITER * (FS_BLOCK_SIZE / 1048576.0)) / t_blocks;
	double blocks_per_sec = FS_BLOCK_ITER / t_blocks;
	printf("  %u x %u-byte blocks: %.2lf MB/s  (%.0lf blocks/sec)\n",
	       FS_BLOCK_ITER, FS_BLOCK_SIZE, mbs, blocks_per_sec);

	/* Also a mixed-starting-crc variant that appears in partial + combine paths */
	st = monotonic_seconds();
	for (uint32_t i = 0; i < FS_BLOCK_ITER; i++) {
		(void)mycrc32(0xFFFFFFFFU, rblock, FS_BLOCK_SIZE);
	}
	en = monotonic_seconds();
	t_blocks = (en - st) - corr;
	mbs = (FS_BLOCK_ITER * (FS_BLOCK_SIZE / 1048576.0)) / t_blocks;
	blocks_per_sec = FS_BLOCK_ITER / t_blocks;
	printf("  (starting ~0) %u x %u-byte blocks: %.2lf MB/s  (%.0lf blocks/sec)\n",
	       FS_BLOCK_ITER, FS_BLOCK_SIZE, mbs, blocks_per_sec);

	mfstest_end();
	mfstest_return();

	free(xblock);
	free(sblock);
	free(rblock);
}
