#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const ORG = process.env.SF_TARGET_ORG || 'revio-salesforce';
const DASHBOARD_PATH = new URL('../index.html', import.meta.url);
const HISTORY_PATH = new URL('../data/hourly-contact-history.json', import.meta.url);
const GENERATED_AT = new Date().toISOString().slice(0, 10);
const generatedAtDate = new Date(`${GENERATED_AT}T00:00:00Z`);
const weekStartDate = new Date(generatedAtDate);
weekStartDate.setUTCDate(generatedAtDate.getUTCDate() - ((generatedAtDate.getUTCDay() + 6) % 7));
const WEEK_START = weekStartDate.toISOString().slice(0, 10);
const BUSINESS_TZ = 'America/New_York';
const BUSINESS_HOURS = Array.from({ length: 10 }, (_, i) => i + 8);
const PSA_PRODUCT_TYPES = new Set(['PSA', 'PSA 2.0']);
const UNLOCK_NAME = 'Viking 1';
const APOLLO3_FULLY_UNBLOCKED_BASELINE = 49;

const CAPABILITY_OVERRIDES = {
  'Knowledgebase': {
    status: 'delivered',
    rel: 'V1',
    note: 'Knowledgebase is Available/Delivered in Viking 1 and listed in the 2026-08-03 release notes.',
  },
  'Integration - Portal': {
    status: 'delivered',
    rel: 'A3+V1',
    note: 'Portal.io product sync is delivered, and Viking 1 adds Portal proposal-to-quote and contact sync.',
  },
  'Progressive Billing': {
    status: 'delivered',
    rel: 'V1',
    note: 'Viking 1 supports progress billing workflows with project charges by percent of remaining balance, fixed amount, and selected project Parts & Labor items.',
  },
  'Central Station': {
    status: 'delivered',
    rel: 'V1',
    note: 'Viking 1 delivered CMS history plus COPS/Rapid Response central-station test/no-action controls.',
  },
  'Integration - CMS': {
    status: 'delivered',
    rel: 'A3+V1',
    note: 'CMS account sync is delivered and Viking 1 adds CMS alarm/activity history into Rev.io.',
  },
  'Integration - RapidResponse': {
    status: 'delivered',
    rel: 'V1',
    note: 'Rapid Response account sync and central-station no-action/test controls are Available/Delivered in Viking 1.',
  },
  'Integration - QuickBooks Desktop': {
    status: 'delivered',
    rel: 'A3+V1',
    note: 'QuickBooks Desktop invoice/customer/item sync is live, with Viking 1 QBD reliability and Web Connector work delivered.',
  },
  'CPQ': {
    status: 'delivered',
    rel: 'A1-A3+V1',
    note: 'Quotes, templates, macros, product images, descriptions, part-number search, one-time products, and Portal.io product/pricing sync are delivered.',
  },
  'Consolidated PO': {
    status: 'partial',
    rel: 'A1+V1',
    note: 'Purchase orders and PO enhancements are delivered; full consolidated PO automation should still be validated by workflow.',
  },
  'Zone Lists': {
    status: 'partial',
    rel: 'A1-A3+V1',
    note: 'Inventory core, serial lookup, valuation, reservations search, location filtering, and stock-level views are available; confirm exact zone-list workflow.',
  },
  'Contracts / Agreements (in dev)': {
    status: 'progress',
    rel: 'V1',
    note: 'Agreement management is delivered in core areas, but several agreement components remain staged for release.',
  },
  'Contracts - Hourly and Hourly Usage': {
    status: 'progress',
    rel: 'V1',
    note: 'Hourly agreement components are delivered/staged in Viking 1; validate release readiness before positioning as fully GA.',
  },
  'Contracts - Product and Labor Pricing Management': {
    status: 'progress',
    rel: 'V1',
    note: 'Agreement pricing and component work is delivered/staged in Viking 1; validate release readiness before positioning as fully GA.',
  },
  'Contracts - Quarterly/Semi-Annual/Annual Billing Cycles': {
    status: 'progress',
    rel: 'V1',
    note: 'Agreement recurring/overage/component work is delivered/staged in Viking 1; validate exact billing-cycle fit.',
  },
  'Contracts - Flexible Rate Adjustments': {
    status: 'progress',
    rel: 'V1',
    note: 'Agreement component/rate work is delivered/staged in Viking 1; validate exact rate-adjustment fit.',
  },
};

