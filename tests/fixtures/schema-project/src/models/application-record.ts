import { modelFor } from "@forestfuture/d1-record";
import { tables } from "../../schema";

/**
 * The base class for this app's Models, built on the schema `d1-record schema` generates:
 * `class Product extends ApplicationRecord("products") {}`. It's yours to edit.
 */
export const ApplicationRecord = modelFor(tables);
