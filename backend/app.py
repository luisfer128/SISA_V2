from dotenv import load_dotenv
import os
from flask import send_from_directory, Flask, request, jsonify, send_file
from flask_cors import CORS
from pathlib import Path
from io import BytesIO
import secrets, time
import requests
from database import (
    guardar_archivo_excel,
    listar_archivos_por_facultad,
    obtener_archivo_por_facultad,
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
import msal

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
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "10"))  # segundos

# ======================= INICIALIZACIÓN BD ===========================
print("🚀 Iniciando aplicación FACAF...")
if inicializar_base_datos():
    print("✅ Sistema listo - Base de datos inicializada correctamente")
else:
    print("❌ ADVERTENCIA: Problemas en inicialización de BD. Algunas funciones pueden fallar.")

try:
    conn = conectar()
    conn.close()
    print("✅ Conexión final exitosa con FACAFDB")
except Exception as e:
    print(f"❌ Error de conexión final: {e}")


# ======================= MIDDLEWARE DE AUTENTICACIÓN ===========================
def get_user_from_request():
    """Obtiene información del usuario desde headers de autenticación"""
    user_email = request.headers.get('X-User-Email')
    if not user_email:
        return None
    return obtener_usuario_por_usuario(user_email)


def require_auth(f):
    """Decorador que requiere autenticación"""
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_user_from_request()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        if not user.get('estado'):
            return jsonify({'error': 'User is inactive'}), 403
        request.user = user
        return f(*args, **kwargs)

    return decorated_function


def require_role(required_roles):
    """Decorador que requiere roles específicos"""

    def decorator(f):
        from functools import wraps
        @wraps(f)
        def decorated_function(*args, **kwargs):
            user = getattr(request, 'user', None)
            if not user:
                return jsonify({'error': 'Authentication required'}), 401

            user_role = user.get('rolNombre', '').lower()
            if user_role not in [role.lower() for role in required_roles]:
                return jsonify({'error': 'Insufficient permissions'}), 403

            return f(*args, **kwargs)

        return decorated_function

    return decorator


# ======================= CATÁLOGOS ===========================
@app.get('/api/roles')
def api_get_roles():
    """Obtiene lista de roles disponibles"""
    try:
        roles = obtener_roles()
        return jsonify(roles)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.get('/api/facultades')
def api_get_facultades():
    """Obtiene lista de facultades disponibles"""
    try:
        facultades = obtener_facultades()
        return jsonify(facultades)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.get('/api/carreras/<facultad_cod>')
def api_get_carreras(facultad_cod):
    """Obtiene carreras de una facultad específica"""
    try:
        carreras = obtener_carreras_por_facultad(facultad_cod)
        return jsonify(carreras)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ======================= ARCHIVOS CON FacultadCod DESDE FRONTEND ===========================
@app.post('/upload')
@require_auth
def subir_archivo():
    """Subida de archivo con FacultadCod enviado desde el frontend"""
    archivo = request.files.get('file')
    if not archivo or archivo.filename.strip() == '':
        return jsonify({'error': 'No se envió archivo o nombre vacío'}), 400

    # Obtener FacultadCod desde el formulario o parámetros
    facultad_cod = request.form.get('facultadCod') or request.args.get('facultadCod')
    if not facultad_cod:
        return jsonify({'error': 'FacultadCod es requerido'}), 400

    # Validar que el FacultadCod existe en la base de datos
    try:
        conn = conectar()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM Facultad WHERE FacultadCod = ?", (facultad_cod,))
        existe_facultad = cur.fetchone()[0] > 0
        cur.close()
        conn.close()

        if not existe_facultad:
            return jsonify({'error': f'FacultadCod {facultad_cod} no existe'}), 400
    except Exception as e:
        return jsonify({'error': f'Error validando facultad: {e}'}), 500

    # Validación de permisos por rol
    user_role = request.user.get('rolNombre', '').lower()
    user_facultad = request.user.get('facultadCod')

    # Admin puede subir a cualquier facultad
    # Otros usuarios solo pueden subir a su propia facultad
    if user_role != 'admin' and facultad_cod != user_facultad:
        return jsonify({'error': 'No tienes permisos para subir archivos a esta facultad'}), 403

    try:
        guardar_archivo_excel(archivo, facultad_cod)
        return jsonify({
            'message': f'Archivo "{archivo.filename}" guardado correctamente para facultad {facultad_cod}',
            'facultadCod': facultad_cod
        }), 200
    except Exception as e:
        print(f"❌ Error en upload: {e}")
        return jsonify({'error': f'No se pudo guardar: {e}'}), 500


