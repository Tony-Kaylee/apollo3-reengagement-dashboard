# Viking 1 Unlock Dashboard

Static GitHub Pages site for Rev.io lost-deal re-engagement analysis.

Live site: https://tony-kaylee.github.io/apollo3-reengagement-dashboard/

## Daily Refresh

The dashboard has a daily OpenClaw cron that runs the rebuild at 9:00 AM America/New_York.

Refresh behavior:
- Pulls the latest repo state.
- Rebuilds Salesforce activity, current PSA opportunities, weekly touches, open opps, and closed-won signals.
- Applies the current Viking 1 capability scoring map sourced from the live Products Roadmap and release notes review.
- Publishes `index.html` back to GitHub Pages when the dashboard changes.

The top KPI block includes `Newly Unblocked`, calculated as current fully unblocked accounts minus the Apollo 3 fully-unblocked baseline.
