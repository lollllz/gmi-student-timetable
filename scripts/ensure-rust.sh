#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v cargo >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/timetable-rustup.sh
  sh /tmp/timetable-rustup.sh -y --profile minimal --no-modify-path
fi
rustup target add wasm32-unknown-unknown
if ! command -v wasm-bindgen >/dev/null || ! wasm-bindgen --version | head -1 | grep -q '0.2.105'; then
  cargo install wasm-bindgen-cli --version 0.2.105 --locked
fi