@app.get('/files')
@require_auth
def listar():
    """Lista archivos con FacultadCod opcional desde query params"""
    try:
        user_role = request.user.get('rolNombre', '').lower()
        user_facultad = request.user.get('facultadCod')

        # Obtener FacultadCod desde query params
        facultad_filter = request.args.get('facultadCod')

        # Validación de permisos
        if user_role == 'admin':
            # Admin puede ver archivos de cualquier facultad o todas
            facultad_cod = facultad_filter  # Usar el filtro enviado o None para ver todas
        else:
            # Otros usuarios solo pueden ver archivos de su facultad
            if facultad_filter and facultad_filter != user_facultad:
                return jsonify({'error': 'No tienes permisos para ver archivos de esta facultad'}), 403
            facultad_cod = user_facultad  # Forzar a su propia facultad

        archivos = listar_archivos_por_facultad(facultad_cod)

        response_data = {
            'archivos': archivos,
            'facultadFiltro': facultad_cod,
            'total': len(archivos)
        }

        # Info adicional para admin
        if user_role == 'admin':
            response_data['debug_info'] = {
                'user_role': user_role,
                'user_facultad': user_facultad,
                'filtro_aplicado': facultad_cod
            }

        return jsonify(response_data)

    except Exception as e:
        print(f"❌ Error listando archivos: {e}")
        return jsonify({'error': f'Error al listar archivos: {e}'}), 500


@app.get('/download/<int:archivo_id>')
@require_auth
def descargar(archivo_id):
    """Descarga archivo con validación de facultad opcional"""
    try:
        user_role = request.user.get('rolNombre', '').lower()
        user_facultad = request.user.get('facultadCod')

        # Obtener información del archivo primero
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

        # Validación de permisos
        if user_role != 'admin' and archivo_facultad != user_facultad:
            return jsonify({'error': 'No tienes permisos para descargar este archivo'}), 403

        bio = BytesIO(contenido)
        return send_file(
            bio,
            as_attachment=True,
            download_name=nombre,
            mimetype=tipo or 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )

    except Exception as e:
        print(f"❌ Error descargando archivo: {e}")
        return jsonify({'error': f'Error al descargar archivo: {e}'}), 500


@app.delete('/delete/by-name/<string:filename>')
@require_auth
def eliminar_archivo_por_nombre(filename):
    """Elimina archivo por nombre con FacultadCod opcional"""
    try:
        user_role = request.user.get('rolNombre', '').lower()
        user_facultad = request.user.get('facultadCod')

        # Obtener FacultadCod desde query params
        facultad_cod = request.args.get('facultadCod')

        # Validación de permisos
        if user_role != 'admin':
            if facultad_cod and facultad_cod != user_facultad:
                return jsonify({'error': 'No tienes permisos para eliminar archivos de esta facultad'}), 403
            # Forzar a su propia facultad si no especifica
            facultad_cod = user_facultad

        conn = conectar()
        cursor = conn.cursor()

        if user_role == 'admin' and not facultad_cod:
            # Admin puede eliminar sin especificar facultad
            cursor.execute("DELETE FROM ArchivosExcel WHERE NombreArchivo = ?", (filename,))
        else:
            # Eliminar con filtro de facultad
            cursor.execute("""
                DELETE FROM ArchivosExcel 
                WHERE NombreArchivo = ? AND FacultadCod = ?
            """, (filename, facultad_cod))

            # Si no se eliminó, intentar con nombre único
            if cursor.rowcount == 0:
                nombre_unico = f"{filename}_{facultad_cod}"
                cursor.execute("""
                    DELETE FROM ArchivosExcel 
                    WHERE NombreArchivo = ? AND FacultadCod = ?
                """, (nombre_unico, facultad_cod))

        rows_affected = cursor.rowcount
        conn.commit()
        cursor.close()
        conn.close()

        if rows_affected > 0:
            return jsonify({
                'message': f'Archivo "{filename}" eliminado correctamente',
                'facultadCod': facultad_cod
            }), 200
        else:
            return jsonify({'error': f'Archivo "{filename}" no encontrado o sin permisos'}), 404

    except Exception as e:
        print(f"❌ Error eliminando archivo: {e}")
        return jsonify({'error': f'Error al eliminar archivo: {e}'}), 500


