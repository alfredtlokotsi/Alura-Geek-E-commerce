const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');

// Import middleware
const { verifyToken, verifyAdmin } = require('./middleware/auth');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Database Setup ---
const db = new sqlite3.Database(path.join(__dirname, 'database', 'store.db'));

db.serialize(() => {
  // --- USERS TABLE ---
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // --- PRODUCTS TABLE ---
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      image_url TEXT,
      category TEXT,
      stock INTEGER DEFAULT 10,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // --- ORDERS TABLE ---
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      product_id INTEGER,
      product_name TEXT,
      amount REAL,
      customer_email TEXT,
      payment_link TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  // Insert default admin user if no users exist
  db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return;
    }
    if (row.count === 0) {
      // We'll use a default admin account
      // Password: admin123 (hashed)
      const bcrypt = require('bcryptjs');
      const hashedPassword = bcrypt.hashSync('admin123', 10);
      
      db.run(
        `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
        ['Admin', 'admin@exploreessence.com', hashedPassword, 'admin'],
        function(err) {
          if (err) {
            console.error('Failed to create admin user:', err);
          } else {
            console.log('✅ Default admin user created: admin@exploreessence.com / admin123');
          }
        }
      );
    }
  });

  // Insert sample products if empty
  db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return;
    }
    if (row.count === 0) {
      const sampleProducts = [
        { name: 'Golden Aura Mug', description: 'Premium ceramic mug with subtle gold glaze. Perfect for morning rituals.', price: 18.99, image: 'golden-mug.jpg', category: 'NewProduct' },
        { name: 'Minimalist Tumbler', description: 'Double-walled stainless steel. Keeps drinks hot for 6 hours.', price: 29.99, image: 'tumbler.jpg', category: 'NewProduct' },
        { name: 'Essence Pour-Over', description: 'Handcrafted ceramic pour-over dripper for the perfect cup.', price: 34.50, image: 'pour-over.jpg', category: 'Various' },
        { name: 'Sage Tea Cup', description: 'Calming sage green cup with smooth matte finish.', price: 14.25, image: 'sage-cup.jpg', category: 'Various' }
      ];
      const stmt = db.prepare("INSERT INTO products (name, description, price, image_url, category) VALUES (?, ?, ?, ?, ?)");
      sampleProducts.forEach(p => stmt.run(p.name, p.description, p.price, p.image, p.category));
      stmt.finalize();
      console.log('✅ Sample products inserted for Explore Essence.');
    }
  });
});

// --- Import Routes ---
const authRoutes = require('./routes/auth')(db);

// --- Use Routes ---
app.use('/api/auth', authRoutes);

// --- View Engine ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Web Routes ---
app.get('/', (req, res) => {
  db.all("SELECT * FROM products ORDER BY created_at DESC", (err, products) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error');
    }
    res.render('pages/index', { title: 'Explore Essence', products });
  });
});

app.get('/products', (req, res) => {
  db.all("SELECT * FROM products ORDER BY created_at DESC", (err, products) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error');
    }
    res.render('pages/products', { title: 'Shop All', products });
  });
});

app.get('/about', (req, res) => {
  res.render('pages/about', { title: 'About Explore Essence' });
});

app.get('/product/:id', (req, res) => {
  db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
    if (err || !product) {
      return res.status(404).send('Product not found');
    }
    res.render('pages/product', { title: product.name, product });
  });
});

app.get('/checkout/:productId', (req, res) => {
  db.get("SELECT * FROM products WHERE id = ?", [req.params.productId], (err, product) => {
    if (err || !product) {
      return res.status(404).send('Product not found');
    }
    res.render('pages/checkout', { title: 'Checkout', product });
  });
});

// --- PUBLIC API ROUTES ---

// GET all products (public)
app.get('/api/products', (req, res) => {
  db.all("SELECT * FROM products ORDER BY created_at DESC", (err, products) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(products);
  });
});

// GET single product (public)
app.get('/api/products/:id', (req, res) => {
  db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
    if (err || !product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
  });
});

// GET products by category (public)
app.get('/api/products/category/:category', (req, res) => {
  db.all("SELECT * FROM products WHERE category = ? ORDER BY created_at DESC", [req.params.category], (err, products) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(products);
  });
});

// --- PROTECTED API ROUTES (require authentication) ---

// POST - Add new product (Admin only)
app.post('/api/products', verifyToken, verifyAdmin, (req, res) => {
  const { name, description, price, image_url, category, stock = 10 } = req.body;
  
  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  db.run(
    `INSERT INTO products (name, description, price, image_url, category, stock) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, description, price, image_url, category, stock],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to create product' });
      }
      res.status(201).json({ 
        id: this.lastID, 
        name, 
        description, 
        price, 
        image_url, 
        category, 
        stock 
      });
    }
  );
});

// PUT - Update product (Admin only)
app.put('/api/products/:id', verifyToken, verifyAdmin, (req, res) => {
  const { name, description, price, image_url, category, stock } = req.body;
  const id = req.params.id;

  db.run(
    `UPDATE products SET 
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      price = COALESCE(?, price),
      image_url = COALESCE(?, image_url),
      category = COALESCE(?, category),
      stock = COALESCE(?, stock)
     WHERE id = ?`,
    [name, description, price, image_url, category, stock, id],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to update product' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }
      res.json({ message: 'Product updated successfully' });
    }
  );
});

