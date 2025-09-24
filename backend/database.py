import os
import pyodbc
from dotenv import load_dotenv
from pathlib import Path

# ======================= CARGA .ENV (carpeta "archivos") =======================
BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / "archivos" / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)


def conectar():
    server = os.getenv("DB_SERVER")
    port = os.getenv("DB_PORT")
    if port:
        server = f"{server},{port}"

    return pyodbc.connect(
        'DRIVER={' + os.getenv("DB_DRIVER") + '};'
                                              'SERVER=' + server + ';'
                                                                   'DATABASE=' + os.getenv("DB_NAME") + ';'
                                                                                                        'UID=' + os.getenv(
            "DB_USER") + ';'
                         'PWD=' + os.getenv("DB_PASSWORD") + ';'
    )


def conectar_master():
    """Conecta a la base de datos master para operaciones administrativas"""
    server = os.getenv("DB_SERVER")
    port = os.getenv("DB_PORT")
    if port:
        server = f"{server},{port}"

    return pyodbc.connect(
        'DRIVER={' + os.getenv("DB_DRIVER") + '};'
                                              'SERVER=' + server + ';'
                                                                   'DATABASE=master;'
                                                                   'UID=' + os.getenv("DB_USER") + ';'
                                                                                                   'PWD=' + os.getenv(
            "DB_PASSWORD") + ';',
        autocommit=True
    )


def existe_base_datos():
    """Verifica si la base de datos FACAFDB existe"""
    try:
        conn = conectar_master()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sys.databases WHERE name = ?", (os.getenv("DB_NAME"),))
        resultado = cursor.fetchone()
        cursor.close()
        conn.close()
        return resultado is not None
    except Exception:
        return False


