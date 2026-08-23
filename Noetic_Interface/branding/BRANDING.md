# Psyntient Branding Package — v1.0 (Ink & Gold)

For: **Psyntient Node** desktop app (daemon + Noetic Interface web UI)
Source of truth: psyntient.io as of Aug 2026 (`src/styles.css`, `.brand-dark` scope)

---

## 1. The vibe (read this first)

Psyntient looks like **a mystical scientific instrument**. Not a SaaS dashboard, not a
meditation app, not a crypto product.

Think: a leather-bound observatory logbook, printed in warm cream ink, that turns out to
be a live instrument — brass dials, gold leaf, a faint aurora behind the glass. The
software should feel *quiet, precise, and slightly numinous*. Deep ink-black space with
warm cream typography, and gold used like real gold: sparingly, at the moments that
matter.

Emotional targets, in order:

1. **Trust / sovereignty** — this holds your inner life. It must feel vault-grade.
2. **Reverence** — consciousness is the subject. Nothing jokey, nothing neon-hype.
3. **Wonder** — a slow aurora, a glint, a drifting particle. Never a party.
4. **Craft** — generous whitespace, hairline borders, serif headings, monospace kickers.

Anti-patterns (never do these):

- Purple→indigo gradients on white. Generic "AI startup" look.
- Inter / Poppins as the display face.
- Bright saturated neon glows, drop shadows on text, glassmorphism everywhere.
- Emoji in UI chrome. Rounded-bubbly "friendly app" styling.
- Fast, bouncy, spring-y motion. Everything eases slowly.
- Money or numeric value rendered in plain white text (see §8).

Voice: calm, declarative, a little literary. Short sentences. Lowercase-free
sentence case in body copy; ALL-CAPS monospace only for tiny labels.

---

## 2. Color

### 2.1 Core palette (raw brand colors)

| Token | oklch | Hex | Use |
|---|---|---|---|
| `--ink` | `oklch(0.22 0.02 280)` | `#191A24` | Base ink, near-black with violet bias |
| `--cream` | `oklch(0.974 0.018 80)` | `#FDF5E9` | Paper / primary text on ink |
| `--cream-deep` | `oklch(0.945 0.024 78)` | `#F6EBDB` | Deeper paper |
| `--gold` | `oklch(0.82 0.14 85)` | `#EEBC4A` | Primary accent, CTAs, value moments |
| `--gold-deep` | `oklch(0.72 0.16 70)` | `#E38F00` | Amber, gradient partner to gold |
| `--violet` | `oklch(0.52 0.22 300)` | `#8038D1` | Halo, focus rings (site light mode) |
| `--violet-bright` | `oklch(0.58 0.26 295)` | `#8C40FF` | Aurora, glow, gradient partner |
| `--indigo` | `oklch(0.55 0.22 280)` | `#6054EC` | Secondary accent |
| `--azure` | `oklch(0.66 0.18 250)` | `#1795FA` | Gradient tail |
| `--coral` | `oklch(0.68 0.16 18)` | `#EA6972` | Gradient head |
| `--magenta` | `oklch(0.58 0.20 340)` | `#C13B9F` | Gradient |
| `--sunset` | `oklch(0.72 0.20 45)` | `#FF7115` | Cosmic accent (sparing) |
| `--fuchsia-bright` | `oklch(0.62 0.26 350)` | `#EC009C` | Cosmic accent (sparing) |
| `--aqua` | `oklch(0.78 0.16 200)` | `#00D4DF` | Cosmic accent (sparing) |

### 2.2 App semantic tokens — **use these in the Node**

The Node ships **dark-only** (the "ink" theme). This is the `.brand-dark` scope from the site.

