/**
 * @id PP-MGR-LIB-023
 * @name layoutGraph oracle tests
 * @implements-rules-version v1 (POO-2153 rules v1)
 * @analytics-events none, a pure geometry module: nothing here is rendered or tracked.
 *
 * Table-driven oracles: the layout of a fixture must reproduce every coordinate of its source.
 *
 * Two kinds of source:
 *
 * 1. The handoff v1.2 tables and numbers: worked example 1 (canvas C, 608 x 674), worked example 2
 *    (928 x 772), Build state 5 (552 x 650) and canvas D (468 x 572 with a 420 px sentence). Each
 *    number is checked exactly; a handoff "line" is the union of the horizontal runs of that kind
 *    at that y (rule L10); a share label is centred within 0.5 px.
 * 2. The Figma frames, measured node by node (prerequisite task PT-1, file jjOf5DL9uVEB7WBR9nGb4A,
 *    read 2026-10-03): canvas A (graph 8219:2481), canvas B (8207:2481), canvas C (8220:2481),
 *    canvas D (8172:2110), Build state 3 (8130:4749) and Build state 5 (8145:2689). Every box is
 *    compared exactly, the full list of line rectangles is compared as a multiset (Figma draws each
 *    segment as a 1.5 px rectangle: x - 0.75 for a vertical, the top edge for a horizontal), share
 *    labels and network chips within 0.5 px (Figma centres a 45 px label at x + 22.5), ports exactly.
 *    Build state 5 is drawn scaled to fit (0.8981 = 495.77 / 552): its values are the Figma numbers
 *    divided back by that scale, each within 0.01 of the value written here.
 */
import { describe, expect, it } from "vitest";
import {
  type BuildCanvasFixture,
  buildState3,
  buildState5,
  canvasA,
  canvasB,
  canvasC,
  canvasD,
  workedExample2,
} from "@/mocks/data/buildCanvasFixtures";
import type { EdgeKind } from "./graphTypes";
import { layoutGraph } from "./layoutGraph";
import {
  box,
  type FigmaEdge,
  figmaEdges,
  horizontalRuns,
  K,
  labelKey,
  nodeRects,
  sortEdges,
  verticalsAt,
  verticalXs,
} from "./layoutTestKit";

const EN = { startHereWidth: 420 };

type Box = [number, number, number, number];
type EdgeRow = [keyof typeof K, number, number, number, number];

interface FigmaOracle {
  name: string;
  source: string;
  fixture: BuildCanvasFixture;
  size: [number, number];
  nodes: Record<string, Box>;
  edges: EdgeRow[];
  labels: Array<[string, number, number]>;
  ports: Array<["before" | "after", string, number, number]>;
  chips?: Array<[string, number, number]>;
}

function toFigma(rows: EdgeRow[]): FigmaEdge[] {
  return sortEdges(rows.map(([k, x, y, w, h]): FigmaEdge => [K[k] as EdgeKind, x, y, w, h]));
}

// ---------------------------------------------------------------------------
// Figma, node by node (PT-1)
// ---------------------------------------------------------------------------

const CANVAS_C: FigmaOracle = {
  name: "canvas C",
  source: "Figma 8220:2481",
  fixture: canvasC,
  size: [608, 674],
  nodes: {
    deposit: [186, 24, 236, 62],
    idleInput: [186, 110, 236, 62],
    idleOutput: [52, 478, 236, 62],
    income: [320, 478, 236, 62],
    withdraw: [186, 588, 236, 62],
    "c-pool-swap": [24, 244, 176, 26],
    "c-pool-pool": [24, 294, 176, 62],
    "c-pool-fees": [24, 380, 176, 26],
    "c-supply-supply": [232, 244, 176, 62],
    "addProtocol:arbitrum": [440, 244, 40, 40],
    addNetwork: [520, 228, 64, 72],
  },
  edges: [
    ["S", 111.25, 270, 1.5, 24],
    ["S", 111.25, 356, 1.5, 24],
    ["T", 459.25, 196, 1.5, 48],
    ["T", 551.25, 196, 1.5, 32],
    ["S", 303.25, 86, 1.5, 24],
    ["S", 303.25, 172, 1.5, 24],
    ["S", 112, 196, 440, 1.5],
    ["S", 111.25, 196, 1.5, 48],
    ["S", 319.25, 196, 1.5, 48],
    ["P", 99.25, 406, 1.5, 24],
    ["I", 123.25, 406, 1.5, 48],
    ["P", 319.25, 306, 1.5, 124],
    ["P", 100, 430, 220, 1.5],
    ["P", 169.25, 430, 1.5, 48],
    ["I", 124, 454, 314, 1.5],
    ["I", 437.25, 454, 1.5, 24],
    ["S", 169.25, 540, 1.5, 24],
    ["I", 437.25, 540, 1.5, 24],
    ["S", 170, 564, 268, 1.5],
    ["S", 303.25, 564, 1.5, 24],
  ],
  labels: [
    ["c-pool", 112.5, 220],
    ["c-supply", 320.5, 220],
  ],
  ports: [
    ["before", "c-supply-supply", 320, 244],
    ["after", "c-supply-supply", 320, 306],
  ],
};

