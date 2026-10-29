export const fail = (status, code, message, details) =>
  Object.assign(new Error(message), { status, code, details });

export const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        error: { code: error.code || "ERROR", message: error.message, details: error.details, requestId: req.id },
      });
    }
    next(error);
  }
};

// Mongo operator-injection guard (04 B12): reject $-keys and dotted keys in
// any user-supplied object, recursively.
export const assertPlainInput = (value) => {
  if (Array.isArray(value)) return value.forEach(assertPlainInput);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (key.startsWith("$") || key.includes(".")) {
        throw fail(422, "VALIDATION_FAILED", `Field "${key}" is not allowed`);
      }
      assertPlainInput(value[key]);
    }
  }
};
