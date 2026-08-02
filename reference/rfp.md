X402 Facilitator with Bazaar (discovery) support
1. Scope of Work
Build a production ready x402 facilitator for Stellar, running on both testnet and mainnet, shipped under a permissive open source license so it works as a managed hosted provider and as a codebase anyone can fork and self host. Alongside it, build a Stellar native Bazaar discovery layer so agents can find, price, and pay for x402 protected services on Stellar without a pre existing integration.

Three outcomes define success:

A facilitator other teams can rely on, live on stellar:testnet and stellar:pubnet. Both networks are committed deliverables, not one or the other.

A permissive OSI Approved License. The ecosystem must not depend on a single hosted operator.

A working Bazaar for Stellar. This is the highest value part of the RFP and should carry the largest share of the budget.

Respondents should build on the Apache-2.0 @x402/stellar package rather than reimplement verify and settle. Settlement on Stellar is largely solved; the novel work is discovery, the agent facing interface, the upto scheme upstream, and conformance that holds as the spec moves.

Deliverable Categories:

Offchain service components (facilitator verify and settle, discovery catalog and search index, MCP discovery server)

Upstream contribution to the x402 package: Stellar support for the upto payment scheme

Tooling / SDK support (seller helpers for discovery metadata, buyer and agent helpers for querying the Bazaar)

Documentation

Integration examples

Audit readiness

2. Background & Context
x402 turns HTTP 402 into a machine native payment flow: a client requests a resource, the server replies 402 with terms, the client signs a payment authorization and retries, and a facilitator verifies and settles onchain before the resource is returned. The buyer is software, typically an agent paying per request with no account or API key.

Stellar suits this well. A settlement costs about 0.0023 XLM, a fraction of a cent, which is what makes per request micropayments viable when the fee would otherwise exceed the payment. USDC, PYUSD, and other stablecoins are first class assets reachable from Soroban through the Stellar Asset Contract. Settlement uses Soroban's authorization model: the client signs an auth entry permitting a specific contract call, and the facilitator submits it and covers the fee.

Stellar already has working exact settlement in several places, including the Apache-2.0 @x402/stellar package and the free public "Built on Stellar" facilitator. What it does not have is a native Bazaar. The Bazaar is what turns isolated paid endpoints into something an agent can shop: sellers declare machine readable metadata, the facilitator catalogs any resource carrying the discovery extension, and buyers query a catalog and a search endpoint. Several facilitators run their own Bazaar compatible catalogs, so today a Stellar denominated service is only as discoverable as whichever multi-chain facilitator happens to carry it.

Discovery in x402 is still evolving, and that shapes this RFP. The Bazaar extension was formalized in v2 and the discovery conventions are still moving under the x402 Foundation: endpoint shapes, filters, metadata fields, and cataloging behavior have all changed and will change again. This has two consequences. Respondents are being asked to build against a moving target, so conformance and upkeep are graded as heavily as the initial build (see 3.2 and 3.6). And the work is worth doing now rather than waiting, because the item spec is open, any facilitator may run its own index, and the conventions are being set by the implementations that exist while they are still fluid. SDF is a Premier member of the x402 Foundation with a Governing Board seat, so a bidder does not have to chase spec direction or maintainer review alone.

3. Requirements
3.1 Facilitator

Implement x402 verify and settle for Stellar per the current v2 spec and CAIP-2 identifiers, on both stellar : testnet and stellar : pubnet. Build on @x402/stellar, which already supports both networks.

Expose the standard surface: verify, settle, and supported.

Validate Soroban auth entries strictly: correctly signed, authorizing exactly the declared call, asset, amount, and recipient, not replayed, not expired. Support classic keypairs and custom __check_auth accounts.

Support any SEP-41 token, USDC by default, with correct handling of 7 decimal amounts.

Sponsor network fees so the buyer needs only the payment asset and no XLM, and advertise this correctly via extra.areFeesSponsored.

Be non custodial. The facilitator never takes custody and is never the source of funds. Tampering with a payment must fail signature verification.

Testnet must be free and usable without friction. Mainnet pricing is the operator's business decision, but any fee must be configurable rather than hard wired so a self hoster can change or remove it. Document the business model.

Caller authentication, metering, and rate limiting are the respondent's design choice. Document the mechanism and make it configurable.

Package the hosted and self hosted paths so both are straightforward, including self facilitation inside a resource server.

3.2 Bazaar discovery layer

The core new capability. Submissions should reference specific spec behaviors, not just cite the extension.

GET /discovery/resources for paginated catalog browsing, with the spec's type, payTo, network, extensions, limit, and offset filters.

