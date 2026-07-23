/**
 * @id PP-PROF-LIB-006 (POO-233 R4, POO-426, POO-232)
 * @name buildProfileWriteBody tests
 * @implements-rules-version v1
 *
 * Pins the write field map (POO-232 + POO-675 + POO-693): the FE editable subset
 * (name/displayName/email/country/phone) → the backend PATCH body (name/displayName/email/country/phone).
 * POO-693: the PRIVATE `name` and the PUBLIC `displayName` are now distinct fields, each forwarded
 * verbatim. `country`/`phone` are forwarded (POO-675 columns), and a blank value is SENT as "" (the
 * backend clears it to null), no longer omitted. An undefined key (not edited) is never sent.
 */
import { describe, expect, it } from "vitest";
import { buildProfileWriteBody } from "./buildProfileWriteBody";

describe("buildProfileWriteBody", () => {
  // @rule POO-693 (name -> name, displayName -> displayName, email -> email, country -> country, phone -> phone)
  it("maps the full editable set to the PATCH body", () => {
    expect(
      buildProfileWriteBody({
        name: "Ana Private",
        displayName: "Ana Public",
        email: "a@b.com",
        country: "Brazil",
        phone: "+55 11 90000-0000",
      }),
    ).toEqual({
      name: "Ana Private",
      displayName: "Ana Public",
      email: "a@b.com",
      country: "Brazil",
      phone: "+55 11 90000-0000",
    });
  });

  // @rule POO-693 (the PRIVATE name and the PUBLIC displayName are distinct backend fields)
  it("maps the private name and the public displayName to separate body fields", () => {
    expect(buildProfileWriteBody({ name: "Priv" })).toEqual({ name: "Priv" });
    expect(buildProfileWriteBody({ displayName: "Pub" })).toEqual({ displayName: "Pub" });
    expect(buildProfileWriteBody({ name: "Priv", displayName: "Pub" })).toEqual({
      name: "Priv",
      displayName: "Pub",
    });
  });

  // @rule POO-675 (country + phone are forwarded — the POO-675 columns; no longer dropped)
  it("forwards country and phone", () => {
    expect(buildProfileWriteBody({ country: "Brazil", phone: "+1 555 0100" })).toEqual({
      country: "Brazil",
      phone: "+1 555 0100",
    });
  });

  // @rule POO-675 (a blank email/country/phone is a clear → sent as "", not omitted)
  it("sends a blank email/country/phone as '' (clear)", () => {
    expect(buildProfileWriteBody({ name: "Ana", email: "", country: "", phone: "" })).toEqual({
      name: "Ana",
      email: "",
      country: "",
      phone: "",
    });
  });

  // @rule POO-693 (the private name may be cleared to "" — sent, not omitted)
  it("forwards an empty private name (a valid clear)", () => {
    expect(buildProfileWriteBody({ name: "" })).toEqual({ name: "" });
  });

  // @rule POO-232/POO-693 (the public displayName may be cleared to "" — @IsString allows it)
  it("forwards an empty displayName (a valid clear)", () => {
    expect(buildProfileWriteBody({ displayName: "" })).toEqual({ displayName: "" });
  });

  // @rule POO-675 (an undefined key = not edited → never sent; an empty patch is a no-op)
  it("omits fields that were not provided", () => {
    expect(buildProfileWriteBody({ email: "a@b.com" })).toEqual({ email: "a@b.com" });
    expect(buildProfileWriteBody({})).toEqual({});
  });

  // @rule POO-580 (forward a trusted https avatar URL from the media mint)
  it("forwards an https avatarUrl", () => {
    expect(
      buildProfileWriteBody({ avatarUrl: "https://cdn.pool-party.xyz/avatars/0xw.png?v=1" }),
    ).toEqual({ avatarUrl: "https://cdn.pool-party.xyz/avatars/0xw.png?v=1" });
  });

  // @rule POO-580 (backend @IsUrl requires https → a failed-upload data: preview is never persisted)
  it("drops a data: avatarUrl (a failed-upload local preview)", () => {
    const body = buildProfileWriteBody({ name: "Ana", avatarUrl: "data:image/png;base64,AAAA" });
    expect(body).not.toHaveProperty("avatarUrl");
    expect(body).toEqual({ name: "Ana" });
  });

  // @rule POO-580 (any non-https / blank avatarUrl is a no-op, never a 400-inducing wire value)
  it("drops a non-https or blank avatarUrl", () => {
    expect(buildProfileWriteBody({ avatarUrl: "http://cdn/x.png" })).not.toHaveProperty(
      "avatarUrl",
    );
    expect(buildProfileWriteBody({ avatarUrl: "" })).not.toHaveProperty("avatarUrl");
  });
});
