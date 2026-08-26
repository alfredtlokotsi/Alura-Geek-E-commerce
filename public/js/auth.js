// ============================================================
// AUTHENTICATION FUNCTIONS
// ============================================================

const API_BASE = window.location.origin + '/api';

// DOM Elements
const authButtons = document.getElementById('authButtons');
const userMenu = document.getElementById('userMenu');
const userName = document.getElementById('userName');
const dropdownMenu = document.getElementById('dropdownMenu');
const userAvatar = document.getElementById('userAvatar');
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const logoutBtn = document.getElementById('logoutBtn');
const cartBadge = document.getElementById('cartBadge');

// Modal Elements
const loginModal = document.getElementById('loginModal');
const signupModal = document.getElementById('signupModal');
const closeLoginModal = document.getElementById('closeLoginModal');
const closeSignupModal = document.getElementById('closeSignupModal');
const switchToSignup = document.getElementById('switchToSignup');
const switchToLogin = document.getElementById('switchToLogin');
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const loginError = document.getElementById('loginError');
const signupError = document.getElementById('signupError');

// ============================================================
// TOKEN MANAGEMENT
// ============================================================

function getToken() {
    return localStorage.getItem('token');
}

function setToken(token) {
    localStorage.setItem('token', token);
}

function removeToken() {
    localStorage.removeItem('token');
}

function getUser() {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
}

function setUser(user) {
    localStorage.setItem('user', JSON.stringify(user));
}

function removeUser() {
    localStorage.removeItem('user');
}

function getAuthHeaders() {
    const token = getToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
}

// ============================================================
// API CALLS
// ============================================================

async function loginUser(email, password) {
    const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    return response.json();
}

async function signupUser(name, email, password) {
    const response = await fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
    });
    return response.json();
}