def crear_base_datos():
    """
    Crea la base de datos FACAFDB completa con todas las tablas y datos iniciales
    """
    db_name = os.getenv("DB_NAME")

    try:
        print("🚀 Iniciando proceso de inicialización completa de base de datos...")

        # PASO 1: Verificar si la BD ya existe
        if existe_base_datos():
            print(f"ℹ️ La base de datos {db_name} ya existe. Saltando inicialización.")
            return True

        # PASO 2: Conectar a master y crear la base de datos
        print(f"🔧 Creando base de datos {db_name}...")
        conn_master = conectar_master()
        cursor_master = conn_master.cursor()

        cursor_master.execute(f"CREATE DATABASE [{db_name}]")
        print(f"✅ Base de datos {db_name} creada exitosamente")

        cursor_master.close()
        conn_master.close()

        # PASO 3: Conectar a la nueva base de datos y crear las tablas
        print("🔧 Conectando a la nueva base de datos...")
        conn = conectar()
        cursor = conn.cursor()

        # Crear tabla Rol
        print("🔧 Creando tabla Rol...")
        cursor.execute("""
            CREATE TABLE Rol (
                RolId INT IDENTITY(1,1) PRIMARY KEY,
                Nombre NVARCHAR(50) NOT NULL UNIQUE
            )
        """)

        # Crear tabla Facultad
        print("🔧 Creando tabla Facultad...")
        cursor.execute("""
            CREATE TABLE Facultad (
                FacultadCod CHAR(3) PRIMARY KEY,
                Nombre NVARCHAR(255) NOT NULL
            )
        """)

        # Crear tabla Carrera
        print("🔧 Creando tabla Carrera...")
        cursor.execute("""
            CREATE TABLE Carrera (
                CarreraCod CHAR(3) PRIMARY KEY,
                FacultadCod CHAR(3) NOT NULL,
                Nombre NVARCHAR(255) NOT NULL,
                FOREIGN KEY (FacultadCod) REFERENCES Facultad(FacultadCod)
            )
        """)

        # Crear tabla ArchivosExcel con FK a Facultad
        print("🔧 Creando tabla ArchivosExcel...")
        cursor.execute("""
            CREATE TABLE ArchivosExcel (
                Id INT PRIMARY KEY IDENTITY(1,1),
                NombreArchivo NVARCHAR(255) NOT NULL,
                TipoMime NVARCHAR(100) NOT NULL,
                Datos VARBINARY(MAX) NOT NULL,
                FechaSubida DATETIME DEFAULT GETDATE(),
                FacultadCod CHAR(3) NOT NULL,
                FOREIGN KEY (FacultadCod) REFERENCES Facultad(FacultadCod)
            )
        """)

        # Crear tabla PlantillasCorreo
        print("🔧 Creando tabla PlantillasCorreo...")
        cursor.execute("""
            CREATE TABLE PlantillasCorreo (
                Id INT PRIMARY KEY IDENTITY(1,1),
                Autoridad TEXT,
                Docente TEXT,
                Estudiante TEXT,
                Tipo NVARCHAR(50) NOT NULL
            )
        """)

        # Crear tabla Usuarios
        print("🔧 Creando tabla Usuarios...")
        cursor.execute("""
            CREATE TABLE Usuarios (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                Usuario NVARCHAR(150) NOT NULL UNIQUE,
                Estado BIT NOT NULL DEFAULT 1,
                RolId INT NOT NULL,
                FacultadCod CHAR(3) NOT NULL,
                CarreraCod CHAR(3) NULL,
                FOREIGN KEY (RolId) REFERENCES Rol(RolId),
                FOREIGN KEY (FacultadCod) REFERENCES Facultad(FacultadCod),
                FOREIGN KEY (CarreraCod) REFERENCES Carrera(CarreraCod)
            )
        """)

        # Crear tabla AutoridadCorreo
        print("🔧 Creando tabla AutoridadCorreo...")
        cursor.execute("""
            CREATE TABLE AutoridadCorreo (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                DecanoCorreo NVARCHAR(150) NOT NULL UNIQUE
            )
        """)

        # PASO 4: Insertar datos iniciales
        print("🔧 Insertando datos iniciales...")

        # Insertar roles
        cursor.execute("INSERT INTO Rol (Nombre) VALUES ('admin')")
        cursor.execute("INSERT INTO Rol (Nombre) VALUES ('decano')")
        cursor.execute("INSERT INTO Rol (Nombre) VALUES ('coordinador')")
        cursor.execute("INSERT INTO Rol (Nombre) VALUES ('usuario')")
        print("✅ Roles iniciales creados")

        # Insertar facultades (ejemplo - ajustar según tu institución)
        facultades_data = [
            ('ADM', 'Facultad de Ciencias Administrativas'),
            ('ING', 'Facultad de Ingeniería'),
            ('MED', 'Facultad de Ciencias Médicas'),
            ('EDU', 'Facultad de Filosofía, Letras y Ciencias de la Educación'),
            ('JUR', 'Facultad de Jurisprudencia')
        ]

        for cod, nombre in facultades_data:
            cursor.execute("INSERT INTO Facultad (FacultadCod, Nombre) VALUES (?, ?)", (cod, nombre))
        print("✅ Facultades iniciales creadas")

        # Insertar carreras de ejemplo
        carreras_data = [
            ('ADM', 'ADM', 'Administración de Empresas'),
            ('CON', 'ADM', 'Contaduría Pública'),
            ('SIS', 'ING', 'Ingeniería en Sistemas'),
            ('IND', 'ING', 'Ingeniería Industrial'),
            ('MED', 'MED', 'Medicina'),
            ('ENF', 'MED', 'Enfermería'),
        ]

        for cod, facultad_cod, nombre in carreras_data:
            cursor.execute("INSERT INTO Carrera (CarreraCod, FacultadCod, Nombre) VALUES (?, ?, ?)",
                           (cod, facultad_cod, nombre))
        print("✅ Carreras iniciales creadas")

        # Insertar plantillas por tipo
        tipos_plantilla = ['seguimiento', 'nee', 'tercera_matricula', 'parcial', 'final']
        for tipo in tipos_plantilla:
            cursor.execute("""
                INSERT INTO PlantillasCorreo (Autoridad, Docente, Estudiante, Tipo)
                VALUES ('', '', '', ?)
            """, (tipo,))
        print("✅ Plantillas iniciales insertadas")

        # Crear usuario administrador (ajustar según tu facultad)
        cursor.execute("""
            INSERT INTO Usuarios (Usuario, Estado, RolId, FacultadCod, CarreraCod)
            VALUES (?, 1, 1, 'ADM', NULL)
        """, (os.getenv("ADMIN_EMAIL", "luis.baldeons@ug.edu.ec"),))
        print("✅ Usuario administrador creado")

        # Confirmar todos los cambios
        conn.commit()
        cursor.close()
        conn.close()

        print("🎉 ¡Base de datos inicializada completamente con éxito!")
        return True

    except Exception as e:
        print(f"❌ Error crítico al crear base de datos: {e}")
        return False


def inicializar_base_datos():
    """
    Función principal de inicialización
    """
    try:
        return crear_base_datos()
    except Exception as e:
        print(f"💥 Error crítico en inicialización: {e}")
        return False


