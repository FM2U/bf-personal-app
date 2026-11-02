import { describe, expect, it } from "vitest";
import { EMPTY_LISTING_FIELDS, firstUrl, listingNumbers, listingPrompt, readListingFields, validateListingReply, withListingUrl } from "./listing-text";

describe("Fill from text", () => {
  it("asks for JSON with the listing fields", () => {
    const p = listingPrompt("Riverbend Commercial Cleaning. Revenue $4.1M, SDE $1.2M, asking $3.9M. Macon, GA.");
    expect(p).toContain("TASK: listing_fields");
    expect(p).toContain('"earnings"');
    expect(p).toContain('"listing_name"');
    expect(p).toContain('"company_name"');
    expect(p).toContain('"Cash Flow"');
    expect(p).toContain("Riverbend");
  });

  it("builds the listing name from the description and keeps the company name apart; a typed Cash Flow figure counts as SDE", () => {
    const f = readListingFields({ listing_name: "industrial filtration distributor co", company_name: "", revenue: "$4.1M", earnings: "$1.2M SDE" })!;
    expect(f.name).toBe("00 Industrial Filtration Distributor");
    expect(f.company_name).toBe("");
    expect(readListingFields({ listing_name: "Commercial cleaning", company_name: "Riverbend Commercial Cleaning", revenue: "$4.1M" })).toMatchObject({ name: "00 Commercial Cleaning", company_name: "Riverbend Commercial Cleaning" });
    expect(listingNumbers({ revenue: "", earnings: "$900K cash flow", asking_price: "" })).toEqual({ revenue: null, ebitda: null, sde: 900_000, asking_price: null });
  });

  it("checks the reply for the retry and names the problem", () => {
    expect(validateListingReply({ listing_name: "Commercial cleaning", revenue: "$4.1M" })).toMatchObject({ ok: true, value: { name: "00 Commercial Cleaning" } });
    expect(validateListingReply("I can see a distributor but no figures.")).toMatchObject({ ok: false, error: expect.stringContaining("not a JSON object") });
    expect(validateListingReply({ what_it_does: "x" })).toMatchObject({ ok: false, error: expect.stringContaining('"listing_name" is empty') });
    expect(validateListingReply({ listing_name: ["x"] })).toMatchObject({ ok: false, error: expect.stringContaining('"listing_name" is not text') });
  });

  it("reads the AI reply, keeps only known sources, and refuses an empty reply", () => {
    const f = readListingFields({ name: "Riverbend Commercial Cleaning", source: "Broker newsletter", what_it_does: "Janitorial for office parks", broker: "Sunbelt, Dana Whitfield", revenue: "$4.1M", sde: "$1.2M SDE", asking: "$3.9M", location: "Macon, GA", industry: "Commercial services", link: "bizbuysell.com/x" });
    expect(f).toMatchObject({ name: "Riverbend Commercial Cleaning", source: "Broker newsletter", broker_name: "Sunbelt, Dana Whitfield", earnings: "$1.2M SDE", asking_price: "$3.9M", listing_url: "bizbuysell.com/x" });
    expect(readListingFields({ name: "X", source: "Somewhere else" })!.source).toBe("Broker newsletter");
    expect(readListingFields({ what_it_does: "nothing else" })).toBeNull();
    expect(readListingFields("text")).toBeNull();
    expect(readListingFields(null)).toBeNull();
  });

  it("turns the typed figures into numbers, SDE when the text says so", () => {
    expect(listingNumbers({ revenue: "$4.1M", earnings: "$1.2M SDE", asking_price: "$3.9M" })).toEqual({ revenue: 4_100_000, ebitda: null, sde: 1_200_000, asking_price: 3_900_000 });
    expect(listingNumbers({ revenue: "", earnings: "$1.4M", asking_price: "" })).toEqual({ revenue: null, ebitda: 1_400_000, sde: null, asking_price: null });
    expect(listingNumbers(EMPTY_LISTING_FIELDS)).toEqual({ revenue: null, ebitda: null, sde: null, asking_price: null });
  });
});

describe("Fill from text: the link (Edit batch C round 3)", () => {
  it("asks the AI for the first http or https address", () => {
    expect(listingPrompt("x".repeat(30))).toContain('"listing_url" is the first web address in the text that starts with http:// or https://');
  });

  it("finds the first http or https address and drops the punctuation that ends the sentence", () => {
    expect(firstUrl("New listing: https://www.bizbuysell.com/Business-Opportunity/hvac/123/. Call me.")).toBe("https://www.bizbuysell.com/Business-Opportunity/hvac/123/");
    expect(firstUrl("See (https://transworld.com/listing?id=9&src=mail), or http://second.com")).toBe("https://transworld.com/listing?id=9&src=mail");
    expect(firstUrl('<a href="https://sunbelt.net/l/77">here</a>')).toBe("https://sunbelt.net/l/77");
    expect(firstUrl("Teaser at <http://broker.example.com/t.pdf>")).toBe("http://broker.example.com/t.pdf");
    expect(firstUrl("[Open the listing](https://axial.net/deal/5)!")).toBe("https://axial.net/deal/5");
  });

  it("skips what is not a web address and returns null when there is none", () => {
    expect(firstUrl("Visit bizbuysell.com or email dana@sunbelt.net")).toBeNull();
    expect(firstUrl("broken http:// then https://intranet then https://real.com/x")).toBe("https://real.com/x");
    expect(firstUrl("")).toBeNull();
    expect(firstUrl(null)).toBeNull();
  });

  it("fills the link from the text only when the AI left it empty", () => {
    const text = "Riverbend Commercial Cleaning, SDE $1.2M. Details: https://www.bizbuysell.com/x/1. Thanks";
    expect(withListingUrl({ ...EMPTY_LISTING_FIELDS, name: "00 Cleaning" }, text).listing_url).toBe("https://www.bizbuysell.com/x/1");
    expect(withListingUrl({ ...EMPTY_LISTING_FIELDS, listing_url: "https://other.com/a" }, text).listing_url).toBe("https://other.com/a");
    expect(withListingUrl(EMPTY_LISTING_FIELDS, "no address here at all").listing_url).toBe("");
  });
});
