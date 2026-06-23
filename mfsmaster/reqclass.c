/*
 * Copyright (C) 2025 Jakub Kruszona-Zawadzki, Saglabs SA
 *
 * MooseFS master request priority classification.
 */

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include "reqclass.h"
#include "MFSCommunication.h"

uint8_t reqclass_matocl_prio(uint32_t type) {
	switch (type) {
		case ANTOAN_NOP:
		case ANTOAN_UNKNOWN_COMMAND:
		case ANTOAN_BAD_COMMAND_SIZE:
			return REQPRIO_P0;

		/* In-flight completion / lock wakeups — prefer over new work */
		case CLTOMA_FUSE_WRITE_CHUNK_END:
		case CLTOMA_FUSE_FSYNC:
		case CLTOMA_FUSE_TRUNCATE:
		case CLTOMA_FUSE_FLOCK:
		case CLTOMA_FUSE_POSIX_LOCK:
			return REQPRIO_P1;

		/* Heavy / admin / charts — lowest priority */
		case CLTOAN_CHART:
		case CLTOAN_CHART_DATA:
		case CLTOAN_MONOTONIC_DATA:
		case CLTOMA_INFO:
		case CLTOMA_MEMORY_INFO:
		case CLTOMA_CSERV_LIST:
		case CLTOMA_SESSION_LIST:
		case CLTOMA_CHUNKS_MATRIX:
		case CLTOMA_CHUNKSTEST_INFO:
		case CLTOMA_FSTEST_INFO:
		case CLTOMA_QUOTA_INFO:
		case CLTOMA_EXPORTS_INFO:
		case CLTOMA_MLOG_LIST:
		case CLTOMA_LIST_OPEN_FILES:
		case CLTOMA_LIST_ACQUIRED_LOCKS:
		case CLTOMA_MASS_RESOLVE_PATHS:
		case CLTOMA_SCLASS_INFO:
		case CLTOMA_PATTERN_INFO:
		case CLTOMA_MISSING_CHUNKS:
		case CLTOMA_NODE_INFO:
		case CLTOMA_FULL_DIRECTORY_DATA:
		case CLTOMA_SET_ALL_NODE_ATTRIBUTES:
		case CLTOMA_FUSE_SNAPSHOT:
		case CLTOMA_FUSE_REPAIR:
		case CLTOMA_FUSE_QUOTACONTROL:
		case ANTOAN_GET_CONFIG:
		case ANTOAN_GET_CONFIG_FILE:
		case ANTOMA_SYSLOG:
			return REQPRIO_P3;

		/* Everything else is normal metadata R/W */
		default:
			return REQPRIO_P2;
	}
}

int reqclass_may_reject_eagain(uint32_t type) {
	/* Only pure-read / idempotent FUSE ops may be rejected with EAGAIN.
	 * Non-idempotent ops must defer (stay on input queue) only. */
	switch (type) {
		case CLTOMA_FUSE_LOOKUP:
		case CLTOMA_FUSE_GETATTR:
		case CLTOMA_FUSE_READLINK:
		case CLTOMA_FUSE_READDIR:
		case CLTOMA_FUSE_STATFS:
		case CLTOMA_FUSE_ACCESS:
		case CLTOMA_FUSE_GETXATTR:
		case CLTOMA_FUSE_GETFACL:
		case CLTOMA_FUSE_READ_CHUNK:
		case CLTOMA_PATH_LOOKUP:
		case CLTOAN_CHART:
		case CLTOAN_CHART_DATA:
		case CLTOAN_MONOTONIC_DATA:
		case CLTOMA_INFO:
		case CLTOMA_MEMORY_INFO:
		case CLTOMA_CSERV_LIST:
		case CLTOMA_SESSION_LIST:
		case CLTOMA_CHUNKS_MATRIX:
		case CLTOMA_CHUNKSTEST_INFO:
		case CLTOMA_FSTEST_INFO:
		case CLTOMA_QUOTA_INFO:
		case CLTOMA_EXPORTS_INFO:
		case CLTOMA_MLOG_LIST:
		case CLTOMA_LIST_OPEN_FILES:
		case CLTOMA_LIST_ACQUIRED_LOCKS:
		case CLTOMA_SCLASS_INFO:
		case CLTOMA_PATTERN_INFO:
		case CLTOMA_MISSING_CHUNKS:
		case CLTOMA_NODE_INFO:
			return 1;
		default:
			return 0;
	}
}

