# Reader preferences

These endpoints expose the signed-in user's **reader display settings** — the per-format defaults
that new books open with, and any per-file overrides. Settings are grouped into four **format
groups**: `epub`, `pdf`, `cbx` (comics), and `audio`. A file's format maps to a group (e.g. `mobi`
→ `epub`, `cbz`/`cbr`/`cb7` → `cbx`, `mp3`/`m4b` → `audio`), so a "default" applies to every file
in that group.

The two `GET` routes below are read-only. The corresponding `PUT`/`DELETE` routes that change or
clear settings are out of scope for this read-only reference.

All routes require a Bearer JWT and are scoped to the signed-in user. The settings payloads are
plain user preferences; the examples use the built-in default values.

---

### `GET /api/v1/reader/defaults`

**Purpose:** the user's saved per-format-group default reader settings — what a newly opened book
in each group starts from. Only groups the user has explicitly customized appear as keys; a group
with no saved default is simply absent (the client then falls back to the app's built-in defaults).
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — an object keyed by format group (`epub`, `pdf`, `cbx`, `audio`),
each value the full settings object for that group.

The per-group settings shapes:

**`epub`**

| Field                    | Type           | Description                                           |
| ------------------------ | -------------- | ----------------------------------------------------- |
| `themeName`              | string         | Reader theme name                                     |
| `isDark`                 | boolean        | Dark mode on                                          |
| `fontFamily`             | string \| null | Override font; `null` = book's embedded font          |
| `fontSize`               | number         | Font size, `10`–`32`                                  |
| `lineHeight`             | number         | Line height, `0.8`–`3.0`                              |
| `maxColumnCount`         | number         | Max columns, `1`–`10`                                 |
| `gap`                    | number         | Column gap as a fraction, `0`–`0.5`                   |
| `maxInlineSize`          | number         | Max content width in px, `400`–`1600`                 |
| `maxBlockSize`           | number         | Max content height in px, `600`–`2400`                |
| `justify`                | boolean        | Justify text                                          |
| `hyphenate`              | boolean        | Hyphenate                                             |
| `flow`                   | string         | `"paginated"` or `"scrolled"`                         |
| `overrideBookFormatting` | boolean        | Apply these defaults over the publisher's styles      |
| `footerDisplayMode`      | number         | Footer mode: `0` pages, `1` time/session, `2` chapter |
| `fixedLayoutSpread`      | string         | Fixed-layout spread: `"auto"` or `"none"`             |

**`pdf`**

| Field         | Type   | Description                                               |
| ------------- | ------ | --------------------------------------------------------- |
| `scrollMode`  | string | `"vertical"`, `"horizontal"`, or `"page"`                 |
| `spread`      | string | `"none"`, `"odd"`, `"even"`, or `"auto"`                  |
| `zoomMode`    | string | `"fit-width"`, `"fit-page"`, `"automatic"`, or `"custom"` |
| `customScale` | number | Scale used when `zoomMode` is `"custom"`, `0.25`–`4.0`    |
| `rotation`    | number | `0`, `90`, `180`, or `270`                                |

**`cbx`** (comics)

| Field                   | Type    | Description                                                |
| ----------------------- | ------- | ---------------------------------------------------------- |
| `fitMode`               | string  | `"fit-page"`, `"fit-width"`, `"fit-height"`, or `"actual"` |
| `viewMode`              | string  | `"single"` or `"two-page"`                                 |
| `scrollMode`            | string  | `"paginated"`, `"infinite"`, or `"long-strip"`             |
| `direction`             | string  | `"ltr"` or `"rtl"`                                         |
| `spreadAlignment`       | string  | `"normal"` or `"shifted"`                                  |
| `forceTwoPage`          | boolean | Force two-page spreads                                     |
| `widePageSingletonMode` | string  | `"auto"` or `"disable"`                                    |
| `bgColor`               | string  | `"black"`, `"gray"`, or `"white"`                          |

**`audio`**

| Field                | Type   | Description                    |
| -------------------- | ------ | ------------------------------ |
| `playbackSpeed`      | number | Playback speed, `0.5`–`3.0`    |
| `volume`             | number | Volume, `0.0`–`1.0`            |
| `skipBackSeconds`    | number | Skip-back interval, seconds    |
| `skipForwardSeconds` | number | Skip-forward interval, seconds |

**Example:** (a user who has customized only the `epub` and `audio` groups)

```json
{
  "epub": {
    "themeName": "default",
    "isDark": false,
    "fontFamily": null,
    "fontSize": 16,
    "lineHeight": 1.5,
    "maxColumnCount": 2,
    "gap": 0.05,
    "maxInlineSize": 720,
    "maxBlockSize": 1440,
    "justify": true,
    "hyphenate": true,
    "flow": "paginated",
    "overrideBookFormatting": true,
    "footerDisplayMode": 0,
    "fixedLayoutSpread": "auto"
  },
  "audio": {
    "playbackSpeed": 1.0,
    "volume": 1.0,
    "skipBackSeconds": 10,
    "skipForwardSeconds": 30
  }
}
```

---

### `GET /api/v1/reader/preferences/{bookFileId}`

**Purpose:** the per-file reader settings override for a single book file, if the user has saved
one. Used when opening that specific file so it reopens exactly as last configured.
**Auth:** Bearer JWT required.
**Path params:** `bookFileId` (integer) — the book **file** id (not the book id).
**Query params:** none.
**Returns:** `application/json` — `{ settings, isCustomized }`.

| Field          | Type           | Description                                                                                                             |
| -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `settings`     | object \| null | The saved override for this file, or `null` if none. Shape matches the file's format group (see the group tables above) |
| `isCustomized` | boolean        | `true` when a per-file override exists, else `false`                                                                    |

**Example (a file with a saved override):**

```json
{
  "settings": {
    "themeName": "default",
    "isDark": true,
    "fontFamily": "Serif",
    "fontSize": 18,
    "lineHeight": 1.6,
    "maxColumnCount": 1,
    "gap": 0.05,
    "maxInlineSize": 720,
    "maxBlockSize": 1440,
    "justify": false,
    "hyphenate": true,
    "flow": "scrolled",
    "overrideBookFormatting": true,
    "footerDisplayMode": 0,
    "fixedLayoutSpread": "auto"
  },
  "isCustomized": true
}
```

**Example (no override saved):**

```json
{ "settings": null, "isCustomized": false }
```
