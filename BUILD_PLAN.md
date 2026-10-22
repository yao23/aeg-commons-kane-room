# Build plan — pre-event MVP

This project was built before Hack Day. It remains a single local room for Kane CLI questions; Kane integration is reserved for October 24, 2026.

Completed: Node 24/TypeScript/SQLite Web path, guest sessions and private drafts, public preview, replies, conditional experience cards, manual copy and attributed outcome reports. Four local MCP tools share the backend, with draft-by-default writes and explicit one-thread/selected-public-snapshot authorization: 10 minutes, 3 public discussion messages per agent and owner revocation.

Three supplied documentation notes remain independent of user activity, retain NOT_RUN and source provenance, and use idempotent import with user-edit conflict protection. Web and MCP reference queries share matching logic.

The publication pass preserves the visual style, adds example-query and existing-agent entry points, prioritizes references in the empty room, and carries unmatched queries into private drafts before preview. It prepares a public README, reviewed app screenshot, lockfile and local publication checks. Only reviewed source on the independent project's branch may be committed/pushed; no deployment, paid service, external messaging or schedule changes are included. Actual test and integration scopes are in README.

Remaining: Claude Code and remote access are NOT_TESTED; production hosting, accounts/recovery and moderation require separate work. Do not infer real Kane execution, external adoption, validated fixes or successful reuse from synthetic collaboration tests or source documentation.

October 24 only: Kane runner, Kane-specific parsing, executable flows, automated repair and evidence association. No pre-event implementation of these features.


Hosting preparation (local adaptation only): separate APP_MODE, LISTEN_HOST, PORT and public APP_ORIGIN; explicit hosted HTTPS origin, exact trusted-proxy peers and persistent DB_PATH; Secure guest cookies without relaxing Host/Origin. Keep SQLite/schema/data and all grant boundaries. The existing stdio adapter can explicitly use an HTTPS Web backend, retaining TLS verification, redirect refusal, timeout and token privacy. This is not Streamable HTTP MCP or a new model connector.

Validation is limited to targeted local configuration/proxy/TLS simulations followed by existing automated and local-browser regressions. Actual cross-device access and real platform hosting/persistent-volume redeploy are NOT_TESTED. No cloud resources, tunnels, deployment, fees, new login, real model session, Kane run or schedule changes are included. The separately authorized publication pass covers source review, commit and push only. Platform/domain, TLS proxy/network policy, durable disk/backup and operational limits still need a separate decision; README records exact conditions and results.

Actual local result: 10 targeted checks passed; npm test passed 34/34; homepage, reference and two-session Web Chrome regressions passed. Cross-device, real hosting/redeploy and new real-agent/Kane runs remain untested/not run. These are local test results; publishing the source does not establish online access or deploy a service. Native agent sessions against an HTTPS remote backend remain NOT_TESTED.
