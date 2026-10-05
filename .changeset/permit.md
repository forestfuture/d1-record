---
"@forestfuture/d1-record": patch
---

`Model.permit(input, ...names)` keeps only the named attributes of untrusted input (a JSON body, `FormData` or `URLSearchParams`), as Rails' `params.permit`, and casts each value as assigning it would: `User.create(User.permit(await request.json(), "email", "name"))`. A new guide page, Handle untrusted input, covers choosing fields, schema validators, casting, and an untrusted `null` in conditions.
