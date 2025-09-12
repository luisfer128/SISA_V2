// login.js
import { saveData } from './indexeddb-storage.js';

const API_BASE = 'http://26.127.175.34:5000';

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const errorDiv = document.getElementById('login-error');
  const submitBtn = document.getElementById('loginSubmit');

  // Partículas
  if (window.particlesJS) {
    particlesJS('particles-js', {
      particles: {
        number: { value: 80, density: { enable: true, value_area: 800 } },
        color: { value: '#00f3ff' },
        shape: { type: 'circle' },
        opacity: { value: 0.5, random: true },
        size: { value: 6, random: true },
        line_linked: { enable: true, distance: 150, color: '#00f3ff', opacity: 0.4, width: 1 },
        move: { enable: true, speed: 2, direction: 'none', straight: false, out_mode: 'out',
          attract: { enable: false, rotateX: 600, rotateY: 1200 } }
      },
      interactivity: {
        detect_on: 'canvas',
        events: { onhover: { enable: true, mode: 'repulse' }, onclick: { enable: true, mode: 'push' }, resize: true },
        modes: { repulse: { distance: 100, duration: 0.4 }, push: { particles_nb: 4 } }
      },
      retina_detect: true
    });
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    // Limpia error
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';

    if (!username || !password) {
      errorDiv.textContent = 'Por favor, completa todos los campos.';
      errorDiv.style.display = 'block';
      return;
    }

    // Estado de carga
    submitBtn?.classList.add('is-loading');
    submitBtn.disabled = true;

    try {
      const body = new URLSearchParams({ usuario: username, clave: password });
      const response = await fetch(`${API_BASE}/auth/ug`, { method: 'POST', body });

      let result = {};
      try { result = await response.json(); } catch {}

      if (response.ok && result?.ok === true) {
        if (result.registrado === true && result.usuario) {
          const u = result.usuario; 
          // { id, usuario, rolId, rolNombre, estado, facultadCod, carreraCod }

          if (u.estado === false) {
            errorDiv.textContent = 'Tu usuario está inactivo. Contacta al administrador.';
            errorDiv.style.display = 'block';
          } else {
            const userData = {
              id: u.id,
              usuario: u.usuario,
              rolId: u.rolId,
              facultadCod: u.facultadCod || null,
              carreraCod: u.carreraCod || null
            };

            // Sesión válida por 30 minutos
            const expirationTime = Date.now() + (30 * 60 * 1000);
            await saveData('isLoggedIn', true);
            await saveData('userData', userData);
            await saveData('sessionExpiresAt', expirationTime);

            window.location.href = 'index.html';
          }
        } else {
          errorDiv.textContent = 'Usuario válido en UG, pero no está registrado en el sistema.';
          errorDiv.style.display = 'block';
        }
      } else {
        errorDiv.textContent = 'Credenciales incorrectas.';
        errorDiv.style.display = 'block';
      }
    } catch (error) {
      console.error('❌ Error al conectar con el backend:', error);
      errorDiv.textContent = 'Error al conectar con el servidor. Intenta nuevamente.';
      errorDiv.style.display = 'block';
    } finally {
      submitBtn?.classList.remove('is-loading');
      submitBtn.disabled = false;
    }
  });
});
