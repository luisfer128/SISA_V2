import os
from io import BytesIO
from pathlib import Path

import msal
import requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

from database import (
    guardar_archivo_excel,
    listar_archivos_por_facultad,
    guardar_plantillas_por_tipo,
    obtener_plantillas_por_tipo,
    conectar,
    crear_usuario,
    obtener_usuario_por_usuario,
    inicializar_base_datos,
    listar_usuarios_con_filtros,
    obtener_roles,
    obtener_facultades,
    obtener_carreras_por_facultad,
    obtener_correo_autoridad,
    actualizar_correo_autoridad
)

# ======================= CARGA .ENV ===========================
BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / "archivos" / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)

# ======================= FLASK APP ===========================
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# ======================= CONFIG ===========================
UG_AUTH_URL = os.getenv("UG_AUTH_URL",
                        "https://servicioenlinea.ug.edu.ec/SeguridadTestAPI/api/CampusVirtual/ValidarCuentaInstitucionalv3")
USUARIO_OUTLOOK = os.getenv("OUTLOOK_USER")
CLIENT_ID = os.getenv("MS_CLIENT_ID")
CLIENT_SECRET = os.getenv("MS_CLIENT_SECRET")
TENANT_ID = os.getenv("MS_TENANT_ID", "250f76e7-6105-42e3-82d0-be7c460aea59")
SCOPES = ["https://graph.microsoft.com/.default"]
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "10"))

# ======================= INICIALIZACIÓN BD ===========================
print("🚀 Iniciando aplicación FACAF...")
if inicializar_base_datos():
    print("✅ Sistema listo - Base de datos inicializada correctamente")
else:
    print("❌ ADVERTENCIA: Problemas en inicialización de BD")


# ======================= AUTENTICACIÓN  ===========================
def get_current_user():
    """Obtiene el usuario actual desde los headers con logging detallado"""
    user_email = request.headers.get('X-User-Email')

    if not user_email:
        print("❌ get_current_user: No X-User-Email header found")
        print(f"📋 Available headers: {dict(request.headers)}")
        return None

    print(f"🔍 get_current_user: Looking for user '{user_email}'")

    try:
        user = obtener_usuario_por_usuario(user_email)
        if user:
            print(f"✅ get_current_user: Found user {user_email} with role {user.get('rolNombre')}")
        else:
            print(f"❌ get_current_user: User {user_email} not found in database")

        return user
    except Exception as e:
        print(f"❌ get_current_user: Database error for {user_email}: {e}")
        return None


def require_login(f):
    """Decorador simple que solo requiere estar logueado"""
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'error': 'No autenticado'}), 401
        if not user.get('estado'):
            return jsonify({'error': 'Usuario inactivo'}), 403

        # Agregar usuario al request para usarlo en los endpoints
        request.current_user = user
        return f(*args, **kwargs)

    return decorated_function


def require_role(*roles):
    """Decorador que requiere roles específicos"""

    def decorator(f):
        from functools import wraps
        @wraps(f)
        def decorated_function(*args, **kwargs):
            user = getattr(request, 'current_user', None)
            if not user:
                print("❌ require_role: No current_user found - missing @require_login?")
                return jsonify({'error': 'No autenticado - falta contexto de usuario'}), 401

            # Normalizar rol (minúsculas, sin espacios)
            user_role = (user.get('rolNombre') or '').strip().lower()
            required_roles = [role.strip().lower() for role in roles]

            print(f"🔍 Role check: user={user.get('usuario')}, role='{user_role}', required={required_roles}")

            if user_role not in required_roles:
                print(f"❌ Access DENIED: '{user_role}' not in {required_roles}")
                return jsonify({
                    'error': 'Permisos insuficientes',
                    'userRole': user_role,
                    'requiredRoles': list(roles),
                    'message': f'Se requiere uno de estos roles: {", ".join(roles)}'
                }), 403

            print(f"✅ Access GRANTED for {user.get('usuario')} with role '{user_role}'")
            return f(*args, **kwargs)

        return decorated_function

    return decorator


# ======================= PERFIL DE USUARIO ===========================
@app.get('/user/profile')
@require_login
def get_user_profile():
    """Obtiene el perfil del usuario actual"""
    user = request.current_user
    return jsonify({
        'id': user['id'],
        'usuario': user['usuario'],
        'rol': user['rolNombre'],
        'rolId': user['rolId'],
        'facultad': user['facultadNombre'],
        'facultadCod': user['facultadCod'],
        'carrera': user['carreraNombre'],
        'carreraCod': user['carreraCod'],
        'estado': user['estado']
    })


