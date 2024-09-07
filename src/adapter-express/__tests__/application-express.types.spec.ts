import { describe, expect, it } from "vitest";
import { ServerEnvironment } from "../application-express.types";

describe("Server Environment", () => {
  it("should return production", () => {
    expect(ServerEnvironment.Production).toBe("production");
  });

  it("should return development", () => {
    expect(ServerEnvironment.Development).toBe("development");
  });
});
