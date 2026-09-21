const API_BASE = window.location.origin + '/api';

async function addToCart(productId) {
    const token = localStorage.getItem('token');
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

        const data = await response.json();
        
        if (response.ok) {
            showNotification('✅ Added to cart!', 'success');
            loadCartCount();
        } else {
            showNotification(data.error || 'Failed to add', 'error');
        }
    } catch (error) {
        console.error(error);
        showNotification('An error occurred', 'error');
    }
}

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
        if (response.ok) showNotification('❤️ Added to wishlist!', 'success');
    } catch (error) { console.error(error); }
}

async function loadCartCount() {
    const token = localStorage.getItem('token');
    const badge = document.getElementById('cartBadge');
    if (!token) { if (badge) badge.textContent = '0'; return; }
    try {
        const response = await fetch(`${API_BASE}/cart`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const data = await response.json();
            if (badge) badge.textContent = data.item_count || 0;
        }
    } catch (error) { console.error(error); }
}

function showNotification(message, type = 'info') {
    const colors = { success: '#D4AF37', error: '#FF4444', info: '#3498db' };
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();
    
    const n = document.createElement('div');
    n.className = 'notification';
    n.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; padding: 16px 24px;
        background: #1A1A1A; color: #FFFFFF; border-left: 4px solid ${colors[type]};
        border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
        z-index: 9999; max-width: 400px; font-size: 0.95rem;
    `;
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => {
        n.style.opacity = '0';
        n.style.transition = 'opacity 0.3s';
        setTimeout(() => n.remove(), 300);
    }, 3000);
}

window.addToCart = addToCart;
window.addToWishlist = addToWishlist;
window.loadCartCount = loadCartCount;
window.showNotification = showNotification;

document.addEventListener('DOMContentLoaded', () => loadCartCount());