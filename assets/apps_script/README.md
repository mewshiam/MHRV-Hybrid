# Apps Script / Worker templates for `mhrv-rs`

This folder contains deploy-ready scripts used by the Rust client.

## Files

- `Code.gs` — upstream-compatible direct Apps Script relay.
- `CodeFull.gs` — full-mode tunnel relay script (for `mode = "full"`).
- `CodeHybrid.gs` — new hybrid relay script:
  - default route: direct `UrlFetchApp` (normal Apps Script behavior)
  - optional route: forwards selected hostnames to your Cloudflare Worker
- `worker.js` — minimal Cloudflare Worker endpoint that accepts the same relay payload and returns `{s,h,b}`.

## When to use which

- Want classic setup only: deploy **`Code.gs`**.
- Want full tunnel mode: deploy **`CodeFull.gs`**.
- Want mixed routing (normal via Apps Script + specific hosts via CFW): deploy **`CodeHybrid.gs`** and configure:
  - `WORKER_URL`, `CFW_HOSTS` in script
  - `cfw_script_id` / `cfw_hosts` in `mhrv-rs` config

## Security notes

- Always change `AUTH_KEY` before deployment.
- Keep Worker URL private if possible.
- Do not share deployment IDs and auth key publicly.
