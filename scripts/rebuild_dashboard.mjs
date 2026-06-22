#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const ORG = process.env.SF_TARGET_ORG || 'revio-salesforce';
const DASHBOARD_PATH = new URL('../index.html', import.meta.url);
const GENERATED_AT = new Date().toISOString().slice(0, 10);
const generatedAtDate = new Date(`${GENERATED_AT}T00:00:00Z`);
const weekStartDate = new Date(generatedAtDate);
weekStartDate.setUTCDate(generatedAtDate.getUTCDate() - ((generatedAtDate.getUTCDay() + 6) % 7));
const WEEK_START = weekStartDate.toISOString().slice(0, 10);
const PSA_PRODUCT_TYPES = new Set(['PSA', 'PSA 2.0']);

const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
const dealsMatch = html.match(/const DEALS = (\[.*?\]);\n(?:const SF_ACTIVITY_SUMMARY = .*?;\n)?const TIERS = /s);
if (!dealsMatch) {
  throw new Error('Could not find DEALS JSON in index.html');
}

const deals = JSON.parse(dealsMatch[1]);
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
    `SELECT Id, AccountId, ActivityDate, Subject, Type, Status, Owner.Name, LastModifiedDate FROM Task WHERE AccountId IN (${inClause}) ORDER BY ActivityDate DESC NULLS LAST, LastModifiedDate DESC LIMIT 500`,
  ));
  eventRecords.push(...query(
    `SELECT Id, AccountId, ActivityDate, ActivityDateTime, Subject, Type, Owner.Name, LastModifiedDate FROM Event WHERE AccountId IN (${inClause}) ORDER BY ActivityDate DESC NULLS LAST, LastModifiedDate DESC LIMIT 500`,
  ));
  opportunityRecords.push(...query(
    `SELECT Id, AccountId, Name, StageName, IsClosed, IsWon, CloseDate, CreatedDate, Amount, Product_Type__c, LastModifiedDate, Owner.Name FROM Opportunity WHERE AccountId IN (${inClause}) AND Product_Type__c IN ('PSA','PSA 2.0') ORDER BY IsClosed ASC, LastModifiedDate DESC LIMIT 2000`,
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
for (const task of taskRecords) {
  if (!task.AccountId) continue;
  const activity = {
    source: 'Task',
    date: task.ActivityDate || task.LastModifiedDate?.slice(0, 10) || '',
    subject: task.Subject || task.Type || 'Task',
    owner: task.Owner?.Name || '',
    status: task.Status || '',
  };
  if (!activitiesByAccount.has(task.AccountId)) activitiesByAccount.set(task.AccountId, []);
  activitiesByAccount.get(task.AccountId).push(activity);
}
for (const event of eventRecords) {
  if (!event.AccountId) continue;
  const activity = {
    source: 'Event',
    date: event.ActivityDate || event.ActivityDateTime?.slice(0, 10) || event.LastModifiedDate?.slice(0, 10) || '',
    subject: event.Subject || event.Type || 'Event',
    owner: event.Owner?.Name || '',
    status: '',
  };
  if (!activitiesByAccount.has(event.AccountId)) activitiesByAccount.set(event.AccountId, []);
  activitiesByAccount.get(event.AccountId).push(activity);
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
  const open = opportunities.find((opp) => !opp.IsClosed);
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
    task_count: taskCount,
    event_count: eventCount,
    current_stage: currentOpportunity?.StageName || '',
    current_opportunity: currentOpportunity?.Name || '',
    current_opp_owner: currentOpportunity?.Owner?.Name || '',
    current_opp_product_type: currentOpportunity?.Product_Type__c || '',
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

const summary = {
  generated_at: GENERATED_AT,
  week_start: WEEK_START,
  matched_deals: matchedDeals,
  unmatched_deals: deals.length - matchedDeals,
  contacted_deals: contactedDeals,
  touched_deals_this_week: touchedDealsThisWeek,
  new_opp_deals_this_week: newOppDealsThisWeek,
  open_opp_deals: openOppDeals,
  account_matches: accountRecords.length,
};

let nextHtml = html.replace(
  /const DEALS = \[.*?\];\n(?:const SF_ACTIVITY_SUMMARY = .*?;\n)?const TIERS = /s,
  `const DEALS = ${JSON.stringify(deals)};\nconst SF_ACTIVITY_SUMMARY = ${JSON.stringify(summary)};\nconst TIERS = `,
);

if (!/const SF_ACTIVITY_SUMMARY = /.test(nextHtml)) {
  throw new Error('Failed to inject SF_ACTIVITY_SUMMARY');
}

fs.writeFileSync(DASHBOARD_PATH, nextHtml);
console.log(JSON.stringify(summary, null, 2));
