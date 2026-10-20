---
"@forestfuture/d1-record": patch
---

Loading records uses less CPU, which Workers bill and limit: about 40% less per row for `toArray()` of a Model with a `datetime` and three associations. A loaded record no longer builds its association fields only to remove them, reads a stored `datetime` with one `Date`, and works out the values change tracking compares against only when something first asks for its changes. What a loaded record holds, and how its changes are tracked, are unchanged.
