// Unit and API tests run on the newest AIRAC cycle shipped, whatever today's date: their expectations are
// written against it when it is loaded, and must not change on its effective date. Production, and the e2e
// tests (server and browser on the same clock), take the cycle in effect today (src/shared/ref.ts airacDay).
process.env.PGF_AIRAC_DATE ??= '9999-12-31';
