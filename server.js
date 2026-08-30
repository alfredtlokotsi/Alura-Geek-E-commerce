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
const cron = require('node-cron');
const { exec } = require('child_process');

// Import middleware
const { verifyToken, verifyAdmin } = require('./middleware/auth');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security Middleware ---
app.use(helmet());

// --- Rate Limiting ---
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// --- CORS ---
app.use(cors({
    origin: ['http://localhost:3000', 'https://your-app.onrender.com'],
    credentials: true
}));

// --- Body Parsers ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1y',
    immutable: true
}));

// ============================================================
// DATABASE SETUP
// ============================================================

let pool;

if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
    });
    console.log('✅ Using PostgreSQL database on Render');
} else {
    console.log('⚠️ No DATABASE_URL found, using SQLite for local development');
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(__dirname, 'database', 'store.db'));
    
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
        connect: (callback) => { callback(null, db, () => {}); },
        end: () => { db.close(); }
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

const query = (text, params) => pool.query(text, params);

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initDatabase() {
    try {
        // Users
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

        // Categories
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

        // Products
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

        // Cart
        await query(`
            CREATE TABLE IF NOT EXISTS cart (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Cart Items
        await query(`
            CREATE TABLE IF NOT EXISTS cart_items (
                id SERIAL PRIMARY KEY,
                cart_id INTEGER NOT NULL REFERENCES cart(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                quantity INTEGER DEFAULT 1,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Orders
        await query(`
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                total_amount DECIMAL(10,2),
                status TEXT DEFAULT 'pending',
                shipping_address TEXT,
                payment_method TEXT DEFAULT 'cash_on_delivery',
                tracking_number TEXT,
                estimated_delivery DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Order Items
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

        // Wishlist
        await query(`
            CREATE TABLE IF NOT EXISTS wishlist (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, product_id)
            )
        `);

        // Reviews
        await query(`
            CREATE TABLE IF NOT EXISTS reviews (
                id SERIAL PRIMARY KEY,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                rating INTEGER CHECK (rating >= 1 AND rating <= 5),
                comment TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Password Reset Tokens
        await query(`
            CREATE TABLE IF NOT EXISTS password_resets (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL,
                token TEXT NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Tables initialized');

        // Insert categories if empty
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

        // Insert sample products if empty
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

        // Create admin user
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

initDatabase();

// ============================================================
// SCHEDULED BACKUPS (Daily at 2 AM)
// ============================================================

cron.schedule('0 2 * * *', () => {
    console.log('🔄 Running database backup...');
    exec('npm run backup', (error, stdout, stderr) => {
        if (error) {
            console.error('❌ Backup failed:', error);
        } else {
            console.log('✅ Backup completed:', stdout);
        }
    });
});

// ============================================================
// IMPORT ROUTES
// ============================================================

const authRoutes = require('./routes/auth')(pool);

app.use('/api/auth', authRoutes);

// ============================================================
// VIEW ENGINE
// ============================================================

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
        } catch (error) {}
    }
    return user;
};

// ============================================================
// WEB ROUTES
// ============================================================

// --- Homepage ---
app.get('/', async (req, res) => {
    try {
        const user = getUserFromCookie(req);
        const featured = await query('SELECT * FROM products WHERE featured = 1 ORDER BY created_at DESC LIMIT 8');
        const newArrivals = await query('SELECT * FROM products ORDER BY created_at DESC LIMIT 4');
        const categories = await query('SELECT * FROM categories');
        
        res.render('pages/index', { 
            title: 'Home', 
            user: user,
            featured: featured.rows,
            newArrivals: newArrivals.rows,
            categories: categories.rows
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

// --- Search ---
app.get('/search', async (req, res) => {
    try {
        const user = getUserFromCookie(req);
        const { q } = req.query;
        let products = [];
        
        if (q) {
            const result = await query(
                `SELECT * FROM products 
                 WHERE name ILIKE $1 OR description ILIKE $1 
                 ORDER BY name LIMIT 20`,
                [`%${q}%`]
            );
            products = result.rows;
        }
        
        res.render('pages/search', { 
            title: 'Search Results', 
            user: user,
            query: q || '',
            products: products
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
        
        const categoryResult = await query('SELECT * FROM categories WHERE slug = $1', [slug]);
        if (categoryResult.rows.length === 0) {
            return res.status(404).send('Category not found');
        }
        const category = categoryResult.rows[0];
        
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

// --- Product Detail ---
app.get('/product/:id', async (req, res) => {
    try {
        const user = getUserFromCookie(req);
        const productId = req.params.id;
        
        // Get product with rating
        const productResult = await query(`
            SELECT p.*, 
                COALESCE(AVG(r.rating), 0) as avg_rating,
                COUNT(r.id) as review_count
            FROM products p
            LEFT JOIN reviews r ON p.id = r.product_id
            WHERE p.id = $1
            GROUP BY p.id
        `, [productId]);
        
        if (productResult.rows.length === 0) {
            return res.status(404).send('Product not found');
        }
        const product = productResult.rows[0];
        
        // Get related products (same category)
        const relatedResult = await query(
            `SELECT * FROM products 
             WHERE category_id = $1 AND id != $2 
             ORDER BY RANDOM() LIMIT 4`,
            [product.category_id, productId]
        );
        
        // Get reviews
        const reviewsResult = await query(`
            SELECT r.*, u.name as user_name 
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.product_id = $1
            ORDER BY r.created_at DESC
            LIMIT 10
        `, [productId]);
        
        res.render('pages/product', { 
            title: product.name, 
            user: user,
            product: product,
            related: relatedResult.rows,
            reviews: reviewsResult.rows
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
        
        let subtotal = 0;
        itemsResult.rows.forEach(item => {
            subtotal += parseFloat(item.price) * item.quantity;
        });
        
        const tax = subtotal * 0.15; // 15% VAT
        const shipping = subtotal > 500 ? 0 : 50;
        const total = subtotal + tax + shipping;
        
        res.render('pages/cart', {
            title: 'Your Cart',
            user: req.user,
            items: itemsResult.rows,
            subtotal: subtotal.toFixed(2),
            tax: tax.toFixed(2),
            shipping: shipping.toFixed(2),
            total: total.toFixed(2)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error');
    }
});

// --- Checkout Page ---
app.get('/checkout', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const cartResult = await query('SELECT id FROM cart WHERE user_id = $1', [userId]);
        if (cartResult.rows.length === 0) {
            return res.redirect('/cart');
        }
        const cartId = cartResult.rows[0].id;
        
        const itemsResult = await query(`
            SELECT ci.*, p.name, p.price, p.image_url
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            WHERE ci.cart_id = $1
        `, [cartId]);
        
        if (itemsResult.rows.length === 0) {
            return res.redirect('/cart');
        }
        
        let subtotal = 0;
        itemsResult.rows.forEach(item => {
            subtotal += parseFloat(item.price) * item.quantity;
        });
        
        const tax = subtotal * 0.15;
        const shipping = subtotal > 500 ? 0 : 50;
        const total = subtotal + tax + shipping;
        
        res.render('pages/checkout', {
            title: 'Checkout',
            user: req.user,
            items: itemsResult.rows,
            subtotal: subtotal.toFixed(2),
            tax: tax.toFixed(2),
            shipping: shipping.toFixed(2),
            total: total.toFixed(2)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error');
    }
});

// --- Wishlist ---
app.get('/wishlist', verifyToken, async (req, res) => {
    try {
        const result = await query(`
            SELECT p.* FROM wishlist w
            JOIN products p ON w.product_id = p.id
            WHERE w.user_id = $1
        `, [req.user.id]);
        
        res.render('pages/wishlist', {
            title: 'My Wishlist',
            user: req.user,
            products: result.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error');
    }
});

// --- Profile ---
app.get('/profile', verifyToken, async (req, res) => {
    try {
        const userResult = await query(
            'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
            [req.user.id]
        );
        
        const ordersResult = await query(
            'SELECT COUNT(*) as total_orders FROM orders WHERE user_id = $1',
            [req.user.id]
        );
        
        const wishlistResult = await query(
            'SELECT COUNT(*) as total_wishlist FROM wishlist WHERE user_id = $1',
            [req.user.id]
        );
        
        const cartResult = await query(
            'SELECT COUNT(*) as total_cart FROM cart_items ci JOIN cart c ON ci.cart_id = c.id WHERE c.user_id = $1',
            [req.user.id]
        );
        
        res.render('pages/profile', {
            title: 'My Profile',
            user: req.user,
            profile: userResult.rows[0],
            stats: {
                orders: ordersResult.rows[0].total_orders || 0,
                wishlist: wishlistResult.rows[0].total_wishlist || 0,
                cart: cartResult.rows[0].total_cart || 0
            }
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
        const usersResult = await query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC');
        const ordersResult = await query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 20');
        const productsResult = await query('SELECT COUNT(*) as count FROM products');
        const totalOrders = await query('SELECT COUNT(*) as count, SUM(total_amount) as total FROM orders');
        const pendingOrders = await query('SELECT COUNT(*) as count FROM orders WHERE status = $1', ['pending']);
        
        res.render('pages/admin', { 
            title: 'Admin Dashboard',
            user: req.user,
            users: usersResult.rows,
            orders: ordersResult.rows,
            stats: {
                totalProducts: productsResult.rows[0].count,
                totalOrders: totalOrders.rows[0].count || 0,
                totalRevenue: totalOrders.rows[0].total || 0,
                pendingOrders: pendingOrders.rows[0].count || 0
            }
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

// --- About ---
app.get('/about', (req, res) => {
    const user = getUserFromCookie(req);
    res.render('pages/about', { 
        title: 'About Explore Essence',
        user: user
    });
});

// ============================================================
// API ROUTES
// ============================================================

// --- Search API ---
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);
        
        const result = await query(
            `SELECT * FROM products 
             WHERE name ILIKE $1 OR description ILIKE $1 
             ORDER BY name LIMIT 20`,
            [`%${q}%`]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Wishlist API ---
app.post('/api/wishlist/add', verifyToken, async (req, res) => {
    try {
        const { product_id } = req.body;
        await query(
            'INSERT INTO wishlist (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [req.user.id, product_id]
        );
        res.json({ success: true, message: 'Added to wishlist' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/wishlist/remove/:productId', verifyToken, async (req, res) => {
    try {
        await query(
            'DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2',
            [req.user.id, req.params.productId]
        );
        res.json({ success: true, message: 'Removed from wishlist' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Reviews API ---
app.post('/api/reviews', verifyToken, async (req, res) => {
    try {
        const { product_id, rating, comment } = req.body;
        
        if (rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }
        
        await query(
            'INSERT INTO reviews (product_id, user_id, rating, comment) VALUES ($1, $2, $3, $4)',
            [product_id, req.user.id, rating, comment]
        );
        res.json({ success: true, message: 'Review added' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Checkout API ---
app.post('/api/checkout', verifyToken, async (req, res) => {
    const userId = req.user.id;
    const { shipping_address, payment_method = 'cash_on_delivery' } = req.body;
    
    if (!shipping_address) {
        return res.status(400).json({ error: 'Shipping address is required' });
    }
    
    try {
        const cartResult = await query('SELECT id FROM cart WHERE user_id = $1', [userId]);
        if (cartResult.rows.length === 0) {
            return res.status(404).json({ error: 'Cart not found' });
        }
        const cartId = cartResult.rows[0].id;
        
        const itemsResult = await query(`
            SELECT ci.*, p.name, p.price, p.stock
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            WHERE ci.cart_id = $1
        `, [cartId]);
        
        if (itemsResult.rows.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }
        
        let subtotal = 0;
        itemsResult.rows.forEach(item => {
            subtotal += parseFloat(item.price) * item.quantity;
        });
        
        const tax = subtotal * 0.15;
        const shipping = subtotal > 500 ? 0 : 50;
        const total = subtotal + tax + shipping;
        
        const orderId = uuidv4();
        const estimatedDelivery = new Date();
        estimatedDelivery.setDate(estimatedDelivery.getDate() + 5);
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            await client.query(
                `INSERT INTO orders (id, user_id, total_amount, status, shipping_address, payment_method, estimated_delivery) 
                 VALUES ($1, $2, $3, 'pending', $4, $5, $6)`,
                [orderId, userId, total.toFixed(2), shipping_address, payment_method, estimatedDelivery]
            );
            
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
            
            await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
            
            await client.query('COMMIT');
            
            res.status(201).json({
                success: true,
                order_id: orderId,
                total: total.toFixed(2),
                items: itemsResult.rows,
                estimated_delivery: estimatedDelivery,
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

// --- Update Order Status (Admin) ---
app.put('/api/orders/:orderId/status', verifyToken, verifyAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { status, tracking_number } = req.body;
    
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    
    try {
        if (tracking_number) {
            await query(
                'UPDATE orders SET status = $1, tracking_number = $2 WHERE id = $3 RETURNING id',
                [status, tracking_number, orderId]
            );
        } else {
            await query(
                'UPDATE orders SET status = $1 WHERE id = $2 RETURNING id',
                [status, orderId]
            );
        }
        res.json({ success: true, message: 'Order status updated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update order' });
    }
});
// ============================================================
// SUITS ROUTES
// ============================================================

// Get all suits (API)
app.get('/api/suits', async (req, res) => {
    try {
        const result = await query('SELECT * FROM suits ORDER BY featured DESC, created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Get single suit (API)
app.get('/api/suits/:id', async (req, res) => {
    try {
        const result = await query('SELECT * FROM suits WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Suit not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Get featured suits (API)
app.get('/api/suits/featured', async (req, res) => {
    try {
        const result = await query('SELECT * FROM suits WHERE featured = 1 ORDER BY created_at DESC LIMIT 6');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- Suits Page (Web) ---
app.get('/suits', async (req, res) => {
    try {
        const user = getUserFromCookie(req);
        const result = await query('SELECT * FROM suits ORDER BY featured DESC, created_at DESC');
        res.render('pages/suits', {
            title: 'Suits Collection',
            user: user,
            suits: result.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error');
    }
});

// --- Suit Detail Page (Web) ---
app.get('/suits/:id', async (req, res) => {
    try {
        const user = getUserFromCookie(req);
        const result = await query('SELECT * FROM suits WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).send('Suit not found');
        }
        res.render('pages/suit-detail', {
            title: result.rows[0].product_name,
            user: user,
            suit: result.rows[0]
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error');
    }
});
// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Explore Essence API is running',
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// 404 HANDLER
// ============================================================

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