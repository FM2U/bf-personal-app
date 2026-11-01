/**
 * The Work module's sample data (database updates 0020 and 0021), added by "Load sample data": the listings and deals
 * of the approved mockup (2026-10-30), with their brokers, numbers, waits, key findings, and on Dalton Services a few
 * timeline entries and two documents. Since Edit batch A (2026-10-31): one listing with a placeholder name
 * ("00 Medicaid Transport Provider", no company name yet), one deal with both names (listed as "00 Fleet Repair
 * Shop, Jacksonville", company Coastal Fleet Maintenance), open questions in three groups on three deals, and Also to
 * do items on two. Batch B (2026-10-31, update 0022): the four brokers and twelve more people on Outreach with roles,
 * purposes, next follow-ups, and notes across every section, calls and emails on their timelines, three incoming
 * replies not yet logged (two on Mark Reed), tasks on two people, and five personal to-dos. Batch B2 (database
 * update 0023): nine Rosara projects (plus one closed) with milestones, next actions, tasks, notes, and two
 * findings; five job opportunities across the stages plus three closed; four consulting items plus two closed. Pure:
 * dates are relative to `today`; tested in src/lib/work/sample.test.ts.
 * Unlike the rest of the sample data these names come from the approved mockup and do not start with "Sample";
 * every row is still recorded in sample_records, so Remove sample data deletes them (the to-dos go with their deal).
 */
import { addDaysISO, isWeekday } from "@/lib/calc/dates";
import { reportInnerHtml, reportSubject, type ReportData } from "@/lib/accountability/report-email";
import { checkBuyBox, dealSourceTypeFor } from "@/lib/work/buy-box";
import { weekdayShort } from "@/lib/work/outreach";
import { STAGE_DEFAULTS } from "@/lib/work/stages";

export type WorkSampleSetup = {
  pipelineId: string;
  stages: Record<string, string>;
  /** Database update 0022 is applied: the Outreach people, their calls, emails, and replies, tasks on people, and the personal to-dos. */
  batchB?: boolean;
  /** Database update 0023 is applied: the projects, opportunities, and consulting items of batch B2 (with the Job search and Consulting pipelines by stage name). */
  batchB2?: boolean;
  jobs?: { pipelineId: string; stages: Record<string, string> } | null;
  consulting?: { pipelineId: string; stages: Record<string, string> } | null;
  /** Database update 0025 is applied: the partner Jake Morgan, the work events, and the End of day rows with three sent reports (batch C). */
  batchC?: boolean;
};

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
  /** The Tasks items (deal_todos, database update 0021), inserted after the deals; batch B adds tasks on people (record_type contacts). */
  todos: { id: string; deal_id?: string; record_type?: string; record_id?: string; text: string; position: number }[];
  /** The personal To-dos (table todos, database update 0022): two due today, two in the next 7 days, one later. */
  personalTodos: R[];
  /** The Rosara projects (batch B2). */
  projects: R[];
  /** Note dates to set after the insert (the insert stamps "now"): note id to days ago. */
  noteDates: { noteId: string; daysAgo: number }[];
  /** Items that start without a next action (the stage trigger fills the default on insert; these are cleared after it). */
  noActionItems: string[];
  /** The scope and start date of the consulting items (consulting_details). */
  consultingDetails: R[];
  /** Batch C: the partner the End of day reports go to (Jake Morgan). */
  partners: R[];
  /** Batch C: the two sent reports as partner reports (one reviewed with a reply, one not opened). */
  partnerReports: R[];
  /** Batch C: the End of day rows (two sent, one skipped on the last weekday before today). */
  endOfDay: R[];
  /** Batch C: follow-ups and next actions done, the Rosara focus done, over the last weeks. */
  workEvents: R[];
};

/** Every sample name the Work module adds (listings, deals, brokers, firms), so tests can tell them apart. */
export const WORK_SAMPLE_NAMES = [
  "Apex Precision Machining", "Sunny Smiles Franchise, 3 units", "Harbor Point Boat Storage", "Northstar Managed IT", "Cascade Outdoor Retail",
  "00 Medicaid Transport Provider", "00 Fleet Repair Shop, Jacksonville", "Titan Steel Fabrication", "Hilltop Pest Solutions", "BrightPath Home Care", "Oakline Dental Lab",
  "Summit Logistics Group", "Dalton Services", "Coastal Fleet Maintenance", "Meridian Industrial Coatings", "Ridgeline Commercial Roofing",
  "Pinecrest Landscaping", "Lakeside Car Wash, 2 sites", "Great Plains Grain Hauling", "QuickFit Gym Franchise", "Valley Print Group",
  "Transworld Business Advisors", "Sunbelt Business Brokers", "Murphy Business", "Rachel Kim", "Mark Reed", "Dana Whitfield", "Luis Ortega",
  // Outreach (batch B): the people of the approved mockup and their organizations.
  "Priya Natarajan", "Carla Jenkins", "Tom Alvarez", "Denise Walker", "Lena Fischer", "Greg Thornton", "Maria Santos", "Jamal Whitaker",
  "Rita Caldwell", "Kevin O'Brien", "Sam Patel", "Nina Reyes",
  "Truist", "Southern Staffing Group", "Alvarez Advisory", "Sunrise Home Care", "Sullivan Wickley", "Atlanta Ventures", "Bain, Atlanta",
  "GA Home Care Association", "Pathway Search Partners", "Peachtree Logistics", "Korn Ferry, Atlanta",
  // Batch B2: the projects, the opportunities, and the consulting items of the approved mockup.
  "Rosara platform", "KarmaKare (working name)", "Business model", "Market research", "Competition", "Customer segments", "Dementia caregiving", "Adjacent business ideas", "Resource sourcing", "Website first draft",
  "Harbor Health Partners", "Lumen Industrial Holdings", "Crestline Services", "Atlas Freight", "Riverbend Health", "Georgia Home Care Association", "Sunrise Home Care", "Bain, Atlanta", "Alvarez Advisory",
  // Batch C: the accountability partner of the approved mockup.
  "Jake Morgan",
];

