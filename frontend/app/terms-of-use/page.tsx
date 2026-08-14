import type { Metadata } from "next";

import { LegalDocument, LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Terms of Use — openx402",
  description: "The terms that apply when you use the openx402 explorer.",
};

export default function Page() {
  return (
    <LegalShell>
      <LegalDocument title="Terms of Use" updated="14 August 2026">
        <section>
          <h2>Acceptance</h2>
          <p>
            These terms apply to your use of the openx402 website, operated by Ithaca Labs. If you do not agree with
            them, please do not use the site. Your use of the openx402 <em>source code</em> is governed separately by the
            Apache License 2.0, which accompanies the code and is not modified by anything here.
          </p>
        </section>

        <section>
          <h2>What openx402 is</h2>
          <p>
            openx402 is a read-only explorer. It indexes service listings published to the x402 catalog and displays
            settlement activity observed on the Stellar network. It is an informational tool and nothing more.
          </p>
          <p>
            <strong>openx402 is not a payment service.</strong> It does not process payments, hold or transmit funds,
            connect to your wallet, sign transactions, or take custody of private keys. It is not a party to any x402
            transaction you enter into, and it cannot reverse, refund, cancel, or intervene in one.
          </p>
        </section>

        <section>
          <h2>No advice</h2>
          <p>
            Nothing on this site is financial, investment, tax, or legal advice. Information here is provided for
            general reference and may be incomplete, delayed, or wrong. Decisions you make on the basis of it are
            yours alone.
          </p>
        </section>

        <section>
          <h2>Third-party listings</h2>
          <p>
            The services shown in our catalog are operated by independent third parties. We do not create, vet,
            endorse, guarantee, or supervise them, and their appearance here is not a recommendation. We have no control
            over whether a listed service is honest, functional, secure, or lawful in your jurisdiction.
          </p>
          <p>
            <strong>Verify any service independently before sending it money.</strong> Payments made on a public
            blockchain are typically irreversible. Any dealing you have with a listed service is strictly between you
            and that operator.
          </p>
        </section>

        <section>
          <h2>Accuracy and availability</h2>
          <p>
            Catalog and settlement data are drawn from external sources and are presented as observed. We do not
            guarantee that any figure is accurate, current, or complete. The site may be modified, interrupted, or
            discontinued at any time without notice, and we do not promise any level of uptime.
          </p>
        </section>

        <section>
          <h2>Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>use the site for anything unlawful, or to facilitate fraud or money laundering</li>
            <li>attack, probe, overload, or disrupt the site or the infrastructure behind it</li>
            <li>place automated load on the site heavy enough to degrade it for others</li>
            <li>attempt to gain unauthorised access to any system, account, or data</li>
            <li>misrepresent the site, or present its data as an endorsement of any service</li>
          </ul>
        </section>

        <section>
          <h2>Intellectual property</h2>
          <p>
            The openx402 source code is licensed under the Apache License 2.0. The openx402 name, logo, and other brand
            elements are not covered by that licence and remain the property of Ithaca Labs. Third-party names and marks
            shown in listings belong to their respective owners.
          </p>
        </section>

        <section>
          <h2>Disclaimer of warranties</h2>
          <p>
            The site is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any
            kind</strong>, express or implied, including any implied warranties of merchantability, fitness for a
            particular purpose, title, accuracy, or non-infringement. This mirrors the disclaimer in section 7 of the
            Apache License 2.0. Some jurisdictions do not allow certain warranties to be excluded, in which case those
            exclusions may not apply to you.
          </p>
        </section>

        <section>
          <h2>Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, Ithaca Labs and its contributors will not be liable for any
            indirect, incidental, special, exemplary, or consequential damages, nor for lost profits, lost funds, or
            loss of data, arising out of your use of the site or your reliance on anything shown on it — including any
            payment you make to a third-party service you found through it. This reflects section 8 of the Apache
            License 2.0.
          </p>
        </section>

        <section>
          <h2>Changes to these terms</h2>
          <p>
            We may revise these terms as the site develops. The revision date at the top of this page reflects the
            current version, and continuing to use the site after a change means you accept it.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Questions about these terms can go to <a href="mailto:labsithaca@gmail.com">labsithaca@gmail.com</a>. See
            also our <a href="/privacy-policy">Privacy Policy</a>.
          </p>
        </section>
      </LegalDocument>
    </LegalShell>
  );
}
