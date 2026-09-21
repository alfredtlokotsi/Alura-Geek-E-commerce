const express = require('express');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { verifyToken, verifyAdmin } = require('./middleware/auth');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// DATABASE
// ============================================================

let pool;

if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    console.log('✅ Using PostgreSQL');
} else {
    console.log('⚠️ No DATABASE_URL, using SQLite');
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(__dirname, 'database', 'store.db'));
    
    pool = {
        query: (text, params) => new Promise((resolve, reject) => {
            const upper = text.toUpperCase().trim();
            if (upper.startsWith('SELECT')) {
                db.all(text, params || [], (err, rows) => err ? reject(err) : resolve({ rows: rows || [], rowCount: (rows || []).length }));
            } else if (upper.includes('RETURNING')) {
                db.run(text, params || [], function(err) { err ? reject(err) : resolve({ rows: [{ id: this.lastID }], rowCount: 1 }); });
            } else {
                db.run(text, params || [], function(err) { err ? reject(err) : resolve({ rows: [], rowCount: this.changes }); });
            }
        }),
        connect: (cb) => cb(null, db, () => {}),
        end: () => db.close()
    };
}

const query = (text, params) => pool.query(text, params);

pool.query('SELECT NOW()').then(() => console.log('✅ DB connected')).catch(e => console.error('❌ DB error:', e.message));

// ============================================================
// DATABASE INIT
// ============================================================

