import jwt from 'jsonwebtoken';

// Middleware to verify JWT token
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret', (err, decoded) => {
    if (err) {
      console.error('[AUTH MIDDLEWARE] Token verification error:', {
        name: err.name,
        message: err.message,
        expiredAt: err.expiredAt,
        jwtSecretSet: !!process.env.JWT_SECRET
      });
      
      let errorMessage = 'Invalid or expired token';
      if (err.name === 'TokenExpiredError') {
        errorMessage = 'Token expired';
      } else if (err.name === 'JsonWebTokenError') {
        errorMessage = `Invalid token: ${err.message}`;
      }
      
      return res.status(403).json({ error: errorMessage });
    }
    req.user = decoded; // Store full user object for admin checks
    req.userId = decoded.userId;
    next();
  });
};
