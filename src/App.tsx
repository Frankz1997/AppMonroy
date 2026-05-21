import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save as saveFile } from "@tauri-apps/plugin-dialog";
import {
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  FileSpreadsheet,
  GripVertical,
  History,
  LoaderCircle,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SavedPeriod = {
  id: string;
  name: string;
  range: string;
  schoolYear: string;
  status: string;
  selectedPdfPath?: string | null;
  examStartDate?: string | null;
  parsedCourseCount?: number;
  selectedSheet?: string | null;
  generatedSheets?: SheetPlan[];
  createdAt?: string;
  updatedAt?: string;
};

type ParsedCourse = {
  career: string;
  careerCode: string;
  period: string;
  group: string;
  subject: string;
  teacher: string;
  monday?: string | null;
  tuesday?: string | null;
  wednesday?: string | null;
  thursday?: string | null;
  friday?: string | null;
};

type ParsedSchedule = {
  pdfPath: string;
  courses: ParsedCourse[];
};

type ExamRow = {
  time: string;
  subject: string;
  teacher: string;
  group: string;
};

type TableBlock = {
  day: string;
  date: string;
  turn: string;
  career: string;
  rows: ExamRow[];
};

type SheetPlan = {
  label: string;
  firstDate: string;
  secondDate: string;
  blocks: TableBlock[];
};

type CourseTimeKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday";

type DraggedRow = {
  sheetLabel: string;
  blockIndex: number;
  rowIndex: number;
};

type DropTarget = DraggedRow;

type DragPreview = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type DragContext = {
  sheetLabel: string;
  blockIndex: number;
  sourceIndex: number;
  targetIndex: number;
  tableTop: number;
  tableBottom: number;
  tableLeft: number;
  tableWidth: number;
  rowHeight: number;
  rowCenters: number[];
};

function getTimeStart(time: string) {
  return time.split("-")[0] ?? "";
}

function getTimeEnd(time: string) {
  return time.split("-")[1] ?? "";
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayDateInput() {
  return toDateInputValue(new Date());
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatLongDateMx(date: Date) {
  return capitalize(
    new Intl.DateTimeFormat("es-MX", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    }).format(date),
  );
}

function formatCompactDateMx(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parseLocalDate(value));
}

function formatSheetLabel(firstDate: Date, secondDate: Date, careerCode: string) {
  const month = new Intl.DateTimeFormat("es-MX", { month: "long" })
    .format(firstDate)
    .toUpperCase();
  const firstDay = String(firstDate.getDate()).padStart(2, "0");
  const secondDay = String(secondDate.getDate()).padStart(2, "0");

  return `${month} ${firstDay}-${secondDay} ${careerCode}`;
}

function getCareerCodeFromSheetLabel(label: string) {
  return label.match(/\b(LISI|LI)$/)?.[1] ?? "LI";
}

function getCareerName(courses: ParsedCourse[], careerCode: string) {
  return (
    courses.find((course) => course.careerCode === careerCode)?.career ||
    (careerCode === "LISI"
      ? "Licenciatura en Ingeniería en Sistemas de Información"
      : "Licenciatura en Informática")
  );
}

function getAcademicYearFromPeriod(period: string) {
  const parsedPeriod = Number.parseInt(period, 10);
  if (Number.isNaN(parsedPeriod) || parsedPeriod < 1) {
    return period;
  }

  return String(Math.ceil(parsedPeriod / 2));
}

function formatGroupLabel(course: ParsedCourse) {
  const careerCode = course.careerCode || "LI";
  const academicYear = getAcademicYearFromPeriod(course.period);
  const group = course.group || "1";

  return `${careerCode} ${academicYear}-${group}`;
}

function weekdayKeyForDate(date: Date): CourseTimeKey {
  const weekday = date.getDay();
  const keys: Record<number, CourseTimeKey> = {
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
  };

  return keys[weekday] ?? "monday";
}

function getGroupSortParts(course: ParsedCourse) {
  return {
    academicYear: Number.parseInt(getAcademicYearFromPeriod(course.period), 10) || 0,
    group: Number.parseInt(course.group, 10) || 0,
  };
}

function compareGroups(left: ParsedCourse[], right: ParsedCourse[]) {
  const leftParts = getGroupSortParts(left[0]);
  const rightParts = getGroupSortParts(right[0]);

  if (leftParts.academicYear !== rightParts.academicYear) {
    return leftParts.academicYear - rightParts.academicYear;
  }

  return leftParts.group - rightParts.group;
}

function rowsForGroupAndDate(courses: ParsedCourse[], date: Date) {
  const weekday = weekdayKeyForDate(date);

  return courses
    .map((course) => {
      const time = course[weekday] ?? "";
      return {
        time,
        subject: course.subject,
        teacher: course.teacher,
        group: formatGroupLabel(course),
      };
    })
    .filter((row) => row.time)
    .sort((left, right) => left.time.localeCompare(right.time));
}

function groupCoursesByAcademicGroup(courses: ParsedCourse[]) {
  const groupedCourses = new Map<string, ParsedCourse[]>();

  courses.forEach((course) => {
    const groupKey = `${getAcademicYearFromPeriod(course.period)}-${course.group || "1"}`;
    const currentCourses = groupedCourses.get(groupKey) ?? [];
    groupedCourses.set(groupKey, [...currentCourses, course]);
  });

  return Array.from(groupedCourses.values()).sort(compareGroups);
}

function buildSheetsFromSchedule(schedule: ParsedSchedule, startDateValue: string) {
  if (schedule.courses.length === 0) {
    return [];
  }

  const startDate = parseLocalDate(startDateValue);
  const careerCodes = Array.from(
    new Set(schedule.courses.map((course) => course.careerCode || "LI")),
  );

  const sheets: SheetPlan[] = [];
  let currentDayOffset = 0;

  careerCodes.forEach((careerCode) => {
    const careerCourses = schedule.courses.filter(
      (course) => (course.careerCode || "LI") === careerCode,
    );
    const career = getCareerName(schedule.courses, careerCode);
    const groupedCourses = groupCoursesByAcademicGroup(careerCourses);

    for (let index = 0; index < groupedCourses.length; index += 4) {
      const firstDate = addDays(startDate, currentDayOffset);
      const secondDate = addDays(firstDate, 1);
      const groupsForSheet = groupedCourses.slice(index, index + 4);

      sheets.push({
        label: formatSheetLabel(firstDate, secondDate, careerCode),
        firstDate: toDateInputValue(firstDate),
        secondDate: toDateInputValue(secondDate),
        blocks: groupsForSheet.map((groupCourses, groupIndex) => {
          const blockDate = groupIndex < 2 ? firstDate : secondDate;

          return {
            day: formatLongDateMx(blockDate),
            date: toDateInputValue(blockDate),
            turn: `Grupo ${formatGroupLabel(groupCourses[0])}`,
            career,
            rows: rowsForGroupAndDate(groupCourses, blockDate),
          };
        }),
      });

      currentDayOffset += 2;
    }
  });

  return sheets;
}

function App() {
  const [periods, setPeriods] = useState<SavedPeriod[]>([]);
  const [activePeriod, setActivePeriod] = useState<SavedPeriod | null>(null);
  const [periodName, setPeriodName] = useState("Periodo 2");
  const [periodRange, setPeriodRange] = useState("Enero - Junio");
  const [schoolYear, setSchoolYear] = useState("2025-2026");
  const [generatedSheets, setGeneratedSheets] = useState<SheetPlan[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [selectedPdfPath, setSelectedPdfPath] = useState<string | null>(null);
  const [examStartDate, setExamStartDate] = useState(() => getTodayDateInput());
  const [parsedCourseCount, setParsedCourseCount] = useState(0);
  const [isPeriodsOpen, setIsPeriodsOpen] = useState(false);
  const [isStartDateOpen, setIsStartDateOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isParsingPdf, setIsParsingPdf] = useState(false);
  const [periodToDelete, setPeriodToDelete] = useState<SavedPeriod | null>(null);
  const [draggedRow, setDraggedRow] = useState<DraggedRow | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [statusMessage, setStatusMessage] = useState("SQLite local listo");
  const dragContextRef = useRef<DragContext | null>(null);

  useEffect(() => {
    loadPeriods();
  }, []);

  useEffect(() => {
    if (!draggedRow) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    function getTargetIndex(clientY: number, rowCenters: number[]) {
      return rowCenters.reduce((closestIndex, center, index) => {
        const closestDistance = Math.abs(clientY - rowCenters[closestIndex]);
        const currentDistance = Math.abs(clientY - center);
        return currentDistance < closestDistance ? index : closestIndex;
      }, 0);
    }

    function handlePointerMove(event: PointerEvent) {
      const context = dragContextRef.current;
      if (!context) return;

      const nextTop = Math.min(
        Math.max(event.clientY - context.rowHeight / 2, context.tableTop),
        context.tableBottom - context.rowHeight,
      );
      const targetIndex = getTargetIndex(event.clientY, context.rowCenters);

      context.targetIndex = targetIndex;
      setDropTarget({
        sheetLabel: context.sheetLabel,
        blockIndex: context.blockIndex,
        rowIndex: targetIndex,
      });
      setDragPreview({
        top: nextTop,
        left: context.tableLeft,
        width: context.tableWidth,
        height: context.rowHeight,
      });
    }

    function finishDrag() {
      const context = dragContextRef.current;
      if (context) {
        moveRowToIndex(
          context.sheetLabel,
          context.blockIndex,
          context.sourceIndex,
          context.targetIndex,
        );
      }

      dragContextRef.current = null;
      setDraggedRow(null);
      setDropTarget(null);
      setDragPreview(null);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [draggedRow]);

  async function loadPeriods() {
    try {
      const storedPeriods = await invoke<SavedPeriod[]>("list_periods");
      setPeriods(storedPeriods);
      resetWorkArea();
      setStatusMessage("Periodos cargados desde SQLite");
    } catch (error) {
      setStatusMessage(`No se pudieron cargar los periodos: ${String(error)}`);
    }
  }

  function resetWorkArea() {
    setActivePeriod(null);
    setPeriodName("Periodo 2");
    setPeriodRange("Enero - Junio");
    setSchoolYear("2025-2026");
    setSelectedPdfPath(null);
    setExamStartDate(getTodayDateInput());
    setParsedCourseCount(0);
    setGeneratedSheets([]);
    setSelectedSheet("");
  }

  function applyActivePeriod(period: SavedPeriod) {
    const restoredSheets = period.generatedSheets ?? [];
    const restoredSelectedSheet =
      period.selectedSheet && restoredSheets.some((sheet) => sheet.label === period.selectedSheet)
        ? period.selectedSheet
        : restoredSheets[0]?.label ?? "";

    setActivePeriod(period);
    setPeriodName(period.name);
    setPeriodRange(period.range);
    setSchoolYear(period.schoolYear);
    setSelectedPdfPath(period.selectedPdfPath ?? null);
    setExamStartDate(period.examStartDate ?? getTodayDateInput());
    setParsedCourseCount(period.parsedCourseCount ?? 0);
    setGeneratedSheets(restoredSheets);
    setSelectedSheet(restoredSelectedSheet);
  }

  async function saveCurrentPeriod() {
    try {
      const savedPeriod = await invoke<SavedPeriod>("save_period", {
        input: {
          id: activePeriod?.id,
          name: periodName,
          range: periodRange,
          schoolYear,
          status: "Activo",
          selectedPdfPath,
          examStartDate,
          parsedCourseCount,
          selectedSheet,
          generatedSheets,
        },
      });

      setActivePeriod(savedPeriod);
      setPeriods((currentPeriods) => {
        const existing = currentPeriods.some((period) => period.id === savedPeriod.id);
        if (existing) {
          return currentPeriods.map((period) =>
            period.id === savedPeriod.id ? savedPeriod : period,
          );
        }
        return [savedPeriod, ...currentPeriods];
      });
      setStatusMessage("Periodo guardado en SQLite");
    } catch (error) {
      setStatusMessage(`No se pudo guardar el periodo: ${String(error)}`);
    }
  }

  async function exportCurrentExcel() {
    if (isExporting) return;

    if (generatedSheets.length === 0) {
      setStatusMessage("Carga y genera un calendario antes de exportar.");
      return;
    }

    try {
      const outputPath = await saveFile({
        defaultPath: `${periodName} ${periodRange} ${schoolYear}.xlsx`.replace(
          /\//g,
          "-",
        ),
        filters: [
          {
            name: "Excel",
            extensions: ["xlsx"],
          },
        ],
      });

      if (!outputPath) return;

      setIsExporting(true);
      setStatusMessage("Exportando Excel...");
      await invoke("export_excel", {
        payload: {
          periodName,
          periodRange,
          schoolYear,
          sheets: generatedSheets,
        },
        outputPath,
      });
      setStatusMessage("Excel exportado correctamente");
    } catch (error) {
      setStatusMessage(`No se pudo exportar el Excel: ${String(error)}`);
    } finally {
      setIsExporting(false);
    }
  }

  function startOverSession() {
    resetWorkArea();
    setIsPeriodsOpen(false);
    setIsStartDateOpen(false);
    setPeriodToDelete(null);
    setStatusMessage("Sesión reiniciada");
  }

  function openSavedPeriod(period: SavedPeriod) {
    applyActivePeriod(period);
    setIsPeriodsOpen(false);
    setStatusMessage(
      period.generatedSheets?.length
        ? "Periodo abierto con calendario guardado"
        : "Periodo abierto sin calendario guardado",
    );
  }

  async function deleteSelectedPeriod() {
    if (!periodToDelete) return;
    try {
      await invoke("delete_period", { id: periodToDelete.id });
      setPeriods((currentPeriods) =>
        currentPeriods.filter((period) => period.id !== periodToDelete.id),
      );
      if (activePeriod?.id === periodToDelete.id) {
        setActivePeriod(null);
      }
      setStatusMessage("Periodo borrado del historial local");
      setPeriodToDelete(null);
    } catch (error) {
      setStatusMessage(`No se pudo borrar el periodo: ${String(error)}`);
    }
  }

  async function selectPdfFile() {
    try {
      const file = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (typeof file === "string") {
        setSelectedPdfPath(file);
        setExamStartDate(getTodayDateInput());
        setIsStartDateOpen(true);
        setStatusMessage("PDF seleccionado, falta confirmar la fecha inicial");
      }
    } catch (error) {
      setStatusMessage(`No se pudo abrir el selector de PDF: ${String(error)}`);
    }
  }

  async function generateFromSelectedPdf() {
    if (isParsingPdf) return;

    if (!selectedPdfPath) {
      await selectPdfFile();
      return;
    }

    try {
      setIsParsingPdf(true);
      setStatusMessage("Procesando PDF...");
      const parsedSchedule = await invoke<ParsedSchedule>("parse_schedule_pdf", {
        pdfPath: selectedPdfPath,
      });
      const sheets = buildSheetsFromSchedule(parsedSchedule, examStartDate);

      setGeneratedSheets(sheets);
      setSelectedSheet(sheets[0]?.label ?? "");
      setParsedCourseCount(parsedSchedule.courses.length);
      setIsStartDateOpen(false);
      setStatusMessage(
        `PDF procesado: ${parsedSchedule.courses.length} materias detectadas`,
      );
    } catch (error) {
      setStatusMessage(`No se pudo procesar el PDF: ${String(error)}`);
    } finally {
      setIsParsingPdf(false);
    }
  }

  function updateSheetDate(
    label: string,
    field: "firstDate" | "secondDate",
    value: string,
  ) {
    const targetSheet = generatedSheets.find((sheet) => sheet.label === label);
    const nextFirstDate =
      field === "firstDate" ? value : targetSheet?.firstDate ?? value;
    const nextSecondDate =
      field === "secondDate" ? value : targetSheet?.secondDate ?? value;
    const nextLabel = targetSheet
      ? formatSheetLabel(
          parseLocalDate(nextFirstDate),
          parseLocalDate(nextSecondDate),
          getCareerCodeFromSheetLabel(targetSheet.label),
        )
      : label;

    setGeneratedSheets((currentSheets) =>
      currentSheets.map((sheet) => {
        if (sheet.label !== label) return sheet;

        const updatedBlocks = sheet.blocks.map((block, blockIndex) => {
          const shouldUpdateBlock =
            field === "firstDate" ? blockIndex < 2 : blockIndex >= 2;
          if (!shouldUpdateBlock) return block;

          const nextDate = parseLocalDate(value);
          return {
            ...block,
            date: value,
            day: formatLongDateMx(nextDate),
          };
        });

        return {
          ...sheet,
          label: nextLabel,
          [field]: value,
          blocks: updatedBlocks,
        };
      }),
    );

    setSelectedSheet((currentSheet) =>
      currentSheet === label ? nextLabel : currentSheet,
    );
  }

  function updateBlockDate(sheetLabel: string, blockIndex: number, value: string) {
    setGeneratedSheets((currentSheets) =>
      currentSheets.map((sheet) => {
        if (sheet.label !== sheetLabel) return sheet;

        const nextDate = parseLocalDate(value);
        return {
          ...sheet,
          blocks: sheet.blocks.map((block, currentBlockIndex) =>
            currentBlockIndex === blockIndex
              ? {
                  ...block,
                  date: value,
                  day: formatLongDateMx(nextDate),
                }
              : block,
          ),
        };
      }),
    );
  }

  function updateRow(
    sheetLabel: string,
    blockIndex: number,
    rowIndex: number,
    field: keyof ExamRow,
    value: string,
  ) {
    setGeneratedSheets((currentSheets) =>
      currentSheets.map((sheet) => {
        if (sheet.label !== sheetLabel) return sheet;

        return {
          ...sheet,
          blocks: sheet.blocks.map((block, currentBlockIndex) => {
            if (currentBlockIndex !== blockIndex) return block;

            return {
              ...block,
              rows: block.rows.map((row, currentRowIndex) =>
                currentRowIndex === rowIndex ? { ...row, [field]: value } : row,
              ),
            };
          }),
        };
      }),
    );
  }

  function updateRowTime(
    sheetLabel: string,
    blockIndex: number,
    rowIndex: number,
    edge: "start" | "end",
    value: string,
  ) {
    setGeneratedSheets((currentSheets) =>
      currentSheets.map((sheet) => {
        if (sheet.label !== sheetLabel) return sheet;

        return {
          ...sheet,
          blocks: sheet.blocks.map((block, currentBlockIndex) => {
            if (currentBlockIndex !== blockIndex) return block;

            return {
              ...block,
              rows: block.rows.map((row, currentRowIndex) => {
                if (currentRowIndex !== rowIndex) return row;

                const start = edge === "start" ? value : getTimeStart(row.time);
                const end = edge === "end" ? value : getTimeEnd(row.time);
                return { ...row, time: `${start}-${end}` };
              }),
            };
          }),
        };
      }),
    );
  }

  function moveRowToIndex(
    sheetLabel: string,
    blockIndex: number,
    sourceIndex: number,
    targetIndex: number,
  ) {
    if (sourceIndex === targetIndex) return;

    setGeneratedSheets((currentSheets) =>
      currentSheets.map((sheet) => {
        if (sheet.label !== sheetLabel) return sheet;

        return {
          ...sheet,
          blocks: sheet.blocks.map((block, currentBlockIndex) => {
            if (currentBlockIndex !== blockIndex) return block;

            if (targetIndex < 0 || targetIndex >= block.rows.length) {
              return block;
            }

            const rows = [...block.rows];
            const [row] = rows.splice(sourceIndex, 1);
            rows.splice(targetIndex, 0, row);

            return { ...block, rows };
          }),
        };
      }),
    );
  }

  function handleRowPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    sheetLabel: string,
    blockIndex: number,
    rowIndex: number,
  ) {
    event.preventDefault();
    const rowElement = event.currentTarget.closest("tr");
    const tableElement = event.currentTarget.closest("table");
    if (!rowElement || !tableElement) return;

    const rowElements = Array.from(
      tableElement.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-index]"),
    );
    const rowRects = rowElements.map((element) => element.getBoundingClientRect());
    const rowRect = rowElement.getBoundingClientRect();
    const tableRect = tableElement.getBoundingClientRect();

    dragContextRef.current = {
      sheetLabel,
      blockIndex,
      sourceIndex: rowIndex,
      targetIndex: rowIndex,
      tableTop: tableRect.top,
      tableBottom: tableRect.bottom,
      tableLeft: tableRect.left,
      tableWidth: tableRect.width,
      rowHeight: rowRect.height,
      rowCenters: rowRects.map((rect) => rect.top + rect.height / 2),
    };

    setDraggedRow({ sheetLabel, blockIndex, rowIndex });
    setDropTarget({ sheetLabel, blockIndex, rowIndex });
    setDragPreview({
      top: rowRect.top,
      left: tableRect.left,
      width: tableRect.width,
      height: rowRect.height,
    });
  }

  function getRowDragClass(sheetLabel: string, blockIndex: number, rowIndex: number) {
    const isDragged =
      draggedRow?.sheetLabel === sheetLabel &&
      draggedRow.blockIndex === blockIndex &&
      draggedRow.rowIndex === rowIndex;
    const isSameTable =
      draggedRow?.sheetLabel === sheetLabel && draggedRow.blockIndex === blockIndex;

    if (isDragged) {
      return "bg-[#fff8e5] opacity-45 shadow-sm scale-[0.995]";
    }

    if (!isSameTable || !dropTarget || dropTarget.rowIndex === draggedRow.rowIndex) {
      return "";
    }

    if (rowIndex === dropTarget.rowIndex) {
      return "bg-[#eef4fb] ring-1 ring-primary/20";
    }

    if (draggedRow.rowIndex < dropTarget.rowIndex) {
      return rowIndex > draggedRow.rowIndex && rowIndex <= dropTarget.rowIndex
        ? "-translate-y-1"
        : "";
    }

    return rowIndex >= dropTarget.rowIndex && rowIndex < draggedRow.rowIndex
      ? "translate-y-1"
      : "";
  }

  const draggedPreviewBlock = draggedRow
    ? generatedSheets.find((sheet) => sheet.label === draggedRow.sheetLabel)?.blocks[
        draggedRow.blockIndex
      ] ?? null
    : null;
  const draggedPreviewRow = draggedRow
    ? draggedPreviewBlock?.rows[draggedRow.rowIndex] ?? null
    : null;
  const hasGeneratedCalendar = generatedSheets.length > 0;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#d9e6f7,transparent_32%),radial-gradient(circle_at_top_right,#f6e2a4,transparent_26%),linear-gradient(180deg,#f7f9fd_0%,#edf3fb_100%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-5 px-5 py-5">
        <header className="flex flex-col gap-4 border-b border-border/80 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-foreground">
              Generador de calendarios ordinarios
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button variant="outline" onClick={startOverSession}>
              <Plus />
              Empezar de nuevo
            </Button>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="flex w-full min-w-0 flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Periodo activo</CardDescription>
                  <CardTitle className="text-xl">
                    {activePeriod ? periodName : "Sin periodo activo"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground">
                  {activePeriod ? `${periodRange} · ${schoolYear}` : "Configura o guarda un periodo"}
                  <div className="mt-1 text-xs text-primary">{statusMessage}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Hojas Excel</CardDescription>
                  <CardTitle className="text-2xl">{generatedSheets.length}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Tablas por hoja</CardDescription>
                  <CardTitle className="text-2xl">{generatedSheets.length ? 4 : 0}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Materias leídas</CardDescription>
                  <CardTitle className="flex items-center gap-2 text-2xl">
                    <CheckCircle2 className="size-5 text-accent" />
                    {parsedCourseCount}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card className="w-full overflow-hidden">
              <CardHeader className="gap-4 border-b border-border/70">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <CardTitle>Calendario generado</CardTitle>
                    <CardDescription>
                      Edita celdas, ajusta días y reordena filas antes de exportar.
                    </CardDescription>
                  </div>
                  {hasGeneratedCalendar ? (
                    <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
                      <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
                      <Input className="pl-8" placeholder="Buscar profesor o materia" />
                    </div>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="w-full p-4">
                {hasGeneratedCalendar ? (
                  <Tabs
                    value={selectedSheet}
                    onValueChange={setSelectedSheet}
                    className="flex min-w-0 flex-col gap-0"
                  >
                      <div className="mb-4 overflow-x-auto rounded-lg border border-border bg-[#eef4fb] p-1.5">
                        <TabsList className="h-10 min-w-max justify-start gap-1.5 bg-transparent p-0">
                          {generatedSheets.map((sheet) => (
                            <TabsTrigger
                              key={sheet.label}
                              value={sheet.label}
                              className="relative h-8 flex-none border border-transparent bg-white/70 px-3 text-xs font-semibold text-muted-foreground shadow-none transition-all hover:border-primary/30 hover:bg-white hover:text-primary data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:ring-2 data-[state=active]:ring-accent/45 data-[state=active]:after:absolute data-[state=active]:after:inset-x-3 data-[state=active]:after:-bottom-1.5 data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-accent data-active:border-primary data-active:bg-primary data-active:text-primary-foreground data-active:shadow-md"
                            >
                              {sheet.label}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </div>

                      {generatedSheets.map((sheet) => (
                        <TabsContent
                          key={sheet.label}
                          value={sheet.label}
                          className="m-0 w-full space-y-4"
                        >
                          <div className="flex flex-col gap-3 rounded-lg border border-border bg-[#f8fbff] p-3 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="text-sm font-semibold text-primary">
                                Hoja: {sheet.label}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Cada hoja mantiene 2 días y hasta 4 grupos por día.
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:flex">
                              <DateSelector
                                aria-label="Editar primer día de la hoja"
                                value={sheet.firstDate}
                                onChange={(value) =>
                                  updateSheetDate(
                                    sheet.label,
                                    "firstDate",
                                    value,
                                  )
                                }
                              />
                              <DateSelector
                                aria-label="Editar segundo día de la hoja"
                                value={sheet.secondDate}
                                onChange={(value) =>
                                  updateSheetDate(
                                    sheet.label,
                                    "secondDate",
                                    value,
                                  )
                                }
                              />
                            </div>
                          </div>

                          <div className="grid items-start gap-4">
                            {sheet.blocks.map((block, blockIndex) => (
                              <section
                                key={`${sheet.label}-${block.day}-${block.turn}`}
                                className="overflow-hidden rounded-lg border border-border bg-card"
                              >
                                <div className="border-b border-border/70 bg-[#f8fbff] p-3">
                                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                      <h3 className="text-base font-semibold text-foreground">
                                        {block.day}
                                      </h3>
                                      <p className="text-sm text-muted-foreground">
                                        {block.career}
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                                      <div className="w-40">
                                        <DateSelector
                                          aria-label={`Editar día de ${block.turn}`}
                                          value={block.date}
                                          onChange={(value) =>
                                            updateBlockDate(sheet.label, blockIndex, value)
                                          }
                                        />
                                      </div>
                                      <Badge
                                        variant="outline"
                                        className="border-accent/70 bg-[#fff6d8] text-[#6f4d00]"
                                      >
                                        {block.turn}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                                <div className="p-3">
                                  <div className="overflow-hidden rounded-lg border border-border">
                                    <Table>
                                      <TableHeader className="bg-[#eef4fb]">
                                        <TableRow className="hover:bg-[#eef4fb]">
                                          <TableHead className="w-56 px-3 text-primary">
                                            Rango de hora
                                          </TableHead>
                                          <TableHead className="min-w-56 px-3 text-primary">
                                            Materia
                                          </TableHead>
                                          <TableHead className="min-w-48 px-3 text-primary">
                                            Maestro
                                          </TableHead>
                                          <TableHead className="w-28 px-3 text-center text-primary">
                                            Grupo
                                          </TableHead>
                                          <TableHead className="w-20 px-3 text-center text-primary">
                                            Orden
                                          </TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {block.rows.map((row, rowIndex) => (
                                          <TableRow
                                            key={`${block.day}-${block.turn}-${row.subject}-${rowIndex}`}
                                            data-row-index={rowIndex}
                                            className={`transition-[background-color,box-shadow,opacity,transform] duration-150 ease-out will-change-transform hover:bg-[#fff8e5]/55 ${getRowDragClass(
                                              sheet.label,
                                              blockIndex,
                                              rowIndex,
                                            )}`}
                                          >
                                            <TableCell className="px-3 py-2">
                                              <div className="flex min-w-48 items-center gap-2">
                                                <Input
                                                  aria-label="Hora inicial"
                                                  type="time"
                                                  value={getTimeStart(row.time)}
                                                  onChange={(event) =>
                                                    updateRowTime(
                                                      sheet.label,
                                                      blockIndex,
                                                      rowIndex,
                                                      "start",
                                                      event.currentTarget.value,
                                                    )
                                                  }
                                                  className="h-8 w-24"
                                                />
                                                <span className="text-xs text-muted-foreground">
                                                  a
                                                </span>
                                                <Input
                                                  aria-label="Hora final"
                                                  type="time"
                                                  value={getTimeEnd(row.time)}
                                                  onChange={(event) =>
                                                    updateRowTime(
                                                      sheet.label,
                                                      blockIndex,
                                                      rowIndex,
                                                      "end",
                                                      event.currentTarget.value,
                                                    )
                                                  }
                                                  className="h-8 w-24"
                                                />
                                              </div>
                                            </TableCell>
                                            <TableCell className="px-3 py-2">
                                              <Input
                                                value={row.subject}
                                                onChange={(event) =>
                                                  updateRow(
                                                    sheet.label,
                                                    blockIndex,
                                                    rowIndex,
                                                    "subject",
                                                    event.currentTarget.value,
                                                  )
                                                }
                                                className="h-8"
                                              />
                                            </TableCell>
                                            <TableCell className="px-3 py-2">
                                              <Input
                                                value={row.teacher}
                                                onChange={(event) =>
                                                  updateRow(
                                                    sheet.label,
                                                    blockIndex,
                                                    rowIndex,
                                                    "teacher",
                                                    event.currentTarget.value,
                                                  )
                                                }
                                                className="h-8"
                                              />
                                            </TableCell>
                                            <TableCell className="px-3 py-2">
                                              <Input
                                                value={row.group}
                                                onChange={(event) =>
                                                  updateRow(
                                                    sheet.label,
                                                    blockIndex,
                                                    rowIndex,
                                                    "group",
                                                    event.currentTarget.value,
                                                  )
                                                }
                                                className="h-8 text-center"
                                              />
                                            </TableCell>
                                            <TableCell className="px-3 py-2">
                                              <button
                                                type="button"
                                                className="mx-auto flex size-8 cursor-grab touch-none select-none items-center justify-center rounded-md border border-input bg-card text-primary transition-colors hover:bg-[#eef4fb] active:cursor-grabbing"
                                                aria-label="Arrastrar fila"
                                                onPointerDown={(event) =>
                                                  handleRowPointerDown(
                                                    event,
                                                    sheet.label,
                                                    blockIndex,
                                                    rowIndex,
                                                  )
                                                }
                                              >
                                                <GripVertical className="size-4" />
                                              </button>
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                        {block.rows.length === 0 ? (
                                          <TableRow>
                                            <TableCell
                                              colSpan={5}
                                              className="h-24 text-center text-sm text-muted-foreground"
                                            >
                                              No hay materias detectadas para este grupo.
                                            </TableCell>
                                          </TableRow>
                                        ) : null}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              </section>
                            ))}
                          </div>
                        </TabsContent>
                      ))}
                  </Tabs>
                ) : (
                  <EmptyCalendarState onSelectPdf={selectPdfFile} />
                )}
              </CardContent>
            </Card>
          </div>

          <aside className="flex flex-col gap-4">
            {hasGeneratedCalendar ? (
              <Card>
                <CardHeader>
                  <CardTitle>Acciones del calendario</CardTitle>
                  <CardDescription>
                    Guarda los cambios o genera el archivo final cuando termines.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={saveCurrentPeriod}
                  >
                    <Save />
                    Guardar periodo
                  </Button>
                  <Button
                    className="w-full justify-start"
                    onClick={exportCurrentExcel}
                    disabled={isExporting}
                  >
                    {isExporting ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <FileSpreadsheet />
                    )}
                    {isExporting ? "Exportando..." : "Exportar Excel"}
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            <Button
              variant="outline"
              className="h-11 justify-start"
              onClick={() => setIsPeriodsOpen(true)}
            >
              <History />
              Ver periodos de examen guardados
              <Badge variant="secondary" className="ml-auto">
                {periods.length}
              </Badge>
            </Button>
          </aside>
        </section>
      </div>

      {isPeriodsOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-5">
          <div className="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Periodos de examen guardados
                </h2>
                <p className="text-sm text-muted-foreground">
                  Consulta, abre o elimina periodos almacenados localmente.
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Cerrar periodos guardados"
                onClick={() => setIsPeriodsOpen(false)}
              >
                <X />
              </Button>
            </div>

            <div className="border-b border-border p-5">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Buscar por periodo o ciclo escolar" />
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-3 p-5">
                {periods.map((period) => (
                  <div
                    key={period.id}
                    className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-[#eef4fb]"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-foreground">
                            {period.name} · {period.range}
                          </h3>
                          <Badge
                            variant={period.status === "Activo" ? "secondary" : "outline"}
                            className={
                              period.status === "Activo"
                                ? "border-blue-100 bg-blue-50 text-blue-800"
                                : ""
                            }
                          >
                            {period.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Ciclo escolar {period.schoolYear}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openSavedPeriod(period)}
                        >
                          Abrir
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setPeriodToDelete(period)}
                        >
                          <Trash2 />
                          Borrar
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-2 border-t border-border p-5">
              <Button variant="outline" onClick={() => setIsPeriodsOpen(false)}>
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {periodToDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-5">
          <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-2xl">
            <div className="border-b border-border p-5">
              <h2 className="text-lg font-semibold text-foreground">
                Borrar periodo de examen
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Esta acción eliminará el periodo guardado del historial local.
              </p>
            </div>
            <div className="p-5">
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                ¿Seguro que deseas borrar {periodToDelete.name} ·{" "}
                {periodToDelete.range} del ciclo {periodToDelete.schoolYear}?
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border p-5">
              <Button variant="outline" onClick={() => setPeriodToDelete(null)}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={deleteSelectedPeriod}>
                Borrar periodo
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isStartDateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-5">
          <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Preparar calendario de exámenes
                </h2>
                <p className="text-sm text-muted-foreground">
                  Verifica los datos del periodo antes de procesar el PDF.
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Cerrar modal"
                disabled={isParsingPdf}
                onClick={() => setIsStartDateOpen(false)}
              >
                <X />
              </Button>
            </div>
            <div className="space-y-5 p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="period-name">Periodo</Label>
                  <AppSelect
                    id="period-name"
                    value={periodName}
                    onChange={setPeriodName}
                    options={[
                      { value: "Periodo 1", label: "Periodo 1" },
                      { value: "Periodo 2", label: "Periodo 2" },
                    ]}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="period-range">Rango</Label>
                  <AppSelect
                    id="period-range"
                    value={periodRange}
                    onChange={setPeriodRange}
                    options={[
                      { value: "Enero - Junio", label: "Enero - Junio" },
                      { value: "Agosto - Diciembre", label: "Agosto - Diciembre" },
                    ]}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="school-year">Ciclo escolar</Label>
                  <Input
                    id="school-year"
                    value={schoolYear}
                    onChange={(event) => setSchoolYear(event.currentTarget.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exam-start-date">Fecha inicial de exámenes</Label>
                  <DateSelector
                    id="exam-start-date"
                    value={examStartDate}
                    onChange={setExamStartDate}
                  />
                </div>
              </div>

            </div>
            <div className="flex justify-end gap-2 border-t border-border p-5">
              <Button
                variant="outline"
                disabled={isParsingPdf}
                onClick={() => setIsStartDateOpen(false)}
              >
                Cancelar
              </Button>
              <Button onClick={generateFromSelectedPdf} disabled={isParsingPdf}>
                {isParsingPdf ? (
                  <LoaderCircle className="animate-spin" />
                ) : null}
                {isParsingPdf ? "Procesando..." : "Generar calendario"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isParsingPdf ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-950/35 p-5">
          <div className="flex w-full max-w-sm items-center gap-4 rounded-lg border border-border bg-card p-5 shadow-2xl">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-accent/70 bg-[#fff8e5] text-primary">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Procesando PDF
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                La app estÃ¡ leyendo el horario y preparando las hojas de examen.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {isExporting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-5">
          <div className="flex w-full max-w-sm items-center gap-4 rounded-lg border border-border bg-card p-5 shadow-2xl">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-accent/70 bg-[#fff8e5] text-primary">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Exportando Excel
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                La app está generando el archivo .xlsx con la plantilla oficial.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {dragPreview && draggedPreviewRow ? (
        <div
          className="pointer-events-none fixed left-0 top-0 z-[60] overflow-hidden rounded-lg border border-primary/30 bg-card shadow-xl ring-1 ring-primary/10 will-change-transform"
          style={{
            width: dragPreview.width,
            minHeight: dragPreview.height,
            transform: `translate3d(${dragPreview.left}px, ${dragPreview.top}px, 0)`,
          }}
        >
          <div className="grid grid-cols-[210px_minmax(220px,1fr)_minmax(180px,0.8fr)_112px_80px] items-center gap-0 bg-[#fff8e5] text-sm">
            <div className="px-3 py-2 text-primary">{draggedPreviewRow.time}</div>
            <div className="truncate px-3 py-2 text-foreground">
              {draggedPreviewRow.subject}
            </div>
            <div className="truncate px-3 py-2 text-muted-foreground">
              {draggedPreviewRow.teacher}
            </div>
            <div className="px-3 py-2 text-center text-foreground">
              {draggedPreviewRow.group}
            </div>
            <div className="flex justify-center px-3 py-2 text-primary">
              <GripVertical className="size-4" />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

type DateSelectorProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  "aria-label"?: string;
};

type SelectOption = {
  value: string;
  label: string;
};

type AppSelectProps = {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
};

function EmptyCalendarState({ onSelectPdf }: { onSelectPdf: () => void }) {
  return (
    <div className="flex min-h-[480px] w-full items-center justify-center rounded-lg border border-dashed border-border bg-[#f8fbff] p-8 text-center">
      <div className="flex max-w-md flex-col items-center">
        <div className="flex size-12 items-center justify-center rounded-lg border border-accent/70 bg-[#fff8e5] text-primary">
          <Upload className="size-6" />
        </div>
        <h3 className="mt-5 text-xl font-semibold text-foreground">
          Calendario pendiente
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Selecciona el PDF de horarios para generar las hojas de examen de este periodo.
        </p>
        <Button className="mt-6" onClick={onSelectPdf}>
          <Upload />
          Seleccionar PDF
        </Button>
      </div>
    </div>
  );
}

function AppSelect({ id, value, options, onChange }: AppSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!selectRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <div ref={selectRef} className="relative">
      <button
        id={id}
        type="button"
        className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-card px-3 text-left text-sm text-foreground shadow-sm outline-none transition-colors hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{selectedOption?.label ?? value}</span>
        <ChevronDown
          className={`size-4 text-primary transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen ? (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-lg border border-border bg-card p-1 shadow-xl ring-1 ring-primary/10"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`flex h-9 w-full items-center rounded-md px-3 text-left text-sm transition-colors ${
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-[#eef4fb] hover:text-primary"
                }`}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DateSelector({ id, value, onChange, "aria-label": ariaLabel }: DateSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = parseLocalDate(value);
  const [visibleYear, setVisibleYear] = useState(selectedDate.getFullYear());
  const [visibleMonth, setVisibleMonth] = useState(selectedDate.getMonth());
  const monthNames = Array.from({ length: 12 }, (_, month) =>
    capitalize(
      new Intl.DateTimeFormat("es-MX", { month: "long" }).format(
        new Date(visibleYear, month, 1),
      ),
    ),
  );
  const yearOptions = Array.from(
    { length: 9 },
    (_, index) => selectedDate.getFullYear() - 4 + index,
  );
  const firstWeekday = new Date(visibleYear, visibleMonth, 1).getDay();
  const mondayBasedOffset = firstWeekday === 0 ? 6 : firstWeekday - 1;
  const daysInMonth = new Date(visibleYear, visibleMonth + 1, 0).getDate();
  const blanks = Array.from({ length: mondayBasedOffset }, (_, index) => index);
  const days = Array.from({ length: daysInMonth }, (_, index) => index + 1);

  function selectDay(day: number) {
    onChange(toDateInputValue(new Date(visibleYear, visibleMonth, day)));
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <Button
        id={id}
        type="button"
        variant="outline"
        className="h-9 w-full justify-start bg-card px-3 font-normal"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <CalendarDays className="size-4 text-primary" />
        <span>{formatCompactDateMx(value)}</span>
      </Button>

      {isOpen ? (
        <div className="absolute right-0 top-11 z-50 w-72 rounded-lg border border-border bg-card p-3 shadow-xl">
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <AppSelect
              value={String(visibleMonth)}
              onChange={(nextMonth) => setVisibleMonth(Number(nextMonth))}
              options={monthNames.map((month, index) => ({
                value: String(index),
                label: month,
              }))}
            />
            <AppSelect
              value={String(visibleYear)}
              onChange={(nextYear) => setVisibleYear(Number(nextYear))}
              options={yearOptions.map((year) => ({
                value: String(year),
                label: String(year),
              }))}
            />
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
            {["L", "M", "M", "J", "V", "S", "D"].map((day, index) => (
              <div key={`${day}-${index}`} className="py-1">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {blanks.map((blank) => (
              <div key={`blank-${blank}`} className="h-8" />
            ))}
            {days.map((day) => {
              const isSelected =
                selectedDate.getFullYear() === visibleYear &&
                selectedDate.getMonth() === visibleMonth &&
                selectedDate.getDate() === day;

              return (
                <Button
                  key={day}
                  type="button"
                  variant={isSelected ? "default" : "ghost"}
                  size="icon-sm"
                  className="h-8 w-8"
                  onClick={() => selectDay(day)}
                >
                  {day}
                </Button>
              );
            })}
          </div>
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsOpen(false)}>
              Cerrar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
