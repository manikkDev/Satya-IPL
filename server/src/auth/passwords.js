import bcrypt from "bcrypt";

// v2 password policy (04 P1-B2): >=10 chars, not in the common list, bcrypt 12.
const COMMON = new Set([
  "password", "password1", "password123", "1234567890", "qwerty12345",
  "letmein1234", "satya-demo", "iloveyou12", "admin12345", "welcome123",
]);

export const passwordIssues = (password) => {
  const issues = [];
  if (typeof password !== "string") return ["Password is required"];
  if (password.length < 10) issues.push("Use at least 10 characters");
  if (password.length > 128) issues.push("Use at most 128 characters");
  if (COMMON.has(password.toLowerCase())) issues.push("That password is too common — pick a stronger one");
  return issues;
};

export const hashPassword = (password) => bcrypt.hash(password, 12);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);
