"""
ConstruSoft - Servidor HTTP y Base de Datos SQLite
Servidor backend completo para Autenticación, Recursos, APUs (Análisis de Precios Unitarios) y Presupuestos.
"""

import http.server
import socketserver
import json
import sqlite3
import os
import re
from urllib.parse import urlparse, parse_qs

PORT = 5500
DB_FILE = os.path.join(os.path.dirname(__file__), "construsoft.db")

DEFAULT_UNITS = [
    ("m", "Metro", "Longitud"),
    ("m²", "Metro cuadrado", "Superficie"),
    ("m³", "Metro cúbico", "Volumen"),
    ("Kg", "Kilogramo", "Peso"),
    ("Und", "Unidad", "Conteo"),
    ("Hr", "Hora", "Tiempo"),
    ("Jr", "Jornal", "Mano de obra"),
    ("Glb", "Global", "Global"),
    ("Gal", "Galón", "Volumen líquido"),
    ("Lt", "Litro", "Volumen líquido"),
    ("Ms", "Mes", "Tiempo"),
    ("X", "Todo costo", "Actividades")
]

TYPE_PREFIXES = {
    'Materiales': 'MAT',
    'Equipos': 'EQP',
    'Personal': 'PER',
    'Actividades': 'ACT'
}

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # 1. Empresas
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            razon_social TEXT NOT NULL,
            nit TEXT NOT NULL,
            logo_data TEXT,
            plan TEXT NOT NULL,
            estado_suscripcion TEXT DEFAULT 'trial',
            dias_prueba INTEGER DEFAULT 15,
            fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 2. Usuarios
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            rol TEXT DEFAULT 'Administrador',
            company_id INTEGER,
            requiere_cambio_clave INTEGER DEFAULT 0,
            FOREIGN KEY (company_id) REFERENCES companies (id)
        )
    """)

    # 3. Unidades de Medida
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS measurement_units (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            codigo TEXT NOT NULL,
            nombre TEXT NOT NULL,
            categoria TEXT NOT NULL,
            editable INTEGER DEFAULT 1,
            FOREIGN KEY (company_id) REFERENCES companies (id)
        )
    """)

    # 4. Recursos (Módulo 5)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            codigo TEXT NOT NULL,
            nombre TEXT NOT NULL,
            tipo TEXT NOT NULL,
            unidad TEXT NOT NULL,
            precio_base REAL NOT NULL,
            iva_porcentaje REAL DEFAULT 0,
            precio_total REAL NOT NULL,
            via_precio TEXT NOT NULL,
            fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies (id)
        )
    """)

    # 5. APUs (Módulo 6)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS apus (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            codigo TEXT NOT NULL,
            nombre TEXT NOT NULL,
            unidad TEXT NOT NULL,
            costo_directo REAL DEFAULT 0,
            activo INTEGER DEFAULT 1,
            version INTEGER DEFAULT 1,
            fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies (id)
        )
    """)

    # 6. Líneas de Composición del APU
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS apu_resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            apu_id INTEGER NOT NULL,
            resource_id INTEGER NOT NULL,
            cantidad REAL NOT NULL DEFAULT 1,
            rendimiento REAL NOT NULL DEFAULT 1,
            desperdicio_porcentaje REAL DEFAULT 0,
            subtotal REAL NOT NULL DEFAULT 0,
            FOREIGN KEY (apu_id) REFERENCES apus (id),
            FOREIGN KEY (resource_id) REFERENCES resources (id)
        )
    """)

    # 7. Presupuestos (Módulos 7 y 8)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS budgets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            codigo TEXT NOT NULL,
            nombre TEXT NOT NULL,
            ubicacion TEXT DEFAULT '',
            moneda TEXT DEFAULT 'COP',
            fecha_elaboracion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            fecha_ultima_modificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            estado TEXT NOT NULL DEFAULT 'Abierto', -- 'Abierto', 'Activo', 'Cerrado'
            aiu_admin REAL DEFAULT 0,
            aiu_imprevistos REAL DEFAULT 0,
            aiu_utilidad REAL DEFAULT 0,
            FOREIGN KEY (company_id) REFERENCES companies (id)
        )
    """)

    # 8. Capítulos y Subcapítulos Jerárquicos (WBS)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS budget_chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            budget_id INTEGER NOT NULL,
            parent_id INTEGER,
            numero TEXT NOT NULL,
            titulo TEXT NOT NULL,
            tipo TEXT NOT NULL, -- 'Directo' o 'Indirecto'
            orden INTEGER NOT NULL DEFAULT 0,
            nivel INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (budget_id) REFERENCES budgets (id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES budget_chapters (id) ON DELETE CASCADE
        )
    """)

    # 9. Actividades (Líneas de APU en Capítulos)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS budget_chapter_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_id INTEGER NOT NULL,
            apu_id INTEGER NOT NULL,
            cantidad REAL NOT NULL DEFAULT 1,
            precio_unitario REAL NOT NULL,
            total REAL NOT NULL,
            orden INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (chapter_id) REFERENCES budget_chapters (id) ON DELETE CASCADE,
            FOREIGN KEY (apu_id) REFERENCES apus (id)
        )
    """)

    # 10. Ítems de Presupuesto planos (compatibilidad APU 6.4 y 6.5)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS budget_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            budget_id INTEGER NOT NULL,
            apu_id INTEGER NOT NULL,
            cantidad REAL NOT NULL,
            precio_unitario REAL NOT NULL,
            total REAL NOT NULL,
            FOREIGN KEY (budget_id) REFERENCES budgets (id),
            FOREIGN KEY (apu_id) REFERENCES apus (id)
        )
    """)

    # 11. Historial de Facturación (12.3 Suscripción)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS billing_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            concepto TEXT NOT NULL,
            monto REAL NOT NULL,
            metodo_pago TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'Pagado',
            comprobante_numero TEXT NOT NULL,
            FOREIGN KEY (company_id) REFERENCES companies (id)
        )
    """)

    # 12. Roles Personalizados de la Empresa (12.4 Usuarios - Plan Empresarial)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS company_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            nombre TEXT NOT NULL,
            permisos TEXT NOT NULL,
            es_sistema INTEGER DEFAULT 0,
            FOREIGN KEY (company_id) REFERENCES companies (id)
        )
    """)

    # Migrar columnas existentes si la BD ya existía
    cursor.execute("PRAGMA table_info(budgets)")
    bcols = [r[1] for r in cursor.fetchall()]
    if 'ubicacion' not in bcols:
        cursor.execute("ALTER TABLE budgets ADD COLUMN ubicacion TEXT DEFAULT ''")
    if 'moneda' not in bcols:
        cursor.execute("ALTER TABLE budgets ADD COLUMN moneda TEXT DEFAULT 'COP'")
    if 'fecha_elaboracion' not in bcols:
        cursor.execute("ALTER TABLE budgets ADD COLUMN fecha_elaboracion TIMESTAMP")
        cursor.execute("UPDATE budgets SET fecha_elaboracion = datetime('now', 'localtime') WHERE fecha_elaboracion IS NULL")
    if 'fecha_ultima_modificacion' not in bcols:
        cursor.execute("ALTER TABLE budgets ADD COLUMN fecha_ultima_modificacion TIMESTAMP")
        cursor.execute("UPDATE budgets SET fecha_ultima_modificacion = datetime('now', 'localtime') WHERE fecha_ultima_modificacion IS NULL")
    if 'aiu_admin' not in bcols:
        cursor.execute("ALTER TABLE budgets ADD COLUMN aiu_admin REAL DEFAULT 0")
    if 'aiu_imprevistos' not in bcols:
        cursor.execute("ALTER TABLE budgets ADD COLUMN aiu_imprevistos REAL DEFAULT 0")
    if 'aiu_utilidad' not in bcols:
        cursor.execute("ALTER TABLE budgets ADD COLUMN aiu_utilidad REAL DEFAULT 0")

    # Migraciones en companies (12.2, 12.3, 12.5, 12.6, 12.7)
    cursor.execute("PRAGMA table_info(companies)")
    ccols = [r[1] for r in cursor.fetchall()]
    if 'direccion' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN direccion TEXT DEFAULT ''")
    if 'telefono' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN telefono TEXT DEFAULT ''")
    if 'fecha_vencimiento' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN fecha_vencimiento TEXT DEFAULT ''")
    if 'moneda' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN moneda TEXT DEFAULT 'COP'")
    if 'separador_miles' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN separador_miles TEXT DEFAULT '.'")
    if 'separador_decimal' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN separador_decimal TEXT DEFAULT ','")
    if 'decimales' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN decimales INTEGER DEFAULT 2")
    if 'aiu_admin' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN aiu_admin REAL DEFAULT 10.0")
    if 'aiu_imprevistos' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN aiu_imprevistos REAL DEFAULT 3.0")
    if 'aiu_utilidad' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN aiu_utilidad REAL DEFAULT 5.0")
    if 'notif_prueba' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN notif_prueba INTEGER DEFAULT 1")
    if 'notif_suscripcion' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN notif_suscripcion INTEGER DEFAULT 1")
    if 'notif_estado_proyecto' not in ccols:
        cursor.execute("ALTER TABLE companies ADD COLUMN notif_estado_proyecto INTEGER DEFAULT 1")

    # Migraciones en users (12.1 y 12.4)
    cursor.execute("PRAGMA table_info(users)")
    ucols = [r[1] for r in cursor.fetchall()]
    if 'estado' not in ucols:
        cursor.execute("ALTER TABLE users ADD COLUMN estado TEXT DEFAULT 'Activo'")
    if 'permisos' not in ucols:
        cursor.execute("ALTER TABLE users ADD COLUMN permisos TEXT DEFAULT ''")

    # Sembrar datos iniciales si no existen
    cursor.execute("SELECT id, razon_social, nit, plan, estado_suscripcion, fecha_registro, fecha_vencimiento FROM companies")
    companies_data = cursor.fetchall()

    for comp_row in companies_data:
        cid = comp_row[0]
        cplan = comp_row[3]
        cestado = comp_row[4]
        cfvenc = comp_row[6]

        # Garantizar fecha de vencimiento y datos de empresa
        if not cfvenc:
            import datetime
            hoy = datetime.date.today()
            if cestado == 'active':
                venc_default = (hoy + datetime.timedelta(days=30)).strftime('%Y-%m-%d')
            elif cestado == 'trial':
                venc_default = (hoy + datetime.timedelta(days=15)).strftime('%Y-%m-%d')
            else:
                venc_default = (hoy - datetime.timedelta(days=5)).strftime('%Y-%m-%d')
            cursor.execute("UPDATE companies SET fecha_vencimiento = ?, direccion = 'Cra. 43A # 1Sur-29, Of. 804, Medellín', telefono = '+57 (604) 448-9120' WHERE id = ?", (venc_default, cid))

        # Garantizar las 12 Unidades Oficiales de Colombia
        cursor.execute("SELECT COUNT(*) FROM measurement_units WHERE company_id = ?", (cid,))
        if cursor.fetchone()[0] == 0:
            for cod, nom, cat in DEFAULT_UNITS:
                cursor.execute("INSERT INTO measurement_units (company_id, codigo, nombre, categoria, editable) VALUES (?, ?, ?, ?, 1)", (cid, cod, nom, cat))

        # Garantizar roles de sistema para la empresa
        cursor.execute("SELECT COUNT(*) FROM company_roles WHERE company_id = ?", (cid,))
        if cursor.fetchone()[0] == 0:
            admin_p = json.dumps({
                "recursos": ["ver", "crear", "editar", "eliminar"],
                "apu": ["ver", "crear", "editar", "eliminar"],
                "presupuestos": ["ver", "crear", "editar", "exportar", "duplicar"],
                "avance": ["ver", "registrar", "exportar"],
                "configuracion": ["ver", "administrar"]
            })
            residente_p = json.dumps({
                "recursos": ["ver", "crear"],
                "apu": ["ver"],
                "presupuestos": ["ver", "exportar"],
                "avance": ["ver", "registrar", "exportar"],
                "configuracion": []
            })
            costos_p = json.dumps({
                "recursos": ["ver", "crear", "editar"],
                "apu": ["ver", "crear", "editar"],
                "presupuestos": ["ver", "crear", "editar", "exportar", "duplicar"],
                "avance": ["ver"],
                "configuracion": []
            })
            lector_p = json.dumps({
                "recursos": ["ver"],
                "apu": ["ver"],
                "presupuestos": ["ver", "exportar"],
                "avance": ["ver"],
                "configuracion": []
            })
            cursor.execute("INSERT INTO company_roles (company_id, nombre, permisos, es_sistema) VALUES (?, 'Administrador', ?, 1)", (cid, admin_p))
            cursor.execute("INSERT INTO company_roles (company_id, nombre, permisos, es_sistema) VALUES (?, 'Residente de Obra', ?, 1)", (cid, residente_p))
            cursor.execute("INSERT INTO company_roles (company_id, nombre, permisos, es_sistema) VALUES (?, 'Ingeniero de Costos', ?, 1)", (cid, costos_p))
            cursor.execute("INSERT INTO company_roles (company_id, nombre, permisos, es_sistema) VALUES (?, 'Lector', ?, 1)", (cid, lector_p))

        # Garantizar historial de facturación de demostración
        cursor.execute("SELECT COUNT(*) FROM billing_history WHERE company_id = ?", (cid,))
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
                INSERT INTO billing_history (company_id, fecha, concepto, monto, metodo_pago, estado, comprobante_numero)
                VALUES (?, '2026-09-01', 'Período de Prueba Gratuito (15 días)', 0.0, 'Promoción de Bienvenida', 'Aprobado', 'REC-2026-0001')
            """, (cid,))
            if cestado in ('active', 'expired', 'suspended'):
                cursor.execute("""
                    INSERT INTO billing_history (company_id, fecha, concepto, monto, metodo_pago, estado, comprobante_numero)
                    VALUES (?, '2026-08-15', 'Suscripción Plan Empresarial - Mensual', 189000.0, 'Transferencia Bancolombia', 'Pagado', 'FAC-2026-0892')
                """, (cid,))

        # Verificar recursos
        cursor.execute("SELECT COUNT(*) FROM resources WHERE company_id = ?", (cid,))
        if cursor.fetchone()[0] == 0:
            sample_resources = [
                ('MAT-001', 'Cemento Gris Uso General (50kg)', 'Materiales', 'sac', 32000.0, 19.0, 38080.0, 'A'),
                ('MAT-002', 'Arena de Peña Lavada', 'Materiales', 'm³', 75000.0, 0.0, 75000.0, 'A'),
                ('MAT-003', 'Grava Triturada 3/4', 'Materiales', 'm³', 85000.0, 0.0, 85000.0, 'A'),
                ('MAT-004', 'Acero Corrugado Figurado 60000 PSI', 'Materiales', 'kg', 4600.0, 19.0, 5474.0, 'A'),
                ('EQP-001', 'Mezcladora de Concreto 2 Bultos Trompo', 'Equipos', 'hr', 22000.0, 19.0, 26180.0, 'B'),
                ('EQP-002', 'Vibrador de Concreto a Gasolina 4HP', 'Equipos', 'hr', 18000.0, 19.0, 21420.0, 'A'),
                ('PER-001', 'Cuadrilla 1 Oficial + 1 Ayudante', 'Personal', 'jor', 160000.0, 0.0, 160000.0, 'B'),
                ('PER-002', 'Cuadrilla Fierrero Armador', 'Personal', 'jor', 175000.0, 0.0, 175000.0, 'B'),
                ('ACT-001', 'Prueba y Ensayo de Compresión de Cilindros', 'Actividades', 'un', 42000.0, 19.0, 49980.0, 'A'),
                ('ACT-002', 'Retiro de Escombros y Disposición Final Certificada', 'Actividades', 'm³', 58000.0, 0.0, 58000.0, 'A')
            ]
            for cod, nom, tip, uni, pbase, iva, ptot, via in sample_resources:
                cursor.execute("""
                    INSERT INTO resources (company_id, codigo, nombre, tipo, unidad, precio_base, iva_porcentaje, precio_total, via_precio)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (cid, cod, nom, tip, uni, pbase, iva, ptot, via))

        # Verificar APUs
        cursor.execute("SELECT COUNT(*) FROM apus WHERE company_id = ?", (cid,))
        if cursor.fetchone()[0] == 0:
            # APU 1: Concreto 3000 PSI
            cursor.execute("""
                INSERT INTO apus (company_id, codigo, nombre, unidad, costo_directo, activo, version)
                VALUES (?, 'APU-001', 'Concreto para zapatas y vigas 3000 PSI (Incluye mezclado y vaciado)', 'm³', 636750.0, 1, 1)
            """, (cid,))
            apu1_id = cursor.lastrowid

            # APU 2: Mampostería
            cursor.execute("""
                INSERT INTO apus (company_id, codigo, nombre, unidad, costo_directo, activo, version)
                VALUES (?, 'APU-002', 'Mampostería en ladrillo limpio tolete 12x6x24 (Mortero 1:4)', 'm²', 78500.0, 1, 1)
            """, (cid,))
            apu2_id = cursor.lastrowid

            # APU 3: Acero figurado
            cursor.execute("""
                INSERT INTO apus (company_id, codigo, nombre, unidad, costo_directo, activo, version)
                VALUES (?, 'APU-003', 'Suministro, figurado y colocación de acero de refuerzo 60000 PSI', 'kg', 6850.0, 1, 1)
            """, (cid,))
            apu3_id = cursor.lastrowid

            # Asociar líneas de recursos a APU-001
            cursor.execute("SELECT id FROM resources WHERE company_id = ? AND codigo = 'MAT-001'", (cid,))
            r_cemento = cursor.fetchone()
            if r_cemento:
                # 7 bultos por m3, 5% desperdicio
                subtot = 1 * 7.0 * (1 + 5.0/100) * 38080.0
                cursor.execute("""
                    INSERT INTO apu_resources (apu_id, resource_id, cantidad, rendimiento, desperdicio_porcentaje, subtotal)
                    VALUES (?, ?, 1.0, 7.0, 5.0, ?)
                """, (apu1_id, r_cemento[0], subtot))

            cursor.execute("SELECT id FROM resources WHERE company_id = ? AND codigo = 'PER-001'", (cid,))
            r_cuadrilla = cursor.fetchone()
            if r_cuadrilla:
                subtot = 1 * 0.35 * 160000.0
                cursor.execute("""
                    INSERT INTO apu_resources (apu_id, resource_id, cantidad, rendimiento, desperdicio_porcentaje, subtotal)
                    VALUES (?, ?, 1.0, 0.35, 0.0, ?)
                """, (apu1_id, r_cuadrilla[0], subtot))

            # Asociar líneas a APU-002
            if r_cuadrilla:
                subtot = 1 * 0.25 * 160000.0
                cursor.execute("""
                    INSERT INTO apu_resources (apu_id, resource_id, cantidad, rendimiento, desperdicio_porcentaje, subtotal)
                    VALUES (?, ?, 1.0, 0.25, 0.0, ?)
                """, (apu2_id, r_cuadrilla[0], subtot))

            # Sembrar presupuestos para probar 6.4 y 6.5
            cursor.execute("""
                INSERT INTO budgets (company_id, codigo, nombre, estado)
                VALUES (?, 'PRE-2026-001', 'Edificio Residencial Altavista - Etapa 1', 'Abierto')
            """, (cid,))
            b_abierto = cursor.lastrowid

            cursor.execute("""
                INSERT INTO budgets (company_id, codigo, nombre, estado)
                VALUES (?, 'PRE-2026-002', 'Centro Logístico del Valle - Bodega 3', 'Activo')
            """, (cid,))
            b_activo = cursor.lastrowid

            # Vincular APU-001 al presupuesto Abierto
            cursor.execute("""
                INSERT INTO budget_items (budget_id, apu_id, cantidad, precio_unitario, total)
                VALUES (?, ?, 150.0, 636750.0, 95512500.0)
            """, (b_abierto, apu1_id))

            # Vincular APU-002 al presupuesto Activo (congelado)
            cursor.execute("""
                INSERT INTO budget_items (budget_id, apu_id, cantidad, precio_unitario, total)
                VALUES (?, ?, 450.0, 78500.0, 35325000.0)
            """, (b_activo, apu2_id))

    conn.commit()
    conn.close()

def generate_next_resource_code(company_id, tipo):
    prefix = TYPE_PREFIXES.get(tipo, 'REC')
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT codigo FROM resources
        WHERE company_id = ? AND codigo LIKE ?
        ORDER BY id DESC LIMIT 1
    """, (company_id, f"{prefix}-%"))
    row = cursor.fetchone()
    conn.close()
    if row and row[0]:
        match = re.search(r'-(\d+)$', row[0])
        if match:
            return f"{prefix}-{int(match.group(1)) + 1:03d}"
    return f"{prefix}-001"

