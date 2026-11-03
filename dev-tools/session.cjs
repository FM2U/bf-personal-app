// LOCAL TESTING ONLY: the signed-in owner's fake session cookie for the local mock (shared by the check scripts).
const OWNER = process.env.OWNER_ID || "00000000-0000-0000-0000-000000000001";
const EMAIL = process.env.OWNER_EMAIL || "owner@example.com";
function fakeJwt(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256", typ: "JWT" })}.${b(payload)}.${Buffer.from("local-test-signature").toString("base64url")}`;
}
const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
const user = { id: OWNER, aud: "authenticated", role: "authenticated", email: EMAIL, app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
const session = { access_token: fakeJwt({ sub: OWNER, email: EMAIL, role: "authenticated", aal: "aal2", amr: [{ method: "totp", timestamp: 1 }], exp, aud: "authenticated" }), refresh_token: "local-refresh", expires_in: 3600 * 24 * 30, expires_at: exp, token_type: "bearer", user };
const cookieValue = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
module.exports = { OWNER, EMAIL, cookie: { name: "sb-localhost-auth-token", value: cookieValue, domain: "localhost", path: "/" } };
