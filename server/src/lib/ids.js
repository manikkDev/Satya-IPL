import { ulid } from "ulid";

// Prefixed ULID ids per contract 02 §2 (e.g. newId("doc") -> "doc_01J...").
export const newId = (prefix) => `${prefix}_${ulid().toLowerCase()}`;
export const isId = (value, prefix) => typeof value === "string" && value.startsWith(`${prefix}_`);
