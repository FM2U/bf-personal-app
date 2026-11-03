import { describe, expect, it } from "vitest";
import { SIGN_IN_MESSAGES, signInErrorMessage } from "./auth-errors";

describe("signInErrorMessage", () => {
  it("names an unconfirmed email by its code or its message", () => {
    expect(signInErrorMessage({ code: "email_not_confirmed", status: 400, message: "Email not confirmed" })).toBe(SIGN_IN_MESSAGES.notConfirmed);
    expect(signInErrorMessage({ status: 400, message: "Email not confirmed" })).toBe(SIGN_IN_MESSAGES.notConfirmed);
    expect(SIGN_IN_MESSAGES.notConfirmed).toBe("Your email is not confirmed yet. Open the confirmation email from Supabase, then sign in.");
  });
  it("keeps the wrong-password message", () => {
    expect(signInErrorMessage({ code: "invalid_credentials", status: 400, message: "Invalid login credentials" })).toBe("Email or password is not correct.");
    expect(signInErrorMessage({ status: 400, message: "Invalid login credentials" })).toBe("Email or password is not correct.");
  });
  it("gives a plain message for rate limits", () => {
    expect(signInErrorMessage({ code: "over_request_rate_limit", status: 429, message: "Request rate limit reached" })).toBe(SIGN_IN_MESSAGES.tooMany);
    expect(signInErrorMessage({ status: 429, message: "" })).toBe(SIGN_IN_MESSAGES.tooMany);
    expect(signInErrorMessage({ message: "For security purposes, you can only request this after 30 seconds." })).toBe(SIGN_IN_MESSAGES.tooMany);
  });
  it("gives one plain message for anything else", () => {
    expect(signInErrorMessage({ status: 500, message: "Database error querying schema" })).toBe(SIGN_IN_MESSAGES.other);
    expect(signInErrorMessage(null)).toBe(SIGN_IN_MESSAGES.other);
  });
});