def generate_next_apu_code(company_id):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT codigo FROM apus
        WHERE company_id = ? AND codigo LIKE 'APU-%'
        ORDER BY id DESC LIMIT 1
    """, (company_id,))
    row = cursor.fetchone()
    conn.close()
    if row and row[0]:
        match = re.search(r'-(\d+)$', row[0])
        if match:
            return f"APU-{int(match.group(1)) + 1:03d}"
    return "APU-001"

def recalculate_budget_numbering(budget_id, conn):
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, parent_id, orden
        FROM budget_chapters
        WHERE budget_id = ?
        ORDER BY orden ASC, id ASC
    """, (budget_id,))
    rows = cursor.fetchall()

    by_parent = {}
    for cid, pid, orden in rows:
        if pid not in by_parent:
            by_parent[pid] = []
        by_parent[pid].append(cid)

    def assign_numbers(parent_id, prefix, nivel):
        children = by_parent.get(parent_id, [])
        for idx, cid in enumerate(children):
            num = f"{prefix}{idx + 1}" if prefix else str(idx + 1)
            cursor.execute("""
                UPDATE budget_chapters
                SET numero = ?, nivel = ?, orden = ?
                WHERE id = ?
            """, (num, nivel, idx, cid))
            assign_numbers(cid, f"{num}.", nivel + 1)

    assign_numbers(None, "", 1)
    conn.commit()

def update_chapter_nature(chapter_id, new_tipo, conn):
    cursor = conn.cursor()
    cursor.execute("UPDATE budget_chapters SET tipo = ? WHERE id = ?", (new_tipo, chapter_id))
    def cascade_tipo(parent_id):
        cursor.execute("SELECT id FROM budget_chapters WHERE parent_id = ?", (parent_id,))
        child_ids = [r[0] for r in cursor.fetchall()]
        for cid in child_ids:
            cursor.execute("UPDATE budget_chapters SET tipo = ? WHERE id = ?", (new_tipo, cid))
            cascade_tipo(cid)
    cascade_tipo(chapter_id)
    conn.commit()

def delete_chapter_recursive(chapter_id, conn):
    cursor = conn.cursor()
    to_delete = [chapter_id]
    def collect_children(pid):
        cursor.execute("SELECT id FROM budget_chapters WHERE parent_id = ?", (pid,))
        child_ids = [r[0] for r in cursor.fetchall()]
        for cid in child_ids:
            to_delete.append(cid)
            collect_children(cid)
    collect_children(chapter_id)

    for cid in to_delete:
        cursor.execute("DELETE FROM budget_chapter_items WHERE chapter_id = ?", (cid,))
        cursor.execute("DELETE FROM budget_chapters WHERE id = ?", (cid,))
    conn.commit()

