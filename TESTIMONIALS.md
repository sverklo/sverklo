# What people are saying

> _This file is the source of truth for testimonials displayed on `sverklo.com` and in the README. Add new quotes to the top. Each entry needs (a) the quote, (b) attribution with role + repo size if known, (c) consent confirmation, (d) date the quote was given._

---

## Format

```markdown
> "Concrete one-line quote with a real specific."
>
> — **Name**, role at Company, _N-file repo_ · 2026-04-DD
```

Two rules:
1. **Specifics, not adjectives.** "Saved me an hour planning the rename" beats "great tool". Concrete numbers, concrete moments.
2. **Real attribution.** Real name, real role, real repo size if they're willing. No anonymous "Senior Engineer at FAANG" — that's a tell that the quote is fabricated. If they want to stay anonymous, leave them off the README and store them only in the founder's private notes.

---

## Live testimonials

<!-- Add new entries above this line. Three to start with. -->

_Empty — collect 3 before launch (Tue 2026-04-21)._

---

## Pending asks (founder-only)

| Person | Asked on | Channel | Status |
|---|---|---|---|
| _[Beta user 1]_ | 2026-04-DD | DM / email | _Pending_ |
| _[Beta user 2]_ | 2026-04-DD | DM / email | _Pending_ |
| _[Beta user 3]_ | 2026-04-DD | DM / email | _Pending_ |

## Suggested ask script

> Hey — I'm launching sverklo publicly on Tue 2026-04-21 (Show HN day, then Reddit) and I'd love to put a one-sentence quote from you on the README and the landing page. Something concrete from your actual use — a moment it saved you time, a question it answered that grep wouldn't, a refactor it made safer. Real specific beats marketing-friendly. Two sentences max. I'll attribute by name and role unless you'd rather stay anonymous, and I'll send you the final wording before it goes live for sign-off. No pressure if you'd rather not — but if you can spare 5 min, it would mean a lot.

---

## Where these get used

Once the table above has 3+ filled rows:

1. **README.md** — new section between `## Performance` and `## Why not`:
   ```markdown
   ## What people are saying

   > "..."
   > — Name, role · date

   > "..."
   > — Name, role · date

   > "..."
   > — Name, role · date
   ```

2. **sverklo.com landing page** — new section between `#performance` and `#how`, styled to match the editorial dark/orange palette. I'll add the section once the quotes are in.

3. **Show HN first author comment** — pick the strongest one to weave into the comment. Don't lead with it (HN distrusts testimonials), but a single concrete one near the bottom carries weight if it's specific.

4. **Reddit launch posts** — same — only if directly relevant to the sub's voice. r/LocalLLaMA cares about local-first specifics; r/cursor cares about workflow specifics.

## What NOT to do

- **Never invent quotes.** Even one fabricated quote, if discovered, kills the launch.
- **Never use AI-written quotes** that haven't been signed off by the actual person.
- **Never paraphrase** without showing the person the final wording first.
- **Never use stock photos** as "user avatars" — leave the photo column empty if you don't have a real one.
- **Never use a logo wall** of companies that haven't formally agreed. Even if a single engineer at Stripe uses sverklo, you can't put the Stripe logo on the landing page without legal sign-off.
