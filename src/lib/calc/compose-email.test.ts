import { describe, expect, it } from "vitest";
import { composePurpose, defaultPipelineRecipient, matchRecipient, organizationRecipients, pipelineRecipients } from "./compose-email";
import { emailAddressProblem, isValidEmail } from "../email-address";
import { sentEmailCommunication } from "./sent-email";

const people = {
  main: { id: "main", name: "Pat Main", email: "pat@example.com" },
  source: { id: "source", name: "Bo Broker", email: "bo@broker.example.com" },
  intro: { id: "intro", name: "Ivy Intro", email: "ivy@example.com" },
  noEmail: { id: "noEmail", name: "No Email", email: null },
  badEmail: { id: "badEmail", name: "Bad Email", email: "not an email" },
};

describe("Email button: recipient on a pipeline item", () => {
  it("defaults to the main contact", () => {
    expect(defaultPipelineRecipient({ primary_contact_id: "main", source_contact_id: "source" }, people)?.email).toBe("pat@example.com");
  });
  it("falls back to Deal came from when the main contact is missing or has no valid email", () => {
    expect(defaultPipelineRecipient({ source_contact_id: "source" }, people)?.role).toBe("Deal came from");
    expect(defaultPipelineRecipient({ primary_contact_id: "noEmail", source_contact_id: "source" }, people)?.email).toBe("bo@broker.example.com");
    expect(defaultPipelineRecipient({ primary_contact_id: "badEmail", source_contact_id: "source" }, people)?.contactId).toBe("source");
  });
  it("never defaults to Introduced by; nobody when neither has an email", () => {
    expect(defaultPipelineRecipient({ introduced_by_contact_id: "intro" }, people)).toBeNull();
    expect(defaultPipelineRecipient({ primary_contact_id: "noEmail" }, people)).toBeNull();
    expect(defaultPipelineRecipient({ primary_contact_id: "missing-id" }, people)).toBeNull();
  });
  it("lists main contact, Deal came from, Introduced by, then organization people, each once, only with email", () => {
    const list = pipelineRecipients(
      { primary_contact_id: "main", source_contact_id: "source", introduced_by_contact_id: "intro" },
      people,
      [people.main, people.noEmail, { id: "org1", name: "Olive Org", email: "olive@example.com" }],
    );
    expect(list.map((r) => [r.contactId, r.role])).toEqual([
      ["main", "Main contact"],
      ["source", "Deal came from"],
      ["intro", "Introduced by"],
      ["org1", "At the organization"],
    ]);
  });
  it("the same person as main contact and Deal came from is listed once, as main contact", () => {
    const list = pipelineRecipients({ primary_contact_id: "main", source_contact_id: "main" }, people);
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe("Main contact");
  });
});

describe("Email button: organization recipients and matching the To field", () => {
  it("chooses a person only when exactly one has an email", () => {
    expect(organizationRecipients([people.main, people.noEmail]).defaultTo?.email).toBe("pat@example.com");
    expect(organizationRecipients([people.main, people.source]).defaultTo).toBeNull();
    expect(organizationRecipients([people.noEmail]).recipients).toEqual([]);
  });
  it("matches the typed address to a listed person, ignoring case and spaces", () => {
    const list = pipelineRecipients({ primary_contact_id: "main", source_contact_id: "source" }, people);
    expect(matchRecipient("  PAT@Example.com ", list)?.contactId).toBe("main");
    expect(matchRecipient("someone@else.com", list)).toBeNull();
    expect(matchRecipient("", list)).toBeNull();
  });
});

describe("Email address check", () => {
  it("accepts one plain address", () => {
    expect(isValidEmail("name@example.com")).toBe(true);
    expect(isValidEmail(" first.last+tag@sub.example.co ")).toBe(true);
    expect(emailAddressProblem("name@example.com")).toBeNull();
  });
  it("rejects empty, malformed, and several addresses with a plain message", () => {
    expect(emailAddressProblem("")).toBe("Type an email address.");
    expect(emailAddressProblem("   ")).toBe("Type an email address.");
    expect(emailAddressProblem("name@example")).toMatch(/not a valid email address/);
    expect(emailAddressProblem("name.example.com")).toMatch(/not a valid email address/);
    expect(emailAddressProblem("Pat <pat@example.com>")).toMatch(/not a valid email address|one email address/);
    expect(emailAddressProblem("a@example.com, b@example.com")).toBe("Type one email address only.");
    expect(emailAddressProblem("a@example.com;b@example.com")).toBe("Type one email address only.");
    expect(isValidEmail("a@example.com\r\nBcc: x@example.com")).toBe(false);
  });
});

describe("Email button: outreach purpose from the compose context", () => {
  it("an acquisition item is deal sourcing; a consulting item is consulting (even for other contacts)", () => {
    expect(composePurpose({ pipelineKind: "acquisition", contact: {} })).toBe("deal_sourcing");
    expect(composePurpose({ pipelineKind: "acquisition", contact: { is_consulting_lead: true } })).toBe("deal_sourcing");
    expect(composePurpose({ pipelineKind: "consulting", contact: { is_deal_source: true } })).toBe("consulting");
  });
  it("other items and no item follow the Outreach Queue rule for the contact", () => {
    expect(composePurpose({ pipelineKind: "job", contact: { is_deal_source: true } })).toBe("deal_sourcing");
    expect(composePurpose({ contact: { is_consulting_lead: true, is_deal_source: true } })).toBe("consulting");
    expect(composePurpose({ contact: { is_deal_source: true } })).toBe("deal_sourcing");
  });
  it("partner, other contacts, and no contact are general", () => {
    expect(composePurpose({ contact: { is_deal_source: false } })).toBe("general");
    expect(composePurpose({ contact: null })).toBe("general");
    expect(composePurpose({ pipelineKind: "investor" })).toBe("general");
  });
  it("the saved communication is outreach, linked to the organization of the page or the contact's own", () => {
    const base = { kind: "outreach" as const, ownerId: "o", to: "x@example.com", subject: "Hi", body: "Hello", sentAt: "2026-10-27T12:00:00Z" };
    expect(sentEmailCommunication({ ...base, contact: null, organizationId: "org-page" })).toMatchObject({ contact_id: null, organization_id: "org-page", is_outreach: true, purpose: "general" });
    expect(sentEmailCommunication({ ...base, contact: { id: "c", organization_id: "org-c" } })).toMatchObject({ contact_id: "c", organization_id: "org-c" });
    expect(sentEmailCommunication({ ...base, contact: { id: "c" }, pipelineItemId: "item", purpose: composePurpose({ pipelineKind: "acquisition" }) })).toMatchObject({ pipeline_item_id: "item", purpose: "deal_sourcing" });
  });
});
