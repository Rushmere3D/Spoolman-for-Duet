# Migration notes from old plugin

The old implementation in `spoolman-for-duet_old` had useful ideas but also anti-patterns.
Version `0.5.0` removes the following:

- Browser-side tracking loops (`setInterval` in plugin)
- Browser persistence for critical runtime state
- Hardcoded IP discovery scans
- Overloading Spoolman spool comments as a key-value store

## New behavior

- Tracking runs in the bridge server continuously.
- Plugin only displays status and submits configuration changes to server APIs.
- Language selection is persisted server-side.
- Discovery uses mDNS hostname with manual fallback.

## Settings migration

There is no automatic migration from localStorage or old comment-based data.
Set the following once in the new plugin UI:

1. Spoolman URL
2. RRF URL and optional password
3. Hotend count
4. Tool-to-spool mapping
5. Language mode (Auto/English/Dansk)
