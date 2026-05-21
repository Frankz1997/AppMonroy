use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    env,
    fs,
    path::PathBuf,
    process::{Command, Output},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

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

    remove_legacy_mock_periods(&connection)?;

    Ok(connection)
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

fn parse_period_group(line: &str) -> Option<(String, String)> {
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

    Some((period, group))
}

fn parse_subject_line(line: &str) -> Option<(String, Vec<String>)> {
    let trimmed = line.trim();
    let tokens = trimmed.split_whitespace().collect::<Vec<_>>();
    let code = tokens.first()?;

    if !code.chars().all(|char| char.is_ascii_digit()) {
        return None;
    }

    let first_time_index = tokens.iter().position(|token| is_time_token(token))?;
    if first_time_index <= 1 {
        return None;
    }

    let subject = tokens[1..first_time_index].join(" ");
    let times = tokens[first_time_index..]
        .iter()
        .filter(|token| is_time_token(token))
        .map(|token| format_time_token(token))
        .collect::<Vec<_>>();

    if times.is_empty() {
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

        if let Some((parsed_period, parsed_group)) = parse_period_group(line) {
            period = parsed_period;
            group = parsed_group;
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
        let output = Command::new(&candidate.program)
            .args(&candidate.args)
            .args(args)
            .output();

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
            save_period,
            delete_period,
            parse_schedule_pdf,
            export_excel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
