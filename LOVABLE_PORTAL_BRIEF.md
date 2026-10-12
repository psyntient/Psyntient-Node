# Brief for Lovable — psyntient.io changes for the Noetic Archive portal

2026-09-14. Read part 1 before part 2; several of the technical asks only make
sense once the product shift is clear.

---

# Part 1 — what we are building

## The shift

Until now psyntient.io has been the product and the Archive has been a thing
behind it. That inverts.

**The Noetic Archive is the product.** It is an academic repository in the
OpenNeuro mould, but neurophenomenological: researchers publish projects tied
to their papers, each project citable with its own DOI and its own page, each
researcher with an academic profile listing everything they have deposited.

**psyntient.io becomes the identity and billing layer**, plus marketing. It
owns accounts, tiers, researcher verification and ORCID. It does not own
projects, datasets, DOIs or files, and should not learn about them.

The portal lives at **`archive.psyntient.io`**, which stays the canonical
origin. `noeticarchive.com` and any later domains redirect *to* it rather than
serving in parallel — one origin means one cookie domain, one redirect URI,
one set of DOI landing pages.

## The three surfaces behind one door

| surface | who gets in | what it is |
|---|---|---|
| **The Repo** | anyone, including signed-out | browse and cite published projects; deposit if verified |
| **The Library** | paid readers and admin | the Noetic Archive editions themselves |
| **The Architect** | admin only | the agent's own console |

Plus a **Download the Node** page, open to anyone with an account of any tier,
explaining what the Node is and linking to the installer.

## The flow we want

1. A visitor lands on `archive.psyntient.io` and gets a marketing page that
   explains the product and offers sign in / create account.
2. **Create account** sends them to psyntient.io, where the account is made.
3. They come back to the portal, signed in.
4. Signed in, the root path shows a hub: links to the Repo, the Library, the
   Node download, and — only for admin — the Architect.
5. A researcher who wants Library access upgrades on psyntient.io and returns.

## The two rules that shape everything else

**Contribution is free; access is paid.** Verifying as a researcher and
depositing data costs nothing and always will. Reading the Archive is the
subscription. These are separate questions with separate answers, and the
portal already keeps them on separate code paths — `researcher_verified`
gates deposit, `access_level` gates the Library, and neither reads the other.

**The Repo is public.** Someone following a citation from a paper must reach
the project page without an account. This is the top of the funnel; a wall
here costs us the exact person we are trying to reach.

---

# Part 2 — what we need on psyntient.io

Existing contract we are building on, unchanged: `/sso/archive?return=…`, the
code exchange, and the fields `access_level`, `researcher_verified`, `orcid`.
Everything below is additive unless it says otherwise.

## 1. Add `role` as its own field

Today the portal infers staff-ness from `access_level == "admin"`. That works
but conflates two different facts: *what someone has paid for* and *whether
they work here*. As a consequence an admin cannot also be an ordinary
subscriber, and removing someone's admin rights means touching their billing
state.

Please add to the exchange and verify responses:

```json
{ "role": "admin" | "staff" | "user" }
```

Keep `access_level` exactly as it is — we still gate the Library on it, and
changing it would break a live path. `role` is a second, independent field.

Three axes, and they must stay independent:

| field | question | granted by | cost |
|---|---|---|---|
| `access_level` | may they read the Library? | subscription | paid |
| `researcher_verified` | may they deposit? | ORCID + one signal | free |
| `role` | do they work here? | you | n/a |

A missing `role` must be treated by us as unknown, not as `user` — same rule
you already follow for `researcher_verified`. Please omit the field rather
than sending `null` if it cannot be determined.

## 2. No tier selection during sign-up

Account creation should produce a **free** account with no pricing step.

A researcher arriving from a citation wants to look at a dataset. Putting a
tier chooser in front of them converts a moment of interest into a purchasing
decision, and most people decline a purchasing decision. Let them in free, let
them browse the Repo, and surface the upgrade when they actually reach the
Library.

