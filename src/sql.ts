/**
 * A SQL fragment built with the `sql` tagged template (ADR-0006). The template
 * text is written by the developer; every interpolated value is bound as a
 * parameter and never becomes SQL text.
 */
export class SafeSql {
  readonly strings: readonly string[];
  readonly values: readonly unknown[];

  /** @internal Use the `sql` tag instead. */
  constructor(strings: readonly string[], values: readonly unknown[]) {
    this.strings = strings;
    this.values = values;
  }
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]): SafeSql {
  return new SafeSql([...strings], values);
}

/** A reference to an attribute's column, resolved against the query's Model when compiled. */
export class ColumnReference {
  readonly attribute: string;

  /** @internal Use `column()` instead. */
  constructor(attribute: string) {
    this.attribute = attribute;
  }
}

/** Names the column of `attribute` inside an `sql` fragment, quoted and mapped (ADR-0004). */
export function column(attribute: string): ColumnReference {
  return new ColumnReference(attribute);
}
