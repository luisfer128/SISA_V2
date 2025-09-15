// navbar.js
import { loadData, removeData, saveData } from './indexeddb-storage.js';

const API_BASE = 'http://26.127.175.34:5000';

let currentUser = null;

// Detectar si estamos en /Modules/
function inModules() {
  return location.pathname.toLowerCase().includes('/modules/');
}

// Detectar la ruta correcta del navbar
function getNavbarPath() {
  return inModules() ? '../navbar.html' : 'navbar.html';
}

// Cargar navbar dinámico
async function loadNavbar() {
  const container = document.getElementById("navbar-container");
  if (!container) return;

  try {
    const res = await fetch(getNavbarPath());
    if (!res.ok) throw new Error("No se pudo cargar navbar");
    container.innerHTML = await res.text();

    
    await loadUserProfile();// carga datos de usuario actualizados
    createNavButtons();    // carga los botones de navegación
    displayUserInfo();      // renderiza datos en el navbar
    setupLogout();          // inicializa logout
  } catch (err) {
    console.error("Error cargando navbar:", err);
  }
}

// ================== NAV LINKS ==================
function createNavButtons() {
  const navbarRight = document.querySelector(".navbar-right");
  if (!navbarRight) return;

  const links = [
    { id: "home-btn", icon: "fas fa-home", text: "Inicio", path: inModules() ? "../index.html" : "index.html" },
    { id: "profile-btn", icon: "fas fa-user-circle", text: "Perfil", path: inModules() ? "../perfil.html" : "perfil.html" },
  ];

  links.forEach(link => {
    const a = document.createElement("a");
    a.id = link.id;
    a.href = link.path;
    a.className = "nav-btn";
    a.innerHTML = `<i class="${link.icon}"></i><span>${link.text}</span>`;
    navbarRight.appendChild(a);
  });

  // Agregar botón de logout
  const logoutBtn = document.createElement("button");
  logoutBtn.id = "logout-btn";
  logoutBtn.className = "nav-logout";
  logoutBtn.textContent = "Cerrar";
  navbarRight.appendChild(logoutBtn);

  setupLogout(); // inicializamos el logout
}


// ================== USUARIO ==================
async function loadUserProfile() {
  try {
    let localUser = await loadData('userData');
    if (!localUser) {
      // Si no hay usuario, redirigir a login
      const target = inModules() ? '../login.html' : 'login.html';
      location.href = target;
      return;
    }

    // Petición al backend para datos actualizados
    const headers = {
      'X-User-Email': localUser.usuario,
      'Content-Type': 'application/json'
    };

    const response = await fetch(`${API_BASE}/user/profile`, { headers });
    if (response.ok) {
      const profile = await response.json();
      currentUser = { ...localUser, ...profile };
      await saveData('userData', currentUser);
    } else {
      currentUser = localUser; // fallback a lo local
    }
  } catch (error) {
    console.warn("Error cargando perfil:", error);
  }
}

function displayUserInfo() {
  const userInfoContainer = document.getElementById("navbar-userinfo");
  if (!userInfoContainer || !currentUser) return;

  const name = currentUser.usuario || "Sin nombre";
  const role = currentUser.rol || "Sin rol";
  const faculty = currentUser.facultad || "Sin facultad";
  const initials = getInitials(name);

  userInfoContainer.innerHTML = `
    <div class="user-block" title="${escapeHtml(name)} — ${escapeHtml(role)}">
      <div class="avatar">${initials}</div>
      <div class="user-meta">
        <div class="user-name">${escapeHtml(name)}</div>
        <div class="user-tags">
          <div class="user-sub">${escapeHtml(role)}</div>
          <div class="user-fac">${escapeHtml(faculty)}</div>
        </div>
      </div>
    </div>
  `;
}

// ================== LOGOUT ==================
function setupLogout() {
  const logoutBtn = document.getElementById("logout-btn");
  if (!logoutBtn) return;

  logoutBtn.onclick = async () => {
    await removeData("isLoggedIn");
    await removeData("sessionExpiresAt");
    await removeData("userData");
    await removeData("userPermissions");

    const target = inModules() ? '../login.html' : 'login.html';
    location.href = target;
  };
}

// ================== HELPERS ==================
function getInitials(name = "") {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (s) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[s]));
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", loadNavbar);
