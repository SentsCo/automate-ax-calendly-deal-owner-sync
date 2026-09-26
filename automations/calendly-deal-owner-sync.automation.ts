import { automation, t, withPrerequisites } from "automate.ax"
import { calendly } from "automate.ax/calendly"
import { hubspot } from "automate.ax/hubspot"
import { slack } from "automate.ax/slack"

export default automation(
  "Assign an onboarding deal to the Calendly round-robin host",
  {
    parameters: [
      {
        label: "Calendly organization URL",
        name: "calendlyOrganizationUri",
        type: "url",
      },
      {
        label: "Round-robin event type URL",
        name: "roundRobinEventTypeUri",
        type: "url",
      },
      {
        label: "Eligible HubSpot deal stage ID",
        name: "eligibleDealStageId",
        type: "text",
      },
      {
        label: "Slack review conversation ID",
        name: "reviewConversationId",
        type: "text",
      },
    ],
  },
  ({ parameters }) => {
    const booking = calendly
      .onInviteeCreated({
        organizationUri: parameters.calendlyOrganizationUri,
        scope: "organization",
      })
      .filter(
        ({ payload }) =>
          payload.scheduledEvent.eventType ===
          parameters.roundRobinEventTypeUri,
      )

    const needsHostReview = booking.filter(
      ({ payload }) => payload.scheduledEvent.eventMemberships.length !== 1,
    )
    slack.sendMessage({
      conversation: parameters.reviewConversationId,
      text: t`Review Calendly booking ${needsHostReview.payload.scheduledEvent.uri}: exactly one booked host is required before updating a HubSpot deal owner.`,
    })

    const hostReference = booking
      .filter(
        ({ payload }) => payload.scheduledEvent.eventMemberships.length === 1,
      )
      .transform(({ payload }) => ({
        hostUserId:
          payload.scheduledEvent.eventMemberships[0]!.user.split("/").at(-1)!,
        inviteeEmail: payload.email,
        bookingUrl: payload.scheduledEvent.uri,
      }))
    const hostUser = calendly.getUser({ userId: hostReference.hostUserId })
    const host = hostUser.transform(hostReference, (user, bookingDetails) => ({
      hostEmail: user.email,
      inviteeEmail: bookingDetails.inviteeEmail,
      bookingUrl: bookingDetails.bookingUrl,
    }))

    const owners = withPrerequisites(host, () =>
      hubspot.listOwners({ limit: 500 }),
    )
    const ownerMatch = owners.transform(host, (page, booked) => ({
      ...booked,
      matchingOwners: page.owners.filter(
        (owner) =>
          owner.email?.toLowerCase() === booked.hostEmail.toLowerCase(),
      ),
      hasMoreOwners: page.after !== undefined,
    }))
    const unresolvedOwner = ownerMatch.filter(
      ({ matchingOwners, hasMoreOwners }) =>
        matchingOwners.length !== 1 || hasMoreOwners,
    )
    slack.sendMessage({
      conversation: parameters.reviewConversationId,
      text: t`Review Calendly booking ${unresolvedOwner.bookingUrl}: host ${unresolvedOwner.hostEmail} did not map to exactly one HubSpot owner in the complete owner list. No deal was changed.`,
    })

    const resolvedOwner = ownerMatch
      .filter(
        ({ matchingOwners, hasMoreOwners }) =>
          matchingOwners.length === 1 && !hasMoreOwners,
      )
      .transform(({ hostEmail, inviteeEmail, bookingUrl, matchingOwners }) => ({
        hostEmail,
        inviteeEmail,
        bookingUrl,
        ownerId: matchingOwners[0]!.id,
      }))

    const contactSearch = hubspot.searchContacts({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "email",
              operator: "EQ",
              value: resolvedOwner.inviteeEmail,
            },
          ],
        },
      ],
      limit: 2,
    })
    const contactMatch = contactSearch.transform(
      resolvedOwner,
      (page, resolved) => ({
        ...resolved,
        matchingContacts: page.records,
        hasMoreContacts: page.pageInfo.after !== undefined,
      }),
    )
    const unresolvedContact = contactMatch.filter(
      ({ matchingContacts, hasMoreContacts }) =>
        matchingContacts.length !== 1 || hasMoreContacts,
    )
    slack.sendMessage({
      conversation: parameters.reviewConversationId,
      text: t`Review Calendly booking ${unresolvedContact.bookingUrl}: invitee ${unresolvedContact.inviteeEmail} did not match exactly one HubSpot contact. No deal was changed.`,
    })

    const resolvedContact = contactMatch
      .filter(
        ({ matchingContacts, hasMoreContacts }) =>
          matchingContacts.length === 1 && !hasMoreContacts,
      )
      .transform(({ matchingContacts, ...context }) => ({
        ...context,
        contactId: matchingContacts[0]!.id,
      }))
    const contact = hubspot.getContact({
      recordId: resolvedContact.contactId,
      associations: ["deals"],
    })
    const dealMatch = contact.transform(resolvedContact, (record, context) => ({
      ...context,
      dealIds: [
        ...new Set(
          record.associations
            .find((association) => association.objectType === "deals")
            ?.records.map(({ id }) => id) ?? [],
        ),
      ],
    }))
    const unresolvedDeal = dealMatch.filter(
      ({ dealIds }) => dealIds.length === 0 || dealIds.length >= 100,
    )
    slack.sendMessage({
      conversation: parameters.reviewConversationId,
      text: t`Review Calendly booking ${unresolvedDeal.bookingUrl}: HubSpot contact ${unresolvedDeal.contactId} has no associated deals or has too many to check safely in one response. No owner was changed.`,
    })

    const boundedDeals = dealMatch.filter(
      ({ dealIds }) => dealIds.length > 0 && dealIds.length < 100,
    )
    const deals = boundedDeals.dealIds.each((dealId) =>
      hubspot.getDeal({
        recordId: dealId,
        properties: ["dealname", "dealstage", "hubspot_owner_id"],
      }),
    )
    const eligibility = deals.transform(boundedDeals, (records, context) => ({
      ...context,
      eligibleDealIds: records
        .filter(
          ({ properties }) =>
            properties.find(({ name }) => name === "dealstage")?.value ===
            parameters.eligibleDealStageId,
        )
        .map(({ id }) => id),
    }))
    const ambiguous = eligibility.filter(
      ({ eligibleDealIds }) => eligibleDealIds.length !== 1,
    )
    slack.sendMessage({
      conversation: parameters.reviewConversationId,
      text: t`Review Calendly booking ${ambiguous.bookingUrl}: ${ambiguous.eligibleDealIds.transform((ids) => ids.length)} associated HubSpot deals are in the configured eligible stage. Exactly one is required; no owner was changed.`,
    })

    const eligible = eligibility.filter(
      ({ eligibleDealIds }) => eligibleDealIds.length === 1,
    )
    hubspot.updateDeal({
      recordId: eligible.eligibleDealIds.transform((ids) => ids[0]!),
      properties: [{ name: "hubspot_owner_id", value: eligible.ownerId }],
    })
  },
)
