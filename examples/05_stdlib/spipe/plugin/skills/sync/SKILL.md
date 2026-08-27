---
name: sync
description: Plan synchronization of only an isolated session-owned work branch.
---

# Isolated Session Sync

Fetch and rebase only the current owned `work/*` branch when policy permits.
Renew affected evidence and use lease/CAS for that owned branch. Never mutate
or rebase a protected ref, candidate, recovery ref, or tag.