async function initDatabase() {
    try {
        await query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL, role TEXT DEFAULT 'user', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

        await query(`CREATE TABLE IF NOT EXISTS categories (
            id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE,
            description TEXT, icon TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

        await query(`CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT,
            price DECIMAL(10,2) NOT NULL, image_url TEXT,
            category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            stock INTEGER DEFAULT 10, featured INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

        await query(`CREATE TABLE IF NOT EXISTS cart (
            id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

        await query(`CREATE TABLE IF NOT EXISTS cart_items (
            id SERIAL PRIMARY KEY, cart_id INTEGER NOT NULL REFERENCES cart(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL, quantity INTEGER DEFAULT 1,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

        await query(`CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id),
            total_amount DECIMAL(10,2), status TEXT DEFAULT 'pending',
            shipping_address TEXT, payment_method TEXT DEFAULT 'cash_on_delivery',
            tracking_number TEXT, estimated_delivery DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

        await query(`CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            product_id INTEGER, product_name TEXT NOT NULL,
            quantity INTEGER NOT NULL, price DECIMAL(10,2) NOT NULL)`);

        await query(`CREATE TABLE IF NOT EXISTS wishlist (
            id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, product_id))`);

        await query(`CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            rating INTEGER CHECK (rating >= 1 AND rating <= 5),
            comment TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

        await query(`CREATE TABLE IF NOT EXISTS suits (
            id SERIAL PRIMARY KEY, product_name TEXT NOT NULL, color TEXT,
            fit_type TEXT, pieces_count INTEGER DEFAULT 3, jacket_style TEXT,
            waistcoat_style TEXT, accessories_included TEXT,
            price DECIMAL(10,2) NOT NULL, stock_quantity INTEGER DEFAULT 10,
            image_url TEXT, featured INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

        await query(`CREATE TABLE IF NOT EXISTS trousers (
            id SERIAL PRIMARY KEY, type_code TEXT NOT NULL UNIQUE,
            color_name TEXT NOT NULL, price DECIMAL(10,2) NOT NULL DEFAULT 350.00,
            description TEXT, image_filename TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

        console.log('✅ Tables initialized');

        // Categories
        const catCheck = await query('SELECT COUNT(*) FROM categories');
        if (parseInt(catCheck.rows[0].count) === 0) {
            await query(`INSERT INTO categories (name, slug, description, icon) VALUES 
                ('Perfumes', 'perfumes', 'Luxury fragrances for every occasion', 'fa-spray-can-sparkles'),
                ('Ties', 'ties', 'Premium ties for the sophisticated gentleman', 'fa-user-tie'),
                ('Suits', 'suits', 'Tailored suits for the modern professional', 'fa-user-tie'),
                ('Chinos', 'chinos', 'Smart-casual chinos for everyday wear', 'fa-person'),
                ('Shirts', 'shirts', 'Premium shirts for every occasion', 'fa-shirt'),
                ('Trousers', 'trousers', 'Tailored trousers for a sharp look', 'fa-socks')`);
            console.log('✅ Categories inserted');
        }

        // Admin user
        const adminCheck = await query("SELECT COUNT(*) FROM users WHERE email = 'admin@exploreessence.com'");
        if (parseInt(adminCheck.rows[0].count) === 0) {
            const bcrypt = require('bcryptjs');
            const hash = bcrypt.hashSync('admin123', 10);
            await query("INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)",
                ['Admin', 'admin@exploreessence.com', hash, 'admin']);
            console.log('✅ Admin created: admin@exploreessence.com / admin123');
        }
    } catch (err) {
        console.error('Init error:', err);
    }
}

initDatabase();

// ============================================================
// ROUTES
// ============================================================

app.use('/api/auth', require('./routes/auth')(pool));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const getUserFromCookie = (req) => {
    let user = null;
    const token = req.cookies?.token;
    if (token) {
        try { user = jwt.verify(token, process.env.JWT_SECRET); } catch (e) {}
    }
    return user;
};

// ============================================================
// WEB ROUTES
// ============================================================

app.get('/', async (req, res) => {
    try {
        const user = getUserFromCookie(req);
        const featured = await query('SELECT * FROM products WHERE featured = 1 ORDER BY created_at DESC LIMIT 8');
        const newArrivals = await query('SELECT * FROM products ORDER BY created_at DESC LIMIT 4');
        res.render('pages/index', { title: 'Home', user, featured: featured.rows, newArrivals: newArrivals.rows });
    } catch (err) {
        console.error(err); res.status(500).send('DB error');
    }
});

app.get('/products', async (req, res) => {
    try {
        const user = getUserFromCookie(req);
        const result = await query('SELECT * FROM products ORDER BY created_at DESC');
        res.render('pages/products', { title: 'Shop All', user, products: result.rows });
    } catch (err) { console.error(err); res.status(500).send('DB error'); }
});

// Category Pages — excludes 'trousers' (has its own dedicated table)
const categories = ['perfumes', 'ties', 'chinos', 'shirts'];
categories.forEach(slug => {
    app.get(`/${slug}`, async (req, res) => {
        try {
            const user = getUserFromCookie(req);
            const result = await query(
                'SELECT * FROM products WHERE category_id = (SELECT id FROM categories WHERE slug = $1) ORDER BY featured DESC, name',
                [slug]
            );
            const title = slug.charAt(0).toUpperCase() + slug.slice(1);
            res.render(`pages/${slug}`, { title, user, products: result.rows });
        } catch (err) { console.error(err); res.status(500).send('DB error'); }
    });
});

// Suits (dedicated table)
app.get('/suits', async (req, res) => {
    try {
        const user = getUserFromCookie(req);
        const result = await query('SELECT * FROM suits ORDER BY featured DESC, created_at DESC');
        res.render('pages/suits', { title: 'Suits', user, suits: result.rows });
    } catch (err) { console.error(err); res.status(500).send('DB error'); }
});

app.get('/suits/:id', async (req, res) => {
    try {
        const user = getUserFromCookie(req);
        const result = await query('SELECT * FROM suits WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send('Suit not found');
        res.render('pages/suit-detail', { title: result.rows[0].product_name, user, suit: result.rows[0] });
    } catch (err) { console.error(err); res.status(500).send('DB error'); }
});

// Trousers (dedicated table)
app.get('/trousers', async (req, res) => {
    try {
        const user = getUserFromCookie(req);
        const result = await query('SELECT * FROM trousers ORDER BY id');
        res.render('pages/trousers', { 
            title: 'Trousers', 
            user, 
            trousers: result.rows 
        });
    } catch (err) { 
        console.error(err); 
        res.status(500).send('DB error'); 
    }
});

// Product Detail
app.get('/product/:id', async (req, res) => {
    try {
        const user = getUserFromCookie(req);
        const productResult = await query(`
            SELECT p.*, COALESCE(AVG(r.rating), 0) as avg_rating, COUNT(r.id) as review_count
            FROM products p LEFT JOIN reviews r ON p.id = r.product_id
            WHERE p.id = $1 GROUP BY p.id`, [req.params.id]);
        if (productResult.rows.length === 0) return res.status(404).send('Product not found');
        const product = productResult.rows[0];
        const relatedResult = await query(
            'SELECT * FROM products WHERE category_id = $1 AND id != $2 ORDER BY RANDOM() LIMIT 4',
            [product.category_id, req.params.id]);
        const reviewsResult = await query(`
            SELECT r.*, u.name as user_name FROM reviews r
            JOIN users u ON r.user_id = u.id WHERE r.product_id = $1
            ORDER BY r.created_at DESC LIMIT 10`, [req.params.id]);
        res.render('pages/product', { title: product.name, user, product, related: relatedResult.rows, reviews: reviewsResult.rows });
    } catch (err) { console.error(err); res.status(500).send('DB error'); }
});

// Search
app.get('/search', async (req, res) => {
    try {
        const user = getUserFromCookie(req);
        const { q } = req.query;
        let products = [];
        if (q) {
            const result = await query(
                'SELECT * FROM products WHERE name ILIKE $1 OR description ILIKE $1 ORDER BY name LIMIT 20',
                [`%${q}%`]);
            products = result.rows;
        }
        res.render('pages/search', { title: 'Search', user, query: q || '', products });
    } catch (err) { console.error(err); res.status(500).send('DB error'); }
});

// Cart
app.get('/cart', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        let cartResult = await query('SELECT id FROM cart WHERE user_id = $1', [userId]);
        let cartId;
        if (cartResult.rows.length === 0) {
            const newCart = await query('INSERT INTO cart (user_id) VALUES ($1) RETURNING id', [userId]);
            cartId = newCart.rows[0].id;
        } else { cartId = cartResult.rows[0].id; }

        const itemsResult = await query(`
            SELECT ci.*, 
                COALESCE(p.name, s.product_name, t.color_name || ' ' || t.type_code) as name,
                COALESCE(p.price, s.price, t.price) as price,
                COALESCE(p.image_url, s.image_url, 'trousers/' || t.image_filename) as image_url,
                COALESCE(p.stock, s.stock_quantity, 10) as stock
            FROM cart_items ci
            LEFT JOIN products p ON ci.product_id = p.id
            LEFT JOIN suits s ON ci.product_id = s.id AND p.id IS NULL
            LEFT JOIN trousers t ON ci.product_id = t.id AND p.id IS NULL AND s.id IS NULL
            WHERE ci.cart_id = $1`, [cartId]);

        let subtotal = 0;
        itemsResult.rows.forEach(item => { subtotal += parseFloat(item.price || 0) * item.quantity; });
        const tax = subtotal * 0.15;
        const shipping = subtotal > 500 ? 0 : 50;
        const total = subtotal + tax + shipping;

        res.render('pages/cart', {
            title: 'Cart', user: req.user, items: itemsResult.rows,
            subtotal: subtotal.toFixed(2), tax: tax.toFixed(2),
            shipping: shipping.toFixed(2), total: total.toFixed(2)
        });
    } catch (err) { console.error(err); res.status(500).send('DB error'); }
});

// Checkout
app.get('/checkout', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const cartResult = await query('SELECT id FROM cart WHERE user_id = $1', [userId]);
        if (cartResult.rows.length === 0) return res.redirect('/cart');
        const itemsResult = await query(`
            SELECT ci.*, 
                COALESCE(p.name, s.product_name, t.color_name || ' ' || t.type_code) as name,
                COALESCE(p.price, s.price, t.price) as price,
                COALESCE(p.image_url, s.image_url, 'trousers/' || t.image_filename) as image_url
            FROM cart_items ci
            LEFT JOIN products p ON ci.product_id = p.id
            LEFT JOIN suits s ON ci.product_id = s.id AND p.id IS NULL
            LEFT JOIN trousers t ON ci.product_id = t.id AND p.id IS NULL AND s.id IS NULL
            WHERE ci.cart_id = $1`, [cartResult.rows[0].id]);
        if (itemsResult.rows.length === 0) return res.redirect('/cart');

        let subtotal = 0;
        itemsResult.rows.forEach(item => { subtotal += parseFloat(item.price || 0) * item.quantity; });
        const tax = subtotal * 0.15;
        const shipping = subtotal > 500 ? 0 : 50;
        const total = subtotal + tax + shipping;

        res.render('pages/checkout', {
            title: 'Checkout', user: req.user, items: itemsResult.rows,
            subtotal: subtotal.toFixed(2), tax: tax.toFixed(2),
            shipping: shipping.toFixed(2), total: total.toFixed(2)
        });
    } catch (err) { console.error(err); res.status(500).send('DB error'); }
});

// Orders
app.get('/orders', verifyToken, async (req, res) => {
    try {
        const result = await query(`
            SELECT o.*, (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
            FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC`, [req.user.id]);
        res.render('pages/orders', { title: 'My Orders', user: req.user, orders: result.rows || [] });
    } catch (err) { console.error(err); res.status(500).send('DB error'); }
});

app.get('/orders/:orderId', verifyToken, async (req, res) => {
    try {
        const orderResult = await query('SELECT * FROM orders WHERE id = $1 AND user_id = $2',
            [req.params.orderId, req.user.id]);
        if (orderResult.rows.length === 0) return res.status(404).send('Order not found');
        const itemsResult = await query('SELECT * FROM order_items WHERE order_id = $1', [req.params.orderId]);
        res.render('pages/order-detail', { title: 'Order', user: req.user, order: orderResult.rows[0], items: itemsResult.rows || [] });
    } catch (err) { console.error(err); res.status(500).send('DB error'); }
});

// Wishlist
app.get('/wishlist', verifyToken, async (req, res) => {
    try {
        const result = await query(`
            SELECT p.* FROM wishlist w JOIN products p ON w.product_id = p.id
            WHERE w.user_id = $1`, [req.user.id]);
        res.render('pages/wishlist', { title: 'Wishlist', user: req.user, products: result.rows });
    } catch (err) { console.error(err); res.status(500).send('DB error'); }
});

// Profile
app.get('/profile', verifyToken, async (req, res) => {
    try {
        const userResult = await query('SELECT id, name, email, role, created_at FROM users WHERE id = $1', [req.user.id]);
        const ordersResult = await query('SELECT COUNT(*) as total_orders FROM orders WHERE user_id = $1', [req.user.id]);
        const wishlistResult = await query('SELECT COUNT(*) as total_wishlist FROM wishlist WHERE user_id = $1', [req.user.id]);
        const cartResult = await query('SELECT COUNT(*) as total_cart FROM cart_items ci JOIN cart c ON ci.cart_id = c.id WHERE c.user_id = $1', [req.user.id]);
        res.render('pages/profile', {
            title: 'Profile', user: req.user, profile: userResult.rows[0],
            stats: {
                orders: ordersResult.rows[0].total_orders || 0,
                wishlist: wishlistResult.rows[0].total_wishlist || 0,
                cart: cartResult.rows[0].total_cart || 0
            }
        });
    } catch (err) { console.error(err); res.status(500).send('DB error'); }
});

// Admin
app.get('/admin', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const usersResult = await query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC');
        res.render('pages/admin', { title: 'Admin', user: req.user, users: usersResult.rows });
    } catch (err) { console.error(err); res.status(500).send('DB error'); }
});

