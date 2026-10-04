# Models extend the app's `ApplicationRecord`, not a library `Model("table")`

A Model extends the app's base class: `class Product extends ApplicationRecord("products") {}`, where `src/models/application-record.ts` declares `class Base extends Model.Base` and `export const ApplicationRecord = modelFor(tables, Base)`, built on the generated schema (ADR-0010). That matches Rails line for line (`class ApplicationRecord < ActiveRecord::Base`, then `class Product < ApplicationRecord`), apart from the table in the call, which TypeScript needs because a class's type can't come from its name (ADR-0007).

The alternative was the library's own `Model("products")`, with the generated file adding its tables to the library's types (`declare module`) and the schema given to the connection (`connect(env.DB, { schema })`), so there'd be no app file. We didn't take it because:

- **The app file exists anyway.** Shared methods, callbacks and scopes live on `ApplicationRecord`'s `Base`, as in Rails, so every app has `application-record.ts`. Without that file, the alternative's gain is only importing from the library rather than `./application-record`.
- **Attributes would arrive late.** They're read when a class is defined (`this.validates("email", …)` checks the attribute in `static {}`, and accessors are created on the class). From the connection, they'd only be known at first use, so those checks would move to runtime, or the schema would have to be imported before any Model, an import-order trap.
- **Types would be global.** Adding tables to the library's types applies to the whole project, so two D1 databases with a table of the same name would collide; one base class per binding (`DbRecord`, `LogsRecord`) keeps them apart.

## Consequences

- Each database's Models import its base class, from `./application-record` (or `--models <dir>`); the schema stays a document only the base class imports.
- Where a query's database comes from is a separate decision (#77): `Product.find(id)` with the app's binding, a current database per request, or an explicit `db`.
