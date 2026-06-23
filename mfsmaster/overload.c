/*
 * Copyright (C) 2025 Jakub Kruszona-Zawadzki, Saglabs SA
 *
 * Master overload detection and admission control.
 *
 * Correctness invariant: this module never mutates filesystem/chunk/session
 * state. It only classifies load and gates whether matoclserv should process,
 * defer, or reject a packet. All callers remain on the main thread.
 */

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include <string.h>
#include <stdlib.h>

#include "overload.h"
#include "reqclass.h"
#include "cfg.h"
#include "main.h"
#include "mfslog.h"
#include "clocks.h"
#include "massert.h"

/* Config (reloaded) */
static uint8_t cfg_admission = 0;
static uint8_t cfg_shadow = 0;
static uint32_t cfg_elevated_us = 3000;      /* loop > 3ms → elevated */
static uint32_t cfg_overloaded_us = 8000;    /* loop > 8ms → overloaded */
static uint32_t cfg_critical_us = 15000;     /* loop > 15ms → critical */
static uint32_t cfg_hysteresis_s = 5;
static uint32_t cfg_p2_max_defer_ms = 200;
static uint32_t cfg_p3_max_defer_ms = 50;
static uint32_t cfg_p2_budget_us_normal = 0;      /* 0 = unlimited */
static uint32_t cfg_p2_budget_us_overloaded = 30000;
static uint32_t cfg_p3_budget_us_elevated = 5000;
static uint32_t cfg_p3_budget_us_overloaded = 1000;

/* Runtime state */
static uint8_t level = OL_NORMAL;
static uint32_t level_entered_s = 0;
static uint64_t last_loop_us = 0;
static uint64_t max_loop_us = 0;
static double loop_mark_start = 0.0;

/* Per-serve-pass work accounting */
static uint64_t serve_p2_us = 0;
static uint64_t serve_p3_us = 0;

/* Counters */
static uint64_t ctr_deferred = 0;
static uint64_t ctr_rejected = 0;
static uint64_t ctr_shadow_deferred = 0;
static uint64_t ctr_shadow_rejected = 0;
static uint64_t ctr_processed = 0;
static uint32_t level_seconds[4] = {0,0,0,0};
static uint32_t level_sec_tick = 0;

/* Smooth loop-time EMA (microseconds) */
static uint64_t loop_ema_us = 0;

static void overload_apply_config(void) {
	cfg_admission = cfg_getuint32("MASTER_ADMISSION_CONTROL", 0) ? 1 : 0;
	cfg_shadow = cfg_getuint32("MASTER_ADMISSION_SHADOW", 0) ? 1 : 0;
	cfg_elevated_us = cfg_getuint32("MASTER_OVERLOAD_ELEVATED_US", 3000);
	cfg_overloaded_us = cfg_getuint32("MASTER_OVERLOAD_OVERLOADED_US", 8000);
	cfg_critical_us = cfg_getuint32("MASTER_OVERLOAD_CRITICAL_US", 15000);
	cfg_hysteresis_s = cfg_getuint32("MASTER_OVERLOAD_HYSTERESIS_SECONDS", 5);
	if (cfg_hysteresis_s < 1) {
		cfg_hysteresis_s = 1;
	}
	cfg_p2_max_defer_ms = cfg_getuint32("MASTER_ADMISSION_P2_MAX_DEFER_MS", 200);
	cfg_p3_max_defer_ms = cfg_getuint32("MASTER_ADMISSION_P3_MAX_DEFER_MS", 50);
	cfg_p2_budget_us_normal = cfg_getuint32("MASTER_ADMISSION_P2_BUDGET_US_NORMAL", 0);
	cfg_p2_budget_us_overloaded = cfg_getuint32("MASTER_ADMISSION_P2_BUDGET_US_OVERLOADED", 30000);
	cfg_p3_budget_us_elevated = cfg_getuint32("MASTER_ADMISSION_P3_BUDGET_US_ELEVATED", 5000);
	cfg_p3_budget_us_overloaded = cfg_getuint32("MASTER_ADMISSION_P3_BUDGET_US_OVERLOADED", 1000);
}

static const char* overload_level_name(uint8_t l) {
	switch (l) {
		case OL_NORMAL: return "NORMAL";
		case OL_ELEVATED: return "ELEVATED";
		case OL_OVERLOADED: return "OVERLOADED";
		case OL_CRITICAL: return "CRITICAL";
		default: return "?";
	}
}

