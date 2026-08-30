// ============================================================
// EXPLORE ESSENCE - MAIN APPLICATION
// ============================================================

const API_BASE = window.location.origin + '/api';

// ============================================================
// ADD TO CART FUNCTION
// ============================================================

async function addToCart(productId) {
    console.log('🛒 Adding product to cart:', productId);
    
    const token = localStorage.getItem('token');
    console.log('Token exists?', !!token);
    
    if (!token) {
        alert('Please log in first!');
        document.getElementById('loginBtn')?.click();
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/cart/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ product_id: parseInt(productId), quantity: 1 })
        });

        console.log('Response status:', response.status);
        const data = await response.json();
        console.log('Response data:', data);
        
        if (response.ok) {
            showNotification('✅ Item added to cart!', 'success');
            // Update cart badge
            loadCartCount();
        } else {
            showNotification(data.error || 'Failed to add to cart', 'error');
        }
    } catch (error) {
        console.error('Error adding to cart:', error);
        showNotification('An error occurred. Please try again.', 'error');
    }
}

// ============================================================
// LOAD CART COUNT
// ============================================================

async function loadCartCount() {
    const token = localStorage.getItem('token');
    const badge = document.getElementById('cartBadge');
    
    if (!token) {
        if (badge) badge.textContent = '0';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/cart`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (badge) badge.textContent = data.item_count || 0;
        } else {
            if (badge) badge.textContent = '0';
        }
    } catch (error) {
        console.error('Error loading cart count:', error);
        if (badge) badge.textContent = '0';
    }
}

// ============================================================
// NOTIFICATION FUNCTION
// ============================================================

function showNotification(message, type = 'info') {
    const colors = {
        success: '#D4AF37',
        error: '#FF4444',
        info: '#3498db'
    };
    
    // Remove existing notifications
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();
    
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 16px 24px;
        background: #1A1A1A;
        color: #FFFFFF;
        border-left: 4px solid ${colors[type] || '#888'};
        border-radius: 8px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.5);
        z-index: 9999;
        max-width: 400px;
        animation: slideIn 0.3s ease;
        font-size: 0.95rem;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// ============================================================
// ADD TO WISHLIST
// ============================================================

async function addToWishlist(productId) {
    const token = localStorage.getItem('token');
    if (!token) {
        alert('Please log in first!');
        document.getElementById('loginBtn')?.click();
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/wishlist/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ product_id: parseInt(productId) })
        });

        const data = await response.json();
        
        if (response.ok) {
            showNotification('❤️ Added to wishlist!', 'success');
        } else {
            showNotification(data.error || 'Failed to add to wishlist', 'error');
        }
    } catch (error) {
        console.error('Error adding to wishlist:', error);
        showNotification('An error occurred. Please try again.', 'error');
    }
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Explore Essence loaded');
    loadCartCount();
});

// Make functions globally available for onclick handlers
window.addToCart = addToCart;
window.addToWishlist = addToWishlist;
window.loadCartCount = loadCartCount;
window.showNotification = showNotification;

console.log('✅ App.js loaded successfully');