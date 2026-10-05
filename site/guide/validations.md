---
description: "validates with presence, length, format, inclusion, numericality and uniqueness, their options, the errors collection, and adding errors with errors.add, and custom validations."
---

# Validations

Validations are declared in a Model's `static {}` block with `this.validates(attribute, rules)`. The attribute name is typed against the Model, so a misspelled attribute is a compile error, and so is the record the `if` option receives.

<<< @/snippets/guide/validations.ts#validates{ts}

`save()` validates first, and returns `false` when a record is invalid. You can also check with `await record.isValid()`, the only way to run validations directly. It's async, since `uniqueness` asks D1.

## The errors collection

<<< @/snippets/guide/validations.ts#errors{ts}

Every validation runs, in the order declared, so one attribute can collect several errors. `fullMessages()` puts the attribute's name in front, humanized as Rails does: `createdAt` reads as "Created at". Errors on the record as a whole go on `"base"`, and read without a prefix.

### Adding an error

```ts
record.errors.add(attribute, message, { type });
```

- `attribute`: the attribute the error belongs to, or `"base"` for the record as a whole.
- `message`: the text that follows the attribute's name in `fullMessages()`, such as "must be after the start".
- `type`: optional, and `"invalid"` when left out. Name the error here when code needs to tell it apart from the others.

Add errors in a `beforeValidation` or `afterValidation` callback, as the `Booking` model in [Custom validations](#custom-validations) does. With a Sunday booking that ends when it starts, it collects both of its errors:

<<< @/snippets/guide/validations.ts#add{ts}

::: tip Compared with Rails
Rails' `errors.add(:ends_at, :after_start)` takes a type and looks up its message with I18n. d1-record has no I18n yet, so the message is always yours to give, and the type is an option. When Rails is given a message instead, `errors.add(:base, "The room is closed on Sundays")`, that text is the type too. Here the type is still `"invalid"`. Rails' `message:` and `strict:` options and its procs aren't here.
:::

## Validators

| Rule           | Options                                                                                      | Error type                                     |
| -------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `presence`     | `true`                                                                                       | `blank`                                        |
| `length`       | `{ minimum, maximum, is }`                                                                   | `tooShort`, `tooLong`, `wrongLength`           |
| `format`       | `{ with: /re/ }`, or a regex                                                                 | `invalid`                                      |
| `inclusion`    | `{ in: [...] }`, or an array                                                                 | `inclusion`                                    |
| `numericality` | `{ onlyInteger, greaterThan, greaterThanOrEqualTo, lessThan, lessThanOrEqualTo }`, or `true` | `notANumber`, `notAnInteger`, `greaterThan`, … |
| `uniqueness`   | `{ scope: [...], caseSensitive }`, or `true`                                                 | `taken`                                        |

Within one `validates` call, the rules run in that order. Every rule also accepts:

- `allowNull`: skip the rule when the value is `null`. Without it, `null` fails `presence`, `format`, `inclusion` and `numericality`, counts as length 0, and is never taken.
- `message`: replaces the default messages from that call.
- `if: (record) => boolean`: only validate when it returns `true`.

The default messages are Rails' English ones ("can't be blank", "is too short (minimum is 3 characters)", "has already been taken", …).

A few details that differ from what you might expect:

- `presence` fails a string that's only whitespace. For a boolean, use `inclusion: [true, false]`, since `false` is a value.
- `numericality` only accepts real numbers: a numeric string such as `"12"` is `notANumber`, so convert form input first.
- `uniqueness` leaves the record itself out when updating, and never treats `null` as taken, matching SQLite's UNIQUE. `caseSensitive: false` compares with SQLite's `lower()`, which only lowercases ASCII letters.

::: warning Uniqueness isn't a guarantee
Two requests can both check that an email is free, then both insert it. `uniqueness` gives a friendly error early, but only a UNIQUE index in the table prevents duplicates. Declare both. When the index catches a duplicate, the save throws [`RecordNotUnique`](./errors#constraint-errors).
:::

## Custom validations

For a rule the validators don't cover, add errors in a `beforeValidation` or `afterValidation` callback. A record with any errors is invalid:

<<< @/snippets/guide/validations.ts#custom{ts}

[Adding an error](#adding-an-error) describes `errors.add`'s arguments. Each validation run (`isValid()`, `save()` or `saveOrThrow()`) starts by clearing `errors`, as in Rails, so an error added anywhere else is gone by the next save.
