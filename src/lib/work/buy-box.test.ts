import { describe, expect, it } from "vitest";
import { askingMultiple, BUY_BOX, BUY_BOX_STATES, checkBuyBox, dealSourceTypeFor, mentionsSde, moneyShort, parseMoneyText, stateOf } from "./buy-box";

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

  it("keeps the Southeast and the East Coast in one list", () => {
    for (const st of ["GA", "FL", "AL", "TN", "NC", "SC", "KY", "VA", "NY", "PA", "MA"]) expect(BUY_BOX_STATES[st]).toBeTruthy();
    for (const st of ["WA", "CA", "TX", "SD"]) expect(BUY_BOX_STATES[st]).toBeUndefined();
  });
});

describe("buy box: the check on a listing", () => {
  it("fits: $1M to $2.5M EBITDA, services, Southeast", () => {
    const r = checkBuyBox({ name: "Apex Precision Machining", whatItDoes: "CNC parts for aerospace and medical device makers", location: "Huntsville, AL", ebitda: 1_400_000 });
    expect(r).toMatchObject({ fits: true, label: "Fits", earnings: 1_400_000, earningsLabel: "EBITDA" });
    expect(checkBuyBox({ name: "Bluegrass Senior Transport", location: "Lexington, KY", sde: 1_100_000 }).fits).toBe(true);
    expect(BUY_BOX.minEarnings).toBe(1_000_000);
    expect(BUY_BOX.maxEarnings).toBe(2_500_000);
  });

  it("names what is off, in order: franchise, size, retail, location", () => {
    expect(checkBuyBox({ name: "Sunny Smiles Franchise, 3 units", location: "Orlando, FL", sde: 410_000 }).label).toBe("Franchise · too small");
    expect(checkBuyBox({ name: "Harbor Point Boat Storage", location: "Savannah, GA", sde: 180_000 }).label).toBe("Too small");
    expect(checkBuyBox({ name: "Titan Steel Fabrication", location: "Charlotte, NC", ebitda: 4_300_000 }).label).toBe("Too big");
    expect(checkBuyBox({ name: "Cascade Outdoor Retail", whatItDoes: "Two retail stores selling camping gear", location: "Spokane, WA", sde: 520_000 }).label).toBe("Too small · retail · location");
    expect(checkBuyBox({ name: "Great Plains Grain Hauling", location: "Sioux Falls, SD", ebitda: 1_300_000 }).label).toBe("Location");
    expect(checkBuyBox({ name: "Direct Threads", industry: "Direct to consumer apparel", location: "Atlanta, GA", ebitda: 1_300_000 }).flags).toEqual(["Retail"]);
  });

  it("uses EBITDA before SDE, flags a missing figure, and does not flag an unknown location", () => {
    expect(checkBuyBox({ ebitda: 1_200_000, sde: 300_000, location: "Atlanta, GA" }).fits).toBe(true);
    expect(checkBuyBox({ location: "Atlanta, GA" }).label).toBe("No earnings figure");
    expect(checkBuyBox({ ebitda: 1_200_000, location: "" }).fits).toBe(true);
    expect(checkBuyBox({ ebitda: 1_000_000 }).fits).toBe(true);
    expect(checkBuyBox({ ebitda: 2_500_000 }).fits).toBe(true);
    expect(checkBuyBox({ ebitda: 2_500_001 }).label).toBe("Too big");
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
