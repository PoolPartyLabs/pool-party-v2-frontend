/**
 * @id PP-AUTH-SCR-007
 * @name PrivacyPolicy
 * @implements-rules-version v1
 * The Privacy Policy legal page. Counsel-provided English copy (2025-07-10), hardcoded (English-only,
 * no i18n per product decision), rendered in the shared non-copyable, noindex LegalDocument shell.
 */
"use client";

import { LegalDocument } from "./LegalDocument";

const LEGAL_EMAIL = "legal@pool-party.xyz";

/** Full Privacy Policy page (replaces the reserved placeholder at /privacy). */
export function PrivacyPolicy() {
  return (
    <LegalDocument title="Privacy Policy" lastModified="Last modified: July 10, 2025">
      <p>
        This Privacy Policy (the “Policy”) explains how Pool Party collects, uses, and shares data
        in connection with our website, web app, and all of our other properties, products, and
        services (the “Services”). Pool Party is the trading name of ARESTA DIVINAL, UNIPESSOAL, LDA
        (NIPC/NIF 517878240), a company registered in Portugal (“Pool Party”, “we”, “us” or “our”).
        Your use of the Services is subject to this Policy as well as our Terms of Service.
      </p>

      <h2>High Level Summary</h2>
      <ul>
        <li>
          Pool Party provides an interface to a decentralized protocol. We are a company based in
          Portugal.
        </li>
        <li>
          We do not collect and store personal data, such as first name, last name, street address,
          date of birth, email address, or IP address in connection with your use of the core
          Services.
        </li>
        <li>
          We collect non-identifiable data, such as public on-chain data and limited off-chain data
          like device type and browser version. This is to improve our product, not to track
          individual users.
        </li>
        <li>
          <strong>On-Ramp Service:</strong> To use the integrated on-ramp service (provided by a
          third-party), you will need to provide them with personal data for their KYC process. We
          do not receive, process, or store this sensitive data. That process is handled entirely by
          the third-party provider, subject to their own privacy policy.
        </li>
        <li>
          Any material changes to our privacy practices will be reflected in an updated privacy
          policy.
        </li>
      </ul>

      <h2>Data We Collect</h2>
      <p>
        Privacy is central to what we do. We are transparent about the limited data we collect. We
        do not maintain user accounts and do not collect personal data like your name or IP address.
        When you interact with the Services, we may collect:
      </p>
      <ul>
        <li>
          <strong>Publicly-available blockchain data.</strong> When you connect your non-custodial
          wallet to the Services, we collect your publicly-available blockchain address to learn
          more about your use of the Services and to screen your wallet for any prior illicit
          activity, using intelligence from leading blockchain analytics providers.
        </li>
        <li>
          <strong>Information from localStorage and other tracking technologies.</strong> We and our
          third-party service providers use technologies like localStorage and cookies to provide
          and personalize the Services. For example, we may use this to remember tokens you import.
          The information is aggregated and includes things like browser type and operating system,
          helping us improve the user experience.
        </li>
        <li>
          <strong>Information from third-party services.</strong> We may receive information about
          your wallet address from our service providers (like Alchemy) to ensure our services
          function correctly and to comply with our legal obligations.
        </li>
        <li>
          <strong>Correspondence.</strong> We will receive any communications and information you
          provide directly to us via email, social media, or another support channel.
        </li>
        <li>
          <strong>Information you specifically provide us.</strong> If you provide us with
          information (such as an email address for a mailing list), we will use it for the purpose
          described when you provide it. We will not attempt to link this information to your wallet
          address.
        </li>
      </ul>

      <h2>How We Use Data</h2>
      <p>We use the data we collect for the following purposes:</p>
      <ul>
        <li>
          <strong>Providing the Services.</strong> To provide, maintain, customize, and improve our
          Services.
        </li>
        <li>
          <strong>Safety and security.</strong> To protect against, investigate, and stop
          fraudulent, unauthorized, or illegal activity.
        </li>
        <li>
          <strong>Legal compliance.</strong> As needed to comply with applicable laws and
          regulations.
        </li>
        <li>
          <strong>Aggregated data.</strong> To compile aggregated data that helps us learn how users
          use the Services and where we can improve your experience.
        </li>
      </ul>

      <h2>How We Share Data</h2>
      <p>We may share or disclose the data we collect:</p>
      <ul>
        <li>
          <strong>With service providers.</strong> We share information with service providers and
          vendors to assist us in providing the Services. For example, we may share your wallet
          address with blockchain infrastructure providers (like Alchemy) or data providers (like
          CoinGecko) to provide technical services, and with blockchain analytics providers to
          detect and prevent illicit activities.
        </li>
        <li>
          <strong>To comply with our legal obligations.</strong> We may share your data in the
          course of litigation, regulatory proceedings, or when compelled by a court order or other
          legal procedure.
        </li>
        <li>
          <strong>With your consent.</strong> We may share your information any other time you
          provide us with your consent to do so.
        </li>
      </ul>
      <p>
        We do not share your information with any third parties for any marketing purposes
        whatsoever.
      </p>

      <h2>Third-Party Links and On-Ramp Services</h2>
      <p>
        The Services may include links to websites and services not operated by us. More
        importantly, we integrate an on-ramp service operated by a third party to allow you to
        purchase crypto assets.
      </p>
      <p>
        When you choose to use this on-ramp service, you are interacting directly with that third
        party, not Pool Party. That party will independently collect personal and sensitive
        information from you to conduct their required Know-Your-Customer (KYC) checks. Their
        collection, use, and sharing of your data are governed by their own privacy policies and
        terms. Pool Party does not receive, process, or have access to any of the personal data or
        documents you provide during the on-ramp process. We are not responsible for the privacy
        practices of these third parties.
      </p>

      <h2>Security</h2>
      <p>
        We implement reasonable technical and administrative security safeguards to help protect the
        data we collect. However, no internet transmission is completely secure. You are responsible
        for the security of your own blockchain wallet and private keys.
      </p>

      <h2>Age Requirements</h2>
      <p>
        Our Services are not intended for individuals under the age of 18. We do not knowingly
        collect personal information from children.
      </p>

      <h2>Your Data Protection Rights (GDPR)</h2>
      <p>
        We process personal data for the purposes described above. Our legal bases for processing
        your data include: (i) your consent, (ii) necessity for the performance of a contract with
        you, (iii) compliance with a legal obligation, and/or (iv) our legitimate interests,
        provided they do not override your fundamental rights. Under the General Data Protection
        Regulation (“GDPR”), you have certain rights, including:
      </p>
      <ul>
        <li>The right to request access to and obtain a copy of your personal data.</li>
        <li>The right to request rectification or erasure of your personal data.</li>
        <li>The right to object to or restrict the processing of your personal data.</li>
        <li>The right to data portability.</li>
      </ul>
      <p>
        Please note that we cannot edit or delete information that is stored on a public blockchain,
        as this data is outside our control. To exercise any of your rights under the GDPR, please
        contact us at <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>.
      </p>

      <h2>Changes to this Policy</h2>
      <p>
        If we make material changes to this Policy, we will notify you through the Services or by
        updating the date at the top of this page. Your continued use of the Services indicates your
        consent to the current Policy.
      </p>

      <h2>Contact Us</h2>
      <p>
        If you have any questions about this Policy or our data practices, please contact us at{" "}
        <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>.
      </p>
    </LegalDocument>
  );
}
