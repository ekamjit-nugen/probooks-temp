import { z } from "zod";

import { ValidationFailedError } from "../errors/example-errors";

import { ZodValidationPipe } from "./zod-validation.pipe";

describe("ZodValidationPipe [STD-11]", () => {
  it("returns the parsed value for valid input", () => {
    const pipe = new ZodValidationPipe(z.object({ name: z.string() }));

    const result = pipe.transform({ name: "Ada" });

    expect(result).toEqual({ name: "Ada" });
  });

  it("throws ValidationFailedError with per-field details for invalid input", () => {
    const pipe = new ZodValidationPipe(z.object({ age: z.number().min(0) }));

    let thrown: unknown;
    try {
      pipe.transform({ age: -1 });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ValidationFailedError);
    const err = thrown as ValidationFailedError;
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.httpStatus).toBe(400);
    expect(err.details).toHaveProperty("age");
  });

  it("reports every offending field at once", () => {
    const pipe = new ZodValidationPipe(
      z.object({ name: z.string(), age: z.number() }),
    );

    let thrown: unknown;
    try {
      pipe.transform({});
    } catch (e) {
      thrown = e;
    }

    const details = (thrown as ValidationFailedError).details ?? {};
    expect(Object.keys(details).sort()).toEqual(["age", "name"]);
  });

  it("rejects unexpected fields on a strict schema", () => {
    const pipe = new ZodValidationPipe(z.object({ name: z.string() }).strict());

    expect(() => pipe.transform({ name: "Ada", rogue: true })).toThrow(
      ValidationFailedError,
    );
  });
});
