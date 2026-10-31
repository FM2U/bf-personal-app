import { describe, expect, it } from "vitest";
import { EMPTY_LISTING_FIELDS, listingNumbers, listingPrompt, readListingFields } from "./listing-text";

describe("Fill from text", () => {
  it("asks for JSON with the listing fields", () => {
    const p = listingPrompt("Riverbend Commercial Cleaning. Revenue $4.1M, SDE $1.2M, asking $3.9M. Macon, GA.");
    expect(p).toContain("TASK: listing_fields");
    expect(p).toContain('"earnings"');
    expect(p).toContain("Riverbend");
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
