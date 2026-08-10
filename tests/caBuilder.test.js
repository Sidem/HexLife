import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CA_PRESETS,
  caPreset,
  coffeeDualQuantities,
  coffeeDualTransition,
  coffeeSixFamiliesPreserved,
  coffeeSixTransition,
  seedCaPreset,
  standaloneRuleSource,
} from "../public/ca-builder-models.js";

function unpack(states, packed) {
  return [
    Math.floor(packed / states ** 2),
    Math.floor(packed / states) % states,
    packed % states,
  ];
}

function materialize(states, transition) {
  const rule = new Uint16Array(states ** 3);
  for (let a = 0; a < states; a++) {
    for (let b = 0; b < states; b++) {
      for (let c = 0; c < states; c++) {
        const out = transition([a, b, c]);
        expect(out).toHaveLength(3);
        expect(
          out.every(
            (state) => Number.isInteger(state) && state >= 0 && state < states,
          ),
        ).toBe(true);
        rule[a * states ** 2 + b * states + c] =
          out[0] * states ** 2 + out[1] * states + out[2];
      }
    }
  }
  return rule;
}

describe("k-state CA builder models", () => {
  it("offers both coffee labs plus blank tables for both engine backends", () => {
    expect(CA_PRESETS.map(({ id }) => id)).toEqual([
      "coffee-six",
      "coffee-dual",
      "blank-block",
      "blank-neighborhood",
    ]);
    for (const preset of CA_PRESETS) {
      expect(preset.palette).toHaveLength(preset.states);
      expect(preset.stateNames).toHaveLength(preset.states);
      expect(preset.rows % (preset.backend === "block" ? 3 : 1)).toBe(0);
      expect(
        preset.backend === "block" ? preset.states <= 16 : preset.states <= 4,
      ).toBe(true);
    }
  });

  it("keeps the six-state rule within range and preserves fluid and ground families exhaustively", () => {
    const rule = materialize(6, coffeeSixTransition);
    expect(rule).toHaveLength(216);
    for (let index = 0; index < rule.length; index++) {
      const input = unpack(6, index);
      expect(coffeeSixFamiliesPreserved(input, unpack(6, rule[index]))).toBe(
        true,
      );
    }
  });

  it("keeps all three dual-porosity quantities for every grind and wicking setting", () => {
    for (const grindSlots of [1, 2, 3]) {
      for (const wicking of [false, true]) {
        const transition = (block) =>
          coffeeDualTransition(block, { grindSlots, wicking });
        const rule = materialize(16, transition);
        expect(rule).toHaveLength(4096);
        for (let index = 0; index < rule.length; index++) {
          expect(
            coffeeDualQuantities(unpack(16, index), unpack(16, rule[index])),
          ).toBe(true);
        }
      }
    }
  });

  it("builds deterministic, bounded initial conditions using the element dimensions", () => {
    const first = seedCaPreset("coffee-dual", 66, 76, 1234);
    const again = seedCaPreset("coffee-dual", 66, 76, 1234);
    const other = seedCaPreset("coffee-dual", 66, 76, 1235);
    expect(first).toEqual(again);
    expect(first).not.toEqual(other);
    expect(first).toHaveLength(66 * 76);
    expect(Math.max(...first)).toBeLessThan(caPreset("coffee-dual").states);
    expect(first.slice(0, 76 * 2).every((state) => state === 0)).toBe(true);
    expect(first.slice(-76).every((state) => state === 0)).toBe(true);
  });

  it("emits standalone rule factories rather than callbacks in the tick loop", () => {
    expect(standaloneRuleSource("coffee-six")).toContain(
      "blockRuleFromTable(6, coffeeSixTransition)",
    );
    expect(standaloneRuleSource("coffee-dual")).toContain(
      "blockRuleFromTable(16",
    );
    expect(standaloneRuleSource("blank-neighborhood")).toContain(
      "ruleFromTable(STATES",
    );
  });

  it("emits executable coffee rule source for a standalone host", () => {
    for (const [id, states] of [
      ["coffee-six", 6],
      ["coffee-dual", 16],
    ]) {
      const source = standaloneRuleSource(id);
      const build = new Function(
        "blockRuleFromTable",
        `${source}; return rule;`,
      );
      const rule = build((k, transition) => materialize(k, transition));
      expect(rule).toHaveLength(states ** 3);
    }
  });
});

