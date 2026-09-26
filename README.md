# Assign a HubSpot deal to the rep Calendly booked

Round-robin booking picks the person who will meet the customer. The related HubSpot deal can still belong to someone else, leaving the new host without a clear handoff.

For one selected Calendly round-robin event type, this automation looks up the booked host by email, finds the invitee's existing HubSpot contact, and checks that contact's associated deals. If exactly one deal is in your chosen stage, it assigns that deal to the host.

The change overwrites the deal's current owner. When the host, contact, or eligible deal cannot be identified uniquely, the automation posts the booking to Slack for review and leaves the deal alone.

## Set it up with a coding agent

Copy the setup prompt from [the article](https://automate.ax/articles/calendly-deal-owner-sync) into your coding agent. The agent creates the Automate.ax project, asks for your choices, guides account authorization, checks the automation, and deploys it. You do not need to clone this repository yourself when using the prompt.

You'll choose:

- The Calendly organization and round-robin event type to watch.
- The HubSpot deal stage eligible for reassignment.
- A Slack channel for bookings that need a human review.
- Account authorization for Calendly, HubSpot, and Slack.

## Manual setup

If you prefer to set it up yourself:

```sh
git clone https://github.com/SentsCo/automate-ax-calendly-deal-owner-sync.git
cd automate-ax-calendly-deal-owner-sync
bun install
bunx automate.ax login
bunx automate.ax init
bun run typecheck
bunx automate.ax deploy
```

Connect the accounts requested by Automate.ax when you deploy. The platform stores credentials outside this repository. Set any project parameters requested by the automation, then review the read and write operations before turning it on.

## Check a run

With a disposable booking and deal, confirm the matched host becomes the deal owner. Then test a missing or ambiguous match and confirm Slack receives a review message while the deal owner stays unchanged.

## Limits

- The invitee must already exist as one HubSpot contact. This automation does not create contacts; a contact sync that runs after the booking may send the booking to Slack for review.
- The host email must match exactly one HubSpot owner, and the contact must have exactly one associated deal in the selected stage. It never chooses arbitrarily between multiple matches.
- The code checks at most 500 HubSpot owners and fewer than 100 associated deals. Larger sets go to review instead of risking a partial match.
- A successful match overwrites the deal's current owner. Review your assignment policy before deployment.

The workflow responds to [a real problem described by Calendly Community: round-robin host as HubSpot deal owner](https://community.calendly.com/how-do-i-40/calendly-to-hubspot-how-to-update-hubspot-field-based-on-calendly-round-robin-3336). The public report informed the example; it is not an endorsement of this implementation.