# ======================= ENDPOINT DE DEBUG PARA VERIFICAR ARCHIVOS ===========================
@app.get('/debug/files')
@require_auth
@require_role(['admin'])
def debug_files():
    """Endpoint de debug solo para admin - muestra todos los archivos con detalles"""
    try:
        conn = conectar()
        cur = conn.cursor()
        cur.execute("""
            SELECT a.Id, a.NombreArchivo, a.FechaSubida, a.FacultadCod, 
                   f.Nombre as FacultadNombre, a.TipoMime,
                   LEN(a.Datos) as TamanoBytes
            FROM ArchivosExcel a
            INNER JOIN Facultad f ON a.FacultadCod = f.FacultadCod
            ORDER BY a.FechaSubida DESC
        """)

        rows = cur.fetchall()
        cur.close()
        conn.close()

        archivos_debug = []
        for row in rows:
            archivos_debug.append({
                'id': row[0],
                'nombre': row[1],
                'fecha': row[2].strftime('%Y-%m-%d %H:%M:%S') if row[2] else None,
                'facultadCod': row[3],
                'facultadNombre': row[4],
                'tipoMime': row[5],
                'tamanoKB': round(row[6] / 1024, 2) if row[6] else 0
            })

        return jsonify({
            'total_archivos': len(archivos_debug),
            'archivos': archivos_debug,
            'usuario_actual': {
                'role': request.user.get('rolNombre'),
                'facultad': request.user.get('facultadCod'),
                'usuario': request.user.get('usuario')
            }
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ======================= ENDPOINT PARA LIMPIAR ARCHIVOS DUPLICADOS ===========================
@app.post('/admin/cleanup-duplicates')
@require_auth
@require_role(['admin'])
def cleanup_duplicates():
    """Limpia archivos duplicados manteniendo el más reciente"""
    try:
        conn = conectar()
        cur = conn.cursor()

        # Encontrar duplicados por nombre
        cur.execute("""
            SELECT NombreArchivo, COUNT(*) as Duplicados
            FROM ArchivosExcel 
            GROUP BY NombreArchivo 
            HAVING COUNT(*) > 1
        """)

        duplicados = cur.fetchall()
        archivos_eliminados = 0

        for nombre_archivo, count in duplicados:
            # Para cada archivo duplicado, mantener solo el más reciente
            cur.execute("""
                DELETE FROM ArchivosExcel 
                WHERE NombreArchivo = ? AND Id NOT IN (
                    SELECT TOP 1 Id FROM ArchivosExcel 
                    WHERE NombreArchivo = ? 
                    ORDER BY FechaSubida DESC
                )
            """, (nombre_archivo, nombre_archivo))

            archivos_eliminados += cur.rowcount

        conn.commit()
        cur.close()
        conn.close()

        return jsonify({
            'message': f'Limpieza completada: {archivos_eliminados} archivos duplicados eliminados',
            'duplicados_encontrados': len(duplicados)
        })

    except Exception as e:
        return jsonify({'error': f'Error en limpieza: {e}'}), 500

# ======================= PLANTILLAS CON VALIDACIÓN DE PERMISOS ===========================
@app.get('/plantillas')
@require_auth
def get_plantillas():
    """Obtiene plantillas por tipo específico"""
    try:
        tipo = request.args.get('tipo', 'seguimiento')

        # Validar que el tipo es válido
        tipos_validos = ['seguimiento', 'nee', 'tercera_matricula', 'parcial', 'final']
        if tipo not in tipos_validos:
            return jsonify({
                'error': f'Tipo no válido. Tipos disponibles: {", ".join(tipos_validos)}'
            }), 400

        data = obtener_plantillas_por_tipo(tipo)

        return jsonify({
            'tipo': tipo,
            'plantillas': data,
            'tipos_disponibles': tipos_validos
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.get('/plantillas/tipos')
@require_auth
def get_tipos_plantillas():
    """Obtiene todos los tipos de plantillas disponibles"""
    try:
        conn = conectar()
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT Tipo FROM PlantillasCorreo ORDER BY Tipo")
        rows = cur.fetchall()
        cur.close()
        conn.close()

        tipos = [row[0] for row in rows]
        return jsonify({
            'tipos': tipos,
            'total': len(tipos)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.post('/plantillas')
@require_auth
@require_role(['admin', 'coordinador'])
def update_plantillas():
    """Actualiza plantillas por tipo específico"""
    try:
        datos = request.get_json(silent=True) or {}
        tipo = datos.get('tipo', 'seguimiento')

        # Validar que el tipo es válido
        tipos_validos = ['seguimiento', 'nee', 'tercera_matricula', 'parcial', 'final']
        if tipo not in tipos_validos:
            return jsonify({
                'error': f'Tipo no válido. Tipos disponibles: {", ".join(tipos_validos)}'
            }), 400

        # Extraer plantillas (sin incluir 'tipo' en los datos a guardar)
        plantillas_data = {
            'autoridad': datos.get('autoridad', ''),
            'docente': datos.get('docente', ''),
            'estudiante': datos.get('estudiante', '')
        }

        guardar_plantillas_por_tipo(plantillas_data, tipo)

        return jsonify({
            'message': f'Plantillas de tipo "{tipo}" actualizadas correctamente',
            'tipo': tipo
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ======================= USUARIOS CON VALIDACIÓN AVANZADA ===========================
@app.post("/usuarios")
@require_auth
@require_role(['admin'])
def api_crear_usuario():
    """Solo admin puede crear usuarios"""
    data = request.get_json(silent=True) or {}
    usuario = (data.get("usuario") or "").strip()
    rol_id = data.get("rolId")
    facultad_cod = data.get("facultadCod")
    carrera_cod = data.get("carreraCod")
    activo = data.get("activo", True)

    if not all([usuario, rol_id, facultad_cod]):
        return jsonify({"error": "Campos obligatorios: usuario, rolId, facultadCod"}), 400

    try:
        creado = crear_usuario(usuario, rol_id, facultad_cod, carrera_cod, bool(activo))
        return jsonify({"message": "Usuario creado", "data": creado}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/usuarios")
@require_auth
def api_listar_usuarios():
    """Lista usuarios con filtros según el rol del usuario autenticado"""
    try:
        # Parámetros de filtrado
        q = request.args.get("q", "").strip()
        rol_id = request.args.get("rolId", type=int)
        page = max(0, int(request.args.get("page", 0)))
        limit = max(1, min(200, int(request.args.get("limit", 20))))

        # Filtro de facultad según permisos
        user_role = request.user.get('rolNombre', '').lower()
        if user_role == 'admin':
            # Admin puede ver todos
            facultad_filter = request.args.get("facultadCod")
        else:
            # Otros solo ven de su facultad
            facultad_filter = request.user.get('facultadCod')

        resultado = listar_usuarios_con_filtros(
            facultad_cod=facultad_filter,
            rol_id=rol_id,
            q=q,
            page=page,
            limit=limit
        )

        return jsonify(resultado), 200
    except Exception as e:
        return jsonify({"error": f"No se pudo listar usuarios: {e}"}), 500


@app.get("/usuarios/<int:user_id>")
@require_auth
def api_obtener_usuario(user_id: int):
    """Obtiene usuario específico con validación de permisos"""
    try:
        conn = conectar()
        cur = conn.cursor()

        # Verificar permisos de acceso
        user_role = request.user.get('rolNombre', '').lower()
        if user_role == 'admin':
            # Admin puede ver cualquier usuario
            query = """
                SELECT u.Id, u.Usuario, u.Estado, u.RolId, r.Nombre as RolNombre,
                       u.FacultadCod, f.Nombre as FacultadNombre,
                       u.CarreraCod, c.Nombre as CarreraNombre
                FROM Usuarios u
                INNER JOIN Rol r ON u.RolId = r.RolId
                INNER JOIN Facultad f ON u.FacultadCod = f.FacultadCod
                LEFT JOIN Carrera c ON u.CarreraCod = c.CarreraCod
                WHERE u.Id = ?
            """
            cur.execute(query, (user_id,))
        else:
            # Otros solo pueden ver usuarios de su facultad
            query = """
                SELECT u.Id, u.Usuario, u.Estado, u.RolId, r.Nombre as RolNombre,
                       u.FacultadCod, f.Nombre as FacultadNombre,
                       u.CarreraCod, c.Nombre as CarreraNombre
                FROM Usuarios u
                INNER JOIN Rol r ON u.RolId = r.RolId
                INNER JOIN Facultad f ON u.FacultadCod = f.FacultadCod
                LEFT JOIN Carrera c ON u.CarreraCod = c.CarreraCod
                WHERE u.Id = ? AND u.FacultadCod = ?
            """
            cur.execute(query, (user_id, request.user.get('facultadCod')))

        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            return jsonify({"error": "Usuario no encontrado"}), 404

        from database import _row_to_user_dict
        user_data = _row_to_user_dict(row)
        return jsonify({"data": user_data}), 200

    except Exception as e:
        return jsonify({"error": f"No se pudo obtener usuario: {e}"}), 500


# ======================= VALIDACIÓN DE PERMISOS PARA MÓDULOS ===========================
@app.get('/api/permissions/modules')
@require_auth
def get_module_permissions():
    """Devuelve qué módulos puede acceder el usuario según su rol"""
    user_role = request.user.get('rolNombre', '').lower()
    facultad_cod = request.user.get('facultadCod')

    # Definir permisos por rol
    module_permissions = {
        'admin': {
            'academic-tracking': True,
            'nee-control': True,
            'tercera-matricula': True,
            'control-parcial': True,
            'control-final': True,
            'top-promedios': True,
            'consulta-estudiante': True,
            'consulta-docente': True,
            'distribucion-docente': True,
            'reportes': True,
            'config': True,
            'admin-panel': True
        },
        'decano': {
            'academic-tracking': True,
            'nee-control': True,
            'tercera-matricula': True,
            'control-parcial': True,
            'control-final': True,
            'top-promedios': True,
            'consulta-estudiante': True,
            'consulta-docente': True,
            'distribucion-docente': True,
            'reportes': True,
            'config': False,
            'admin-panel': False
        },
        'coordinador': {
            'academic-tracking': True,
            'nee-control': True,
            'tercera-matricula': True,
            'control-parcial': True,
            'control-final': True,
            'top-promedios': True,
            'consulta-estudiante': True,
            'consulta-docente': True,
            'distribucion-docente': False,
            'reportes': True,
            'config': False,
            'admin-panel': False
        },
        'usuario': {
            'academic-tracking': False,
            'nee-control': False,
            'tercera-matricula': False,
            'control-parcial': False,
            'control-final': False,
            'top-promedios': True,
            'consulta-estudiante': True,
            'consulta-docente': True,
            'distribucion-docente': False,
            'reportes': False,
            'config': False,
            'admin-panel': False
        }
    }

    permissions = module_permissions.get(user_role, module_permissions['usuario'])

    return jsonify({
        'permissions': permissions,
        'userInfo': {
            'role': user_role,
            'facultad': facultad_cod,
            'carrera': request.user.get('carreraCod'),
            'usuario': request.user.get('usuario')
        }
    })


# ======================= CORREO (MS Graph + OAuth2) ===========================
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
@require_auth
@require_role(['admin', 'decano', 'coordinador'])
def send_email():
    """Envío de correos restringido por roles"""
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
    """Autenticación con validación mejorada"""
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


@app.post("/admin/link")
@require_auth
@require_role(['admin'])
def admin_link():
    """Acceso al panel de administración solo para admin"""
    return jsonify({"url": f"/Modules/panel-admin.html"})


# ======================= AUTORIDAD CORREO =======================
@app.get('/correo-autoridad')
@require_auth
def get_correo_autoridad_endpoint():
    """Obtiene el correo de autoridad configurado"""
    try:
        correo = obtener_correo_autoridad()
        return jsonify({
            'correoAutoridad': correo
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.post('/correo-autoridad')
@require_auth
@require_role(['admin', 'coordinador'])
def update_correo_autoridad_endpoint():
    """Actualiza el correo de autoridad - solo admin y coordinador"""
    try:
        datos = request.get_json(silent=True) or {}
        correo_autoridad = datos.get('correoAutoridad', '').strip()

        if not correo_autoridad:
            return jsonify({'error': 'correoAutoridad es requerido'}), 400

        # Validación básica de formato email
        import re
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, correo_autoridad):
            return jsonify({'error': 'Formato de correo inválido'}), 400

        success = actualizar_correo_autoridad(correo_autoridad)

        if success:
            return jsonify({
                'message': 'Correo de autoridad actualizado correctamente',
                'correoAutoridad': correo_autoridad
            })
        else:
            return jsonify({'error': 'Error al actualizar correo de autoridad'}), 500

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ======================= MAIN ===========================
if __name__ == '__main__':
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    app.run(host='0.0.0.0', port=port, debug=debug)