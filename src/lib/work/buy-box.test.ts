import { describe, expect, it } from "vitest";
import { ALL_STATES, amountWords, askingMultiple, BUY_BOX_DEFAULTS, buyBoxHint, buyBoxRangeProblem, buyBoxTone, checkBuyBox, dealSourceTypeFor, defaultBuyBoxSettings, mentionsSde, moneyShort, parseMoneyText, regionCheck, stateOf, US_REGIONS, type BuyBoxSettings } from "./buy-box";

const box = (over: Partial<BuyBoxSettings> = {}): BuyBoxSettings => ({ ...defaultBuyBoxSettings(), ...over });

describe("buy box: reading typed amounts", () => {
  it("reads $1.2M, 410K, plain numbers, and words", () => {
    expect(parseMoneyText("$1.2M")).toBe(1_200_000);
    expect(parseMoneyText("$1.2M SDE")).toBe(1_200_000);
    expect(parseMoneyText("410K")).toBe(410_000);
    expect(parseMoneyText("1,200,000")).toBe(1_200_000);
    expect(parseMoneyText("2.4 million")).toBe(2_400_000);
    expect(parseMoneyText("$22M")).toBe(22_000_000);
    expect(parseMoneyText(900_000)).toBe(900_000);
    expect(parseMoneyText("Not stated")).toBeNull();
    expect(parseMoneyText("")).toBeNull();
    expect(parseMoneyText(null)).toBeNull();
  });

  it("knows when the earnings figure is SDE", () => {
    expect(mentionsSde("$1.2M SDE")).toBe(true);
    expect(mentionsSde("sde 410k")).toBe(true);
    expect(mentionsSde("$1.4M")).toBe(false);
  });

  it("shows amounts short", () => {
    expect(moneyShort(1_400_000)).toBe("$1.4M");
    expect(moneyShort(1_000_000)).toBe("$1.0M");
    expect(moneyShort(22_000_000)).toBe("$22M");
    expect(moneyShort(410_000)).toBe("$410K");
    expect(moneyShort(900)).toBe("$900");
    expect(moneyShort(null)).toBe("Not stated");
  });
});

describe("buy box: the state of a location", () => {
  it("reads two-letter codes and full names", () => {
    expect(stateOf("Macon, GA")).toBe("GA");
    expect(stateOf("Greenville SC")).toBe("SC");
    expect(stateOf("Spokane, Washington")).toBe("WA");
    expect(stateOf("Richmond, VA, USA")).toBe("VA");
    expect(stateOf("Somewhere")).toBeNull();
    expect(stateOf("")).toBeNull();
  });

  it("puts every state and DC in at least one region; the default regions are the Southeast and the East Coast", () => {
    const covered = new Set<string>(US_REGIONS.flatMap((r) => [...r.states]));
    for (const st of Object.keys(ALL_STATES)) expect(covered.has(st), st).toBe(true);
    const inDefault = (st: string) => US_REGIONS.some((r) => BUY_BOX_DEFAULTS.regions.includes(r.key) && (r.states as readonly string[]).includes(st));
    for (const st of ["GA", "FL", "AL", "TN", "NC", "SC", "KY", "VA", "NY", "PA", "MA", "DC"]) expect(inDefault(st), st).toBe(true);
    for (const st of ["WA", "CA", "TX", "SD", "OH"]) expect(inDefault(st), st).toBe(false);
  });

  it("checks a region: a ticked region, a typed place or state, unknown without a state, any region when none is set", () => {
    expect(regionCheck("Macon, GA", box())).toMatchObject({ result: "in", state: "GA", region: "Southeast" });
    expect(regionCheck("Spokane, WA", box())).toMatchObject({ result: "out", state: "WA" });
    expect(regionCheck("Somewhere", box())).toMatchObject({ result: "unknown" });
    expect(regionCheck("Columbus, OH", box({ regionsOther: "Ohio" }))).toMatchObject({ result: "in", region: "Ohio" });
    expect(regionCheck("Toronto, Ontario", box({ regionsOther: "ontario" }))).toMatchObject({ result: "in" });
    expect(regionCheck("Austin, TX", box({ regions: ["southwest"] }))).toMatchObject({ result: "in", region: "Southwest" });
    expect(regionCheck("Spokane, WA", box({ regions: [], regionsOther: null })).result).toBe("in");
  });
});

