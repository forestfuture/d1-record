---
"@forestfuture/d1-record": patch
---

`npx skills add forestfuture/d1-record` installs only the skill. It used to copy the whole repository into the app's skills folder, because `SKILL.md` was at the repository's root. The skill is now `skills/d1-record/SKILL.md`, in the repository and in the package (`npx skills experimental_sync` still finds it).
