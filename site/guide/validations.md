# Validations

Validations are declared in a Model's `static {}` block with `this.validates(attribute, rules)`. The attribute name and the rules are typed against the Model.

<<< @/snippets/guide/validations.ts#validates{ts}

`save()` validates first, and returns `false` when a record is invalid. You can also check with `await record.isValid()`, the only way to run validations directly. It's async, since `uniqueness` asks D1.

## The errors collection

<<< @/snippets/guide/validations.ts#errors{ts}

Every validation runs, in the order declared, so one attribute can collect several errors. `fullMessages()` puts the attribute's name in front, humanized as Rails does: `createdAt` reads as "Created at". Errors on the record as a whole go on `"base"`, and read without a prefix.

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
