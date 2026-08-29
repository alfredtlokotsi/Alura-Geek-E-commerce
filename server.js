const express = require('express');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// Import middleware
const { verifyToken, verifyAdmin } = require('./middleware/auth');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors({
  origin: ['http://localhost:3000', 'https://your-app.onrender.com'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// DATABASE SETUP
// ============================================================

let pool;

// Check if we have a DATABASE_URL (Render PostgreSQL)
if (process.env.DATABASE_URL) {
  // Production - Render PostgreSQL with SSL
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Required for Render's external connections
    },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  console.log('✅ Using PostgreSQL database on Render');
} else {
  // Local development - SQLite
  console.log('⚠️ No DATABASE_URL found, using SQLite for local development');
  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database(path.join(__dirname, 'database', 'store.db'));
  
  // Create wrapper for SQLite
  pool = {
    query: (text, params) => {
      return new Promise((resolve, reject) => {
        const upperText = text.toUpperCase().trim();
        
        if (upperText.startsWith('SELECT')) {
          db.all(text, params || [], (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [], rowCount: (rows || []).length });
          });
        } else if (upperText.includes('INSERT') && upperText.includes('RETURNING')) {
          db.run(text, params || [], function(err) {
            if (err) reject(err);
            else resolve({ rows: [{ id: this.lastID }], rowCount: 1 });
          });
        } else if (upperText.startsWith('INSERT') || upperText.startsWith('UPDATE') || upperText.startsWith('DELETE')) {
          db.run(text, params || [], function(err) {
            if (err) reject(err);
            else resolve({ rows: [], rowCount: this.changes });
          });
        } else {
          db.all(text, params || [], (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [], rowCount: (rows || []).length });
          });
        }
      });
    },
    connect: (callback) => {
      callback(null, db, () => {});
    },
    end: () => {
      db.close();
    }
  };
  console.log('✅ Using SQLite database locally');
}

// Test connection
pool.query('SELECT NOW() as now', (err, res) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
  } else {
    console.log('✅ Database connected successfully');
  }
});

