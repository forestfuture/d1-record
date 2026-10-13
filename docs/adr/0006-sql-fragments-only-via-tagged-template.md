# SQL fragments are accepted only through the `sql` tagged template

The original brief showed `where("created_at > ?", since)`. We don't accept plain strings as SQL fragments anywhere. A fragment has to be a `SafeSql` value built with ``sql`…` ``, where every `${…}` becomes a bound D1 parameter. Column names are written as SQL text, which is fixed and developer-authored, or with `column("attrName")`, which looks up the quoted column from Model metadata. Counting placeholders can't catch ``where(`email = '${email}'`)``: it has no placeholders and no values, and it's still injectable. Only a type the library constructs can prove a fragment was built safely. There's no raw-SQL escape hatch in the first release. If one is added later, it must be loudly named (e.g. `unsafeWhere`), imported separately, and easy to forbid with a linter.

## A note on what is read (#149)

The library doesn't parse the SQL in a fragment, and it never reads a value as SQL. One check reads the text _between_ interpolations: a bare date directly compared with the `column()` of an integer-stored attribute is refused (`src/fragment-guard.ts`). It matches only a comparison operator or `BETWEEN` standing alone between a column and a value, and it changes no query: it only raises an error where the fragment would have silently matched nothing or every row.