def get_budget_detail_data(budget_id):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, company_id, codigo, nombre, estado, ubicacion, moneda,
               fecha_elaboracion, fecha_ultima_modificacion,
               aiu_admin, aiu_imprevistos, aiu_utilidad
        FROM budgets WHERE id = ?
    """, (budget_id,))
    brow = cursor.fetchone()
    if not brow:
        conn.close()
        return None

    budget = {
        'id': brow[0],
        'companyId': brow[1],
        'codigo': brow[2],
        'nombre': brow[3],
        'estado': brow[4],
        'ubicacion': brow[5] or '',
        'moneda': brow[6] or 'COP',
        'fechaElaboracion': brow[7] or '',
        'fechaUltimaModificacion': brow[8] or '',
        'aiuAdmin': float(brow[9] or 0),
        'aiuImprevistos': float(brow[10] or 0),
        'aiuUtilidad': float(brow[11] or 0)
    }

    cursor.execute("""
        SELECT id, parent_id, numero, titulo, tipo, orden, nivel
        FROM budget_chapters
        WHERE budget_id = ?
        ORDER BY nivel ASC, orden ASC, id ASC
    """, (budget_id,))
    ch_rows = cursor.fetchall()

    cursor.execute("""
        SELECT bci.id, bci.chapter_id, bci.apu_id, bci.cantidad, bci.precio_unitario, bci.total, bci.orden,
               a.codigo, a.nombre, a.unidad
        FROM budget_chapter_items bci
        JOIN apus a ON bci.apu_id = a.id
        WHERE bci.chapter_id IN (SELECT id FROM budget_chapters WHERE budget_id = ?)
        ORDER BY bci.orden ASC, bci.id ASC
    """, (budget_id,))
    item_rows = cursor.fetchall()
    conn.close()

    items_by_chapter = {}
    for ir in item_rows:
        cid = ir[1]
        if cid not in items_by_chapter:
            items_by_chapter[cid] = []
        items_by_chapter[cid].append({
            'id': ir[0],
            'chapterId': ir[1],
            'apuId': ir[2],
            'cantidad': ir[3],
            'precioUnitario': ir[4],
            'total': ir[5],
            'orden': ir[6],
            'codigo': ir[7],
            'nombre': ir[8],
            'unidad': ir[9]
        })

    chapter_map = {}
    root_chapters = []
    for cr in ch_rows:
        ch = {
            'id': cr[0],
            'parentId': cr[1],
            'numero': cr[2],
            'titulo': cr[3],
            'tipo': cr[4],
            'orden': cr[5],
            'nivel': cr[6],
            'items': items_by_chapter.get(cr[0], []),
            'subcapitulos': [],
            'montoAcumulado': 0.0,
            'incidencia': None
        }
        chapter_map[cr[0]] = ch

    for cid, ch in chapter_map.items():
        if ch['parentId'] and ch['parentId'] in chapter_map:
            chapter_map[ch['parentId']]['subcapitulos'].append(ch)
        else:
            root_chapters.append(ch)

    for ch in chapter_map.values():
        ch['subcapitulos'].sort(key=lambda x: (x['orden'], x['id']))
    root_chapters.sort(key=lambda x: (x['orden'], x['id']))

    def compute_chapter_total(ch):
        item_total = sum(i['total'] for i in ch['items'])
        sub_total = sum(compute_chapter_total(sub) for sub in ch['subcapitulos'])
        ch['montoAcumulado'] = round(item_total + sub_total, 2)
        return ch['montoAcumulado']

    for rch in root_chapters:
        compute_chapter_total(rch)

    costo_directo = sum(rch['montoAcumulado'] for rch in root_chapters if rch['tipo'] == 'Directo')
    costo_indirecto = sum(rch['montoAcumulado'] for rch in root_chapters if rch['tipo'] == 'Indirecto')

    def compute_incidencia(ch):
        if costo_directo > 0:
            ch['incidencia'] = round((ch['montoAcumulado'] / costo_directo) * 100.0, 2)
        else:
            ch['incidencia'] = None
        for sub in ch['subcapitulos']:
            compute_incidencia(sub)

    for rch in root_chapters:
        compute_incidencia(rch)

    pct_a = budget['aiuAdmin']
    pct_i = budget['aiuImprevistos']
    pct_u = budget['aiuUtilidad']

    monto_a = round(costo_directo * (pct_a / 100.0), 2)
    monto_i = round(costo_directo * (pct_i / 100.0), 2)
    monto_u = round(costo_directo * (pct_u / 100.0), 2)
    monto_aiu = round(monto_a + monto_i + monto_u, 2)
    valor_total = round(costo_directo + monto_aiu + costo_indirecto, 2)

    has_direct = any(rch['tipo'] == 'Directo' for rch in root_chapters)
    aiu_configured = (pct_a > 0 or pct_i > 0 or pct_u > 0)

    summary = {
        'costoDirecto': round(costo_directo, 2),
        'costoIndirecto': round(costo_indirecto, 2),
        'aiuAdminPct': pct_a,
        'aiuAdminMonto': monto_a,
        'aiuImprevistosPct': pct_i,
        'aiuImprevistosMonto': monto_i,
        'aiuUtilidadPct': pct_u,
        'aiuUtilidadMonto': monto_u,
        'montoAiu': monto_aiu,
        'valorTotal': valor_total,
        'hasDirectChapters': has_direct,
        'aiuConfigured': aiu_configured,
        'showNoDirectWarning': (not has_direct and aiu_configured)
    }

    return {
        'budget': budget,
        'capitulos': root_chapters,
        'resumen': summary
    }

def get_budgets_list_data(company_id):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, codigo, nombre, ubicacion, moneda, fecha_elaboracion, fecha_ultima_modificacion, estado,
               aiu_admin, aiu_imprevistos, aiu_utilidad
        FROM budgets
        WHERE company_id = ?
        ORDER BY id DESC
    """, (company_id,))
    brows = cursor.fetchall()
    conn.close()

    result = []
    for b in brows:
        bid = b[0]
        detail = get_budget_detail_data(bid)
        if detail:
            resumen = detail['resumen']
            result.append({
                'id': bid,
                'codigo': b[1],
                'nombre': b[2],
                'ubicacion': b[3] or '',
                'moneda': b[4] or 'COP',
                'fechaElaboracion': b[5] or '',
                'fechaUltimaModificacion': b[6] or '',
                'estado': b[7],
                'costoDirecto': resumen['costoDirecto'],
                'costoIndirecto': resumen['costoIndirecto'],
                'aiuAdmin': resumen['aiuAdminPct'],
                'aiuImprevistos': resumen['aiuImprevistosPct'],
                'aiuUtilidad': resumen['aiuUtilidadPct'],
                'montoAiu': resumen['montoAiu'],
                'valorTotal': resumen['valorTotal']
            })
        else:
            result.append({
                'id': bid,
                'codigo': b[1],
                'nombre': b[2],
                'ubicacion': b[3] or '',
                'moneda': b[4] or 'COP',
                'fechaElaboracion': b[5] or '',
                'fechaUltimaModificacion': b[6] or '',
                'estado': b[7],
                'costoDirecto': 0.0,
                'costoIndirecto': 0.0,
                'aiuAdmin': float(b[8] or 0),
                'aiuImprevistos': float(b[9] or 0),
                'aiuUtilidad': float(b[10] or 0),
                'montoAiu': 0.0,
                'valorTotal': 0.0
            })
    return result