async function getCurrentUser() {
    const token = getToken();
    if (!token) return null;
    
    try {
        const response = await fetch(`${API_BASE}/auth/me`, {
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            const data = await response.json();
            return data.user;
        }
        return null;
    } catch (error) {
        return null;
    }
}

// ============================================================
// UI UPDATES
// ============================================================

function updateUI(user) {
    if (user) {
        if (authButtons) authButtons.style.display = 'none';
        if (userMenu) {
            userMenu.style.display = 'block';
            userMenu.classList.add('active');
        }
        if (userName) userName.textContent = user.name || 'User';
    } else {
        if (authButtons) authButtons.style.display = 'flex';
        if (userMenu) {
            userMenu.style.display = 'none';
            userMenu.classList.remove('active');
        }
        if (userName) userName.textContent = 'User';
    }
}

// ============================================================
// AUTHENTICATION FLOW
// ============================================================

async function handleLogin(email, password) {
    try {
        const result = await loginUser(email, password);
        
        if (result.success && result.token) {
            setToken(result.token);
            setUser(result.user);
            updateUI(result.user);
            closeAllModals();
            loadCartCount();
            showNotification('Logged in successfully!', 'success');
            setTimeout(() => window.location.reload(), 1000);
            return true;
        } else {
            loginError.textContent = result.error || 'Login failed';
            loginError.classList.add('active');
            return false;
        }
    } catch (error) {
        console.error('Login error:', error);
        loginError.textContent = 'An error occurred. Please try again.';
        loginError.classList.add('active');
        return false;
    }
}

async function handleSignup(name, email, password) {
    try {
        const result = await signupUser(name, email, password);
        
        if (result.success && result.token) {
            setToken(result.token);
            setUser(result.user);
            updateUI(result.user);
            closeAllModals();
            loadCartCount();
            showNotification('Account created successfully!', 'success');
            setTimeout(() => window.location.reload(), 1000);
            return true;
        } else {
            signupError.textContent = result.error || 'Signup failed';
            signupError.classList.add('active');
            return false;
        }
    } catch (error) {
        console.error('Signup error:', error);
        signupError.textContent = 'An error occurred. Please try again.';
        signupError.classList.add('active');
        return false;
    }
}

function handleLogout() {
    removeToken();
    removeUser();
    updateUI(null);
    loadCartCount();
    closeAllModals();
    dropdownMenu.classList.remove('active');
    showNotification('Logged out successfully', 'info');
    setTimeout(() => window.location.reload(), 500);
}

// ============================================================
// MODAL CONTROLS
// ============================================================

function openLoginModal() {
    if (loginError) loginError.classList.remove('active');
    if (loginForm) loginForm.reset();
    if (loginModal) loginModal.classList.add('active');
}

function openSignupModal() {
    if (signupError) signupError.classList.remove('active');
    if (signupForm) signupForm.reset();
    if (signupModal) signupModal.classList.add('active');
}

function closeAllModals() {
    if (loginModal) loginModal.classList.remove('active');
    if (signupModal) signupModal.classList.remove('active');
}

// ============================================================
// CART COUNT
// ============================================================

async function loadCartCount() {
    const token = getToken();
    if (!token) {
        if (cartBadge) cartBadge.textContent = '0';
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/cart`, {
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            const data = await response.json();
            if (cartBadge) cartBadge.textContent = data.item_count || 0;
        } else {
            if (cartBadge) cartBadge.textContent = '0';
        }
    } catch (error) {
        console.error('Error loading cart count:', error);
        if (cartBadge) cartBadge.textContent = '0';
    }
}

// ============================================================
// NOTIFICATIONS
// ============================================================

function showNotification(message, type = 'info') {
    const colors = {
        success: '#D4AF37',
        error: '#FF4444',
        info: '#3498db'
    };
    
    const notification = document.createElement('div');
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
// EVENT LISTENERS
// ============================================================

// Login
if (loginBtn) loginBtn.addEventListener('click', openLoginModal);
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        await handleLogin(email, password);
    });
}

// Signup
if (signupBtn) signupBtn.addEventListener('click', openSignupModal);
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('signupName').value;
        const email = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;
        await handleSignup(name, email, password);
    });
}

// Logout
if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

// Modal switches
if (switchToSignup) {
    switchToSignup.addEventListener('click', (e) => {
        e.preventDefault();
        closeAllModals();
        openSignupModal();
    });
}
if (switchToLogin) {
    switchToLogin.addEventListener('click', (e) => {
        e.preventDefault();
        closeAllModals();
        openLoginModal();
    });
}

// Close modals
if (closeLoginModal) closeLoginModal.addEventListener('click', closeAllModals);
if (closeSignupModal) closeSignupModal.addEventListener('click', closeAllModals);

// Close modals on backdrop click
if (loginModal) {
    loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) closeAllModals();
    });
}
if (signupModal) {
    signupModal.addEventListener('click', (e) => {
        if (e.target === signupModal) closeAllModals();
    });
}

// Close modals with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
});

// Toggle dropdown
if (userAvatar) {
    userAvatar.addEventListener('click', () => {
        if (dropdownMenu) dropdownMenu.classList.toggle('active');
    });
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (userAvatar && dropdownMenu) {
        if (!userAvatar.contains(e.target) && !dropdownMenu.contains(e.target)) {
            dropdownMenu.classList.remove('active');
        }
    }
});

// ============================================================
// INITIALIZATION
// ============================================================

// Check if user is already logged in
async function initAuth() {
    const token = getToken();
    if (token) {
        const user = await getCurrentUser();
        if (user) {
            setUser(user);
            updateUI(user);
        } else {
            // Token invalid
            removeToken();
            removeUser();
            updateUI(null);
        }
    }
    loadCartCount();
}

// Run initialization
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
});

// Expose functions to global scope for use in other scripts
window.ExploreEssence = {
    getToken,
    getUser,
    getAuthHeaders,
    loadCartCount,
    showNotification,
    logout: handleLogout
};