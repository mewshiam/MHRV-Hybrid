//! Best-effort file descriptor limit bump on Unix.
//!
//! Context (issue #8): on OpenWRT routers — and some minimal Alpine / BSD
//! installs — the default `RLIMIT_NOFILE` is so low (often 1024 or even
//! 512) that a browser's burst of ~30 parallel subresource requests fills
//! the limit within seconds. Once the limit is hit `accept(2)` returns
//! `EMFILE` and the user sees:
//!
//!     ERROR accept (socks): No file descriptors available (os error 24)
//!
//! This helper raises the soft limit up to the hard limit (without
//! requiring root), so the user gets whatever headroom the kernel
//! already allows them. Failures are logged and swallowed.

#[cfg(unix)]
pub fn raise_nofile_limit_best_effort() {
    // Target: 16384 if the hard limit allows it, else whatever the hard
    // limit is. 16k matches what most modern desktop distros default to and
    // is plenty for a local proxy.
    const DESIRED: u64 = 16_384;

    unsafe {
        let mut rl = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        if libc::getrlimit(libc::RLIMIT_NOFILE, &mut rl) != 0 {
            let err = std::io::Error::last_os_error();
            tracing::debug!("getrlimit(RLIMIT_NOFILE) failed: {}", err);
            return;
        }

        // Already high enough? Leave it.
        let current = rl.rlim_cur as u64;
        let hard = rl.rlim_max as u64;
        if current >= DESIRED {
            return;
        }

        let new_soft = DESIRED.min(hard);
        if new_soft <= current {
            return;
        }

        rl.rlim_cur = new_soft as libc::rlim_t;
        if libc::setrlimit(libc::RLIMIT_NOFILE, &rl) != 0 {
            let err = std::io::Error::last_os_error();
            tracing::debug!(
                "setrlimit(RLIMIT_NOFILE) {} -> {} failed: {}",
                current,
                new_soft,
                err
            );
            return;
        }
        tracing::info!(
            "raised RLIMIT_NOFILE: {} -> {} (hard={})",
            current,
            new_soft,
            hard
        );
    }
}

#[cfg(not(unix))]
pub fn raise_nofile_limit_best_effort() {}