describe("k-state CA builder package boundary", () => {
  const html = readFileSync(
    new URL("../public/ca-builder.html", import.meta.url),
    "utf8",
  );
  const script = readFileSync(
    new URL("../public/ca-builder.js", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../public/ca-builder.css", import.meta.url),
    "utf8",
  );
  const coffee = readFileSync(
    new URL("../public/coffee-percolation.html", import.meta.url),
    "utf8",
  );
  const caEntry = readFileSync(
    new URL("../src/embed/ca.js", import.meta.url),
    "utf8",
  );
  const caElement = readFileSync(
    new URL("../src/embed/HexCAElement.js", import.meta.url),
    "utf8",
  );
  const renderer = readFileSync(
    new URL("../src/embed/EmbedRenderer.js", import.meta.url),
    "utf8",
  );

  it("loads both public k-state entrypoints from the published npm package", () => {
    expect(html).toContain("npm/@hexlife/embed@1.8.0/ca/+esm");
    expect(html).toContain("npm/@hexlife/embed@1.8.0/ca-element/+esm");
    expect(script).toMatch(/from ["']@hexlife\/embed\/ca["']/);
    expect(script).toMatch(/import ["']@hexlife\/embed\/ca-element["']/);
    expect(html + script).not.toContain("src/embed/");
  });

  it("names the canonical hex slots and the three-cell partition explicitly", () => {
    expect(script).toContain('["SW", "NW", "N", "NE", "SE", "S"]');
    expect(script).toContain('["top", "down-right", "below"]');
    expect(html + script).toContain("rows must be divisible by 3");
    expect(script).toContain("centre * states ** 6");
    expect(script).toContain("states ** slot");
    expect(script).toContain(
      'import { buildHexMirror } from "./coffee-percolation-physics.js"',
    );
    expect(script).toContain("function reflectWorld()");
  });

  it("renders transitions as spatial before-and-after cell diagrams", () => {
    expect(html).toContain('id="current-cells-title">Current cells');
    expect(html).toContain('id="next-cells-title">Next cells');
    expect(html).toContain('id="transition-summary"');
    expect(html).toContain('id="transition-edit-status"');
    expect(script).toContain('cell.className = "rule-cell is-ghost"');
    expect(script).toContain('classList.toggle(\n        "is-changed"');
    expect(script).toContain("Tap a hex to set the state the engine sees.");
    expect(script).toContain("function openStatePicker(select, cell)");
    expect(script).toContain(
      'document.createElement(interactive ? "button" : "span")',
    );
    expect(styles).toContain('.transition-diagram[data-backend="block"]');
    expect(styles).toContain('.rule-cell[data-slot="down-right"]');
    expect(styles).toContain('.rule-cell[data-slot="NW"]');
    expect(styles).toMatch(/\.rule-cell select \{[\s\S]*?opacity: 0;/);
    expect(styles).toContain(".rule-cell.is-changed");
    expect(styles).toContain(".state-picker[hidden]");
    expect(styles).toContain(".state-picker-option.is-selected");
  });

  it("cache-busts the public builder assets as one compatible UI bundle", () => {
    expect(html).toContain("./ca-builder.css?v=20260809-hex-ui");
    expect(html).toContain("./ca-builder.js?v=20260810-stochastic-p2");
  });

  it("keeps the builder and full coffee labs on the same transition functions", () => {
    expect(coffee).toContain("from './ca-builder-models.js'");
    expect(coffee).toContain("blockRuleFromTable(6, coffeeSixTransition)");
    expect(coffee).toContain(
      "coffeeDualTransition(block, { grindSlots, wicking })",
    );
    expect(script).toContain('sourceId.startsWith("coffee-")');
    expect(script).toContain(
      "const mirror = buildHexMirror(ca.rows, ca.columns)",
    );
  });

  it("connects the package element to WorldK and the state-palette shader path", () => {
    expect(caEntry).toContain("import { WorldK }");
    expect(caEntry).toContain("new WorldK(columns, rows, states, tag)");
    expect(caElement).toContain("new EmbedRenderer(this._canvas");
    expect(caElement).toContain("this.renderer.drawStates(this.world.state)");
    expect(renderer).toContain("state_vertex.glsl?raw");
    expect(renderer).toContain("state_fragment.glsl?raw");
    expect(renderer).toContain("drawStates(cells)");
  });
});
