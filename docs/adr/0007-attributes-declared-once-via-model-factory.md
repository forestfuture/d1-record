# Attributes are declared once, through `Model({...})`

**Amended by ADR-0015**: `Model({...})` is now `Model.define({...})`, and most Models get their attributes from the generated schema.

A Model extends `Model({ email: { type: "string", null: false }, isActive: "boolean", … })` rather than `Model`. The attribute object is the single source of truth: the runtime reads it for type conversion, column mapping and the query allowlist, and TypeScript infers the instance properties from it. The alternative was `this.attribute(...)` calls in `static {}` plus a matching `declare isActive: boolean` for each attribute. That needed two declarations that could drift apart, and let `declare` claim a non-null type for a column that can be NULL. TypeScript can't infer instance properties from static calls, so the only way to declare once was to pass the attributes to the base class. Nullability is part of the declaration, and attributes can be null by default, as in SQLite.

## Consequences

- `Model({...})` always creates a subclass of the library's base class, so an app-wide base class can't add attributes to its subclasses. Shared behavior was first plain functions called from `static {}` (e.g. `audited(this)`), until a shared base turned out to be needed: `modelFor(tables, Base)` (ADR-0010) builds every Model on an app's class extending `Model.Base`, so its methods, statics, callbacks and scopes are inherited, as Rails' `ApplicationRecord`'s are.
- Associations needed a `declare` for their instance accessor until ADR-0008 made them record fields.
