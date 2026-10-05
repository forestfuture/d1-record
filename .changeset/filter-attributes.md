---
"@forestfuture/d1-record": minor
---

`onQuery` listeners see the bound values of filtered attributes as `"[FILTERED]"`, as Rails' logs do, and so do cast errors. `static filterAttributes` starts with Rails' default list (`passw`, `email`, `secret`, `token`, `_key`, `crypt`, `salt`, `certificate`, `otp`, `ssn`, `cvv`, `cvc`), matched against each attribute's snake_case name, so passwords, tokens, API keys and emails no longer reach your logs. Replace the list on your app's base class: `static override filterAttributes = [...Model.Base.filterAttributes, "iban"]`, or `[]` to filter nothing. D1 still gets the real values.
