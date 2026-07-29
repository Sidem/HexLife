# `@hexlife/embed`

The shared runtime behind HexLife Explorer and HexLife on Reddit.

Importing the package registers the `<hexlife-world>` custom element:

```js
import '@hexlife/embed'
```

```html
<hexlife-world
  ruleset="00000000000000000000000000000000"
  rows="64"
  seed="12345"
></hexlife-world>
```

Hosts that only need world-code validation and ruleset metadata can use the DOM-free entry:

```js
import {decodeWorldCode, rulesetName} from '@hexlife/embed/api'
```

The browser bundle includes the HexLife Wasm engine. Its public custom-element API is additive and
versioned; world codes (`HXW1.…`) and deterministic simulation behavior are compatibility
contracts. Source and releases are maintained in
[Sidem/HexLife](https://github.com/Sidem/HexLife).