// Query helper
const query = (text, params) => pool.query(text, params);

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initDatabase() {
  try {
    // Create tables if they don't exist
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        icon TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        image_url TEXT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        stock INTEGER DEFAULT 10,
        featured INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS cart (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id SERIAL PRIMARY KEY,
        cart_id INTEGER NOT NULL REFERENCES cart(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER DEFAULT 1,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        total_amount DECIMAL(10,2),
        status TEXT DEFAULT 'pending',
        shipping_address TEXT,
        payment_method TEXT DEFAULT 'cash_on_delivery',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price DECIMAL(10,2) NOT NULL
      )
    `);

    // Check if categories exist
    const categoriesResult = await query('SELECT COUNT(*) FROM categories');
    if (parseInt(categoriesResult.rows[0].count) === 0) {
      await query(`
        INSERT INTO categories (name, slug, description, icon) VALUES 
        ('Perfumes', 'perfumes', 'Luxury fragrances for every occasion', 'fa-perfume'),
        ('Fans', 'fans', 'Elegant fans for comfort and style', 'fa-fan'),
        ('Ties', 'ties', 'Premium ties for the sophisticated gentleman', 'fa-tie'),
        ('Suits', 'suits', 'Tailored suits for the modern professional', 'fa-user-tie'),
        ('Tools', 'tools', 'Quality tools for every project', 'fa-tools')
      `);
      console.log('✅ Categories inserted');
    }

    // Check if products exist
    const productsResult = await query('SELECT COUNT(*) FROM products');
    if (parseInt(productsResult.rows[0].count) === 0) {
      await query(`
        INSERT INTO products (name, description, price, image_url, category_id, stock, featured) VALUES 
        ('Royal Oud', 'Premium oud fragrance with woody and spicy notes', 89.99, 'royal-oud.jpg', 1, 20, 1),
        ('Velvet Rose', 'Romantic rose scent with hints of vanilla', 69.99, 'velvet-rose.jpg', 1, 15, 1),
        ('Ocean Breeze', 'Fresh marine fragrance with citrus notes', 49.99, 'ocean-breeze.jpg', 1, 25, 0),
        ('Midnight Noir', 'Mysterious night scent with amber and musk', 79.99, 'midnight-noir.jpg', 1, 12, 0),
        ('Mahogany Fan', 'Handcrafted wooden fan with intricate carvings', 34.99, 'mahogany-fan.jpg', 2, 10, 1),
        ('Silk Fan', 'Elegant silk folding fan with floral pattern', 24.99, 'silk-fan.jpg', 2, 8, 0),
        ('Bamboo Fan', 'Eco-friendly bamboo fan with hand-painted design', 19.99, 'bamboo-fan.jpg', 2, 15, 0),
        ('Silk Tie', 'Premium silk tie with subtle pattern', 45.99, 'silk-tie.jpg', 3, 12, 1),
        ('Wool Tie', 'Classic wool tie for formal occasions', 39.99, 'wool-tie.jpg', 3, 10, 0),
        ('Linen Tie', 'Lightweight linen tie for summer', 35.99, 'linen-tie.jpg', 3, 8, 0),
        ('Navy Suit', 'Classic navy blue suit with peak lapels', 299.99, 'navy-suit.jpg', 4, 5, 1),
        ('Charcoal Suit', 'Modern charcoal suit with slim fit', 349.99, 'charcoal-suit.jpg', 4, 3, 0),
        ('Black Tuxedo', 'Elegant black tuxedo for special events', 399.99, 'black-tuxedo.jpg', 4, 4, 1),
        ('Premium Hammer', 'Professional hammer with ergonomic grip', 29.99, 'hammer.jpg', 5, 15, 1),
        ('Screwdriver Set', '10-piece professional screwdriver set', 49.99, 'screwdriver-set.jpg', 5, 10, 0),
        ('Precision Pliers', 'High-quality precision pliers', 24.99, 'pliers.jpg', 5, 12, 0)
      `);
      console.log('✅ Products inserted');
    }

    // Check if admin user exists
    const adminResult = await query("SELECT COUNT(*) FROM users WHERE email = 'admin@exploreessence.com'");
    if (parseInt(adminResult.rows[0].count) === 0) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = bcrypt.hashSync('admin123', 10);
      await query(
        "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)",
        ['Admin', 'admin@exploreessence.com', hashedPassword, 'admin']
      );
      console.log('✅ Admin user created');
    }

  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

// Initialize database
initDatabase();

// --- Import Routes ---
const authRoutes = require('./routes/auth')(pool);

// --- Use Routes ---
app.use('/api/auth', authRoutes);

// --- View Engine ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================================
// HELPER: Get User from Cookie
// ============================================================

const getUserFromCookie = (req) => {
  let user = null;
  const token = req.cookies?.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      user = decoded;
    } catch (error) {
      // Token invalid, ignore
    }
  }
  return user;
};

// ============================================================
// WEB ROUTES (EJS Pages)
// ============================================================

// --- Homepage ---
app.get('/', async (req, res) => {
  try {
    const user = getUserFromCookie(req);
    const result = await query('SELECT * FROM products ORDER BY featured DESC, created_at DESC LIMIT 8');
    res.render('pages/index', { 
      title: 'Home', 
      user: user,
      products: result.rows 
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
});

// --- Shop All ---
app.get('/products', async (req, res) => {
  try {
    const user = getUserFromCookie(req);
    const result = await query('SELECT * FROM products ORDER BY created_at DESC');
    res.render('pages/products', { 
      title: 'Shop All', 
      user: user,
      products: result.rows 
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
});

// --- About ---
app.get('/about', (req, res) => {
  const user = getUserFromCookie(req);
  res.render('pages/about', { 
    title: 'About Explore Essence',
    user: user
  });
});

// --- Product Detail ---
app.get('/product/:id', async (req, res) => {
  try {
    const user = getUserFromCookie(req);
    const result = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Product not found');
    }
    res.render('pages/product', { 
      title: result.rows[0].name, 
      user: user,
      product: result.rows[0] 
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
});

// --- Category Page ---
app.get('/category/:slug', async (req, res) => {
  try {
    const user = getUserFromCookie(req);
    const slug = req.params.slug;
    
    // Get category
    const categoryResult = await query('SELECT * FROM categories WHERE slug = $1', [slug]);
    if (categoryResult.rows.length === 0) {
      return res.status(404).send('Category not found');
    }
    const category = categoryResult.rows[0];
    
    // Get products in this category
    const productsResult = await query(
      'SELECT * FROM products WHERE category_id = $1 ORDER BY featured DESC, name',
      [category.id]
    );
    
    res.render('pages/category', {
      title: category.name,
      user: user,
      category: category,
      products: productsResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
});

// --- Cart Page ---
app.get('/cart', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get or create cart
    let cartResult = await query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    let cartId;
    
    if (cartResult.rows.length === 0) {
      const newCart = await query('INSERT INTO cart (user_id) VALUES ($1) RETURNING id', [userId]);
      cartId = newCart.rows[0].id;
    } else {
      cartId = cartResult.rows[0].id;
    }
    
    // Get cart items
    const itemsResult = await query(`
      SELECT ci.*, p.name, p.price, p.image_url, p.stock
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = $1
    `, [cartId]);
    
    let total = 0;
    itemsResult.rows.forEach(item => {
      total += parseFloat(item.price) * item.quantity;
    });
    
    res.render('pages/cart', {
      title: 'Your Cart',
      user: req.user,
      items: itemsResult.rows,
      total: total.toFixed(2)
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
});

// --- My Orders ---
app.get('/orders', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await query(`
      SELECT o.*, 
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
      FROM orders o
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
    `, [userId]);
    
    res.render('pages/orders', {
      title: 'My Orders',
      user: req.user,
      orders: result.rows || []
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
});

// --- Order Details ---
app.get('/orders/:orderId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const orderId = req.params.orderId;
    
    const orderResult = await query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [orderId, userId]
    );
    
    if (orderResult.rows.length === 0) {
      return res.status(404).send('Order not found');
    }
    
    const itemsResult = await query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [orderId]
    );
    
    res.render('pages/order-detail', {
      title: 'Order Details',
      user: req.user,
      order: orderResult.rows[0],
      items: itemsResult.rows || []
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
});

// --- Admin Dashboard ---
app.get('/admin', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const usersResult = await query(
      'SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.render('pages/admin', { 
      title: 'Admin Dashboard',
      user: req.user,
      users: usersResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
});

// --- Database Manager ---
app.get('/database', verifyToken, verifyAdmin, (req, res) => {
  res.render('pages/database-manager', {
    title: 'Database Manager',
    user: req.user
  });
});

// ============================================================
// PUBLIC API ROUTES
// ============================================================

// GET all products
app.get('/api/products', async (req, res) => {
  try {
    const result = await query('SELECT * FROM products ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single product
app.get('/api/products/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET products by category
app.get('/api/category/:slug', async (req, res) => {
  try {
    const categoryResult = await query('SELECT id FROM categories WHERE slug = $1', [req.params.slug]);
    if (categoryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    const result = await query(
      'SELECT * FROM products WHERE category_id = $1 ORDER BY featured DESC, name',
      [categoryResult.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all categories
app.get('/api/categories', async (req, res) => {
  try {
    const result = await query('SELECT * FROM categories ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PROTECTED API ROUTES
// ============================================================

// POST - Add new product (Admin only)
app.post('/api/products', verifyToken, verifyAdmin, async (req, res) => {
  const { name, description, price, image_url, category_id, stock = 10 } = req.body;
  
  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  try {
    const result = await query(
      `INSERT INTO products (name, description, price, image_url, category_id, stock) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name, description, price, image_url, category_id, stock]
    );
    res.status(201).json({ 
      id: result.rows[0].id, 
      name, 
      description, 
      price, 
      image_url, 
      category_id, 
      stock 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT - Update product (Admin only)
app.put('/api/products/:id', verifyToken, verifyAdmin, async (req, res) => {
  const { name, description, price, image_url, category_id, stock } = req.body;
  const id = req.params.id;

  try {
    const result = await query(
      `UPDATE products SET 
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        price = COALESCE($3, price),
        image_url = COALESCE($4, image_url),
        category_id = COALESCE($5, category_id),
        stock = COALESCE($6, stock)
       WHERE id = $7 RETURNING id`,
      [name, description, price, image_url, category_id, stock, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ message: 'Product updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE - Remove product (Admin only)
app.delete('/api/products/:id', verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;

  try {
    const result = await query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ============================================================
// CART API ROUTES
// ============================================================

// GET - Get user's cart
app.get('/api/cart', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    let cartResult = await query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    let cartId;
    
    if (cartResult.rows.length === 0) {
      const newCart = await query('INSERT INTO cart (user_id) VALUES ($1) RETURNING id', [userId]);
      cartId = newCart.rows[0].id;
    } else {
      cartId = cartResult.rows[0].id;
    }
    
    const itemsResult = await query(`
      SELECT ci.*, p.name, p.price, p.image_url, p.stock
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = $1
    `, [cartId]);
    
    let total = 0;
    itemsResult.rows.forEach(item => {
      total += parseFloat(item.price) * item.quantity;
    });
    
    res.json({
      cart_id: cartId,
      items: itemsResult.rows,
      total: total.toFixed(2),
      item_count: itemsResult.rows.length
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST - Add item to cart
app.post('/api/cart/add', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const { product_id, quantity = 1 } = req.body;
  
  if (!product_id) {
    return res.status(400).json({ error: 'Product ID is required' });
  }
  
  try {
    // Check product exists
    const productResult = await query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    const product = productResult.rows[0];
    if (product.stock < quantity) {
      return res.status(400).json({ error: 'Not enough stock available' });
    }
    
    // Get or create cart
    let cartResult = await query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    let cartId;
    
    if (cartResult.rows.length === 0) {
      const newCart = await query('INSERT INTO cart (user_id) VALUES ($1) RETURNING id', [userId]);
      cartId = newCart.rows[0].id;
    } else {
      cartId = cartResult.rows[0].id;
    }
    
    // Check if item already in cart
    const existingResult = await query(
      'SELECT * FROM cart_items WHERE cart_id = $1 AND product_id = $2',
      [cartId, product_id]
    );
    
    if (existingResult.rows.length > 0) {
      const newQuantity = existingResult.rows[0].quantity + quantity;
      await query(
        'UPDATE cart_items SET quantity = $1 WHERE id = $2',
        [newQuantity, existingResult.rows[0].id]
      );
      res.json({ 
        success: true, 
        message: 'Cart updated',
        item: { ...existingResult.rows[0], quantity: newQuantity }
      });
    } else {
      const result = await query(
        'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING id',
        [cartId, product_id, quantity]
      );
      res.json({ 
        success: true, 
        message: 'Item added to cart',
        item_id: result.rows[0].id
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT - Update cart item quantity
app.put('/api/cart/update/:itemId', verifyToken, async (req, res) => {
  const itemId = req.params.itemId;
  const { quantity } = req.body;
  const userId = req.user.id;
  
  if (!quantity || quantity < 1) {
    return res.status(400).json({ error: 'Quantity must be at least 1' });
  }
  
  try {
    const result = await query(`
      UPDATE cart_items 
      SET quantity = $1 
      WHERE id = $2 
      AND cart_id IN (SELECT id FROM cart WHERE user_id = $3)
      RETURNING id
    `, [quantity, itemId, userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json({ success: true, message: 'Cart updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE - Remove item from cart
app.delete('/api/cart/remove/:itemId', verifyToken, async (req, res) => {
  const itemId = req.params.itemId;
  const userId = req.user.id;
  
  try {
    const result = await query(`
      DELETE FROM cart_items 
      WHERE id = $1 
      AND cart_id IN (SELECT id FROM cart WHERE user_id = $2)
      RETURNING id
    `, [itemId, userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json({ success: true, message: 'Item removed from cart' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE - Clear cart
app.delete('/api/cart/clear', verifyToken, async (req, res) => {
  const userId = req.user.id;
  
  try {
    const cartResult = await query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    if (cartResult.rows.length === 0) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    await query('DELETE FROM cart_items WHERE cart_id = $1', [cartResult.rows[0].id]);
    res.json({ success: true, message: 'Cart cleared' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ============================================================
// ORDER API ROUTES
// ============================================================

// POST - Create order from cart
app.post('/api/checkout', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const { shipping_address, payment_method = 'cash_on_delivery' } = req.body;
  
  if (!shipping_address) {
    return res.status(400).json({ error: 'Shipping address is required' });
  }
  
  try {
    // Get cart
    const cartResult = await query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    if (cartResult.rows.length === 0) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    const cartId = cartResult.rows[0].id;
    
    // Get cart items
    const itemsResult = await query(`
      SELECT ci.*, p.name, p.price, p.stock
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = $1
    `, [cartId]);
    
    if (itemsResult.rows.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    
    let total = 0;
    itemsResult.rows.forEach(item => {
      total += parseFloat(item.price) * item.quantity;
    });
    
    const orderId = uuidv4();
    
    // Begin transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Create order
      await client.query(
        `INSERT INTO orders (id, user_id, total_amount, status, shipping_address, payment_method) 
         VALUES ($1, $2, $3, 'pending', $4, $5)`,
        [orderId, userId, total.toFixed(2), shipping_address, payment_method]
      );
      
      // Add order items and update stock
      for (const item of itemsResult.rows) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, product_name, quantity, price) 
           VALUES ($1, $2, $3, $4, $5)`,
          [orderId, item.product_id, item.name, item.quantity, item.price]
        );
        
        const newStock = item.stock - item.quantity;
        await client.query(
          'UPDATE products SET stock = $1 WHERE id = $2',
          [newStock, item.product_id]
        );
      }
      
      // Clear cart
      await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
      
      await client.query('COMMIT');
      
      res.status(201).json({
        success: true,
        order_id: orderId,
        total: total.toFixed(2),
        items: itemsResult.rows,
        message: 'Order placed successfully!'
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

// GET - User's orders
app.get('/api/my-orders', verifyToken, async (req, res) => {
  const userId = req.user.id;
  
  try {
    const result = await query(`
      SELECT o.*, 
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
      FROM orders o
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
    `, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET - Single order details
app.get('/api/order/:orderId', verifyToken, async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;
  
  try {
    const orderResult = await query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [orderId, userId]
    );
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const itemsResult = await query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [orderId]
    );
    
    res.json({ ...orderResult.rows[0], items: itemsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET - All orders (Admin only)
app.get('/api/all-orders', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT o.*, u.name as user_name, u.email as user_email,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT - Update order status (Admin only)
app.put('/api/orders/:orderId/status', verifyToken, verifyAdmin, async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;
  
  const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  try {
    const result = await query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING id',
      [status, orderId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({ success: true, message: 'Order status updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// ============================================================
// ADMIN DATABASE MANAGEMENT ROUTES
// ============================================================

// API - Get table data
app.get('/api/admin/db/:table', verifyToken, verifyAdmin, async (req, res) => {
  const table = req.params.table;
  const allowedTables = ['users', 'products', 'orders', 'cart', 'cart_items', 'order_items', 'categories'];
  
  if (!allowedTables.includes(table)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }

  try {
    // Get column info
    const columnsResult = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = $1 
      ORDER BY ordinal_position
    `, [table]);
    
    // Get data
    const dataResult = await query(`SELECT * FROM ${table} ORDER BY id DESC LIMIT 100`);
    
    res.json({
      success: true,
      columns: columnsResult.rows.map(c => c.column_name),
      rows: dataResult.rows,
      count: dataResult.rows.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API - Run custom SQL query (Admin only)
app.post('/api/admin/db/query', verifyToken, verifyAdmin, async (req, res) => {
  const { query: sqlQuery } = req.body;
  
  if (!sqlQuery) {
    return res.status(400).json({ error: 'Query is required' });
  }
  
  // Block dangerous queries
  const dangerous = ['DROP', 'ALTER', 'CREATE', 'DELETE', 'UPDATE', 'INSERT'];
  const upperQuery = sqlQuery.toUpperCase();
  for (const word of dangerous) {
    if (upperQuery.includes(word) && !upperQuery.includes('SELECT')) {
      return res.status(400).json({ error: `${word} queries are not allowed for safety` });
    }
  }

  try {
    const result = await query(sqlQuery);
    res.json({
      success: true,
      rows: result.rows || [],
      rowCount: result.rowCount || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MISC ROUTES
// ============================================================

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Explore Essence API is running',
    timestamp: new Date().toISOString()
  });
});

// --- Debug Cookie Route ---
app.get('/debug-cookie', (req, res) => {
  res.json({
    cookies: req.cookies,
    hasToken: !!req.cookies?.token,
    allCookies: req.headers.cookie || 'No cookies sent'
  });
});

// --- Catch-all for 404 ---
app.use((req, res) => {
  const user = getUserFromCookie(req);
  res.status(404).render('pages/404', { 
    title: 'Page Not Found',
    user: user 
  });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`✨ Explore Essence running at http://localhost:${PORT}`);
  console.log(`📦 API available at http://localhost:${PORT}/api/products`);
  console.log(`🔐 Auth available at http://localhost:${PORT}/api/auth`);
  console.log(`🛒 Cart available at http://localhost:${PORT}/api/cart`);
  console.log(`👑 Admin dashboard at http://localhost:${PORT}/admin`);
  console.log(`🗄️ Database at http://localhost:${PORT}/database`);
  console.log(`❤️  Health check at http://localhost:${PORT}/api/health`);
});

module.exports = { pool };