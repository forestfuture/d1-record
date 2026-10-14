// An attribute's conversions as a value (#148): the cast, write and read d1-record does for it,
// for SQL d1-record doesn't write (a raw D1 statement, a cache key, a row checked in a test).
import { castAs, readAs, storedAs } from "./attribute-values.ts";
import { attributeOf, requireDefined } from "./metadata.ts";
import type { ModelClass } from "./model.ts";

/**
 * What d1-record does with an attribute's values, by the attribute's type (and `storage`).
 * `T` is the attribute's JavaScript type. Each method is a function of its own, so one can be
 * passed on or destructured.
 */
export interface AttributeConversions<T> {
  /**
   * `input` as the attribute's JavaScript value, as assigning it would: strict, so `TypeError`
   * naming the Model and attribute when it can't be. `null` stays `null`; `undefined` throws.
   */
  cast(input: unknown): T;
  /**
   * `input`, cast, as D1 stores it: an ISO string, an integer for a `storage` attribute, `0` or
   * `1`, JSON text. What `column(attribute).value(input)` binds inside an `sql` fragment.
   */
  serialize(input: unknown): string | number | null;
  /**
   * A cell D1 returned, as the attribute's JavaScript value; `null` for NULL. One that isn't
   * the attribute's stored form throws `TypeError` naming the Model and attribute, as a record
   * load does.
   */
  deserialize(stored: unknown): T;
}

/** The conversions of `model`'s `attribute`; `UnknownAttribute` if it has none by that name. */
export function conversionsFor<T>(model: ModelClass, attribute: string): AttributeConversions<T> {
  attributeOf(model, attribute);
  const of = { model, attribute };
  return Object.freeze({
    cast: (input: unknown) => {
      requireDefined(model, attribute, input);
      return castAs("assigned", of, input) as T;
    },
    serialize: (input: unknown) => {
      requireDefined(model, attribute, input);
      return storedAs("assigned", of, input) as string | number | null;
    },
    deserialize: (stored: unknown) => readAs(of, stored) as T,
  });
}