| Semantic | oklch | Hex | Notes |
|---|---|---|---|
| `background` | `oklch(0.16 0.04 285)` | `#0C0A1D` | App base. Also set on `<html>` to kill white flashes. |
| `foreground` | `oklch(0.97 0.025 82)` | `#FEF4E3` | Cream body text |
| `card` | `oklch(0.20 0.05 285)` | `#14122B` | Lifted ink surface |
| `popover` | `oklch(0.20 0.05 285)` | `#14122B` | Menus, dialogs |
| `primary` | = gold | `#EEBC4A` | CTA fill |
| `primary-foreground` | `oklch(0.16 0.04 285)` | `#0C0A1D` | Ink text on gold |
| `secondary` / `muted` | `oklch(0.22 0.05 285)` | `#191731` | Chips, inert fills |
| `muted-foreground` | `oklch(0.88 0.035 82)` | `#E3D6BE` | **Warm cream, never gray** |
| `accent` | `oklch(0.24 0.06 300)` | `#241737` | Hover surface |
| `border` / `input` | `oklch(0.32 0.05 285)` | `#302F4B` | Hairline 1px |
| `ring` | = gold | `#EEBC4A` | Focus ring |
| `destructive` | `oklch(0.577 0.245 27.325)` | `#E5484D` | Errors, unpair, revoke |

Critical rule carried over from the site: on ink, **muted text is warm cream at lower
opacity, not gray**. Gray reads as "dead SaaS". If text looks gray, it's wrong.

Status colors: connected/healthy = gold; syncing = violet-bright; idle = muted-foreground
at 70%; error = destructive.

### 2.3 Gradients

```css
--gradient-brand:  linear-gradient(90deg,#EA6972 0%,#C13B9F 30%,#8038D1 55%,#6054EC 78%,#1795FA 100%);
--gradient-cosmic: linear-gradient(115deg,#FF7115 0%,#EC009C 32%,#8C40FF 64%,#00D4DF 100%);
--gradient-gold:   linear-gradient(135deg,#EEBC4A 0%, color-mix(in oklab,#EEBC4A 70%,#8C40FF) 100%);
--gradient-aurora:
  radial-gradient(900px 500px at 15% 0%,  color-mix(in oklab,#EC009C 22%,transparent) 0%, transparent 60%),
  radial-gradient(900px 500px at 85% 10%, color-mix(in oklab,#00D4DF 18%,transparent) 0%, transparent 60%),
  radial-gradient(700px 400px at 50% 100%,color-mix(in oklab,#8C40FF 16%,transparent) 0%, transparent 70%);
--shadow-elegant: 0 30px 80px -40px color-mix(in oklab,#8C40FF 55%,transparent);
```

`gradient-brand` is for **text only** (`text-gradient`) — headline emphasis words, section
kickers. `gradient-gold` is for **primary buttons**. `gradient-aurora` is a
whole-window background wash at very low opacity (≤ 25%) behind the app shell.

---

## 3. Typography

| Role | Family | Weight | Notes |
|---|---|---|---|
| Display / headings | **Instrument Serif** (fallback `ui-serif, Georgia, serif`) | 400 only | `letter-spacing: -0.01em`. Never bold. Italic for emphasis words. |
| Body / UI | **Work Sans** (fallback `ui-sans-serif, system-ui`) | 400 / 500 | `font-feature-settings: "ss01","cv11"` |
| Kickers, labels, data | monospace (`ui-monospace, "IBM Plex Mono", monospace`) | 400 | 10–11px, `uppercase`, `letter-spacing: 0.25em–0.3em` |

Rules:

- Headings are serif, weight 400, **never** 600/700. Scale via size, not weight.
- Emphasis inside a heading = `<em>` in `text-gradient` (brand gradient), or gold.
- Section eyebrows: monospace, uppercase, 10px, 0.3em tracking, gold-tinted cream.
- Body line-height 1.6; measure max ~70ch.
- Numbers in tables/telemetry: monospace, tabular figures.
- No text-shadow in UI. (Glow text is for video/marketing only.)

```css
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Work+Sans:wght@400;500&display=swap');
```

---

## 4. Geometry, surfaces, spacing

- Radius scale from `--radius: 0.5rem`: sm 4px, md 6px, lg 8px, xl 12px, 2xl 16px, 3xl 20px, 4xl 24px.
- **Cards: `rounded-3xl` (20px)** with `1px solid var(--border)` on `var(--card)`.
- **Pills/buttons: fully rounded (`border-radius: 9999px`)** — this is signature Psyntient.
- Inputs: `rounded-xl`, 1px border, ink fill, gold focus ring.
- Borders are always hairline 1px, never 2px except left-rule list items (`border-l-2`).
- Elevation comes from *background lift + hairline*, not heavy shadows. Only CTAs and
  floating chrome get a shadow, and it's colored (gold or violet), never black.