GET /discovery/search taking a natural language query, with cursor pagination and the partialResults flag. Search quality is a deliverable, not a detail: this means real ranking, and submissions must describe both their retrieval approach and how they will evaluate result quality over time. It is the hardest part of the scope and the part existing catalogs most often leave unimplemented.

Automatic cataloging. When the facilitator receives a PaymentPayload carrying the discovery extension, it validates info against the supplied schema and catalogs the resource with no separate registration step. Manual registration may exist as a secondary path only, since anything requiring a seller to act after payment gets skipped.

Catalog both HTTP endpoints and MCP tools. The spec treats MCP tools as a first class resource type, keyed on the tuple of resource.url and input.toolName.

Enforce catalog integrity. The facilitator is a trust boundary: clients echo the resource block into the payment payload, so a hostile client can attempt to poison the catalog with forged service metadata or a crafted routeTemplate. Implement the spec's soft drop validation and validate routeTemplate including percent decoding before traversal checks.

Report cataloging outcomes via the EXTENSION-RESPONSES header, so a seller can tell whether a listing landed and why not.

Track the spec as it changes. The catalog, search, and cataloging behavior must follow the x402 discovery conventions as the Foundation evolves them rather than freezing on the award date. Submissions must say how they will monitor spec changes and ship conformance updates, and commit to doing so through the grant period.

Interoperate with the wider x402 discovery ecosystem. Stellar listings should be representable consistently with how other facilitators represent theirs, so Stellar is not a walled garden.

Seller side helpers so a resource server can declare discovery metadata correctly, including per parameter descriptions that make an endpoint legible to an agent, with minimal boilerplate.

Keep the index off-chain by default. An onchain Soroban registry is an optional stretch, not a baseline: it adds rent that must be extended or entries are evicted, and per payment anchoring adds a second transaction that roughly doubles settlement cost. If proposed, respondents must say who bears that cost and keep it off the per payment hot path.

3.3 Agent facing MCP interface

An MCP discovery server that lets an agent search the Stellar Bazaar and make a paid call from inside an agent runtime, wrapping the discover, pay, retry loop behind MCP tools (for example a resource search tool and a paid call proxy).

Structured, deterministic inputs and outputs, with machine readable error codes. Every rejection carries a non null reason so an agent can reason about failure instead of parsing prose.

3.4 Settlement schemes: exact and upto

exact is already specified for Stellar in scheme_exact_stellar.md and must be supported.

upto (authorize up to a cap, settle actual usage) is the fit for metered services such as token billing. It has EVM and SVM implementation specs but no Stellar one, so this work includes authoring scheme_upto_stellar.md as well as the implementation, contributed upstream so the whole ecosystem benefits. Describe how it composes with Stellar smart account spending policies to keep an agent inside a budget. Respondents must state whether their upto design ships a Soroban contract. SEP-41 allowances alone (approve / transfer_from) cannot enforce the recipient binding and single-settlement guarantees the upto spec requires so a contract-free design must document its weaker trust model explicitly.

Coordinate the upstream contribution through the x402 Technical Steering Committee. SDF's board seat is available to unblock maintainer review.

batch-settlement is named as planned phase two work, not part of this grant, since on Stellar it needs a Soroban escrow contract, a voucher store, double spend prevention, and its own audit. auth-capture is also deferred, as upto covers the metered case. Do not foreclose either.

3.5 Stellar specific considerations

Submissions should show they understand these, not just name them.

Auth entries, not pre signed transactions. The facilitator builds and submits the invocation, and the buyer's wallet must support auth entry signing.

Ledger based expiration. Validity is bounded by signatureExpirationLedger, roughly 12 ledgers or 60 seconds by default, derived from maxTimeoutSeconds.

Trustlines. An account needs a trustline to a SEP-41 asset before it can receive it. Onboarding and examples must account for this. See AHA Labs’ Trustline Onboarder RFP

Soroban resource limits. Verify, settle, and any registry operations must stay within per transaction read, write, instruction, and memory limits.

Throughput. Agent traffic is bursty. Describe how sequence number bottlenecks are avoided under load, for example channel accounts.

TTL. If an onchain registry is included, its entries need a rent and extension strategy. The per request schemes hold no persistent onchain state, so this applies only to an optional registry.

3.6 Non-functional requirements

A Permissive OSI Approved License. Every dependency must be compatible with permissive redistribution and with operating the code as a network service. No AGPL or other strong copyleft in the dependency path: notably the OpenZeppelin Relayer, its x402 plugin, and the relayer SDK are AGPL-3.0-or-later and are out as a base. Confirm dependency licenses and flag anything uncertain.

