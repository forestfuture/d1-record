import { ApplicationRecord } from "./application-record";

// A table outside the migrations, its attributes declared here, on the same base class.
export class Visit extends ApplicationRecord.define({
  id: { type: "integer", null: false },
  path: { type: "string", null: false },
}) {}