# ----------------------- UTIL -----------------------
def _row_to_user_dict(row):
    """Convierte una fila de usuario a diccionario con el nuevo modelo"""
    return {
        "id": int(row[0]),
        "usuario": row[1],
        "estado": bool(row[2]),
        "rolId": int(row[3]),
        "rolNombre": row[4],
        "facultadCod": row[5],
        "facultadNombre": row[6] if row[6] else None,
        "carreraCod": row[7] if row[7] else None,
        "carreraNombre": row[8] if row[8] else None
    }


# ======================= ARCHIVOS CON FILTRO POR FACULTAD =======================
def guardar_archivo_excel(archivo, facultad_cod):
    """Guarda archivo Excel asociado a una facultad específica"""
    nombre = archivo.filename
    tipo = archivo.mimetype
    contenido = archivo.read()

    conn = conectar()
    try:
        cur = conn.cursor()
        # Verificar si ya existe el archivo por nombre Y facultad
        cur.execute("""
            SELECT Id FROM ArchivosExcel 
            WHERE NombreArchivo = ? AND FacultadCod = ?
        """, (nombre, facultad_cod))
        existe = cur.fetchone()

        if existe:
            cur.execute("""
                UPDATE ArchivosExcel
                SET TipoMime = ?, Datos = ?, FechaSubida = GETDATE()
                WHERE NombreArchivo = ? AND FacultadCod = ?
            """, (tipo, contenido, nombre, facultad_cod))
        else:
            cur.execute("""
                INSERT INTO ArchivosExcel (NombreArchivo, TipoMime, Datos, FacultadCod)
                VALUES (?, ?, ?, ?)
            """, (nombre, tipo, contenido, facultad_cod))

        conn.commit()
    finally:
        cur.close()
        conn.close()


def listar_archivos_por_facultad(facultad_cod=None):
    """Lista archivos filtrados por código de facultad con logging detallado"""
    try:
        conn = conectar()
        cursor = conn.cursor()

        if facultad_cod:
            print(f"🔍 Listando archivos para facultad: {facultad_cod}")
            cursor.execute("""
                SELECT Id, NombreArchivo, FechaSubida, FacultadCod, TipoMime
                FROM ArchivosExcel 
                WHERE FacultadCod = ?
                ORDER BY FechaSubida DESC
            """, (facultad_cod,))
        else:
            print("🔍 Listando TODOS los archivos (sin filtro de facultad)")
            cursor.execute("""
                SELECT Id, NombreArchivo, FechaSubida, FacultadCod, TipoMime
                FROM ArchivosExcel 
                ORDER BY FechaSubida DESC
            """)

        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        archivos = []
        for row in rows:
            archivo = {
                'id': row[0],
                'nombre': row[1],
                'NombreArchivo': row[1],  # Alias para compatibilidad
                'fechaSubida': row[2],
                'facultadCod': row[3],
                'FacultadCod': row[3],  # Alias para compatibilidad
                'tipoMime': row[4]
            }
            archivos.append(archivo)

        print(f"📊 Query result: {len(archivos)} archivos encontrados")
        if facultad_cod and len(archivos) == 0:
            print(f"⚠️ No hay archivos para la facultad {facultad_cod}")
        elif len(archivos) > 0:
            print(f"📄 Ejemplo archivo: {archivos[0]['nombre']} (facultad: {archivos[0]['facultadCod']})")

        return archivos

    except Exception as e:
        print(f"❌ Error en listar_archivos_por_facultad: {e}")
        return []


def verificar_permisos_archivo(archivo_id, usuario_facultad_cod, es_admin=False):
    """Verifica si un usuario tiene permisos para acceder a un archivo específico"""
    if es_admin:
        return True

    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("SELECT FacultadCod FROM ArchivosExcel WHERE Id = ?", (archivo_id,))
        row = cur.fetchone()

        if not row:
            return False

        archivo_facultad = row[0]
        return archivo_facultad == usuario_facultad_cod

    finally:
        cur.close()
        conn.close()


