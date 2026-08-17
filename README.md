# Viking 1 Unlock Dashboard

Static GitHub Pages site for Rev.io lost-deal re-engagement analysis.

Live site: https://tony-kaylee.github.io/apollo3-reengagement-dashboard/

## Business-Hours Refresh

The dashboard has an OpenClaw cron that runs the rebuild hourly from 8:00 AM through 5:00 PM America/New_York, Monday through Friday.

Refresh behavior:
- Pulls the latest repo state.
- Rebuilds Salesforce activity, current PSA opportunities, weekly touches, open opps, and closed-won signals.
- Rebuilds same-day hourly contact pacing from Salesforce Task/Event records for accounts in the dashboard list.
- Persists hourly snapshots in `data/hourly-contact-history.json`.
- Applies the current Viking 1 capability scoring map sourced from the live Products Roadmap and release notes review.
- Publishes `index.html` and the hourly contact history back to GitHub Pages when the dashboard changes.

The top KPI block includes `Newly Unblocked`, calculated as current fully unblocked accounts minus the Apollo 3 fully-unblocked baseline. It also shows current-week and previous-week PSA opportunity creation so the team can compare fresh demand against the prior Monday–Sunday window.
