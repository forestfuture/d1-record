# The base class is `Model`, not `Record`

The original brief sketched `class User extends Record`. We named the base class `Model` instead, because a value import named `Record` shadows TypeScript's global `Record<K, V>` utility type in every file that imports it. It also lets the vocabulary be consistent: a **Model** is the class, and a **Record** is one instance, which matches `db.model(User)`, `newRecord()` and `RecordNotFound`.
