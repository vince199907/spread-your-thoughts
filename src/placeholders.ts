import { calculateAstrology, type AstrologyInput } from "./astrology_adapter.js";
import { TimeInputError } from "./timezone.js";
import { fail, ok, type Result } from "./result.js";

export function astrologyChart(input: AstrologyInput = {}): Result<ReturnType<typeof calculateAstrology>> {
  try { return ok(calculateAstrology(input)); }
  catch (error) {
    if (error instanceof TimeInputError) return fail(error.code,error.message,error.code==="AMBIGUOUS_LOCAL_TIME"?error.details:undefined);
    return fail("ENGINE_FAILED", "占星计算失败，没有补出替代星盘。");
  }
}