const CANVAS_D: FigmaOracle = {
  name: "canvas D",
  source: "Figma 8172:2110",
  fixture: canvasD,
  size: [468, 572],
  nodes: {
    deposit: [116, 24, 236, 62],
    idleInput: [116, 110, 236, 62],
    idleOutput: [116, 400, 236, 62],
    withdraw: [116, 486, 236, 62],
    "addProtocol:arbitrum": [154, 244, 40, 40],
    addNetwork: [262, 228, 64, 72],
  },
  edges: [
    ["T", 173.25, 196, 1.5, 48],
    ["T", 293.25, 196, 1.5, 32],
    ["S", 233.25, 86, 1.5, 24],
    ["S", 233.25, 172, 1.5, 24],
    ["S", 174, 196, 120, 1.5],
    ["S", 233.25, 462, 1.5, 24],
  ],
  labels: [],
  ports: [],
};

const CANVAS_B: FigmaOracle = {
  name: "canvas B",
  source: "Figma 8207:2481",
  fixture: canvasB,
  size: [1248, 624],
  nodes: {
    deposit: [506, 24, 236, 62],
    idleInput: [506, 110, 236, 62],
    idleOutput: [506, 452, 236, 62],
    withdraw: [506, 538, 236, 62],
    "b-hub-1-supply": [24, 244, 176, 62],
    "b-hub-2-swap": [232, 244, 176, 26],
    "b-hub-2-supply": [232, 294, 176, 62],
    "addProtocol:arbitrum": [440, 244, 40, 40],
    "group:base": [520, 228, 280, 192],
    "bridge:base": [572, 244, 176, 26],
    "b-base-1-supply": [536, 342, 176, 62],
    "addProtocol:base": [744, 342, 40, 40],
    "group:polygon": [840, 228, 280, 192],
    "bridge:polygon": [892, 244, 176, 26],
    "b-polygon-1-supply": [856, 342, 176, 62],
    "addProtocol:polygon": [1064, 342, 40, 40],
    addNetwork: [1160, 228, 64, 72],
  },
  edges: [
    ["S", 319.25, 270, 1.5, 24],
    ["T", 459.25, 196, 1.5, 48],
    ["S", 659.25, 270, 1.5, 24],
    ["S", 624, 294, 140, 1.5],
    ["S", 623.25, 294, 1.5, 48],
    ["T", 763.25, 294, 1.5, 48],
    ["S", 979.25, 270, 1.5, 24],
    ["S", 944, 294, 140, 1.5],
    ["S", 943.25, 294, 1.5, 48],
    ["T", 1083.25, 294, 1.5, 48],
    ["T", 1191.25, 196, 1.5, 32],
    ["S", 623.25, 86, 1.5, 24],
    ["S", 623.25, 172, 1.5, 24],
    ["S", 112, 196, 1080, 1.5],
    ["S", 111.25, 196, 1.5, 48],
    ["S", 319.25, 196, 1.5, 48],
    ["S", 659.25, 196, 1.5, 48],
    ["S", 979.25, 196, 1.5, 48],
    ["P", 111.25, 306, 1.5, 122],
    ["P", 319.25, 356, 1.5, 72],
    ["P", 623.25, 404, 1.5, 24],
    ["P", 943.25, 404, 1.5, 24],
    ["P", 112, 428, 832, 1.5],
    ["P", 623.25, 428, 1.5, 24],
    ["S", 623.25, 514, 1.5, 24],
  ],
  labels: [
    ["b-hub-1", 112.5, 220],
    ["b-hub-2", 320.5, 220],
    ["spoke:base", 660.5, 212],
    ["b-base-1", 624.5, 318],
    ["spoke:polygon", 980.5, 212],
    ["b-polygon-1", 944.5, 318],
  ],
  ports: [
    ["before", "b-hub-1-supply", 112, 244],
    ["after", "b-hub-1-supply", 112, 306],
    ["after", "b-hub-2-supply", 320, 356],
    ["before", "b-base-1-supply", 624, 342],
    ["after", "b-base-1-supply", 624, 404],
    ["before", "b-polygon-1-supply", 944, 342],
    ["after", "b-polygon-1-supply", 944, 404],
  ],
  // Figma chip: 21 high at y 217, so its centre is 227.5 on the 228 border.
  chips: [
    ["base", 532, 227.5],
    ["polygon", 852, 227.5],
  ],
};

