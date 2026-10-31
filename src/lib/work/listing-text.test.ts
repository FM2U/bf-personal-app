import { describe, expect, it } from "vitest";
import { EMPTY_LISTING_FIELDS, listingNumbers, listingPrompt, readListingFields, validateListingReply } from "./listing-text";

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
