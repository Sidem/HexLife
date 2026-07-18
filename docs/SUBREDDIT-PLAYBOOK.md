# r/hexlife — Owner's Playbook

Operational guide for running and growing the subreddit. This is owner-facing (Reddit mod tools),
not code — the app-side share flow is documented in `DEVVIT-PLAN.md` and the README.

Reddit's mod UI gets reshuffled every year or so; every item below is named by **feature**, so if a
path doesn't match, search that feature name in **Mod Tools**. Everything here is reachable from
your subreddit → **Mod Tools** (shield icon / left sidebar) while logged in as the owner.

---

## 1. One-time setup checklist

Do these once, roughly in order. Items marked ★ matter most for growth.

### 1.1 ★ Community description + topics — Mod Tools → Settings → General

- **Community description** (~500 chars max; shows in search results, discovery, and the About
  panel — this is your storefront). Suggested text:

  > HexLife is a hexagonal cellular-automaton lab that runs in your browser. Post **Live
  > Specimens** — playable worlds that run right inside the Reddit feed — remix other people's
  > worlds, and hunt for gliders, blooms and crystals in a 2^128 rule space. Press ▶ on any post to
  > watch it live. Free, open source, no install: sidem.github.io/HexLife

- **Community topics**: pick the closest 2–3 (e.g. *Programming*, *Science*, *Simulation Games*).
  Topics feed Reddit's recommendation engine — an empty topic list means no discovery traffic.
- **Community type**: Public. Mature (18+): off.
- **Discoverability** (same settings area, sometimes under "Privacy & discoverability"): enable
  "appear in feeds/recommendations" and indexing. All discovery toggles ON.

### 1.2 ★ Appearance — Mod Tools → Community Appearance

- **Icon / avatar**: ≥256×256 PNG. Render the hex glyph from `favicon.svg` on the app's dark
  background — it must read at 32 px in a feed.
- **Banner**: ~1920×384 (desktop; mobile center-crops, so keep the subject centered). Best source:
  open the Explorer, load a colorful dense world, and use **Capture Studio → Export PNG**, then
  crop. A real running world beats any abstract graphic — it *is* the product.
- **Accent/key color**: match the app palette (the dark `#0C0E10` + one accent).

### 1.3 Rules — Mod Tools → Rules (or "Rules & Removal Reasons")

Keep it short — a five-page rulebook on a small sub scares off the first posters. Suggested five:

1. **Stay on topic** — HexLife worlds, rulesets, cellular automata, and closely related tinkering.
2. **Live Specimens are the house specialty** — post one via **Open lab** → **Post my remix**, or
   the community ⋯ menu → **New HexLife post**. Screenshots/videos of worlds are welcome too.
