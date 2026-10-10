---
description: "validates with presence, length, format, inclusion, numericality, and uniqueness, their options, the errors collection, and adding errors with errors.add in a callback."
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

The default messages are in English: “can’t be blank”, “is too short (minimum is 3 characters)”, “has already been taken”, and so on.

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

## Adding errors

For a rule the validators don’t cover, add errors in a `beforeValidation` or `afterValidation` callback. A record with any errors is invalid:

<<< @/snippets/guide/validations.ts#custom{ts}

`errors.add` takes the attribute, or `"base"`, then the message that follows the attribute’s name. Pass a `type` when code needs to tell the error apart from others. It defaults to `"invalid"`:

<<< @/snippets/guide/validations.ts#add{ts}

Each validation run, from `isValid()`, `save()`, or `saveOrThrow()`, starts by clearing `errors`. So an error added outside a validation callback is gone by the next save.

::: rails Compared with Rails
Rails’ `errors.add(:ends_at, :after_start)` takes a type and looks up its message with I18n. d1-record has no I18n yet, so the message is always yours to give, and the type is an option. When Rails is given a message instead, that text is the type too; here the type is still `"invalid"`. Rails’ `message:` and `strict:` options and its procs aren’t here.
:::
