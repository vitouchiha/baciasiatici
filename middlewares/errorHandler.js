module.exports = (err, req, res, next) => {
  const errorDetails = {
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method,
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  };

  console.error(JSON.stringify(errorDetails));

  res.status(500).json({
    error: 'Service temporarily unavailable',
    retryAfter: 60,
    details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
  });
};