## 3. A signup entry point that returns to the portal

We need:

```
https://psyntient.io/signup?return=archive
```

**`return` must be an opaque key, not a URL.** `archive` maps, on your side,
to the registered callback `https://archive.psyntient.io/portal/auth/callback`.
Please do not accept a URL here even allowlisted — a `return=` that takes URLs
is an open redirect one config mistake away, and it will be probed.

On completion, redirect to that callback with a code, exactly as
`/sso/archive` does today. We restore the visitor's original destination on
our side from our own short-lived cookie; you do not need to carry a path.

If a signed-out visitor hits that URL and *already* has an account, sending
them through sign-in and back is the right behaviour — don't error.

## 4. The same for upgrade

```
https://psyntient.io/upgrade?return=archive
```

Reached from the portal when someone without `access_level` clicks the
Library. Same opaque-key rule. After a successful upgrade, return them to the
portal rather than to a psyntient.io receipt page — they were in the middle of
something.

## 5. Register one more callback

Add to the allowlist:

```
https://archive.psyntient.io/repo/auth/callback
```

The Repo needs its own, for the same reason the Library has one: a code is
bound to the exact callback string it was minted for, so someone signing in
from `/repo` has to come back to `/repo`. Sending the portal callback for a
Repo sign-in fails at exchange with a valid code, which presents as a broken
login rather than a mismatched redirect.

## 6. Account deletion must not cascade to published work

This one matters more than it looks.

When someone deletes their psyntient.io account, their **published projects
must survive**. Each has a DOI, and a DOI that 404s is a broken scholarly
record — journals cite it, other papers link to it, and it is not ours to
break. The Repo has no delete function at all, deliberately.

So on account deletion, please:

- **do not** attempt to delete anything in the Archive or the Repo
- **do** call a webhook we will provide, with the account id and a reason

We will turn the researcher's profile into a tombstone: the projects stay
reachable and citable, the personal details go. If you want, we can specify
the webhook contract once you have the deletion flow shaped — tell us the
shape you would find easiest to emit.

Note this is separate from a **data withdrawal request**, which is a different
thing with different rules and reaches us directly.

## 7. ORCID app

Register the ORCID application with redirect URI:

```
https://psyntient.io/api/public/orcid/callback
```

ORCID stays yours — it is a verification signal about a person, which is your
half of the split. We only ever read the resulting `orcid` field.

## 8. Researcher profiles rendered on psyntient.io (optional, when convenient)

If you want to show a researcher's deposits on their psyntient.io profile,
this endpoint is live and needs no auth:

```
GET https://archive.psyntient.io/repo/api/public/researchers/{account}/projects
```

Published projects only, built from a field allowlist, and the account
identifier never appears in the response. A draft answers 404 rather than
"exists but private" — that a deposit is being prepared is the researcher's to
disclose.

It returns `project_id`, `title`, `description`, `status`, `created_at`,
`updated_at`, `published_at`, `licence`, `doi`.

## 9. Point the marketing pages at the portal

Wherever psyntient.io currently describes the Archive, link to
`https://archive.psyntient.io`. The portal is the destination now; psyntient.io
is where you get an account and a subscription.

---

# What you do NOT need to build

So nobody spends a sprint on the wrong half:

- projects, datasets, files, DOIs, citations, profiles-as-pages — all ours
- the marketing landing page for the Archive — ours, on the portal
- the Node installer or its download page — ours
- anything about withdrawal, consent or data destruction — ours

Your half is: **who is this person, what have they paid for, and are they a
verified researcher.** Three questions, three independent answers.

---

# Priority

1. `role` field (§1) and the `repo` callback (§5) — these block portal work
2. Signup and upgrade return flows (§3, §4) — these block the sign-in journey
3. No tier selection at signup (§2)
4. Account deletion behaviour (§6) — before any deletion flow ships, not after
5. ORCID app (§7)
6. Profile rendering and marketing links (§8, §9) — whenever
