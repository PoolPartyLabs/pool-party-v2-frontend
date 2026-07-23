/**
 * @id PP-AUTH-SCR-008
 * @name TermsOfService
 * @implements-rules-version v1
 * The Terms of Service legal page. Counsel-provided English copy (2025-07-10), hardcoded (English-only,
 * no i18n per product decision), rendered in the shared non-copyable, noindex LegalDocument shell.
 */
"use client";

import { LegalDocument } from "./LegalDocument";

const LEGAL_EMAIL = "legal@pool-party.xyz";

/** Full Terms of Service page (replaces the reserved placeholder at /terms). */
export function TermsOfService() {
  return (
    <LegalDocument title="Terms of Service" lastModified="Last modified: July 10, 2025">
      <p>
        These Terms of Service (the “Agreement”) explain the terms and conditions by which you may
        access and use the Products provided by Pool Party. Pool Party is the trading name of ARESTA
        DIVINAL, UNIPESSOAL, LDA (NIPC/NIF 517878240), a company registered in Portugal (hereinafter
        referred to as “Pool Party,” “we,” “our,” or “us”).
      </p>
      <p>
        Our primary Product is a website-hosted user interface (the “Interface”), which allows
        access to a decentralized protocol. You must read this Agreement carefully. By accessing or
        using our Interface, you signify that you have read, understood, and agree to be bound by
        this Agreement in its entirety. If you do not agree, you are not authorized to access or use
        our Interface.
      </p>
      <p>
        <strong>Eligibility:</strong> To use our Interface, you must be legally able to enter into a
        binding contract with us. You represent that you are at least the age of majority in your
        jurisdiction and have the full right, power, and authority to enter into and comply with
        this Agreement. You also represent that you are not the subject of economic sanctions and
        that your use of the Interface will comply with all applicable laws.
      </p>
      <p>
        <strong>NOTICE:</strong> This Agreement contains important information, including
        disclaimers of warranties and limitations of liability that affect your rights.
      </p>

      <h2>1. Our Products and Third-Party Services</h2>
      <h3>1.1. The Interface</h3>
      <p>
        The Interface provides a web-based means of access to a decentralized finance protocol (the
        “Protocol”), which allows users to trade and interact with digital assets. The Interface is
        distinct from the Protocol. The Interface is only one means of accessing the Protocol. The
        Protocol itself is comprised of open-source smart contracts deployed on a public blockchain.
        Our company does not control or operate the Protocol. By using the Interface, you understand
        that you are not buying or selling digital assets from us, and that we do not operate any
        liquidity pools on the Protocol. Transaction fees paid by traders accrue to liquidity
        providers for the Protocol, who are independent third parties.
      </p>
      <h3>1.2. Third-Party Services</h3>
      <p>
        To provide data and functionality, our Interface integrates third-party services, including
        but not limited to Alchemy (for blockchain infrastructure) and CoinGecko (for asset price
        data). We do not control and are not responsible for the accuracy, security, or operation of
        these services.
      </p>
      <h3>1.3. On-Ramp Service (Paybis)</h3>
      <p>
        To facilitate the user’s acquisition of digital assets, we have integrated an “on-ramp”
        service provided by Paybis (a “Third-Party Service”) into our Interface. This service is
        accessible through our Interface but is operated entirely by Paybis.
      </p>
      <p>
        Paybis, and not Pool Party, is solely responsible for all aspects of its service, including
        payment processing, the collection and security of your personal data, identity verification
        (KYC/AML), and regulatory compliance. By using the Paybis service, you will be subject to
        the Paybis terms of service and privacy policy. Pool Party is not a party to that agreement
        and will have no liability arising from your use of the Paybis service.
      </p>

      <h2>2. Modifications</h2>
      <p>
        We reserve the right, in our sole discretion, to modify this Agreement. If we make changes,
        we will notify you by updating the date at the top of the Agreement. Your continued use of
        the Interface after the modifications will serve as your confirmation of your acceptance.
      </p>

      <h2>3. Intellectual Property Rights</h2>
      <p>
        We own all intellectual property rights in our Interface and its content. We grant you a
        limited, revocable, non-exclusive license to access and use our Interface solely in
        accordance with this Agreement. By using the Interface, you grant us a worldwide,
        royalty-free license to use any content or feedback you provide for our business purposes.
      </p>

      <h2>4. Your Responsibilities</h2>
      <h3>4.1. Prohibited Activity</h3>
      <p>
        You agree not to engage in activities such as intellectual property infringement,
        cyberattacks, fraud, market manipulation, or any other unlawful conduct.
      </p>
      <h3>4.2. Non-Custodial and No Fiduciary Duties</h3>
      <p>
        The Interface is a purely non-custodial application. We never have custody or control of
        your digital assets. You are solely responsible for the custody of your private keys. This
        Agreement does not create or impose any fiduciary duties on us.
      </p>
      <h3>4.3. Compliance and Tax Obligations</h3>
      <p>
        You are solely responsible for complying with all applicable laws, including determining and
        paying any taxes arising from your transactions.
      </p>
      <h3>4.4. Gas Fees</h3>
      <p>
        You will be solely responsible for paying the “Gas Fees” for any transaction you initiate
        via our Interface.
      </p>
      <h3>4.5. Release of Claims</h3>
      <p>
        You expressly agree that you assume all risks in connection with your use of the Interface
        and release us from any and all liability or damages arising from such use.
      </p>

      <h2>5. Disclaimers</h2>
      <h3>5.1. Assumption of Risk</h3>
      <p>
        BY USING OUR INTERFACE, YOU REPRESENT THAT YOU UNDERSTAND THE INHERENT RISKS ASSOCIATED WITH
        CRYPTOGRAPHIC AND BLOCKCHAIN-BASED SYSTEMS, including the high volatility of markets, the
        possibility of fraudulent tokens, the irreversibility of transactions, and the risk of value
        loss when providing liquidity (“impermanent loss”). YOU ACKNOWLEDGE THAT WE ARE NOT
        RESPONSIBLE FOR THESE RISKS, DO NOT CONTROL THE PROTOCOL, AND YOU AGREE TO ASSUME FULL
        RESPONSIBILITY.
      </p>
      <h3>5.2. No Warranties</h3>
      <p>
        OUR INTERFACE IS PROVIDED ON AN “AS IS” AND “AS AVAILABLE” BASIS. TO THE FULLEST EXTENT
        PERMITTED BY LAW, WE DISCLAIM ANY WARRANTIES OF ANY KIND. YOUR USE OF THE INTERFACE IS AT
        YOUR OWN RISK.
      </p>
      <h3>5.3. No Investment Advice</h3>
      <p>
        Any information on the Interface is for informational purposes only and should not be
        construed as investment advice. You are solely responsible for your investment decisions.
      </p>

      <h2>6. Indemnification</h2>
      <p>
        You agree to hold harmless, defend, and indemnify Pool Party from and against all claims,
        damages, and expenses (including reasonable attorneys’ fees) arising from your access and
        use of the Interface or your violation of this Agreement.
      </p>

      <h2>7. Limitation of Liability</h2>
      <p>
        UNDER NO CIRCUMSTANCES SHALL POOL PARTY BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
        CONSEQUENTIAL, OR EXEMPLARY DAMAGES. OUR TOTAL LIABILITY TO YOU FOR ALL DAMAGES SHALL NOT
        EXCEED THE AMOUNT OF ONE HUNDRED U.S. DOLLARS ($100.00 USD). THIS LIMITATION APPLIES EVEN IF
        WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
      </p>

      <h2>8. Governing Law and Dispute Resolution</h2>
      <h3>8.1. Governing Law</h3>
      <p>
        You agree that the laws of England and Wales, without regard to principles of conflict of
        laws, will govern this Agreement and any dispute between us and you.
      </p>
      <h3>8.2. Dispute Resolution</h3>
      <p>
        Any claim or controversy (“Dispute”) shall be resolved through informal, good-faith
        negotiations. If a Dispute is not resolved informally within sixty (60) days after you
        contact us at <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>, you and we agree that the
        Dispute shall be resolved exclusively in the courts of England and Wales.
      </p>
      <h3>8.3. Class Action Waiver</h3>
      <p>
        You must bring any and all Disputes against us in your individual capacity and not as a
        plaintiff or class member in any purported class action or other representative proceeding.
      </p>

      <h2>9. Miscellaneous</h2>
      <h3>9.1. Entire Agreement</h3>
      <p>These terms constitute the entire agreement between you and us.</p>
      <h3>9.2. Assignment</h3>
      <p>
        You may not assign or transfer this Agreement without our prior written consent. We may
        freely assign or transfer this Agreement.
      </p>
      <h3>9.3. Severability</h3>
      <p>
        If any provision of this Agreement is determined to be invalid or unenforceable, the
        remaining provisions shall remain in full force and effect.
      </p>
      <h3>9.4. Notices</h3>
      <p>
        We may provide any notice to you under this Agreement using commercially reasonable means.
        To contact us, please email <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>.
      </p>
    </LegalDocument>
  );
}