const STATUS_PRIORITY = { delivered: 1, partial: 3, progress: 4, gap: 6 };
const TIER_BY_PRIORITY = {
  1: '1 · Fully Unblocked — Re-engage Now',
  2: '2 · Core Delivered — Re-engage Now',
  3: '3 · Partial Win — Lead w/ Delivered',
  4: '4 · Coming Soon — Watch',
  5: '5 · Partial — Still Gated',
  6: '6 · Still Blocked (hard gaps)',
  99: `No ${UNLOCK_NAME} signal`,
};

const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
const dealsMatch = html.match(/const DEALS = (\[.*?\]);\n(?:const SF_ACTIVITY_SUMMARY = .*?;\n)?const TIERS = /s);
if (!dealsMatch) {
  throw new Error('Could not find DEALS JSON in index.html');
}

const deals = JSON.parse(dealsMatch[1]);
function applyCapabilityOverrides(deal) {
  deal.statuses = (deal.statuses || []).map((status) => {
    const override = CAPABILITY_OVERRIDES[status.tag];
    return override ? { ...status, ...override } : status;
  });
  if (!deal.statuses.length) {
    deal.tier = TIER_BY_PRIORITY[99];
    deal.priority = 99;
    return;
  }
  const worst = Math.max(...deal.statuses.map((status) => STATUS_PRIORITY[status.status] || 6));
  const hasDelivered = deal.statuses.some((status) => status.status === 'delivered');
  let priority = worst;
  if (worst === 1 && deal.statuses.length > 1) priority = 2;
  if (worst === 3 && !hasDelivered) priority = 5;
  deal.priority = priority;
  deal.tier = TIER_BY_PRIORITY[priority] || TIER_BY_PRIORITY[6];
}

for (const deal of deals) applyCapabilityOverrides(deal);
const uniqueNames = [...new Set(deals.map((deal) => deal.sf_account || deal.account).filter(Boolean))];

