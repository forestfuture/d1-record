import { belongsTo, hasMany, Model, modelFor } from "@forestfuture/d1-record";

// The generated schema's categories table, as `d1-record schema` writes it.
const ApplicationRecord = modelFor(
  {
    categories: {
      attributes: {
        id: { type: "string", null: false, default: () => crypto.randomUUID() },
        parentId: "string",
        name: { type: "string", null: false },
      },
      primaryKey: "id",
    },
  } as const,
  Model.Base,
);

// #region self-reference
export class Category extends ApplicationRecord("categories") {
  parent = belongsTo(Category); // foreign key: parentId, from the association's name
  children = hasMany(Category, { foreignKey: "parentId" }); // not the default, categoryId
}
// #endregion self-reference
