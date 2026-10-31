/**
 * The Work module's sample data (database update 0020), added by "Load sample data": the listings and deals of the
 * approved mockup (2026-10-30), with their brokers, numbers, waits, key findings, and on Dalton Services a few
 * timeline entries and two documents. Pure: dates are relative to `today`; tested in src/lib/work/sample.test.ts.
 * Unlike the rest of the sample data these names come from the approved mockup and do not start with "Sample";
 * every row is still recorded in sample_records, so Remove sample data deletes them.
 */
import { addDaysISO } from "@/lib/calc/dates";
import { checkBuyBox, dealSourceTypeFor } from "@/lib/work/buy-box";
import { STAGE_DEFAULTS } from "@/lib/work/stages";

export type WorkSampleSetup = { pipelineId: string; stages: Record<string, string> };

type R = Record<string, unknown>;

export type WorkSample = {
  organizations: R[];
  contacts: R[];
  items: R[];
  financials: R[];
  communications: R[];
  notes: R[];
  /** Stage entry dates to set after the insert (the insert trigger stamps "now"): item id to days ago, plus the earlier stages. */
  stageDates: { itemId: string; enteredDaysAgo: number; history: { stageName: string; daysAgo: number }[] }[];
  /** Small files to put in storage and record as documents (Dalton Services). */
  documents: { itemId: string; fileName: string; kind: string; mimeType: string; text: string }[];
};

/** Every sample name the Work module adds (listings, deals, brokers, firms), so tests can tell them apart. */
export const WORK_SAMPLE_NAMES = [
  "Apex Precision Machining", "Sunny Smiles Franchise, 3 units", "Harbor Point Boat Storage", "Northstar Managed IT", "Cascade Outdoor Retail",
  "Bluegrass Senior Transport", "Titan Steel Fabrication", "Hilltop Pest Solutions", "BrightPath Home Care", "Oakline Dental Lab",
  "Summit Logistics Group", "Dalton Services", "Coastal Fleet Maintenance", "Meridian Industrial Coatings", "Ridgeline Commercial Roofing",
  "Pinecrest Landscaping", "Lakeside Car Wash, 2 sites", "Great Plains Grain Hauling", "QuickFit Gym Franchise", "Valley Print Group",
  "Transworld Business Advisors", "Sunbelt Business Brokers", "Murphy Business", "Rachel Kim", "Mark Reed", "Dana Whitfield", "Luis Ortega",
];

