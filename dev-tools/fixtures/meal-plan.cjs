// LOCAL TESTING ONLY. A realistic AI reply for "Start an initiative" (the weekly meal plan) and for weekly savings
// ideas. Used by the AI stand-in in dev-tools/mock-supabase.mjs and by src/lib/initiative/proposal.test.ts.
// Dates are relative to the day it runs, so the proposal is always valid (dates after today).

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const MENU = [
  "- **Sunday cook (about 3 hours):** one batch of lunches and dinners for Monday to Saturday, plus breakfast prep.",
  "  - **Lunches:** chicken and rice bowls (3), lentil soup (3).",
  "  - **Dinners:** turkey chili (2), sheet-pan salmon and vegetables (2), pasta with meat sauce (2).",
  "**Menu**",
  "- **Sunday:** lunch, leftover chili from last week; dinner, roast chicken (cooked fresh).",
  "- **Monday:** lunch, chicken and rice bowl; dinner, turkey chili.",
  "- **Tuesday:** lunch, lentil soup; dinner, sheet-pan salmon and vegetables.",
  "- **Wednesday:** lunch, chicken and rice bowl; dinner, pasta with meat sauce.",
  "- **Thursday:** lunch, lentil soup; dinner, turkey chili.",
  "- **Friday:** lunch, chicken and rice bowl; dinner, sheet-pan salmon and vegetables.",
  "- **Saturday:** lunch, lentil soup; dinner, pasta with meat sauce.",
  "**Breakfast plan (separate)**",
  "- **Weekdays:** overnight oats with berries (5 jars made Sunday).",
  "- **Weekend:** eggs, toast, and fruit.",
  "**Recipes**",
  "- **Chicken and rice bowls:** bake 3 lb chicken thighs at 425 F for 25 minutes; cook 3 cups rice; add broccoli and sauce.",
  "- **Lentil soup:** onion, carrot, celery, 2 cups lentils, 8 cups broth, 40 minutes.",
  "- **Turkey chili:** 2 lb ground turkey, 2 cans beans, 1 can tomatoes, chili spices, 45 minutes.",
  "- **Sheet-pan salmon:** 4 fillets, potatoes, green beans, 20 minutes at 400 F.",
  "- **Pasta with meat sauce:** 1 lb pasta, 1 lb ground beef, 1 jar sauce.",
  "**Money**",
  "- **Food budget:** groceries target $700 per month, one shop each Saturday (about $160).",
  "- **Dining and delivery:** keep to one meal out per week.",
].join("\n");

const GROCERIES = [
  ["Chicken thighs", "3 lb"], ["Salmon fillets", "4"], ["Ground turkey", "2 lb"], ["Ground beef", "1 lb"], ["Eggs", "1 dozen"],
  ["Rice", "3 cups"], ["Lentils", "2 cups"], ["Pasta", "1 lb"], ["Rolled oats", "1 canister"], ["Canned beans", "2 cans"],
  ["Canned tomatoes", "1 can"], ["Pasta sauce", "1 jar"], ["Chicken broth", "8 cups"], ["Broccoli", "2 heads"], ["Green beans", "1 lb"],
  ["Potatoes", "2 lb"], ["Onions", "3"], ["Carrots", "1 lb"], ["Celery", "1 bunch"], ["Berries", "2 pints"], ["Bananas", "1 bunch"],
  ["Bread", "1 loaf"], ["Milk", "1 half gallon"], ["Greek yogurt", "1 large tub"],
];

function mealPlanProposal(today) {
  return {
    initiative: {
      name: "Weekly meal plan",
      purpose: "Shop once a week and cook on Sunday for the week's lunches and dinners, with a separate breakfast plan, to cut food spending.",
      parent_initiative: "Personal Finance",
    },
    goals: [
      {
        title: `Food spending under $1,000 per month by ${addDays(today, 90)}`,
        metric_key: "category_spending_last_month",
        categories: ["Groceries", "Dining"],
        comparison: "lte",
        target_value: 1000,
        deadline: addDays(today, 90),
      },
    ],
    milestones: [
      {
        title: "4 Sunday cooks in a row",
        completion_test: "4 weekly Sunday cook tasks marked done in a row",
        due_date: addDays(today, 30),
        goal: 0,
        target_value: 4,
        options_if_missed: ["Extend 2 weeks", "Cook twice a week in smaller batches", "Switch to a meal kit for one month"],
      },
    ],
    recurring_tasks: [
      { title: "Shop for the week's groceries", cadence: "weekly", weekday: 6, details: "Use the grocery list. One shop only.", review: false },
      { title: "Cook meals for the week", cadence: "weekly", weekday: 0, details: "Lunches and dinners for Monday to Saturday, and 5 breakfast jars.", review: false },
    ],
    target: { name: "Home-cooked dinners", period: "week", minimum_count: 5, weekdays: null },
    budget_change: { category: "Groceries", new_monthly_amount: 700, estimated_monthly_savings: 250 },
    decision_condition: null,
    plan_document: { title: "Weekly meal plan: menu and recipes", body: MENU },
    checklists: [
      {
        name: "Grocery list",
        reset_weekly: true,
        recurring_task: 0,
        items: GROCERIES.map(([text, quantity]) => ({ text, quantity, notes: null })),
      },
    ],
    estimated_monthly_savings: 250,
  };
}

module.exports = { mealPlanProposal, addDays };
