# ADR 001: Rust/WASM application with static CDN delivery

Status: implemented; Rust backend and direct short site deployed and verified on 22 October 2026.

The owner requested a full Rust rewrite to reduce server load while keeping free hosting, no student login, the short address and existing data. A native Rust server would require changing the current hosting contract. Instead, all application logic moves to Rust compiled to WASM. HTML/CSS remain static; generated bindings and minimal browser/Netlify SDK adapters perform platform I/O.

The short address now serves built files directly rather than proxying the whole app. Public server reads are CDN-cached, browser source checks are cached for five minutes, and the DAV engine loads only for local-file operations. Existing private Blobs stores are reused without migration. Source uploads retain staged writes and a conditional pointer update.

Consequences: Rust controls the browser and server behavior and file decoder, but WASM has cold-download/initialization costs and uses Node-hosted adapters for the Netlify SDK. Source changes are not instantly visible to every cached client; an explicit check is available. Backend and direct short-site code releases require their own Netlify deployments. Tests compare Rust against independent legacy decoding, verify the browser workflows and check actual deployed caching before claiming lower server work.
