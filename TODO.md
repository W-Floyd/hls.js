# Modular build follow-ups

- Remaining feature code in `core` (~0.5 KiB br): interstitial branches in base-stream/gap controllers and hls.ts; feature-only exports of shared modules (`cml-utils`, `timescale-conversion`, `codecs`, `date-range`, `user-agent`).
- Worker: `transmuxer-worker.ts` always registers `mpegTs` since classes don't survive the JSON config; an ESM `core` client using `workerPath` gets the full `hls.worker.js`. A per-feature module worker would fix both.
- Types for `hls.js/core` and `hls.js/features/*`: api-extractor only rolls up `dist/hls.d.ts` from `src/hls.ts`.
- `cdn/server.js` bundles have no transmux worker (IIFE included), so TS transmuxes on the main thread. HTTP clients see a change only after `max-age` (ETags revalidate); content-addressed URLs would allow `immutable`.
- `src/auto.ts` detects features from the manifest, the first media playlist and config only; features revealed later (keys in later segments, undeclared in-band captions) need `features`. Its prefetched first media playlist goes unused when ABR starts on another level. No npm export or types yet (it defaults to its own URL as the bundle server).
