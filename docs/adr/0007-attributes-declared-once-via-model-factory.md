# Attributes are declared once, through `Model({...})`

A Model extends `Model({ email: { type: "string", null: false }, isActive: "boolean", … })` rather than `Model`. The attribute object is the single source of truth: the runtime reads it for type conversion, column mapping and the query allowlist, and TypeScript infers the instance properties from it. The alternative was `this.attribute(...)` calls in `static {}` plus a matching `declare isActive: boolean` for each attribute. That needed two declarations that could drift apart, and let `declare` claim a non-null type for a column that can be NULL. TypeScript can't infer instance properties from static calls, so the only way to declare once was to pass the attributes to the base class. Nullability is part of the declaration, and attributes can be null by default, as in SQLite.

## Consequences

- `Model({...})` always creates a subclass of the library's base class. An app-wide base class can't add attributes to its subclasses, so shared behavior uses plain functions called from `static {}` (e.g. `audited(this)`). If a shared base turns out to be needed, a `.with({...})` helper can be added later.
- Associations needed a `declare` for their instance accessor until ADR-0008 made them record fields.
