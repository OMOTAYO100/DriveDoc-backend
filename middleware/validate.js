const { validationResult } = require('express-validator');

/**
 * Turn express-validator failures into the same JSON shape every other
 * endpoint returns, so the client only ever has one error format to read.
 */
exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  return res.status(400).json({
    success: false,
    message: errors.array()[0].msg,
    errors: errors.array().map((e) => ({ field: e.path, message: e.msg }))
  });
};
