const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

const router = express.Router();

module.exports = (pool) => {
  
  // --- SIGNUP ---
  router.post('/signup', [
    body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').isEmail().withMessage('Please enter a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { name, email, password, role = 'user' } = req.body;

    try {
      // Check if user exists
      const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const userRole = (role === 'admin') ? 'admin' : 'user';

      const result = await pool.query(
        `INSERT INTO users (name, email, password, role, created_at) 
         VALUES ($1, $2, $3, $4, NOW()) RETURNING id, name, email, role`,
        [name, email, hashedPassword, userRole]
      );

      const user = result.rows[0];

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE || '7d' }
      );

      // Set cookie for page loads
      res.cookie('token', token, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        path: '/'
      });

      res.status(201).json({
        success: true,
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // --- LOGIN ---
  router.post('/login', [
    body('email').isEmail().withMessage('Please enter a valid email'),
    body('password').notEmpty().withMessage('Password is required')
  ], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email, password } = req.body;

    try {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = result.rows[0];
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role || 'user' },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE || '7d' }
      );

      // Set cookie for page loads
      res.cookie('token', token, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        path: '/'
      });

      res.json({
        success: true,
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role || 'user' }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // --- GET CURRENT USER ---
  router.get('/me', verifyToken, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
        [req.user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ user: result.rows[0] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // --- LOGOUT ---
  router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true, message: 'Logged out successfully' });
  });

  // ============================================================
  // ADMIN ONLY ROUTES
  // ============================================================

  router.get('/admin/users', verifyToken, verifyAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC'
      );
      res.json({ success: true, count: result.rows.length, users: result.rows });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.get('/admin/users/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
        [req.params.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ user: result.rows[0] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.put('/admin/users/:id/role', verifyToken, verifyAdmin, [
    body('role').isIn(['user', 'admin']).withMessage('Role must be "user" or "admin"')
  ], async (req, res) => {
    const userId = req.params.id;
    const { role } = req.body;

    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    try {
      const result = await pool.query(
        'UPDATE users SET role = $1 WHERE id = $2 RETURNING id',
        [role, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ success: true, message: `User role updated to ${role}` });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.delete('/admin/users/:id', verifyToken, verifyAdmin, async (req, res) => {
    const userId = req.params.id;

    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    try {
      const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.post('/admin/create', verifyToken, verifyAdmin, [
    body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').isEmail().withMessage('Please enter a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { name, email, password } = req.body;

    try {
      const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const result = await pool.query(
        `INSERT INTO users (name, email, password, role, created_at) 
         VALUES ($1, $2, $3, 'admin', NOW()) RETURNING id, name, email, role`,
        [name, email, hashedPassword]
      );

      res.status(201).json({
        success: true,
        message: 'Admin account created successfully',
        user: result.rows[0]
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
};