Conformance is a hard acceptance criterion. Correct settlement plus a non conformant wire format produces an unusable service, so acceptance is tested at the wire level. Reviewers will point stock SDK code at the deliverable rather than read a conformance claim. Acceptance requires an unmodified canonical client completing a payment end to end on both networks, /supported emitting the Stellar extra contract including areFeesSponsored, the spec payload: {transaction} format accepted verbatim, a passing run of the x402 repo's e2e suite for both networks, a published settled transaction hash per network per scheme, and a non null reason on every rejection.

Security. Strict payload verification, a settlement path resistant to replay and front running, and a discovery index that does not let anyone spoof another seller's listing or pricing.

Audit via the Audit Bank. A third party security review before the mainnet production tag, covering the settlement path, auth entry validation, the discovery trust boundary, and any registry contract. For costing: v1 ships no new Soroban contract, so this is a review of an offchain service and its cryptographic validation rather than a full contract audit.

UX. A developer should get from docs to a paid, discoverable endpoint appearing in the Bazaar in well under an hour.

Performance and availability. Discovery queries are fast lookups, verify and settle latency suits interactive agent use, public endpoints target 99 percent or better uptime, with a stated story for degraded settlement or indexing.

Maintenance. State how conformance is maintained after the grant, for example a maintenance commitment or a clean handoff so the community can keep it current.

4. Evaluation Criteria
Technical capability. Demonstrated understanding of the x402 v2 spec, the Bazaar extension, and Soroban's authorization model. Reference specific behaviors (discovery filters, routeTemplate validation, areFeesSponsored, auth entry expiration), not just the protocol.

Discovery design. A concrete design for catalog, search, and automatic cataloging, a real answer on natural language search quality and how it is evaluated, and a credible interoperability story.

Conformance discipline and upkeep. Evidence the team treats wire level conformance as first class, plus a plan to stay current as the discovery conventions evolve. Prior conformance runs, spec contributions, or interop bug reports are strong signals. Drift, not inability, is the failure mode this screens for.

Relevant experience. Payment infrastructure, API gateways or facilitators, agent tooling such as MCP servers, or Soroban contracts. Teams that have shipped against x402 are a strong signal.

Security and audit history. A track record of shipping audited infrastructure and clear threat modeling, given this handles real payments.

Ecosystem alignment. Willingness to build on @x402/stellar, coordinate with SDF and the teams behind existing Stellar facilitator work, contribute upto upstream, and align with wallet teams on auth entry signing.

Ability to deliver within the required timeline, with a coherent plan for how sellers and agents actually adopt this alongside existing Stellar x402 tooling.

5. Expected Deliverables
Open source, permissively licensed, self hostable x402 facilitator for Stellar (verify, settle, supported) on both testnet and mainnet, built on @x402/stellar, packaged as a managed provider that others can also fork or self facilitate.

Stellar Bazaar discovery layer: GET /discovery/resources with the spec's filters, GET /discovery/search with working natural language ranking, and automatic cataloging for both HTTP and MCP resources.

MCP discovery server exposing search and paid call tools to agents.

upto scheme merged upstream into the x402 package with its scheme_upto_stellar.md network spec.

SDK and helper libraries: seller side discovery metadata helpers, buyer and agent side helpers for querying and paying.

Conformance report: e2e results for both networks, settled transaction hashes per network per scheme, and a demonstration of an unmodified canonical client completing a payment.

A role based developer guide modeled on the Algorand x402 developer hub, organized around what the reader is building, with at least a seller path, a buyer and agent path, and an operator path. Each links live testnet examples so a developer can run the flow. Contributed to Stellar Developer Docs.

At least two end to end example integrations, for instance a paid API that becomes discoverable and gets paid by an agent, and an MCP driven agent that discovers and pays with no pre baked integration.

Test suite covering verification, settlement (exact and upto), discovery, and the MCP interface.

Security review report with resolved findings.

Production ready service with an operational runbook and monitoring.

Appendix: References
Specs. Protocol repo and SDKs: https://github.com/x402-foundation/x402. Bazaar extension: specs/extensions/bazaar.md. Schemes: scheme_exact_stellar, upto, and others for context. Facilitator paths: https://docs.x402.org/core-concepts/facilitator.

Build on this. @x402/stellar, Apache-2.0, supports both Stellar networks. stellar/x402-stellar has SDF's tools, examples, and a reference facilitator example.

Do not use. The free Built on Stellar facilitator runs exact on both networks via the OpenZeppelin Relayer x402 plugin. Unusable code base to use or study: AGPL-3.0-or-later, and AGPL's network clause applies to a service serving third parties. See 3.6.

Conformance baseline. The public x402.org facilitator supports stellar:testnet with no API key and correctly returns extra: {areFeesSponsored: true}. Any behavior this RFP requires should be verifiable by pointing the same stock client at both it and the deliverable. Respondents are encouraged to test existing multi-chain facilitators the same way before proposing, since advertised support and reachable support are not the same thing.