- Spacing rhythm: 4 / 8 / 12 / 16 / 24 / 40 / 64 / 96. Be generous — whitespace is brand.
- Grid: 1px `gap-px` on a `--border` background to create hairline-divided tile groups.

---

## 5. Components

### 5.1 Buttons

**Primary (CTA)** — gold gradient pill, ink text:
```css
background: var(--gradient-gold);
color: #0C0A1D;
border-radius: 9999px;
padding: 12px 20px;         /* text-sm */
box-shadow: 0 12px 32px -14px color-mix(in oklab,#EEBC4A 55%,transparent);
transition: filter .2s ease, transform .2s ease;
:hover { filter: brightness(1.05); }
:active { transform: translateY(1px); }
:focus-visible { outline: 2px solid #EEBC4A; outline-offset: 2px; }
```
Usually contains a trailing 16px `ArrowRight` icon, 8px gap.

**Secondary** — ghost pill: `1px solid color-mix(in oklab, #FEF4E3 20%, transparent)`,
cream text, transparent fill, hover `background: color-mix(in oklab,#FEF4E3 5%,transparent)`.

**Tertiary / link** — cream text with a `1px` bottom border at 30% opacity that goes to
100% on hover. No underline-on-hover jump.

**Destructive** — ghost pill with `--destructive` border and text; fills at 12% on hover.

**Disabled** — 40% opacity, no shadow, `cursor: not-allowed`.

#### 5.1.1 Button color reference (exact values)

| Button | Fill | Text | Border | Hover | Focus ring |
|---|---|---|---|---|---|
| **Primary (gold)** | `linear-gradient(135deg,#F2C862 0%,#EEBC4A 55%,#D9A233 100%)` | `#0C0A1D` ink | none | `brightness(1.05)` | `#EEBC4A` |
| **Primary solid** (tight spaces) | `#EEBC4A` | `#0C0A1D` ink | none | `#F2C862` | `#EEBC4A` |
| **Secondary (ghost)** | transparent | `#FEF4E3` cream | `rgba(254,244,227,.20)` | fill `rgba(254,244,227,.05)`, border `.35` | `#EEBC4A` |
| **Tertiary / link** | none | `#FEF4E3` | bottom `rgba(254,244,227,.30)` | border → `#FEF4E3` | `#EEBC4A` |
| **Gold ghost** (secondary near a gold CTA) | `rgba(238,188,74,.10)` | `#EEBC4A` | `rgba(238,188,74,.35)` | fill `.16` | `#EEBC4A` |
| **Destructive** | `rgba(224,90,74,.10)` | `#E05A4A` | `rgba(224,90,74,.35)` | fill `.18` | `#E05A4A` |
| **Disabled (any)** | inherit at 40% opacity | inherit | inherit | none | none |

Gold ramp, for reference: `#F7DC9A` (light / hover text) · `#F2C862` (gradient start) ·
`#EEBC4A` (**the gold** — primary token) · `#D9A233` (gradient end / pressed) ·
`#A87A22` (deep gold, borders on gold fills only).

Rules: exactly **one** gold-filled button per view — gold means "this is the action."
Everything else is ghost or link. Gold text only on ink, never gold-on-gold. Ink text on
gold fills, never cream (fails contrast). Any numeric money value stays gold text (§8).


### 5.2 Cards / panels
`rounded-3xl`, `bg-card`, hairline border, 20–24px padding. Optional monospace uppercase
label at top in gold-tinted cream, then serif title, then muted-cream body.

### 5.3 Data / telemetry rows
`rounded-2xl` card, monospace 10–11px uppercase label, value in monospace cream. Node
status uses a 6px dot + label; dot is gold when live, with a slow 2.5s pulse.

### 5.4 Navigation / chrome
Translucent ink: `background: color-mix(in oklab, var(--background) 82%, transparent)` +
`backdrop-filter: blur(10px)` + bottom hairline. Nav labels are cream at ~82%, full cream
on hover.

### 5.5 Chat surface (Noetic Interface)
- Assistant bubble: `bg-card`, hairline border, `rounded-3xl` with the corner nearest the
  avatar at `rounded-md`. Cream text, serif for any headline lines.