export function buildWorkSample(s: WorkSampleSetup, newId: () => string, today: string): WorkSample {
  const ago = (n: number) => addDaysISO(today, -n);
  const ahead = (n: number) => addDaysISO(today, n);
  const stage = (name: string) => s.stages[name] ?? null;

  const org = { transworld: newId(), sunbelt: newId(), murphy: newId() };
  const organizations: R[] = [
    { id: org.transworld, name: "Transworld Business Advisors", kind: "broker" },
    { id: org.sunbelt, name: "Sunbelt Business Brokers", kind: "broker" },
    { id: org.murphy, name: "Murphy Business", kind: "broker" },
  ];
  const c = { kim: newId(), reed: newId(), whitfield: newId(), ortega: newId() };
  const broker = (id: string, name: string, orgId: string, email: string) => ({ id, name, roles: ["broker"], organization_id: orgId, email, relationship_group: "professional", is_deal_source: true, title: "Business broker" });
  const contacts: R[] = [
    broker(c.kim, "Rachel Kim", org.transworld, "rachel.kim@example.com"),
    broker(c.reed, "Mark Reed", org.transworld, "mark.reed@example.com"),
    broker(c.whitfield, "Dana Whitfield", org.sunbelt, "dana.whitfield@example.com"),
    broker(c.ortega, "Luis Ortega", org.murphy, "luis.ortega@example.com"),
  ];

  const items: R[] = [];
  const financials: R[] = [];
  const add = (row: R, money: { revenue?: number | null; ebitda?: number | null; sde?: number | null; asking?: number | null }) => {
    const id = newId();
    const full: R = { id, pipeline_id: s.pipelineId, screened: true, deal_source_type: dealSourceTypeFor(row.source as string), ...row };
    full.buy_box_note = checkBuyBox({ name: String(full.name), whatItDoes: full.what_it_does as string, industry: full.industry as string, location: full.location as string, ebitda: money.ebitda, sde: money.sde }).label;
    items.push(full);
    if (money.revenue !== undefined || money.ebitda !== undefined || money.sde !== undefined || money.asking !== undefined) {
      financials.push({ id: newId(), item_id: id, revenue: money.revenue ?? null, ebitda: money.ebitda ?? null, sde: money.sde ?? null, asking_price: money.asking ?? null });
    }
    return id;
  };

  // Seven listings to screen (screened = false, no stage): three fit, four do not, one from the network.
  const listing = (row: R, money: Parameters<typeof add>[1]) => add({ ...row, screened: false, stage_id: null }, money);
  listing({ name: "Apex Precision Machining", what_it_does: "CNC parts for aerospace and medical device makers", source: "Broker newsletter", broker_name: "Transworld", location: "Huntsville, AL", industry: "Precision manufacturing", listing_url: "https://www.example.com/listings/apex-precision" }, { revenue: 6_200_000, ebitda: 1_400_000, asking: 5_500_000 });
  listing({ name: "Sunny Smiles Franchise, 3 units", what_it_does: "Children's dental franchise locations", source: "Broker newsletter", broker_name: "BizBuySell", location: "Orlando, FL", industry: "Dental services" }, { revenue: 2_800_000, sde: 410_000, asking: 1_600_000 });
  listing({ name: "Harbor Point Boat Storage", what_it_does: "Dry stack storage and service for private boats", source: "Broker newsletter", broker_name: "Murphy", location: "Savannah, GA", industry: "Marine services" }, { revenue: 1_100_000, sde: 180_000, asking: 900_000 });
  listing({ name: "Northstar Managed IT", what_it_does: "Outsourced IT and help desk for firms with 20 to 200 staff", source: "Broker outreach", broker_name: "Benchmark", location: "Richmond, VA", industry: "IT services" }, { revenue: 7_800_000, ebitda: 1_900_000, asking: 8_500_000 });
  listing({ name: "Cascade Outdoor Retail", what_it_does: "Two retail stores selling camping gear", source: "Broker newsletter", broker_name: "BizBuySell", location: "Spokane, WA", industry: "Retail" }, { revenue: 3_300_000, sde: 520_000, asking: 1_400_000 });
  listing({ name: "Bluegrass Senior Transport", what_it_does: "Non-emergency medical transport under Medicaid contracts", source: "Network", broker_name: "Intro from J. Alvarez", location: "Lexington, KY", industry: "Medical transport" }, { revenue: 5_000_000, ebitda: 1_100_000, asking: null });
  listing({ name: "Titan Steel Fabrication", what_it_does: "Structural steel for commercial builders", source: "Broker newsletter", broker_name: "Sunbelt", location: "Charlotte, NC", industry: "Steel fabrication" }, { revenue: 22_000_000, ebitda: 4_300_000, asking: 19_000_000 });

  // Nine deals across the stages. Next actions that equal the stage default make Done ask about the next stage.
  const d = (name: string) => STAGE_DEFAULTS[name as keyof typeof STAGE_DEFAULTS].title;
  const stageDates: WorkSample["stageDates"] = [];
  const entered = (itemId: string, enteredDaysAgo: number, history: { stageName: string; daysAgo: number }[] = []) => stageDates.push({ itemId, enteredDaysAgo, history });

  const hilltop = add({ name: "Hilltop Pest Solutions", stage_id: stage("Interested"), what_it_does: "Residential and commercial pest control, 2,400 recurring accounts", source: "Broker newsletter", broker_name: "Transworld, Rachel Kim", primary_contact_id: c.kim, organization_id: org.transworld, location: "Athens, GA", industry: "Pest control", next_action: d("Interested"), next_action_due: today, next_action_minutes: 15 }, { revenue: 3_400_000, sde: 1_000_000, asking: 3_600_000 });
  entered(hilltop, 0);
  const brightpath = add({ name: "BrightPath Home Care", stage_id: stage("NDA signed"), what_it_does: "Non-medical home care, 85 clients, private pay and LTC insurance", source: "Broker newsletter", broker_name: "Transworld, Rachel Kim", primary_contact_id: c.kim, organization_id: org.transworld, location: "Nashville, TN", industry: "Home care", next_action: d("NDA signed"), next_action_due: today, next_action_minutes: 10, key_finding: "Caregiver retention is the question", waiting_on: "The CIM and a call", waiting_since: ago(3) }, { revenue: 4_200_000, ebitda: 1_300_000, asking: 4_900_000 });
  entered(brightpath, 3, [{ stageName: "Interested", daysAgo: 5 }]);
  const oakline = add({ name: "Oakline Dental Lab", stage_id: stage("NDA signed"), what_it_does: "Crowns and implants for 140 dental practices", source: "Broker newsletter", broker_name: "Murphy, Luis Ortega", primary_contact_id: c.ortega, organization_id: org.murphy, location: "Birmingham, AL", industry: "Dental lab", next_action: "Wait for the CIM", next_action_due: ahead(2), key_finding: "Owner is the lead technician", waiting_on: "The CIM", waiting_since: ago(2) }, { revenue: 5_100_000, ebitda: 1_600_000, asking: 6_200_000 });
  entered(oakline, 2, [{ stageName: "Interested", daysAgo: 6 }]);
  const summit = add({ name: "Summit Logistics Group", stage_id: stage("Broker call"), what_it_does: "Regional LTL freight brokerage, 300 shipper accounts", source: "Broker outreach", broker_name: "Transworld, Mark Reed", primary_contact_id: c.reed, organization_id: org.transworld, location: "Knoxville, TN", industry: "Freight brokerage", next_action: "Seller call to be scheduled", next_action_due: ahead(5), key_finding: "Margins thin; growth came from one shipper", waiting_on: "A seller call to be scheduled", waiting_since: ago(11) }, { revenue: 18_000_000, ebitda: 2_200_000, asking: 9_500_000 });
  entered(summit, 11, [{ stageName: "Interested", daysAgo: 18 }, { stageName: "NDA signed", daysAgo: 15 }]);
  const dalton = add({ name: "Dalton Services", stage_id: stage("CIM review"), what_it_does: "Commercial HVAC service and maintenance contracts", source: "Broker newsletter", broker_name: "Rachel Kim, Transworld", primary_contact_id: c.kim, organization_id: org.transworld, location: "Chattanooga, TN", industry: "Home and building services", why_selling: "Retiring, no successor", listing_url: "https://www.example.com/listings/dalton-services", next_action: "Review the CIM and write the key finding", next_action_due: today, next_action_minutes: 60, key_finding: "70% of revenue is recurring maintenance contracts; service calls are the rest", open_questions: "Why is the owner selling at 58?\nTechnician count and tenure?\nAny customer over 10% of revenue?" }, { revenue: 5_600_000, ebitda: 1_700_000, asking: 6_000_000 });
  entered(dalton, 3, [{ stageName: "Interested", daysAgo: 8 }, { stageName: "NDA signed", daysAgo: 7 }, { stageName: "Broker call", daysAgo: 4 }]);
  const coastal = add({ name: "Coastal Fleet Maintenance", stage_id: stage("Seller call"), what_it_does: "Fleet repair for delivery and utility companies", source: "Broker newsletter", broker_name: "Sunbelt, Dana Whitfield", primary_contact_id: c.whitfield, organization_id: org.sunbelt, location: "Jacksonville, FL", industry: "Fleet services", next_action: d("Seller call"), next_action_due: today, next_action_minutes: 45, key_finding: "Seller wants to stay 12 months; good sign" }, { revenue: 6_800_000, ebitda: 1_500_000, asking: 5_800_000 });
  entered(coastal, 2, [{ stageName: "Interested", daysAgo: 14 }, { stageName: "NDA signed", daysAgo: 12 }, { stageName: "Broker call", daysAgo: 9 }, { stageName: "CIM review", daysAgo: 7 }]);
  const meridian = add({ name: "Meridian Industrial Coatings", stage_id: stage("Model"), what_it_does: "Powder coating for OEM equipment makers", source: "Broker outreach", broker_name: "Benchmark", location: "Greenville, SC", industry: "Industrial coatings", next_action: "Finish the 7-year model, scenario at 3x TTM", next_action_due: ago(1), next_action_minutes: 120, key_finding: "TTM up 18%; check if one customer drove it" }, { revenue: 11_000_000, ebitda: 2_400_000, asking: 8_400_000 });
  entered(meridian, 4, [{ stageName: "Interested", daysAgo: 24 }, { stageName: "NDA signed", daysAgo: 22 }, { stageName: "Broker call", daysAgo: 18 }, { stageName: "CIM review", daysAgo: 15 }, { stageName: "Seller call", daysAgo: 9 }]);
  const ridgeline = add({ name: "Ridgeline Commercial Roofing", stage_id: stage("Partner presentation"), what_it_does: "Commercial roofing repair and maintenance for property managers", source: "Broker newsletter", broker_name: "Sunbelt, Dana Whitfield", primary_contact_id: c.whitfield, organization_id: org.sunbelt, location: "Charleston, SC", industry: "Roofing services", next_action: d("Partner presentation"), next_action_due: ahead(4), next_action_minutes: 90, key_finding: "Backlog covers 7 months" }, { revenue: 9_200_000, ebitda: 2_100_000, asking: 7_900_000 });
  entered(ridgeline, 1, [{ stageName: "Interested", daysAgo: 30 }, { stageName: "NDA signed", daysAgo: 28 }, { stageName: "Broker call", daysAgo: 25 }, { stageName: "CIM review", daysAgo: 21 }, { stageName: "Seller call", daysAgo: 16 }, { stageName: "Model", daysAgo: 10 }]);
  const pinecrest = add({ name: "Pinecrest Landscaping", stage_id: stage("IOI or LOI"), what_it_does: "Commercial grounds maintenance, 200 HOA and office contracts", source: "Broker newsletter", broker_name: "Sunbelt, Dana Whitfield", primary_contact_id: c.whitfield, organization_id: org.sunbelt, location: "Atlanta, GA", industry: "Grounds maintenance", next_action: "Response to the LOI", next_action_due: ahead(3), key_finding: "LOI at 3.2x TTM, seller note 15%", waiting_on: "Response to the LOI", waiting_since: ago(6) }, { revenue: 7_600_000, ebitda: 1_900_000, asking: 6_100_000 });
  entered(pinecrest, 6, [{ stageName: "Interested", daysAgo: 40 }, { stageName: "NDA signed", daysAgo: 38 }, { stageName: "Broker call", daysAgo: 35 }, { stageName: "CIM review", daysAgo: 31 }, { stageName: "Seller call", daysAgo: 26 }, { stageName: "Model", daysAgo: 20 }, { stageName: "Partner presentation", daysAgo: 12 }]);

  // Passed (kept so they are never screened twice) and one lost.
  const passed = (row: R, money: Parameters<typeof add>[1], daysAgo: number) => entered(add({ ...row, stage_id: stage("Passed") }, money), daysAgo);
  passed({ name: "Lakeside Car Wash, 2 sites", what_it_does: "Two express car wash sites", source: "Broker newsletter", broker_name: "BizBuySell", location: "Macon, GA", industry: "Retail services", pass_reason: "retail_dtc" }, { revenue: 2_100_000, sde: 640_000, asking: 2_900_000 }, 1);
  passed({ name: "Great Plains Grain Hauling", what_it_does: "Grain trucking for farm cooperatives", source: "Broker newsletter", broker_name: "Sunbelt", location: "Sioux Falls, SD", industry: "Trucking", pass_reason: "location" }, { revenue: 6_900_000, ebitda: 1_300_000, asking: 5_200_000 }, 1);
  passed({ name: "QuickFit Gym Franchise", what_it_does: "One franchise gym location", source: "Broker newsletter", broker_name: "BizBuySell", location: "Tampa, FL", industry: "Fitness", pass_reason: "franchise" }, { revenue: 1_400_000, sde: 290_000, asking: 950_000 }, 2);
  entered(add({ name: "Valley Print Group", stage_id: stage("Lost"), what_it_does: "Commercial printing for schools and hospitals", source: "Broker newsletter", broker_name: "Murphy, Luis Ortega", primary_contact_id: c.ortega, organization_id: org.murphy, location: "Roanoke, VA", industry: "Commercial printing", key_finding: "Seller took a higher offer from a strategic buyer" }, { revenue: 4_800_000, ebitda: 1_200_000, asking: 4_000_000 }), 9, [{ stageName: "Interested", daysAgo: 35 }, { stageName: "NDA signed", daysAgo: 33 }, { stageName: "Broker call", daysAgo: 30 }, { stageName: "CIM review", daysAgo: 26 }, { stageName: "Seller call", daysAgo: 20 }]);

  // Dalton Services: the timeline of the mockup (an email received, a call, an email sent) and two documents.
  const communications: R[] = [
    { id: newId(), occurred_at: `${today}T13:05:00Z`, method: "email", direction: "incoming", contact_id: c.kim, organization_id: org.transworld, subject: "CIM received from Rachel Kim", summary: "Attached: Dalton_CIM.pdf, 3 years P&L.", is_outreach: false, purpose: "general", pipeline_item_id: dalton },
    { id: newId(), occurred_at: `${ago(3)}T15:30:00Z`, method: "call", direction: "outgoing", contact_id: c.kim, organization_id: org.transworld, subject: "Call with Rachel Kim, 20 min", summary: "Owner is 58, retiring. 11 technicians. Wants to close by Q2.", is_outreach: false, purpose: "general", pipeline_item_id: dalton },
    { id: newId(), occurred_at: `${ago(6)}T14:10:00Z`, method: "email", direction: "outgoing", contact_id: c.kim, organization_id: org.transworld, subject: "Asked for a call", summary: "When can we talk?", is_outreach: true, purpose: "deal_sourcing", pipeline_item_id: dalton },
    { id: newId(), occurred_at: `${ago(11)}T16:00:00Z`, method: "call", direction: "outgoing", contact_id: c.reed, organization_id: org.transworld, subject: "Broker call with Mark Reed, 25 min", summary: "Walked through the shipper mix. He will ask the owner about a call.", is_outreach: false, purpose: "general", pipeline_item_id: summit },
  ];
  const notes: R[] = [
    { id: newId(), record_type: "pipeline_items", record_id: dalton, body: "Broker call done; she will ask the owner about a call next week." },
    { id: newId(), record_type: "pipeline_items", record_id: meridian, body: "Model draft: 3x TTM works only if the top customer stays. Ask for the customer list by revenue." },
  ];
  const documents: WorkSample["documents"] = [
    { itemId: dalton, fileName: "Dalton_CIM.pdf", kind: "cim", mimeType: "application/pdf", text: "Sample CIM: Dalton Services. Commercial HVAC service and maintenance contracts, Chattanooga, TN. Revenue $5.6M, EBITDA $1.7M. This is sample data." },
    { itemId: dalton, fileName: "Dalton_PL_2023_2025.csv", kind: "statement", mimeType: "text/csv", text: "Year,Revenue,EBITDA\n2023,4800000,1350000\n2024,5200000,1520000\n2025,5600000,1700000\n" },
  ];

  return { organizations, contacts, items, financials, communications, notes, stageDates, documents };
}
