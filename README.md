# MHRV-Hybrid

MHRV-Hybrid is a Rust-based HTTP relay and DPI bypass toolkit derived from `MasterHttpRelayVPN-RUST`, with desktop CLI/UI, Android client support, Apps Script relay assets, and a tunnel-node companion.

## Project layout (all-in-one)

- `src/` — core Rust client (`mhrv-rs`) and desktop UI (`mhrv-rs-ui`).
- `android/` — Android app wrapper + VPN/TUN integration.
- `assets/apps_script/` — Google Apps Script and hybrid worker templates.
- `tunnel-node/` — tunnel-node service component.
- `docs/` — Android guides and changelog history.
- `.github/workflows/release.yml` — release build + upload workflow.

## Quick start

### 1) Build desktop binaries

```bash
cargo build --release --features ui
```

Outputs:
- `target/release/mhrv-rs`
- `target/release/mhrv-rs-ui`

### 2) Configure

Copy and edit one of these:
- `config.example.json`
- `config.full.example.json`
- `config.google-only.example.json`

### 3) Run

```bash
./target/release/mhrv-rs
```

Optional commands:

```bash
./target/release/mhrv-rs test
./target/release/mhrv-rs scan-ips
./target/release/mhrv-rs --install-cert
./target/release/mhrv-rs --remove-cert
```

## Android

- Open `android/` in Android Studio and build the app.
- Android docs are in:
  - `docs/android.md` (English)
  - `docs/android.fa.md` (Persian)

## Rebrand note

This repository is branded as **MHRV-Hybrid** across docs and release automation.

## License

MIT (`LICENSE`).