- User bubble: `color-mix(in oklab,#EEBC4A 12%, var(--card))`, hairline gold-tinted border.
- Composer: pill input, ink fill, gold focus ring, gold circular send button.
- Typing indicator: three 4px gold dots, staggered slow fade (not bounce).
- Avatar: the elf, 32–40px, no enclosing ring (art is already vignetted).

### 5.6 Empty / loading states
Serif one-liner + muted-cream sub-line, centered, with a very faint aurora wash behind.
Skeletons: `bg-muted` shimmer sweeping gold at 8% opacity, 1.6s.

---

## 6. Logo & marks

Files in `./assets/`:

| File | What | Use |
|---|---|---|
| `psyntient-mark.png` | Symbol only, transparent | App icon, titlebar, favicon, nav |
| `psyntient-logo.png` | Full lockup (mark + PSYNTIENT wordmark) | Splash, installer, about box |

Rules:

- Default to the **mark alone** in app chrome. Lockup only on splash/installer/about.
- Minimum size: mark 24px, lockup 120px wide.
- Clear space: 0.5× mark height on all sides.
- Never recolor, rotate, add a drop shadow, or place the mark on a light tile inside the
  ink UI. Never re-add a cream background square.
- Wordmark is set in the display serif, letter-spaced; do not re-typeset it in a sans.
- Splash/loading: mark at 96–128px with a slow `psy-aura` pulse behind it (see §7).

### 6.1 Where the logo goes (required placements)

The logo is **not optional chrome** — every Node screen must carry it once. In a chat-shell
layout (sidebar + conversation + composer, i.e. the webclaw-derived UI), place it like this:

| Slot | What | Size | Notes |
|---|---|---|---|
| **Sidebar header** (primary) | mark + `PSYNTIENT` wordmark, horizontal | mark 24px, wordmark ~13px serif, 0.18em tracking | Top-left, above the conversation list, sitting on the hairline. This is the one required placement. |
| **Collapsed sidebar** | mark only, centered | 24px | Wordmark drops out below ~180px sidebar width. |
| **Empty conversation state** | mark, centered above the serif greeting | 56–72px, 60% opacity + faint aurora | Replaces any generic "how can I help" art. |
| **Titlebar / window frame** | mark only | 18–20px | Desktop wrapper only. |
| **Splash / installer / about** | full lockup | 120–160px wide | With the `psy-aura` pulse. |
| **Tray / dock / favicon** | mark only | 16 / 32 / 128 / 512 | Ship all sizes from `./assets/`. |

Never place the logo in the message stream — that space belongs to the **elf avatar** (§9).
The logo is the *company*; the elf is the *interface*. One is in the frame, the other is in
the conversation. Do not use the elf as the sidebar logo, and do not use the mark as the
assistant avatar.

Sidebar header markup, for reference:

```html
<header class="flex items-center gap-2.5 px-4 h-14 border-b border-[rgba(254,244,227,.10)]">
  <img src="psyntient-mark.png" alt="Psyntient" class="h-6 w-6" />
  <span class="font-serif text-[13px] tracking-[0.18em] text-[#FEF4E3]">PSYNTIENT</span>
  <span class="ml-auto font-mono text-[10px] tracking-[0.2em] text-[rgba(254,244,227,.45)]">NODE</span>
</header>
```

The trailing monospace `NODE` (or `NOETIC`) kicker is how the app identifies itself without
a second logo — that pattern replaces any inherited product name in the shell.


---

## 7. Motion

Slow, eased, atmospheric. Nothing springs.

- Standard transition: `200ms ease` (color/opacity), `300ms cubic-bezier(.22,1,.36,1)` (transform).
- Entrances: fade + 16–20px translateY over 400–600ms, staggered 60–80ms.
- Ambient: aurora / halo pulses on 7–14s loops at low opacity.
- `psy-aura` — scale 1→1.18, opacity .35→.7, 7s ease-in-out infinite (logo halo, live dot).
- `psy-bloom` — scale .6→1.7 with blur, opacity 0→.55→0, 9s (particle bloom).
- `psy-morph` — scale ±6% with hue-rotate 0→360deg, 14s (psychedelic logo only).
- Always honor `@media (prefers-reduced-motion: reduce)` → `animation: none`.
- Keep ambient graphics **dim**. If a background graphic competes with text, it's too bright.