class ConstruSoftHandler(http.server.SimpleHTTPRequestHandler):

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        # 1. API Status
        if parsed.path == '/api/status':
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM users")
            user_count = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM companies")
            comp_count = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM resources")
            res_count = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM apus")
            apu_count = cursor.fetchone()[0]
            conn.close()

            self.send_json({
                'status': 'online',
                'database': 'SQLite (construsoft.db)',
                'total_users': user_count,
                'total_companies': comp_count,
                'total_resources': res_count,
                'total_apus': apu_count
            })
            return

        # 2. Unidades de Medida (12.6 Parametrización y selectores)
        elif parsed.path == '/api/units':
            company_id = params.get('company_id', [1])[0]
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT id, codigo, nombre, categoria, editable FROM measurement_units WHERE company_id = ? ORDER BY id ASC", (company_id,))
            rows = cursor.fetchall()
            if not rows:
                for cod, nom, cat in DEFAULT_UNITS:
                    cursor.execute("INSERT INTO measurement_units (company_id, codigo, nombre, categoria, editable) VALUES (?, ?, ?, ?, 1)", (company_id, cod, nom, cat))
                conn.commit()
                cursor.execute("SELECT id, codigo, nombre, categoria, editable FROM measurement_units WHERE company_id = ? ORDER BY id ASC", (company_id,))
                rows = cursor.fetchall()

            units = []
            for r in rows:
                uid, cod, nom, cat, edit = r[0], r[1], r[2], r[3], r[4]
                cursor.execute("SELECT codigo, nombre FROM resources WHERE company_id = ? AND LOWER(TRIM(unidad)) = LOWER(TRIM(?))", (company_id, cod))
                res_matches = cursor.fetchall()
                cursor.execute("SELECT codigo, nombre FROM apus WHERE company_id = ? AND LOWER(TRIM(unidad)) = LOWER(TRIM(?))", (company_id, cod))
                apu_matches = cursor.fetchall()

                en_uso = (len(res_matches) > 0 or len(apu_matches) > 0)
                units.append({
                    'id': uid,
                    'codigo': cod,
                    'nombre': nom,
                    'categoria': cat,
                    'editable': bool(edit),
                    'enUso': en_uso,
                    'recursosCount': len(res_matches),
                    'apusCount': len(apu_matches),
                    'recursosNombres': [f"[{rm[0]}] {rm[1]}" for rm in res_matches],
                    'apusNombres': [f"[{am[0]}] {am[1]}" for am in apu_matches]
                })
            conn.close()
            self.send_json({'success': True, 'units': units})
            return

        # 2.1 Configuración de Empresa (12.1 - 12.7)
        match_cfg = re.match(r'^/api/companies/(\d+)/config$', parsed.path)
        if match_cfg:
            cid = int(match_cfg.group(1))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, razon_social, nit, logo_data, plan, estado_suscripcion, dias_prueba, fecha_registro,
                       direccion, telefono, fecha_vencimiento, moneda, separador_miles, separador_decimal, decimales,
                       aiu_admin, aiu_imprevistos, aiu_utilidad, notif_prueba, notif_suscripcion, notif_estado_proyecto
                FROM companies WHERE id = ?
            """, (cid,))
            crow = cursor.fetchone()
            if not crow:
                conn.close()
                self.send_json({'success': False, 'message': 'Empresa no encontrada.'}, 404)
                return

            cursor.execute("SELECT COUNT(*) FROM resources WHERE company_id = ?", (cid,))
            res_count = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM apus WHERE company_id = ?", (cid,))
            apu_count = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM budgets WHERE company_id = ?", (cid,))
            bg_count = cursor.fetchone()[0]
            moneda_bloqueada = (res_count > 0 or apu_count > 0 or bg_count > 0)

            estado_guardado = crow[5] or 'trial'
            fecha_venc = crow[10]
            dias_prueba = crow[6] if crow[6] is not None else 15
            fecha_reg = crow[7] or ''

            import datetime
            hoy = datetime.date.today()
            if not fecha_venc:
                try:
                    base_d = datetime.datetime.strptime(fecha_reg[:10], '%Y-%m-%d').date()
                except Exception:
                    base_d = hoy
                fecha_venc_obj = base_d + datetime.timedelta(days=dias_prueba)
                fecha_venc = fecha_venc_obj.strftime('%Y-%m-%d')
                cursor.execute("UPDATE companies SET fecha_vencimiento = ? WHERE id = ?", (fecha_venc, cid))
                conn.commit()
            else:
                try:
                    fecha_venc_obj = datetime.datetime.strptime(fecha_venc[:10], '%Y-%m-%d').date()
                except Exception:
                    fecha_venc_obj = hoy + datetime.timedelta(days=15)

            dias_restantes = (fecha_venc_obj - hoy).days

            # Derivación de estado de suscripción:
            # «Cancelada» solo lo escribe el superadmin.
            # «Vencida» no es guardado: se deriva comparando fecha_vencimiento con hoy.
            if estado_guardado == 'Cancelada':
                estado_derivado = 'Cancelada'
            elif estado_guardado == 'trial':
                if dias_restantes < 0:
                    estado_derivado = 'Vencida'
                else:
                    estado_derivado = 'En prueba'
            elif estado_guardado == 'active':
                if dias_restantes < 0:
                    estado_derivado = 'Vencida'
                else:
                    estado_derivado = 'Activa'
            else:
                estado_derivado = 'Vencida' if dias_restantes < 0 else estado_guardado

            comp_data = {
                'id': crow[0],
                'razonSocial': crow[1],
                'nit': crow[2],
                'logoData': crow[3],
                'plan': crow[4],
                'estadoSuscripcion': estado_derivado,
                'estadoGuardado': estado_guardado,
                'diasPruebaRestantes': max(0, dias_restantes) if estado_derivado == 'En prueba' else dias_restantes,
                'fechaRegistro': crow[7],
                'direccion': crow[8] or '',
                'telefono': crow[9] or '',
                'fechaVencimiento': fecha_venc,
                'diasRestantes': dias_restantes,
                'moneda': crow[11] or 'COP',
                'separadorMiles': crow[12] or '.',
                'separadorDecimal': crow[13] or ',',
                'decimales': crow[14] if crow[14] is not None else 2,
                'aiuAdmin': float(crow[15] if crow[15] is not None else 0),
                'aiuImprevistos': float(crow[16] if crow[16] is not None else 0),
                'aiuUtilidad': float(crow[17] if crow[17] is not None else 0),
                'notifPrueba': bool(crow[18] if crow[18] is not None else 1),
                'notifSuscripcion': bool(crow[19] if crow[19] is not None else 1),
                'notifEstadoProyecto': bool(crow[20] if crow[20] is not None else 1),
                'monedaBloqueada': moneda_bloqueada,
                'totalRecursos': res_count,
                'totalApus': apu_count,
                'totalPresupuestos': bg_count
            }
            conn.close()
            self.send_json({'success': True, 'company': comp_data})
            return

        # 2.2 Historial de Facturación (12.3 Suscripción)
        match_bill = re.match(r'^/api/companies/(\d+)/billing$', parsed.path)
        if match_bill:
            cid = int(match_bill.group(1))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, fecha, concepto, monto, metodo_pago, estado, comprobante_numero
                FROM billing_history
                WHERE company_id = ?
                ORDER BY id DESC
            """, (cid,))
            rows = cursor.fetchall()
            bills = []
            for r in rows:
                bills.append({
                    'id': r[0],
                    'fecha': r[1],
                    'concepto': r[2],
                    'monto': float(r[3]),
                    'metodoPago': r[4],
                    'estado': r[5],
                    'comprobanteNumero': r[6]
                })
            conn.close()
            self.send_json({'success': True, 'billing': bills})
            return

        # 2.3 Usuarios de la Empresa (12.4 Usuarios)
        match_users = re.match(r'^/api/companies/(\d+)/users$', parsed.path)
        if match_users:
            cid = int(match_users.group(1))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, nombre, email, rol, estado, permisos, requiere_cambio_clave
                FROM users
                WHERE company_id = ?
                ORDER BY id ASC
            """, (cid,))
            rows = cursor.fetchall()
            users_list = []
            for r in rows:
                perms = {}
                if r[5]:
                    try: perms = json.loads(r[5])
                    except Exception: perms = {}
                users_list.append({
                    'id': r[0],
                    'nombre': r[1],
                    'email': r[2],
                    'rol': r[3],
                    'estado': r[4] or ('Pendiente' if r[6] else 'Activo'),
                    'permisos': perms,
                    'requiereCambioClave': bool(r[6])
                })
            conn.close()
            self.send_json({'success': True, 'users': users_list})
            return

        # 2.4 Roles de la Empresa (12.4 - Plan Empresarial)
        match_roles = re.match(r'^/api/companies/(\d+)/roles$', parsed.path)
        if match_roles:
            cid = int(match_roles.group(1))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, nombre, permisos, es_sistema
                FROM company_roles
                WHERE company_id = ?
                ORDER BY es_sistema DESC, id ASC
            """, (cid,))
            rows = cursor.fetchall()
            roles_list = []
            for r in rows:
                perms = {}
                if r[2]:
                    try: perms = json.loads(r[2])
                    except Exception: perms = {}
                roles_list.append({
                    'id': r[0],
                    'nombre': r[1],
                    'permisos': perms,
                    'esSistema': bool(r[3])
                })
            conn.close()
            self.send_json({'success': True, 'roles': roles_list})
            return

        # 3. Listar Recursos (5.1)
        elif parsed.path == '/api/resources':
            company_id = params.get('company_id', [None])[0]
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            query = """
                SELECT r.id, r.codigo, r.nombre, r.tipo, r.unidad, r.precio_base,
                       r.iva_porcentaje, r.precio_total, r.via_precio, r.fecha_creacion,
                       GROUP_CONCAT(a.nombre, '||') as apus_nombres
                FROM resources r
                LEFT JOIN apu_resources ar ON r.id = ar.resource_id
                LEFT JOIN apus a ON ar.apu_id = a.id
            """
            params_sql = []
            if company_id:
                query += " WHERE r.company_id = ?"
                params_sql.append(company_id)

            query += " GROUP BY r.id ORDER BY r.id DESC"
            cursor.execute(query, params_sql)
            rows = cursor.fetchall()
            conn.close()

            resources = []
            for r in rows:
                apus_str = r[10]
                apus_list = [name.strip() for name in apus_str.split('||')] if apus_str else []
                resources.append({
                    'id': r[0],
                    'codigo': r[1],
                    'nombre': r[2],
                    'tipo': r[3],
                    'unidad': r[4],
                    'precioBase': r[5],
                    'ivaPorcentaje': r[6],
                    'precioTotal': r[7],
                    'viaPrecio': r[8],
                    'fechaCreacion': r[9],
                    'enUso': len(apus_list) > 0,
                    'apusVinculados': apus_list
                })

            self.send_json({'success': True, 'resources': resources})
            return

        # 4. Listar APUs (6.1 Vista Maestra)
        elif parsed.path == '/api/apus':
            company_id = params.get('company_id', [None])[0]
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            query = """
                SELECT a.id, a.codigo, a.nombre, a.unidad, a.costo_directo, a.activo, a.version,
                       COUNT(DISTINCT ar.id) as num_recursos,
                       COUNT(DISTINCT bi.budget_id) as num_presupuestos
                FROM apus a
                LEFT JOIN apu_resources ar ON a.id = ar.apu_id
                LEFT JOIN budget_items bi ON a.id = bi.apu_id
            """
            params_sql = []
            if company_id:
                query += " WHERE a.company_id = ?"
                params_sql.append(company_id)

            query += " GROUP BY a.id ORDER BY a.id DESC"
            cursor.execute(query, params_sql)
            rows = cursor.fetchall()
            conn.close()

            apus = []
            for r in rows:
                apus.append({
                    'id': r[0],
                    'codigo': r[1],
                    'nombre': r[2],
                    'unidad': r[3],
                    'costoDirecto': r[4],
                    'activo': bool(r[5]),
                    'version': r[6],
                    'numRecursos': r[7],
                    'numPresupuestos': r[8]
                })

            self.send_json({'success': True, 'apus': apus})
            return

        # 5. Consultar Detalle de un APU específico (6.3)
        match_apu = re.match(r'^/api/apus/(\d+)$', parsed.path)
        if match_apu:
            apu_id = int(match_apu.group(1))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            # Cabecera del APU
            cursor.execute("""
                SELECT a.id, a.codigo, a.nombre, a.unidad, a.costo_directo, a.activo, a.version
                FROM apus a
                WHERE a.id = ?
            """, (apu_id,))
            apu_row = cursor.fetchone()

            if not apu_row:
                conn.close()
                self.send_json({'success': False, 'message': 'APU no encontrado'}, 404)
                return

            # Líneas de recursos del APU
            cursor.execute("""
                SELECT ar.id, ar.resource_id, ar.cantidad, ar.rendimiento, ar.desperdicio_porcentaje, ar.subtotal,
                       r.codigo, r.nombre, r.tipo, r.unidad, r.precio_total
                FROM apu_resources ar
                JOIN resources r ON ar.resource_id = r.id
                WHERE ar.apu_id = ?
            """, (apu_id,))
            lines_rows = cursor.fetchall()

            # Verificar si está en presupuestos abiertos / activos / cerrados (6.4)
            cursor.execute("""
                SELECT b.id, b.codigo, b.nombre, b.estado
                FROM budget_items bi
                JOIN budgets b ON bi.budget_id = b.id
                WHERE bi.apu_id = ?
            """, (apu_id,))
            budget_rows = cursor.fetchall()
            conn.close()

            lines = []
            for line in lines_rows:
                lines.append({
                    'id': line[0],
                    'resourceId': line[1],
                    'cantidad': line[2],
                    'rendimiento': line[3],
                    'desperdicio': line[4],
                    'subtotal': line[5],
                    'codigo': line[6],
                    'nombre': line[7],
                    'tipo': line[8],
                    'unidad': line[9],
                    'precioTotal': line[10]
                })

            presupuestos_abiertos = [{'id': b[0], 'codigo': b[1], 'nombre': b[2]} for b in budget_rows if b[3] == 'Abierto']
            presupuestos_activos = [{'id': b[0], 'codigo': b[1], 'nombre': b[2]} for b in budget_rows if b[3] == 'Activo']
            presupuestos_cerrados = [{'id': b[0], 'codigo': b[1], 'nombre': b[2]} for b in budget_rows if b[3] == 'Cerrado']

            apu_detail = {
                'id': apu_row[0],
                'codigo': apu_row[1],
                'nombre': apu_row[2],
                'unidad': apu_row[3],
                'costoDirecto': apu_row[4],
                'activo': bool(apu_row[5]),
                'version': apu_row[6],
                'lines': lines,
                'presupuestosAbiertos': presupuestos_abiertos,
                'presupuestosActivos': presupuestos_activos,
                'presupuestosCerrados': presupuestos_cerrados,
                'enUso': len(budget_rows) > 0
            }

            self.send_json({'success': True, 'apu': apu_detail})
            return

        # 5. Comprobar disponibilidad de código de presupuesto (7.1)
        elif parsed.path == '/api/budgets/check-code':
            codigo = params.get('codigo', [''])[0].strip()
            company_id = int(params.get('company_id', [1])[0])
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM budgets WHERE company_id = ? AND LOWER(codigo) = LOWER(?)", (company_id, codigo))
            row = cursor.fetchone()
            conn.close()
            self.send_json({'available': row is None})
            return

        # 6. Detalle completo de Presupuesto y Mesa de Trabajo (Módulo 8)
        match_bg = re.match(r'^/api/budgets/(\d+)$', parsed.path)
        if match_bg:
            budget_id = int(match_bg.group(1))
            detail = get_budget_detail_data(budget_id)
            if not detail:
                self.send_json({'success': False, 'message': 'Presupuesto no encontrado'}, 404)
                return
            self.send_json({'success': True, 'data': detail})
            return

        # 7. Listado maestro de Presupuestos (Módulo 7)
        elif parsed.path == '/api/budgets':
            company_id = int(params.get('company_id', [1])[0])
            budgets = get_budgets_list_data(company_id)
            self.send_json({'success': True, 'budgets': budgets})
            return

        # Servir estáticos
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        # 1. Registro
        if parsed.path == '/api/register':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            cuenta = data.get('cuenta', {})
            empresa = data.get('empresa', {})
            plan = data.get('plan')

            nombre = cuenta.get('nombre', '').strip()
            email = cuenta.get('email', '').strip().lower()
            password = cuenta.get('password', '')

            razon_social = empresa.get('razonSocial', '').strip()
            nit = empresa.get('nit', '').strip()
            logo_data = empresa.get('logoData')

            if not nombre or not email or not password or len(password) < 8:
                self.send_json({'success': False, 'message': 'Datos de cuenta incompletos o contraseña menor a 8 caracteres.'}, 400)
                return

            if not razon_social or not nit or not plan:
                self.send_json({'success': False, 'message': 'Debe ingresar la empresa y seleccionar obligatoriamente un plan.'}, 400)
                return

            nit_regex = re.compile(r'^(\d{1,3}(\.\d{3}){2,3}-\d|\d{8,10}-\d)$')
            if not nit_regex.match(nit):
                self.send_json({'success': False, 'message': 'El NIT no cumple con una estructura válida (ej. 901.458.789-3 o 901458789-3).'}, 400)
                return

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
            if cursor.fetchone():
                conn.close()
                self.send_json({'success': False, 'message': 'El correo electrónico ya se encuentra registrado en la plataforma.'}, 409)
                return

            cursor.execute("""
                INSERT INTO companies (razon_social, nit, logo_data, plan, estado_suscripcion, dias_prueba)
                VALUES (?, ?, ?, ?, 'trial', 15)
            """, (razon_social, nit, logo_data, plan))
            company_id = cursor.lastrowid

            cursor.execute("""
                INSERT INTO users (nombre, email, password, rol, company_id, requiere_cambio_clave)
                VALUES (?, ?, ?, 'Administrador', ?, 0)
            """, (nombre, email, password, company_id))
            user_id = cursor.lastrowid

            for cod, nom, cat in DEFAULT_UNITS:
                cursor.execute("""
                    INSERT INTO measurement_units (company_id, codigo, nombre, categoria)
                    VALUES (?, ?, ?, ?)
                """, (company_id, cod, nom, cat))

            conn.commit()
            conn.close()

            init_db()

            user_obj = {
                'id': user_id,
                'nombre': nombre,
                'email': email,
                'rol': 'Administrador',
                'company': {
                    'id': company_id,
                    'razonSocial': razon_social,
                    'nit': nit,
                    'plan': plan,
                    'estadoSuscripcion': 'trial',
                    'diasPruebaRestantes': 15
                }
            }

            self.send_json({'success': True, 'message': 'Registro completado con éxito.', 'user': user_obj})
            return

        # 2. Login
        elif parsed.path == '/api/login':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            email = data.get('email', '').strip().lower()
            password = data.get('password', '')

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("""
                SELECT u.id, u.nombre, u.email, u.password, u.rol, u.requiere_cambio_clave,
                       c.id, c.razon_social, c.nit, c.plan, c.estado_suscripcion, c.dias_prueba
                FROM users u
                JOIN companies c ON u.company_id = c.id
                WHERE u.email = ?
            """, (email,))
            row = cursor.fetchone()
            conn.close()

            if not row or row[3] != password:
                self.send_json({'success': False, 'message': 'Credenciales inválidas. Correo o contraseña incorrectos.'}, 401)
                return

            user_obj = {
                'id': row[0],
                'nombre': row[1],
                'email': row[2],
                'rol': row[4],
                'requiereCambioClave': bool(row[5]),
                'company': {
                    'id': row[6],
                    'razonSocial': row[7],
                    'nit': row[8],
                    'plan': row[9],
                    'estadoSuscripcion': row[10],
                    'diasPruebaRestantes': row[11]
                }
            }

            self.send_json({'success': True, 'user': user_obj})
            return

        # 3. Crear Recurso (5.2)
        elif parsed.path == '/api/resources':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            company_id = data.get('companyId', 1)
            nombre = data.get('nombre', '').strip()
            tipo = data.get('tipo', '').strip()
            unidad = data.get('unidad', '').strip()
            precio_base = float(data.get('precioBase', 0))
            iva_porcentaje = float(data.get('ivaPorcentaje', 0))
            precio_total = float(data.get('precioTotal', 0))
            via_precio = data.get('viaPrecio', 'A')

            if not nombre:
                self.send_json({'success': False, 'message': 'El nombre del recurso es obligatorio.'}, 400)
                return
            if not tipo or tipo not in TYPE_PREFIXES:
                self.send_json({'success': False, 'message': 'Debe seleccionar un tipo de recurso válido.'}, 400)
                return
            if not unidad:
                self.send_json({'success': False, 'message': 'La unidad de medida es obligatoria.'}, 400)
                return

            codigo_auto = generate_next_resource_code(company_id, tipo)

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO resources (company_id, codigo, nombre, tipo, unidad, precio_base, iva_porcentaje, precio_total, via_precio)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (company_id, codigo_auto, nombre, tipo, unidad, precio_base, iva_porcentaje, precio_total, via_precio))
            new_id = cursor.lastrowid
            conn.commit()
            conn.close()

            self.send_json({
                'success': True,
                'message': 'Recurso registrado exitosamente.',
                'resource': {
                    'id': new_id,
                    'codigo': codigo_auto,
                    'nombre': nombre,
                    'tipo': tipo,
                    'unidad': unidad,
                    'precioBase': precio_base,
                    'ivaPorcentaje': iva_porcentaje,
                    'precioTotal': precio_total,
                    'viaPrecio': via_precio,
                    'enUso': False,
                    'apusVinculados': []
                }
            })
            return

        # 4. Crear APU (6.2)
        elif parsed.path == '/api/apus':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            company_id = data.get('companyId', 1)
            nombre = data.get('nombre', '').strip()
            unidad = data.get('unidad', '').strip()
            lines = data.get('lines', [])

            if not nombre:
                self.send_json({'success': False, 'message': 'El nombre de la actividad APU es obligatorio.'}, 400)
                return
            if not unidad:
                self.send_json({'success': False, 'message': 'La unidad de medida del APU es obligatoria.'}, 400)
                return

            # Calcular costo directo y validar líneas
            costo_directo_total = 0.0
            for line in lines:
                cant = float(line.get('cantidad', 1))
                rend = float(line.get('rendimiento', 1))
                desp = float(line.get('desperdicio', 0))
                ptot = float(line.get('precioTotal', 0))
                subtot = cant * rend * (1 + desp / 100.0) * ptot
                line['subtotal_calc'] = round(subtot, 2)
                costo_directo_total += subtot

            codigo_auto = generate_next_apu_code(company_id)

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO apus (company_id, codigo, nombre, unidad, costo_directo, activo, version)
                VALUES (?, ?, ?, ?, ?, 1, 1)
            """, (company_id, codigo_auto, nombre, unidad, round(costo_directo_total, 2)))
            new_apu_id = cursor.lastrowid

            for line in lines:
                res_id = int(line.get('resourceId'))
                cant = float(line.get('cantidad', 1))
                rend = float(line.get('rendimiento', 1))
                desp = float(line.get('desperdicio', 0))
                subtot = line['subtotal_calc']
                cursor.execute("""
                    INSERT INTO apu_resources (apu_id, resource_id, cantidad, rendimiento, desperdicio_porcentaje, subtotal)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (new_apu_id, res_id, cant, rend, desp, subtot))

            conn.commit()
            conn.close()

            self.send_json({
                'success': True,
                'message': 'APU creado exitosamente.',
                'apu': {
                    'id': new_apu_id,
                    'codigo': codigo_auto,
                    'nombre': nombre,
                    'unidad': unidad,
                    'costoDirecto': round(costo_directo_total, 2),
                    'activo': True,
                    'version': 1
                }
            })
            return

        # 5. Crear Presupuesto (7.1)
        elif parsed.path == '/api/budgets':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            company_id = int(data.get('companyId', 1))
            codigo = data.get('codigo', '').strip()
            nombre = data.get('nombre', '').strip()
            ubicacion = data.get('ubicacion', '').strip()
            moneda = data.get('moneda', 'COP').strip() or 'COP'

            if not codigo:
                self.send_json({'success': False, 'message': 'El código del presupuesto es obligatorio.'}, 400)
                return
            if not nombre:
                self.send_json({'success': False, 'message': 'El nombre del proyecto es obligatorio.'}, 400)
                return
            if not ubicacion:
                self.send_json({'success': False, 'message': 'La ubicación del proyecto es obligatoria.'}, 400)
                return

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            # Validación de código único por empresa
            cursor.execute("SELECT id FROM budgets WHERE company_id = ? AND LOWER(codigo) = LOWER(?)", (company_id, codigo))
            if cursor.fetchone():
                conn.close()
                self.send_json({'success': False, 'message': f"El código '{codigo}' ya está en uso en otro presupuesto de la empresa."}, 400)
                return

            # Precargar automáticamente moneda y AIU estándar configurados en la empresa (12.5 y 12.6)
            cursor.execute("SELECT moneda, aiu_admin, aiu_imprevistos, aiu_utilidad FROM companies WHERE id = ?", (company_id,))
            comp_row = cursor.fetchone()
            def_moneda = (comp_row[0] if comp_row and comp_row[0] else 'COP')
            def_admin = float(comp_row[1] if comp_row and comp_row[1] is not None else 10.0)
            def_imp = float(comp_row[2] if comp_row and comp_row[2] is not None else 3.0)
            def_ut = float(comp_row[3] if comp_row and comp_row[3] is not None else 5.0)

            moneda_final = moneda or def_moneda
            aiu_admin_final = float(data.get('aiuAdmin', def_admin))
            aiu_imprevistos_final = float(data.get('aiuImprevistos', def_imp))
            aiu_utilidad_final = float(data.get('aiuUtilidad', def_ut))

            cursor.execute("""
                INSERT INTO budgets (company_id, codigo, nombre, ubicacion, moneda, fecha_elaboracion, fecha_ultima_modificacion, estado, aiu_admin, aiu_imprevistos, aiu_utilidad)
                VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'), 'Abierto', ?, ?, ?)
            """, (company_id, codigo, nombre, ubicacion, moneda_final, aiu_admin_final, aiu_imprevistos_final, aiu_utilidad_final))
            new_budget_id = cursor.lastrowid
            conn.commit()
            conn.close()

            detail = get_budget_detail_data(new_budget_id)
            self.send_json({'success': True, 'message': 'Presupuesto creado con éxito.', 'data': detail})
            return

        # 6. Agregar Capítulo o Subcapítulo (8.2 y 8.4)
        match_chap = re.match(r'^/api/budgets/(\d+)/chapters$', parsed.path)
        if match_chap:
            budget_id = int(match_chap.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            titulo = data.get('titulo', '').strip()
            parent_id = data.get('parentId')
            if parent_id is not None:
                try: parent_id = int(parent_id)
                except Exception: parent_id = None

            tipo = data.get('tipo', '').strip()

            if not titulo:
                self.send_json({'success': False, 'message': 'El título del capítulo es obligatorio.'}, 400)
                return

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("SELECT estado FROM budgets WHERE id = ?", (budget_id,))
            brow = cursor.fetchone()
            if not brow or brow[0] != 'Abierto':
                conn.close()
                self.send_json({'success': False, 'message': 'No se pueden modificar capítulos de un presupuesto que no esté en estado Abierto.'}, 400)
                return

            if parent_id is not None:
                cursor.execute("SELECT tipo, nivel FROM budget_chapters WHERE id = ? AND budget_id = ?", (parent_id, budget_id))
                prow = cursor.fetchone()
                if not prow:
                    conn.close()
                    self.send_json({'success': False, 'message': 'Capítulo padre no encontrado.'}, 404)
                    return
                tipo = prow[0]
                nivel = prow[1] + 1
            else:
                if tipo not in ('Directo', 'Indirecto'):
                    conn.close()
                    self.send_json({'success': False, 'message': 'Debe clasificar obligatoriamente el capítulo como Costo Directo o Costo Indirecto.'}, 400)
                    return
                nivel = 1

            if parent_id is not None:
                cursor.execute("SELECT COUNT(*) FROM budget_chapters WHERE budget_id = ? AND parent_id = ?", (budget_id, parent_id))
            else:
                cursor.execute("SELECT COUNT(*) FROM budget_chapters WHERE budget_id = ? AND parent_id IS NULL", (budget_id,))
            orden = cursor.fetchone()[0]

            cursor.execute("""
                INSERT INTO budget_chapters (budget_id, parent_id, numero, titulo, tipo, orden, nivel)
                VALUES (?, ?, 'TEMP', ?, ?, ?, ?)
            """, (budget_id, parent_id, titulo, tipo, orden, nivel))
            new_chap_id = cursor.lastrowid

            recalculate_budget_numbering(budget_id, conn)
            cursor.execute("UPDATE budgets SET fecha_ultima_modificacion = datetime('now', 'localtime') WHERE id = ?", (budget_id,))
            conn.commit()
            conn.close()

            detail = get_budget_detail_data(budget_id)
            self.send_json({'success': True, 'message': 'Capítulo agregado con éxito.', 'data': detail})
            return

        # 7. Agregar Actividad (APU) a un Capítulo (8.3)
        match_item = re.match(r'^/api/budgets/(\d+)/chapters/(\d+)/items$', parsed.path)
        if match_item:
            budget_id = int(match_item.group(1))
            chapter_id = int(match_item.group(2))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            apu_id = int(data.get('apuId', 0))
            cantidad = float(data.get('cantidad', 1.0))
            if cantidad <= 0:
                cantidad = 1.0

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("SELECT estado FROM budgets WHERE id = ?", (budget_id,))
            brow = cursor.fetchone()
            if not brow or brow[0] != 'Abierto':
                conn.close()
                self.send_json({'success': False, 'message': 'No se pueden agregar actividades en un presupuesto que no esté en estado Abierto.'}, 400)
                return

            cursor.execute("SELECT id, costo_directo FROM apus WHERE id = ?", (apu_id,))
            apu_row = cursor.fetchone()
            if not apu_row:
                conn.close()
                self.send_json({'success': False, 'message': 'APU no encontrado.'}, 404)
                return

            precio_unitario = float(apu_row[1])
            total = round(cantidad * precio_unitario, 2)

            cursor.execute("SELECT COUNT(*) FROM budget_chapter_items WHERE chapter_id = ?", (chapter_id,))
            orden = cursor.fetchone()[0]

            cursor.execute("""
                INSERT INTO budget_chapter_items (chapter_id, apu_id, cantidad, precio_unitario, total, orden)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (chapter_id, apu_id, cantidad, precio_unitario, total, orden))

            # Mantener sincronizado budget_items para D-22 / 6.4 / 6.5
            cursor.execute("""
                INSERT INTO budget_items (budget_id, apu_id, cantidad, precio_unitario, total)
                VALUES (?, ?, ?, ?, ?)
            """, (budget_id, apu_id, cantidad, precio_unitario, total))

            cursor.execute("UPDATE budgets SET fecha_ultima_modificacion = datetime('now', 'localtime') WHERE id = ?", (budget_id,))
            conn.commit()
            conn.close()

            detail = get_budget_detail_data(budget_id)
            self.send_json({'success': True, 'message': 'Actividad agregada con éxito.', 'data': detail})
            return

        # 8. Cambiar Contraseña de Usuario (12.1 Mi Cuenta)
        match_pwd = re.match(r'^/api/users/(\d+)/change-password$', parsed.path)
        if match_pwd:
            uid = int(match_pwd.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            current_pwd = data.get('currentPassword', '')
            new_pwd = data.get('newPassword', '')
            confirm_pwd = data.get('confirmPassword', '')

            if not current_pwd or not new_pwd:
                self.send_json({'success': False, 'message': 'Debe ingresar la contraseña actual y la nueva contraseña.'}, 400)
                return
            if new_pwd != confirm_pwd:
                self.send_json({'success': False, 'message': 'La nueva contraseña y su confirmación no coinciden.'}, 400)
                return
            if len(new_pwd) < 6:
                self.send_json({'success': False, 'message': 'La nueva contraseña debe tener como mínimo 6 caracteres.'}, 400)
                return

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT password FROM users WHERE id = ?", (uid,))
            user_row = cursor.fetchone()
            if not user_row:
                conn.close()
                self.send_json({'success': False, 'message': 'Usuario no encontrado.'}, 404)
                return

            if user_row[0] != current_pwd:
                conn.close()
                self.send_json({'success': False, 'message': 'La contraseña actual ingresada es incorrecta.'}, 400)
                return

            cursor.execute("UPDATE users SET password = ?, requiere_cambio_clave = 0, estado = 'Activo' WHERE id = ?", (new_pwd, uid))
            conn.commit()
            conn.close()
            self.send_json({'success': True, 'message': 'Su contraseña ha sido cambiada exitosamente.'})
            return

        # 9. Crear Usuario / Asistente (12.4 Usuarios)
        match_create_user = re.match(r'^/api/companies/(\d+)/users$', parsed.path)
        if match_create_user:
            cid = int(match_create_user.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            nombre = data.get('nombre', '').strip()
            email = data.get('email', '').strip().lower()
            temp_pwd = data.get('password', '').strip()
            rol = data.get('rol', 'Asistente').strip()
            permisos = data.get('permisos', {})

            if not nombre or not email or not temp_pwd:
                self.send_json({'success': False, 'message': 'El nombre, correo y contraseña temporal son obligatorios.'}, 400)
                return

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            # Validación de plan: Plan Personal solo permite 1 asistente
            cursor.execute("SELECT plan FROM companies WHERE id = ?", (cid,))
            crow = cursor.fetchone()
            cplan = crow[0] if crow else 'Personal'

            if cplan == 'Personal':
                cursor.execute("SELECT COUNT(*) FROM users WHERE company_id = ? AND rol != 'Administrador'", (cid,))
                assistant_count = cursor.fetchone()[0]
                if assistant_count >= 1:
                    conn.close()
                    self.send_json({'success': False, 'message': 'El Plan Personal solo permite un único asistente técnico. Actualice al Plan Empresarial para crear más usuarios.'}, 400)
                    return

            # Validar correo único en toda la plataforma
            cursor.execute("SELECT id FROM users WHERE LOWER(email) = ?", (email,))
            if cursor.fetchone():
                conn.close()
                self.send_json({'success': False, 'message': f"El correo '{email}' ya se encuentra registrado."}, 400)
                return

            perms_json = json.dumps(permisos)
            cursor.execute("""
                INSERT INTO users (nombre, email, password, rol, company_id, requiere_cambio_clave, estado, permisos)
                VALUES (?, ?, ?, ?, ?, 1, 'Pendiente', ?)
            """, (nombre, email, temp_pwd, rol, cid, perms_json))
            new_uid = cursor.lastrowid
            conn.commit()
            conn.close()

            self.send_json({
                'success': True,
                'message': f"Usuario creado exitosamente. Entregue la contraseña temporal '{temp_pwd}' al usuario para su primer ingreso.",
                'user': {
                    'id': new_uid,
                    'nombre': nombre,
                    'email': email,
                    'rol': rol,
                    'estado': 'Pendiente',
                    'permisos': permisos,
                    'requiereCambioClave': True
                }
            })
            return

        # 10. Crear Rol Personalizado (12.4 - Plan Empresarial)
        match_create_role = re.match(r'^/api/companies/(\d+)/roles$', parsed.path)
        if match_create_role:
            cid = int(match_create_role.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            nombre_rol = data.get('nombre', '').strip()
            permisos = data.get('permisos', {})
            if not nombre_rol:
                self.send_json({'success': False, 'message': 'El nombre del rol es obligatorio.'}, 400)
                return

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM company_roles WHERE company_id = ? AND LOWER(TRIM(nombre)) = LOWER(TRIM(?))", (cid, nombre_rol))
            if cursor.fetchone():
                conn.close()
                self.send_json({'success': False, 'message': f"El rol '{nombre_rol}' ya existe en la empresa."}, 400)
                return

            perms_json = json.dumps(permisos)
            cursor.execute("INSERT INTO company_roles (company_id, nombre, permisos, es_sistema) VALUES (?, ?, ?, 0)", (cid, nombre_rol, perms_json))
            new_rid = cursor.lastrowid
            conn.commit()
            conn.close()

            self.send_json({
                'success': True,
                'message': 'Rol personalizado creado con éxito.',
                'role': {'id': new_rid, 'nombre': nombre_rol, 'permisos': permisos, 'esSistema': False}
            })
            return

        # 11. Crear Unidad de Medida (12.6 Parametrización)
        elif parsed.path == '/api/units':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            company_id = data.get('companyId', 1)
            codigo = data.get('codigo', '').strip()
            nombre = data.get('nombre', '').strip()
            categoria = data.get('categoria', 'General').strip() or 'General'

            if not codigo or not nombre:
                self.send_json({'success': False, 'message': 'El símbolo y la descripción son obligatorios.'}, 400)
                return

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            # Validación insensible a mayúsculas: «Kg» y «kg» son el mismo símbolo y no pueden convivir (D-31, hallazgo 48)
            cursor.execute("SELECT id, codigo FROM measurement_units WHERE company_id = ? AND LOWER(TRIM(codigo)) = LOWER(TRIM(?))", (company_id, codigo))
            existing_unit = cursor.fetchone()
            if existing_unit:
                conn.close()
                self.send_json({
                    'success': False,
                    'message': f"El símbolo '{codigo}' ya existe en las unidades de la empresa (coincide con '{existing_unit[1]}'). La comparación no distingue mayúsculas; elija un símbolo distinto."
                }, 400)
                return

            cursor.execute("""
                INSERT INTO measurement_units (company_id, codigo, nombre, categoria, editable)
                VALUES (?, ?, ?, ?, 1)
            """, (company_id, codigo, nombre, categoria))
            new_uid = cursor.lastrowid
            conn.commit()
            conn.close()

            self.send_json({
                'success': True,
                'message': f"Unidad '{codigo}' ({nombre}) creada exitosamente y disponible de inmediato en Recursos y APU.",
                'unit': {'id': new_uid, 'codigo': codigo, 'nombre': nombre, 'categoria': categoria, 'editable': True}
            })
            return

        self.send_json({'success': False, 'message': 'Endpoint no encontrado'}, 404)

    def do_PUT(self):
        parsed = urlparse(self.path)

        # 1. Editar Recurso (5.3)
        match_res = re.match(r'^/api/resources/(\d+)$', parsed.path)
        if match_res:
            resource_id = int(match_res.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            data = json.loads(body)

            nombre = data.get('nombre', '').strip()
            tipo = data.get('tipo', '').strip()
            unidad = data.get('unidad', '').strip()
            precio_base = float(data.get('precioBase', 0))
            iva_porcentaje = float(data.get('ivaPorcentaje', 0))
            precio_total = float(data.get('precioTotal', 0))
            via_precio = data.get('viaPrecio', 'A')

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE resources
                SET nombre = ?, tipo = ?, unidad = ?, precio_base = ?, iva_porcentaje = ?, precio_total = ?, via_precio = ?
                WHERE id = ?
            """, (nombre, tipo, unidad, precio_base, iva_porcentaje, precio_total, via_precio, resource_id))
            conn.commit()
            conn.close()

            self.send_json({'success': True, 'message': 'Recurso actualizado con éxito.'})
            return

        # 2. Toggle Activo/Inactivo de APU (6.5)
        match_toggle = re.match(r'^/api/apus/(\d+)/toggle-active$', parsed.path)
        if match_toggle:
            apu_id = int(match_toggle.group(1))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("UPDATE apus SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END WHERE id = ?", (apu_id,))
            cursor.execute("SELECT activo FROM apus WHERE id = ?", (apu_id,))
            new_status = bool(cursor.fetchone()[0])
            conn.commit()
            conn.close()
            self.send_json({'success': True, 'activo': new_status})
            return

        # 3. Editar APU y Control de Cambios (6.3 y 6.4)
        match_apu = re.match(r'^/api/apus/(\d+)$', parsed.path)
        if match_apu:
            apu_id = int(match_apu.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            data = json.loads(body)

            nombre = data.get('nombre', '').strip()
            unidad = data.get('unidad', '').strip()
            lines = data.get('lines', [])
            actualizar_presupuestos_abiertos = data.get('actualizarPresupuestosAbiertos', False)

            if not nombre or not unidad:
                self.send_json({'success': False, 'message': 'Nombre y unidad son obligatorios.'}, 400)
                return

            # Calcular nuevo costo directo
            costo_directo_total = 0.0
            for line in lines:
                cant = float(line.get('cantidad', 1))
                rend = float(line.get('rendimiento', 1))
                desp = float(line.get('desperdicio', 0))
                ptot = float(line.get('precioTotal', 0))
                subtot = cant * rend * (1 + desp / 100.0) * ptot
                line['subtotal_calc'] = round(subtot, 2)
                costo_directo_total += subtot

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            # El código del APU NO cambia nunca (6.4). Incrementa número interno de versión
            cursor.execute("""
                UPDATE apus
                SET nombre = ?, unidad = ?, costo_directo = ?, version = version + 1
                WHERE id = ?
            """, (nombre, unidad, round(costo_directo_total, 2), apu_id))

            # Reemplazar líneas de composición del APU
            cursor.execute("DELETE FROM apu_resources WHERE apu_id = ?", (apu_id,))
            for line in lines:
                cursor.execute("""
                    INSERT INTO apu_resources (apu_id, resource_id, cantidad, rendimiento, desperdicio_porcentaje, subtotal)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (apu_id, int(line['resourceId']), float(line.get('cantidad', 1)), float(line.get('rendimiento', 1)), float(line.get('desperdicio', 0)), line['subtotal_calc']))

            # 6.4 Control de cambios: Si el usuario eligió "Sí", actualizar presupuestos abiertos
            if actualizar_presupuestos_abiertos:
                cursor.execute("""
                    UPDATE budget_items
                    SET precio_unitario = ?, total = cantidad * ?
                    WHERE apu_id = ? AND budget_id IN (SELECT id FROM budgets WHERE estado = 'Abierto')
                """, (round(costo_directo_total, 2), round(costo_directo_total, 2), apu_id))

            conn.commit()
            conn.close()

            self.send_json({
                'success': True,
                'message': 'APU actualizado exitosamente.',
                'presupuestosActualizados': actualizar_presupuestos_abiertos,
                'costoDirecto': round(costo_directo_total, 2)
            })
            return

        # 4. Actualizar Presupuesto / Estado / AIU (7.1, 8.1, 8.6)
        match_bg_put = re.match(r'^/api/budgets/(\d+)$', parsed.path)
        if match_bg_put:
            budget_id = int(match_bg_put.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("SELECT estado FROM budgets WHERE id = ?", (budget_id,))
            brow = cursor.fetchone()
            if not brow:
                conn.close()
                self.send_json({'success': False, 'message': 'Presupuesto no encontrado'}, 404)
                return

            current_state = brow[0]
            new_state = data.get('estado', current_state)

            if 'estado' in data and new_state in ('Abierto', 'Activo', 'Cerrado'):
                cursor.execute("UPDATE budgets SET estado = ? WHERE id = ?", (new_state, budget_id))

            # Si está Abierto, se permite modificar nombre, ubicación y porcentajes de AIU
            if current_state == 'Abierto':
                if 'nombre' in data and data['nombre'].strip():
                    cursor.execute("UPDATE budgets SET nombre = ? WHERE id = ?", (data['nombre'].strip(), budget_id))
                if 'ubicacion' in data and data['ubicacion'].strip():
                    cursor.execute("UPDATE budgets SET ubicacion = ? WHERE id = ?", (data['ubicacion'].strip(), budget_id))
                if 'aiuAdmin' in data:
                    cursor.execute("UPDATE budgets SET aiu_admin = ? WHERE id = ?", (float(data['aiuAdmin']), budget_id))
                if 'aiuImprevistos' in data:
                    cursor.execute("UPDATE budgets SET aiu_imprevistos = ? WHERE id = ?", (float(data['aiuImprevistos']), budget_id))
                if 'aiuUtilidad' in data:
                    cursor.execute("UPDATE budgets SET aiu_utilidad = ? WHERE id = ?", (float(data['aiuUtilidad']), budget_id))

            cursor.execute("UPDATE budgets SET fecha_ultima_modificacion = datetime('now', 'localtime') WHERE id = ?", (budget_id,))
            conn.commit()
            conn.close()

            detail = get_budget_detail_data(budget_id)
            self.send_json({'success': True, 'message': 'Presupuesto actualizado correctamente.', 'data': detail})
            return

        # 5. Modificar Capítulo: Renombrar, Cambiar Naturaleza o Reordenar (8.2 y 8.4)
        match_chap_put = re.match(r'^/api/budgets/(\d+)/chapters/(\d+)$', parsed.path)
        if match_chap_put:
            budget_id = int(match_chap_put.group(1))
            chapter_id = int(match_chap_put.group(2))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("SELECT estado FROM budgets WHERE id = ?", (budget_id,))
            brow = cursor.fetchone()
            if not brow or brow[0] != 'Abierto':
                conn.close()
                self.send_json({'success': False, 'message': 'No se pueden modificar capítulos de un presupuesto que no esté en estado Abierto.'}, 400)
                return

            # Reordenar (mover arriba o abajo entre hermanos)
            action = data.get('action')
            if action in ('move_up', 'move_down'):
                cursor.execute("SELECT parent_id, orden FROM budget_chapters WHERE id = ? AND budget_id = ?", (chapter_id, budget_id))
                crow = cursor.fetchone()
                if crow:
                    parent_id, current_orden = crow
                    if parent_id is not None:
                        cursor.execute("SELECT id, orden FROM budget_chapters WHERE budget_id = ? AND parent_id = ? ORDER BY orden ASC, id ASC", (budget_id, parent_id))
                    else:
                        cursor.execute("SELECT id, orden FROM budget_chapters WHERE budget_id = ? AND parent_id IS NULL ORDER BY orden ASC, id ASC", (budget_id,))
                    siblings = cursor.fetchall()
                    current_idx = None
                    for idx, s in enumerate(siblings):
                        if s[0] == chapter_id:
                            current_idx = idx
                            break
                    if current_idx is not None:
                        target_idx = current_idx - 1 if action == 'move_up' else current_idx + 1
                        if 0 <= target_idx < len(siblings):
                            other_id = siblings[target_idx][0]
                            # Intercambiar órdenes
                            cursor.execute("UPDATE budget_chapters SET orden = ? WHERE id = ?", (target_idx, chapter_id))
                            cursor.execute("UPDATE budget_chapters SET orden = ? WHERE id = ?", (current_idx, other_id))
                            recalculate_budget_numbering(budget_id, conn)

            # Renombrar
            if 'titulo' in data and data['titulo'].strip():
                cursor.execute("UPDATE budget_chapters SET titulo = ? WHERE id = ? AND budget_id = ?", (data['titulo'].strip(), chapter_id, budget_id))

            # Cambiar naturaleza (solo si es capítulo de primer nivel)
            if 'tipo' in data and data['tipo'] in ('Directo', 'Indirecto'):
                update_chapter_nature(chapter_id, data['tipo'], conn)

            cursor.execute("UPDATE budgets SET fecha_ultima_modificacion = datetime('now', 'localtime') WHERE id = ?", (budget_id,))
            conn.commit()
            conn.close()

            detail = get_budget_detail_data(budget_id)
            self.send_json({'success': True, 'message': 'Capítulo actualizado con éxito.', 'data': detail})
            return

        # 6. Modificar Cantidad de Actividad en Capítulo (8.3)
        match_item_put = re.match(r'^/api/budgets/(\d+)/chapters/(\d+)/items/(\d+)$', parsed.path)
        if match_item_put:
            budget_id = int(match_item_put.group(1))
            chapter_id = int(match_item_put.group(2))
            item_id = int(match_item_put.group(3))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            nueva_cantidad = float(data.get('cantidad', 1.0))
            if nueva_cantidad <= 0:
                nueva_cantidad = 0.001

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("SELECT estado FROM budgets WHERE id = ?", (budget_id,))
            brow = cursor.fetchone()
            if not brow or brow[0] != 'Abierto':
                conn.close()
                self.send_json({'success': False, 'message': 'No se pueden modificar cantidades en un presupuesto que no esté en estado Abierto.'}, 400)
                return

            cursor.execute("SELECT precio_unitario FROM budget_chapter_items WHERE id = ? AND chapter_id = ?", (item_id, chapter_id))
            irow = cursor.fetchone()
            if not irow:
                conn.close()
                self.send_json({'success': False, 'message': 'Actividad no encontrada.'}, 404)
                return

            pu = float(irow[0])
            total = round(nueva_cantidad * pu, 2)
            cursor.execute("UPDATE budget_chapter_items SET cantidad = ?, total = ? WHERE id = ?", (nueva_cantidad, total, item_id))

            cursor.execute("UPDATE budgets SET fecha_ultima_modificacion = datetime('now', 'localtime') WHERE id = ?", (budget_id,))
            conn.commit()
            conn.close()

            detail = get_budget_detail_data(budget_id)
            self.send_json({'success': True, 'message': 'Cantidad actualizada con éxito.', 'data': detail})
            return

        # 7. Actualizar Datos de Empresa (12.2)
        match_co_info = re.match(r'^/api/companies/(\d+)/info$', parsed.path)
        if match_co_info:
            cid = int(match_co_info.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            razon_social = data.get('razonSocial', '').strip()
            nit = data.get('nit', '').strip()
            direccion = data.get('direccion', '').strip()
            telefono = data.get('telefono', '').strip()
            logo_data = data.get('logoData')

            if not razon_social or not nit:
                self.send_json({'success': False, 'message': 'La razón social y el NIT son obligatorios.'}, 400)
                return

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            if logo_data is not None:
                cursor.execute("""
                    UPDATE companies
                    SET razon_social = ?, nit = ?, direccion = ?, telefono = ?, logo_data = ?
                    WHERE id = ?
                """, (razon_social, nit, direccion, telefono, logo_data, cid))
            else:
                cursor.execute("""
                    UPDATE companies
                    SET razon_social = ?, nit = ?, direccion = ?, telefono = ?
                    WHERE id = ?
                """, (razon_social, nit, direccion, telefono, cid))
            conn.commit()
            conn.close()

            self.send_json({'success': True, 'message': 'Datos de la empresa actualizados exitosamente.'})
            return

        # 8. Guardar Preferencias del Sistema (12.5)
        match_co_pref = re.match(r'^/api/companies/(\d+)/preferences$', parsed.path)
        if match_co_pref:
            cid = int(match_co_pref.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            moneda = data.get('moneda', 'COP')
            sep_miles = data.get('separadorMiles', '.')
            sep_decimal = data.get('separadorDecimal', ',')
            decimales = int(data.get('decimales', 2))

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            # Moneda base solo se puede cambiar mientras no existan recursos, APU ni presupuestos
            cursor.execute("SELECT COUNT(*) FROM resources WHERE company_id = ?", (cid,))
            res_c = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM apus WHERE company_id = ?", (cid,))
            apu_c = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM budgets WHERE company_id = ?", (cid,))
            bg_c = cursor.fetchone()[0]

            cursor.execute("SELECT moneda FROM companies WHERE id = ?", (cid,))
            cur_moneda = cursor.fetchone()[0] or 'COP'

            if (res_c > 0 or apu_c > 0 or bg_c > 0) and moneda != cur_moneda:
                conn.close()
                self.send_json({
                    'success': False,
                    'message': 'La moneda base de la empresa no se puede modificar porque ya existen recursos, APU o presupuestos registrados en el sistema.'
                }, 400)
                return

            cursor.execute("""
                UPDATE companies
                SET moneda = ?, separador_miles = ?, separador_decimal = ?, decimales = ?
                WHERE id = ?
            """, (moneda, sep_miles, sep_decimal, decimales, cid))
            conn.commit()
            conn.close()

            self.send_json({'success': True, 'message': 'Preferencias del sistema guardadas con éxito.'})
            return

        # 9. Guardar AIU Estándar (12.6 Parametrización)
        match_co_aiu = re.match(r'^/api/companies/(\d+)/aiu-defaults$', parsed.path)
        if match_co_aiu:
            cid = int(match_co_aiu.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            aiu_admin = float(data.get('aiuAdmin', 0))
            aiu_imprevistos = float(data.get('aiuImprevistos', 0))
            aiu_utilidad = float(data.get('aiuUtilidad', 0))

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE companies
                SET aiu_admin = ?, aiu_imprevistos = ?, aiu_utilidad = ?
                WHERE id = ?
            """, (aiu_admin, aiu_imprevistos, aiu_utilidad, cid))
            conn.commit()
            conn.close()

            self.send_json({'success': True, 'message': 'AIU estándar guardado exitosamente. Se precargará automáticamente en cada presupuesto nuevo.'})
            return

        # 10. Guardar Notificaciones (12.7)
        match_co_notif = re.match(r'^/api/companies/(\d+)/notifications$', parsed.path)
        if match_co_notif:
            cid = int(match_co_notif.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            notif_prueba = 1 if data.get('notifPrueba') else 0
            notif_suscripcion = 1 if data.get('notifSuscripcion') else 0
            notif_estado_proyecto = 1 if data.get('notifEstadoProyecto') else 0

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE companies
                SET notif_prueba = ?, notif_suscripcion = ?, notif_estado_proyecto = ?
                WHERE id = ?
            """, (notif_prueba, notif_suscripcion, notif_estado_proyecto, cid))
            conn.commit()
            conn.close()

            self.send_json({'success': True, 'message': 'Preferencias de notificaciones actualizadas.'})
            return

        # 11. Cambiar Estado de Usuario (12.4 - Revocar / Activar)
        match_u_status = re.match(r'^/api/users/(\d+)/status$', parsed.path)
        if match_u_status:
            uid = int(match_u_status.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            nuevo_estado = data.get('estado', 'Revocado')
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("UPDATE users SET estado = ? WHERE id = ?", (nuevo_estado, uid))
            conn.commit()
            conn.close()

            self.send_json({'success': True, 'message': f"El estado del usuario se ha cambiado a '{nuevo_estado}'."})
            return

        # 12. Actualizar Permisos y Rol de Usuario (12.4)
        match_u_perms = re.match(r'^/api/users/(\d+)/permissions$', parsed.path)
        if match_u_perms:
            uid = int(match_u_perms.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            permisos = data.get('permisos', {})
            rol = data.get('rol')
            perms_json = json.dumps(permisos)

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            if rol:
                cursor.execute("UPDATE users SET permisos = ?, rol = ? WHERE id = ?", (perms_json, rol, uid))
            else:
                cursor.execute("UPDATE users SET permisos = ? WHERE id = ?", (perms_json, uid))
            conn.commit()
            conn.close()

            self.send_json({'success': True, 'message': 'Permisos de usuario actualizados correctamente.'})
            return

        # 13. Editar Unidad de Medida (12.6 Parametrización)
        match_u_put = re.match(r'^/api/units/(\d+)$', parsed.path)
        if match_u_put:
            unit_id = int(match_u_put.group(1))
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'success': False, 'message': 'JSON inválido'}, 400)
                return

            codigo = data.get('codigo', '').strip()
            nombre = data.get('nombre', '').strip()
            categoria = data.get('categoria', 'General').strip() or 'General'

            if not codigo or not nombre:
                self.send_json({'success': False, 'message': 'El símbolo y la descripción son obligatorios.'}, 400)
                return

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT company_id, codigo FROM measurement_units WHERE id = ?", (unit_id,))
            urow = cursor.fetchone()
            if not urow:
                conn.close()
                self.send_json({'success': False, 'message': 'Unidad no encontrada.'}, 404)
                return

            cid, old_codigo = urow[0], urow[1]

            # Validación de duplicado insensible a mayúsculas
            cursor.execute("SELECT id, codigo FROM measurement_units WHERE company_id = ? AND id != ? AND LOWER(TRIM(codigo)) = LOWER(TRIM(?))", (cid, unit_id, codigo))
            conflict = cursor.fetchone()
            if conflict:
                conn.close()
                self.send_json({
                    'success': False,
                    'message': f"El símbolo '{codigo}' ya existe en otra unidad de la empresa (coincide con '{conflict[1]}'). La comparación no distingue mayúsculas."
                }, 400)
                return

            cursor.execute("UPDATE measurement_units SET codigo = ?, nombre = ?, categoria = ? WHERE id = ?", (codigo, nombre, categoria, unit_id))
            if old_codigo != codigo:
                cursor.execute("UPDATE resources SET unidad = ? WHERE company_id = ? AND unidad = ?", (codigo, cid, old_codigo))
                cursor.execute("UPDATE apus SET unidad = ? WHERE company_id = ? AND unidad = ?", (codigo, cid, old_codigo))

            conn.commit()
            conn.close()
            self.send_json({'success': True, 'message': 'Unidad de medida actualizada correctamente.'})
            return

        self.send_json({'success': False, 'message': 'Endpoint no encontrado'}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)

        # 1. Eliminar Recurso (5.4)
        match_res = re.match(r'^/api/resources/(\d+)$', parsed.path)
        if match_res:
            resource_id = int(match_res.group(1))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("""
                SELECT a.codigo, a.nombre
                FROM apu_resources ar
                JOIN apus a ON ar.apu_id = a.id
                WHERE ar.resource_id = ?
            """, (resource_id,))
            linked_apus = cursor.fetchall()

            if linked_apus:
                conn.close()
                apu_names = [f"[{r[0]}] {r[1]}" for r in linked_apus]
                self.send_json({
                    'success': False,
                    'bloqueado': True,
                    'message': f"No se puede eliminar este recurso porque se encuentra vinculado a APUs.",
                    'apus': apu_names
                }, 400)
                return

            cursor.execute("DELETE FROM resources WHERE id = ?", (resource_id,))
            conn.commit()
            conn.close()
            self.send_json({'success': True, 'message': 'Recurso eliminado correctamente.'})
            return

        # 2. Eliminar APU (6.5 Restricciones)
        match_apu = re.match(r'^/api/apus/(\d+)$', parsed.path)
        if match_apu:
            apu_id = int(match_apu.group(1))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            # Verificar si está en alguna actividad de algún presupuesto (en cualquier estado)
            cursor.execute("""
                SELECT b.codigo, b.nombre, b.estado
                FROM budget_items bi
                JOIN budgets b ON bi.budget_id = b.id
                WHERE bi.apu_id = ?
                UNION
                SELECT b.codigo, b.nombre, b.estado
                FROM budget_chapter_items bci
                JOIN budget_chapters bc ON bci.chapter_id = bc.id
                JOIN budgets b ON bc.budget_id = b.id
                WHERE bci.apu_id = ?
            """, (apu_id, apu_id))
            linked_budgets = cursor.fetchall()

            if linked_budgets:
                conn.close()
                budget_info = [f"Presupuesto [{b[0]}] {b[1]} (Estado: {b[2]})" for b in linked_budgets]
                self.send_json({
                    'success': False,
                    'bloqueado': True,
                    'message': f"El APU no se puede eliminar porque está vinculado a {len(linked_budgets)} actividad(es) en presupuestos de obra.",
                    'presupuestos': budget_info,
                    'ofrecerInactivar': True
                }, 400)
                return

            # Si no está en presupuestos, se elimina con sus líneas
            cursor.execute("DELETE FROM apu_resources WHERE apu_id = ?", (apu_id,))
            cursor.execute("DELETE FROM apus WHERE id = ?", (apu_id,))
            conn.commit()
            conn.close()

            self.send_json({'success': True, 'message': 'APU eliminado con éxito de la plataforma.'})
            return

        # 3. Eliminar Presupuesto (7. Módulo Presupuestos)
        match_bg_del = re.match(r'^/api/budgets/(\d+)$', parsed.path)
        if match_bg_del:
            budget_id = int(match_bg_del.group(1))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("SELECT estado, codigo FROM budgets WHERE id = ?", (budget_id,))
            brow = cursor.fetchone()
            if not brow:
                conn.close()
                self.send_json({'success': False, 'message': 'Presupuesto no encontrado.'}, 404)
                return

            if brow[0] != 'Abierto':
                conn.close()
                self.send_json({'success': False, 'message': f"Solo se pueden eliminar proyectos en estado 'Abierto'. El presupuesto '{brow[1]}' está en estado '{brow[0]}' y no puede ser borrado."}, 400)
                return

            cursor.execute("DELETE FROM budget_chapter_items WHERE chapter_id IN (SELECT id FROM budget_chapters WHERE budget_id = ?)", (budget_id,))
            cursor.execute("DELETE FROM budget_chapters WHERE budget_id = ?", (budget_id,))
            cursor.execute("DELETE FROM budget_items WHERE budget_id = ?", (budget_id,))
            cursor.execute("DELETE FROM budgets WHERE id = ?", (budget_id,))
            conn.commit()
            conn.close()

            self.send_json({'success': True, 'message': 'Presupuesto eliminado correctamente.'})
            return

        # 4. Eliminar Capítulo o Subcapítulo (8.2)
        match_chap_del = re.match(r'^/api/budgets/(\d+)/chapters/(\d+)$', parsed.path)
        if match_chap_del:
            budget_id = int(match_chap_del.group(1))
            chapter_id = int(match_chap_del.group(2))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("SELECT estado FROM budgets WHERE id = ?", (budget_id,))
            brow = cursor.fetchone()
            if not brow or brow[0] != 'Abierto':
                conn.close()
                self.send_json({'success': False, 'message': 'No se pueden eliminar capítulos de un presupuesto que no esté en estado Abierto.'}, 400)
                return

            delete_chapter_recursive(chapter_id, conn)
            recalculate_budget_numbering(budget_id, conn)
            cursor.execute("UPDATE budgets SET fecha_ultima_modificacion = datetime('now', 'localtime') WHERE id = ?", (budget_id,))
            conn.commit()
            conn.close()

            detail = get_budget_detail_data(budget_id)
            self.send_json({'success': True, 'message': 'Capítulo eliminado con éxito.', 'data': detail})
            return

        # 5. Eliminar Actividad de un Capítulo (8.3)
        match_item_del = re.match(r'^/api/budgets/(\d+)/chapters/(\d+)/items/(\d+)$', parsed.path)
        if match_item_del:
            budget_id = int(match_item_del.group(1))
            chapter_id = int(match_item_del.group(2))
            item_id = int(match_item_del.group(3))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            cursor.execute("SELECT estado FROM budgets WHERE id = ?", (budget_id,))
            brow = cursor.fetchone()
            if not brow or brow[0] != 'Abierto':
                conn.close()
                self.send_json({'success': False, 'message': 'No se pueden eliminar actividades de un presupuesto que no esté en estado Abierto.'}, 400)
                return

            cursor.execute("DELETE FROM budget_chapter_items WHERE id = ? AND chapter_id = ?", (item_id, chapter_id))
            cursor.execute("UPDATE budgets SET fecha_ultima_modificacion = datetime('now', 'localtime') WHERE id = ?", (budget_id,))
            conn.commit()
            conn.close()

            detail = get_budget_detail_data(budget_id)
            self.send_json({'success': True, 'message': 'Actividad eliminada con éxito.', 'data': detail})
            return

        # 6. Eliminar Unidad de Medida (12.6 Parametrización)
        match_u_del = re.match(r'^/api/units/(\d+)$', parsed.path)
        if match_u_del:
            unit_id = int(match_u_del.group(1))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT company_id, codigo, nombre FROM measurement_units WHERE id = ?", (unit_id,))
            urow = cursor.fetchone()
            if not urow:
                conn.close()
                self.send_json({'success': False, 'message': 'Unidad de medida no encontrada.'}, 404)
                return

            cid, codigo, nombre = urow[0], urow[1], urow[2]

            # Verificar si la unidad está en uso en algún recurso o APU
            cursor.execute("SELECT codigo, nombre FROM resources WHERE company_id = ? AND LOWER(TRIM(unidad)) = LOWER(TRIM(?))", (cid, codigo))
            res_matches = cursor.fetchall()
            cursor.execute("SELECT codigo, nombre FROM apus WHERE company_id = ? AND LOWER(TRIM(unidad)) = LOWER(TRIM(?))", (cid, codigo))
            apu_matches = cursor.fetchall()

            if res_matches or apu_matches:
                conn.close()
                detalles = []
                if res_matches:
                    detalles.append(f"{len(res_matches)} Recurso(s): " + ", ".join([f"[{r[0]}] {r[1]}" for r in res_matches[:6]]) + ("..." if len(res_matches) > 6 else ""))
                if apu_matches:
                    detalles.append(f"{len(apu_matches)} APU(s): " + ", ".join([f"[{a[0]}] {a[1]}" for a in apu_matches[:6]]) + ("..." if len(apu_matches) > 6 else ""))

                self.send_json({
                    'success': False,
                    'bloqueado': True,
                    'message': f"No se puede eliminar la unidad '{codigo}' ({nombre}) porque está en uso en el sistema.",
                    'detalles': detalles,
                    'recursos': [f"[{r[0]}] {r[1]}" for r in res_matches],
                    'apus': [f"[{a[0]}] {a[1]}" for a in apu_matches]
                }, 400)
                return

            cursor.execute("DELETE FROM measurement_units WHERE id = ?", (unit_id,))
            conn.commit()
            conn.close()

            self.send_json({'success': True, 'message': f"Unidad '{codigo}' eliminada exitosamente de la lista oficial."})
            return

        # 7. Eliminar Rol Personalizado (12.4)
        match_role_del = re.match(r'^/api/companies/(\d+)/roles/(\d+)$', parsed.path)
        if match_role_del:
            cid = int(match_role_del.group(1))
            role_id = int(match_role_del.group(2))
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT es_sistema, nombre FROM company_roles WHERE id = ? AND company_id = ?", (role_id, cid))
            r_row = cursor.fetchone()
            if not r_row:
                conn.close()
                self.send_json({'success': False, 'message': 'Rol no encontrado.'}, 404)
                return
            if r_row[0]:
                conn.close()
                self.send_json({'success': False, 'message': 'Los roles estándar de sistema no pueden ser eliminados.'}, 400)
                return

            cursor.execute("DELETE FROM company_roles WHERE id = ? AND company_id = ?", (role_id, cid))
            conn.commit()
            conn.close()
            self.send_json({'success': True, 'message': f"Rol '{r_row[1]}' eliminado con éxito."})
            return

        self.send_json({'success': False, 'message': 'Endpoint no encontrado'}, 404)

if __name__ == '__main__':
    init_db()
    print(f"Base de datos SQLite inicializada en: {DB_FILE}")
    with socketserver.TCPServer(("", PORT), ConstruSoftHandler) as httpd:
        print(f"Servidor ConstruSoft activo en http://localhost:{PORT}")
        httpd.serve_forever()
