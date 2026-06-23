/*
 * Copyright (C) 2025 Jakub Kruszona-Zawadzki, Saglabs SA
 *
 * Master overload detection, admission control, and loop timing stats.
 */

#ifndef _OVERLOAD_H_
#define _OVERLOAD_H_

#include <inttypes.h>
#include <stdio.h>

/* Overload levels (monotonic severity) */
#define OL_NORMAL     0
#define OL_ELEVATED   1
#define OL_OVERLOADED 2
#define OL_CRITICAL   3

/* Admission action for one packet */
#define OA_PROCESS  0
#define OA_DEFER    1
#define OA_REJECT   2

int overload_init(void);
void overload_reload(void);
void overload_term(void);

/* Called once at the start of each mainloop iteration (via eachloop). */
void overload_tick(void);

/* Record serve duration for a poll module (microseconds). */
void overload_account_serve_us(const char *sname, uint64_t us);

/* Record that one client packet of given priority was processed (us spent). */
void overload_account_client_work_us(uint8_t prio, uint64_t us);

/* Current overload level (0..3). */
uint8_t overload_level(void);

/* Config: is admission control enabled? */
int overload_admission_enabled(void);

/* Config: shadow mode — compute admit/defer/reject but never act. */
int overload_admission_shadow(void);

/* Decide what to do with a client packet.
 * prio: REQPRIO_P*
 * may_reject: from reqclass_may_reject_eagain()
 * defer_ms: how long this packet has been waiting (0 if unknown)
 * Returns OA_PROCESS / OA_DEFER / OA_REJECT.
 */
int overload_admit_client(uint8_t prio, int may_reject, uint32_t defer_ms);

/* Work-budget gate for this serve pass (reset each matoclserv_serve). */
void overload_serve_budget_reset(void);
int overload_serve_budget_exhausted(uint8_t prio);

/* Counters for observability / info dump */
void overload_info(FILE *fd);

/* Stats accessors for charts / tests */
uint64_t overload_stat_deferred(void);
uint64_t overload_stat_rejected(void);
uint64_t overload_stat_shadow_deferred(void);
uint64_t overload_stat_shadow_rejected(void);
uint64_t overload_stat_loop_us_max(void);
uint32_t overload_stat_level_seconds(uint8_t level);

#endif