---

## 8. Content & value rules (carried from the site)

1. Always write the full name **"Psyntient Ground"** — never just "Ground".
2. Any numeric money value on screen renders in **gold** text.
3. Use subtle gold imagery (glint, coin, gilding) at money/value/payoff moments only;
   decorative gold ≤ 70% opacity.
4. Product naming, exact: **Neural Vault**, **Psyntient Node**, **Cortex**,
   **Noetic Interface**, **Noetic Archive**, **Architect Agent**, **Applications**,
   **Science Advisory Network**.
5. Say "domain-specific operating system" / "Psyntient OS" — not "an OS for the brain".
6. Sovereignty language everywhere the Vault appears: *your data, your machine, your keys.*

---

## 9. The magic elf — Noetic Interface chat persona

The elf is the **face of the Noetic Interface only** — a helpful arcane scholar. It is not
the company logo, never appears next to the Psyntient mark in chrome, and never appears in
investor or scientific material.

Files in `./assets/` (all transparent PNG, square, centered):

| File | Description |
|---|---|
| `noetic-elf-icon.png` + `-512/-256/-128/-64/-32` | Starlit navy top hat, gold filigree, cosmic vignette. **Primary chat launcher / app shortcut icon.** |
| `noetic-elf-avatar.png` + `-512/-256/-128/-64/-32` | Straight-on portrait, no vignette. **In-chat message avatar.** |

Usage:

- Chat launcher (floating button): `noetic-elf-icon-128.png` inside a 56px ink-glass circle
  — `background: color-mix(in oklab, var(--background) 82%, transparent)`,
  `1px solid color-mix(in oklab,#EEBC4A 55%,transparent)`, `backdrop-filter: blur(10px)`,
  `box-shadow: 0 20px 50px -20px color-mix(in oklab,#EEBC4A 40%,transparent)`.
- Message avatar: `noetic-elf-avatar-64.png` at 32–40px, no ring, no border.
- Desktop shortcut / tray: use the Psyntient **mark**, not the elf, unless the shortcut
  literally opens the chat.
- Never crop the ears out, never desaturate, never place on a white tile.
- Idle affordance: 8s `psy-aura` glow behind the launcher; stops on hover.

---

## 10. Drop-in CSS for the Node

```css
:root {
  color-scheme: dark;
  --background:#0C0A1D; --foreground:#FEF4E3;
  --card:#14122B;       --card-foreground:#FEF4E3;
  --popover:#14122B;    --popover-foreground:#FEF4E3;
  --primary:#EEBC4A;    --primary-foreground:#0C0A1D;
  --secondary:#191731;  --secondary-foreground:#FEF4E3;
  --muted:#191731;      --muted-foreground:#E3D6BE;
  --accent:#241737;     --accent-foreground:#FEF4E3;
  --destructive:#E5484D;--destructive-foreground:#FEF4E3;
  --border:#302F4B;     --input:#302F4B; --ring:#EEBC4A;
  --radius:0.5rem;
  --font-display:"Instrument Serif", ui-serif, Georgia, serif;
  --font-sans:"Work Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, "IBM Plex Mono", monospace;
}
html, body {
  background:var(--background); color:var(--foreground);
  font-family:var(--font-sans); font-feature-settings:"ss01","cv11";
}
h1,h2,h3,h4 { font-family:var(--font-display); font-weight:400; letter-spacing:-0.01em; }
::selection { background: color-mix(in oklab,#EEBC4A 35%,transparent); }
```

Set the `<html>` background in the static HTML shell too, so the window never flashes
white while the app boots.

---

## 11. Checklist before shipping a Node screen

- [ ] Background is ink; no white anywhere except intentional cream text.
- [ ] Headings serif 400; no bold serif.
- [ ] Secondary text is warm cream, not gray.
- [ ] Exactly one gold CTA per view.
- [ ] Buttons are full pills; cards are `rounded-3xl` with hairline borders.
- [ ] Focus rings visible and gold.
- [ ] Motion is slow and eased; reduced-motion respected.
- [ ] Money values in gold.
- [ ] Elf only in the Noetic Interface chat; mark elsewhere.
- [ ] No white flash on cold start.
