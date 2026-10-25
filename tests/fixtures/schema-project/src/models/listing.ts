import { ApplicationRecord } from "./application-record";

// The products table again, with overrides and an ignored column.
export class Listing extends ApplicationRecord {
  static override table = "products";
  static override attributes = {
    available: "integer",
    tagline: { null: false, default: () => "Listed" },
    settings: false,
  } as const;
}