uint32_t reqclass_status_reply_type(uint32_t request_type) {
	/* Map request → reply opcode for 5-byte (msgid + status) error replies.
	 * Only opcodes with a standard MATOCL_FUSE_* / MATOCL_* status form. */
	switch (request_type) {
		case CLTOMA_FUSE_LOOKUP:       return MATOCL_FUSE_LOOKUP;
		case CLTOMA_FUSE_GETATTR:      return MATOCL_FUSE_GETATTR;
		case CLTOMA_FUSE_SETATTR:      return MATOCL_FUSE_SETATTR;
		case CLTOMA_FUSE_READLINK:     return MATOCL_FUSE_READLINK;
		case CLTOMA_FUSE_SYMLINK:      return MATOCL_FUSE_SYMLINK;
		case CLTOMA_FUSE_MKNOD:        return MATOCL_FUSE_MKNOD;
		case CLTOMA_FUSE_MKDIR:        return MATOCL_FUSE_MKDIR;
		case CLTOMA_FUSE_UNLINK:       return MATOCL_FUSE_UNLINK;
		case CLTOMA_FUSE_RMDIR:        return MATOCL_FUSE_RMDIR;
		case CLTOMA_FUSE_RENAME:       return MATOCL_FUSE_RENAME;
		case CLTOMA_FUSE_LINK:         return MATOCL_FUSE_LINK;
		case CLTOMA_FUSE_READDIR:      return MATOCL_FUSE_READDIR;
		case CLTOMA_FUSE_OPEN:         return MATOCL_FUSE_OPEN;
		case CLTOMA_FUSE_CREATE:       return MATOCL_FUSE_CREATE;
		case CLTOMA_FUSE_READ_CHUNK:   return MATOCL_FUSE_READ_CHUNK;
		case CLTOMA_FUSE_WRITE_CHUNK:  return MATOCL_FUSE_WRITE_CHUNK;
		case CLTOMA_FUSE_WRITE_CHUNK_END: return MATOCL_FUSE_WRITE_CHUNK_END;
		case CLTOMA_FUSE_TRUNCATE:     return MATOCL_FUSE_TRUNCATE;
		case CLTOMA_FUSE_FSYNC:        return MATOCL_FUSE_FSYNC;
		case CLTOMA_FUSE_STATFS:       return MATOCL_FUSE_STATFS;
		case CLTOMA_FUSE_ACCESS:       return MATOCL_FUSE_ACCESS;
		case CLTOMA_FUSE_SETXATTR:     return MATOCL_FUSE_SETXATTR;
		case CLTOMA_FUSE_GETXATTR:     return MATOCL_FUSE_GETXATTR;
		case CLTOMA_FUSE_SNAPSHOT:     return MATOCL_FUSE_SNAPSHOT;
		case CLTOMA_FUSE_REPAIR:       return MATOCL_FUSE_REPAIR;
		case CLTOMA_FUSE_FLOCK:        return MATOCL_FUSE_FLOCK;
		case CLTOMA_FUSE_POSIX_LOCK:   return MATOCL_FUSE_POSIX_LOCK;
		case CLTOMA_FUSE_GETFACL:      return MATOCL_FUSE_GETFACL;
		case CLTOMA_FUSE_SETFACL:      return MATOCL_FUSE_SETFACL;
		case CLTOMA_PATH_LOOKUP:       return MATOCL_PATH_LOOKUP;
		default:
			return 0; /* no simple status reply — defer only */
	}
}