function soqlString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function query(soql) {
  const output = execFileSync(
    'npx',
    ['--yes', '@salesforce/cli', 'data', 'query', '--target-org', ORG, '--query', soql, '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 80 },
  );
  const parsed = JSON.parse(output);
  if (parsed.status !== 0) {
    throw new Error(parsed.message || `Salesforce query failed: ${soql}`);
  }
  return parsed.result.records || [];
}

function batch(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

function byAccountIdAggregate(records, valueField = 'expr0') {
  const map = new Map();
  for (const record of records) {
    map.set(record.AccountId, Number(record[valueField] || 0));
  }
  return map;
}

function timeParts(date = new Date(), timeZone = BUSINESS_TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

const businessNow = timeParts();
const BUSINESS_DATE = businessNow.date;
const CURRENT_BUSINESS_HOUR = businessNow.hour;

function businessHourLabel(hour) {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 || 12;
  return `${display}${suffix}`;
}

function timestampBusinessParts(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return timeParts(date);
}

function currentOpportunityDate(deal) {
  return deal.sf_activity?.current_opp_created_date || deal.sf_activity?.current_opp_close_date || '';
}

function lostAmountDelta(deal) {
  const currentAmount = deal.sf_activity?.current_opp_amount || 0;
  if (!currentAmount) return Number.MAX_SAFE_INTEGER;
  return Math.abs((deal.amount || 0) - currentAmount);
}

function isBetterDashboardRow(candidate, current) {
  if (!current) return true;
  const candidateOpen = candidate.sf_activity?.current_stage && !candidate.sf_activity?.current_opp_closed;
  const currentOpen = current.sf_activity?.current_stage && !current.sf_activity?.current_opp_closed;
  if (candidateOpen !== currentOpen) return candidateOpen;
  if (candidate.priority !== current.priority) return candidate.priority < current.priority;
  const candidateTagged = candidate.statuses?.length || 0;
  const currentTagged = current.statuses?.length || 0;
  if (candidateTagged !== currentTagged) return candidateTagged > currentTagged;
  const candidateDate = currentOpportunityDate(candidate);
  const currentDate = currentOpportunityDate(current);
  if (candidateDate !== currentDate) return candidateDate > currentDate;
  const candidateDelta = lostAmountDelta(candidate);
  const currentDelta = lostAmountDelta(current);
  if (candidateDelta !== currentDelta) return candidateDelta < currentDelta;
  return (candidate.amount || 0) > (current.amount || 0);
}

function mergeStatusLists(rows) {
  const statuses = new Map();
  for (const row of rows) {
    for (const status of row.statuses || []) {
      const key = `${status.tag}|${status.status}`;
      if (!statuses.has(key)) statuses.set(key, status);
    }
  }
  return [...statuses.values()];
}

const accountRecords = [];
for (const names of batch(uniqueNames, 45)) {
  accountRecords.push(...query(
    `SELECT Id, Name, Owner.Name, Type, LastActivityDate FROM Account WHERE Name IN (${names.map(soqlString).join(',')})`,
  ));
}

const accountByName = new Map();
for (const account of accountRecords) {
  if (!accountByName.has(account.Name)) accountByName.set(account.Name, account);
}

const accountIds = [...new Set(accountRecords.map((account) => account.Id))];
const taskRecords = [];
const eventRecords = [];
const opportunityRecords = [];
const taskCounts = [];
const eventCounts = [];
const taskCountsSince = [];
const eventCountsSince = [];

for (const ids of batch(accountIds, 75)) {
  const inClause = ids.map(soqlString).join(',');
  taskRecords.push(...query(
    `SELECT Id, AccountId, ActivityDate, Subject, Type, Status, Owner.Name, CreatedDate, LastModifiedDate FROM Task WHERE AccountId IN (${inClause}) ORDER BY ActivityDate DESC NULLS LAST, LastModifiedDate DESC LIMIT 500`,
  ));
  eventRecords.push(...query(
    `SELECT Id, AccountId, ActivityDate, ActivityDateTime, Subject, Type, Owner.Name, CreatedDate, LastModifiedDate FROM Event WHERE AccountId IN (${inClause}) ORDER BY ActivityDate DESC NULLS LAST, LastModifiedDate DESC LIMIT 500`,
  ));
  taskRecords.push(...query(
    `SELECT Id, AccountId, ActivityDate, Subject, Type, Status, Owner.Name, CreatedDate, LastModifiedDate FROM Task WHERE AccountId IN (${inClause}) AND CreatedDate = TODAY ORDER BY CreatedDate DESC LIMIT 2000`,
  ));
  eventRecords.push(...query(
    `SELECT Id, AccountId, ActivityDate, ActivityDateTime, Subject, Type, Owner.Name, CreatedDate, LastModifiedDate FROM Event WHERE AccountId IN (${inClause}) AND CreatedDate = TODAY ORDER BY CreatedDate DESC LIMIT 2000`,
  ));
  opportunityRecords.push(...query(
    `SELECT Id, AccountId, Name, StageName, IsClosed, IsWon, CloseDate, CreatedDate, Amount, Product_Type__c, LastModifiedDate, Owner.Name FROM Opportunity WHERE AccountId IN (${inClause}) AND Product_Type__c IN ('PSA','PSA 2.0') ORDER BY IsClosed ASC, CreatedDate DESC, LastModifiedDate DESC LIMIT 2000`,
  ));
  taskCounts.push(...query(
    `SELECT AccountId, COUNT(Id) total FROM Task WHERE AccountId IN (${inClause}) GROUP BY AccountId`,
  ));
  eventCounts.push(...query(
    `SELECT AccountId, COUNT(Id) total FROM Event WHERE AccountId IN (${inClause}) GROUP BY AccountId`,
  ));
  taskCountsSince.push(...query(
    `SELECT AccountId, COUNT(Id) total FROM Task WHERE AccountId IN (${inClause}) AND ActivityDate >= ${WEEK_START} GROUP BY AccountId`,
  ));
  eventCountsSince.push(...query(
    `SELECT AccountId, COUNT(Id) total FROM Event WHERE AccountId IN (${inClause}) AND ActivityDate >= ${WEEK_START} GROUP BY AccountId`,
  ));
}

const taskCountByAccount = byAccountIdAggregate(taskCounts, 'total');
const eventCountByAccount = byAccountIdAggregate(eventCounts, 'total');
const taskCountSinceByAccount = byAccountIdAggregate(taskCountsSince, 'total');
const eventCountSinceByAccount = byAccountIdAggregate(eventCountsSince, 'total');

const activitiesByAccount = new Map();
const seenActivityIds = new Set();
const hourlyByAccount = new Map();
const hourlyTotals = Object.fromEntries(BUSINESS_HOURS.map((hour) => [hour, 0]));
const hourlyAccountSets = Object.fromEntries(BUSINESS_HOURS.map((hour) => [hour, new Set()]));

function addHourlyContact(activity) {
  if (!activity.AccountId) return;
  const stamped = timestampBusinessParts(activity.CreatedDate || activity.LastModifiedDate || activity.ActivityDateTime);
  if (!stamped || stamped.date !== BUSINESS_DATE || !BUSINESS_HOURS.includes(stamped.hour)) return;
  if (!hourlyByAccount.has(activity.AccountId)) {
    hourlyByAccount.set(activity.AccountId, {
      total: 0,
      latest_at: '',
      latest_touch: '',
      hours: Object.fromEntries(BUSINESS_HOURS.map((hour) => [hour, 0])),
    });
  }
  const accountHourly = hourlyByAccount.get(activity.AccountId);
  accountHourly.total += 1;
  accountHourly.hours[stamped.hour] += 1;
  hourlyTotals[stamped.hour] += 1;
  hourlyAccountSets[stamped.hour].add(activity.AccountId);
  const stamp = activity.CreatedDate || activity.LastModifiedDate || activity.ActivityDateTime || '';
  if (stamp > accountHourly.latest_at) {
    accountHourly.latest_at = stamp;
    accountHourly.latest_touch = `${activity.source}: ${activity.subject}${activity.owner ? ` (${activity.owner})` : ''}`;
  }
}

for (const task of taskRecords) {
  if (!task.AccountId) continue;
  if (seenActivityIds.has(task.Id)) continue;
  seenActivityIds.add(task.Id);
  const activity = {
    id: task.Id,
    source: 'Task',
    date: task.ActivityDate || task.LastModifiedDate?.slice(0, 10) || '',
    subject: task.Subject || task.Type || 'Task',
    owner: task.Owner?.Name || '',
    status: task.Status || '',
    AccountId: task.AccountId,
    CreatedDate: task.CreatedDate || '',
    LastModifiedDate: task.LastModifiedDate || '',
  };
  if (!activitiesByAccount.has(task.AccountId)) activitiesByAccount.set(task.AccountId, []);
  activitiesByAccount.get(task.AccountId).push(activity);
  addHourlyContact(activity);
}
for (const event of eventRecords) {
  if (!event.AccountId) continue;
  if (seenActivityIds.has(event.Id)) continue;
  seenActivityIds.add(event.Id);
  const activity = {
    id: event.Id,
    source: 'Event',
    date: event.ActivityDate || event.ActivityDateTime?.slice(0, 10) || event.LastModifiedDate?.slice(0, 10) || '',
    subject: event.Subject || event.Type || 'Event',
    owner: event.Owner?.Name || '',
    status: '',
    AccountId: event.AccountId,
    ActivityDateTime: event.ActivityDateTime || '',
    CreatedDate: event.CreatedDate || '',
    LastModifiedDate: event.LastModifiedDate || '',
  };
  if (!activitiesByAccount.has(event.AccountId)) activitiesByAccount.set(event.AccountId, []);
  activitiesByAccount.get(event.AccountId).push(activity);
  addHourlyContact(activity);
}

for (const activities of activitiesByAccount.values()) {
  activities.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

const opportunitiesByAccount = new Map();
for (const opportunity of opportunityRecords) {
  if (!opportunity.AccountId) continue;
  if (!opportunitiesByAccount.has(opportunity.AccountId)) opportunitiesByAccount.set(opportunity.AccountId, []);
  opportunitiesByAccount.get(opportunity.AccountId).push(opportunity);
}

function pickCurrentOpportunity(accountId, originalOppName) {
  const opportunities = (opportunitiesByAccount.get(accountId) || []).filter((opp) => PSA_PRODUCT_TYPES.has(opp.Product_Type__c));
  if (!opportunities.length) return null;
  const open = opportunities
    .filter((opp) => !opp.IsClosed)
    .sort((a, b) => (b.CreatedDate || '').localeCompare(a.CreatedDate || '') || (b.LastModifiedDate || '').localeCompare(a.LastModifiedDate || ''))[0];
  if (open) return open;
  const normalizedOriginal = (originalOppName || '').toLowerCase();
  return opportunities.find((opp) => (opp.Name || '').toLowerCase() === normalizedOriginal) || opportunities[0];
}

function pickNewOpportunityThisWeek(accountId) {
  const opportunities = (opportunitiesByAccount.get(accountId) || []).filter((opp) => PSA_PRODUCT_TYPES.has(opp.Product_Type__c));
  return opportunities.find((opp) => {
    const createdDate = opp.CreatedDate?.slice(0, 10) || '';
    return createdDate >= WEEK_START && createdDate <= GENERATED_AT;
  }) || null;
}

let matchedDeals = 0;
let contactedDeals = 0;
let openOppDeals = 0;
let newOppDealsThisWeek = 0;
let touchedDealsThisWeek = 0;

for (const deal of deals) {
  const sfName = deal.sf_account || deal.account;
  const account = accountByName.get(sfName);
  if (!account) {
    deal.sf_activity = {
      matched: false,
      last_contacted: '',
      activity_count: 0,
      touches_this_week: 0,
      task_count: 0,
      event_count: 0,
      current_stage: '',
      current_opportunity: '',
      has_new_opp_this_week: false,
      account_owner: '',
      note: 'No exact Salesforce Account match found',
    };
    continue;
  }

  matchedDeals += 1;
  const activities = activitiesByAccount.get(account.Id) || [];
  const lastActivity = activities[0];
  const currentOpportunity = pickCurrentOpportunity(account.Id, deal.opp);
  const newOpportunityThisWeek = pickNewOpportunityThisWeek(account.Id);
  const taskCount = taskCountByAccount.get(account.Id) || 0;
  const eventCount = eventCountByAccount.get(account.Id) || 0;
  const hourlyContact = hourlyByAccount.get(account.Id) || {
    total: 0,
    latest_at: '',
    latest_touch: '',
    hours: Object.fromEntries(BUSINESS_HOURS.map((hour) => [hour, 0])),
  };
  const activityCount = taskCount + eventCount;
  const touchesSince = (taskCountSinceByAccount.get(account.Id) || 0) + (eventCountSinceByAccount.get(account.Id) || 0);
  const lastContacted = lastActivity?.date || account.LastActivityDate || '';
  const currentOpportunityCreatedDate = currentOpportunity?.CreatedDate?.slice(0, 10) || '';
  if (lastContacted) contactedDeals += 1;
  if (currentOpportunity && !currentOpportunity.IsClosed) openOppDeals += 1;
  if (touchesSince > 0) touchedDealsThisWeek += 1;
  if (newOpportunityThisWeek) newOppDealsThisWeek += 1;

  deal.sf_activity = {
    matched: true,
    account_id: account.Id,
    account_owner: account.Owner?.Name || '',
    last_contacted: lastContacted,
    last_touch: lastActivity
      ? `${lastActivity.source}: ${lastActivity.subject}${lastActivity.owner ? ` (${lastActivity.owner})` : ''}`
      : '',
    activity_count: activityCount,
    touches_this_week: touchesSince,
    contacts_today: hourlyContact.total,
    contacts_current_hour: hourlyContact.hours[CURRENT_BUSINESS_HOUR] || 0,
    hourly_contacts: hourlyContact.hours,
    latest_contact_logged_at: hourlyContact.latest_at,
    latest_contact_logged_touch: hourlyContact.latest_touch,
    task_count: taskCount,
    event_count: eventCount,
    current_stage: currentOpportunity?.StageName || '',
    current_opportunity: currentOpportunity?.Name || '',
    current_opp_id: currentOpportunity?.Id || '',
    current_opp_owner: currentOpportunity?.Owner?.Name || '',
    current_opp_product_type: currentOpportunity?.Product_Type__c || '',
    current_opp_won: Boolean(currentOpportunity?.IsWon),
    current_opp_closed: Boolean(currentOpportunity?.IsClosed),
    current_opp_close_date: currentOpportunity?.CloseDate || '',
    current_opp_created_date: currentOpportunityCreatedDate,
    current_opp_amount: currentOpportunity?.Amount || 0,
    has_new_opp_this_week: Boolean(newOpportunityThisWeek),
    new_opp_this_week_name: newOpportunityThisWeek?.Name || '',
    new_opp_this_week_stage: newOpportunityThisWeek?.StageName || '',
    new_opp_this_week_created_date: newOpportunityThisWeek?.CreatedDate?.slice(0, 10) || '',
  };
}

const psaDeals = deals.filter((deal) => PSA_PRODUCT_TYPES.has(deal.sf_activity?.current_opp_product_type));
const dealsByAccount = new Map();
for (const deal of psaDeals) {
  const key = deal.sf_activity?.account_id || deal.sf_account || deal.account;
  if (!dealsByAccount.has(key)) dealsByAccount.set(key, []);
  dealsByAccount.get(key).push(deal);
}

const dashboardDeals = [...dealsByAccount.values()].map((rows) => {
  const selected = rows.reduce((best, row) => (isBetterDashboardRow(row, best) ? row : best), null);
  const merged = { ...selected };
  merged.statuses = mergeStatusLists(rows);
  merged.tagged = rows.some((row) => row.tagged);
  merged.duplicate_source_deals = rows.length;
  return merged;
});
const dashboardAccountIds = new Set(dashboardDeals.map((deal) => deal.sf_activity?.account_id).filter(Boolean));
const openOpportunityIds = new Set(dashboardDeals
  .filter((deal) => deal.sf_activity?.current_stage && !deal.sf_activity?.current_opp_closed)
  .map((deal) => deal.sf_activity.current_opp_id || `${deal.sf_activity.account_id}|${deal.sf_activity.current_opportunity}`));
const summary = {
  generated_at: GENERATED_AT,
  generated_at_utc: new Date().toISOString(),
  week_start: WEEK_START,
  business_timezone: BUSINESS_TZ,
  business_date: BUSINESS_DATE,
  current_business_hour: CURRENT_BUSINESS_HOUR,
  business_hours: BUSINESS_HOURS,
  hourly_contact_counts: Object.fromEntries(BUSINESS_HOURS.map((hour) => [hour, hourlyTotals[hour] || 0])),
  hourly_contacted_accounts: Object.fromEntries(BUSINESS_HOURS.map((hour) => [hour, hourlyAccountSets[hour]?.size || 0])),
  contacted_accounts_today: dashboardDeals.filter((deal) => (deal.sf_activity?.contacts_today || 0) > 0).length,
  contacts_logged_today: dashboardDeals.reduce((sum, deal) => sum + (deal.sf_activity?.contacts_today || 0), 0),
  contacted_accounts_current_hour: dashboardDeals.filter((deal) => (deal.sf_activity?.contacts_current_hour || 0) > 0).length,
  contacts_logged_current_hour: dashboardDeals.reduce((sum, deal) => sum + (deal.sf_activity?.contacts_current_hour || 0), 0),
  matched_deals: dashboardDeals.filter((deal) => deal.sf_activity?.matched).length,
  unmatched_deals: dashboardDeals.filter((deal) => !deal.sf_activity?.matched).length,
  contacted_deals: dashboardDeals.filter((deal) => deal.sf_activity?.last_contacted).length,
  touched_deals_this_week: dashboardDeals.filter((deal) => (deal.sf_activity?.touches_this_week || 0) > 0).length,
  new_opp_deals_this_week: dashboardDeals.filter((deal) => deal.sf_activity?.has_new_opp_this_week).length,
  open_opp_deals: openOpportunityIds.size,
  account_matches: dashboardAccountIds.size,
  apollo3_fully_unblocked_baseline: APOLLO3_FULLY_UNBLOCKED_BASELINE,
  fully_unblocked_now: dashboardDeals.filter((deal) => deal.priority === 1).length,
};
summary.newly_fully_unblocked = Math.max(0, summary.fully_unblocked_now - summary.apollo3_fully_unblocked_baseline);

let nextHtml = html.replace(
  /const DEALS = \[.*?\];\n(?:const SF_ACTIVITY_SUMMARY = .*?;\n)?const TIERS = /s,
  `const DEALS = ${JSON.stringify(dashboardDeals)};\nconst SF_ACTIVITY_SUMMARY = ${JSON.stringify(summary)};\nconst TIERS = `,
);

if (!/const SF_ACTIVITY_SUMMARY = /.test(nextHtml)) {
  throw new Error('Failed to inject SF_ACTIVITY_SUMMARY');
}

fs.writeFileSync(DASHBOARD_PATH, nextHtml);
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });

let history = [];
if (fs.existsSync(HISTORY_PATH)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    history = Array.isArray(parsed) ? parsed : [];
  } catch {
    history = [];
  }
}

const historyEntry = {
  generated_at_utc: summary.generated_at_utc,
  business_timezone: summary.business_timezone,
  business_date: summary.business_date,
  current_business_hour: summary.current_business_hour,
  hourly_contact_counts: summary.hourly_contact_counts,
  hourly_contacted_accounts: summary.hourly_contacted_accounts,
  contacted_accounts_today: summary.contacted_accounts_today,
  contacts_logged_today: summary.contacts_logged_today,
  contacted_accounts_current_hour: summary.contacted_accounts_current_hour,
  contacts_logged_current_hour: summary.contacts_logged_current_hour,
};

history = history.filter((entry) =>
  !(entry.business_date === historyEntry.business_date && entry.current_business_hour === historyEntry.current_business_hour)
);
history.push(historyEntry);
history.sort((a, b) => (a.generated_at_utc || '').localeCompare(b.generated_at_utc || ''));
history = history.slice(-450);
fs.writeFileSync(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