3. **Share the recipe when asked** — if someone asks for your world code or ruleset hex, post it
   (that's the fun).
4. **Be constructive** — critique rulesets, not people.
5. **No spam** — one post per specimen; no unrelated self-promotion.

### 1.4 ★ Post flairs — Mod Tools → Post Flair

Create these, enable **"allow users to assign their own flair to posts"**:

| Flair | Use |
|---|---|
| 🧬 Live Specimen | interactive posts (the default content) |
| 🎨 Showcase | screenshots / videos / GIFs |
| 🔬 Ruleset talk | discussing rule mechanics, discoveries |
| ❓ Help | how-do-I questions |
| 🏆 Challenge | weekly/periodic challenges + entries |
| 📢 Meta | subreddit / app announcements |

(Devvit-created posts can't pre-set flair from the form; authors add it after posting — mention
this in the pinned guide.)

### 1.5 User flairs — Mod Tools → User Flair

A few self-assignable fun ones (e.g. *Gardener*, *Rule Smith*, *Glider Hunter*) plus a mod-assigned
**⚑ Challenge Winner**. Cheap identity = retention.

### 1.6 ★ Pinned posts — "Community Highlights"

Create these two posts, then on each post open **⋯ → Add to Community Highlights** (the modern
"pin"; up to ~6 slots):

**Pin A — a killer Live Specimen (the sub's front door).**
Create it yourself via ⋯ → **New HexLife post** with your best world. Title it so it doubles as a
call-to-action, e.g.:

> **This post is alive — press ▶. Open lab to draw, then hit "Post my remix".**

Pinning a strong specimen puts the in-app create loop (**Open lab** → draw → **Post my remix**) at
the top of the feed — no explorer, no code paste required.

**Pin B — "Start here" text guide.** Suggested body:

```markdown
**What is this?** HexLife is a cellular automaton on a hexagonal grid — simple birth/survival
rules, complex emergent life. The posts here marked 🧬 are **Live Specimens**: real simulations
running in the post. Press ▶.

**Post your own world — three ways, easiest first:**

1. **From any Live Specimen post:** press **Open lab**, draw on the world, and hit **Post my
   remix** — no explorer needed.
2. **From the full lab:** open [HexLife Explorer](https://sidem.github.io/HexLife/), build a world,
   then **Share → Copy post kit & open r/hexlife** (or *My Rulesets → Share on Reddit*). Come back
   here, open the community **⋯ menu → New HexLife post**, paste the kit, submit. Your name,
   description and tags ride along automatically — leave the title field blank to use them.
3. **Just the code:** a text post whose body is only a `HXW1.…` world code gets auto-converted —
   the app replies with a link to the live version.

**What's a world code?** A `HXW1.…` string is a complete world snapshot — grid, ruleset, cells,
colors — that anyone can run or remix. Sharing codes is the whole game.

**Flair your post** after submitting (🧬 Live Specimen, 🎨 Showcase, …).

App is free & open source: [GitHub](https://github.com/Sidem/HexLife) ·
[Explorer](https://sidem.github.io/HexLife/)
```

### 1.7 Sidebar widgets — Mod Tools → Community Appearance → Sidebar / Widgets

- **Text widget — "Post a living world"**: the 3-step list from Pin B, condensed.
- **Button widget**: `▶ Open HexLife Explorer` → `https://sidem.github.io/HexLife/` and
  `Source on GitHub` → `https://github.com/Sidem/HexLife`.
- **Old Reddit parity**: Mod Tools → the old-reddit description field (markdown sidebar) — paste
  the same links + steps. Old-reddit visitors see the specimen `textFallback`, which already
  deep-links to the Explorer.

### 1.8 Welcome message — Mod Tools → Settings → General → "Welcome message"

Enable "send a welcome message to new members". Suggested text:

> Welcome to r/hexlife! Every 🧬 post here is a live simulation — press ▶ to run it. Want to post
> your own? Press **Open lab**, draw, and hit **Post my remix** — or start in the
> [Explorer](https://sidem.github.io/HexLife/) and use Share → Copy post kit. The pinned "Start
> here" post has the full 60-second guide.

### 1.9 Posts & comments settings — Mod Tools → Settings → Posts and Comments

- **Keep text posts enabled.** The app's auto-converter (pure `HXW1.…` text body → Live Specimen)
  depends on them.
- Leave media posts on (Showcase flair needs video/images).
- Crossposting: allowed.

### 1.10 AutoModerator — Mod Tools → Automations

Skip heavy automod at this size (friction kills tiny subs). Two light rules worth having:

- A gentle comment on posts flaired ❓ Help pointing at the pinned guide.
- Standard spam guard only if spam actually appears — not preemptively.

---

## 2. Recurring operations (the growth engine)

A subreddit under ~1k members grows on **cadence and response time**, not settings. Settings above
are table stakes; this section is what actually grows it.

- **★ Post 2–3× per week yourself** until others do. A visitor who lands on a sub whose newest
  post is 3 weeks old does not subscribe. Rotate: a specimen, a challenge, a "found this weird
  ruleset" discussion.
- **★ Reply to every post and comment within a few hours** in the early months. First-poster churn
  is brutal; a reply from the creator is a retention event.
- **Weekly showcase thread** — Mod Tools → **Scheduled Posts**: e.g. "Specimen Sunday — drop your
  best world of the week (codes welcome)". Same slot every week.
- **Challenges (best engagement lever this niche has)**: biweekly 🏆 post with a constraint, e.g.
  *"Smallest ruleset that produces a glider"*, *"Most beautiful world from a 5% fill"*, *"Make
  something that dies at exactly generation 100"*. Winner gets the ⚑ Challenge Winner flair and
  their specimen pinned for the week. Judging = upvotes, tie broken by you.
- **Crosspost outward, carefully**: r/cellular_automata, r/generative, r/proceduralgeneration,
  r/creativecoding, r/mathpics; Devvit's own r/GamesOnReddit; one-time launch posts to
  r/InternetIsBeautiful / r/WebGames. Read each sub's self-promo rules first, participate before
  posting, and link the *subreddit or a specimen*, not a bare app pitch. Off-Reddit: Hacker News
  "Show HN", lobste.rs, the cellular-automata Discord/Mastodon circles.
- **Publish the Devvit app to the App Directory** (`npx devvit publish` — already the open #26
  owner step). Removes the <200-member install cap and lists HexLife in Reddit's app directory —
  its own discovery channel.
- **Skip Reddit ads** at this stage; organic niche crossposting converts better for hobby subs.

---

## 3. "New HexLife post" discoverability — what's fixable and what isn't

**Platform constraint (can't fix):** Devvit apps cannot add buttons to the subreddit header, the
post composer, or any URL-reachable form. The ⋯ overflow menu placement is Reddit's, full stop
(documented in `src/ui/UIManager.js` and `src/services/RedditShareService.js`).

**Already-shipped mitigations (app code):**

- Expanded view has **Post my remix**: draw on someone's world, one button, posted — the primary
  in-app create path (no code paste). Lab also keeps **Create your own** for paste-a-code.
- Pure-`HXW1` text posts are auto-converted, with a courtesy comment linking the live version.
- Explorer post kits carry title/description/tags into the form so the paste is one field.

**Owner-side levers (this playbook):** pinned specimen with a CTA title (§1.6 Pin A — the big
one), pinned guide (Pin B), sidebar widget, welcome message. Once a specimen is pinned, **Open lab**
→ **Post my remix** is the front door; the ⋯ menu is the explorer/paste fallback.

**Possible future code tweaks (deliberately not done yet):**

- Append a "Make your own: Open lab → Post my remix" line to the app's first-comment enrichment on
  every specimen. Cheap, but adds comment noise — revisit if the pinned specimen alone doesn't
  convert.
- Emoji-prefix the menu label ("🧬 New HexLife post") to stand out inside the ⋯ menu. Cosmetic.
