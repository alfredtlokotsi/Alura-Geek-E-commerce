const API_BASE = window.location.origin + '/api';

function getToken() { return localStorage.getItem('token'); }
function setToken(token) {
    localStorage.setItem('token', token);
    document.cookie = `token=${token}; path=/; max-age=${7 * 24 * 60 * 60}`;
}
function removeToken() {
    localStorage.removeItem('token');
    document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}
function getUser() {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
}
function setUser(user) { localStorage.setItem('user', JSON.stringify(user)); }
function removeUser() { localStorage.removeItem('user'); }

// Elements
const authButtons = document.getElementById('authButtons');
const userMenu = document.getElementById('userMenu');
const userName = document.getElementById('userName');
const dropdownMenu = document.getElementById('dropdownMenu');
const userAvatar = document.getElementById('userAvatar');
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const logoutBtn = document.getElementById('logoutBtn');
const loginModal = document.getElementById('loginModal');
const signupModal = document.getElementById('signupModal');
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');

function openLoginModal() {
    document.getElementById('loginError')?.classList.remove('active');
    loginForm?.reset();
    loginModal?.classList.add('active');
}
function openSignupModal() {
    document.getElementById('signupError')?.classList.remove('active');
    signupForm?.reset();
    signupModal?.classList.add('active');
}
function closeAllModals() {
    loginModal?.classList.remove('active');
    signupModal?.classList.remove('active');
}

function updateUI(user) {
    if (user) {
        if (authButtons) authButtons.style.display = 'none';
        if (userMenu) { userMenu.style.display = 'block'; userMenu.classList.add('active'); }
        if (userName) userName.textContent = user.name;
    } else {
        if (authButtons) authButtons.style.display = 'flex';
        if (userMenu) { userMenu.style.display = 'none'; userMenu.classList.remove('active'); }
    }
}

async function handleLogin(email, password) {
    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const result = await response.json();
        
        if (result.success) {
            setToken(result.token);
            setUser(result.user);
            updateUI(result.user);
            closeAllModals();
            if (typeof loadCartCount === 'function') loadCartCount();
            if (typeof showNotification === 'function') showNotification('Logged in!', 'success');
            setTimeout(() => window.location.reload(), 500);
        } else {
            const err = document.getElementById('loginError');
            if (err) { err.textContent = result.error; err.classList.add('active'); }
        }
    } catch (error) { console.error(error); }
}

async function handleSignup(name, email, password) {
    try {
        const response = await fetch(`${API_BASE}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });
        const result = await response.json();
        
        if (result.success) {
            setToken(result.token);
            setUser(result.user);
            updateUI(result.user);
            closeAllModals();
            if (typeof loadCartCount === 'function') loadCartCount();
            if (typeof showNotification === 'function') showNotification('Account created!', 'success');
            setTimeout(() => window.location.reload(), 500);
        } else {
            const err = document.getElementById('signupError');
            if (err) { err.textContent = result.error; err.classList.add('active'); }
        }
    } catch (error) { console.error(error); }
}

function handleLogout() {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    removeToken();
    removeUser();
    updateUI(null);
    if (typeof loadCartCount === 'function') loadCartCount();
    setTimeout(() => window.location.reload(), 300);
}

// Event listeners
loginBtn?.addEventListener('click', openLoginModal);
signupBtn?.addEventListener('click', openSignupModal);
logoutBtn?.addEventListener('click', (e) => { e.preventDefault(); handleLogout(); });
document.getElementById('closeLoginModal')?.addEventListener('click', closeAllModals);
document.getElementById('closeSignupModal')?.addEventListener('click', closeAllModals);
document.getElementById('switchToSignup')?.addEventListener('click', (e) => { e.preventDefault(); closeAllModals(); openSignupModal(); });
document.getElementById('switchToLogin')?.addEventListener('click', (e) => { e.preventDefault(); closeAllModals(); openLoginModal(); });

loginForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleLogin(document.getElementById('loginEmail').value, document.getElementById('loginPassword').value);
});

signupForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSignup(
        document.getElementById('signupName').value,
        document.getElementById('signupEmail').value,
        document.getElementById('signupPassword').value
    );
});

userAvatar?.addEventListener('click', () => dropdownMenu?.classList.toggle('active'));

document.addEventListener('click', (e) => {
    if (userAvatar && dropdownMenu && !userAvatar.contains(e.target) && !dropdownMenu.contains(e.target)) {
        dropdownMenu.classList.remove('active');
    }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });

// Init
document.addEventListener('DOMContentLoaded', () => {
    const user = getUser();
    if (user) updateUI(user);
});