const CANVAS_A: FigmaOracle = {
  name: "canvas A",
  source: "Figma 8219:2481 (the frame is 2356 wide because the open menu is drawn inside it)",
  fixture: canvasA,
  size: [2080, 772],
  nodes: {
    deposit: [922, 24, 236, 62],
    idleInput: [922, 110, 236, 62],
    idleOutput: [788, 576, 236, 62],
    income: [1056, 576, 236, 62],
    withdraw: [922, 686, 236, 62],
    "a-hub-1-swap": [24, 244, 176, 26],
    "a-hub-1-pool": [24, 294, 176, 62],
    "a-hub-1-fees": [24, 380, 176, 26],
    "a-hub-2-supply": [232, 244, 176, 62],
    "a-hub-2-swap": [232, 330, 176, 26],
    "a-hub-2-pool": [232, 380, 176, 62],
    "a-hub-2-fees": [232, 466, 176, 26],
    "a-hub-3-swap": [440, 244, 176, 26],
    "a-hub-3-supply": [440, 294, 176, 62],
    "a-hub-3-borrow": [440, 380, 176, 62],
    "addProtocol:arbitrum": [648, 244, 40, 40],
    "group:base": [728, 228, 696, 292],
    "bridge:base": [988, 244, 176, 26],
    "a-base-1-swap": [744, 342, 176, 26],
    "a-base-1-pool": [744, 392, 176, 62],
    "a-base-1-fees": [744, 478, 176, 26],
    "a-base-2-swap": [952, 342, 176, 26],
    "a-base-2-pool": [952, 392, 176, 62],
    "a-base-2-fees": [952, 478, 176, 26],
    "a-base-3-supply": [1160, 342, 176, 62],
    "addProtocol:base": [1368, 342, 40, 40],
    "group:robinhood": [1464, 228, 488, 292],
    "bridge:robinhood": [1620, 244, 176, 26],
    "a-rh-1-swap": [1480, 342, 176, 26],
    "a-rh-1-pool": [1480, 392, 176, 62],
    "a-rh-1-fees": [1480, 478, 176, 26],
    "a-rh-2-swap": [1688, 342, 176, 26],
    "a-rh-2-pool": [1688, 392, 176, 62],
    "a-rh-2-fees": [1688, 478, 176, 26],
    "addProtocol:robinhood": [1896, 342, 40, 40],
    addNetwork: [1992, 228, 64, 72],
  },
  edges: [
    ["S", 111.25, 270, 1.5, 24],
    ["S", 111.25, 356, 1.5, 24],
    ["S", 319.25, 306, 1.5, 24],
    ["S", 319.25, 356, 1.5, 24],
    ["S", 319.25, 442, 1.5, 24],
    ["S", 527.25, 270, 1.5, 24],
    ["S", 527.25, 356, 1.5, 24],
    ["T", 667.25, 196, 1.5, 48],
    ["S", 1075.25, 270, 1.5, 24],
    ["S", 832, 294, 556, 1.5],
    ["S", 831.25, 294, 1.5, 48],
    ["S", 831.25, 368, 1.5, 24],
    ["S", 831.25, 454, 1.5, 24],
    ["S", 1039.25, 294, 1.5, 48],
    ["S", 1039.25, 368, 1.5, 24],
    ["S", 1039.25, 454, 1.5, 24],
    ["S", 1247.25, 294, 1.5, 48],
    ["T", 1387.25, 294, 1.5, 48],
    ["S", 1707.25, 270, 1.5, 24],
    ["S", 1568, 294, 348, 1.5],
    ["S", 1567.25, 294, 1.5, 48],
    ["S", 1567.25, 368, 1.5, 24],
    ["S", 1567.25, 454, 1.5, 24],
    ["S", 1775.25, 294, 1.5, 48],
    ["S", 1775.25, 368, 1.5, 24],
    ["S", 1775.25, 454, 1.5, 24],
    ["T", 1915.25, 294, 1.5, 48],
    ["T", 2023.25, 196, 1.5, 32],
    ["S", 1039.25, 86, 1.5, 24],
    ["S", 1039.25, 172, 1.5, 24],
    ["S", 112, 196, 1912, 1.5],
    ["S", 111.25, 196, 1.5, 48],
    ["S", 319.25, 196, 1.5, 48],
    ["S", 527.25, 196, 1.5, 48],
    ["S", 1075.25, 196, 1.5, 48],
    ["S", 1707.25, 196, 1.5, 48],
    ["P", 99.25, 406, 1.5, 122],
    ["I", 123.25, 406, 1.5, 146],
    ["P", 307.25, 492, 1.5, 36],
    ["I", 331.25, 492, 1.5, 60],
    ["P", 527.25, 442, 1.5, 86],
    ["P", 819.25, 504, 1.5, 24],
    ["I", 843.25, 504, 1.5, 48],
    ["P", 1027.25, 504, 1.5, 24],
    ["I", 1051.25, 504, 1.5, 48],
    ["P", 1247.25, 404, 1.5, 124],
    ["P", 1555.25, 504, 1.5, 24],
    ["I", 1579.25, 504, 1.5, 48],
    ["P", 1763.25, 504, 1.5, 24],
    ["I", 1787.25, 504, 1.5, 48],
    ["P", 100, 528, 1664, 1.5],
    ["P", 905.25, 528, 1.5, 48],
    ["I", 124, 552, 1664, 1.5],
    ["I", 1173.25, 552, 1.5, 24],
    ["S", 905.25, 638, 1.5, 24],
    ["I", 1173.25, 638, 1.5, 24],
    ["S", 906, 662, 268, 1.5],
    ["S", 1039.25, 662, 1.5, 24],
  ],
  labels: [
    ["a-hub-1", 112.5, 220],
    ["a-hub-2", 320.5, 220],
    ["a-hub-3", 528.5, 220],
    ["spoke:base", 1076.5, 212],
    ["a-base-1", 832.5, 318],
    ["a-base-2", 1040.5, 318],
    ["a-base-3", 1248.5, 318],
    ["spoke:robinhood", 1708.5, 212],
    ["a-rh-1", 1568.5, 318],
    ["a-rh-2", 1776.5, 318],
  ],
  ports: [
    ["before", "a-hub-2-supply", 320, 244],
    ["after", "a-hub-3-borrow", 528, 442],
    ["before", "a-base-3-supply", 1248, 342],
    ["after", "a-base-3-supply", 1248, 404],
  ],
  chips: [
    ["base", 740, 227.5],
    ["robinhood", 1476, 227.5],
  ],
};

