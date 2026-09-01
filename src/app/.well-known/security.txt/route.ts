const body = `Contact: mailto:security@inherit.bio
Canonical: https://www.inherit.bio/.well-known/security.txt
Policy: https://www.inherit.bio/legal/incident-response
Preferred-Languages: en
Expires: 2027-09-01T00:00:00.000Z
`;

export function GET() {
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