describe("buy box: the settings", () => {
  it("defaults to the values that were fixed before: $1M to $2.5M core, $0.75M to $3.5M stretch, B2B services, Southeast or East Coast", () => {
    expect(BUY_BOX_DEFAULTS).toMatchObject({ coreMin: 1_000_000, coreMax: 2_500_000, stretchMin: 750_000, stretchMax: 3_500_000 });
    expect(buyBoxHint(box())).toBe("$1M to $2.5M EBITDA · B2B services · Southeast or East Coast");
    expect(amountWords(750_000)).toBe("$0.75M");
    expect(amountWords(2_500_000)).toBe("$2.5M");
    expect(amountWords(1_000_000)).toBe("$1M");
    expect(amountWords(50_000)).toBe("$50K");
  });

  it("refuses ranges that do not make sense", () => {
    expect(buyBoxRangeProblem(box())).toBeNull();
    expect(buyBoxRangeProblem(box({ coreMin: NaN }))).toContain("Core range from needs an amount");
    expect(buyBoxRangeProblem(box({ coreMin: 3_000_000 }))).toBe("The core range starts above where it ends.");
    expect(buyBoxRangeProblem(box({ stretchMin: 1_100_000 }))).toBe("The stretch range should start at or below the core range.");
    expect(buyBoxRangeProblem(box({ stretchMax: 2_000_000 }))).toBe("The stretch range should end at or above the core range.");
    expect(buyBoxRangeProblem(box({ stretchMin: 1_000_000, stretchMax: 2_500_000 }))).toBeNull();
  });
});