const BUILD_STATE_3: FigmaOracle = {
  name: "Build state 3",
  source: "Figma 8130:4749 (drawn at 100%)",
  fixture: buildState3,
  size: [400, 576],
  nodes: {
    deposit: [82, 24, 236, 62],
    idleInput: [82, 110, 236, 62],
    idleOutput: [82, 404, 236, 62],
    withdraw: [82, 490, 236, 62],
    "s3-swap": [24, 244, 176, 26],
    "s3-pool": [24, 294, 176, 62],
    "addProtocol:arbitrum": [232, 244, 40, 40],
    addNetwork: [312, 228, 64, 72],
  },
  edges: [
    ["S", 111.25, 270, 1.5, 24],
    ["T", 251.25, 196, 1.5, 48],
    ["T", 343.25, 196, 1.5, 32],
    ["S", 199.25, 86, 1.5, 24],
    ["S", 199.25, 172, 1.5, 24],
    ["S", 112, 196, 232, 1.5],
    ["S", 111.25, 196, 1.5, 48],
    ["P", 111.25, 356, 1.5, 24],
    ["P", 112, 380, 88, 1.5],
    ["P", 199.25, 380, 1.5, 24],
    ["S", 199.25, 466, 1.5, 24],
  ],
  // Figma draws the 0% label 36 wide at x 94: centre 112.
  labels: [["s3-chain", 112, 220]],
  // An empty block has no port until it is configured (C17).
  ports: [],
};

const BUILD_STATE_5: FigmaOracle = {
  name: "Build state 5",
  source: "Figma 8145:2689, drawn at 0.8981 and divided back",
  fixture: buildState5,
  size: [552, 650],
  nodes: {
    deposit: [158, 24, 236, 62],
    idleInput: [158, 110, 236, 62],
    idleOutput: [24, 454, 236, 62],
    income: [292, 454, 236, 62],
    withdraw: [158, 564, 236, 62],
    "s5-swap": [100, 244, 176, 26],
    "s5-pool": [100, 294, 176, 62],
    "s5-fees": [100, 380, 176, 26],
    "addProtocol:arbitrum": [308, 244, 40, 40],
    addNetwork: [388, 228, 64, 72],
  },
  edges: [
    ["S", 187.25, 270, 1.5, 24],
    ["S", 187.25, 356, 1.5, 24],
    ["T", 327.25, 196, 1.5, 48],
    ["T", 419.25, 196, 1.5, 32],
    ["S", 275.25, 86, 1.5, 24],
    ["S", 275.25, 172, 1.5, 24],
    ["S", 188, 196, 232, 1.5],
    ["S", 187.25, 196, 1.5, 48],
    ["P", 175.25, 406, 1.5, 24],
    ["I", 199.25, 406, 1.5, 24],
    ["P", 142, 430, 34, 1.5],
    ["P", 141.25, 430, 1.5, 24],
    ["I", 200, 430, 210, 1.5],
    ["I", 409.25, 430, 1.5, 24],
    ["S", 141.25, 516, 1.5, 24],
    ["I", 409.25, 516, 1.5, 24],
    ["S", 142, 540, 268, 1.5],
    ["S", 275.25, 540, 1.5, 24],
  ],
  labels: [["s5-chain", 188.5, 220]],
  ports: [],
};

const FIGMA_ORACLES: FigmaOracle[] = [
  CANVAS_A,
  CANVAS_B,
  CANVAS_C,
  CANVAS_D,
  BUILD_STATE_3,
  BUILD_STATE_5,
];

// POO-2213, user override 2026-10-04: derived fee conversion adds a 50px row.
// Return buses move below it; a left principal bypass can require separate income level (+24px).
const FEE_RETURN_OVERRIDES: Record<
  string,
  { size: [number, number]; nodes: Record<string, Box>; edges: FigmaEdge[] }
