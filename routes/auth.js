const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Make db accessible from server.js
module.exports = (db) => {
  
  // --- SIGNUP ROUTE ---
  router.post('/signup', [
    body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').isEmail().withMessage('Please enter a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ], async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: errors.array()[0].msg 
      });
    }

    const { name, email, password } = req.body;

    try {
      // Check if user already exists
      db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (user) {
          return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert user into database
        db.run(
          `INSERT INTO users (name, email, password, role, created_at) 
           VALUES (?, ?, ?, ?, datetime('now'))`,
          [name, email, hashedPassword, 'user'],
          function(err) {
            if (err) {
              console.error(err);
              return res.status(500).json({ error: 'Failed to create user' });
            }

            // Create JWT token
            const token = jwt.sign(
              { id: this.lastID, email, name, role: 'user' },
              process.env.JWT_SECRET,
              { expiresIn: process.env.JWT_EXPIRE || '7d' }
            );

            res.status(201).json({
              success: true,
              token,
              user: {
                id: this.lastID,
                name,
                email,
                role: 'user'
              }
            });
          }
        );
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // --- LOGIN ROUTE ---
  router.post('/login', [
    body('email').isEmail().withMessage('Please enter a valid email'),
    body('password').notEmpty().withMessage('Password is required')
  ], async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: errors.array()[0].msg 
      });
    }

    const { email, password } = req.body;

    try {
      // Find user by email
      db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (!user) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Create JWT token
        const token = jwt.sign(
          { id: user.id, email: user.email, name: user.name, role: user.role || 'user' },
          process.env.JWT_SECRET,
          { expiresIn: process.env.JWT_EXPIRE || '7d' }
        );

        res.json({
          success: true,
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role || 'user'
          }
        });
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // --- GET CURRENT USER (Protected Route) ---
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

  return router;
};