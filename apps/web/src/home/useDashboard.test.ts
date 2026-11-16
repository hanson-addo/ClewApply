import { describe, expect, it } from "vitest";

import { profileExists } from "./useDashboard";

describe("profileExists", () => {
  it("is true when the profile loaded", () => {
    expect(profileExists({ data: { data: {} }, response: { status: 200 } })).toBe(true);
  });

  it("is false only when the server says there's no profile", () => {
    expect(profileExists({ response: { status: 404 } })).toBe(false);
  });

  it("is unknown on a server error or a dropped connection", () => {
    expect(profileExists({ response: { status: 500 } })).toBeNull();
    expect(profileExists({ response: { status: 401 } })).toBeNull();
    expect(profileExists(null)).toBeNull();
  });
});