> = {
  "canvas A": {
    size: [2080, 822],
    nodes: {
      deposit: [922, 24, 236, 62],
      idleInput: [922, 110, 236, 62],
      idleOutput: [788, 626, 236, 62],
      income: [1056, 626, 236, 62],
      withdraw: [922, 736, 236, 62],
      "a-hub-1-swap": [24, 244, 176, 26],
      "a-hub-1-pool": [24, 294, 176, 62],
      "a-hub-1-fees": [24, 380, 176, 26],
      "a-hub-2-supply": [232, 244, 176, 62],
      "a-hub-2-swap": [232, 330, 176, 26],
      "a-hub-2-pool": [232, 380, 176, 62],
      "a-hub-2-fees": [232, 466, 176, 26],
      "a-hub-3-swap": [440, 244, 176, 26],
      "a-hub-3-supply": [440, 294, 176, 62],
      "a-hub-3-borrow": [440, 380, 176, 62],
      "a-base-1-swap": [744, 342, 176, 26],
      "a-base-1-pool": [744, 392, 176, 62],
      "a-base-1-fees": [744, 478, 176, 26],
      "a-base-2-swap": [952, 342, 176, 26],
      "a-base-2-pool": [952, 392, 176, 62],
      "a-base-2-fees": [952, 478, 176, 26],
      "a-base-3-supply": [1160, 342, 176, 62],
      "a-rh-1-swap": [1480, 342, 176, 26],
      "a-rh-1-pool": [1480, 392, 176, 62],
      "a-rh-1-fees": [1480, 478, 176, 26],
      "a-rh-2-swap": [1688, 342, 176, 26],
      "a-rh-2-pool": [1688, 392, 176, 62],
      "a-rh-2-fees": [1688, 478, 176, 26],
      "fee-swap:a-hub-1-fees": [24, 430, 176, 26],
      "fee-swap:a-hub-2-fees": [232, 516, 176, 26],
      "fee-swap:a-base-1-fees": [744, 528, 176, 26],
      "fee-swap:a-base-2-fees": [952, 528, 176, 26],
      "fee-swap:a-rh-1-fees": [1480, 528, 176, 26],
      "fee-swap:a-rh-2-fees": [1688, 528, 176, 26],
      "bridge:base": [988, 244, 176, 26],
      "bridge:robinhood": [1620, 244, 176, 26],
      "group:base": [728, 228, 696, 342],
      "group:robinhood": [1464, 228, 488, 342],
      "addProtocol:arbitrum": [648, 244, 40, 40],
      "addProtocol:base": [1368, 342, 40, 40],
      "addProtocol:robinhood": [1896, 342, 40, 40],
      addNetwork: [1992, 228, 64, 72],
    },
    edges: [
      ["income", 111.25, 418, 1.5, 12],
      ["income", 111.25, 456, 1.5, 146],
      ["income", 112, 418, 12, 1.5],
      ["income", 112, 602, 1664, 1.5],
      ["income", 123.25, 406, 1.5, 12],
      ["income", 319.25, 504, 1.5, 12],
      ["income", 319.25, 542, 1.5, 60],
      ["income", 320, 504, 12, 1.5],
      ["income", 331.25, 492, 1.5, 12],
      ["income", 831.25, 516, 1.5, 12],
      ["income", 831.25, 554, 1.5, 48],
      ["income", 832, 516, 12, 1.5],
      ["income", 843.25, 504, 1.5, 12],
      ["income", 1039.25, 516, 1.5, 12],
      ["income", 1039.25, 554, 1.5, 48],
      ["income", 1040, 516, 12, 1.5],
      ["income", 1051.25, 504, 1.5, 12],
      ["income", 1173.25, 602, 1.5, 24],
      ["income", 1173.25, 688, 1.5, 24],
      ["income", 1567.25, 516, 1.5, 12],
      ["income", 1567.25, 554, 1.5, 48],
      ["income", 1568, 516, 12, 1.5],
      ["income", 1579.25, 504, 1.5, 12],
      ["income", 1775.25, 516, 1.5, 12],
      ["income", 1775.25, 554, 1.5, 48],
      ["income", 1776, 516, 12, 1.5],
      ["income", 1787.25, 504, 1.5, 12],
      ["principal", 11.25, 418, 1.5, 160],
      ["principal", 12, 418, 88, 1.5],
      ["principal", 12, 578, 1664, 1.5],
      ["principal", 99.25, 406, 1.5, 12],
      ["principal", 219.25, 504, 1.5, 74],
      ["principal", 220, 504, 88, 1.5],
      ["principal", 307.25, 492, 1.5, 12],
      ["principal", 527.25, 442, 1.5, 136],
      ["principal", 731.25, 516, 1.5, 62],
      ["principal", 732, 516, 88, 1.5],
      ["principal", 819.25, 504, 1.5, 12],
      ["principal", 905.25, 578, 1.5, 48],
      ["principal", 939.25, 516, 1.5, 62],
      ["principal", 940, 516, 88, 1.5],
      ["principal", 1027.25, 504, 1.5, 12],
      ["principal", 1247.25, 404, 1.5, 174],
      ["principal", 1467.25, 516, 1.5, 62],
      ["principal", 1468, 516, 88, 1.5],
      ["principal", 1555.25, 504, 1.5, 12],
      ["principal", 1675.25, 516, 1.5, 62],
      ["principal", 1676, 516, 88, 1.5],
      ["principal", 1763.25, 504, 1.5, 12],
      ["structural", 111.25, 196, 1.5, 48],
      ["structural", 111.25, 270, 1.5, 24],
      ["structural", 111.25, 356, 1.5, 24],
      ["structural", 112, 196, 1912, 1.5],
      ["structural", 319.25, 196, 1.5, 48],
      ["structural", 319.25, 306, 1.5, 24],
      ["structural", 319.25, 356, 1.5, 24],
      ["structural", 319.25, 442, 1.5, 24],
      ["structural", 527.25, 196, 1.5, 48],
      ["structural", 527.25, 270, 1.5, 24],
      ["structural", 527.25, 356, 1.5, 24],
      ["structural", 831.25, 294, 1.5, 48],
      ["structural", 831.25, 368, 1.5, 24],
      ["structural", 831.25, 454, 1.5, 24],
      ["structural", 832, 294, 556, 1.5],
      ["structural", 905.25, 688, 1.5, 24],
      ["structural", 906, 712, 268, 1.5],
      ["structural", 1039.25, 86, 1.5, 24],
      ["structural", 1039.25, 172, 1.5, 24],
      ["structural", 1039.25, 294, 1.5, 48],
      ["structural", 1039.25, 368, 1.5, 24],
      ["structural", 1039.25, 454, 1.5, 24],
      ["structural", 1039.25, 712, 1.5, 24],
      ["structural", 1075.25, 196, 1.5, 48],
      ["structural", 1075.25, 270, 1.5, 24],
      ["structural", 1247.25, 294, 1.5, 48],
      ["structural", 1567.25, 294, 1.5, 48],
      ["structural", 1567.25, 368, 1.5, 24],
      ["structural", 1567.25, 454, 1.5, 24],
      ["structural", 1568, 294, 348, 1.5],
      ["structural", 1707.25, 196, 1.5, 48],
      ["structural", 1707.25, 270, 1.5, 24],
      ["structural", 1775.25, 294, 1.5, 48],
      ["structural", 1775.25, 368, 1.5, 24],
      ["structural", 1775.25, 454, 1.5, 24],
      ["template", 667.25, 196, 1.5, 48],
      ["template", 1387.25, 294, 1.5, 48],
      ["template", 1915.25, 294, 1.5, 48],
      ["template", 2023.25, 196, 1.5, 32],
    ],
  },
  "canvas C": {
    size: [608, 724],
    nodes: {
      deposit: [186, 24, 236, 62],
      idleInput: [186, 110, 236, 62],
      idleOutput: [52, 528, 236, 62],
      income: [320, 528, 236, 62],
      withdraw: [186, 638, 236, 62],
      "c-pool-swap": [24, 244, 176, 26],
      "c-pool-pool": [24, 294, 176, 62],
      "c-pool-fees": [24, 380, 176, 26],
      "c-supply-supply": [232, 244, 176, 62],
      "fee-swap:c-pool-fees": [24, 430, 176, 26],
      "addProtocol:arbitrum": [440, 244, 40, 40],
      addNetwork: [520, 228, 64, 72],
    },
    edges: [
      ["income", 111.25, 418, 1.5, 12],
      ["income", 111.25, 456, 1.5, 48],
      ["income", 112, 418, 12, 1.5],
      ["income", 112, 504, 326, 1.5],
      ["income", 123.25, 406, 1.5, 12],
      ["income", 437.25, 504, 1.5, 24],
      ["income", 437.25, 590, 1.5, 24],
      ["principal", 11.25, 418, 1.5, 62],
      ["principal", 12, 418, 88, 1.5],
      ["principal", 12, 480, 308, 1.5],
      ["principal", 99.25, 406, 1.5, 12],
      ["principal", 169.25, 480, 1.5, 48],
      ["principal", 319.25, 306, 1.5, 174],
      ["structural", 111.25, 196, 1.5, 48],
      ["structural", 111.25, 270, 1.5, 24],
      ["structural", 111.25, 356, 1.5, 24],
      ["structural", 112, 196, 440, 1.5],
      ["structural", 169.25, 590, 1.5, 24],
      ["structural", 170, 614, 268, 1.5],
      ["structural", 303.25, 86, 1.5, 24],
      ["structural", 303.25, 172, 1.5, 24],
      ["structural", 303.25, 614, 1.5, 24],
      ["structural", 319.25, 196, 1.5, 48],
      ["template", 459.25, 196, 1.5, 48],
      ["template", 551.25, 196, 1.5, 32],
    ],
  },
  "Build state 5": {
    size: [552, 724],
    nodes: {
      deposit: [158, 24, 236, 62],
      idleInput: [158, 110, 236, 62],
      idleOutput: [24, 528, 236, 62],
      income: [292, 528, 236, 62],
      withdraw: [158, 638, 236, 62],
      "s5-swap": [100, 244, 176, 26],
      "s5-pool": [100, 294, 176, 62],
      "s5-fees": [100, 380, 176, 26],
      "fee-swap:s5-fees": [100, 430, 176, 26],
      "addProtocol:arbitrum": [308, 244, 40, 40],
      addNetwork: [388, 228, 64, 72],
    },
    edges: [
      ["income", 187.25, 418, 1.5, 12],
      ["income", 187.25, 456, 1.5, 48],
      ["income", 188, 418, 12, 1.5],
      ["income", 188, 504, 222, 1.5],
      ["income", 199.25, 406, 1.5, 12],
      ["income", 409.25, 504, 1.5, 24],
      ["income", 409.25, 590, 1.5, 24],
      ["principal", 87.25, 418, 1.5, 62],
      ["principal", 88, 418, 88, 1.5],
      ["principal", 88, 480, 54, 1.5],
      ["principal", 141.25, 480, 1.5, 48],
      ["principal", 175.25, 406, 1.5, 12],
      ["structural", 141.25, 590, 1.5, 24],
      ["structural", 142, 614, 268, 1.5],
      ["structural", 187.25, 196, 1.5, 48],
      ["structural", 187.25, 270, 1.5, 24],
      ["structural", 187.25, 356, 1.5, 24],
      ["structural", 188, 196, 232, 1.5],
      ["structural", 275.25, 86, 1.5, 24],
      ["structural", 275.25, 172, 1.5, 24],
      ["structural", 275.25, 614, 1.5, 24],
      ["template", 327.25, 196, 1.5, 48],
      ["template", 419.25, 196, 1.5, 32],
    ],
  },
};
describe.each(FIGMA_ORACLES)("$name against $source", (oracle) => {
  const layout = layoutGraph(oracle.fixture.input, EN);
  const updated = FEE_RETURN_OVERRIDES[oracle.name];

  // @rule A1 @rule L10
  it("has the graph size", () => {
    expect([layout.width, layout.height]).toEqual(updated?.size ?? oracle.size);
  });

  // @rule A1 @rule L2 @rule L3
  it("places every box, and no other", () => {
    const actual = Object.fromEntries(
      Object.entries(nodeRects(layout)).map(([key, rect]) => [key, box(rect)]),
    );
    expect(actual).toEqual(updated?.nodes ?? oracle.nodes);
  });

  // @rule A1 @rule L5 @rule L10
  it("draws every line segment, and no other", () => {
    expect(figmaEdges(layout)).toEqual(updated?.edges ?? toFigma(oracle.edges));
  });

  // @rule L10 @rule C8
  it("centres every share label within 0.5 px", () => {
    expect(layout.shareLabels.map(labelKey).sort()).toEqual(
      oracle.labels.map(([key]) => key).sort(),
    );
    for (const [key, cx, cy] of oracle.labels) {
      const label = layout.shareLabels.find((l) => labelKey(l) === key);
      expect(Math.abs((label?.center.x ?? Number.NaN) - cx)).toBeLessThanOrEqual(0.5);
      expect(Math.abs((label?.center.y ?? Number.NaN) - cy)).toBeLessThanOrEqual(0.5);
    }
  });

  // @rule C17
  it("places every insert port, and no other", () => {
    const actual = layout.ports.map((p) => [
      p.target.side,
      p.target.blockId,
      p.center.x,
      p.center.y,
    ]);
    const sort = (rows: unknown[][]) =>
      [...rows].sort((p, q) => String(p).localeCompare(String(q)));
    expect(sort(actual)).toEqual(sort(oracle.ports));
  });

  it("anchors every network chip on its group's top border, 12 from its left", () => {
    for (const [network, x, y] of oracle.chips ?? []) {
      const group = layout.groups.find((g) => g.network === network);
      expect(Math.abs((group?.chipAnchor.x ?? Number.NaN) - x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs((group?.chipAnchor.y ?? Number.NaN) - y)).toBeLessThanOrEqual(0.5);
    }
  });
});

// ---------------------------------------------------------------------------
// Handoff v1.2 numbers
// ---------------------------------------------------------------------------

describe("worked example 1, POO-2213 fee-return override of handoff (canvas C)", () => {
  const layout = layoutGraph(canvasC.input, EN);
  const nodes = nodeRects(layout);
  const label = (chainId: string) =>
    layout.shareLabels.find((l) => l.target.chainId === chainId)?.center;

  // @rule L8
  it("[L8] reproduces every row of the table", () => {
    expect(box(nodes.deposit)).toEqual([186, 24, 236, 62]);
    expect(box(nodes.idleInput)).toEqual([186, 110, 236, 62]);
    expect(horizontalRuns(layout, "structural", 196)).toEqual([[112, 552]]);
    expect(Math.abs((label("c-pool")?.x ?? 0) - 112)).toBeLessThanOrEqual(0.5);
    expect(label("c-pool")?.y).toBe(220);
    expect(Math.abs((label("c-supply")?.x ?? 0) - 320)).toBeLessThanOrEqual(0.5);
    expect(label("c-supply")?.y).toBe(220);
    expect(box(nodes["c-pool-swap"])).toEqual([24, 244, 176, 26]);
    expect(box(nodes["c-pool-pool"])).toEqual([24, 294, 176, 62]);
    expect(box(nodes["c-pool-fees"])).toEqual([24, 380, 176, 26]);
    expect(box(nodes["c-supply-supply"])).toEqual([232, 244, 176, 62]);
    expect(layout.ports.map((p) => [p.center.x, p.center.y])).toEqual([
      [320, 244],
      [320, 306],
    ]);
    expect(box(nodes["addProtocol:arbitrum"])).toEqual([440, 244, 40, 40]);
    expect(box(nodes.addNetwork)).toEqual([520, 228, 64, 72]);
    expect(horizontalRuns(layout, "principal", 480)).toEqual([[12, 320]]);
    expect(horizontalRuns(layout, "income", 504)).toEqual([[112, 438]]);
    expect(box(nodes.idleOutput)).toEqual([52, 528, 236, 62]);
    expect(box(nodes.income)).toEqual([320, 528, 236, 62]);
    expect(horizontalRuns(layout, "structural", 614)).toEqual([[170, 438]]);
    expect(box(nodes.withdraw)).toEqual([186, 638, 236, 62]);
    expect([layout.width, layout.height]).toEqual([608, 724]);
  });

  // @rule L8 @rule C10
  it("[L8, POO-2213] keeps the spine centered and routes the drops around fee conversion", () => {
    expect(layout.spineCentreX).toBe(304);
    expect(verticalsAt(layout, "principal", 100)).toEqual([[406, 418]]);
    expect(verticalsAt(layout, "income", 124)).toEqual([[406, 418]]);
    expect(verticalsAt(layout, "principal", 320)).toEqual([[306, 480]]);
  });
});

describe("worked example 2, POO-2213 fee-return override of handoff numbers (one hub chain and one spoke)", () => {
  const layout = layoutGraph(workedExample2.input, EN);
  const nodes = nodeRects(layout);
  const xRange = (key: string) => {
    const r = nodes[key];
    return r ? [r.x, r.x + r.w] : undefined;
  };
  const yRange = (key: string) => {
    const r = nodes[key];
    return r ? [r.y, r.y + r.h] : undefined;
  };

  // @rule L9
  it("[L9] places the hub chain, the hub circle and the group", () => {
    expect(xRange("we2-hub-swap")).toEqual([24, 200]);
    expect(xRange("addProtocol:arbitrum")).toEqual([232, 272]);
    expect(box(nodes["group:base"])).toEqual([312, 228, 488, 342]);
  });

  // @rule L9
  it("[L9] places everything inside the group", () => {
    expect(xRange("we2-base-a-swap")).toEqual([328, 504]);
    expect(xRange("we2-base-b-supply")).toEqual([536, 712]);
    expect(xRange("addProtocol:base")).toEqual([744, 784]);
    expect(yRange("addProtocol:base")).toEqual([342, 382]);
    expect(xRange("bridge:base")).toEqual([468, 644]);
    expect(yRange("bridge:base")).toEqual([244, 270]);
    expect(horizontalRuns(layout, "structural", 294)).toEqual([[416, 764]]);
    expect(yRange("we2-base-a-swap")).toEqual([342, 368]);
    expect(yRange("we2-base-a-pool")).toEqual([392, 454]);
    expect(yRange("we2-base-a-fees")).toEqual([478, 504]);
    expect(yRange("we2-base-b-supply")).toEqual([342, 404]);
  });

  // @rule L9
  it("[L9] places the Add network box, the spine, the bus and the labels", () => {
    expect(box(nodes.addNetwork)).toEqual([840, 228, 64, 72]);
    expect(layout.spineCentreX).toBe(464);
    expect(horizontalRuns(layout, "structural", 196)).toEqual([[112, 872]]);
    const spoke = layout.shareLabels.find((l) => l.target.chainId === null);
    expect(spoke?.center.y).toBe(212);
    expect(Math.abs((spoke?.center.x ?? 0) - 556)).toBeLessThanOrEqual(0.5);
    const inner = layout.shareLabels.filter((l) => l.target.chainId?.startsWith("we2-base"));
    expect(inner.map((l) => [l.center.x, l.center.y])).toEqual([
      [416, 318],
      [624, 318],
    ]);
  });

  // @rule L9 @rule C10 @rule C11
  it("[L9, POO-2213] draws principal below fee conversion and income 24 under it", () => {
    expect(horizontalRuns(layout, "principal", 578)).toEqual([[12, 624]]);
    expect(verticalXs(layout, "principal")).toEqual([12, 100, 316, 330, 404, 624]);
    expect(verticalsAt(layout, "principal", 330)).toEqual([[578, 626]]);
    expect(horizontalRuns(layout, "income", 602)).toEqual([[112, 598]]);
    expect(verticalXs(layout, "income")).toEqual([112, 124, 416, 428, 598]);
  });

  // @rule L9 @rule L5
  it("[L9] places the outputs, the merge line, Withdraw and the graph size", () => {
    expect(xRange("idleOutput")).toEqual([212, 448]);
    expect(xRange("income")).toEqual([480, 716]);
    expect(yRange("idleOutput")).toEqual([626, 688]);
    expect(yRange("income")).toEqual([626, 688]);
    expect(horizontalRuns(layout, "structural", 712)).toEqual([[330, 598]]);
    expect(xRange("withdraw")).toEqual([346, 582]);
    expect(yRange("withdraw")).toEqual([736, 798]);
    expect([layout.width, layout.height]).toEqual([928, 822]);
  });
});

describe("Build state 5, POO-2213 fee-return override of handoff numbers", () => {
  const layout = layoutGraph(buildState5.input, EN);
  const nodes = nodeRects(layout);

  // @rule L4
  it("[L4] shifts everything by 76: chain 100, circle 308, Add network 388, spine 276", () => {
    expect(nodes["s5-swap"]?.x).toBe(100);
    expect(nodes["addProtocol:arbitrum"]?.x).toBe(308);
    expect(nodes.addNetwork?.x).toBe(388);
    expect(layout.spineCentreX).toBe(276);
  });

  // @rule L4 @rule L5 @rule C11
  it("[L4, POO-2213] preserves output widths and separates return levels below the converter", () => {
    expect(box(nodes.idleOutput)).toEqual([24, 528, 236, 62]);
    expect(box(nodes.income)).toEqual([292, 528, 236, 62]);
    expect(horizontalRuns(layout, "principal", 480)).toEqual([[88, 142]]);
    expect(horizontalRuns(layout, "income", 504)).toEqual([[188, 410]]);
    expect(nodes.withdraw?.y).toBe(638);
    expect([layout.width, layout.height]).toEqual([552, 724]);
  });
});

describe("canvas D, the handoff numbers (empty canvas, English sentence 420 wide)", () => {
  const layout = layoutGraph(canvasD.input, EN);

  // @rule L6
  it("[L6] shifts by 32: spine 234, graph 468 x 572", () => {
    expect(layout.spineCentreX).toBe(234);
    expect([layout.width, layout.height]).toEqual([468, 572]);
  });

  // @rule L6
  it("[L6] puts the captions on one line 22 under the circle and 6 under the box, then the sentence", () => {
    expect(layout.emptyCaptions).toEqual({
      addProtocol: { x: 174, y: 306 },
      addNetwork: { x: 294, y: 306 },
      startHere: { x: 24, y: 334, w: 420, h: 18 },
    });
  });
});

describe("canvas A as a plan", () => {
  // @rule L10
  it("[L10, POO-2213] is 2080 x 822 with fee conversion; menus and tooltips stay outside graph bounds", () => {
    const layout = layoutGraph(canvasA.input, EN);
    expect([layout.width, layout.height]).toEqual([2080, 822]);
  });
});
