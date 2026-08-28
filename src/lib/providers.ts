// Provider directory domain logic. Location input is country + (US) state
// dropdowns only — no street addresses are collected, stored, or sent
// anywhere; filtering happens entirely client-side.

export interface ProviderProduct {
  name: string;
  depth: string;
  price: string;
  formats_returned?: string[];
  turnaround?: string;
  notes?: string;
}

export interface ProviderShipping {
  mode: "worldwide" | "list";
  countries?: string[];
  excluded?: string[];
  note?: string;
}

export interface Provider {
  slug: string;
  name: string;
  website: string;
  checkout_url: string;
  privacy_policy_url: string | null;
  data_practices_note: string | null;
  products: ProviderProduct[];
  raw_formats: string[];
  ships_to: string;
  us_state_exclusions: string[];
  us_state_exclusion_notes?: string[];
  turnaround: string | null;
  gating: string | null;
  affiliate: boolean;
  source_urls: string[];
  last_verified_at: string;
  shipping: ProviderShipping;
}

export const EU_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
];

export const COUNTRIES: { code: string; name: string }[] = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },
  { code: "AT", name: "Austria" },
  { code: "CH", name: "Switzerland" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "IE", name: "Ireland" },
  { code: "PT", name: "Portugal" },
  { code: "PL", name: "Poland" },
  { code: "CZ", name: "Czech Republic" },
  { code: "GR", name: "Greece" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "SG", name: "Singapore" },
  { code: "HK", name: "Hong Kong" },
  { code: "IN", name: "India" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "IL", name: "Israel" },
  { code: "ZA", name: "South Africa" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" },
];

export const US_STATES: { code: string; name: string }[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"],
  ["DE", "Delaware"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"],
  ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"],
  ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
  ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"],
  ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
  ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"], ["DC", "District of Columbia"],
].map(([code, name]) => ({ code, name }));

export type Availability =
  | { available: true; stateFlag?: string }
  | { available: false; reason: string };

export function availabilityFor(
  p: Provider,
  country: string,
  usState?: string,
): Availability {
  const ship = p.shipping;
  let inCountry: boolean;
  if (ship.mode === "worldwide") {
    inCountry = !(ship.excluded ?? []).includes(country);
  } else {
    const list = (ship.countries ?? []).flatMap((c) =>
      c === "EU" ? EU_COUNTRIES : [c],
    );
    inCountry =
      list.includes(country) && !(ship.excluded ?? []).includes(country);
  }
  if (!inCountry) {
    return {
      available: false,
      reason: `Does not currently serve ${COUNTRIES.find((c) => c.code === country)?.name ?? country}`,
    };
  }
  if (country === "US" && usState && p.us_state_exclusions.includes(usState)) {
    const note = p.us_state_exclusion_notes?.find((n) =>
      n.startsWith(usState),
    );
    return {
      available: true,
      stateFlag:
        note ??
        `${usState}: this provider restricts some or all products in your state`,
    };
  }
  return { available: true };
}
