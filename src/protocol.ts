import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv, type ValidateFunction } from "ajv";
import { repoRoot } from "./paths.js";
import { fail, type Failure } from "./result.js";

type SchemaName = "evidence"|"input"|"result";
let validators: Record<SchemaName,ValidateFunction> | undefined;
export function validateDocument(kind:SchemaName, value:unknown): Failure | null {
  if (!validators) {
    const ajv = new Ajv({allErrors:false,strict:true});
    const schema = (name:SchemaName) => JSON.parse(readFileSync(join(repoRoot(),"schemas",name+".schema.json"),"utf8"));
    ajv.addSchema(schema("evidence"));
    validators = {evidence:ajv.getSchema("evidence.schema.json")!,input:ajv.compile(schema("input")),result:ajv.compile(schema("result"))};
  }
  const validator=validators[kind];
  if (validator(value)) return null;
  const e=validator.errors?.[0];
  return fail(kind==="result" ? "INVALID_RESULT" : "INVALID_SCHEMA", `协议校验失败：${e?.instancePath || "/"} ${e?.message ?? ""}`.trim());
}
