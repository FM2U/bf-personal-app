import { describe, expect, it } from "vitest";
import { calendarContacts } from "@/lib/accountability/report-worked";
import type { ActivityRow } from "@/lib/accountability/activity";
import { personFilterGroups } from "@/lib/work/people";
import { brokerText, isBrokerPerson, looksLikePerson, matchName, parseBrokerText, proposeLink, rolesWithBroker, type BrokerChoices } from "@/lib/work/broker-links";

const choices: BrokerChoices = {
  people: [
    { id: "p1", name: "Mark Reed", role: "broker", organizationId: "o1", organization: "Transworld" },
    { id: "p2", name: "Rita Caldwell", role: "broker", organizationId: "o2", organization: "Sunbelt Business Brokers" },
    { id: "p3", name: "Carla Jenkins", role: "personal_network", organizationId: null, organization: null },
  ],
  organizations: [
    { id: "o1", name: "Transworld", kind: "broker" },
    { id: "o2", name: "Sunbelt Business Brokers", kind: "broker" },
  ],
};

describe("broker links (push K, 2026-11-24)", () => {
  it("reads the typed broker text into a person and a firm", () => {
    expect(parseBrokerText("Transworld, Mark Reed")).toEqual({ person: "Mark Reed", firm: "Transworld" });
    expect(parseBrokerText("Mark Reed (Sunbelt)")).toEqual({ person: "Mark Reed", firm: "Sunbelt" });
    expect(parseBrokerText("Thatcher Brown at Example Business Brokers")).toEqual({ person: "Thatcher Brown", firm: "Example Business Brokers" });
    expect(parseBrokerText("Sunbelt")).toEqual({ person: null, firm: "Sunbelt" });
    expect(parseBrokerText("Rita C.")).toEqual({ person: "Rita C.", firm: null });
    expect(parseBrokerText("Excendio Advisors")).toEqual({ person: null, firm: "Excendio Advisors" });
    expect(parseBrokerText("  ")).toEqual({ person: null, firm: null });
    // A name on file settles the part, whatever it looks like.
    expect(parseBrokerText("Reed Mark Partners, Acme", { people: ["Reed Mark Partners"] })).toEqual({ person: "Reed Mark Partners", firm: "Acme" });
    expect(looksLikePerson("Murphy Business")).toBe(false);
    expect(looksLikePerson("Jane O'Neil")).toBe(true);
  });

  it("matches a typed name to what is on file: the same name, one likely match, or a new record", () => {
    expect(matchName("mark reed", choices.people, "person")).toEqual({ id: "p1", name: "Mark Reed", isNew: false, guess: false });
    expect(matchName("Rita C.", choices.people, "person")).toEqual({ id: "p2", name: "Rita Caldwell", isNew: false, guess: true });
    expect(matchName("R. Caldwell", choices.people, "person")).toEqual({ id: "p2", name: "Rita Caldwell", isNew: false, guess: true });
    expect(matchName("Thatcher Brown", choices.people, "person")).toEqual({ id: null, name: "Thatcher Brown", isNew: true, guess: false });
    expect(matchName("Sunbelt", choices.organizations, "organization")).toEqual({ id: "o2", name: "Sunbelt Business Brokers", isNew: false, guess: true });
    expect(matchName(null, choices.people, "person")).toBeNull();
  });

  it("proposes a row of Brokers to link", () => {
    expect(proposeLink({ id: "d1", name: "Dalton Services", brokerName: "Transworld, Mark Reed" }, choices)).toEqual({ dealId: "d1", deal: "Dalton Services", typed: "Transworld, Mark Reed", broker: { id: "p1", name: "Mark Reed", isNew: false, guess: false }, brokerage: { id: "o1", name: "Transworld", isNew: false, guess: false } });
    // No firm typed: the broker's own brokerage.
    expect(proposeLink({ id: "d2", name: "Oakline", brokerName: "Rita C." }, choices)?.brokerage).toEqual({ id: "o2", name: "Sunbelt Business Brokers", isNew: false, guess: false });
    // A firm only: no person proposed.
    expect(proposeLink({ id: "d3", name: "Summit", brokerName: "Transworld" }, choices)).toMatchObject({ broker: null, brokerage: { id: "o1" } });
    expect(proposeLink({ id: "d4", name: "Empty", brokerName: null }, choices)).toBeNull();
  });

  it("gives a picked broker the role Broker without taking a role away", () => {
    expect(rolesWithBroker(null, null)).toEqual({ role: "broker", second: null, changed: true });
    expect(rolesWithBroker("other", null)).toEqual({ role: "broker", second: null, changed: true });
    expect(rolesWithBroker("personal_network", null)).toEqual({ role: "personal_network", second: "broker", changed: true });
    expect(rolesWithBroker("broker", null)).toEqual({ role: "broker", second: null, changed: false });
    expect(rolesWithBroker("lender", "broker")).toEqual({ role: "lender", second: "broker", changed: false });
    expect(rolesWithBroker("lender", "investor")).toEqual({ role: "lender", second: "investor", changed: false });
  });

  it("counts a person as a broker by Role or Also", () => {
    expect(isBrokerPerson({ outreach_role: "broker" })).toBe(true);
    expect(isBrokerPerson({ outreach_role: "personal_network", second_role: "broker" })).toBe(true);
    expect(isBrokerPerson({ outreach_role: "personal_network" })).toBe(false);
    expect(isBrokerPerson(null)).toBe(false);
  });

  it("keeps the typed text in step with the links", () => {
    expect(brokerText("Mark Reed", "Transworld")).toBe("Transworld, Mark Reed");
    expect(brokerText("Mark Reed", null)).toBe("Mark Reed");
    expect(brokerText(null, null)).toBeNull();
  });

  it("counts a kept calendar meeting with a person as contact with that person, once", () => {
    const A = "11111111-1111-4111-8111-111111111111";
    const B = "22222222-2222-4222-8222-222222222222";
    const cal = (id: string, href: string | null): ActivityRow => ({ id, kind: "calendar", text: "Call", record: null, time: "10:00", href });
    const kept = [cal("cal:1", `/work/people/${A}`), cal("cal:2", `/work/people/${B}`), cal("cal:3", "/work/deals/33333333-3333-4333-8333-333333333333"), cal("cal:4", null)];
    // B also has a call logged by hand that day: counted from the logged call only.
    const out = calendarContacts(kept, [{ contactId: B, method: "call" }, { contactId: A, method: "email" }], (id) => id === A);
    expect(out).toEqual([{ rowId: "cal:1", contactId: A, broker: true, method: "meeting" }]);
  });

  it("finds a person under either role with the Role filter on Contacts", () => {
    const role = personFilterGroups("2026-11-24", () => null, []).find((g) => g.key === "role");
    const p = { roleKey: "personal_network", alsoKey: "broker", lastContactOn: null, nextFollowUp: null, organizationId: null };
    expect(role?.test(p, "broker")).toBe(true);
    expect(role?.test(p, "personal_network")).toBe(true);
    expect(role?.test(p, "lender")).toBe(false);
  });
});