def obtener_archivo_por_facultad(archivo_id, facultad_cod):
    """Obtiene un archivo específico validando que pertenezca a la facultad"""
    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT NombreArchivo, TipoMime, Datos 
            FROM ArchivosExcel 
            WHERE Id = ? AND FacultadCod = ?
        """, (archivo_id, facultad_cod))
        row = cur.fetchone()
        return row if row else None
    finally:
        cur.close()
        conn.close()


# ======================= PLANTILLAS CON TIPO =======================
def obtener_plantillas_por_tipo(tipo='seguimiento'):
    """Obtiene plantillas de correo por tipo"""
    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT Autoridad, Docente, Estudiante 
            FROM PlantillasCorreo 
            WHERE Tipo = ?
        """, (tipo,))
        row = cur.fetchone()
        return {
            'autoridad': row[0] if row else '',
            'docente': row[1] if row else '',
            'estudiante': row[2] if row else ''
        }
    finally:
        cur.close()
        conn.close()


def guardar_plantillas_por_tipo(data, tipo='seguimiento'):
    """Guarda plantillas de correo por tipo"""
    conn = conectar()
    try:
        cur = conn.cursor()

        # Verificar si existe la plantilla para este tipo
        cur.execute("SELECT Id FROM PlantillasCorreo WHERE Tipo = ?", (tipo,))
        existe = cur.fetchone()

        if existe:
            cur.execute("""
                UPDATE PlantillasCorreo
                SET Autoridad = ?, Docente = ?, Estudiante = ?
                WHERE Tipo = ?
            """, (data.get('autoridad', ''), data.get('docente', ''), data.get('estudiante', ''), tipo))
        else:
            cur.execute("""
                INSERT INTO PlantillasCorreo (Autoridad, Docente, Estudiante, Tipo)
                VALUES (?, ?, ?, ?)
            """, (data.get('autoridad', ''), data.get('docente', ''), data.get('estudiante', ''), tipo))

        conn.commit()
    finally:
        cur.close()
        conn.close()


# ======================= USUARIOS CON NUEVO MODELO =======================
def obtener_usuario_por_usuario(usuario: str):
    """Obtiene usuario completo con información de rol, facultad y carrera"""
    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT u.Id, u.Usuario, u.Estado, u.RolId, r.Nombre as RolNombre,
                   u.FacultadCod, f.Nombre as FacultadNombre,
                   u.CarreraCod, c.Nombre as CarreraNombre
            FROM Usuarios u
            INNER JOIN Rol r ON u.RolId = r.RolId
            INNER JOIN Facultad f ON u.FacultadCod = f.FacultadCod
            LEFT JOIN Carrera c ON u.CarreraCod = c.CarreraCod
            WHERE u.Usuario = ?
        """, (usuario,))
        row = cur.fetchone()
        return _row_to_user_dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def crear_usuario(usuario: str, rol_id: int, facultad_cod: str, carrera_cod: str = None, activo: bool = True):
    """Crea un nuevo usuario con el modelo actualizado"""
    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO Usuarios (Usuario, Estado, RolId, FacultadCod, CarreraCod)
            VALUES (?, ?, ?, ?, ?)
        """, (usuario, 1 if activo else 0, rol_id, facultad_cod, carrera_cod))
        conn.commit()

        # Devolver el usuario creado
        return obtener_usuario_por_usuario(usuario)
    finally:
        cur.close()
        conn.close()