@app.get('/user/permissions')
@require_login
def get_user_permissions():
    """Obtiene los permisos del usuario basado en su rol"""
    user = request.current_user
    user_role = user.get('rolNombre', '').lower()

    # Definir permisos por rol
    permissions = {
        'admin': {
            'can_upload': True,
            'can_delete': True,
            'can_view_all_faculties': True,
            'can_manage_users': True,
            'can_send_emails': True,
            'can_edit_templates': True,
            'can_access_admin_panel': True
        },
        'decano': {
            'can_upload': True,
            'can_delete': True,
            'can_view_all_faculties': False,
            'can_manage_users': False,
            'can_send_emails': True,
            'can_edit_templates': True,
            'can_access_admin_panel': False
        },
        'coordinador': {
            'can_upload': True,
            'can_delete': True,
            'can_view_all_faculties': False,
            'can_manage_users': False,
            'can_send_emails': True,
            'can_edit_templates': True,
            'can_access_admin_panel': False
        },
        'operador': {
            'can_upload': False,
            'can_delete': False,
            'can_view_all_faculties': False,
            'can_manage_users': False,
            'can_send_emails': False,
            'can_edit_templates': False,
            'can_access_admin_panel': False
        }
    }

    user_permissions = permissions.get(user_role, permissions['operador'])

    return jsonify({
        'role': user_role,
        'permissions': user_permissions,
        'user': {
            'usuario': user['usuario'],
            'facultad': user['facultadCod'],
            'carrera': user['carreraCod']
        }
    })


# ======================= CATÁLOGOS ===========================
@app.get('/api/roles')
@require_login
def api_get_roles():
    try:
        roles = obtener_roles()
        return jsonify(roles)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.get('/api/facultades')
@require_login
def api_get_facultades():
    try:
        facultades = obtener_facultades()
        return jsonify(facultades)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.get('/api/carreras/<facultad_cod>')
@require_login
def api_get_carreras(facultad_cod):
    try:
        carreras = obtener_carreras_por_facultad(facultad_cod)
        return jsonify(carreras)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ======================= ARCHIVOS ===========================
@app.post('/upload')
@require_login
def subir_archivo():
    """Subir archivo - verificar permisos según rol"""
    user = request.current_user
    user_role = user.get('rolNombre', '').lower()

    # Solo ciertos roles pueden subir archivos
    if user_role not in ['admin', 'decano', 'coordinador']:
        return jsonify({'error': 'No tienes permisos para subir archivos'}), 403

    archivo = request.files.get('file')
    if not archivo or archivo.filename.strip() == '':
        return jsonify({'error': 'No se envió archivo'}), 400

    facultad_cod = request.form.get('facultadCod') or request.args.get('facultadCod')
    if not facultad_cod:
        return jsonify({'error': 'FacultadCod es requerido'}), 400

    # Verificar permisos de facultad
    if user_role != 'admin' and facultad_cod != user['facultadCod']:
        return jsonify({'error': 'Solo puedes subir archivos a tu facultad'}), 403

    try:
        guardar_archivo_excel(archivo, facultad_cod)
        return jsonify({
            'message': f'Archivo "{archivo.filename}" guardado correctamente',
            'facultadCod': facultad_cod
        }), 200
    except Exception as e:
        return jsonify({'error': f'Error al guardar: {e}'}), 500


@app.get('/files')
@require_login
def listar_archivos():
    """Listar archivos según permisos del usuario"""
    user = request.current_user
    user_role = user.get('rolNombre', '').lower()

    # Determinar qué archivos puede ver
    if user_role == 'admin':
        # Admin puede ver archivos de cualquier facultad
        facultad_filter = request.args.get('facultadCod')
    else:
        # Otros usuarios solo ven archivos de su facultad
        facultad_filter = user['facultadCod']

    try:
        archivos = listar_archivos_por_facultad(facultad_filter)
        return jsonify({
            'archivos': archivos,
            'facultadFiltro': facultad_filter,
            'total': len(archivos),
            'userRole': user_role
        })
    except Exception as e:
        return jsonify({'error': f'Error al listar: {e}'}), 500


