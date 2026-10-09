import type { Metadata } from "next";

export const metadata: Metadata = { title: "Claim a future-person record" };

export default function FuturePersonClaimPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-section">
      <header className="reading-head">
        <p className="eyebrow">Future Person Charter</p>
        <h1 className="display display-lg">Claim a record created before you were born</h1>
      </header>
      <section className="surface surface-pad mt-section max-w-3xl">
        <h2 className="title">Claims are not open yet</h2>
        <div className="legal-prose mt-4">
          <p>No embryo records can be made on the hosted service without a legal review by a person. While records are blocked, we accept no claim papers or personal details.</p>
          <p>Without the Record Key Card we cannot tell which record is yours, and we will not guess.</p>
        </div>
      </section>
    </div>
  );
}
