const jwt = require('jsonwebtoken');

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  // Check for token in Authorization header first
  let token = null;
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }
  
  // If not in header, check cookies (for page loads)
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    // If this is an API request, return JSON error
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    // For page requests, redirect to home
    return res.redirect('/');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Token expired' });
      }
      res.clearCookie('token');
      return res.redirect('/');
    }
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    res.clearCookie('token');
    return res.redirect('/');
  }
};

// Admin only middleware
const verifyAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    if (req.path.startsWith('/api/')) {
      res.status(403).json({ error: 'Admin access required' });
    } else {
      res.redirect('/');
    }
  }
};

module.exports = { verifyToken, verifyAdmin };