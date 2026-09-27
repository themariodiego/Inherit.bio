/**
 * The words for places Inherit does not serve and countries it has paused
 * (`src/lib/legal/service-restrictions.ts`). The request proxy answers a
 * connection from an embargoed place with the first two, before any page
 * renders, so they carry no link or styling.
 */

export const LOCATION_UNAVAILABLE_TITLE = "Inherit is not available here";

export const LOCATION_UNAVAILABLE_BODY =
  "Inherit cannot serve people in this place because of United States sanctions law.";
