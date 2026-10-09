---
"@forestfuture/d1-record": patch
---

`static hiddenAttributes` lists attribute names `toJSON()` leaves out, so `Response.json(user)` can't send a `passwordDigest`. It starts empty on `Model.Base`; set it on your app's base class (`static override hiddenAttributes = ["passwordDigest"]`). A Model's own list replaces the base class's, and `attributes()` still returns everything. A name a Model doesn't have is an `InvalidModel` when it's first used.
