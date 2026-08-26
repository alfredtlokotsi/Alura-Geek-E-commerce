// ============================================================
// MAIN APPLICATION - Product Loading & Cart Functions
// ============================================================

const API_BASE = window.location.origin + '/api';

// ============================================================
// ADD TO CART FUNCTION
// ============================================================

async function addToCart(productId, quantity = 1) {
    const token = window.ExploreEssence?.getToken?.();
    
    if (!token) {
        window.ExploreEssence?.showNotification?.('Please log in to add items to cart.', 'error');
        document.getElementById('loginBtn')?.click();
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/cart/add`, {
            method: 'POST',
            headers: window.ExploreEssence?.getAuthHeaders?.() || {},
            body: JSON.stringify({ product_id: productId, quantity: quantity })
        });

        const data = await response.json();
        
        if (response.ok) {
            window.ExploreEssence?.loadCartCount?.();
            window.ExploreEssence?.showNotification?.('✅ Item added to cart!', 'success');
        } else {
            window.ExploreEssence?.showNotification?.(data.error || 'Failed to add to cart', 'error');
        }
    } catch (error) {
        console.error('Error adding to cart:', error);
        window.ExploreEssence?.showNotification?.('An error occurred. Please try again.', 'error');
    }
}

// ============================================================
// LOAD PRODUCTS
// ============================================================

async function loadProducts() {
    const grid = document.getElementById('productGrid');
    if (!grid) return;
    
    try {
        const response = await fetch(`${API_BASE}/products`);
        const products = await response.json();
        
        if (products.length === 0) {
            grid.innerHTML = '<p style="text-align:center;color:#888;">No products available.</p>';
            return;
        }
        
        grid.innerHTML = products.map(product => `
            <div class="product-card">
                <img src="/images/${product.image_url || 'placeholder.jpg'}" 
                     alt="${product.name}" 
                     onerror="this.src='/images/placeholder.jpg'">
                <div class="info">
                    <h3>${product.name}</h3>
                    <p class="price">R ${product.price.toFixed(2)}</p>
                    <button class="btn btn-primary btn-sm add-to-cart-btn" 
                            data-id="${product.id}"
                            onclick="addToCart(${product.id})">
                        <i class="fas fa-cart-plus"></i> Add to Cart
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading products:', error);
        grid.innerHTML = '<p style="text-align:center;color:#FF4444;">Failed to load products. Please try again.</p>';
    }
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    loadProducts();
    
    // Also load products on any page with product grid
    if (document.getElementById('productGrid')) {
        loadProducts();
    }
});

// Make addToCart global for onclick handlers
window.addToCart = addToCart;