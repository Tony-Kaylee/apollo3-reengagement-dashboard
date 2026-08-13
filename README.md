# Viking 1 Unlock Dashboard

Static GitHub Pages site for Rev.io lost-deal re-engagement analysis.

Live site: https://tony-kaylee.github.io/apollo3-reengagement-dashboard/

## Business-Hours Refresh

The dashboard has an OpenClaw cron that runs the rebuild hourly from 8:00 AM through 5:00 PM America/New_York, Monday through Friday.

Refresh behavior:
- Pulls the latest repo state.
- Rebuilds Salesforce activity, current PSA opportunities, weekly touches, open opps, and closed-won signals.
- Rebuilds same-day hourly contact pacing from Salesforce Task/Event records for accounts in the dashboard list.
- Applies the current Viking 1 capability scoring map sourced from the live Products Roadmap and release notes review.
- Publishes `index.html` back to GitHub Pages when the dashboard changes.

The top KPI block includes `Newly Unblocked`, calculated as current fully unblocked accounts minus the Apollo 3 fully-unblocked baseline.