describe("buy box: the check on a listing", () => {
  it("fits: inside the core range, services, Southeast (green)", () => {
    const r = checkBuyBox({ name: "Apex Precision Machining", whatItDoes: "CNC parts for aerospace and medical device makers", location: "Huntsville, AL", ebitda: 1_400_000 });
    expect(r).toMatchObject({ tier: "fits", fits: true, label: "Fits", earnings: 1_400_000, earningsLabel: "EBITDA" });
    expect(checkBuyBox({ name: "Bluegrass Senior Transport", location: "Lexington, KY", sde: 1_100_000 }).fits).toBe(true);
    expect(buyBoxTone("fits")).toBe("green");
    expect(buyBoxTone("near")).toBe("amber");
    expect(buyBoxTone("outside")).toBe("gray");
  });

  it("near fit: inside the stretch range but outside the core, or only the region outside (amber)", () => {
    expect(checkBuyBox({ name: "Coastal HVAC", location: "Savannah, GA", ebitda: 900_000 })).toMatchObject({ tier: "near", fits: false, label: "Near fit · too small" });
    expect(checkBuyBox({ name: "Coastal HVAC", location: "Savannah, GA", ebitda: 3_000_000 })).toMatchObject({ tier: "near", label: "Near fit · too big" });
    expect(checkBuyBox({ ebitda: 750_000, location: "Atlanta, GA" }).tier).toBe("near");
    expect(checkBuyBox({ ebitda: 3_500_000, location: "Atlanta, GA" }).tier).toBe("near");
    expect(checkBuyBox({ name: "Great Plains Grain Hauling", location: "Sioux Falls, SD", ebitda: 1_300_000 })).toMatchObject({ tier: "near", label: "Near fit · location" });
  });

  it("outside: an excluded type, outside the stretch range, no earnings, or two soft misses, with the reason words", () => {
    expect(checkBuyBox({ name: "Sunny Smiles Franchise, 3 units", location: "Orlando, FL", sde: 410_000 }).label).toBe("Outside · franchise · too small");
    expect(checkBuyBox({ name: "Harbor Point Boat Storage", location: "Savannah, GA", sde: 180_000 })).toMatchObject({ tier: "outside", label: "Outside · too small" });
    expect(checkBuyBox({ name: "Titan Steel Fabrication", location: "Charlotte, NC", ebitda: 4_300_000 }).label).toBe("Outside · too big");
    expect(checkBuyBox({ name: "Cascade Outdoor Retail", whatItDoes: "Two retail stores selling camping gear", location: "Spokane, WA", sde: 520_000 }).label).toBe("Outside · too small · retail · location");
    expect(checkBuyBox({ name: "Direct Threads", industry: "Direct to consumer apparel", location: "Atlanta, GA", ebitda: 1_300_000 })).toMatchObject({ tier: "outside", flags: ["Retail"] });
    // Two soft misses: stretch size and a region outside.
    expect(checkBuyBox({ location: "Sioux Falls, SD", ebitda: 900_000 })).toMatchObject({ tier: "outside", label: "Outside · too small · location" });
    expect(checkBuyBox({ location: "Atlanta, GA" }).label).toBe("Outside · no earnings figure");
  });

  it("uses EBITDA before SDE, does not flag an unknown location, and counts the range ends as inside", () => {
    expect(checkBuyBox({ ebitda: 1_200_000, sde: 300_000, location: "Atlanta, GA" }).fits).toBe(true);
    expect(checkBuyBox({ ebitda: 1_200_000, location: "" }).fits).toBe(true);
    expect(checkBuyBox({ ebitda: 1_000_000 }).fits).toBe(true);
    expect(checkBuyBox({ ebitda: 2_500_000 }).fits).toBe(true);
    expect(checkBuyBox({ ebitda: 2_500_001 }).label).toBe("Near fit · too big");
    expect(checkBuyBox({ ebitda: 3_500_001 }).label).toBe("Outside · too big");
  });

  it("follows the settings: a wider core range, unticked types, a typed excluded type, other regions", () => {
    const harbor = { name: "Harbor Point Boat Storage", location: "Savannah, GA", sde: 600_000 };
    expect(checkBuyBox(harbor).tier).toBe("outside");
    expect(checkBuyBox(harbor, box({ coreMin: 500_000, stretchMin: 400_000 })).tier).toBe("fits");
    const sunny = { name: "Sunny Smiles Franchise, 3 units", location: "Orlando, FL", sde: 1_200_000 };
    expect(checkBuyBox(sunny).tier).toBe("outside");
    expect(checkBuyBox(sunny, box({ excluded: ["retail", "direct_to_consumer"] })).tier).toBe("fits");
    expect(checkBuyBox({ industry: "Direct to consumer apparel", ebitda: 1_300_000 }, box({ excluded: ["franchises"] })).tier).toBe("fits");
    expect(checkBuyBox({ name: "Peach Diner Group", whatItDoes: "Three restaurants", ebitda: 1_300_000 }, box({ excludedOther: "restaurants, trucking" }))).toMatchObject({ tier: "outside", flags: ["Restaurants"] });
    expect(checkBuyBox({ location: "Columbus, OH", ebitda: 1_300_000 }, box({ regionsOther: "Ohio" })).tier).toBe("fits");
    expect(checkBuyBox({ location: "Austin, TX", ebitda: 1_300_000 }, box({ regions: ["southwest"] })).tier).toBe("fits");
  });

  it("computes the asking multiple and the deal source type", () => {
    expect(askingMultiple(6_000_000, 1_700_000, null)).toBe("3.5x");
    expect(askingMultiple(3_600_000, null, 1_000_000)).toBe("3.6x");
    expect(askingMultiple(null, 1_700_000, null)).toBeNull();
    expect(askingMultiple(6_000_000, 0, null)).toBeNull();
    expect(dealSourceTypeFor("Network")).toBe("proprietary");
    expect(dealSourceTypeFor("Broker newsletter")).toBe("brokered");
  });
});
