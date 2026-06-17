/**
 * ZodValidationPipe (STANDARDS §11). Parses body/query/params against a Zod
 * schema. On failure it raises ValidationFailedError (a DomainError) which the
 * DomainExceptionFilter maps to the §7.1 envelope with code VALIDATION_FAILED.
 *
 * Zod ONLY — never class-validator (STANDARDS §11.2, §29).
 */
import { Injectable, type PipeTransform } from "@nestjs/common";
import { type ZodType, type ZodIssue } from "zod";

import { ValidationFailedError } from "../errors/example-errors";

@Injectable()
export class ZodValidationPipe<TOut> implements PipeTransform<unknown, TOut> {
  constructor(private readonly schema: ZodType<TOut>) {}

  transform(value: unknown): TOut {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    throw new ValidationFailedError(toFieldErrors(result.error.issues));
  }
}

/** Flatten Zod issues to a { field: message } map (first message per field wins). */
function toFieldErrors(issues: readonly ZodIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    if (!(key in fields)) {
      fields[key] = issue.message;
    }
  }
  return fields;
}
