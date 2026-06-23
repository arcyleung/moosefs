/*
 * Copyright (C) 2025 Jakub Kruszona-Zawadzki, Saglabs SA
 *
 * MooseFS master request priority classification (performance enhancements).
 */

#ifndef _REQCLASS_H_
#define _REQCLASS_H_

#include <inttypes.h>

/* Priority classes for master admission / prioritization */
#define REQPRIO_P0  0  /* keepalive / internal critical — never shed */
#define REQPRIO_P1  1  /* in-flight completion critical */
#define REQPRIO_P2  2  /* normal FUSE metadata R/W */
#define REQPRIO_P3  3  /* admin / charts / diagnostics */

/* Classify a client (matocl) packet type. Unknown types default to P2. */
uint8_t reqclass_matocl_prio(uint32_t type);

/* True if opcode may safely receive MFS_ERROR_EAGAIN under admission control
 * (idempotent reads only). Non-idempotent mutations must defer-only. */
int reqclass_may_reject_eagain(uint32_t type);

/* Map CLTOMA/CLTOAN request type to MATOCL/ANTOAN status-only reply type.
 * Returns 0 if no simple status reply is defined (must defer-only). */
uint32_t reqclass_status_reply_type(uint32_t request_type);

#endif