/** The nine starting projects (approved 2026-10-31, decisions on v4), in the order of the Rosara page. */
export const SAMPLE_PROJECT_NAMES = ["Rosara platform", "KarmaKare (working name)", "Business model", "Market research", "Competition", "Customer segments", "Dementia caregiving", "Adjacent business ideas", "Resource sourcing"] as const;

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
  const broker = (id: string, name: string, orgId: string, email: string, more: R = {}) => ({ id, name, roles: ["broker"], organization_id: orgId, email, relationship_group: "professional", is_deal_source: true, title: "Business broker", ...(s.batchB ? { outreach_role: "broker", purposes: ["off_market_deals"], ...more } : {}) });
  const contacts: R[] = [
    broker(c.kim, "Rachel Kim", org.transworld, "rachel.kim@example.com", { title: "Chattanooga", follow_up_date: ahead(10), follow_up_note: "Ask what else she has in building services", notes: "Sends the best-prepared CIMs; answers email within a day", linkedin_url: "linkedin.com/in/rachelkim-example", phone: "(423) 555-0118" }),
    broker(c.reed, "Mark Reed", org.transworld, "mark.reed@example.com", { title: "East Tennessee", follow_up_date: ago(2), follow_up_note: "Ask for the two owner names and the Summit seller call date", notes: "Asked him for off-market HVAC owners; he also owes the Summit seller call date\nPrefers a call over email; answers the phone before 9.", linkedin_url: "linkedin.com/in/markreed-example", phone: "(865) 555-0142" }),
    broker(c.whitfield, "Dana Whitfield", org.sunbelt, "dana.whitfield@example.com", { title: "Atlanta", follow_up_date: ahead(6), follow_up_note: "Coffee; ask who is thinking about selling before spring", notes: "Coffee every six weeks; she sees landscaping and roofing owners first", linkedin_url: "linkedin.com/in/danawhitfield-example", phone: "(404) 555-0177" }),
    broker(c.ortega, "Luis Ortega", org.murphy, "luis.ortega@example.com", { title: "Birmingham", follow_up_date: ahead(6), follow_up_note: "Ask about the dental lab owner's other business", notes: "Ask about the dental lab owner's other business", phone: "(205) 555-0133" }),
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
  // A listing whose company is not named yet: the placeholder name, no company name.
  listing({ name: "00 Medicaid Transport Provider", company_name: null, what_it_does: "Non-emergency medical transport under Medicaid contracts", source: "Network", broker_name: "Intro from J. Alvarez", location: "Lexington, KY", industry: "Medical transport" }, { revenue: 5_000_000, ebitda: 1_100_000, asking: null });
  listing({ name: "Titan Steel Fabrication", what_it_does: "Structural steel for commercial builders", source: "Broker newsletter", broker_name: "Sunbelt", location: "Charlotte, NC", industry: "Steel fabrication" }, { revenue: 22_000_000, ebitda: 4_300_000, asking: 19_000_000 });

  // Nine deals across the stages. Next actions that equal the stage default make Done ask about the next stage.
  const d = (name: string) => STAGE_DEFAULTS[name as keyof typeof STAGE_DEFAULTS].title;
  const stageDates: WorkSample["stageDates"] = [];
  const entered = (itemId: string, enteredDaysAgo: number, history: { stageName: string; daysAgo: number }[] = []) => stageDates.push({ itemId, enteredDaysAgo, history });

  const hilltop = add({ name: "Hilltop Pest Solutions", stage_id: stage("Interested"), what_it_does: "Residential and commercial pest control, 2,400 recurring accounts", source: "Broker newsletter", broker_name: "Transworld, Rachel Kim", primary_contact_id: c.kim, organization_id: org.transworld, location: "Athens, GA", industry: "Pest control", next_action: d("Interested"), next_action_due: today, next_action_minutes: 15 }, { revenue: 3_400_000, sde: 1_000_000, asking: 3_600_000 });
  entered(hilltop, 0);
  const brightpath = add({ name: "BrightPath Home Care", stage_id: stage("NDA signed"), what_it_does: "Non-medical home care, 85 clients, private pay and LTC insurance", source: "Broker newsletter", broker_name: "Transworld, Rachel Kim", primary_contact_id: c.kim, organization_id: org.transworld, location: "Nashville, TN", industry: "Home care", next_action: d("NDA signed"), next_action_due: today, next_action_minutes: 10, key_finding: "Caregiver retention is the question", waiting_on: "The CIM and a call", waiting_since: ago(3),
    open_questions_json: { seller: ["What is caregiver turnover over the last 12 months?", "How many clients are private pay versus LTC insurance?"], broker: ["When does the CIM arrive, and is a seller call possible next week?"], self: ["What do the two largest home care agencies in Nashville pay caregivers?"] } }, { revenue: 4_200_000, ebitda: 1_300_000, asking: 4_900_000 });
  entered(brightpath, 3, [{ stageName: "Interested", daysAgo: 5 }]);
  const oakline = add({ name: "Oakline Dental Lab", stage_id: stage("NDA signed"), what_it_does: "Crowns and implants for 140 dental practices", source: "Broker newsletter", broker_name: "Murphy, Luis Ortega", primary_contact_id: c.ortega, organization_id: org.murphy, location: "Birmingham, AL", industry: "Dental lab", next_action: "Wait for the CIM", next_action_due: ahead(2), key_finding: "Owner is the lead technician", waiting_on: "The CIM", waiting_since: ago(2) }, { revenue: 5_100_000, ebitda: 1_600_000, asking: 6_200_000 });
  entered(oakline, 2, [{ stageName: "Interested", daysAgo: 6 }]);
  const summit = add({ name: "Summit Logistics Group", stage_id: stage("CIM review"), what_it_does: "Regional LTL freight brokerage, 300 shipper accounts", source: "Broker outreach", broker_name: "Transworld, Mark Reed", primary_contact_id: c.reed, organization_id: org.transworld, location: "Knoxville, TN", industry: "Freight brokerage", next_action: "Seller call to be scheduled", next_action_due: ahead(5), key_finding: "Margins thin; growth came from one shipper", waiting_on: "A seller call to be scheduled", waiting_since: ago(11) }, { revenue: 18_000_000, ebitda: 2_200_000, asking: 9_500_000 });
  entered(summit, 11, [{ stageName: "Interested", daysAgo: 18 }, { stageName: "NDA signed", daysAgo: 15 }]);
  const dalton = add({ name: "Dalton Services", stage_id: stage("Broker call"), what_it_does: "Commercial HVAC service and maintenance contracts", source: "Broker newsletter", broker_name: "Rachel Kim, Transworld", primary_contact_id: c.kim, organization_id: org.transworld, location: "Chattanooga, TN", industry: "Home and building services", why_selling: "Retiring, no successor", listing_url: "https://www.example.com/listings/dalton-services", next_action: "Review the CIM and write the key finding", next_action_due: today, next_action_minutes: 60, key_finding: "70% of revenue is recurring maintenance contracts; service calls are the rest",
    open_questions_json: {
      seller: ["Why sell now at 58, and would you stay 12 months after close?", "Can the service side (the other 30%) grow without adding technicians?", "How many of the 11 technicians have been with you over 3 years?", "Is any customer over 10% of revenue?"],
      broker: ["Can we get 3 years of tax returns and the monthly P&L?", "Is the $6.0M asking firm, and is a seller note on the table?", "Are there other bidders or a deadline for offers?"],
      self: ["How fast is commercial HVAC service growing in Chattanooga?", "What does a service call earn versus a maintenance visit?", "Who are the two or three local competitors, and do they sell maintenance contracts?"],
    } }, { revenue: 5_600_000, ebitda: 1_700_000, asking: 6_000_000 });
  entered(dalton, 3, [{ stageName: "Interested", daysAgo: 8 }, { stageName: "NDA signed", daysAgo: 7 }, { stageName: "CIM review", daysAgo: 4 }]);
  // A deal with both names: listed as a placeholder, the company named after the NDA.
  const coastal = add({ name: "00 Fleet Repair Shop, Jacksonville", company_name: "Coastal Fleet Maintenance", stage_id: stage("Seller call"), what_it_does: "Fleet repair for delivery and utility companies", source: "Broker newsletter", broker_name: "Sunbelt, Dana Whitfield", primary_contact_id: c.whitfield, organization_id: org.sunbelt, location: "Jacksonville, FL", industry: "Fleet services", next_action: d("Seller call"), next_action_due: today, next_action_minutes: 45, key_finding: "Seller wants to stay 12 months; good sign",
    open_questions_json: { seller: ["Which three fleet customers are the largest, and how long have they been with you?", "What share of repairs is warranty or contract work?"], broker: ["Can we get the fixed asset list with ages?"], self: [] } }, { revenue: 6_800_000, ebitda: 1_500_000, asking: 5_800_000 });
  entered(coastal, 2, [{ stageName: "Interested", daysAgo: 14 }, { stageName: "NDA signed", daysAgo: 12 }, { stageName: "CIM review", daysAgo: 9 }, { stageName: "Broker call", daysAgo: 7 }]);
  const meridian = add({ name: "Meridian Industrial Coatings", stage_id: stage("Model"), what_it_does: "Powder coating for OEM equipment makers", source: "Broker outreach", broker_name: "Benchmark", location: "Greenville, SC", industry: "Industrial coatings", next_action: "Finish the 7-year model, scenario at 3x TTM", next_action_due: ago(1), next_action_minutes: 120, key_finding: "TTM up 18%; check if one customer drove it" }, { revenue: 11_000_000, ebitda: 2_400_000, asking: 8_400_000 });
  entered(meridian, 4, [{ stageName: "Interested", daysAgo: 24 }, { stageName: "NDA signed", daysAgo: 22 }, { stageName: "CIM review", daysAgo: 18 }, { stageName: "Broker call", daysAgo: 15 }, { stageName: "Seller call", daysAgo: 9 }]);
  const ridgeline = add({ name: "Ridgeline Commercial Roofing", stage_id: stage("Partner presentation"), what_it_does: "Commercial roofing repair and maintenance for property managers", source: "Broker newsletter", broker_name: "Sunbelt, Dana Whitfield", primary_contact_id: c.whitfield, organization_id: org.sunbelt, location: "Charleston, SC", industry: "Roofing services", next_action: d("Partner presentation"), next_action_due: ahead(4), next_action_minutes: 90, key_finding: "Backlog covers 7 months" }, { revenue: 9_200_000, ebitda: 2_100_000, asking: 7_900_000 });
  entered(ridgeline, 1, [{ stageName: "Interested", daysAgo: 30 }, { stageName: "NDA signed", daysAgo: 28 }, { stageName: "CIM review", daysAgo: 25 }, { stageName: "Broker call", daysAgo: 21 }, { stageName: "Seller call", daysAgo: 16 }, { stageName: "Model", daysAgo: 10 }]);
  const pinecrest = add({ name: "Pinecrest Landscaping", stage_id: stage("IOI or LOI"), what_it_does: "Commercial grounds maintenance, 200 HOA and office contracts", source: "Broker newsletter", broker_name: "Sunbelt, Dana Whitfield", primary_contact_id: c.whitfield, organization_id: org.sunbelt, location: "Atlanta, GA", industry: "Grounds maintenance", next_action: "Response to the LOI", next_action_due: ahead(3), key_finding: "LOI at 3.2x TTM, seller note 15%", waiting_on: "Response to the LOI", waiting_since: ago(6) }, { revenue: 7_600_000, ebitda: 1_900_000, asking: 6_100_000 });
  entered(pinecrest, 6, [{ stageName: "Interested", daysAgo: 40 }, { stageName: "NDA signed", daysAgo: 38 }, { stageName: "CIM review", daysAgo: 35 }, { stageName: "Broker call", daysAgo: 31 }, { stageName: "Seller call", daysAgo: 26 }, { stageName: "Model", daysAgo: 20 }, { stageName: "Partner presentation", daysAgo: 12 }]);

  // Passed (kept so they are never screened twice) and one lost.
  const passed = (row: R, money: Parameters<typeof add>[1], daysAgo: number) => entered(add({ ...row, stage_id: stage("Passed") }, money), daysAgo);
  passed({ name: "Lakeside Car Wash, 2 sites", what_it_does: "Two express car wash sites", source: "Broker newsletter", broker_name: "BizBuySell", location: "Macon, GA", industry: "Retail services", pass_reason: "retail_dtc" }, { revenue: 2_100_000, sde: 640_000, asking: 2_900_000 }, 1);
  passed({ name: "Great Plains Grain Hauling", what_it_does: "Grain trucking for farm cooperatives", source: "Broker newsletter", broker_name: "Sunbelt", location: "Sioux Falls, SD", industry: "Trucking", pass_reason: "location" }, { revenue: 6_900_000, ebitda: 1_300_000, asking: 5_200_000 }, 1);
  passed({ name: "QuickFit Gym Franchise", what_it_does: "One franchise gym location", source: "Broker newsletter", broker_name: "BizBuySell", location: "Tampa, FL", industry: "Fitness", pass_reason: "franchise" }, { revenue: 1_400_000, sde: 290_000, asking: 950_000 }, 2);
  entered(add({ name: "Valley Print Group", stage_id: stage("Lost"), what_it_does: "Commercial printing for schools and hospitals", source: "Broker newsletter", broker_name: "Murphy, Luis Ortega", primary_contact_id: c.ortega, organization_id: org.murphy, location: "Roanoke, VA", industry: "Commercial printing", key_finding: "Seller took a higher offer from a strategic buyer" }, { revenue: 4_800_000, ebitda: 1_200_000, asking: 4_000_000 }), 9, [{ stageName: "Interested", daysAgo: 35 }, { stageName: "NDA signed", daysAgo: 33 }, { stageName: "CIM review", daysAgo: 30 }, { stageName: "Broker call", daysAgo: 26 }, { stageName: "Seller call", daysAgo: 20 }]);

  // Dalton Services: the timeline of the mockup (an email received, a call, an email sent) and two documents.
  const communications: R[] = [
    { id: newId(), occurred_at: `${today}T13:05:00Z`, method: "email", direction: "incoming", contact_id: c.kim, organization_id: org.transworld, subject: "CIM received from Rachel Kim", summary: "Attached: Dalton_CIM.pdf, 3 years P&L.", is_outreach: false, purpose: "general", pipeline_item_id: dalton },
    { id: newId(), occurred_at: `${ago(3)}T15:30:00Z`, method: "call", direction: "outgoing", contact_id: c.kim, organization_id: org.transworld, subject: "Call with Rachel Kim, 20 min", summary: "Owner is 58, retiring. 11 technicians. Wants to close by Q2.", is_outreach: false, purpose: "general", pipeline_item_id: dalton, ...(s.batchB ? { call_minutes: 20 } : {}) },
    { id: newId(), occurred_at: `${ago(6)}T14:10:00Z`, method: "email", direction: "outgoing", contact_id: c.kim, organization_id: org.transworld, subject: "Asked for a call", summary: "When can we talk?", is_outreach: true, purpose: "deal_sourcing", pipeline_item_id: dalton },
    { id: newId(), occurred_at: `${ago(11)}T16:00:00Z`, method: "call", direction: "outgoing", contact_id: c.reed, organization_id: org.transworld, subject: "Broker call with Mark Reed, 25 min", summary: "Walked through the shipper mix. He will ask the owner about a call.", is_outreach: false, purpose: "general", pipeline_item_id: summit, ...(s.batchB ? { call_minutes: 25 } : {}) },
  ];
  const notes: R[] = [
    { id: newId(), record_type: "pipeline_items", record_id: dalton, body: "Broker call done; she will ask the owner about a call next week." },
    { id: newId(), record_type: "pipeline_items", record_id: meridian, body: "Model draft: 3x TTM works only if the top customer stays. Ask for the customer list by revenue." },
  ];
  const documents: WorkSample["documents"] = [
    { itemId: dalton, fileName: "Dalton_CIM.pdf", kind: "cim", mimeType: "application/pdf", text: "Sample CIM: Dalton Services. Commercial HVAC service and maintenance contracts, Chattanooga, TN. Revenue $5.6M, EBITDA $1.7M. This is sample data." },
    { itemId: dalton, fileName: "Dalton_PL_2023_2025.csv", kind: "statement", mimeType: "text/csv", text: "Year,Revenue,EBITDA\n2023,4800000,1350000\n2024,5200000,1520000\n2025,5600000,1700000\n" },
  ];

  // Also to do (database update 0021): other things to do on a deal, outside its one next action.
  const todos: WorkSample["todos"] = [
    { id: newId(), deal_id: dalton, text: "Ask Rachel for the customer list by revenue", position: 1 },
    { id: newId(), deal_id: dalton, text: "Read the maintenance contract template in the CIM", position: 2 },
    { id: newId(), deal_id: dalton, text: "Compare the asking multiple with the two HVAC deals passed on", position: 3 },
    { id: newId(), deal_id: meridian, text: "Ask for the top 10 customers by year", position: 1 },
    { id: newId(), deal_id: meridian, text: "Book 30 minutes with the partner before the model is final", position: 2 },
  ];

  // ---------- Outreach (batch B, database update 0022): the people of the approved mockup ----------
  const personalTodos: R[] = [];
  const projects: R[] = [];
  const consultingDetails: R[] = [];
  const noteDates: WorkSample["noteDates"] = [];
  const noActionItems: string[] = [];
  if (s.batchB) {
    const o = { truist: newId(), ssg: newId(), alvarez: newId(), sunrise: newId(), sw: newId(), av: newId(), bain: newId(), gahca: newId(), pathway: newId(), peachtree: newId(), kf: newId() };
    organizations.push(
      { id: o.truist, name: "Truist", kind: "lender" },
      { id: o.ssg, name: "Southern Staffing Group", kind: "business" },
      { id: o.alvarez, name: "Alvarez Advisory", kind: "broker" },
      { id: o.sunrise, name: "Sunrise Home Care", kind: "business" },
      { id: o.sw, name: "Sullivan Wickley", kind: "business" },
      { id: o.av, name: "Atlanta Ventures", kind: "investor" },
      { id: o.bain, name: "Bain, Atlanta", kind: "business" },
      { id: o.gahca, name: "GA Home Care Association", kind: "nonprofit" },
      { id: o.pathway, name: "Pathway Search Partners", kind: "other" },
      { id: o.peachtree, name: "Peachtree Logistics", kind: "business" },
      { id: o.kf, name: "Korn Ferry, Atlanta", kind: "other" },
    );
    const person = (name: string, orgId: string | null, role: string, title: string | null, purposes: string[], followUp: string | null, what: string | null, note: string, email: string, more: R = {}) => {
      const id = newId();
      contacts.push({ id, name, roles: ["other"], organization_id: orgId, email, relationship_group: "professional", title, outreach_role: role, purposes, follow_up_date: followUp, follow_up_note: what, notes: note, ...more });
      return id;
    };
    const p = {
      priya: person("Priya Natarajan", o.truist, "lender", "SBA, Atlanta", ["off_market_deals"], ago(3), "Ask which owners asked about exit loans this month", "Sends me owners who ask her about exit loans", "priya.natarajan@example.com", { phone: "(404) 555-0151" }),
      carla: person("Carla Jenkins", o.ssg, "former_colleague", "COO", ["job_search"], today, "Ask for the hiring manager's name at the portfolio company", "She mentioned a VP ops opening at a portfolio company", "carla.jenkins@example.com", { linkedin_url: "linkedin.com/in/carlajenkins-example" }),
      tom: person("Tom Alvarez", o.alvarez, "broker", "Nashville", ["off_market_deals"], today, "Ask for the two owners thinking about selling in 2027", "Promised two owners who are thinking about selling in 2027", "tom.alvarez@example.com", { is_deal_source: true, phone: "(615) 555-0109" }),
      denise: person("Denise Walker", o.sunrise, "rosara_customer", "Owner", ["off_market_deals", "rosara"], today, "Ask for the Macon and Augusta owners; show the care-plan screens", "Knows two agency owners near retirement in Macon and Augusta; tests the care-plan screens", "denise.walker@example.com", { phone: "(478) 555-0162" }),
      lena: person("Lena Fischer", null, "cofounder_candidate", "Engineer, 8 years in caregiving software", ["rosara"], ahead(3), "Send the equity split in writing", "Co-founder candidate at the Offer step; she wants the equity split in writing", "lena.fischer@example.com", { linkedin_url: "linkedin.com/in/lenafischer-example" }),
      greg: person("Greg Thornton", o.sw, "other", "Partner, consulting client", ["consulting"], ahead(4), "Send the scope and fee for the Q1 site selection work", "Wants a scope and fee for the Q1 site selection work", "greg.thornton@example.com", { is_consulting_lead: true }),
      maria: person("Maria Santos", o.av, "investor", null, ["rosara"], ahead(5), "Send the deck and three customer references", "Asked for the deck and three customer references after our call", "maria.santos@example.com", {}),
      jamal: person("Jamal Whitaker", o.bain, "former_colleague", null, ["job_search"], ahead(5), "Thank him and ask for a call with his partner", "Introduced me to his partner who covers industrials", "jamal.whitaker@example.com", { linkedin_url: "linkedin.com/in/jamalwhitaker-example" }),
      rita: person("Rita Caldwell", o.gahca, "other", "Director, consulting client", ["consulting"], ahead(13), "Ask whether the member survey project is funded for Q1", "Member survey project could use a consultant in Q1", "rita.caldwell@example.com", { is_consulting_lead: true }),
      kevin: person("Kevin O'Brien", o.pathway, "recruiter", "Former boss", ["job_search"], ahead(14), "Monthly check-in", "Offered to be a reference; check in monthly", "kevin.obrien@example.com", {}),
      sam: person("Sam Patel", o.peachtree, "former_colleague", "CFO", ["off_market_deals"], null, null, "Hears about carriers selling before the brokers do", "sam.patel@example.com", {}),
      nina: person("Nina Reyes", o.kf, "recruiter", null, ["job_search"], null, null, "Sent my resume for a COO search; also runs the Harbor Health search", "nina.reyes@example.com", {}),
    };
    // Calls and emails on the timelines (the person's last contact comes from the newest of these).
    const comm = (contactId: string, orgId: string | null, daysAgo: number, hour: number, method: string, direction: string, subject: string, summary: string, more: R = {}) =>
      communications.push({ id: newId(), occurred_at: `${ago(daysAgo)}T${String(hour).padStart(2, "0")}:00:00Z`, method, direction, contact_id: contactId, organization_id: orgId, subject, summary, is_outreach: direction !== "incoming", purpose: "general", ...more });
    comm(c.reed, org.transworld, 11, 15, "email", "outgoing", "Off-market HVAC owners in East Tennessee", "Asked for owners who might sell in the next year.");
    comm(c.reed, org.transworld, 12, 16, "call", "outgoing", "Call with Mark Reed", "Summit owner wants a call after his trip; Mark will send two HVAC owner names.", { call_minutes: 15 });
    comm(c.reed, org.transworld, 39, 14, "meeting", "outgoing", "Coffee in Knoxville", "Asked for my buy box on one page. Sees 3 to 4 service businesses a month.", { call_minutes: 45 });
    comm(c.reed, org.transworld, 51, 13, "email", "outgoing", "Intro from Dana Whitfield", "Dana introduced us; asked for 20 minutes.");
    // Two incoming replies not yet on the timeline (Log it on the person page).
    comm(c.reed, org.transworld, 1, 14, "email", "incoming", "Re: East Tennessee owners", "Two names for you, call me Monday.", { is_outreach: false, awaiting_log: true });
    comm(c.reed, org.transworld, 3, 10, "email", "incoming", "Re: Summit Logistics, seller call", "Owner is traveling until the 3rd.", { is_outreach: false, awaiting_log: true });
    comm(p.tom, o.alvarez, 1, 15, "email", "incoming", "Re: owners selling in 2027", "One of the two is ready to talk; the other wants to wait until spring.", { is_outreach: false, awaiting_log: true });
    comm(p.priya, o.truist, 14, 15, "call", "outgoing", "Call with Priya Natarajan", "Two owners asked about exit loans; she will ask if they want an intro.", { call_minutes: 20 });
    comm(p.carla, o.ssg, 7, 17, "meeting", "outgoing", "Lunch with Carla Jenkins", "She mentioned a VP ops opening at a portfolio company; will ask the hiring manager.", { call_minutes: 60 });
    comm(p.tom, o.alvarez, 4, 11, "email", "outgoing", "Owners thinking about selling in 2027", "Asked for the two names he mentioned.");
    comm(p.denise, o.sunrise, 8, 16, "call", "outgoing", "Call with Denise Walker", "Walked through the care-plan screens; she knows two agency owners near retirement.", { call_minutes: 30 });
    comm(p.lena, null, 1, 18, "meeting", "outgoing", "Working session with Lena Fischer", "Scoped the caregiver hub; she asked for the equity split in writing.", { call_minutes: 90 });
    comm(p.greg, o.sw, 2, 14, "call", "outgoing", "Call with Greg Thornton", "Q1 site selection work; he wants a scope and fee by next week.", { call_minutes: 25, purpose: "consulting" });
    comm(p.maria, o.av, 3, 15, "call", "outgoing", "Call with Maria Santos", "Intro call; she asked for the deck and three customer references.", { call_minutes: 30 });
    comm(p.jamal, o.bain, 9, 13, "email", "outgoing", "Thanks for the intro", "Thanked him for the intro to his partner.");
    comm(p.rita, o.gahca, 10, 14, "email", "outgoing", "Member survey project", "Asked whether the survey project is funded for Q1.", { purpose: "consulting" });
    comm(p.kevin, o.pathway, 21, 12, "meeting", "outgoing", "Coffee with Kevin O'Brien", "He offered to be a reference.", { call_minutes: 45 });
    comm(p.sam, o.peachtree, 31, 16, "call", "outgoing", "Call with Sam Patel", "Hears about carriers selling before the brokers do.", { call_minutes: 20 });
    comm(p.nina, o.kf, 23, 11, "email", "outgoing", "COO search", "Sent my resume for the COO search.");
    comm(c.whitfield, org.sunbelt, 3, 15, "meeting", "outgoing", "Coffee with Dana Whitfield", "Landscaping and roofing owners; Pinecrest LOI timing.", { call_minutes: 40 });
    comm(c.ortega, org.murphy, 2, 10, "email", "outgoing", "Oakline CIM", "Asked when the CIM arrives.");
    notes.push({ id: newId(), record_type: "contacts", record_id: c.reed, body: "Prefers a call over email; answers the phone before 9." });
    notes.push({ id: newId(), record_type: "contacts", record_id: p.lena, body: "Wants a 50/50 split with a 4-year vest; open to a 1-year cliff." });
    // Tasks on two people (the Tasks card on the person page).
    todos.push({ id: newId(), record_type: "contacts", record_id: c.reed, text: "Send Mark my one-page buy box", position: 1 });
    todos.push({ id: newId(), record_type: "contacts", record_id: c.reed, text: "Ask Mark whether Summit's owner will take a call in November", position: 2 });
    todos.push({ id: newId(), record_type: "contacts", record_id: p.lena, text: "Draft the equity split memo", position: 1 });
    // Personal to-dos: Today (two, one without a date), Next 7 days (two), Later (one).
    personalTodos.push(
      { id: newId(), text: "Renew the Cyan Arc registered agent", due_on: today, position: 1 },
      { id: newId(), text: "Book the dentist", due_on: null, position: 2 },
      { id: newId(), text: "Send the TimeSlips treasurer report", due_on: ahead(5), position: 3 },
      { id: newId(), text: "Pick up the dry cleaning", due_on: ahead(4), position: 4 },
      { id: newId(), text: "Read the SBA 7(a) rule change", due_on: ahead(14), position: 5 },
    );

    // ---------- Batch B2 (database update 0023): Rosara projects, Job search, Consulting ----------
    if (s.batchB2) {
      // Nine open projects (one without a next action) and one closed.
      const project = (name: string, goal: string, milestone: string, next: { action: string; due: string; minutes?: number } | null, tasks: string[], position: number, closedDaysAgo: number | null = null) => {
        const id = newId();
        projects.push({ id, name, goal, milestone, status: closedDaysAgo === null ? "open" : "closed", closed_at: closedDaysAgo === null ? null : `${ago(closedDaysAgo)}T16:00:00Z`, next_action: next?.action ?? null, next_action_due: next?.due ?? null, next_action_minutes: next?.minutes ?? null, position });
        tasks.forEach((text, i) => todos.push({ id: newId(), record_type: "projects", record_id: id, text, position: i + 1 }));
        return id;
      };
      project("Rosara platform", "One connected platform: the agency hub, the caregiver hub, and the family hub together", "Agency hub onboarding flow", { action: "Write the intake screens spec", due: ahead(4), minutes: 90 }, ["Map the five onboarding steps", "List the fields the intake needs", "Draft the caregiver invite email", "Sketch the family hub home screen", "Decide the first integration (scheduling or billing)", "Write the data model for clients and visits"], 1);
      project("KarmaKare (working name)", "A standalone family caregiving app: a separate startup from the platform", "Family app prototype", { action: "Review the care-plan screens with Denise Walker", due: ahead(6) }, ["Finish the care-plan screen", "Write the three family test scripts", "Pick the working name or keep KarmaKare", "Price check: free, $9, or $19 a month"], 2);
      project("Business model", "Know the price and the plan an agency under 50 caregivers will pay for", "Pricing for agencies under 50 caregivers", { action: "Compare per-client and per-caregiver pricing", due: ahead(5) }, ["Build the two pricing sheets", "Ask three owners which they would pick", "Write the pricing page copy"], 3);
      const research = project("Market research", "Know what ten agency owners would pay for, and how much", "Ten agency owner conversations", { action: "Call Rita Caldwell about the member survey", due: today, minutes: 30 }, ["Summarize the three calls so far", "Ask Denise Walker for two more owner intros", "Draft the ten questions", "Book two calls for next week", "Write the findings note"], 4);
      project("Competition", "A clear view of the four platforms agencies already use and what they charge", "Feature and price table for the four platforms", null, ["Fill the table for the two biggest platforms", "Find the price pages of the other two"], 5);
      project("Customer segments", "Know how private-pay and Medicaid intake differ, and which to build first", "Private-pay versus Medicaid intake needs", { action: "Draft the two intake flows side by side", due: ahead(10) }, ["List the Medicaid intake documents", "List the private-pay intake documents", "Ask Denise which takes longer"], 6);
      project("Dementia caregiving", "Know who pays for dementia training and tools in home care", "Who pays for training and tools", { action: "Read the Georgia training rules", due: ahead(7) }, ["Read the Georgia training rules", "Ask TimeSlips which agencies buy training"], 7);
      project("Adjacent business ideas", "A shortlist of three ideas worth a week each, with a one-page note on each", "Shortlist of three ideas worth a week each", { action: "Write the one-page note on rural scheduling service", due: ahead(12) }, ["Write the rural scheduling note"], 8);
      project("Resource sourcing", "A co-founder and a first investor who both believe in the platform", "Co-founder and first investor conversations", { action: "Send the deck to Maria Santos", due: ahead(5) }, ["Finish the deck", "Write the equity split memo for Lena", "List five more investors to ask", "Ask Jamal who in his network invests in care"], 9);
      project("Website first draft", "A one-page site that says what Rosara is", "One page live", null, [], 10, 9);
      // Notes and findings on Market research (the project page of the mockup).
      const note = (projectId: string, daysAgo: number, body: string, finding = false, source: string | null = null) => {
        const id = newId();
        notes.push({ id, record_type: "projects", record_id: projectId, body, kind: finding ? "finding" : "note", source_url: source });
        noteDates.push({ noteId: id, daysAgo });
      };
      note(research, 1, "Rita said the association member survey could carry three of my questions in January.");
      note(research, 3, "Owners under 20 caregivers still schedule on paper or a spreadsheet\nThree of the three calls so far.", true, "https://www.example.com/ga-home-care-member-survey-2025");
      note(research, 8, "Scheduling changes and call-outs cost owners 8 to 10 hours a week\nDenise Walker's estimate for her own agency.", true, "https://www.example.com/call-with-denise-walker");
      note(research, 11, "Goal set: ten owner conversations by the end of next month. Three done so far.");

      // Five open opportunities across the stages, plus three closed. The company is the item name.
      if (s.jobs) {
        const js = s.jobs;
        const opp = (row: R, enteredDaysAgo: number, history: { stageName: string; daysAgo: number }[] = []) => {
          const id = newId();
          items.push({ id, pipeline_id: js.pipelineId, screened: true, ...row });
          entered(id, enteredDaysAgo, history);
          return id;
        };
        opp({ name: "Southern Staffing Group", stage_id: js.stages.Contact, role_title: "VP Operations", contact_name: "Carla Jenkins", primary_contact_id: p.carla, organization_id: o.ssg, location: "Atlanta, GA", what_it_does: "Staffing for light industrial employers", source: "A former colleague", next_action: "Ask Carla for the hiring manager's name", next_action_due: ahead(3), notes: "Portfolio company of a PE firm; open since September" }, 4);
        noActionItems.push(opp({ name: "Peachtree Logistics", stage_id: js.stages.Contact, role_title: "Chief of Staff", contact_name: "Sam Patel", primary_contact_id: p.sam, organization_id: o.peachtree, location: "Atlanta, GA", what_it_does: "Regional trucking and warehousing", source: "A former colleague", next_action: null, next_action_due: null, notes: "Sam mentioned it; nothing confirmed" }, 2));
        const harbor = opp({ name: "Harbor Health Partners", stage_id: js.stages.Conversation, role_title: "Director of Operations", contact_name: "Nina Reyes, Korn Ferry", primary_contact_id: p.nina, organization_id: o.kf, location: "Charlotte, NC, on site", what_it_does: "Multi-site home health", source: "Recruiter", pay_range: "$150K to $170K", listing_url: "https://www.example.com/harbor-health-partners", next_action: "Prepare for the call with the COO", next_action_due: today, next_action_minutes: 90, notes: "They want someone who has run scheduling across sites",
          open_questions_json: { seller: [], broker: [], self: ["How many sites and caregivers, and who runs scheduling today?", "Why is the role open, and how long has it been open?", "Pay range and whether the role could lead to COO."] } }, 4, [{ stageName: "Contact", daysAgo: 6 }]);
        opp({ name: "Lumen Industrial Holdings", stage_id: js.stages.Interview, role_title: "General Manager", contact_name: "Jamal Whitaker", primary_contact_id: p.jamal, organization_id: o.bain, location: "Atlanta, GA", what_it_does: "Holding company with four industrial businesses", source: "A former colleague", next_action: "Second interview with the partners", next_action_due: ahead(5), waiting_on: "Jamal Whitaker", waiting_since: ago(3), notes: "Holding company with four industrial businesses" }, 3, [{ stageName: "Contact", daysAgo: 20 }, { stageName: "Conversation", daysAgo: 12 }]);
        opp({ name: "Crestline Services", stage_id: js.stages.Offer, role_title: "COO", contact_name: "Kevin O'Brien", primary_contact_id: p.kevin, organization_id: o.pathway, location: "Birmingham, AL", what_it_does: "Commercial cleaning and facilities services", source: "Recruiter", pay_range: "$185K base", next_action: "Reply to the offer", next_action_due: ahead(7), notes: "$185K base; read the equity terms with a lawyer" }, 2, [{ stageName: "Contact", daysAgo: 30 }, { stageName: "Conversation", daysAgo: 24 }, { stageName: "Interview", daysAgo: 14 }]);
        opp({ name: "Atlas Freight", stage_id: js.stages.Declined, role_title: "VP Operations", contact_name: "A recruiter", location: "Memphis, TN", source: "Recruiter", notes: "Declined: the move to Memphis does not work" }, 6, [{ stageName: "Contact", daysAgo: 16 }, { stageName: "Conversation", daysAgo: 10 }]);
        opp({ name: "Riverbend Health", stage_id: js.stages["Not chosen"], role_title: "COO", contact_name: "Pathway Search Partners", location: "Nashville, TN", source: "Recruiter", notes: "They chose an internal candidate" }, 12, [{ stageName: "Contact", daysAgo: 40 }, { stageName: "Conversation", daysAgo: 32 }, { stageName: "Interview", daysAgo: 20 }]);
        opp({ name: "Valley Print Group", stage_id: js.stages.Declined, role_title: "General Manager", contact_name: "Luis Ortega", location: "Roanoke, VA", source: "A broker", notes: "Declined: the owner wanted a buyer, not a manager" }, 20, [{ stageName: "Contact", daysAgo: 26 }]);
        communications.push(
          { id: newId(), occurred_at: `${ago(2)}T14:00:00Z`, method: "email", direction: "incoming", contact_id: p.nina, organization_id: o.kf, subject: "Email received from Nina Reyes", summary: "COO call confirmed for Friday at 2:00; brief attached.", is_outreach: false, purpose: "general", pipeline_item_id: harbor },
          { id: newId(), occurred_at: `${ago(4)}T16:00:00Z`, method: "call", direction: "outgoing", contact_id: p.nina, organization_id: o.kf, subject: "Call with Nina Reyes", summary: "They want someone who has run scheduling across sites. Pay $150K to $170K.", is_outreach: true, purpose: "general", pipeline_item_id: harbor, call_minutes: 20 },
        );
      }

      // Four open consulting items (one per stage), plus two closed. The client is the item name, the project is what_it_does.
      if (s.consulting) {
        const cs = s.consulting;
        const con = (row: R, enteredDaysAgo: number, history: { stageName: string; daysAgo: number }[] = [], details: { scope: string; start: string | null } | null = null) => {
          const id = newId();
          items.push({ id, pipeline_id: cs.pipelineId, screened: true, ...row });
          entered(id, enteredDaysAgo, history);
          if (details) consultingDetails.push({ id: newId(), item_id: id, rate_type: "project", rate: row.fee ?? null, scope_notes: details.scope, start_date: details.start });
          return id;
        };
        con({ name: "Georgia Home Care Association", stage_id: cs.stages.Lead, what_it_does: "Member survey", contact_name: "Rita Caldwell", primary_contact_id: p.rita, organization_id: o.gahca, fee: 12000, next_action: "Call Rita about the scope", next_action_due: ahead(13), notes: "Would run January to March" }, 10, [], { scope: "Design and run the member survey; a findings memo for the board", start: ahead(66) });
        const sw = con({ name: "Sullivan Wickley", stage_id: cs.stages.Proposal, what_it_does: "Q1 site selection", contact_name: "Greg Thornton, Partner", primary_contact_id: p.greg, organization_id: o.sw, fee: 18000, next_action: "Send the scope and fee", next_action_due: ahead(4), notes: "Greg wants it before his partners meet Nov 10" }, 4, [{ stageName: "Lead", daysAgo: 9 }], { scope: "Market screen, site visits, and a comparison memo for three retail locations in Cobb County", start: ahead(67) });
        con({ name: "Sullivan Wickley", stage_id: cs.stages.Engagement, what_it_does: "Marietta lease review", contact_name: "Greg Thornton, Partner", primary_contact_id: p.greg, organization_id: o.sw, fee: 6000, next_action: "Deliver the comparison memo", next_action_due: ahead(7), notes: "Two of three leases read" }, 12, [{ stageName: "Lead", daysAgo: 30 }, { stageName: "Proposal", daysAgo: 22 }], { scope: "Read the three Marietta leases and write a comparison memo", start: ago(12) });
        con({ name: "Sunrise Home Care", stage_id: cs.stages.Paid, what_it_does: "Scheduling review", contact_name: "Denise Walker", primary_contact_id: p.denise, organization_id: o.sunrise, fee: 4500, next_action: "Send thanks and ask for a referral", next_action_due: ahead(3), notes: "Paid Oct 28; then mark Done" }, 3, [{ stageName: "Lead", daysAgo: 45 }, { stageName: "Proposal", daysAgo: 40 }, { stageName: "Engagement", daysAgo: 33 }], { scope: "Review the scheduling process and write five fixes", start: ago(33) });
        con({ name: "Bain, Atlanta", stage_id: cs.stages.Lost, what_it_does: "Ops diagnostic for a portfolio company", contact_name: "Jamal Whitaker", primary_contact_id: p.jamal, organization_id: o.bain, fee: 25000, notes: "They used their own team" }, 15, [{ stageName: "Lead", daysAgo: 35 }, { stageName: "Proposal", daysAgo: 25 }]);
        con({ name: "Alvarez Advisory", stage_id: cs.stages.Done, what_it_does: "Deal screen help", contact_name: "Tom Alvarez", primary_contact_id: p.tom, organization_id: o.alvarez, fee: 3000, notes: "Paid and wrapped up" }, 20, [{ stageName: "Lead", daysAgo: 60 }, { stageName: "Proposal", daysAgo: 55 }, { stageName: "Engagement", daysAgo: 48 }, { stageName: "Paid", daysAgo: 28 }]);
        communications.push(
          { id: newId(), occurred_at: `${ago(2)}T15:00:00Z`, method: "call", direction: "outgoing", contact_id: p.greg, organization_id: o.sw, subject: "Call with Greg Thornton", summary: "Wants the scope and fee before his partners meet Nov 10. Three sites, all in Cobb County.", is_outreach: true, purpose: "consulting", pipeline_item_id: sw, call_minutes: 20 },
          { id: newId(), occurred_at: `${ago(9)}T11:00:00Z`, method: "email", direction: "incoming", contact_id: p.greg, organization_id: o.sw, subject: "Email received from Greg Thornton", summary: "Could you look at Q1 site selection for the Cobb County expansion?", is_outreach: false, purpose: "consulting", pipeline_item_id: sw },
        );
      }
    }
  }

  // Batch C (database update 0025): the partner, three End of day rows (two sent, one skipped), and the work events.
  const partners: R[] = [];
  const partnerReports: R[] = [];
  const endOfDay: R[] = [];
  const workEvents: R[] = [];
  if (s.batchC) {
    const jake = newId();
    partners.push({ id: jake, name: "Jake Morgan", is_pseudonym: false, email: "jake.morgan@example.com", sections: ["commitments"], schedule: "weekly", delivery_methods: ["email"], report_frequency: "daily", next_report_on: ahead(7), is_active: true, notes: "Gets the End of day report by email, weekdays at 5:30." });
    // The last three weekdays before today (newest first).
    const weekdays: string[] = [];
    for (let i = 1; weekdays.length < 3 && i < 12; i++) if (isWeekday(ago(i))) weekdays.push(ago(i));
    const [d1, d2, d3] = weekdays;
    const c = buildSampleReports({ d2, d3, partnerFirst: "Jake" });
    // New York clock readings (Eastern Standard Time) as UTC timestamps.
    const at = (day: string, hour: number, minute: number) => new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-05:00`).toISOString();
    // d2: sent, reviewed, with a reply. d3: sent, not opened.
    const r2 = newId();
    const r3 = newId();
    partnerReports.push(
      { id: r2, partner_id: jake, period_start: d2, period_end: d2, status: "finalized", snapshot: { end_of_day: true, day: d2, sample: true }, summary: c.summary2, summary_source: "owner", finalized_at: at(d2, 17, 38), delivered_via: ["gmail_sent"], report_kind: "end_of_day", sent_at: at(d2, 17, 38), reviewed_at: at(d2, 19, 5), partner_comment: "Thanks. Is the Pinecrest LOI still at 3.2x? Let me know what Dana says.", comment_at: at(d2, 19, 5) },
      { id: r3, partner_id: jake, period_start: d3, period_end: d3, status: "finalized", snapshot: { end_of_day: true, day: d3, sample: true }, summary: c.summary3, summary_source: "owner", finalized_at: at(d3, 17, 35), delivered_via: ["gmail_sent"], report_kind: "end_of_day", sent_at: at(d3, 17, 35) },
    );
    const judgedSkipped = [
      { targetId: "sample-listings", name: "Listings screened", key: "listings_screened", cadence: "day", number: 5, commitment: true, value: 2, met: false, figure: "2 of 5", line: "Per weekday · target 5 · this week 12 of 20", detail: "2 passed", judged: true },
      { targetId: "sample-outreach", name: "Network outreach", key: "outreach_contacts", cadence: "week", number: 10, commitment: true, value: 4, met: false, figure: "4 of 10", line: "Per week · target 10", detail: "", judged: weekdayShort(d1) === "Fri" },
    ];
    endOfDay.push(
      { id: newId(), day: d1, status: "skipped", reasons: {}, skip_reason: "Travel day, Chattanooga site visit", skipped_at: at(d1, 17, 10), judged: judgedSkipped },
      { id: newId(), day: d2, status: "sent", reasons: { "sample-listings": "The Rosara investor call and the Sunbelt coffee took the morning; 3 listings carry to tomorrow." }, tomorrow_line: c.tomorrow2, sent_at: at(d2, 17, 38), report_id: r2, report_subject: c.subject2, report_html: c.html2, report_edited: true, judged: c.judged2 },
      { id: newId(), day: d3, status: "sent", reasons: {}, tomorrow_line: c.tomorrow3, sent_at: at(d3, 17, 35), report_id: r3, report_subject: c.subject3, report_html: c.html3, report_edited: false, judged: c.judged3 },
    );
    // Work events over the last eight weeks: follow-ups done (a few late), next actions done, the Rosara focus done most weeks.
    const ev = (kind: string, daysAgo: number, label: string, more: R = {}) => workEvents.push({ id: newId(), kind, record_type: more.record_type ?? null, record_id: null, label, happened_on: ago(daysAgo), happened_at: `${ago(daysAgo)}T15:00:00Z`, on_time: more.on_time ?? null, meta: more.meta ?? {} });
    const followUps: [number, string, boolean][] = [[1, "Priya Natarajan", true], [2, "Dana Whitfield", true], [3, "Mark Reed", false], [4, "Tom Alvarez", true], [8, "Carla Jenkins", true], [9, "Luis Ortega", true], [10, "Priya Natarajan", false], [15, "Denise Walker", true], [16, "Maria Santos", true], [17, "Rachel Kim", true], [22, "Mark Reed", false], [23, "Jamal Whitaker", true], [29, "Dana Whitfield", true], [30, "Kevin O'Brien", true], [36, "Rita Caldwell", true], [37, "Sam Patel", true], [43, "Priya Natarajan", true], [44, "Tom Alvarez", false], [50, "Lena Fischer", true]];
    for (const [days, name, onTime] of followUps) ev("follow_up_done", days, name, { record_type: "contacts", on_time: onTime });
    const actions: [number, string, string][] = [[1, "Meridian Industrial Coatings", "Start the 7-year model"], [1, "Market research", "Call two agency owners"], [2, "Dalton Services", "Ask the broker for the CIM"], [2, "Harbor Health Partners", "Prepare for the COO call"], [3, "BrightPath Home Care", "Sign the NDA"], [4, "Pinecrest Landscaping", "Submit the LOI"], [8, "Coastal Fleet Maintenance", "Ask for the seller call"], [9, "Summit Logistics Group", "Read the CIM"], [10, "Rosara platform", "Write the onboarding flow"], [15, "Oakline Dental Lab", "Sign the NDA"], [16, "Ridgeline Commercial Roofing", "Book the partner meeting"], [22, "Meridian Industrial Coatings", "Ask for tax returns"], [23, "Business model", "Draft the pricing page"], [29, "Pinecrest Landscaping", "Finish the model"], [36, "Dalton Services", "Sign the NDA"], [43, "Valley Print Group", "Seller call"]];
    for (const [days, name, action] of actions) ev("next_action_done", days, name, { record_type: "pipeline_items", meta: { action } });
    // The focus done on the Thursday of most past weeks (not this week, not three weeks ago).
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const monday = addDaysISO(today, -(dow === 0 ? 6 : dow - 1));
    for (const weeksBack of [1, 2, 4, 5, 6, 7]) {
      const thu = addDaysISO(monday, -7 * weeksBack + 3);
      workEvents.push({ id: newId(), kind: "focus_done", record_type: "inputs", record_id: null, label: "This week: ten agency owner conversations", happened_on: thu, happened_at: `${thu}T15:00:00Z`, on_time: null, meta: {} });
    }
  }

  return { organizations, contacts, items, financials, communications, notes, stageDates, documents, todos, personalTodos, projects, consultingDetails, noteDates, noActionItems, partners, partnerReports, endOfDay, workEvents };
}

/** The two sample sent reports (batch C): the email as sent, built the way End of day builds it, from fixed numbers. */
function buildSampleReports(i: { d2: string; d3: string; partnerFirst: string }) {
  const long = (d: string) => `${DAY_LONG[weekdayShort(d)]}, ${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
  const short = (d: string) => `${DAY_LONG[weekdayShort(d)]}, ${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
  const judged2 = [
    { targetId: "sample-listings", name: "Listings screened", key: "listings_screened", cadence: "day", number: 5, commitment: true, value: 2, met: false, figure: "2 of 5", line: "Per weekday · target 5 · this week 7 of 10", detail: "2 passed", judged: true },
    { targetId: "sample-brokers", name: "Brokers contacted", key: "brokers_contacted", cadence: "week", number: 5, commitment: false, value: 3, met: false, figure: "3 of 5", line: "Per week · target 5", detail: "Rachel Kim, Dana Whitfield, Luis Ortega", judged: false },
    { targetId: "sample-outreach", name: "Network outreach", key: "outreach_contacts", cadence: "week", number: 10, commitment: true, value: 3, met: false, figure: "3 of 10", line: "Per week · target 10", detail: "", judged: false },
  ];
  const judged3 = [{ targetId: "sample-listings", name: "Listings screened", key: "listings_screened", cadence: "day", number: 5, commitment: true, value: 5, met: true, figure: "5 of 5", line: "Per weekday · target 5 · this week 5 of 5", detail: "3 passed, 2 Interested", judged: true }];
  const tomorrow2 = "Screen the 5 listings first; Meridian seller call at 11.";
  const tomorrow3 = "Sunbelt coffee with Dana at 9; Maria Santos call at 1.";
  const data2: ReportData = {
    partnerName: "Jake Morgan", partnerFirst: i.partnerFirst, dateLong: long(i.d2), dateShort: short(i.d2), withWeek: false,
    pill: { text: "Listings screened missed", status: "missed" },
    today: [
      { label: "Listings screened", value: "2", small: "of 5", note: "2 passed", status: "missed", pct: 40 },
      { label: "Deals moved", value: "0", note: "", status: "neutral", pct: null },
      { label: "Next actions done", value: "4", note: "Dalton, Harbor Health and 2 more", status: "neutral", pct: null },
      { label: "Calls", value: "2", note: "Maria Santos, Dana Whitfield", status: "neutral", pct: null },
      { label: "Emails", value: "2", note: "", status: "neutral", pct: null },
      { label: "Network outreach", value: "1", note: "3 of 10 this week", status: "missed", pct: 30 },
    ],
    deals: ["Pinecrest Landscaping: Dana Whitfield expects the seller's answer on the LOI by Friday."],
    targets: [
      { met: false, judged: true, line: "Listings screened 2 of 5 today, 7 of 10 this week", commitment: true, reason: "The Rosara investor call and the Sunbelt coffee took the morning; 3 listings carry to tomorrow." },
      { met: false, judged: false, line: "Brokers contacted 3 of 5", commitment: false, reason: null },
      { met: false, judged: false, line: "Network outreach 3 of 10", commitment: true, reason: null },
    ],
    owed: [],
    week: null,
    tomorrow: { label: "Tomorrow", text: tomorrow2 },
  };
  const data3: ReportData = {
    ...data2,
    dateLong: long(i.d3), dateShort: short(i.d3),
    pill: { text: "Listings screened met", status: "met" },
    today: [
      { label: "Listings screened", value: "5", small: "of 5", note: "3 passed, 2 Interested", status: "met", pct: 100 },
      { label: "Deals moved", value: "1", note: "BrightPath to NDA signed", status: "neutral", pct: null },
      { label: "Next actions done", value: "4", note: "BrightPath, Pinecrest and 2 more", status: "neutral", pct: null },
      { label: "Calls", value: "1", note: "Rachel Kim", status: "neutral", pct: null },
      { label: "Emails", value: "5", note: "1 to a broker", status: "neutral", pct: null },
      { label: "Network outreach", value: "0", note: "0 of 10 this week", status: "missed", pct: 0 },
    ],
    deals: ["BrightPath Home Care moved to NDA signed. Key finding: Caregiver retention is the question."],
    targets: [{ met: true, judged: true, line: "Listings screened 5 of 5 today, 5 of 5 this week", commitment: true, reason: null }],
    tomorrow: { label: "Tomorrow", text: tomorrow3 },
  };
  return {
    judged2, judged3, tomorrow2, tomorrow3,
    subject2: reportSubject(data2), html2: reportInnerHtml(data2), summary2: "Listings screened 2 of 5 · Dana Whitfield coffee · Maria Santos call",
    subject3: reportSubject(data3), html3: reportInnerHtml(data3), summary3: "Listings screened 5 of 5 · BrightPath to NDA signed · Rachel Kim email",
  };
}

const DAY_LONG: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
