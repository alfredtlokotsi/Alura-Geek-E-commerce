const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

// Import middleware
const { verifyToken, verifyAdmin } = require('./middleware/auth');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
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

  // --- CART TABLE ---
  db.run(`
    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // --- CART ITEMS TABLE ---
  db.run(`
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cart_id) REFERENCES cart(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);

  // --- ORDERS TABLE ---
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      total_amount REAL,
      status TEXT DEFAULT 'pending',
      shipping_address TEXT,
      payment_method TEXT DEFAULT 'cash_on_delivery',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // --- ORDER ITEMS TABLE ---
  db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
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
      const bcrypt = require('bcryptjs');
      const hashedPassword = bcrypt.hashSync('admin123', 10);
      
      db.run(
        `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
        ['Admin', 'admin@exploreessence.com', hashedPassword, 'admin'],
        function(err) {
          if (err) {
            console.error('Failed to create admin user:', err);
          } else {
            console.log('✅ Default admin user created:');
            console.log('   Email: admin@exploreessence.com');
            console.log('   Password: admin123');
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

// ============================================================
// WEB ROUTES (EJS Pages)
// ============================================================

// --- Homepage ---
app.get('/', (req, res) => {
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
  
  db.all("SELECT * FROM products ORDER BY created_at DESC", (err, products) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error');
    }
    res.render('pages/index', { 
      title: 'Home', 
      user: user,
      products 
    });
  });
});

// --- Shop All ---
app.get('/products', (req, res) => {
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
  
  db.all("SELECT * FROM products ORDER BY created_at DESC", (err, products) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error');
    }
    res.render('pages/products', { 
      title: 'Shop All', 
      user: user,
      products 
    });
  });
});

// --- About ---
app.get('/about', (req, res) => {
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
  res.render('pages/about', { 
    title: 'About Explore Essence',
    user: user
  });
});

// --- Product Detail ---
app.get('/product/:id', (req, res) => {
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
  
  db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
    if (err || !product) {
      return res.status(404).send('Product not found');
    }
    res.render('pages/product', { 
      title: product.name, 
      user: user,
      product 
    });
  });
});

// --- Cart Page ---
app.get('/cart', verifyToken, (req, res) => {
  const userId = req.user.id;
  
  db.get("SELECT id FROM cart WHERE user_id = ?", [userId], (err, cart) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('Database error');
    }
    
    if (!cart) {
      db.run("INSERT INTO cart (user_id) VALUES (?)", [userId], function(err) {
        if (err) {
          console.error('Failed to create cart:', err);
          return res.status(500).send('Failed to create cart');
        }
        return res.render('pages/cart', {
          title: 'Your Cart',
          user: req.user,
          items: [],
          total: '0.00'
        });
      });
      return;
    }
    
    db.all(`
      SELECT ci.*, p.name, p.price, p.image_url, p.stock
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = ?
    `, [cart.id], (err, items) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).send('Database error');
      }
      
      let total = 0;
      items.forEach(item => {
        total += item.price * item.quantity;
      });
      
      res.render('pages/cart', {
        title: 'Your Cart',
        user: req.user,
        items: items,
        total: total.toFixed(2)
      });
    });
  });
});

// --- My Orders ---
app.get('/orders', verifyToken, (req, res) => {
  const userId = req.user.id;
  
  db.all(`
    SELECT o.*, 
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
    FROM orders o
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC
  `, [userId], (err, orders) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error');
    }
    res.render('pages/orders', {
      title: 'My Orders',
      user: req.user,
      orders: orders || []
    });
  });
});

// --- Order Details ---
app.get('/orders/:orderId', verifyToken, (req, res) => {
  const userId = req.user.id;
  const orderId = req.params.orderId;
  
  db.get(
    "SELECT * FROM orders WHERE id = ? AND user_id = ?",
    [orderId, userId],
    (err, order) => {
      if (err || !order) {
        return res.status(404).send('Order not found');
      }
      
      db.all(
        "SELECT * FROM order_items WHERE order_id = ?",
        [orderId],
        (err, items) => {
          if (err) {
            console.error(err);
            return res.status(500).send('Database error');
          }
          res.render('pages/order-detail', {
            title: 'Order Details',
            user: req.user,
            order: order,
            items: items || []
          });
        }
      );
    }
  );
});

// --- Admin Dashboard ---
app.get('/admin', verifyToken, verifyAdmin, (req, res) => {
  db.all(
    "SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC",
    (err, users) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Database error');
      }
      res.render('pages/admin', { 
        title: 'Admin Dashboard',
        user: req.user,
        users: users
      });
    }
  );
});

// ============================================================
// PUBLIC API ROUTES
// ============================================================

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

// ============================================================
// PROTECTED API ROUTES (require authentication)
// ============================================================

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

// ============================================================
// 🛒 CART API ROUTES
// ============================================================

// GET - Get user's cart
app.get('/api/cart', verifyToken, (req, res) => {
  const userId = req.user.id;
  
  db.get("SELECT id FROM cart WHERE user_id = ?", [userId], (err, cart) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!cart) {
      db.run("INSERT INTO cart (user_id) VALUES (?)", [userId], function(err) {
        if (err) {
          console.error('Failed to create cart:', err);
          return res.status(500).json({ error: 'Failed to create cart' });
        }
        return res.json({
          cart_id: this.lastID,
          items: [],
          total: '0.00',
          item_count: 0
        });
      });
      return;
    }
    
    db.all(`
      SELECT ci.*, p.name, p.price, p.image_url, p.stock
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = ?
    `, [cart.id], (err, items) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      let total = 0;
      items.forEach(item => {
        total += item.price * item.quantity;
      });
      
      res.json({
        cart_id: cart.id,
        items: items,
        total: total.toFixed(2),
        item_count: items.length
      });
    });
  });
});

// POST - Add item to cart
app.post('/api/cart/add', verifyToken, (req, res) => {
  const userId = req.user.id;
  const { product_id, quantity = 1 } = req.body;
  
  if (!product_id) {
    return res.status(400).json({ error: 'Product ID is required' });
  }
  
  db.get("SELECT * FROM products WHERE id = ?", [product_id], (err, product) => {
    if (err || !product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    if (product.stock < quantity) {
      return res.status(400).json({ error: 'Not enough stock available' });
    }
    
    db.get("SELECT id FROM cart WHERE user_id = ?", [userId], (err, cart) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!cart) {
        db.run("INSERT INTO cart (user_id) VALUES (?)", [userId], function(err) {
          if (err) {
            console.error('Failed to create cart:', err);
            return res.status(500).json({ error: 'Failed to create cart' });
          }
          addItemToCart(this.lastID, product_id, quantity, res);
        });
        return;
      }
      
      addItemToCart(cart.id, product_id, quantity, res);
    });
  });
});

function addItemToCart(cartId, productId, quantity, res) {
  db.get(
    "SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?",
    [cartId, productId],
    (err, existingItem) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (existingItem) {
        const newQuantity = existingItem.quantity + quantity;
        db.run(
          "UPDATE cart_items SET quantity = ? WHERE id = ?",
          [newQuantity, existingItem.id],
          function(err) {
            if (err) {
              console.error(err);
              return res.status(500).json({ error: 'Failed to update cart' });
            }
            res.json({ 
              success: true, 
              message: 'Cart updated',
              item: { ...existingItem, quantity: newQuantity }
            });
          }
        );
      } else {
        db.run(
          "INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)",
          [cartId, productId, quantity],
          function(err) {
            if (err) {
              console.error(err);
              return res.status(500).json({ error: 'Failed to add to cart' });
            }
            res.json({ 
              success: true, 
              message: 'Item added to cart',
              item_id: this.lastID
            });
          }
        );
      }
    }
  );
}

// PUT - Update cart item quantity
app.put('/api/cart/update/:itemId', verifyToken, (req, res) => {
  const itemId = req.params.itemId;
  const { quantity } = req.body;
  const userId = req.user.id;
  
  if (!quantity || quantity < 1) {
    return res.status(400).json({ error: 'Quantity must be at least 1' });
  }
  
  db.get(`
    SELECT ci.* FROM cart_items ci
    JOIN cart c ON ci.cart_id = c.id
    WHERE ci.id = ? AND c.user_id = ?
  `, [itemId, userId], (err, item) => {
    if (err || !item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    db.run(
      "UPDATE cart_items SET quantity = ? WHERE id = ?",
      [quantity, itemId],
      function(err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Failed to update cart' });
        }
        res.json({ success: true, message: 'Cart updated' });
      }
    );
  });
});

// DELETE - Remove item from cart
app.delete('/api/cart/remove/:itemId', verifyToken, (req, res) => {
  const itemId = req.params.itemId;
  const userId = req.user.id;
  
  db.get(`
    SELECT ci.* FROM cart_items ci
    JOIN cart c ON ci.cart_id = c.id
    WHERE ci.id = ? AND c.user_id = ?
  `, [itemId, userId], (err, item) => {
    if (err || !item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    db.run("DELETE FROM cart_items WHERE id = ?", [itemId], function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to remove item' });
      }
      res.json({ success: true, message: 'Item removed from cart' });
    });
  });
});

// DELETE - Clear cart
app.delete('/api/cart/clear', verifyToken, (req, res) => {
  const userId = req.user.id;
  
  db.get("SELECT id FROM cart WHERE user_id = ?", [userId], (err, cart) => {
    if (err || !cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    db.run("DELETE FROM cart_items WHERE cart_id = ?", [cart.id], function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to clear cart' });
      }
      res.json({ success: true, message: 'Cart cleared' });
    });
  });
});

// ============================================================
// 📦 ORDER API ROUTES
// ============================================================

// POST - Create order from cart
app.post('/api/checkout', verifyToken, (req, res) => {
  const userId = req.user.id;
  const { shipping_address, payment_method = 'cash_on_delivery' } = req.body;
  
  if (!shipping_address) {
    return res.status(400).json({ error: 'Shipping address is required' });
  }
  
  db.get("SELECT id FROM cart WHERE user_id = ?", [userId], (err, cart) => {
    if (err || !cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    db.all(`
      SELECT ci.*, p.name, p.price, p.stock
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = ?
    `, [cart.id], (err, items) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (items.length === 0) {
        return res.status(400).json({ error: 'Cart is empty' });
      }
      
      let total = 0;
      items.forEach(item => {
        total += item.price * item.quantity;
      });
      
      const orderId = uuidv4();
      
      db.run("BEGIN TRANSACTION", (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Failed to start transaction' });
        }
        
        db.run(
          `INSERT INTO orders (id, user_id, total_amount, status, shipping_address, payment_method) 
           VALUES (?, ?, ?, 'pending', ?, ?)`,
          [orderId, userId, total.toFixed(2), shipping_address, payment_method],
          function(err) {
            if (err) {
              console.error(err);
              db.run("ROLLBACK");
              return res.status(500).json({ error: 'Failed to create order' });
            }
            
            let completed = 0;
            let hasError = false;
            
            items.forEach((item) => {
              db.run(
                `INSERT INTO order_items (order_id, product_id, product_name, quantity, price) 
                 VALUES (?, ?, ?, ?, ?)`,
                [orderId, item.product_id, item.name, item.quantity, item.price],
                function(err) {
                  if (err) {
                    console.error(err);
                    hasError = true;
                    db.run("ROLLBACK");
                    return;
                  }
                  
                  const newStock = item.stock - item.quantity;
                  db.run(
                    "UPDATE products SET stock = ? WHERE id = ?",
                    [newStock, item.product_id],
                    function(err) {
                      if (err) {
                        console.error(err);
                        hasError = true;
                        db.run("ROLLBACK");
                        return;
                      }
                      
                      completed++;
                      if (completed === items.length && !hasError) {
                        db.run("DELETE FROM cart_items WHERE cart_id = ?", [cart.id], function(err) {
                          if (err) {
                            console.error(err);
                            db.run("ROLLBACK");
                            return;
                          }
                          
                          db.run("COMMIT", (err) => {
                            if (err) {
                              console.error(err);
                              db.run("ROLLBACK");
                              return res.status(500).json({ error: 'Failed to complete order' });
                            }
                            
                            res.status(201).json({
                              success: true,
                              order_id: orderId,
                              total: total.toFixed(2),
                              items: items,
                              message: 'Order placed successfully!'
                            });
                          });
                        });
                      }
                    }
                  );
                }
              );
            });
          }
        );
      });
    });
  });
});

// GET - User's orders (API)
app.get('/api/my-orders', verifyToken, (req, res) => {
  const userId = req.user.id;
  
  db.all(`
    SELECT o.*, 
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
    FROM orders o
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC
  `, [userId], (err, orders) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(orders);
  });
});

// GET - Single order details (API)
app.get('/api/order/:orderId', verifyToken, (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;
  
  db.get(
    "SELECT * FROM orders WHERE id = ? AND user_id = ?",
    [orderId, userId],
    (err, order) => {
      if (err || !order) {
        return res.status(404).json({ error: 'Order not found' });
      }
      
      db.all(
        "SELECT * FROM order_items WHERE order_id = ?",
        [orderId],
        (err, items) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
          }
          res.json({ ...order, items });
        }
      );
    }
  );
});

// GET - All orders (Admin only)
app.get('/api/all-orders', verifyToken, verifyAdmin, (req, res) => {
  db.all(`
    SELECT o.*, u.name as user_name, u.email as user_email,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
    FROM orders o
    JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at DESC
  `, (err, orders) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(orders);
  });
});

// PUT - Update order status (Admin only)
app.put('/api/orders/:orderId/status', verifyToken, verifyAdmin, (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;
  
  const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  db.run(
    "UPDATE orders SET status = ? WHERE id = ?",
    [status, orderId],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to update order' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Order not found' });
      }
      res.json({ success: true, message: 'Order status updated' });
    }
  );
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
  console.log(`❤️  Health check at http://localhost:${PORT}/api/health`);
  console.log(`🐛 Debug cookie at http://localhost:${PORT}/debug-cookie`);
});

module.exports = { db };