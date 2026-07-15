# HexLife on Reddit — Devvit Web app (#26)

**App:** `hexlifeapp` · **Subreddit:** r/hexlife · **Location:** `devvit/`

---

## Status (2026-07-15)

| Phase | Status |
|---|---|
| 0–2c | ✅ Built; playtest green on r/hexlife (owner-confirmed) |
| Share / create UX honesty | ✅ Menu form is the real create path; explorer copies code + opens sub |
| **Phase 3 — publish polish** | **Ready for owner `devvit publish`** |
| Phase 4 — Daily Hex on Reddit | Later (#17) |

---

## How posts get created (limitations — read this)

| Path | Works? | Notes |
|---|---|---|
| **⋯ → New HexLife post** (app menu form) | ✅ Supported | Only way to create a Live Specimen deliberately |
| Explorer “Copy code & open r/hexlife” | ✅ Helper | Copies `HXW1.…`, opens the sub — user still uses the menu |
| `/r/hexlife/submit` text composer | ❌ Not a custom post | Reddit has **no URL** that opens a Devvit form from outside |
| Pure-HXW1 text post → `onPostSubmit` upgrade | ⚠️ Best-effort | May fail silently; not the product path |

**Publishing does not add** an external “create interactive post” deep link. Publishing:

- Allows install on larger subs (lifts &lt;200-subscriber unpublished cap)
- Puts the app through Reddit review (unlisted by default, or `--public` for the directory)
- Enables broader install by other mods after approval

**User must:**

1. Be able to post on the sub (not banned; sub allows their account type)
2. Use a sub where **hexlifeapp is installed**
3. Use **⋯ → New HexLife post** (now `forUserType: "user"`, not mods-only)
4. For the explorer helper: clipboard + open r/hexlife (logged into Reddit in that browser)

Joining r/hexlife is normal for members but “joined” is not a special Devvit gate — **install + menu** is.

---

## Product (v1)

Live Specimen: world code in Redis → `<hexlife-world code>` paused, play/pause/restart/speed/zoom.
No external fetch. Demo post on install if no code.

---

## Owner publish checklist

1. **README** — `devvit/readme.md` (review-required; not the bare template). ✅ In repo.
2. **Playtest** — already green on r/hexlife desktop (re-check phone if needed).
3. **Upload + publish** (from `devvit/`, Node 22.6):

```powershell
$env:PATH = "C:\Program Files\Git\bin;" + $env:PATH
cd <repo>/devvit
fnm use 22.6.0
git pull   # include latest polish
npm test
npx devvit upload          # private build (optional if publish uploads anyway)
npx devvit publish         # unlisted after approval — fine for r/hexlife only
# OR for App Directory listing:
# npx devvit publish --public
```

4. **After approval email** — reinstall/update on r/hexlife if needed; pin a demo post; update
   subreddit sidebar with create instructions.
5. **Do not** claim one-click create from the explorer; document the menu path for members.

Review: typically ~1–2 business days (up to ~a week). Contact r/Devvit if stuck.

---

## Architecture (unchanged)

`devvit/` consumes `src/embed/`; world codes in Redis `world:<t3>`; menu + form create posts;
`onPostDelete` clears Redis; optional `onPostSubmit` pure-code upgrade.

## Rollback

`checkpoint/pre-devvit-extensions-2026-07-15`