// About
app.get('/about', (req, res) => {
    const user = getUserFromCookie(req);
    res.render('pages/about', { title: 'About', user });
});

// ============================================================
// API ROUTES
// ============================================================

app.get('/api/products', async (req, res) => {
    try {
        const result = await query('SELECT * FROM products ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/suits', async (req, res) => {
    try {
        const result = await query('SELECT * FROM suits ORDER BY featured DESC, created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/trousers', async (req, res) => {
    try {
        const result = await query('SELECT * FROM trousers ORDER BY id');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cart API - Add to cart (works across products, suits, and trousers)
app.post('/api/cart/add', verifyToken, async (req, res) => {
    const userId = req.user.id;
    const { product_id, quantity = 1 } = req.body;
    
    if (!product_id) return res.status(400).json({ error: 'Product ID required' });
    
    try {
        let product = null;
        
        // Check products table
        const productResult = await query('SELECT * FROM products WHERE id = $1', [product_id]);
        if (productResult.rows.length > 0) {
            product = productResult.rows[0];
        } else {
            // Check suits table
            const suitResult = await query('SELECT * FROM suits WHERE id = $1', [product_id]);
            if (suitResult.rows.length > 0) {
                const s = suitResult.rows[0];
                product = { id: s.id, name: s.product_name, price: s.price, stock: s.stock_quantity, image_url: s.image_url };
            } else {
                // Check trousers table
                const trouserResult = await query('SELECT * FROM trousers WHERE id = $1', [product_id]);
                if (trouserResult.rows.length > 0) {
                    const t = trouserResult.rows[0];
                    product = { 
                        id: t.id, 
                        name: `${t.color_name} ${t.type_code}`, 
                        price: t.price, 
                        stock: 10,
                        image_url: `trousers/${t.image_filename}` 
                    };
                }
            }
        }
        
        if (!product) return res.status(404).json({ error: 'Product not found' });
        if (product.stock < quantity) return res.status(400).json({ error: 'Not enough stock' });
        
        // Get or create cart
        let cartResult = await query('SELECT id FROM cart WHERE user_id = $1', [userId]);
        let cartId;
        if (cartResult.rows.length === 0) {
            const newCart = await query('INSERT INTO cart (user_id) VALUES ($1) RETURNING id', [userId]);
            cartId = newCart.rows[0].id;
        } else { cartId = cartResult.rows[0].id; }
        
        // Check if item already in cart
        const existingResult = await query(
            'SELECT * FROM cart_items WHERE cart_id = $1 AND product_id = $2',
            [cartId, product_id]);
        
        if (existingResult.rows.length > 0) {
            const newQuantity = existingResult.rows[0].quantity + quantity;
            await query('UPDATE cart_items SET quantity = $1 WHERE id = $2',
                [newQuantity, existingResult.rows[0].id]);
            res.json({ success: true, message: 'Cart updated' });
        } else {
            await query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)',
                [cartId, product_id, quantity]);
            res.json({ success: true, message: 'Item added to cart' });
        }
    } catch (err) {
        console.error(err); res.status(500).json({ error: 'DB error' });
    }
});

// Get cart
app.get('/api/cart', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        let cartResult = await query('SELECT id FROM cart WHERE user_id = $1', [userId]);
        let cartId;
        if (cartResult.rows.length === 0) {
            const newCart = await query('INSERT INTO cart (user_id) VALUES ($1) RETURNING id', [userId]);
            cartId = newCart.rows[0].id;
        } else { cartId = cartResult.rows[0].id; }
        
        const itemsResult = await query(`
            SELECT ci.*, 
                COALESCE(p.name, s.product_name, t.color_name || ' ' || t.type_code) as name,
                COALESCE(p.price, s.price, t.price) as price,
                COALESCE(p.image_url, s.image_url, 'trousers/' || t.image_filename) as image_url,
                COALESCE(p.stock, s.stock_quantity, 10) as stock
            FROM cart_items ci
            LEFT JOIN products p ON ci.product_id = p.id
            LEFT JOIN suits s ON ci.product_id = s.id AND p.id IS NULL
            LEFT JOIN trousers t ON ci.product_id = t.id AND p.id IS NULL AND s.id IS NULL
            WHERE ci.cart_id = $1`, [cartId]);
        
        let total = 0;
        itemsResult.rows.forEach(item => { total += parseFloat(item.price || 0) * item.quantity; });
        
        res.json({ cart_id: cartId, items: itemsResult.rows, total: total.toFixed(2), item_count: itemsResult.rows.length });
    } catch (err) { console.error(err); res.status(500).json({ error: 'DB error' }); }
});

// Update cart item
app.put('/api/cart/update/:itemId', verifyToken, async (req, res) => {
    const { quantity } = req.body;
    if (!quantity || quantity < 1) return res.status(400).json({ error: 'Quantity must be >= 1' });
    try {
        const result = await query(`
            UPDATE cart_items SET quantity = $1 WHERE id = $2
            AND cart_id IN (SELECT id FROM cart WHERE user_id = $3) RETURNING id`,
            [quantity, req.params.itemId, req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
        res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'DB error' }); }
});

// Remove from cart
app.delete('/api/cart/remove/:itemId', verifyToken, async (req, res) => {
    try {
        const result = await query(`
            DELETE FROM cart_items WHERE id = $1
            AND cart_id IN (SELECT id FROM cart WHERE user_id = $2) RETURNING id`,
            [req.params.itemId, req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
        res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'DB error' }); }
});

// Checkout
app.post('/api/checkout', verifyToken, async (req, res) => {
    const userId = req.user.id;
    const { shipping_address, payment_method = 'cash_on_delivery' } = req.body;
    if (!shipping_address) return res.status(400).json({ error: 'Shipping address required' });
    
    try {
        const cartResult = await query('SELECT id FROM cart WHERE user_id = $1', [userId]);
        if (cartResult.rows.length === 0) return res.status(404).json({ error: 'Cart not found' });
        const cartId = cartResult.rows[0].id;
        
        const itemsResult = await query(`
            SELECT ci.*, 
                COALESCE(p.name, s.product_name, t.color_name || ' ' || t.type_code) as name,
                COALESCE(p.price, s.price, t.price) as price
            FROM cart_items ci
            LEFT JOIN products p ON ci.product_id = p.id
            LEFT JOIN suits s ON ci.product_id = s.id AND p.id IS NULL
            LEFT JOIN trousers t ON ci.product_id = t.id AND p.id IS NULL AND s.id IS NULL
            WHERE ci.cart_id = $1`, [cartId]);
        
        if (itemsResult.rows.length === 0) return res.status(400).json({ error: 'Cart empty' });
        
        let subtotal = 0;
        itemsResult.rows.forEach(item => { subtotal += parseFloat(item.price || 0) * item.quantity; });
        const tax = subtotal * 0.15;
        const shipping = subtotal > 500 ? 0 : 50;
        const total = subtotal + tax + shipping;
        const orderId = uuidv4();
        
        await query(`INSERT INTO orders (id, user_id, total_amount, status, shipping_address, payment_method) 
            VALUES ($1, $2, $3, 'pending', $4, $5)`,
            [orderId, userId, total.toFixed(2), shipping_address, payment_method]);
        
        for (const item of itemsResult.rows) {
            await query(`INSERT INTO order_items (order_id, product_id, product_name, quantity, price) 
                VALUES ($1, $2, $3, $4, $5)`,
                [orderId, item.product_id, item.name, item.quantity, item.price]);
        }
        
        await query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
        
        res.status(201).json({ success: true, order_id: orderId, total: total.toFixed(2) });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to place order' }); }
});

// Wishlist API
app.post('/api/wishlist/add', verifyToken, async (req, res) => {
    try {
        const { product_id } = req.body;
        await query('INSERT INTO wishlist (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [req.user.id, product_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/wishlist/remove/:productId', verifyToken, async (req, res) => {
    try {
        await query('DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2',
            [req.user.id, req.params.productId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Explore Essence running', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res) => {
    const user = getUserFromCookie(req);
    res.status(404).render('pages/404', { title: 'Not Found', user });
});

// ============================================================
// START
// ============================================================

app.listen(PORT, () => {
    console.log(`✨ Explore Essence: http://localhost:${PORT}`);
    console.log(`👔 Suits: /suits | 💐 Perfumes: /perfumes | 👔 Ties: /ties`);
    console.log(`👖 Chinos: /chinos | 👕 Shirts: /shirts | 🧦 Trousers: /trousers`);
});

module.exports = { pool };