// DELETE - Remove product (Admin only)
app.delete('/api/products/:id', verifyToken, verifyAdmin, (req, res) => {
  const id = req.params.id;

  db.run(`DELETE FROM products WHERE id = ?`, [id], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to delete product' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ message: 'Product deleted successfully' });
  });
});

// --- ORDER ROUTES ---

// POST - Create order (authenticated users only)
app.post('/api/create-order', verifyToken, (req, res) => {
  const { product_id, customer_email, quantity = 1 } = req.body;
  const user_id = req.user.id;

  if (!product_id || !customer_email) {
    return res.status(400).json({ error: 'Product ID and email are required' });
  }

  db.get("SELECT * FROM products WHERE id = ?", [product_id], (err, product) => {
    if (err || !product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const orderId = uuidv4();
    const amount = (product.price * quantity).toFixed(2);
    const baseUrl = req.protocol + '://' + req.get('host');
    const paymentLink = `${baseUrl}/api/pay/${orderId}`;

    db.run(
      `INSERT INTO orders (id, user_id, product_id, product_name, amount, customer_email, payment_link, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, user_id, product_id, product.name, amount, customer_email, paymentLink, 'pending'],
      function(err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Failed to create order' });
        }
        res.json({
          orderId,
          paymentLink,
          amount,
          product: product.name,
          status: 'pending'
        });
      }
    );
  });
});

// GET - User's orders (authenticated users only)
app.get('/api/my-orders', verifyToken, (req, res) => {
  db.all(
    "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC", 
    [req.user.id], 
    (err, orders) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(orders);
    }
  );
});

// GET - All orders (Admin only)
app.get('/api/all-orders', verifyToken, verifyAdmin, (req, res) => {
  db.all(
    "SELECT * FROM orders ORDER BY created_at DESC", 
    (err, orders) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(orders);
    }
  );
});

// GET - Order details
app.get('/api/order/:orderId', (req, res) => {
  db.get("SELECT * FROM orders WHERE id = ?", [req.params.orderId], (err, order) => {
    if (err || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  });
});

// GET - Mock payment page
app.get('/api/pay/:orderId', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment - Explore Essence</title>
      <style>
        body { 
          background: #0D0D0D; 
          color: #E8E8E8; 
          font-family: system-ui, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
        }
        .payment-box {
          background: #1A1A1A;
          padding: 40px;
          border-radius: 16px;
          border: 1px solid #2D2D2D;
          max-width: 400px;
          text-align: center;
        }
        h1 { color: #D4AF37; }
        .gold { color: #D4AF37; }
        .btn {
          display: inline-block;
          padding: 12px 30px;
          background: #D4AF37;
          color: #1A1A1A;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          margin-top: 20px;
          border: none;
          cursor: pointer;
        }
        .btn:hover { background: #C5A028; }
        .note { color: #666; font-size: 0.85rem; margin-top: 15px; }
      </style>
    </head>
    <body>
      <div class="payment-box">
        <h1>✨ Explore Essence</h1>
        <p>Order: <span class="gold">${req.params.orderId}</span></p>
        <p style="color: #888;">This is a mock payment page.</p>
        <p style="color: #555; font-size: 0.9rem;">In production, you'd be redirected to PayFast, Yoco, or Ozow.</p>
        <a href="/api/mock-success/${req.params.orderId}" class="btn">💳 Simulate Payment</a>
        <p class="note">Test payment - no real money will be charged</p>
      </div>
    </body>
    </html>
  `);
});

// GET - Mock payment success
app.get('/api/mock-success/:orderId', (req, res) => {
  db.run(
    "UPDATE orders SET status = 'paid' WHERE id = ?",
    [req.params.orderId],
    function(err) {
      if (err) {
        return res.status(500).send('Payment update failed');
      }
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Successful - Explore Essence</title>
          <style>
            body { 
              background: #0D0D0D; 
              color: #E8E8E8; 
              font-family: system-ui, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
            }
            .success-box {
              background: #1A1A1A;
              padding: 40px;
              border-radius: 16px;
              border: 2px solid #D4AF37;
              max-width: 400px;
              text-align: center;
            }
            h1 { color: #D4AF37; }
            .gold { color: #D4AF37; }
            .btn {
              display: inline-block;
              padding: 12px 30px;
              background: #D4AF37;
              color: #1A1A1A;
              text-decoration: none;
              border-radius: 8px;
              font-weight: 600;
              margin-top: 20px;
            }
            .btn:hover { background: #C5A028; }
          </style>
        </head>
        <body>
          <div class="success-box">
            <h1>✅ Payment Successful!</h1>
            <p>Order <span class="gold">${req.params.orderId}</span> confirmed.</p>
            <p style="color: #888;">Thank you for shopping at Explore Essence.</p>
            <a href="/" class="btn">Continue Shopping</a>
          </div>
        </body>
        </html>
      `);
    }
  );
});

// POST - Webhook endpoint
app.post('/api/webhook', (req, res) => {
  console.log('📩 Webhook received:', req.body);
  res.status(200).send('OK');
});

// GET - Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Explore Essence API is running',
    timestamp: new Date().toISOString()
  });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`✨ Explore Essence running at http://localhost:${PORT}`);
  console.log(`📦 API available at http://localhost:${PORT}/api/products`);
  console.log(`🔐 Auth available at http://localhost:${PORT}/api/auth`);
  console.log(`❤️  Health check at http://localhost:${PORT}/api/health`);
});

module.exports = { db };