def listar_usuarios_con_filtros(facultad_cod=None, rol_id=None, q=None, page=0, limit=20, activo=None):
    """
    Lista usuarios con filtros opcionales

    Args:
        facultad_cod: Código de facultad (opcional)
        rol_id: ID del rol (opcional)
        q: Texto de búsqueda (opcional)
        page: Página (default: 0)
        limit: Límite por página (default: 20)
        activo: Filtro de estado activo/inactivo (opcional: True, False, None)

    Returns:
        dict: {'data': [...], 'total': int, 'page': int, 'limit': int}
    """
    try:
        conn = conectar()
        cursor = conn.cursor()

        # Construir consulta base
        base_query = """
            SELECT u.Id, u.Usuario, u.Estado, u.FacultadCod, u.CarreraCod,
                   r.RolId, r.Nombre as RolNombre,
                   f.Nombre as FacultadNombre,
                   c.Nombre as CarreraNombre
            FROM Usuarios u
            LEFT JOIN Rol r ON u.RolId = r.RolId
            LEFT JOIN Facultad f ON u.FacultadCod = f.FacultadCod
            LEFT JOIN Carrera c ON u.CarreraCod = c.CarreraCod
            WHERE 1=1
        """

        conditions = []
        params = []

        # Filtro por facultad
        if facultad_cod:
            conditions.append("u.FacultadCod = ?")
            params.append(facultad_cod)

        # Filtro por rol
        if rol_id:
            conditions.append("u.RolId = ?")
            params.append(rol_id)

        # Filtro por texto de búsqueda
        if q and q.strip():
            conditions.append("(u.Usuario LIKE ? OR r.Nombre LIKE ? OR f.Nombre LIKE ?)")
            search_term = f"%{q.strip()}%"
            params.extend([search_term, search_term, search_term])

        # Filtro por estado activo/inactivo
        if activo is not None:
            conditions.append("u.Estado = ?")
            params.append(1 if activo else 0)

        # Agregar condiciones a la consulta
        if conditions:
            base_query += " AND " + " AND ".join(conditions)

        # Consulta para el total
        count_query = f"SELECT COUNT(*) FROM ({base_query}) as filtered"
        cursor.execute(count_query, params)
        total = cursor.fetchone()[0]

        # Agregar ordenamiento y paginación
        base_query += " ORDER BY u.Id DESC"
        if limit > 0:
            offset = page * limit
            base_query += f" OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY"

        # Ejecutar consulta principal
        cursor.execute(base_query, params)
        rows = cursor.fetchall()

        # Mapear resultados
        users = []
        for row in rows:
            user = {
                'id': row[0],
                'usuario': row[1],
                'activo': bool(row[2]),  # Estado -> activo
                'estado': bool(row[2]),  # También mantener 'estado' por compatibilidad
                'facultadCod': row[3],
                'carreraCod': row[4],
                'rolId': row[5],
                'rolNombre': row[6] or 'Sin rol',
                'facultadNombre': row[7] or 'Sin facultad',
                'carreraNombre': row[8] or 'Sin carrera'
            }
            users.append(user)

        cursor.close()
        conn.close()

        result = {
            'data': users,
            'total': total,
            'page': page,
            'limit': limit,
            'has_more': (page + 1) * limit < total
        }

        print(f"✅ listar_usuarios_con_filtros: Returned {len(users)} users (total: {total})")
        return result

    except Exception as e:
        print(f"❌ Error in listar_usuarios_con_filtros: {e}")
        raise Exception(f"Error al listar usuarios: {e}")


# ======================= CATÁLOGOS =======================
def obtener_roles():
    """Obtiene lista de roles disponibles"""
    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("SELECT RolId, Nombre FROM Rol ORDER BY Nombre")
        rows = cur.fetchall()
        return [{"id": row[0], "nombre": row[1]} for row in rows]
    finally:
        cur.close()
        conn.close()


def obtener_facultades():
    """Obtiene lista de facultades disponibles"""
    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("SELECT FacultadCod, Nombre FROM Facultad ORDER BY Nombre")
        rows = cur.fetchall()
        return [{"codigo": row[0], "nombre": row[1]} for row in rows]
    finally:
        cur.close()
        conn.close()


def obtener_carreras_por_facultad(facultad_cod):
    """Obtiene carreras de una facultad específica"""
    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT CarreraCod, Nombre 
            FROM Carrera 
            WHERE FacultadCod = ? 
            ORDER BY Nombre
        """, (facultad_cod,))
        rows = cur.fetchall()
        return [{"codigo": row[0], "nombre": row[1]} for row in rows]
    finally:
        cur.close()
        conn.close()


# ======================= AUTORIDAD CORREO =======================
def obtener_correo_autoridad():
    """Obtiene el correo de autoridad configurado"""
    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("SELECT TOP 1 DecanoCorreo FROM AutoridadCorreo ORDER BY Id DESC")
        row = cur.fetchone()
        return row[0] if row else "alvaro.espinozabu@ug.edu.ec"  # Valor por defecto
    finally:
        cur.close()
        conn.close()


def actualizar_correo_autoridad(correo_autoridad):
    """Actualiza o inserta el correo de autoridad"""
    conn = conectar()
    try:
        cur = conn.cursor()

        # Verificar si existe algún registro
        cur.execute("SELECT COUNT(*) FROM AutoridadCorreo")
        existe = cur.fetchone()[0] > 0

        if existe:
            # Actualizar el más reciente
            cur.execute("""
                UPDATE AutoridadCorreo 
                SET DecanoCorreo = ? 
                WHERE Id = (SELECT TOP 1 Id FROM AutoridadCorreo ORDER BY Id DESC)
            """, (correo_autoridad,))
        else:
            # Insertar nuevo registro
            cur.execute("""
                INSERT INTO AutoridadCorreo (DecanoCorreo) 
                VALUES (?)
            """, (correo_autoridad,))

        conn.commit()
        return True
    except Exception as e:
        print(f"Error actualizando correo autoridad: {e}")
        return False
    finally:
        cur.close()
        conn.close()