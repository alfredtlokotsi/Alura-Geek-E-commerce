const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

const router = express.Router();

module.exports = (db) => {
  
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
      db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (user) {
          return res.status(400).json({ error: 'Email already registered' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const userRole = (role === 'admin') ? 'admin' : 'user';

        db.run(
          `INSERT INTO users (name, email, password, role, created_at) 
           VALUES (?, ?, ?, ?, datetime('now'))`,
          [name, email, hashedPassword, userRole],
          function(err) {
            if (err) {
              console.error(err);
              return res.status(500).json({ error: 'Failed to create user' });
            }

            const token = jwt.sign(
              { id: this.lastID, email, name, role: userRole },
              process.env.JWT_SECRET,
              { expiresIn: process.env.JWT_EXPIRE || '7d' }
            );

            // Set cookie for page loads
            res.cookie('token', token, {
              httpOnly: false,
              secure: false,
              maxAge: 7 * 24 * 60 * 60 * 1000,
              sameSite: 'lax',
              path: '/'
            });

            res.status(201).json({
              success: true,
              token,
              user: { id: this.lastID, name, email, role: userRole }
            });
          }
        );
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
      db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (!user) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

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
          secure: false,
          maxAge: 7 * 24 * 60 * 60 * 1000,
          sameSite: 'lax',
          path: '/'
        });

        res.json({
          success: true,
          token,
          user: { id: user.id, name: user.name, email: user.email, role: user.role || 'user' }
        });
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // --- GET CURRENT USER ---
  router.get('/me', verifyToken, (req, res) => {
    db.get("SELECT id, name, email, role, created_at FROM users WHERE id = ?", 
      [req.user.id], 
      (err, user) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Database error' });
        }
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
      }
    );
  });

  // --- LOGOUT ---
  router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true, message: 'Logged out successfully' });
  });

  // ============================================================
  // 👑 ADMIN ONLY ROUTES
  // ============================================================

  router.get('/admin/users', verifyToken, verifyAdmin, (req, res) => {
    db.all(
      "SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC",
      (err, users) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ 
          success: true,
          count: users.length,
          users 
        });
      }
    );
  });

  router.get('/admin/users/:id', verifyToken, verifyAdmin, (req, res) => {
    const userId = req.params.id;
    
    db.get(
      "SELECT id, name, email, role, created_at FROM users WHERE id = ?",
      [userId],
      (err, user) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Database error' });
        }
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
      }
    );
  });

  router.put('/admin/users/:id/role', verifyToken, verifyAdmin, [
    body('role').isIn(['user', 'admin']).withMessage('Role must be "user" or "admin"')
  ], (req, res) => {
    const userId = req.params.id;
    const { role } = req.body;

    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    db.run(
      "UPDATE users SET role = ? WHERE id = ?",
      [role, userId],
      function(err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Failed to update user role' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'User not found' });
        }
        res.json({ 
          success: true, 
          message: `User role updated to ${role}` 
        });
      }
    );
  });

  router.delete('/admin/users/:id', verifyToken, verifyAdmin, (req, res) => {
    const userId = req.params.id;

    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    db.run("DELETE FROM users WHERE id = ?", [userId], function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to delete user' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ 
        success: true, 
        message: 'User deleted successfully' 
      });
    });
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
      db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (user) {
          return res.status(400).json({ error: 'Email already registered' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        db.run(
          `INSERT INTO users (name, email, password, role, created_at) 
           VALUES (?, ?, ?, 'admin', datetime('now'))`,
          [name, email, hashedPassword],
          function(err) {
            if (err) {
              console.error(err);
              return res.status(500).json({ error: 'Failed to create admin' });
            }

            res.status(201).json({
              success: true,
              message: 'Admin account created successfully',
              user: { id: this.lastID, name, email, role: 'admin' }
            });
          }
        );
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
};