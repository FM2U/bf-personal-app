import { describe, expect, it } from "vitest";
import { buyBoxReasons, listingPopup, type PopupListing } from "./listing-popup";
import { defaultBuyBoxSettings } from "./buy-box";

const base: PopupListing = {
  name: "00 Industrial Filtration Distributor",
  listingName: "00 Industrial Filtration Distributor",
  companyName: null,
  whatItDoes: "Distributes filters to plants in the Southeast",
  location: "Macon, GA",
  industry: "Industrial distribution",
  source: "Broker newsletter",
  brokerName: "Transworld, Mark Reed",
  whySelling: "Retiring, no successor",
  listingUrl: "transworld.com/listing/123",
  revenue: 5_600_000,
  ebitda: 1_700_000,
  sde: null,
  askingPrice: 6_000_000,
  askingMultiple: "3.5x",
};

/** Edit batch C round 2, item 2: what the listing popup on Screen listings shows. */
describe("the listing popup", () => {
  it("a listing that fits: the name, Company not named yet, the green pill, the reasons, the facts, the link", () => {
    const d = listingPopup(base);
    expect(d.title).toBe("00 Industrial Filtration Distributor");
    expect(d.under).toBe("Company not named yet");
    expect(d.fits).toBe(true);
    expect(d.tier).toBe("fits");
    expect(d.pill).toBe("Fits");
    expect(d.reasons).toEqual(["Size fits: EBITDA $1.7M is inside $1M to $2.5M.", "Location fits: GA is in the Southeast."]);
    expect(d.whatItDoes).toBe("Distributes filters to plants in the Southeast");
    expect(d.facts.map((f) => `${f.label}: ${f.value}${f.note ? ` (${f.note})` : ""}`)).toEqual([
      "Revenue: $5.6M",
      "EBITDA: $1.7M",
      "Asking: $6.0M (3.5x)",
      "Location: Macon, GA",
      "Industry: Industrial distribution",
      "Source: Broker newsletter",
      "Broker: Transworld, Mark Reed",
      "Why selling: Retiring, no successor",
    ]);
    expect(d.link).toBe("https://transworld.com/listing/123");
  });

  it("a named company shows Listed as with the listing name", () => {
    const d = listingPopup({ ...base, name: "Acme Filters", companyName: "Acme Filters" });
    expect(d.title).toBe("Acme Filters");
    expect(d.under).toBe("Listed as 00 Industrial Filtration Distributor");
  });

  it("a listing outside the buy box: the flags and their reasons; empty facts say Not stated, Not set, Not known", () => {
    const d = listingPopup({ ...base, ebitda: null, sde: 410_000, location: "Spokane, WA", industry: "Retail", whatItDoes: "Franchise of a coffee chain", askingPrice: null, askingMultiple: null, brokerName: null, whySelling: null, source: null, listingUrl: null, revenue: null });
    expect(d.fits).toBe(false);
    expect(d.tier).toBe("outside");
    expect(d.pill).toBe("Outside · franchise · too small · retail · location");
    expect(d.reasons).toEqual([
      "Too small: SDE $410K is under $0.75M, where the stretch range starts.",
      "Franchise: the name or the description says franchise.",
      "Retail: the industry or the description reads as retail or direct to consumer.",
      "Location: WA is outside the buy box regions (Southeast, East Coast).",
    ]);
    const f = Object.fromEntries(d.facts.map((x) => [x.key, x]));
    expect(f.earnings).toMatchObject({ label: "SDE", value: "$410K" });
    expect(f.revenue.value).toBe("Not stated");
    expect(f.asking).toMatchObject({ value: "Not stated", note: null });
    expect(f.broker.value).toBe("Not set");
    expect(f.source.value).toBe("Not set");
    expect(f.why.value).toBe("Not known");
    expect(d.link).toBeNull();
  });

  it("no earnings and no location: the size and the location are not checked, said plainly", () => {
    expect(buyBoxReasons({ name: "x", ebitda: null, sde: null, location: null })).toEqual(["No EBITDA or SDE figure is stated, so the size cannot be checked yet.", "No location stated, so the location is not checked."]);
    expect(buyBoxReasons({ name: "x", ebitda: 4_000_000, location: "Somewhere" })).toEqual(["Too big: EBITDA $4.0M is over $3.5M, where the stretch range ends.", 'No state found in "Somewhere", so the location is not checked.']);
    expect(listingPopup({ ...base, ebitda: null, sde: null }).facts[1].label).toBe("EBITDA or SDE");
  });

  it("a near fit (revision 1): the stretch range or the region, read from the Buy box settings", () => {
    const near = listingPopup({ ...base, ebitda: 3_000_000 });
    expect(near).toMatchObject({ tier: "near", fits: false, pill: "Near fit · too big" });
    expect(near.reasons[0]).toBe("Near fit on size: EBITDA $3.0M is over the core $1M to $2.5M but inside the stretch range $0.75M to $3.5M.");
    expect(listingPopup({ ...base, ebitda: 900_000 }).reasons[0]).toBe("Near fit on size: EBITDA $900K is under the core $1M to $2.5M but inside the stretch range $0.75M to $3.5M.");
    expect(listingPopup({ ...base, location: "Columbus, OH" })).toMatchObject({ tier: "near", pill: "Near fit · location" });
    const ohio = listingPopup({ ...base, location: "Columbus, OH" }, { ...defaultBuyBoxSettings(), regionsOther: "Ohio" });
    expect(ohio).toMatchObject({ tier: "fits", pill: "Fits" });
    expect(ohio.reasons[1]).toBe("Location fits: OH is in Ohio.");
    const wide = listingPopup({ ...base, ebitda: 600_000 }, { ...defaultBuyBoxSettings(), coreMin: 500_000, stretchMin: 400_000 });
    expect(wide.reasons[0]).toBe("Size fits: EBITDA $600K is inside $0.5M to $2.5M.");
  });

  it("keeps a full address as it is", () => {
    expect(listingPopup({ ...base, listingUrl: "http://example.com/x" }).link).toBe("http://example.com/x");
    expect(listingPopup({ ...base, listingUrl: "  " }).link).toBeNull();
  });
});
