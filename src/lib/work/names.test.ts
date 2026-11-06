import { describe, expect, it } from "vitest";
import { buildListingName, compareNames, displayName, isPlaceholderName, listedAs } from "./names";

describe("listing names", () => {
  it("builds '00 ' plus a plain description, never ending in Co or Company", () => {
    expect(buildListingName("industrial filtration distributor")).toBe("00 Industrial Filtration Distributor");
    expect(buildListingName("Industrial Filtration Co")).toBe("00 Industrial Filtration");
    expect(buildListingName("Commercial HVAC Service Company")).toBe("00 Commercial HVAC Service");
    expect(buildListingName("Fleet repair shop, Jacksonville Inc.")).toBe("00 Fleet Repair Shop, Jacksonville");
    expect(buildListingName("00 Already Built Name")).toBe("00 Already Built Name");
    expect(buildListingName("  grounds   maintenance for HOAs and offices ")).toBe("00 Grounds Maintenance for HOAs and Offices");
    expect(buildListingName("")).toBe("");
    expect(buildListingName("Company")).toBe("");
  });

  it("knows a placeholder name", () => {
    expect(isPlaceholderName("00 Industrial Filtration Distributor")).toBe(true);
    expect(isPlaceholderName("Dalton Services")).toBe(false);
    expect(isPlaceholderName("007 Cleaning")).toBe(false);
  });

  it("shows the company name when set, otherwise the listing name, and 'Listed as' only when both differ", () => {
    expect(displayName({ name: "00 Fleet Repair Shop", companyName: "Coastal Fleet Maintenance" })).toBe("Coastal Fleet Maintenance");
    expect(displayName({ name: "00 Fleet Repair Shop", companyName: "  " })).toBe("00 Fleet Repair Shop");
    expect(displayName({ name: "Dalton Services", companyName: null })).toBe("Dalton Services");
    expect(listedAs({ name: "00 Fleet Repair Shop", companyName: "Coastal Fleet Maintenance" })).toBe("00 Fleet Repair Shop");
    expect(listedAs({ name: "Dalton Services", companyName: "dalton services" })).toBeNull();
    expect(listedAs({ name: "00 Fleet Repair Shop", companyName: null })).toBeNull();
  });

  it("sorts placeholder names together at the top, then the rest by name", () => {
    const names = ["Summit Logistics Group", "00 Medicaid Transport Provider", "Apex Precision Machining", "00 Fleet Repair Shop", "dalton services"];
    expect([...names].sort(compareNames)).toEqual(["00 Fleet Repair Shop", "00 Medicaid Transport Provider", "Apex Precision Machining", "dalton services", "Summit Logistics Group"]);
  });
});

describe("the sign-off name (fix list item 10, 2026-11-06)", () => {
  it("signs with the first word of the Name in Settings, or no name when none is set", async () => {
    const { addSignOffName, signOff, signOffName } = await import("./names");
    expect(signOffName("Bram Frankel")).toBe("Bram");
    expect(signOffName("  Dana ")).toBe("Dana");
    expect(signOffName(null)).toBeNull();
    expect(signOffName("   ")).toBeNull();
    expect(signOff("Thanks", "Bram")).toBe("Thanks,\nBram");
    expect(signOff("Thanks", null)).toBe("Thanks,");
    expect(addSignOffName("Hi Dana,\n\nAny update?\n\nThanks,", "Bram")).toBe("Hi Dana,\n\nAny update?\n\nThanks,\nBram");
    expect(addSignOffName("Hi Dana,\n\nBest,\n", "Ann")).toBe("Hi Dana,\n\nBest,\nAnn");
    expect(addSignOffName("Hi Dana,\n\nThanks,\nBram", "Bram")).toBe("Hi Dana,\n\nThanks,\nBram");
    expect(addSignOffName("Hi Dana,\n\nThanks,", null)).toBe("Hi Dana,\n\nThanks,");
  });
});
