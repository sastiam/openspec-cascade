# Proposal: Cross-Platform Keep-Alive and Engine Integration

## Why

`openspec-cascade` must execute long-running overnight tasks without OS sleep or process interruption on both macOS (Darwin) and Linux (Fedora/Ubuntu).

## What Changes

- Add `platform.ts` module providing OS abstraction and keep-alive process management (`caffeinate` on macOS, `systemd-inhibit`/native on Linux).
- Integrate `--engine antigravity` and `--engine agy` CLI flags into `cascade.ts`.
- Document cross-platform execution and requirements in `README.md`.

## Definition of Done

- `platform.ts` prevents system sleep during cascade runs on macOS and Linux.
- CLI flags `--engine antigravity` and `--engine agy` correctly dispatch task sessions.
