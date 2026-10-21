---
description: "validates with presence, length, format, inclusion, numericality, and uniqueness, their options, the errors collection, adding errors with errors.add in a callback, and changing error messages."
---

# Validations

Validations check a record before it’s saved. An invalid record isn’t saved, and its `errors` say why.

## Declaring validations

Declare validations in a Model’s `static {}` block with `this.validates`:

<<< @/snippets/guide/validations.ts#validates{ts}

Attribute names are typed, so a misspelled attribute is a compile error.

`save()` validates first, and resolves to `false` when a record is invalid. To validate without saving, call `isValid()`:

```ts
const account = Account.build(permitted);
const valid = await account.isValid();
```

::: warning TIP
`isValid()` is async, since `uniqueness` asks D1.
:::

## Available validators

| Rule           | Options                                                                                      | Error type                                     |
| -------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `presence`     | `true`                                                                                       | `blank`                                        |
| `length`       | `{ minimum, maximum, is }`                                                                   | `tooShort`, `tooLong`, `wrongLength`           |
| `format`       | `{ with: /re/ }`, or a regex                                                                 | `invalid`                                      |
| `inclusion`    | `{ in: [...] }`, or an array                                                                 | `inclusion`                                    |
| `numericality` | `{ onlyInteger, greaterThan, greaterThanOrEqualTo, lessThan, lessThanOrEqualTo }`, or `true` | `notANumber`, `notAnInteger`, `greaterThan`, … |
| `uniqueness`   | `{ scope: [...], caseSensitive }`, or `true`                                                 | `taken`                                        |

Every validation runs, in the order declared, so one attribute can collect several errors. Every rule also accepts these options:

- **`allowNull`** skips the rule when the value is `null`. Otherwise `null` fails `presence`, `format`, `inclusion`, and `numericality`, counts as length 0, and is never taken.
- **`message`** replaces the default messages from that call.
- **`if: (record) => boolean`** validates only when it returns `true`.

The default messages are in English: “can’t be blank”, “is too short (minimum is 3 characters)”, “has already been taken”, and so on. [Changing error messages](#changing-error-messages) shows how to replace them.

### Validator details

- **`presence`** fails a string that’s only whitespace. For a boolean, use `inclusion: [true, false]`, since `false` is a value.
- **`numericality`** only accepts numbers, so a numeric string such as `"12"` is `notANumber`.
- **`uniqueness`** leaves the record itself out when updating, and never treats `null` as taken, as SQLite’s UNIQUE does. `caseSensitive: false` compares with SQLite’s `lower()`, which only lowercases ASCII letters.

::: warning Uniqueness isn’t a guarantee
Two requests can both check that an email is free, then both insert it. `uniqueness` gives a friendly error early, but only a UNIQUE index in the table prevents duplicates, so declare both. When the index catches a duplicate, the save throws [`RecordNotUnique`](./errors#constraint-errors).
:::

## Reading errors

A record’s `errors` hold each failed rule:

<<< @/snippets/guide/validations.ts#errors{ts}

Printing `errors`, in the console or a log, lists each failure’s attribute, type, and message. `fullMessages()` puts the attribute’s name in front, so `createdAt` reads as “Created at”. Errors on the record as a whole go on `"base"`, and read without a prefix.

An error with a number in its message, such as `tooShort`, has it in `toArray()` too:

```ts
{ attribute: "handle", type: "tooShort", message: "is too short (minimum is 3 characters)", values: { count: 3 } }
```

## Adding errors

For a rule the validators don’t cover, add errors in a `beforeValidation` or `afterValidation` callback. A record with any errors is invalid:

<<< @/snippets/guide/validations.ts#custom{ts}

`errors.add` takes the attribute, or `"base"`, then either a `type` or a message. A `type` takes its message from the Model’s `errorMessages`, as `afterStart` does above. See [Changing error messages](#changing-error-messages). A message is used as written, and its type is `"invalid"`:

<<< @/snippets/guide/validations.ts#add{ts}

To fill in a placeholder, pass its value with the type:

```ts
account.errors.add("handle", { type: "tooShort", count: 3 });
```

To give a message and a type, pass the type as an option:

```ts
account.errors.add("handle", "is reserved", { type: "reserved" });
```

Each validation run, from `isValid()`, `save()`, or `saveOrThrow()`, starts by clearing `errors`. So an error added outside a validation callback is gone by the next save.

::: rails Compared with Rails
Rails’ `errors.add(:ends_at, :after_start)` is `errors.add("endsAt", { type: "afterStart" })` here, since a type and a message are both strings in TypeScript. When Rails is given a message instead, that text is the type too; here the type is `"invalid"`. Rails’ `message:` and `strict:` options and its procs aren’t here.
:::

## Changing error messages

To change the message of one validation, pass `message` to `validates`. To change a message for every Model, call `this.errorMessages` in your app’s base class:

<<< @/snippets/guide/error-messages.ts#base{ts}

Each key is an error type from [the validators’ table](#available-validators), or a type of your own. A message with a count, such as `tooShort`, can have a form for one and a form for any other count.

A Model’s own messages win over the base class’s, and a later call’s over an earlier one’s. Messages under `attributes` apply to one attribute:

<<< @/snippets/guide/error-messages.ts#model{ts}

Each message is looked up when you read it:

<<< @/snippets/guide/error-messages.ts#read{ts}

### Naming attributes

`fullMessages()` starts each message with the attribute’s name, made from the attribute itself: `createdAt` reads as “Created at”. To use another name, call `this.humanAttributeNames`, in the base class or a Model, as the examples above do. For a form’s label, `Product.humanAttributeName("priceCents")` returns the same name.

In a Model, `attributes` and `humanAttributeNames` can only name the Model’s attributes, its associations, and `"base"`, so a misspelled name is a compile error. Names in the base class can be any attribute: a Model without that attribute ignores them.

### Placeholders

A message can show these values:

- **`%{count}`**: the number in the rule, such as the `minimum` of `tooShort` or the bound of `greaterThan`.
- **`%{attribute}`**: the attribute’s name, as `fullMessages()` shows it.
- **`%{model}`**: the Model’s name, so `BlogPost` reads as “Blog post”.
- **`%{value}`**: the attribute’s value. A [filtered attribute](./models#filtering-attributes) shows `[FILTERED]`.

A value passed to `errors.add` with the type, such as `count`, fills in the placeholder of the same name.

### Which message is used

For each error, the first message found is used:

1. A message given to `validates` or `errors.add`.
2. The Model’s message for the attribute and type, then its message for the type.
3. The same for each class the Model extends, your base class included.
4. The built-in English message.

A type with no message anywhere throws a `TypeError` when the error is added.

::: rails Compared with Rails
Rails looks messages up in its locale files, in the same order: the Model’s, then its ancestors’, then the shared ones. d1-record keeps them on the classes instead, so a Model’s messages sit next to its validations. Their keys are d1-record’s error types, in camelCase. Rails shows “Translation missing” for a type with no message, where d1-record throws when the error is added. Messages in other languages aren’t here yet.
:::
