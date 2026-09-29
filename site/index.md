---
layout: home

hero:
  name: d1-record
  text: Active Record for Cloudflare D1
  tagline: Models, validations, callbacks, associations and composable queries for Workers, in the spirit of Ruby on Rails, and honest about what D1 can and can't do.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Coming from Rails
      link: /guide/coming-from-rails
    - theme: alt
      text: GitHub
      link: https://github.com/forestfuture/d1-record

features:
  - title: Models, declared once
    details: Typed attributes inferred from one declaration, camelCase in your code and snake_case in the table, with defaults, timestamps, dates and JSON converted both ways.
  - title: Lazy, composable queries
    details: where, comparisons, ordering, pagination, named scopes and preloading with includes, one query per association, never N+1. Hand-written SQL only through a tagged template, so values are always bound.
  - title: A predictable lifecycle
    details: save, create, update and destroy with validations, Rails' callback order, abort(), dirty tracking and dependent strategies. Methods that raise end in OrThrow.
  - title: Atomic where D1 allows
    details: D1 can't hold a transaction open across awaits, so db.batch writes a prepared set of statements and records all at once, or not at all. Keys generated in code let whole graphs save atomically.
---