static void overload_set_level(uint8_t new_level) {
	if (new_level == level) {
		return;
	}
	if (new_level > level) {
		/* escalate immediately */
		mfs_log(MFSLOG_SYSLOG, MFSLOG_NOTICE,
			"master overload: %s -> %s (loop_ema=%"PRIu64" us, last_loop=%"PRIu64" us)",
			overload_level_name(level), overload_level_name(new_level),
			loop_ema_us, last_loop_us);
		level = new_level;
		level_entered_s = main_time();
	} else {
		/* de-escalate only after hysteresis */
		if (main_time() >= level_entered_s + cfg_hysteresis_s) {
			mfs_log(MFSLOG_SYSLOG, MFSLOG_NOTICE,
				"master overload: %s -> %s (loop_ema=%"PRIu64" us, last_loop=%"PRIu64" us)",
				overload_level_name(level), overload_level_name(new_level),
				loop_ema_us, last_loop_us);
			level = new_level;
			level_entered_s = main_time();
		}
	}
}

static void overload_recompute_level(void) {
	uint8_t target = OL_NORMAL;
	uint64_t sample = loop_ema_us;
	if (last_loop_us > sample) {
		sample = last_loop_us;
	}
	if (sample >= cfg_critical_us) {
		target = OL_CRITICAL;
	} else if (sample >= cfg_overloaded_us) {
		target = OL_OVERLOADED;
	} else if (sample >= cfg_elevated_us) {
		target = OL_ELEVATED;
	}
	overload_set_level(target);
}

int overload_init(void) {
	overload_apply_config();
	level = OL_NORMAL;
	level_entered_s = main_time();
	loop_mark_start = 0.0;
	main_eachloop_register(overload_tick);
	main_reload_register(overload_reload);
	main_info_register(overload_info);
	main_destruct_register(overload_term);
	return 0;
}

void overload_reload(void) {
	overload_apply_config();
}

void overload_term(void) {
	/* nothing to free */
}

void overload_tick(void) {
	double now;
	uint64_t loop_us;
	uint32_t tnow;

	now = monotonic_seconds();
	if (loop_mark_start > 0.0) {
		loop_us = (uint64_t)((now - loop_mark_start) * 1000000.0);
		last_loop_us = loop_us;
		if (loop_us > max_loop_us) {
			max_loop_us = loop_us;
		}
		/* EMA: alpha ~ 1/8 */
		if (loop_ema_us == 0) {
			loop_ema_us = loop_us;
		} else {
			loop_ema_us = (loop_ema_us * 7 + loop_us) / 8;
		}
		overload_recompute_level();
	}
	loop_mark_start = now;

	/* Accumulate seconds spent at each level (for info/metrics) */
	tnow = main_time();
	if (tnow != level_sec_tick) {
		if (level_sec_tick != 0 && level < 4) {
			level_seconds[level]++;
		}
		level_sec_tick = tnow;
	}
}

void overload_account_serve_us(const char *sname, uint64_t us) {
	(void)sname;
	(void)us;
	/* Reserved for per-module charts in a follow-up; loop EMA is primary signal. */
}

void overload_account_client_work_us(uint8_t prio, uint64_t us) {
	if (prio == REQPRIO_P2) {
		serve_p2_us += us;
	} else if (prio == REQPRIO_P3) {
		serve_p3_us += us;
	}
	ctr_processed++;
}

uint8_t overload_level(void) {
	return level;
}

int overload_admission_enabled(void) {
	return cfg_admission;
}

int overload_admission_shadow(void) {
	return cfg_shadow;
}

void overload_serve_budget_reset(void) {
	serve_p2_us = 0;
	serve_p3_us = 0;
}

int overload_serve_budget_exhausted(uint8_t prio) {
	uint32_t budget;

	if (prio <= REQPRIO_P1) {
		return 0;
	}
	if (prio == REQPRIO_P2) {
		if (level >= OL_OVERLOADED) {
			budget = cfg_p2_budget_us_overloaded;
		} else {
			budget = cfg_p2_budget_us_normal;
		}
		if (budget == 0) {
			return 0;
		}
		return (serve_p2_us >= budget) ? 1 : 0;
	}
	/* P3 */
	if (level >= OL_OVERLOADED) {
		budget = cfg_p3_budget_us_overloaded;
	} else if (level >= OL_ELEVATED) {
		budget = cfg_p3_budget_us_elevated;
	} else {
		return 0;
	}
	if (budget == 0) {
		return 0;
	}
	return (serve_p3_us >= budget) ? 1 : 0;
}