@app.get('/download/<int:archivo_id>')
@require_login
def descargar_archivo(archivo_id):
    """Descargar archivo con verificación de permisos"""
    user = request.current_user
    user_role = user.get('rolNombre', '').lower()

    try:
        # Verificar que el archivo existe y obtener info
        conn = conectar()
        cur = conn.cursor()
        cur.execute("""
            SELECT NombreArchivo, TipoMime, Datos, FacultadCod 
            FROM ArchivosExcel 
            WHERE Id = ?
        """, (archivo_id,))
        archivo_info = cur.fetchone()
        cur.close()
        conn.close()

        if not archivo_info:
            return jsonify({'error': 'Archivo no encontrado'}), 404

        nombre, tipo, contenido, archivo_facultad = archivo_info

        # Verificar permisos
        if user_role != 'admin' and archivo_facultad != user['facultadCod']:
            return jsonify({'error': 'No tienes permisos para descargar este archivo'}), 403

        bio = BytesIO(contenido)
        return send_file(
            bio,
            as_attachment=True,
            download_name=nombre,
            mimetype=tipo or 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        return jsonify({'error': f'Error al descargar: {e}'}), 500


@app.delete('/delete/by-name/<string:filename>')
@require_role('admin', 'decano', 'coordinador')
def eliminar_archivo(filename):
    """Eliminar archivo por nombre"""
    user = request.current_user
    user_role = user.get('rolNombre', '').lower()

    facultad_cod = request.args.get('facultadCod')

    # Verificar permisos de facultad
    if user_role != 'admin':
        if facultad_cod and facultad_cod != user['facultadCod']:
            return jsonify({'error': 'No puedes eliminar archivos de otra facultad'}), 403
        facultad_cod = user['facultadCod']

    try:
        conn = conectar()
        cursor = conn.cursor()

        if user_role == 'admin' and not facultad_cod:
            cursor.execute("DELETE FROM ArchivosExcel WHERE NombreArchivo = ?", (filename,))
        else:
            cursor.execute("""
                DELETE FROM ArchivosExcel 
                WHERE NombreArchivo = ? AND FacultadCod = ?
            """, (filename, facultad_cod))

        rows_affected = cursor.rowcount
        conn.commit()
        cursor.close()
        conn.close()

        if rows_affected > 0:
            return jsonify({'message': f'Archivo "{filename}" eliminado correctamente'}), 200
        else:
            return jsonify({'error': 'Archivo no encontrado'}), 404
    except Exception as e:
        return jsonify({'error': f'Error al eliminar: {e}'}), 500


# ======================= PLANTILLAS ===========================
@app.get('/plantillas')
@require_login
def get_plantillas():
    try:
        tipo = request.args.get('tipo', 'seguimiento')
        data = obtener_plantillas_por_tipo(tipo)
        return jsonify({
            'tipo': tipo,
            'plantillas': data
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.post('/plantillas')
@require_role('admin', 'coordinador', 'decano')
def update_plantillas():
    try:
        datos = request.get_json(silent=True) or {}
        tipo = datos.get('tipo', 'seguimiento')

        plantillas_data = {
            'autoridad': datos.get('autoridad', ''),
            'docente': datos.get('docente', ''),
            'estudiante': datos.get('estudiante', '')
        }

        guardar_plantillas_por_tipo(plantillas_data, tipo)
        return jsonify({'message': f'Plantillas actualizadas correctamente'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ======================= CORREO AUTORIDAD ===========================
@app.get('/correo-autoridad')
@require_login
def get_correo_autoridad_endpoint():
    try:
        correo = obtener_correo_autoridad()
        return jsonify({'correoAutoridad': correo})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.post('/correo-autoridad')
@require_role('admin', 'coordinador', 'decano')
def update_correo_autoridad_endpoint():
    try:
        datos = request.get_json(silent=True) or {}
        correo_autoridad = datos.get('correoAutoridad', '').strip()

        if not correo_autoridad:
            return jsonify({'error': 'correoAutoridad es requerido'}), 400

        # Validación básica de email
        import re
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, correo_autoridad):
            return jsonify({'error': 'Formato de correo inválido'}), 400

        success = actualizar_correo_autoridad(correo_autoridad)

        if success:
            return jsonify({'message': 'Correo actualizado correctamente'})
        else:
            return jsonify({'error': 'Error al actualizar correo'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ======================= USUARIOS ===========================
@app.get("/usuarios")
@require_login
@require_role('admin', 'decano')
def api_listar_usuarios():
    """Listar usuarios según permisos"""
    try:
        user = request.current_user
        user_role = (user.get('rolNombre') or '').strip().lower()

        # Parámetros de consulta
        q = (request.args.get("q") or "").strip()
        rol_id = request.args.get("rolId", type=int)
        page = max(0, int(request.args.get("page", 0)))
        limit = max(1, min(200, int(request.args.get("limit", 20))))
        activo_param = request.args.get("activo")  # '1', '0', o None

        # Convertir activo a boolean si es necesario
        activo_filter = None
        if activo_param == '1':
            activo_filter = True
        elif activo_param == '0':
            activo_filter = False

        print(f"📋 Listing users: q='{q}', rol_id={rol_id}, page={page}, limit={limit}, activo={activo_filter}")

        # Filtro de facultad según permisos
        facultad_filter = None
        if user_role == 'admin':
            facultad_filter = request.args.get("facultadCod")
        else:
            facultad_filter = user['facultadCod']

        resultado = listar_usuarios_con_filtros(
            facultad_cod=facultad_filter,
            rol_id=rol_id,
            q=q,
            page=page,
            limit=limit,
            activo=activo_filter  # Pasar el filtro boolean
        )

        print(f"📋 Found {len(resultado.get('data', []))} users (total: {resultado.get('total', 0)})")
        return jsonify(resultado), 200

    except Exception as e:
        print(f"❌ Error listing users: {e}")
        return jsonify({"error": f"Error al listar usuarios: {e}"}), 500


@app.post("/usuarios")
@require_login
@require_role('admin')
def api_crear_usuario():
    """Solo admin puede crear usuarios"""
    try:
        data = request.get_json(silent=True) or {}
        usuario = (data.get("usuario") or "").strip()
        rol_id = data.get("rolId")
        facultad_cod = data.get("facultadCod")
        carrera_cod = data.get("carreraCod")  # Puede ser None
        activo = data.get("activo", True)

        print(f"👤 Creating user: {usuario}, rolId={rol_id}, facultad={facultad_cod}")

        if not all([usuario, rol_id, facultad_cod]):
            return jsonify({"error": "Campos obligatorios: usuario, rolId, facultadCod"}), 400

        # Validar formato de email
        import re
        if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', usuario):
            return jsonify({"error": "El usuario debe ser un email válido"}), 400

        creado = crear_usuario(usuario, rol_id, facultad_cod, carrera_cod, bool(activo))
        print(f"✅ User created successfully: {creado}")

        return jsonify({"message": "Usuario creado exitosamente", "data": creado}), 201

    except Exception as e:
        print(f"❌ Error creating user: {e}")
        return jsonify({"error": str(e)}), 500


@app.put("/usuarios/<int:user_id>")
@require_login
@require_role('admin')
def api_actualizar_usuario(user_id):
    """Actualizar usuario existente"""
    try:
        data = request.get_json(silent=True) or {}

        # Verificar que el usuario existe
        conn = conectar()
        cur = conn.cursor()
        cur.execute("""
            SELECT u.Id, u.Usuario, u.Estado, r.Nombre as RolNombre
            FROM Usuarios u
            LEFT JOIN Rol r ON u.RolId = r.RolId
            WHERE u.Id = ?
        """, (user_id,))

        existing_user = cur.fetchone()
        if not existing_user:
            cur.close()
            conn.close()
            return jsonify({"error": "Usuario no encontrado"}), 404

        # Actualizar campos
        updates = []
        params = []

        if 'usuario' in data and data['usuario'].strip():
            updates.append("Usuario = ?")
            params.append(data['usuario'].strip())

        if 'rolId' in data:
            updates.append("RolId = ?")
            params.append(data['rolId'])

        if 'activo' in data:
            updates.append("Estado = ?")
            params.append(bool(data['activo']))

        if 'facultadCod' in data:
            updates.append("FacultadCod = ?")
            params.append(data['facultadCod'])

        if 'carreraCod' in data:
            updates.append("CarreraCod = ?")
            params.append(data['carreraCod'])

        if not updates:
            cur.close()
            conn.close()
            return jsonify({"error": "No hay campos para actualizar"}), 400

        # Ejecutar actualización
        params.append(user_id)
        sql = f"UPDATE Usuarios SET {', '.join(updates)} WHERE Id = ?"
        cur.execute(sql, params)
        conn.commit()

        # Obtener usuario actualizado
        cur.execute("""
            SELECT u.Id, u.Usuario, u.Estado, u.RolId, r.Nombre as RolNombre,
                   u.FacultadCod, f.Nombre as FacultadNombre, 
                   u.CarreraCod, c.Nombre as CarreraNombre
            FROM Usuarios u
            LEFT JOIN Rol r ON u.RolId = r.RolId
            LEFT JOIN Facultad f ON u.FacultadCod = f.FacultadCod
            LEFT JOIN Carrera c ON u.CarreraCod = c.CarreraCod
            WHERE u.Id = ?
        """, (user_id,))

        updated_user = cur.fetchone()
        cur.close()
        conn.close()

        print(f"✅ User {user_id} updated successfully")

        return jsonify({
            "message": "Usuario actualizado exitosamente",
            "data": {
                "id": updated_user[0],
                "usuario": updated_user[1],
                "estado": bool(updated_user[2]),
                "activo": bool(updated_user[2]),  # Alias para compatibilidad
                "rolId": updated_user[3],
                "rolNombre": updated_user[4],
                "facultadCod": updated_user[5],
                "facultadNombre": updated_user[6],
                "carreraCod": updated_user[7],
                "carreraNombre": updated_user[8]
            }
        }), 200

    except Exception as e:
        print(f"❌ Error updating user {user_id}: {e}")
        return jsonify({"error": str(e)}), 500


# ======================= ENVÍO DE CORREOS ===========================
msal_app = msal.ConfidentialClientApplication(
    CLIENT_ID,
    authority=f"https://login.microsoftonline.com/{TENANT_ID}",
    client_credential=CLIENT_SECRET
)


def obtener_token_graph():
    result = msal_app.acquire_token_for_client(scopes=SCOPES)
    if "access_token" in result:
        return result["access_token"]
    else:
        raise Exception(f"Error obteniendo token: {result.get('error_description', result)}")


def enviar_correo_graph(destinatarios, asunto, cuerpo):
    access_token = obtener_token_graph()
    graph_endpoint = f"https://graph.microsoft.com/v1.0/users/{USUARIO_OUTLOOK}/sendMail"
    to_recipients = [{"emailAddress": {"address": email}} for email in destinatarios]
    payload = {
        "message": {
            "subject": asunto,
            "body": {"contentType": "HTML", "content": cuerpo},
            "toRecipients": to_recipients
        },
        "saveToSentItems": "true"
    }
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    resp = requests.post(graph_endpoint, headers=headers, json=payload)
    if resp.status_code != 202:
        raise Exception(f"Error enviando correo: {resp.status_code} - {resp.text}")


@app.post('/send-email')
@require_role('admin', 'decano', 'coordinador')
def send_email():
    """Envío de correos para roles autorizados"""
    data = request.get_json(silent=True) or {}
    to_list = data.get("to")
    subject = data.get("subject", "FACAF Notificación Académica")
    body = data.get("body", "")

    if not to_list or not body:
        return jsonify({"error": "Faltan destinatarios o contenido"}), 400

    if isinstance(to_list, str):
        to_emails = [email.strip() for email in to_list.split(';') if email.strip()]
    elif isinstance(to_list, list):
        to_emails = [str(x).strip() for x in to_list if str(x).strip()]
    else:
        return jsonify({"error": "Formato incorrecto en campo 'to'"}), 400

    try:
        enviar_correo_graph(to_emails, subject, body)
        return jsonify({"message": "Correo enviado correctamente"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ======================= AUTENTICACIÓN UG ===========================
def _parse_ug_result(obj: dict):
    if not isinstance(obj, dict):
        return None, None
    node = obj.get("ug", obj)
    if not isinstance(node, dict):
        return None, None
    raw_id = node.get("id")
    mensaje = node.get("mensaje")
    try:
        id_int = int(str(raw_id).strip())
    except Exception:
        id_int = None
    return id_int, mensaje


@app.post("/auth/ug")
def proxy_auth():
    """Autenticación con UG"""
    data_json = request.get_json(silent=True) or {}
    usuario_in = (request.form.get('usuario') or data_json.get("usuario") or "").strip()
    clave = (request.form.get('clave') or data_json.get("clave") or "").strip()

    if not usuario_in or not clave:
        return jsonify({"id": 0, "mensaje": "Usuario/clave vacíos"}), 400

    try:
        resp = requests.post(
            UG_AUTH_URL,
            data={"usuario": usuario_in, "clave": clave},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=REQUEST_TIMEOUT
        )

        try:
            ug_payload = resp.json()
        except:
            ug_payload = {"status": resp.status_code, "text": resp.text}

        ug_id, ug_msg = _parse_ug_result(ug_payload)

        # Credenciales incorrectas
        if ug_id == 0:
            return jsonify({
                "ok": False,
                "ug": {"id": 0, "mensaje": ug_msg or "CREDENCIALES ERRADAS"}
            }), 401

        # Credenciales válidas
        if ug_id == 1:
            user_row = obtener_usuario_por_usuario(usuario_in)
            if user_row:
                return jsonify({
                    "ok": True,
                    "registrado": True,
                    "usuario": user_row
                }), 200

            # Usuario válido en UG pero no registrado localmente
            return jsonify({
                "ok": True,
                "registrado": False,
                "usuario": usuario_in,
                "mensaje": "Usuario válido en UG pero no registrado localmente"
            }), 200

        # Caso inesperado
        return jsonify({
            "ok": False,
            "ug": ug_payload,
            "mensaje": "Respuesta de UG sin 'id' válido"
        }), 502

    except requests.RequestException as e:
        return jsonify({
            "error": "No se pudo contactar con la API de la UG",
            "detalle": str(e)
        }), 502


# ======================= ENDPOINTS ADICIONALES ===========================
@app.get('/api/health')
def health_check():
    """Estado de la API con información detallada"""
    try:
        # Verificar conexión a BD
        conn = conectar()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM Usuarios")
        user_count = cur.fetchone()[0]
        cur.close()
        conn.close()
        db_status = "OK"

    except Exception as e:
        print(f"❌ Database health check failed: {e}")
        db_status = f"ERROR: {e}"
        user_count = 0

    return jsonify({
        'status': 'OK',
        'database': db_status,
        'user_count': user_count,
        'version': '1.0.0',
    })


@app.get("/debug/auth-info")
def debug_auth_info():
    """Endpoint para debugging de autenticación - SOLO PARA DESARROLLO"""
    headers = dict(request.headers)
    user_email = request.headers.get('X-User-Email')

    user_data = None
    if user_email:
        user_data = obtener_usuario_por_usuario(user_email)

    current_user = getattr(request, 'current_user', None)

    return jsonify({
        "request_headers": headers,
        "user_email": user_email,
        "user_data": user_data,
        "current_user": current_user,
        "endpoint": request.endpoint,
        "method": request.method,
        "url": request.url
    })

@app.post("/admin/panel")
@require_login  # CRÍTICO: Agregar esta línea
@require_role('admin')
def admin_panel():
    """Acceso al panel de administración"""
    try:
        user = request.current_user
        user_email = user['usuario']
        user_role = user['rolNombre']

        print(f"✅ Admin panel access GRANTED - User: {user_email}, Role: {user_role}")

        return jsonify({
            "url": "Modules/panel-admin.html",
            "message": "Acceso autorizado al panel de administración",
            "user": user_email,
            "role": user_role
        })
    except Exception as e:
        print(f"❌ Error in admin_panel: {e}")
        return jsonify({"error": "Error interno del servidor"}), 500


# ======================= GESTIÓN DE FACULTADES ===========================
@app.post('/api/facultades')
@require_login
@require_role('admin')
def create_facultad():
    """Crear nueva facultad - Solo admin"""
    try:
        data = request.get_json(silent=True) or {}
        codigo = (data.get("codigo") or "").strip().upper()
        nombre = (data.get("nombre") or "").strip()

        if not codigo or not nombre:
            return jsonify({"error": "Código y nombre son obligatorios"}), 400

        # Verificar que no exista
        conn = conectar()
        cur = conn.cursor()
        cur.execute("SELECT FacultadCod FROM Facultad WHERE FacultadCod = ?", (codigo,))
        if cur.fetchone():
            cur.close()
            conn.close()
            return jsonify({"error": f"La facultad con código '{codigo}' ya existe"}), 409

        # Crear facultad
        cur.execute("INSERT INTO Facultad (FacultadCod, Nombre) VALUES (?, ?)", (codigo, nombre))
        conn.commit()
        cur.close()
        conn.close()

        print(f"✅ Facultad creada: {codigo} - {nombre}")
        return jsonify({
            "message": "Facultad creada exitosamente",
            "data": {"codigo": codigo, "nombre": nombre}
        }), 201

    except Exception as e:
        print(f"❌ Error creating facultad: {e}")
        return jsonify({"error": str(e)}), 500


@app.put('/api/facultades/<string:facultad_cod>')
@require_login
@require_role('admin')
def update_facultad(facultad_cod):
    """Actualizar facultad existente"""
    try:
        data = request.get_json(silent=True) or {}
        nuevo_codigo = (data.get("codigo") or "").strip().upper()
        nuevo_nombre = (data.get("nombre") or "").strip()

        if not nuevo_codigo or not nuevo_nombre:
            return jsonify({"error": "Código y nombre son obligatorios"}), 400

        print(f"🔄 Updating facultad: {facultad_cod} -> {nuevo_codigo}, {nuevo_nombre}")

        conn = conectar()
        cur = conn.cursor()

        # Verificar que la facultad existe
        cur.execute("SELECT FacultadCod, Nombre FROM Facultad WHERE FacultadCod = ?", (facultad_cod,))
        facultad_actual = cur.fetchone()
        if not facultad_actual:
            cur.close()
            conn.close()
            return jsonify({"error": "Facultad no encontrada"}), 404

        print(f"📋 Current facultad: {facultad_actual}")

        # Si el código cambió, verificar que el nuevo no exista (excluyendo el actual)
        if nuevo_codigo != facultad_cod:
            cur.execute("SELECT FacultadCod FROM Facultad WHERE FacultadCod = ? AND FacultadCod != ?", (nuevo_codigo, facultad_cod))
            if cur.fetchone():
                cur.close()
                conn.close()
                return jsonify({"error": f"Ya existe una facultad con código '{nuevo_codigo}'"}), 409

        # Actualizar facultad
        cur.execute("""
            UPDATE Facultad 
            SET FacultadCod = ?, Nombre = ? 
            WHERE FacultadCod = ?
        """, (nuevo_codigo, nuevo_nombre, facultad_cod))

        # Si cambió el código, actualizar referencias en otras tablas
        if nuevo_codigo != facultad_cod:
            print(f"🔄 Updating references: {facultad_cod} -> {nuevo_codigo}")
            cur.execute("UPDATE Usuarios SET FacultadCod = ? WHERE FacultadCod = ?", (nuevo_codigo, facultad_cod))
            cur.execute("UPDATE Carrera SET FacultadCod = ? WHERE FacultadCod = ?", (nuevo_codigo, facultad_cod))
            cur.execute("UPDATE ArchivosExcel SET FacultadCod = ? WHERE FacultadCod = ?", (nuevo_codigo, facultad_cod))

        conn.commit()
        cur.close()
        conn.close()

        print(f"✅ Facultad actualizada: {facultad_cod} -> {nuevo_codigo} - {nuevo_nombre}")
        return jsonify({
            "message": "Facultad actualizada exitosamente",
            "data": {"codigo": nuevo_codigo, "nombre": nuevo_nombre}
        }), 200

    except Exception as e:
        print(f"❌ Error updating facultad: {e}")
        return jsonify({"error": str(e)}), 500


@app.delete('/api/facultades/<string:facultad_cod>')
@require_login
@require_role('admin')
def delete_facultad(facultad_cod):
    """Eliminar facultad - Solo admin"""
    try:
        conn = conectar()
        cur = conn.cursor()

        # Verificar que la facultad existe
        cur.execute("SELECT Nombre FROM Facultad WHERE FacultadCod = ?", (facultad_cod,))
        facultad = cur.fetchone()
        if not facultad:
            cur.close()
            conn.close()
            return jsonify({"error": "Facultad no encontrada"}), 404

        # Verificar si hay usuarios asociados
        cur.execute("SELECT COUNT(*) FROM Usuarios WHERE FacultadCod = ?", (facultad_cod,))
        usuarios_count = cur.fetchone()[0]

        # Verificar si hay carreras asociadas
        cur.execute("SELECT COUNT(*) FROM Carrera WHERE FacultadCod = ?", (facultad_cod,))
        carreras_count = cur.fetchone()[0]

        # Verificar si hay archivos asociados
        cur.execute("SELECT COUNT(*) FROM ArchivosExcel WHERE FacultadCod = ?", (facultad_cod,))
        archivos_count = cur.fetchone()[0]

        if usuarios_count > 0 or carreras_count > 0 or archivos_count > 0:
            cur.close()
            conn.close()
            return jsonify({
                "error": f"No se puede eliminar la facultad '{facultad[0]}' porque tiene datos asociados",
                "details": {
                    "usuarios": usuarios_count,
                    "carreras": carreras_count,
                    "archivos": archivos_count
                }
            }), 409

        # Eliminar facultad
        cur.execute("DELETE FROM Facultad WHERE FacultadCod = ?", (facultad_cod,))
        conn.commit()
        cur.close()
        conn.close()

        print(f"✅ Facultad eliminada: {facultad_cod} - {facultad[0]}")
        return jsonify({"message": f"Facultad '{facultad[0]}' eliminada exitosamente"}), 200

    except Exception as e:
        print(f"❌ Error deleting facultad: {e}")
        return jsonify({"error": str(e)}), 500


# ======================= GESTIÓN DE CARRERAS ===========================
@app.post('/api/carreras')
@require_login
@require_role('admin')
def create_carrera():
    """Crear nueva carrera - Solo admin"""
    try:
        data = request.get_json(silent=True) or {}
        codigo = (data.get("codigo") or "").strip().upper()
        nombre = (data.get("nombre") or "").strip()
        facultad_cod = (data.get("facultadCod") or "").strip().upper()

        if not codigo or not nombre or not facultad_cod:
            return jsonify({"error": "Código, nombre y facultad son obligatorios"}), 400


        conn = conectar()
        cur = conn.cursor()

        # Verificar que la facultad existe
        cur.execute("SELECT Nombre FROM Facultad WHERE FacultadCod = ?", (facultad_cod,))
        if not cur.fetchone():
            cur.close()
            conn.close()
            return jsonify({"error": f"La facultad '{facultad_cod}' no existe"}), 404

        # Verificar que no exista la carrera
        cur.execute("SELECT CarreraCod FROM Carrera WHERE CarreraCod = ?", (codigo,))
        if cur.fetchone():
            cur.close()
            conn.close()
            return jsonify({"error": f"La carrera con código '{codigo}' ya existe"}), 409

        # Crear carrera
        cur.execute("""
            INSERT INTO Carrera (CarreraCod, FacultadCod, Nombre) 
            VALUES (?, ?, ?)
        """, (codigo, facultad_cod, nombre))
        conn.commit()
        cur.close()
        conn.close()

        print(f"✅ Carrera creada: {codigo} - {nombre} (Facultad: {facultad_cod})")
        return jsonify({
            "message": "Carrera creada exitosamente",
            "data": {"codigo": codigo, "nombre": nombre, "facultadCod": facultad_cod}
        }), 201

    except Exception as e:
        print(f"❌ Error creating carrera: {e}")
        return jsonify({"error": str(e)}), 500


@app.put('/api/carreras/<string:carrera_cod>')
@require_login
@require_role('admin')
def update_carrera(carrera_cod):
    """Actualizar carrera existente"""
    try:
        data = request.get_json(silent=True) or {}
        nuevo_codigo = (data.get("codigo") or "").strip().upper()
        nuevo_nombre = (data.get("nombre") or "").strip()
        nueva_facultad_cod = (data.get("facultadCod") or "").strip().upper()

        if not nuevo_codigo or not nuevo_nombre or not nueva_facultad_cod:
            return jsonify({"error": "Código, nombre y facultad son obligatorios"}), 400


        conn = conectar()
        cur = conn.cursor()

        # Verificar que la carrera existe
        cur.execute("SELECT CarreraCod FROM Carrera WHERE CarreraCod = ?", (carrera_cod,))
        if not cur.fetchone():
            cur.close()
            conn.close()
            return jsonify({"error": "Carrera no encontrada"}), 404

        # Verificar que la facultad existe
        cur.execute("SELECT Nombre FROM Facultad WHERE FacultadCod = ?", (nueva_facultad_cod,))
        if not cur.fetchone():
            cur.close()
            conn.close()
            return jsonify({"error": f"La facultad '{nueva_facultad_cod}' no existe"}), 404

        # Si el código cambió, verificar que el nuevo no exista
        if nuevo_codigo != carrera_cod:
            cur.execute("SELECT CarreraCod FROM Carrera WHERE CarreraCod = ?", (nuevo_codigo,))
            if cur.fetchone():
                cur.close()
                conn.close()
                return jsonify({"error": f"Ya existe una carrera con código '{nuevo_codigo}'"}), 409

        # Actualizar carrera
        cur.execute("""
            UPDATE Carrera 
            SET CarreraCod = ?, Nombre = ?, FacultadCod = ? 
            WHERE CarreraCod = ?
        """, (nuevo_codigo, nuevo_nombre, nueva_facultad_cod, carrera_cod))

        # Si cambió el código, actualizar referencias en usuarios
        if nuevo_codigo != carrera_cod:
            cur.execute("UPDATE Usuarios SET CarreraCod = ? WHERE CarreraCod = ?", (nuevo_codigo, carrera_cod))

        conn.commit()
        cur.close()
        conn.close()

        print(f"✅ Carrera actualizada: {carrera_cod} -> {nuevo_codigo} - {nuevo_nombre}")
        return jsonify({
            "message": "Carrera actualizada exitosamente",
            "data": {"codigo": nuevo_codigo, "nombre": nuevo_nombre, "facultadCod": nueva_facultad_cod}
        }), 200

    except Exception as e:
        print(f"❌ Error updating carrera: {e}")
        return jsonify({"error": str(e)}), 500


@app.delete('/api/carreras/<string:carrera_cod>')
@require_login
@require_role('admin')
def delete_carrera(carrera_cod):
    """Eliminar carrera - Solo admin"""
    try:
        conn = conectar()
        cur = conn.cursor()

        # Verificar que la carrera existe
        cur.execute("SELECT Nombre FROM Carrera WHERE CarreraCod = ?", (carrera_cod,))
        carrera = cur.fetchone()
        if not carrera:
            cur.close()
            conn.close()
            return jsonify({"error": "Carrera no encontrada"}), 404

        # Verificar si hay usuarios asociados
        cur.execute("SELECT COUNT(*) FROM Usuarios WHERE CarreraCod = ?", (carrera_cod,))
        usuarios_count = cur.fetchone()[0]

        if usuarios_count > 0:
            cur.close()
            conn.close()
            return jsonify({
                "error": f"No se puede eliminar la carrera '{carrera[0]}' porque tiene {usuarios_count} usuario(s) asociado(s)"
            }), 409

        # Eliminar carrera
        cur.execute("DELETE FROM Carrera WHERE CarreraCod = ?", (carrera_cod,))
        conn.commit()
        cur.close()
        conn.close()

        print(f"✅ Carrera eliminada: {carrera_cod} - {carrera[0]}")
        return jsonify({"message": f"Carrera '{carrera[0]}' eliminada exitosamente"}), 200

    except Exception as e:
        print(f"❌ Error deleting carrera: {e}")
        return jsonify({"error": str(e)}), 500


# ======================= MAIN ===========================
if __name__ == '__main__':
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"

    print(f"🚀 Iniciando servidor FACAF en puerto {port}")
    print(f"🐛 Modo debug: {debug}")

    app.run(host='0.0.0.0', port=port, debug=debug)