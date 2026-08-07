---
"@meet/web": patch
---

Fix admitting a waiting participant, which failed with "could not admit participant". The rejoin proof was written to localStorage but read from sessionStorage, so every room-scoped API route (admit, doc, canvas, whiteboard, agents) was called without an Authorization header and answered 401. The proof now lives in sessionStorage behind a single owner, `lib/rejoinStore`.
