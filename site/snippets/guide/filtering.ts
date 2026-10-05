import { Model } from "@forestfuture/d1-record";

// #region add
// src/models/application-record.ts
export class Base extends Model.Base {
  // Rails' defaults, plus an IBAN and a date of birth:
  static override filterAttributes = [...Model.Base.filterAttributes, "iban", /^dateOfBirth$/];
}
// #endregion add