static int overload_decide(uint8_t prio, int may_reject, uint32_t defer_ms) {
	uint32_t max_defer;

	/* P0/P1 always process */
	if (prio <= REQPRIO_P1) {
		return OA_PROCESS;
	}

	/* No pressure → process */
	if (level == OL_NORMAL && !overload_serve_budget_exhausted(prio)) {
		return OA_PROCESS;
	}

	/* Budget gate */
	if (overload_serve_budget_exhausted(prio)) {
		if (prio == REQPRIO_P3) {
			if (may_reject) {
				return OA_REJECT;
			}
			return OA_DEFER;
		}
		/* P2 */
		if (level >= OL_OVERLOADED) {
			if (may_reject && defer_ms >= cfg_p2_max_defer_ms) {
				return OA_REJECT;
			}
			return OA_DEFER;
		}
	}

	/* Level-based policy */
	if (prio == REQPRIO_P3) {
		if (level >= OL_ELEVATED) {
			max_defer = cfg_p3_max_defer_ms;
			if (may_reject && defer_ms >= max_defer) {
				return OA_REJECT;
			}
			return OA_DEFER;
		}
		return OA_PROCESS;
	}

	/* P2 */
	if (level >= OL_CRITICAL) {
		if (may_reject && defer_ms >= cfg_p2_max_defer_ms) {
			return OA_REJECT;
		}
		return OA_DEFER;
	}
	if (level >= OL_OVERLOADED) {
		/* Prefer defer; reject only idempotent ops after max defer */
		if (may_reject && defer_ms >= cfg_p2_max_defer_ms) {
			return OA_REJECT;
		}
		if (!may_reject) {
			/* Non-idempotent: defer only, never reject */
			return OA_DEFER;
		}
		/* Idempotent under overload but not yet at max defer: still process
		 * some work so we make progress; budget gate handles fairness. */
		return OA_PROCESS;
	}
	if (level >= OL_ELEVATED && prio == REQPRIO_P3) {
		return OA_DEFER;
	}
	return OA_PROCESS;
}

int overload_admit_client(uint8_t prio, int may_reject, uint32_t defer_ms) {
	int action;

	/* Admission disabled and not shadowing: always process */
	if (!cfg_admission && !cfg_shadow) {
		return OA_PROCESS;
	}

	action = overload_decide(prio, may_reject, defer_ms);

	if (cfg_shadow && !cfg_admission) {
		if (action == OA_DEFER) {
			ctr_shadow_deferred++;
		} else if (action == OA_REJECT) {
			ctr_shadow_rejected++;
		}
		return OA_PROCESS; /* shadow never acts */
	}

	if (!cfg_admission) {
		return OA_PROCESS;
	}

	if (action == OA_DEFER) {
		ctr_deferred++;
	} else if (action == OA_REJECT) {
		ctr_rejected++;
	}
	return action;
}

void overload_info(FILE *fd) {
	fprintf(fd, "master_overload_level: %s (%u)\n", overload_level_name(level), (unsigned)level);
	fprintf(fd, "master_overload_loop_ema_us: %"PRIu64"\n", loop_ema_us);
	fprintf(fd, "master_overload_loop_last_us: %"PRIu64"\n", last_loop_us);
	fprintf(fd, "master_overload_loop_max_us: %"PRIu64"\n", max_loop_us);
	fprintf(fd, "master_admission_control: %u\n", (unsigned)cfg_admission);
	fprintf(fd, "master_admission_shadow: %u\n", (unsigned)cfg_shadow);
	fprintf(fd, "master_admission_deferred: %"PRIu64"\n", ctr_deferred);
	fprintf(fd, "master_admission_rejected: %"PRIu64"\n", ctr_rejected);
	fprintf(fd, "master_admission_shadow_deferred: %"PRIu64"\n", ctr_shadow_deferred);
	fprintf(fd, "master_admission_shadow_rejected: %"PRIu64"\n", ctr_shadow_rejected);
	fprintf(fd, "master_admission_processed: %"PRIu64"\n", ctr_processed);
	fprintf(fd, "master_overload_seconds_normal: %u\n", level_seconds[OL_NORMAL]);
	fprintf(fd, "master_overload_seconds_elevated: %u\n", level_seconds[OL_ELEVATED]);
	fprintf(fd, "master_overload_seconds_overloaded: %u\n", level_seconds[OL_OVERLOADED]);
	fprintf(fd, "master_overload_seconds_critical: %u\n", level_seconds[OL_CRITICAL]);
}

uint64_t overload_stat_deferred(void) { return ctr_deferred; }
uint64_t overload_stat_rejected(void) { return ctr_rejected; }
uint64_t overload_stat_shadow_deferred(void) { return ctr_shadow_deferred; }
uint64_t overload_stat_shadow_rejected(void) { return ctr_shadow_rejected; }
uint64_t overload_stat_loop_us_max(void) { return max_loop_us; }
uint32_t overload_stat_level_seconds(uint8_t l) {
	return (l < 4) ? level_seconds[l] : 0;
}
