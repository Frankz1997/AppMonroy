use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Manager, State};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct AppDb {
    connection: Mutex<Connection>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExamPeriod {
    id: String,
    name: String,
    range: String,
    school_year: String,
    status: String,
    selected_pdf_path: Option<String>,
    exam_start_date: Option<String>,
    parsed_course_count: i64,
    selected_sheet: Option<String>,
    generated_sheets: Vec<ExportSheet>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePeriodInput {
    id: Option<String>,
    name: String,
    range: String,
    school_year: String,
    status: Option<String>,
    selected_pdf_path: Option<String>,
    exam_start_date: Option<String>,
    parsed_course_count: Option<i64>,
    selected_sheet: Option<String>,
    generated_sheets: Option<Vec<ExportSheet>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneralConfig {
    coordinator_name: String,
    signature_path: String,
    seal_path: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TeacherRecord {
    teacher_key: String,
    source_name: String,
    display_name: String,
    title: String,
    updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParsedSchedule {
    pdf_path: String,
    courses: Vec<ParsedCourse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParsedCourse {
    career: String,
    career_code: String,
    period: String,
    group: String,
    plan: String,
    subject: String,
    teacher: String,
    monday: Option<String>,
    tuesday: Option<String>,
    wednesday: Option<String>,
    thursday: Option<String>,
    friday: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportPayload {
    period_name: String,
    period_range: String,
    school_year: String,
    sheets: Vec<ExportSheet>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportWordPayload {
    word_period: String,
    word_school_year: String,
    office_year: String,
    start_folio: i64,
    office_date: String,
    exam_start_date: String,
    hour_start: String,
    hour_end: String,
    coordinator_name: String,
    signature_path: String,
    seal_path: String,
    teacher_titles: HashMap<String, String>,
    sheets: Vec<ExportSheet>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportSheet {
    label: String,
    first_date: String,
    second_date: String,
    blocks: Vec<ExportBlock>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportBlock {
    day: String,
    date: String,
    turn: String,
    career: String,
    rows: Vec<ExportRow>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportRow {
    time: String,
    subject: String,
    teacher: String,
    group: String,
    plan: Option<String>,
    teacher_key: Option<String>,
}

#[derive(Debug)]
struct CommandCandidate {
    program: PathBuf,
    args: Vec<String>,
}

fn now_millis() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| format!("No se pudo leer la fecha del sistema: {error}"))
}

fn new_period_id(name: &str, school_year: &str) -> Result<String, String> {
    let slug = format!("{name}-{school_year}")
        .to_lowercase()
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() {
                char
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    Ok(format!("periodo-{slug}-{}", now_millis()?))
}

fn database_path(app: &tauri::App) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo resolver la carpeta de datos: {error}"))?;

    fs::create_dir_all(&app_dir)
        .map_err(|error| format!("No se pudo crear la carpeta de datos: {error}"))?;

    Ok(app_dir.join("appmonroy.sqlite3"))
}

fn open_database(app: &tauri::App) -> Result<Connection, String> {
    let connection = Connection::open(database_path(app)?)
        .map_err(|error| format!("No se pudo abrir SQLite: {error}"))?;

    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS exam_periods (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                range TEXT NOT NULL,
                school_year TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Archivado',
                selected_pdf_path TEXT,
                exam_start_date TEXT,
                parsed_course_count INTEGER NOT NULL DEFAULT 0,
                selected_sheet TEXT,
                generated_sheets TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS teacher_titles (
                teacher TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS teacher_directory (
                teacher_key TEXT PRIMARY KEY,
                source_name TEXT NOT NULL,
                display_name TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ",
        )
        .map_err(|error| format!("No se pudo preparar la base de datos: {error}"))?;

    ensure_column(
        &connection,
        "selected_pdf_path",
        "ALTER TABLE exam_periods ADD COLUMN selected_pdf_path TEXT",
    )?;
    ensure_column(
        &connection,
        "exam_start_date",
        "ALTER TABLE exam_periods ADD COLUMN exam_start_date TEXT",
    )?;
    ensure_column(
        &connection,
        "parsed_course_count",
        "ALTER TABLE exam_periods ADD COLUMN parsed_course_count INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        &connection,
        "selected_sheet",
        "ALTER TABLE exam_periods ADD COLUMN selected_sheet TEXT",
    )?;
    ensure_column(
        &connection,
        "generated_sheets",
        "ALTER TABLE exam_periods ADD COLUMN generated_sheets TEXT NOT NULL DEFAULT '[]'",
    )?;

    migrate_teacher_titles(&connection)?;
    remove_legacy_mock_periods(&connection)?;

    Ok(connection)
}

fn normalize_teacher_key(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .chars()
        .map(|character| match character {
            'á' | 'à' | 'ä' | 'â' | 'Á' | 'À' | 'Ä' | 'Â' => 'A',
            'é' | 'è' | 'ë' | 'ê' | 'É' | 'È' | 'Ë' | 'Ê' => 'E',
            'í' | 'ì' | 'ï' | 'î' | 'Í' | 'Ì' | 'Ï' | 'Î' => 'I',
            'ó' | 'ò' | 'ö' | 'ô' | 'Ó' | 'Ò' | 'Ö' | 'Ô' => 'O',
            'ú' | 'ù' | 'ü' | 'û' | 'Ú' | 'Ù' | 'Ü' | 'Û' => 'U',
            'ñ' | 'Ñ' => 'N',
            other => other.to_ascii_uppercase(),
        })
        .collect()
}

fn migrate_teacher_titles(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("SELECT teacher, title, updated_at FROM teacher_titles")
        .map_err(|error| format!("No se pudo migrar catálogo de maestros: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("No se pudo leer títulos anteriores: {error}"))?;

    for row in rows {
        let (teacher, title, updated_at) =
            row.map_err(|error| format!("No se pudo convertir título anterior: {error}"))?;
        let teacher_key = normalize_teacher_key(&teacher);
        if teacher_key.is_empty() {
            continue;
        }
        connection
            .execute(
                "
                INSERT OR IGNORE INTO teacher_directory
                    (teacher_key, source_name, display_name, title, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ",
                params![teacher_key, teacher, teacher, title, updated_at],
            )
            .map_err(|error| format!("No se pudo migrar maestro anterior: {error}"))?;
    }

    Ok(())
}

fn ensure_column(connection: &Connection, column_name: &str, statement: &str) -> Result<(), String> {
    let mut columns = connection
        .prepare("PRAGMA table_info(exam_periods)")
        .map_err(|error| format!("No se pudo revisar la estructura de SQLite: {error}"))?;
    let exists = columns
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("No se pudieron leer columnas de SQLite: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("No se pudo convertir columnas de SQLite: {error}"))?
        .iter()
        .any(|name| name == column_name);

    if !exists {
        connection
            .execute(statement, [])
            .map_err(|error| format!("No se pudo migrar SQLite: {error}"))?;
    }

    Ok(())
}

fn remove_legacy_mock_periods(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "
            DELETE FROM exam_periods
            WHERE id IN ('periodo-2-2025-2026', 'periodo-1-2025-2026')
            ",
            [],
        )
        .map_err(|error| format!("No se pudieron remover periodos de ejemplo: {error}"))?;

    Ok(())
}

fn period_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExamPeriod> {
    let sheets_json: String = row.get(9)?;
    let generated_sheets =
        serde_json::from_str::<Vec<ExportSheet>>(&sheets_json).unwrap_or_default();

    Ok(ExamPeriod {
        id: row.get(0)?,
        name: row.get(1)?,
        range: row.get(2)?,
        school_year: row.get(3)?,
        status: row.get(4)?,
        selected_pdf_path: row.get(5)?,
        exam_start_date: row.get(6)?,
        parsed_course_count: row.get(7)?,
        selected_sheet: row.get(8)?,
        generated_sheets,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn teacher_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TeacherRecord> {
    Ok(TeacherRecord {
        teacher_key: row.get(0)?,
        source_name: row.get(1)?,
        display_name: row.get(2)?,
        title: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

#[tauri::command]
fn list_periods(db: State<'_, AppDb>) -> Result<Vec<ExamPeriod>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|_| "No se pudo bloquear la base de datos".to_string())?;
    let mut statement = connection
        .prepare(
            "
            SELECT
                id,
                name,
                range,
                school_year,
                status,
                selected_pdf_path,
                exam_start_date,
                parsed_course_count,
                selected_sheet,
                generated_sheets,
                created_at,
                updated_at
            FROM exam_periods
            ORDER BY updated_at DESC
            ",
        )
        .map_err(|error| format!("No se pudo preparar la consulta: {error}"))?;

    let rows = statement
        .query_map([], period_from_row)
        .map_err(|error| format!("No se pudieron leer los periodos: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("No se pudo convertir el resultado: {error}"))
}

#[tauri::command]
fn list_teacher_directory(db: State<'_, AppDb>) -> Result<Vec<TeacherRecord>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|_| "No se pudo bloquear la base de datos".to_string())?;
    let mut statement = connection
        .prepare(
            "
            SELECT teacher_key, source_name, display_name, title, updated_at
            FROM teacher_directory
            ORDER BY display_name ASC
            ",
        )
        .map_err(|error| format!("No se pudo preparar el directorio de maestros: {error}"))?;

    let rows = statement
        .query_map([], teacher_record_from_row)
        .map_err(|error| format!("No se pudo leer el directorio de maestros: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("No se pudo convertir el directorio de maestros: {error}"))
}

#[tauri::command]
fn sync_teacher_directory(
    teachers: Vec<String>,
    db: State<'_, AppDb>,
) -> Result<Vec<TeacherRecord>, String> {
    let now = now_millis()?.to_string();
    let mut connection = db
        .connection
        .lock()
        .map_err(|_| "No se pudo bloquear la base de datos".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo iniciar sincronización de maestros: {error}"))?;

    for teacher in teachers {
        let source_name = teacher.split_whitespace().collect::<Vec<_>>().join(" ");
        let teacher_key = normalize_teacher_key(&source_name);
        if teacher_key.is_empty() {
            continue;
        }

        transaction
            .execute(
                "
                INSERT OR IGNORE INTO teacher_directory
                    (teacher_key, source_name, display_name, title, updated_at)
                VALUES (?1, ?2, ?3, '', ?4)
                ",
                params![teacher_key, source_name, source_name, now],
            )
            .map_err(|error| format!("No se pudo registrar maestro del PDF: {error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("No se pudo terminar sincronización de maestros: {error}"))?;
    drop(connection);

    list_teacher_directory(db)
}

#[tauri::command]
fn save_teacher_directory(
    records: Vec<TeacherRecord>,
    db: State<'_, AppDb>,
) -> Result<Vec<TeacherRecord>, String> {
    let now = now_millis()?.to_string();
    let mut connection = db
        .connection
        .lock()
        .map_err(|_| "No se pudo bloquear la base de datos".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo iniciar guardado del directorio: {error}"))?;
    let mut submitted_keys = HashSet::new();

    for record in records {
        let source_name = record.source_name.split_whitespace().collect::<Vec<_>>().join(" ");
        let display_name = record
            .display_name
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let display_name = if display_name.is_empty() {
            source_name.clone()
        } else {
            display_name
        };
        let teacher_key = if record.teacher_key.trim().is_empty() {
            normalize_teacher_key(&source_name)
        } else {
            record.teacher_key.trim().to_string()
        };
        let title = record.title.trim();

        if teacher_key.is_empty() || source_name.is_empty() {
            continue;
        }
        submitted_keys.insert(teacher_key.clone());

        transaction
            .execute(
                "
                INSERT INTO teacher_directory
                    (teacher_key, source_name, display_name, title, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT(teacher_key) DO UPDATE SET
                    source_name = excluded.source_name,
                    display_name = excluded.display_name,
                    title = excluded.title,
                    updated_at = excluded.updated_at
                ",
                params![teacher_key, source_name, display_name, title, now],
            )
            .map_err(|error| format!("No se pudo guardar maestro: {error}"))?;

        if title.is_empty() {
            transaction
                .execute("DELETE FROM teacher_titles WHERE teacher = ?1", params![source_name])
                .map_err(|error| format!("No se pudo limpiar título anterior: {error}"))?;
        } else {
            transaction
                .execute(
                    "
                    INSERT INTO teacher_titles (teacher, title, updated_at)
                    VALUES (?1, ?2, ?3)
                    ON CONFLICT(teacher) DO UPDATE SET
                        title = excluded.title,
                        updated_at = excluded.updated_at
                    ",
                    params![source_name, title, now],
                )
                .map_err(|error| format!("No se pudo actualizar título anterior: {error}"))?;
        }
    }

    let existing_records = {
        let mut statement = transaction
            .prepare("SELECT teacher_key, source_name FROM teacher_directory")
            .map_err(|error| format!("No se pudo revisar el directorio actual: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| format!("No se pudo leer el directorio actual: {error}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("No se pudo convertir el directorio actual: {error}"))?
    };

    for (teacher_key, source_name) in existing_records {
        if submitted_keys.contains(&teacher_key) {
            continue;
        }

        transaction
            .execute(
                "DELETE FROM teacher_directory WHERE teacher_key = ?1",
                params![teacher_key],
            )
            .map_err(|error| format!("No se pudo eliminar maestro del directorio: {error}"))?;
        transaction
            .execute("DELETE FROM teacher_titles WHERE teacher = ?1", params![source_name])
            .map_err(|error| format!("No se pudo limpiar título del maestro eliminado: {error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("No se pudo terminar guardado del directorio: {error}"))?;
    drop(connection);

    list_teacher_directory(db)
}

#[tauri::command]
fn list_teacher_titles(db: State<'_, AppDb>) -> Result<HashMap<String, String>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|_| "No se pudo bloquear la base de datos".to_string())?;
    let mut statement = connection
        .prepare(
            "
            SELECT teacher, title
            FROM teacher_titles
            ORDER BY teacher ASC
            ",
        )
        .map_err(|error| format!("No se pudo preparar la consulta de maestros: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("No se pudo leer el catálogo de maestros: {error}"))?;

    rows.collect::<Result<HashMap<_, _>, _>>()
        .map_err(|error| format!("No se pudo convertir el catálogo de maestros: {error}"))
}

fn read_setting(connection: &Connection, key: &str) -> Result<String, String> {
    match connection.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => Ok(value),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(String::new()),
        Err(error) => Err(format!("No se pudo leer la configuración: {error}")),
    }
}

fn write_setting(connection: &Connection, key: &str, value: &str, now: &str) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO app_settings (key, value, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            ",
            params![key, value, now],
        )
        .map_err(|error| format!("No se pudo guardar la configuración: {error}"))?;

    Ok(())
}

fn app_config_assets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo resolver la carpeta de datos: {error}"))?;
    let assets_dir = app_dir.join("config-assets");
    fs::create_dir_all(&assets_dir)
        .map_err(|error| format!("No se pudo crear carpeta de configuración: {error}"))?;
    Ok(assets_dir)
}

fn image_extension(path: &Path) -> Result<&'static str, String> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_lowercase()
        .as_str()
    {
        "png" => Ok("png"),
        "jpg" | "jpeg" => Ok("jpg"),
        _ => Err("Firma y sello deben ser imágenes PNG o JPG.".to_string()),
    }
}

fn remove_config_asset_variants(assets_dir: &Path, asset_name: &str) -> Result<(), String> {
    for extension in ["png", "jpg"] {
        let candidate = assets_dir.join(format!("{asset_name}.{extension}"));
        if candidate.exists() {
            fs::remove_file(&candidate)
                .map_err(|error| format!("No se pudo reemplazar imagen anterior: {error}"))?;
        }
    }
    Ok(())
}

fn persist_config_image(
    app: &AppHandle,
    asset_name: &str,
    source_path: &str,
) -> Result<String, String> {
    let source_path = source_path.trim();
    let assets_dir = app_config_assets_dir(app)?;

    if source_path.is_empty() {
        remove_config_asset_variants(&assets_dir, asset_name)?;
        return Ok(String::new());
    }

    let source = PathBuf::from(source_path);
    if !source.exists() {
        return Err(format!("No se encontró la imagen seleccionada: {source_path}"));
    }

    let extension = image_extension(&source)?;
    let destination = assets_dir.join(format!("{asset_name}.{extension}"));
    if source != destination {
        remove_config_asset_variants(&assets_dir, asset_name)?;
        fs::copy(&source, &destination)
            .map_err(|error| format!("No se pudo copiar la imagen configurada: {error}"))?;
    }

    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
fn get_general_config(db: State<'_, AppDb>) -> Result<GeneralConfig, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|_| "No se pudo bloquear la base de datos".to_string())?;

    Ok(GeneralConfig {
        coordinator_name: read_setting(&connection, "coordinator_name")?,
        signature_path: read_setting(&connection, "signature_path")?,
        seal_path: read_setting(&connection, "seal_path")?,
    })
}

#[tauri::command]
fn save_general_config(
    app: AppHandle,
    config: GeneralConfig,
    db: State<'_, AppDb>,
) -> Result<GeneralConfig, String> {
    let now = now_millis()?.to_string();
    let signature_path = persist_config_image(&app, "signature", &config.signature_path)?;
    let seal_path = persist_config_image(&app, "seal", &config.seal_path)?;
    let connection = db
        .connection
        .lock()
        .map_err(|_| "No se pudo bloquear la base de datos".to_string())?;

    write_setting(
        &connection,
        "coordinator_name",
        config.coordinator_name.trim(),
        &now,
    )?;
    write_setting(&connection, "signature_path", &signature_path, &now)?;
    write_setting(&connection, "seal_path", &seal_path, &now)?;

    Ok(GeneralConfig {
        coordinator_name: config.coordinator_name.trim().to_string(),
        signature_path,
        seal_path,
    })
}

#[tauri::command]
fn save_teacher_titles(
    teacher_titles: HashMap<String, String>,
    db: State<'_, AppDb>,
) -> Result<HashMap<String, String>, String> {
    let now = now_millis()?.to_string();
    let mut connection = db
        .connection
        .lock()
        .map_err(|_| "No se pudo bloquear la base de datos".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo iniciar guardado de maestros: {error}"))?;

    for (teacher, title) in teacher_titles {
        let teacher = teacher.trim();
        let title = title.trim();
        if teacher.is_empty() {
            continue;
        }

        if title.is_empty() {
            transaction
                .execute("DELETE FROM teacher_titles WHERE teacher = ?1", params![teacher])
                .map_err(|error| format!("No se pudo borrar el título del maestro: {error}"))?;
            continue;
        }

        transaction
            .execute(
                "
                INSERT INTO teacher_titles (teacher, title, updated_at)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(teacher) DO UPDATE SET
                    title = excluded.title,
                    updated_at = excluded.updated_at
                ",
                params![teacher, title, now],
            )
            .map_err(|error| format!("No se pudo guardar el título del maestro: {error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("No se pudo terminar guardado de maestros: {error}"))?;
    drop(connection);

    list_teacher_titles(db)
}

#[tauri::command]
fn save_period(input: SavePeriodInput, db: State<'_, AppDb>) -> Result<ExamPeriod, String> {
    let id = match input.id {
        Some(id) if !id.trim().is_empty() => id,
        _ => new_period_id(&input.name, &input.school_year)?,
    };
    let status = input.status.unwrap_or_else(|| "Activo".to_string());
    let now = now_millis()?.to_string();
    let generated_sheets = input.generated_sheets.unwrap_or_default();
    let generated_sheets_json = serde_json::to_string(&generated_sheets)
        .map_err(|error| format!("No se pudo preparar el calendario para guardar: {error}"))?;
    let parsed_course_count = input.parsed_course_count.unwrap_or(0);
    let connection = db
        .connection
        .lock()
        .map_err(|_| "No se pudo bloquear la base de datos".to_string())?;

    connection
        .execute(
            "
            INSERT INTO exam_periods
                (
                    id,
                    name,
                    range,
                    school_year,
                    status,
                    selected_pdf_path,
                    exam_start_date,
                    parsed_course_count,
                    selected_sheet,
                    generated_sheets,
                    created_at,
                    updated_at
                )
            VALUES
                (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                range = excluded.range,
                school_year = excluded.school_year,
                status = excluded.status,
                selected_pdf_path = excluded.selected_pdf_path,
                exam_start_date = excluded.exam_start_date,
                parsed_course_count = excluded.parsed_course_count,
                selected_sheet = excluded.selected_sheet,
                generated_sheets = excluded.generated_sheets,
                updated_at = excluded.updated_at
            ",
            params![
                id,
                input.name,
                input.range,
                input.school_year,
                status,
                input.selected_pdf_path,
                input.exam_start_date,
                parsed_course_count,
                input.selected_sheet,
                generated_sheets_json,
                now,
                now
            ],
        )
        .map_err(|error| format!("No se pudo guardar el periodo: {error}"))?;

    get_period_by_id(&connection, &id)
}

fn get_period_by_id(connection: &Connection, id: &str) -> Result<ExamPeriod, String> {
    connection
        .query_row(
            "
            SELECT
                id,
                name,
                range,
                school_year,
                status,
                selected_pdf_path,
                exam_start_date,
                parsed_course_count,
                selected_sheet,
                generated_sheets,
                created_at,
                updated_at
            FROM exam_periods
            WHERE id = ?1
            ",
            params![id],
            period_from_row,
        )
        .map_err(|error| format!("No se pudo leer el periodo guardado: {error}"))
}

fn is_time_token(token: &str) -> bool {
    let Some((start, end)) = token.split_once('/') else {
        return false;
    };

    start.len() == 4
        && end.len() == 4
        && start.chars().all(|char| char.is_ascii_digit())
        && end.chars().all(|char| char.is_ascii_digit())
}

fn format_time_token(token: &str) -> String {
    let Some((start, end)) = token.split_once('/') else {
        return token.to_string();
    };

    format!(
        "{}:{}-{}:{}",
        &start[0..2],
        &start[2..4],
        &end[0..2],
        &end[2..4]
    )
}

fn find_time_ranges(value: &str) -> Vec<String> {
    value
        .split(|char: char| char.is_whitespace() || char == ',')
        .flat_map(|chunk| {
            chunk
                .as_bytes()
                .windows(9)
                .filter_map(|window| {
                    let token = std::str::from_utf8(window).ok()?;
                    if is_time_token(token) {
                        Some(format_time_token(token))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn clean_subject_time_ranges(value: &str) -> String {
    let mut cleaned = value.to_string();

    while let Some(index) = cleaned
        .as_bytes()
        .windows(9)
        .position(|window| {
            std::str::from_utf8(window)
                .map(is_time_token)
                .unwrap_or(false)
        })
    {
        cleaned.replace_range(index..index + 9, " ");
    }

    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn career_abbreviation(career: &str) -> String {
    if career.contains("INGENIERÍA EN SISTEMAS") {
        "LISI".to_string()
    } else {
        "LI".to_string()
    }
}

fn clean_career_name(career: &str) -> String {
    let mut value = career.trim().to_string();
    for marker in [" HORA:", " FECHA:", " PERIODO:", " GRUPO:"] {
        if let Some(index) = value.find(marker) {
            value.truncate(index);
        }
    }

    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_value_after_label(line: &str, label: &str) -> Option<String> {
    let index = line.find(label)?;
    let after_label = line[index + label.len()..].trim();
    let mut tokens = after_label.split_whitespace();
    let first = tokens.next()?;

    if first.chars().all(|char| char.is_ascii_digit()) {
        Some(tokens.collect::<Vec<_>>().join(" "))
    } else {
        Some(after_label.to_string())
    }
}

fn parse_period_group_plan(line: &str) -> Option<(String, String, String)> {
    if !line.contains("PERIODO:") || !line.contains("GRUPO:") {
        return None;
    }

    let tokens = line.split_whitespace().collect::<Vec<_>>();
    let period = tokens
        .windows(2)
        .find(|window| window[0] == "PERIODO:")
        .map(|window| window[1].to_string())?;
    let group = tokens
        .windows(2)
        .find(|window| window[0] == "GRUPO:")
        .map(|window| window[1].to_string())?;
    let plan = tokens
        .windows(2)
        .find(|window| window[0] == "PLAN:")
        .map(|window| window[1].to_string())
        .unwrap_or_default();

    Some((period, group, plan))
}

fn parse_subject_line(line: &str) -> Option<(String, Vec<String>)> {
    let trimmed = line.trim();
    let tokens = trimmed.split_whitespace().collect::<Vec<_>>();
    let code = tokens.first()?;

    if !code.chars().all(|char| char.is_ascii_digit()) {
        return None;
    }

    let time_start = trimmed
        .as_bytes()
        .windows(9)
        .position(|window| {
            std::str::from_utf8(window)
                .map(is_time_token)
                .unwrap_or(false)
        })?;
    let code_end = trimmed.find(char::is_whitespace)?;
    if time_start <= code_end {
        return None;
    }

    let subject = clean_subject_time_ranges(&trimmed[code_end..time_start]);
    let times = find_time_ranges(&trimmed[time_start..]);

    if subject.is_empty() || times.is_empty() {
        None
    } else {
        Some((subject, times))
    }
}

fn parse_teacher_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let mut tokens = trimmed.split_whitespace();
    let first = tokens.next()?;

    if !first.chars().all(|char| char.is_ascii_digit()) {
        return None;
    }

    let name = tokens.collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn parse_schedule_text(pdf_path: &str, text: &str) -> ParsedSchedule {
    let lines = text.lines().collect::<Vec<_>>();
    let mut career = String::new();
    let mut career_code = String::new();
    let mut period = String::new();
    let mut group = String::new();
    let mut plan = String::new();
    let mut courses = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        let line = lines[index];

        if line.contains("CARRERA:") {
            if let Some(parsed_career) = parse_value_after_label(line, "CARRERA:") {
                career = clean_career_name(&parsed_career);
                career_code = career_abbreviation(&career);
            }
        }

        if let Some((parsed_period, parsed_group, parsed_plan)) = parse_period_group_plan(line) {
            period = parsed_period;
            group = parsed_group;
            plan = parsed_plan;
        }

        if let Some((subject, times)) = parse_subject_line(line) {
            let mut teacher = String::new();
            let mut lookahead = index + 1;
            while lookahead < lines.len() && lookahead <= index + 3 {
                if let Some(parsed_teacher) = parse_teacher_line(lines[lookahead]) {
                    teacher = parsed_teacher;
                    break;
                }
                lookahead += 1;
            }

            courses.push(ParsedCourse {
                career: career.clone(),
                career_code: career_code.clone(),
                period: period.clone(),
                group: group.clone(),
                plan: plan.clone(),
                subject,
                teacher,
                monday: times.get(0).cloned(),
                tuesday: times.get(1).cloned(),
                wednesday: times.get(2).cloned(),
                thursday: times.get(3).cloned(),
                friday: times.get(4).cloned(),
            });
        }

        index += 1;
    }

    ParsedSchedule {
        pdf_path: pdf_path.to_string(),
        courses,
    }
}

#[tauri::command]
async fn parse_schedule_pdf(app: AppHandle, pdf_path: String) -> Result<ParsedSchedule, String> {
    tauri::async_runtime::spawn_blocking(move || parse_schedule_pdf_blocking(app, pdf_path))
        .await
        .map_err(|error| format!("No se pudo terminar el procesamiento del PDF: {error}"))?
}

fn parse_schedule_pdf_blocking(
    app: AppHandle,
    pdf_path: String,
) -> Result<ParsedSchedule, String> {
    let candidates = pdftotext_candidates(&app);
    let output = run_first_available_command(
        candidates,
        &["-layout".to_string(), pdf_path.clone(), "-".to_string()],
        "pdftotext",
    )
    .map_err(|error| {
        format!(
            "{error}\n\nEn Windows puedes colocar pdftotext.exe en src-tauri/bin antes de empaquetar."
        )
    })?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let text = String::from_utf8(output.stdout)
        .map_err(|error| format!("No se pudo leer el texto extraído del PDF: {error}"))?;

    Ok(parse_schedule_text(&pdf_path, &text))
}

#[tauri::command]
fn delete_period(id: String, db: State<'_, AppDb>) -> Result<(), String> {
    let connection = db
        .connection
        .lock()
        .map_err(|_| "No se pudo bloquear la base de datos".to_string())?;

    connection
        .execute("DELETE FROM exam_periods WHERE id = ?1", params![id])
        .map_err(|error| format!("No se pudo borrar el periodo: {error}"))?;

    Ok(())
}

fn project_file_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let current_dir = env::current_dir()
        .map_err(|error| format!("No se pudo leer el directorio del proyecto: {error}"))?;

    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(file_name));
        if let Some(file_basename) = PathBuf::from(file_name).file_name() {
            candidates.push(resource_dir.join(file_basename));
            candidates.push(resource_dir.join("_up_").join(file_basename));
        }
    }

    candidates.push(current_dir.join(file_name));
    candidates.push(current_dir.join("src-tauri").join(file_name));

    if let Some(parent) = current_dir.parent() {
        candidates.push(parent.join(file_name));
        candidates.push(parent.join("src-tauri").join(file_name));
    }

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| format!("No se encontró el archivo del proyecto: {file_name}"))
}

fn bundled_binary_candidates(app: &AppHandle, name: &str) -> Vec<PathBuf> {
    let executable_name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };

    [
        format!("bin/{executable_name}"),
        format!("src-tauri/bin/{executable_name}"),
        executable_name,
    ]
    .iter()
    .filter_map(|candidate| project_file_path(app, candidate).ok())
    .collect()
}

fn pdftotext_candidates(app: &AppHandle) -> Vec<CommandCandidate> {
    let mut candidates = bundled_binary_candidates(app, "pdftotext")
        .into_iter()
        .map(|program| CommandCandidate {
            program,
            args: Vec::new(),
        })
        .collect::<Vec<_>>();

    candidates.push(CommandCandidate {
        program: PathBuf::from(if cfg!(windows) {
            "pdftotext.exe"
        } else {
            "pdftotext"
        }),
        args: Vec::new(),
    });
    candidates.push(CommandCandidate {
        program: PathBuf::from("pdftotext"),
        args: Vec::new(),
    });

    candidates
}

fn python_candidates() -> Vec<CommandCandidate> {
    let mut candidates = Vec::new();

    if cfg!(windows) {
        candidates.push(CommandCandidate {
            program: PathBuf::from("py"),
            args: vec!["-3".to_string()],
        });
        candidates.push(CommandCandidate {
            program: PathBuf::from("python"),
            args: Vec::new(),
        });
        candidates.push(CommandCandidate {
            program: PathBuf::from("python3"),
            args: Vec::new(),
        });
    } else {
        candidates.push(CommandCandidate {
            program: PathBuf::from("python3"),
            args: Vec::new(),
        });
        candidates.push(CommandCandidate {
            program: PathBuf::from("python"),
            args: Vec::new(),
        });
    }

    candidates
}

fn run_first_available_command(
    candidates: Vec<CommandCandidate>,
    args: &[String],
    tool_name: &str,
) -> Result<Output, String> {
    let mut spawn_errors = Vec::new();

    for candidate in candidates {
        let mut command = Command::new(&candidate.program);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let output = command.args(&candidate.args).args(args).output();

        match output {
            Ok(output) => return Ok(output),
            Err(error) => {
                spawn_errors.push(format!("{}: {error}", candidate.program.display()));
            }
        }
    }

    Err(format!(
        "No se pudo ejecutar {tool_name}. Comandos probados: {}",
        spawn_errors.join(" | ")
    ))
}

#[tauri::command]
async fn export_excel(
    app: AppHandle,
    payload: ExportPayload,
    output_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || export_excel_blocking(app, payload, output_path))
        .await
        .map_err(|error| format!("No se pudo terminar la exportación: {error}"))?
}

fn export_excel_blocking(
    app: AppHandle,
    payload: ExportPayload,
    output_path: String,
) -> Result<(), String> {
    if payload.sheets.is_empty() {
        return Err("No hay hojas generadas para exportar.".to_string());
    }

    let template_path = project_file_path(&app, "Plantilla.xlsx")?;
    let script_path = project_file_path(&app, "scripts/export_excel.py")?;

    let temp_dir = env::temp_dir().join(format!("appmonroy-export-{}", now_millis()?));
    fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("No se pudo crear carpeta temporal: {error}"))?;
    let payload_path = temp_dir.join("payload.json");
    let payload_bytes = serde_json::to_vec(&payload)
        .map_err(|error| format!("No se pudo preparar el contenido del Excel: {error}"))?;
    fs::write(&payload_path, payload_bytes)
        .map_err(|error| format!("No se pudo escribir el archivo temporal: {error}"))?;

    let output = run_first_available_command(
        python_candidates(),
        &[
            script_path.to_string_lossy().to_string(),
            payload_path.to_string_lossy().to_string(),
            template_path.to_string_lossy().to_string(),
            output_path.clone(),
        ],
        "Python",
    )
    .map_err(|error| {
        format!(
            "{error}\n\nPara exportar Excel en Windows instala Python 3 o asegúrate de que el lanzador py esté disponible."
        )
    })?;

    let _ = fs::remove_dir_all(&temp_dir);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!("No se pudo exportar el Excel: {stderr}{stdout}"));
    }

    Ok(())
}

#[tauri::command]
async fn export_word(
    app: AppHandle,
    payload: ExportWordPayload,
    output_dir: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || export_word_blocking(app, payload, output_dir))
        .await
        .map_err(|error| format!("No se pudo terminar la exportación Word: {error}"))?
}

fn export_word_blocking(
    app: AppHandle,
    payload: ExportWordPayload,
    output_dir: String,
) -> Result<(), String> {
    if payload.sheets.is_empty() {
        return Err("No hay hojas generadas para exportar a Word.".to_string());
    }

    let template_path = project_file_path(&app, "FormatoWordUAS.docx")?;
    let script_path = project_file_path(&app, "scripts/export_word.py")?;

    let temp_dir = env::temp_dir().join(format!("appmonroy-word-export-{}", now_millis()?));
    fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("No se pudo crear carpeta temporal: {error}"))?;
    let payload_path = temp_dir.join("payload.json");
    let payload_bytes = serde_json::to_vec(&payload)
        .map_err(|error| format!("No se pudo preparar el contenido Word: {error}"))?;
    fs::write(&payload_path, payload_bytes)
        .map_err(|error| format!("No se pudo escribir el archivo temporal: {error}"))?;

    let output = run_first_available_command(
        python_candidates(),
        &[
            script_path.to_string_lossy().to_string(),
            payload_path.to_string_lossy().to_string(),
            template_path.to_string_lossy().to_string(),
            output_dir.clone(),
        ],
        "Python",
    )
    .map_err(|error| {
        format!(
            "{error}\n\nPara exportar Word en Windows instala Python 3 o asegúrate de que el lanzador py esté disponible."
        )
    })?;

    let _ = fs::remove_dir_all(&temp_dir);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!("No se pudo exportar Word: {stderr}{stdout}"));
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let connection = open_database(app)?;
            app.manage(AppDb {
                connection: Mutex::new(connection),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_periods,
            get_general_config,
            save_general_config,
            list_teacher_directory,
            sync_teacher_directory,
            save_teacher_directory,
            list_teacher_titles,
            save_teacher_titles,
            save_period,
            delete_period,
            parse_schedule_pdf,
            export_excel,
            export_word
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
