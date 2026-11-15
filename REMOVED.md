# What changed in her, 2026-11-15

## Added and then removed the same day

Eight questions were added to her pass — domain, depth, tone, shape, web, care,
stable, clarify — with `DOMAINS`, `DEPTHS`, `TONES`, `SHAPES`, `AXIS_QUESTIONS`
and their readers. The owner's objection was that this was clef's shape wearing
her name: a menu of typed questions with probabilities, not a prediction of what
he wants. All of it was removed again; her pass is two questions over the
generic menu, or one over a surface's own menu.

## What is there now

- `SURFACES`: per-surface menus built from what each tool can actually do —
  `mind` (truth, operator, mnl, doc, micro, style, browse, none) and `cards`
  (answer, search, fetch, card, merge, split, template, style, magic, continue,
  none), each with the words a card needs to ask (`question`, `labels`).
- `/decide` takes `{text, domain, surface}`: `surface` picks the menu, `domain`
  names the row.
- `arrive()` returns the move, the refused flag, the cost, and the question and
  options for the card. No probabilities, no confidence, no route score.
- The route question still exists for a call with no surface; the products use
  the surface menus.

## Never added

`expirationTtl` on a record: rows and interaction bodies carry no TTL.

## 2026-11-15, later

The test file was deleted on the owner's instruction: he learns from her
decisions, not from tests written without him.
