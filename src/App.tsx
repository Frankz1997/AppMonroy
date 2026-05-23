import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save as saveFile } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  FileText,
  FileSpreadsheet,
  GripVertical,
  History,
  Info,
  LoaderCircle,
  Moon,
  Plus,
  Save,
  Search,
  Settings,
  Sun,
  Trash2,
  Upload,
  Users,
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

type ImportedExcelSchedule = {
  periodName: string;
  periodRange: string;
  schoolYear: string;
  examStartDate: string;
  importedRowCount: number;
  sheets: SheetPlan[];
};

type GeneralConfig = {
  coordinatorName: string;
  signaturePath: string;
  sealPath: string;
};

type TeacherRecord = {
  teacherKey: string;
  sourceName: string;
  displayName: string;
  title: string;
  updatedAt?: string | null;
};

type ParsedCourse = {
  career: string;
  careerCode: string;
  period: string;
  group: string;
  plan: string;
  subject: string;
  teacher: string;
  teacherKey?: string;
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
  plan?: string;
  teacherKey?: string;
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

type CalendarSearchKind = "teacher" | "subject";

const PERIOD_CONFIG = {
  "Periodo 1": {
    range: "Agosto - Diciembre",
    startMonth: 8,
    startDay: 1,
  },
  "Periodo 2": {
    range: "Enero - Junio",
    startMonth: 1,
    startDay: 1,
  },
} as const;

type PeriodOption = keyof typeof PERIOD_CONFIG;

type CalendarSearchSelection = {
  kind: CalendarSearchKind;
  value: string;
};

type CalendarSearchSortKey =
  | "name"
  | "career"
  | "group"
  | "plan"
  | "date"
  | "time"
  | "sheet";

type CalendarSearchSort = {
  key: CalendarSearchSortKey;
  direction: "asc" | "desc";
};

type CalendarSearchSuggestion = CalendarSearchSelection & {
  count: number;
};

type CalendarSearchResult = {
  teacher: string;
  subject: string;
  career: string;
  group: string;
  plan?: string;
  dateValue: string;
  date: string;
  day: string;
  time: string;
  sheetLabel: string;
};

type ThemeMode = "light" | "dark";

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

function normalizeTimeInput(value: string) {
  const cleaned = value.replace(/[^\d:]/g, "").slice(0, 5);
  return cleaned;
}

function formatTimeInput(value: string) {
  const match = value.match(/^(\d{1,2}):?(\d{0,2})$/);
  if (!match) return value;

  const hour = Math.min(Number.parseInt(match[1] || "0", 10), 23);
  const minute = Math.min(Number.parseInt(match[2] || "0", 10), 59);

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";

  const storedTheme = window.localStorage.getItem("appmonroy-theme");
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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

function isPeriodOption(value: string): value is PeriodOption {
  return value === "Periodo 1" || value === "Periodo 2";
}

function buildSchoolYear(startYear: number) {
  return `${startYear}-${startYear + 1}`;
}

function schoolYearStartYear(value: string) {
  const years = value.match(/(?:19|20)\d{2}/g);
  if (!years?.length) return new Date().getFullYear();
  return Number.parseInt(years[0], 10);
}

function getPeriodYear(period: PeriodOption, schoolYearValue: string) {
  const startYear = schoolYearStartYear(schoolYearValue);
  return period === "Periodo 1" ? startYear : startYear + 1;
}

function getPeriodStartDate(period: PeriodOption, schoolYearValue: string) {
  const config = PERIOD_CONFIG[period];
  const year = getPeriodYear(period, schoolYearValue);
  return `${year}-${String(config.startMonth).padStart(2, "0")}-${String(
    config.startDay,
  ).padStart(2, "0")}`;
}

function getSmartPeriodDefaults(referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth() + 1;
  const period: PeriodOption = month >= 8 ? "Periodo 1" : month <= 6 ? "Periodo 2" : "Periodo 1";
  const schoolYearValue =
    period === "Periodo 1" ? buildSchoolYear(year) : buildSchoolYear(year - 1);
  const examDate =
    month === 7 ? getPeriodStartDate(period, schoolYearValue) : toDateInputValue(referenceDate);

  return {
    periodName: period,
    periodRange: PERIOD_CONFIG[period].range,
    schoolYear: schoolYearValue,
    examStartDate: examDate,
  };
}

function getCurrentOfficeYear() {
  return String(new Date().getFullYear()).slice(-2);
}

function getOfficeYearFromDate(value: string) {
  const match = value.match(/^(\d{4})-/);
  return match ? match[1].slice(-2) : getCurrentOfficeYear();
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim();
}

function getWordTeacherCount(sheets: SheetPlan[]) {
  const teachers = new Set<string>();
  sheets.forEach((sheet) => {
    sheet.blocks.forEach((block) => {
      block.rows.forEach((row) => {
        if (row.teacher.trim() && row.subject.trim()) {
          teachers.add(row.teacher.trim());
        }
      });
    });
  });
  return teachers.size;
}

function buildWordDefaultFileName(officeYear: string, startFolio: number, sheets: SheetPlan[]) {
  const teacherCount = getWordTeacherCount(sheets);
  const endFolio = teacherCount > 0 ? startFolio + teacherCount - 1 : startFolio;
  return safeFileName(
    `Oficios Word UAS-FIMAZ-CE-${officeYear}-${startFolio}-${endFolio}.docx`,
  );
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

function getCareerCodeFromRow(row: ExamRow, sheetLabel: string) {
  return row.group.match(/^([A-Z]{2,})\b/)?.[1] ?? getCareerCodeFromSheetLabel(sheetLabel);
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
        plan: course.plan,
        teacherKey: course.teacherKey,
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

function normalizeTeacherTitle(title: string) {
  const trimmed = title.trim();
  if (!trimmed) return "";
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function normalizeTeacherKey(name: string) {
  return name
    .split(/\s+/)
    .join(" ")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function getTeacherDirectoryMap(records: TeacherRecord[]) {
  return new Map(records.map((record) => [record.teacherKey, record]));
}

function teacherHasTitle(record: TeacherRecord) {
  return record.title.trim().length > 0;
}

function sortTeacherDirectory(records: TeacherRecord[]) {
  return [...records].sort((left, right) => {
    const leftHasTitle = teacherHasTitle(left);
    const rightHasTitle = teacherHasTitle(right);
    if (leftHasTitle !== rightHasTitle) {
      return leftHasTitle ? 1 : -1;
    }

    return left.displayName.localeCompare(right.displayName, "es");
  });
}

function formatTeacherNameWithDirectory(fallbackName: string, record?: TeacherRecord) {
  const displayName = record?.displayName.trim() || fallbackName.trim();
  const title = normalizeTeacherTitle(record?.title ?? "");
  return title ? `${title} ${displayName}` : displayName;
}

function applyTeacherDirectoryToCourses(
  courses: ParsedCourse[],
  directory: TeacherRecord[],
) {
  const directoryMap = getTeacherDirectoryMap(directory);

  return courses.map((course) => {
    const teacherKey = course.teacherKey || normalizeTeacherKey(course.teacher);
    const teacherRecord = directoryMap.get(teacherKey);

    return {
      ...course,
      teacherKey,
      teacher: formatTeacherNameWithDirectory(course.teacher, teacherRecord),
    };
  });
}

function applyTeacherDirectoryToSheets(
  sheets: SheetPlan[],
  directory: TeacherRecord[],
) {
  const directoryMap = getTeacherDirectoryMap(directory);

  return sheets.map((sheet) => ({
    ...sheet,
    blocks: sheet.blocks.map((block) => ({
      ...block,
      rows: block.rows.map((row) => {
        const teacherKey = row.teacherKey || normalizeTeacherKey(row.teacher);
        const teacherRecord = directoryMap.get(teacherKey);
        if (!teacherRecord) return row;

        return {
          ...row,
          teacherKey,
          teacher: formatTeacherNameWithDirectory(row.teacher, teacherRecord),
        };
      }),
    })),
  }));
}

function clearDeletedTeachersFromSheets(
  sheets: SheetPlan[],
  deletedTeachers: TeacherRecord[],
) {
  if (deletedTeachers.length === 0) return sheets;

  const deletedMap = getTeacherDirectoryMap(deletedTeachers);

  return sheets.map((sheet) => ({
    ...sheet,
    blocks: sheet.blocks.map((block) => ({
      ...block,
      rows: block.rows.map((row) => {
        if (!row.teacherKey) return row;
        const deletedTeacher = deletedMap.get(row.teacherKey);
        if (!deletedTeacher) return row;

        return {
          ...row,
          teacher: deletedTeacher.sourceName,
        };
      }),
    })),
  }));
}

function normalizeSearchValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getCalendarSearchResults(
  sheets: SheetPlan[],
  selection: CalendarSearchSelection | null,
) {
  if (!selection) return [];

  const results: CalendarSearchResult[] = [];
  sheets.forEach((sheet) => {
    sheet.blocks.forEach((block) => {
      block.rows.forEach((row) => {
        const matches =
          selection.kind === "teacher"
            ? row.teacher === selection.value
            : row.subject === selection.value;

        if (!matches) return;

        results.push({
          teacher: row.teacher,
          subject: row.subject,
          career: getCareerCodeFromRow(row, sheet.label),
          group: row.group,
          plan: row.plan,
          dateValue: block.date,
          date: formatCompactDateMx(block.date),
          day: block.day,
          time: row.time,
          sheetLabel: sheet.label,
        });
      });
    });
  });

  return results.sort((left, right) => {
    const dateComparison = left.date.localeCompare(right.date);
    if (dateComparison !== 0) return dateComparison;
    return left.time.localeCompare(right.time);
  });
}

function getCalendarSearchSortValue(
  result: CalendarSearchResult,
  selection: CalendarSearchSelection | null,
  key: CalendarSearchSortKey,
) {
  switch (key) {
    case "name":
      return selection?.kind === "teacher" ? result.subject : result.teacher;
    case "career":
      return result.career;
    case "group":
      return result.group;
    case "plan":
      return result.plan ?? "";
    case "date":
      return result.dateValue;
    case "time":
      return result.time;
    case "sheet":
      return result.sheetLabel;
  }
}

function sortCalendarSearchResults(
  results: CalendarSearchResult[],
  selection: CalendarSearchSelection | null,
  sort: CalendarSearchSort,
) {
  return results
    .map((result, index) => ({ result, index }))
    .sort((left, right) => {
      const leftValue = getCalendarSearchSortValue(left.result, selection, sort.key);
      const rightValue = getCalendarSearchSortValue(right.result, selection, sort.key);
      const comparison = leftValue.localeCompare(rightValue, "es-MX", {
        numeric: true,
        sensitivity: "base",
      });

      if (comparison !== 0) {
        return sort.direction === "asc" ? comparison : -comparison;
      }

      const dateComparison = left.result.dateValue.localeCompare(right.result.dateValue);
      if (dateComparison !== 0) return dateComparison;

      const timeComparison = left.result.time.localeCompare(right.result.time);
      if (timeComparison !== 0) return timeComparison;

      return left.index - right.index;
    })
    .map(({ result }) => result);
}

function getCalendarSearchSuggestions(sheets: SheetPlan[], query: string) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return [];

  const suggestions = new Map<string, CalendarSearchSuggestion>();

  sheets.forEach((sheet) => {
    sheet.blocks.forEach((block) => {
      block.rows.forEach((row) => {
        [
          { kind: "teacher" as const, value: row.teacher },
          { kind: "subject" as const, value: row.subject },
        ].forEach((candidate) => {
          const value = candidate.value.trim();
          if (!value || !normalizeSearchValue(value).includes(normalizedQuery)) return;

          const key = `${candidate.kind}:${value}`;
          const current = suggestions.get(key);
          suggestions.set(key, {
            ...candidate,
            value,
            count: (current?.count ?? 0) + 1,
          });
        });
      });
    });
  });

  return Array.from(suggestions.values())
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "teacher" ? -1 : 1;
      }
      return left.value.localeCompare(right.value);
    })
    .slice(0, 10);
}

function App() {
  const smartDefaults = getSmartPeriodDefaults();
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialThemeMode());
  const [periods, setPeriods] = useState<SavedPeriod[]>([]);
  const [activePeriod, setActivePeriod] = useState<SavedPeriod | null>(null);
  const [periodName, setPeriodName] = useState<string>(smartDefaults.periodName);
  const [periodRange, setPeriodRange] = useState<string>(smartDefaults.periodRange);
  const [schoolYear, setSchoolYear] = useState<string>(smartDefaults.schoolYear);
  const [generatedSheets, setGeneratedSheets] = useState<SheetPlan[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [selectedPdfPath, setSelectedPdfPath] = useState<string | null>(null);
  const [examStartDate, setExamStartDate] = useState(smartDefaults.examStartDate);
  const [parsedCourseCount, setParsedCourseCount] = useState(0);
  const [isPeriodsOpen, setIsPeriodsOpen] = useState(false);
  const [isStartDateOpen, setIsStartDateOpen] = useState(false);
  const [isWordModalOpen, setIsWordModalOpen] = useState(false);
  const [isGeneralConfigOpen, setIsGeneralConfigOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingWord, setIsExportingWord] = useState(false);
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [isParsingPdf, setIsParsingPdf] = useState(false);
  const [periodToDelete, setPeriodToDelete] = useState<SavedPeriod | null>(null);
  const [wordOfficeYear, setWordOfficeYear] = useState(() => getCurrentOfficeYear());
  const [wordStartFolio, setWordStartFolio] = useState("96");
  const [wordOfficeDate, setWordOfficeDate] = useState(() => getTodayDateInput());
  const [wordPeriod, setWordPeriod] = useState(() => `${periodName} ${periodRange}`);
  const [wordSchoolYear, setWordSchoolYear] = useState(() => `Ciclo Escolar ${schoolYear}`);
  const [wordExamStartDate, setWordExamStartDate] = useState(() => examStartDate);
  const [wordHourStart, setWordHourStart] = useState("09:00");
  const [wordHourEnd, setWordHourEnd] = useState("17:00");
  const [generalConfig, setGeneralConfig] = useState<GeneralConfig>({
    coordinatorName: "",
    signaturePath: "",
    sealPath: "",
  });
  const [generalConfigDraft, setGeneralConfigDraft] = useState<GeneralConfig>({
    coordinatorName: "",
    signaturePath: "",
    sealPath: "",
  });
  const [teacherDirectory, setTeacherDirectory] = useState<TeacherRecord[]>([]);
  const [teacherDirectoryDraft, setTeacherDirectoryDraft] = useState<TeacherRecord[]>([]);
  const [newTeacherKeys, setNewTeacherKeys] = useState<string[]>([]);
  const [isTeacherDirectoryOpen, setIsTeacherDirectoryOpen] = useState(false);
  const [calendarSearchQuery, setCalendarSearchQuery] = useState("");
  const [isCalendarSearchOpen, setIsCalendarSearchOpen] = useState(false);
  const [calendarSearchSelection, setCalendarSearchSelection] =
    useState<CalendarSearchSelection | null>(null);
  const [calendarSearchSort, setCalendarSearchSort] = useState<CalendarSearchSort>({
    key: "name",
    direction: "asc",
  });
  const [draggedRow, setDraggedRow] = useState<DraggedRow | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [statusMessage, setStatusMessage] = useState("SQLite local listo");
  const dragContextRef = useRef<DragContext | null>(null);
  const calendarSearchRef = useRef<HTMLDivElement | null>(null);

  function closeOnBackdropPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    onClose: () => void,
  ) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  useEffect(() => {
    loadPeriods();
    loadGeneralConfig();
    loadTeacherDirectory();
  }, []);

  useEffect(() => {
    function preventContextMenu(event: MouseEvent) {
      event.preventDefault();
    }

    window.addEventListener("contextmenu", preventContextMenu);
    return () => window.removeEventListener("contextmenu", preventContextMenu);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark");
    window.localStorage.setItem("appmonroy-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    const shouldLockBodyScroll =
      isGeneralConfigOpen ||
      isAboutOpen ||
      isPeriodsOpen ||
      isStartDateOpen ||
      isWordModalOpen ||
      isTeacherDirectoryOpen ||
      Boolean(periodToDelete) ||
      isParsingPdf ||
      isImportingExcel ||
      isExporting;

    if (!shouldLockBodyScroll) return;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [
    isGeneralConfigOpen,
    isAboutOpen,
    isPeriodsOpen,
    isStartDateOpen,
    isWordModalOpen,
    isTeacherDirectoryOpen,
    periodToDelete,
    isParsingPdf,
    isImportingExcel,
    isExporting,
  ]);

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

  useEffect(() => {
    if (!isCalendarSearchOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!calendarSearchRef.current?.contains(event.target as Node)) {
        setIsCalendarSearchOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isCalendarSearchOpen]);

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

  async function loadTeacherDirectory() {
    try {
      const storedDirectory = await invoke<TeacherRecord[]>("list_teacher_directory");
      const sortedDirectory = sortTeacherDirectory(storedDirectory);
      setTeacherDirectory(sortedDirectory);
      setTeacherDirectoryDraft(sortedDirectory);
    } catch (error) {
      setStatusMessage(`No se pudo cargar el directorio de maestros: ${String(error)}`);
    }
  }

  async function loadGeneralConfig() {
    try {
      const storedConfig = await invoke<GeneralConfig>("get_general_config");
      setGeneralConfig(storedConfig);
      setGeneralConfigDraft(storedConfig);
    } catch (error) {
      setStatusMessage(`No se pudo cargar la configuración general: ${String(error)}`);
    }
  }

  function openGeneralConfig() {
    setGeneralConfigDraft(generalConfig);
    setIsGeneralConfigOpen(true);
  }

  function openTeacherDirectory() {
    setTeacherDirectoryDraft(sortTeacherDirectory(teacherDirectory));
    setIsTeacherDirectoryOpen(true);
  }

  async function saveTeacherDirectory() {
    try {
      const draftKeys = new Set(teacherDirectoryDraft.map((record) => record.teacherKey));
      const deletedTeachers = teacherDirectory.filter(
        (record) => !draftKeys.has(record.teacherKey),
      );
      const savedDirectory = await invoke<TeacherRecord[]>("save_teacher_directory", {
        records: teacherDirectoryDraft.map((record) => ({
          ...record,
          sourceName: record.sourceName.trim(),
          displayName: record.displayName.trim(),
          title: normalizeTeacherTitle(record.title),
        })),
      });
      const sortedDirectory = sortTeacherDirectory(savedDirectory);
      setTeacherDirectory(sortedDirectory);
      setTeacherDirectoryDraft(sortedDirectory);
      setNewTeacherKeys([]);
      setGeneratedSheets((currentSheets) =>
        applyTeacherDirectoryToSheets(
          clearDeletedTeachersFromSheets(currentSheets, deletedTeachers),
          sortedDirectory,
        ),
      );
      setIsTeacherDirectoryOpen(false);
      setStatusMessage("Directorio de maestros guardado");
    } catch (error) {
      setStatusMessage(`No se pudo guardar el directorio de maestros: ${String(error)}`);
    }
  }

  async function selectGeneralConfigImage(field: "signaturePath" | "sealPath") {
    try {
      const file = await open({
        multiple: false,
        filters: [{ name: "Imagen", extensions: ["png", "jpg", "jpeg"] }],
      });

      if (typeof file === "string") {
        setGeneralConfigDraft((currentConfig) => ({
          ...currentConfig,
          [field]: file,
        }));
      }
    } catch (error) {
      setStatusMessage(`No se pudo seleccionar la imagen: ${String(error)}`);
    }
  }

  async function saveGeneralConfig() {
    try {
      const savedConfig = await invoke<GeneralConfig>("save_general_config", {
        config: generalConfigDraft,
      });
      setGeneralConfig(savedConfig);
      setGeneralConfigDraft(savedConfig);
      setIsGeneralConfigOpen(false);
      setStatusMessage("Configuración general guardada");
    } catch (error) {
      setStatusMessage(`No se pudo guardar la configuración general: ${String(error)}`);
    }
  }

  function resetWorkArea() {
    const defaults = getSmartPeriodDefaults();
    setActivePeriod(null);
    setPeriodName(defaults.periodName);
    setPeriodRange(defaults.periodRange);
    setSchoolYear(defaults.schoolYear);
    setSelectedPdfPath(null);
    setExamStartDate(defaults.examStartDate);
    setParsedCourseCount(0);
    setGeneratedSheets([]);
    setSelectedSheet("");
    setCalendarSearchQuery("");
    setIsCalendarSearchOpen(false);
    setCalendarSearchSelection(null);
    setCalendarSearchSort({ key: "name", direction: "asc" });
  }

  function applySmartDefaultsForPdf() {
    const defaults = getSmartPeriodDefaults();
    setPeriodName(defaults.periodName);
    setPeriodRange(defaults.periodRange);
    setSchoolYear(defaults.schoolYear);
    setExamStartDate(defaults.examStartDate);
  }

  function updatePeriodName(value: string) {
    if (!isPeriodOption(value)) {
      setPeriodName(value);
      return;
    }

    setPeriodName(value);
    setPeriodRange(PERIOD_CONFIG[value].range);
    setExamStartDate(getPeriodStartDate(value, schoolYear));
  }

  function updateSchoolYear(value: string) {
    setSchoolYear(value);
    if (isPeriodOption(periodName)) {
      setExamStartDate(getPeriodStartDate(periodName, value));
    }
  }

  function applyActivePeriod(period: SavedPeriod) {
    const restoredSheets = applyTeacherDirectoryToSheets(
      period.generatedSheets ?? [],
      teacherDirectory,
    );
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

  function openWordModal() {
    if (generatedSheets.length === 0) {
      setStatusMessage("Carga y genera un calendario antes de generar Word.");
      return;
    }

    setWordPeriod(periodRange ? `${periodName}: ${periodRange}` : periodName);
    setWordSchoolYear(`Ciclo Escolar ${schoolYear}`);
    setWordExamStartDate(examStartDate);
    setWordOfficeYear(getOfficeYearFromDate(examStartDate));
    setWordHourStart("09:00");
    setWordHourEnd("17:00");
    setIsWordModalOpen(true);
  }

  async function importExcelForWord() {
    if (isImportingExcel || isExportingWord) return;

    const excelPath = await open({
      multiple: false,
      title: "Selecciona el Excel para generar Word",
      filters: [
        {
          name: "Excel",
          extensions: ["xlsx"],
        },
      ],
    });

    if (typeof excelPath !== "string") return;

    try {
      setIsImportingExcel(true);
      setStatusMessage("Leyendo Excel para generar Word...");
      const imported = await invoke<ImportedExcelSchedule>("import_excel_calendar", {
        excelPath,
      });
      const importedWordPeriod = imported.periodRange
        ? `${imported.periodName}: ${imported.periodRange}`
        : imported.periodName;

      setActivePeriod(null);
      setPeriodName(imported.periodName);
      setPeriodRange(imported.periodRange);
      setSchoolYear(imported.schoolYear);
      setExamStartDate(imported.examStartDate);
      setSelectedPdfPath(null);
      setGeneratedSheets(imported.sheets);
      setSelectedSheet(imported.sheets[0]?.label ?? "");
      setParsedCourseCount(imported.importedRowCount);
      setCalendarSearchQuery("");
      setCalendarSearchSelection(null);
      setWordPeriod(importedWordPeriod);
      setWordSchoolYear(`Ciclo Escolar ${imported.schoolYear}`);
      setWordExamStartDate(imported.examStartDate);
      setWordOfficeYear(getOfficeYearFromDate(imported.examStartDate));
      setWordHourStart("09:00");
      setWordHourEnd("17:00");
      setIsWordModalOpen(true);
      setStatusMessage(
        `Excel importado: ${imported.sheets.length} pestañas y ${imported.importedRowCount} materias.`,
      );
    } catch (error) {
      setStatusMessage(`No se pudo importar el Excel: ${String(error)}`);
    } finally {
      setIsImportingExcel(false);
    }
  }

  async function exportCurrentWord() {
    if (isExportingWord) return;

    if (generatedSheets.length === 0) {
      setStatusMessage("Carga y genera un calendario antes de generar Word.");
      return;
    }

    const folio = Number.parseInt(wordStartFolio, 10);
    if (Number.isNaN(folio) || folio < 1) {
      setStatusMessage("El folio inicial debe ser un número mayor a cero.");
      return;
    }

    const outputPath = await saveFile({
      defaultPath: buildWordDefaultFileName(wordOfficeYear, folio, generatedSheets),
      title: "Guardar documento Word",
      filters: [
        {
          name: "Word",
          extensions: ["docx"],
        },
      ],
    });

    if (!outputPath) return;

    try {
      setIsExportingWord(true);
      setStatusMessage("Generando documentos Word...");
      await invoke("export_word", {
        payload: {
          wordPeriod,
          wordSchoolYear,
          officeYear: wordOfficeYear,
          startFolio: folio,
          officeDate: wordOfficeDate,
          examStartDate: wordExamStartDate,
          hourStart: wordHourStart,
          hourEnd: wordHourEnd,
          coordinatorName: generalConfig.coordinatorName,
          signaturePath: generalConfig.signaturePath,
          sealPath: generalConfig.sealPath,
          teacherTitles: {},
          sheets: generatedSheets,
        },
        outputPath,
      });
      setIsWordModalOpen(false);
      setStatusMessage("Documentos Word generados correctamente");
    } catch (error) {
      setStatusMessage(`No se pudo generar Word: ${String(error)}`);
    } finally {
      setIsExportingWord(false);
    }
  }

  function startOverSession() {
    resetWorkArea();
    setIsPeriodsOpen(false);
    setIsStartDateOpen(false);
    setIsWordModalOpen(false);
    setIsTeacherDirectoryOpen(false);
    setIsAboutOpen(false);
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
        setActivePeriod(null);
        applySmartDefaultsForPdf();
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
      const previousTeacherKeys = new Set(
        teacherDirectory.map((teacher) => teacher.teacherKey),
      );
      const syncedDirectory = await invoke<TeacherRecord[]>("sync_teacher_directory", {
        teachers: parsedSchedule.courses.map((course) => course.teacher),
      });
      const sortedDirectory = sortTeacherDirectory(syncedDirectory);
      const detectedNewTeacherKeys = sortedDirectory
        .filter((teacher) => !previousTeacherKeys.has(teacher.teacherKey))
        .map((teacher) => teacher.teacherKey);
      setTeacherDirectory(sortedDirectory);
      setTeacherDirectoryDraft(sortedDirectory);
      setNewTeacherKeys(detectedNewTeacherKeys);

      const titledSchedule = {
        ...parsedSchedule,
        courses: applyTeacherDirectoryToCourses(parsedSchedule.courses, sortedDirectory),
      };
      const sheets = buildSheetsFromSchedule(titledSchedule, examStartDate);

      setGeneratedSheets(sheets);
      setSelectedSheet(sheets[0]?.label ?? "");
      setParsedCourseCount(parsedSchedule.courses.length);
      setIsStartDateOpen(false);
      setStatusMessage(
        detectedNewTeacherKeys.length
          ? `PDF procesado: ${parsedSchedule.courses.length} materias detectadas. ${detectedNewTeacherKeys.length} maestro(s) nuevo(s) en el directorio.`
          : `PDF procesado: ${parsedSchedule.courses.length} materias detectadas`,
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
                currentRowIndex === rowIndex
                  ? {
                      ...row,
                      [field]: value,
                      ...(field === "teacher"
                        ? { teacherKey: normalizeTeacherKey(value) }
                        : {}),
                    }
                  : row,
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
      return "bg-accent/20 opacity-45 shadow-sm scale-[0.995]";
    }

    if (!isSameTable || !dropTarget || dropTarget.rowIndex === draggedRow.rowIndex) {
      return "";
    }

    if (rowIndex === dropTarget.rowIndex) {
      return "bg-muted ring-1 ring-primary/20";
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

  function toggleCalendarSearchSort(key: CalendarSearchSortKey) {
    setCalendarSearchSort((currentSort) =>
      currentSort.key === key
        ? {
            key,
            direction: currentSort.direction === "asc" ? "desc" : "asc",
          }
        : { key, direction: "asc" },
    );
  }

  function renderCalendarSearchHead(
    key: CalendarSearchSortKey,
    label: string,
    className: string,
  ) {
    const isActive = calendarSearchSort.key === key;
    const SortIcon = !isActive
      ? ArrowUpDown
      : calendarSearchSort.direction === "asc"
        ? ArrowUp
        : ArrowDown;

    return (
      <TableHead className={className}>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 text-left font-semibold text-primary transition-colors hover:text-primary/80"
          onClick={() => toggleCalendarSearchSort(key)}
        >
          <span>{label}</span>
          <SortIcon className="size-3.5 shrink-0" />
        </button>
      </TableHead>
    );
  }

  function toggleThemeMode() {
    setThemeMode((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
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
  // Mantener en false: la importación de Excel a Word queda lista para reactivarse si se necesita.
  const showExcelWordImport = false;
  const newTeacherCount = newTeacherKeys.length;
  const generatedBlockCount = generatedSheets.reduce(
    (total, sheet) => total + sheet.blocks.length,
    0,
  );
  const calendarSearchSuggestions = getCalendarSearchSuggestions(
    generatedSheets,
    calendarSearchQuery,
  );
  const calendarSearchResults = sortCalendarSearchResults(
    getCalendarSearchResults(generatedSheets, calendarSearchSelection),
    calendarSearchSelection,
    calendarSearchSort,
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#d9e6f7,transparent_32%),radial-gradient(circle_at_top_right,#f6e2a4,transparent_26%),linear-gradient(180deg,#f7f9fd_0%,#edf3fb_100%)] text-foreground dark:bg-[radial-gradient(circle_at_top_left,rgba(59,89,133,0.42),transparent_32%),radial-gradient(circle_at_top_right,rgba(240,199,90,0.18),transparent_26%),linear-gradient(180deg,#0f1724_0%,#131d2c_100%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-5 px-5 py-5">
        <header className="flex flex-col gap-4 border-b border-border/80 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-foreground">
              Generador de calendarios ordinarios
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                role="switch"
                aria-checked={themeMode === "dark"}
                aria-label="Cambiar tema oscuro"
                onClick={toggleThemeMode}
                className="h-8 gap-2 px-2"
              >
                {themeMode === "dark" ? <Sun /> : <Moon />}
                <span
                  aria-hidden="true"
                  className={`relative h-5 w-9 rounded-full border transition-colors ${
                    themeMode === "dark"
                      ? "border-primary bg-primary"
                      : "border-input bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-card shadow-sm transition-[left] ${
                      themeMode === "dark" ? "left-[18px]" : "left-[3px]"
                    }`}
                  />
                </span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Config general"
                onClick={openGeneralConfig}
              >
                <Settings />
              </Button>
              <Button variant="outline" onClick={startOverSession}>
                <Plus />
                Empezar de nuevo
              </Button>
            </div>
            <div className="flex items-center border-l border-border pl-3">
              <Button
                variant="outline"
                size="icon"
                aria-label="Acerca de"
                onClick={() => setIsAboutOpen(true)}
              >
                <Info />
              </Button>
            </div>
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
                  <CardTitle className="text-2xl">{generatedBlockCount}</CardTitle>
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
                    <div
                      ref={calendarSearchRef}
                      className="relative min-w-0 flex-1 sm:w-80 sm:flex-none"
                    >
                      <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
                      <Input
                        className="pl-8"
                        placeholder="Buscar profesor o materia"
                        value={calendarSearchQuery}
                        onChange={(event) => {
                          setCalendarSearchQuery(event.currentTarget.value);
                          setIsCalendarSearchOpen(true);
                        }}
                        onFocus={() => setIsCalendarSearchOpen(true)}
                      />
                      {isCalendarSearchOpen && calendarSearchQuery.trim() ? (
                        <div className="absolute right-0 top-11 z-50 max-h-96 w-full overflow-hidden rounded-lg border border-border bg-card shadow-xl ring-1 ring-primary/10 sm:w-[28rem]">
                          {calendarSearchSuggestions.length ? (
                            <ScrollArea className="max-h-96">
                              <div className="p-1">
                                {calendarSearchSuggestions.map((suggestion) => (
                                  <button
                                    key={`${suggestion.kind}-${suggestion.value}`}
                                    type="button"
                                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted hover:text-primary"
                                    onClick={() => {
                                      setCalendarSearchSelection({
                                        kind: suggestion.kind,
                                        value: suggestion.value,
                                      });
                                      setCalendarSearchSort({ key: "name", direction: "asc" });
                                      setCalendarSearchQuery(suggestion.value);
                                      setIsCalendarSearchOpen(false);
                                    }}
                                  >
                                    <span className="min-w-0 whitespace-normal break-words leading-snug">
                                      {suggestion.value}
                                    </span>
                                    <span className="flex shrink-0 items-center gap-2 pt-0.5">
                                      <Badge variant="outline" className="whitespace-nowrap">
                                        {suggestion.kind === "teacher" ? "Maestro" : "Materia"}
                                      </Badge>
                                      <span className="min-w-5 text-right text-xs text-muted-foreground">
                                        {suggestion.count}
                                      </span>
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </ScrollArea>
                          ) : (
                            <div className="px-3 py-3 text-sm text-muted-foreground">
                              Sin coincidencias
                            </div>
                          )}
                        </div>
                      ) : null}
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
                      <div className="mb-4 overflow-x-auto rounded-lg border border-border bg-muted p-1.5">
                        <TabsList className="h-10 min-w-max justify-start gap-1.5 bg-transparent p-0">
                          {generatedSheets.map((sheet) => (
                            <TabsTrigger
                              key={sheet.label}
                              value={sheet.label}
                              className="relative h-8 flex-none border border-transparent bg-card/80 px-3 text-xs font-semibold text-muted-foreground shadow-none transition-all hover:border-primary/30 hover:bg-card hover:text-primary data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:!text-primary-foreground data-[state=active]:shadow-md data-[state=active]:ring-2 data-[state=active]:ring-accent/45 data-[state=active]:after:absolute data-[state=active]:after:inset-x-3 data-[state=active]:after:-bottom-1.5 data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-accent data-active:border-primary data-active:bg-primary data-active:!text-primary-foreground data-active:shadow-md dark:data-[state=active]:!text-primary-foreground dark:data-active:!text-primary-foreground"
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
                          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/45 p-3 md:flex-row md:items-center md:justify-between">
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
                                <div className="border-b border-border/70 bg-muted/45 p-3">
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
                                        className="border-accent/70 bg-accent/20 text-accent-foreground dark:bg-accent/25"
                                      >
                                        {block.turn}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                                <div className="p-3">
                                  <div className="overflow-hidden rounded-lg border border-border">
                                    <Table>
                                      <TableHeader className="bg-muted">
                                        <TableRow className="hover:bg-muted">
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
                                          <TableHead className="w-24 px-3 text-center text-primary">
                                            Plan
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
                                            className={`transition-[background-color,box-shadow,opacity,transform] duration-150 ease-out will-change-transform hover:bg-accent/15 ${getRowDragClass(
                                              sheet.label,
                                              blockIndex,
                                              rowIndex,
                                            )}`}
                                          >
                                            <TableCell className="px-3 py-2">
                                              <div className="flex min-w-48 items-center gap-2">
                                                <TimeInput
                                                  aria-label="Hora inicial"
                                                  value={getTimeStart(row.time)}
                                                  onChange={(value) =>
                                                    updateRowTime(
                                                      sheet.label,
                                                      blockIndex,
                                                      rowIndex,
                                                      "start",
                                                      value,
                                                    )
                                                  }
                                                  className="h-8 w-24"
                                                />
                                                <span className="text-xs text-muted-foreground">
                                                  a
                                                </span>
                                                <TimeInput
                                                  aria-label="Hora final"
                                                  value={getTimeEnd(row.time)}
                                                  onChange={(value) =>
                                                    updateRowTime(
                                                      sheet.label,
                                                      blockIndex,
                                                      rowIndex,
                                                      "end",
                                                      value,
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
                                              <Input
                                                value={row.plan ?? ""}
                                                onChange={(event) =>
                                                  updateRow(
                                                    sheet.label,
                                                    blockIndex,
                                                    rowIndex,
                                                    "plan",
                                                    event.currentTarget.value,
                                                  )
                                                }
                                                className="h-8 text-center"
                                              />
                                            </TableCell>
                                            <TableCell className="px-3 py-2">
                                              <button
                                                type="button"
                                                className="mx-auto flex size-8 cursor-grab touch-none select-none items-center justify-center rounded-md border border-input bg-card text-primary transition-colors hover:bg-muted active:cursor-grabbing"
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
                                              colSpan={6}
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
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={openWordModal}
                    disabled={isExportingWord}
                  >
                    {isExportingWord ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <FileText />
                    )}
                    {isExportingWord ? "Generando..." : "Generar Formato Word"}
                  </Button>
                  {showExcelWordImport ? (
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      onClick={importExcelForWord}
                      disabled={isImportingExcel || isExportingWord}
                    >
                      {isImportingExcel ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Upload />
                      )}
                      {isImportingExcel ? "Leyendo Excel..." : "Word desde Excel"}
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {!hasGeneratedCalendar && showExcelWordImport ? (
              <Button
                variant="outline"
                className="h-11 justify-start"
                onClick={importExcelForWord}
                disabled={isImportingExcel || isExportingWord}
              >
                {isImportingExcel ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Upload />
                )}
                {isImportingExcel ? "Leyendo Excel..." : "Generar Word desde Excel"}
              </Button>
            ) : null}

            <Button
              variant="outline"
              className="h-11 justify-start"
              onClick={openTeacherDirectory}
            >
              <Users />
              Directorio de maestros
              {newTeacherCount > 0 ? (
                <Badge className="ml-auto border-primary/25 bg-primary/10 text-primary hover:bg-primary/10">
                  {newTeacherCount} nuevo(s)
                </Badge>
              ) : null}
              <Badge variant="secondary" className={newTeacherCount > 0 ? "" : "ml-auto"}>
                {teacherDirectory.length}
              </Badge>
            </Button>

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

      {isAboutOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-5"
          onPointerDown={(event) =>
            closeOnBackdropPointerDown(event, () => setIsAboutOpen(false))
          }
        >
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Acerca de
                </h2>
                <p className="text-sm text-muted-foreground">
                  Información del proyecto y referencias para mantenimiento.
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Cerrar acerca de"
                onClick={() => setIsAboutOpen(false)}
              >
                <X />
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1 overflow-hidden">
              <div className="space-y-5 p-5 text-sm">
                <section className="space-y-2">
                  <h3 className="font-semibold text-foreground">
                    Generador de Formatos
                  </h3>
                  <p className="text-muted-foreground">
                    Aplicación de escritorio para generar calendarios de exámenes
                    ordinarios en Excel y oficios Word a partir de horarios PDF.
                  </p>
                </section>

                <section className="grid gap-3 rounded-lg border border-border bg-muted/35 p-4">
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Realizado por
                    </div>
                    <div className="mt-1 font-medium text-foreground">
                      Francisco Castro - LISI
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Repositorio
                    </div>
                    <div className="mt-1 break-words text-primary">
                      github.com/Frankz1997/AppMonroy.git
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="font-semibold text-foreground">
                    Para continuar el proyecto
                  </h3>
                  <div className="grid gap-2 text-muted-foreground">
                    <p>Las plantillas principales están en la raíz del proyecto.</p>
                    <p>Los exportadores se encuentran en src-tauri/scripts/.</p>
                    <p>La información local se guarda en SQLite desde la app.</p>
                    <p>La interfaz principal está concentrada en src/App.tsx.</p>
                  </div>
                </section>
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-2 border-t border-border p-5">
              <Button variant="outline" onClick={() => setIsAboutOpen(false)}>
                Cerrar
              </Button>
              <Button
                onClick={async () => {
                  try {
                    await openUrl("https://github.com/Frankz1997/AppMonroy.git");
                  } catch (error) {
                    setStatusMessage(`No se pudo abrir el repositorio: ${String(error)}`);
                  }
                }}
              >
                Abrir repositorio
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isGeneralConfigOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-5"
          onPointerDown={(event) =>
            closeOnBackdropPointerDown(event, () => setIsGeneralConfigOpen(false))
          }
        >
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Configuración general
                </h2>
                <p className="text-sm text-muted-foreground">
                  Datos usados al generar los formatos Word.
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Cerrar configuración general"
                onClick={() => setIsGeneralConfigOpen(false)}
              >
                <X />
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1 overflow-hidden">
              <div className="space-y-5 p-5">
                <div className="space-y-2">
                  <Label htmlFor="coordinator-name">Nombre del coordinador</Label>
                  <Input
                    id="coordinator-name"
                    value={generalConfigDraft.coordinatorName}
                    onChange={(event) => {
                      const nextCoordinatorName = event.currentTarget.value;
                      setGeneralConfigDraft((currentConfig) => ({
                        ...currentConfig,
                        coordinatorName: nextCoordinatorName,
                      }));
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signature-path">Firma</Label>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                    <Input
                      id="signature-path"
                      value={generalConfigDraft.signaturePath}
                      readOnly
                      placeholder="Sin firma seleccionada"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => selectGeneralConfigImage("signaturePath")}
                    >
                      Seleccionar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setGeneralConfigDraft((currentConfig) => ({
                          ...currentConfig,
                          signaturePath: "",
                        }))
                      }
                    >
                      Quitar
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="seal-path">Sello</Label>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                    <Input
                      id="seal-path"
                      value={generalConfigDraft.sealPath}
                      readOnly
                      placeholder="Sin sello seleccionado"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => selectGeneralConfigImage("sealPath")}
                    >
                      Seleccionar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setGeneralConfigDraft((currentConfig) => ({
                          ...currentConfig,
                          sealPath: "",
                        }))
                      }
                    >
                      Quitar
                    </Button>
                  </div>
                </div>
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-2 border-t border-border p-5">
              <Button variant="outline" onClick={() => setIsGeneralConfigOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={saveGeneralConfig}>
                Guardar configuración
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isTeacherDirectoryOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-5"
          onPointerDown={(event) =>
            closeOnBackdropPointerDown(event, () => setIsTeacherDirectoryOpen(false))
          }
        >
          <div className="flex h-[88vh] max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Directorio de maestros
                </h2>
                <p className="text-sm text-muted-foreground">
                  Edita el título y el nombre que se usará en tablas, Excel y Word.
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Cerrar directorio de maestros"
                onClick={() => setIsTeacherDirectoryOpen(false)}
              >
                <X />
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1 overflow-hidden">
              <div className="p-5">
                <div className="overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableHeader className="bg-muted">
                      <TableRow className="hover:bg-muted">
                        <TableHead className="min-w-64 px-3 text-primary">
                          Nombre detectado
                        </TableHead>
                        <TableHead className="w-36 px-3 text-primary">Título</TableHead>
                        <TableHead className="min-w-72 px-3 text-primary">
                          Nombre en documentos
                        </TableHead>
                        <TableHead className="w-28 px-3 text-center text-primary">
                          Acciones
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teacherDirectoryDraft.map((teacher, teacherIndex) => (
                        <TableRow key={teacher.teacherKey} className="hover:bg-accent/15">
                          <TableCell className="px-3 py-2 text-sm text-muted-foreground">
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{teacher.sourceName}</span>
                              {newTeacherKeys.includes(teacher.teacherKey) ? (
                                <Badge className="border-primary/25 bg-primary/10 text-primary hover:bg-primary/10">
                                  Nuevo
                                </Badge>
                              ) : null}
                              {!teacherHasTitle(teacher) ? (
                                <Badge variant="outline">Sin título</Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            <Input
                              aria-label={`Título de ${teacher.sourceName}`}
                              value={teacher.title}
                              onChange={(event) => {
                                const nextTitle = event.currentTarget.value;
                                setTeacherDirectoryDraft((currentDirectory) =>
                                  currentDirectory.map((currentTeacher, currentIndex) =>
                                    currentIndex === teacherIndex
                                      ? { ...currentTeacher, title: nextTitle }
                                      : currentTeacher,
                                  ),
                                );
                              }}
                              placeholder="LIC., Dr."
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            <Input
                              aria-label={`Nombre editable de ${teacher.sourceName}`}
                              value={teacher.displayName}
                              onChange={(event) => {
                                const nextDisplayName = event.currentTarget.value;
                                setTeacherDirectoryDraft((currentDirectory) =>
                                  currentDirectory.map((currentTeacher, currentIndex) =>
                                    currentIndex === teacherIndex
                                      ? { ...currentTeacher, displayName: nextDisplayName }
                                      : currentTeacher,
                                  ),
                                );
                              }}
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell className="px-3 py-2 text-center">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() =>
                                setTeacherDirectoryDraft((currentDirectory) =>
                                  currentDirectory.filter(
                                    (currentTeacher) =>
                                      currentTeacher.teacherKey !== teacher.teacherKey,
                                  ),
                                )
                              }
                            >
                              <Trash2 />
                              Eliminar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {teacherDirectoryDraft.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="h-24 text-center text-sm text-muted-foreground"
                          >
                            Aún no hay maestros guardados. Se agregarán al cargar un PDF.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-2 border-t border-border p-5">
              <Button
                variant="outline"
                onClick={() => setIsTeacherDirectoryOpen(false)}
              >
                Cancelar
              </Button>
              <Button onClick={saveTeacherDirectory}>
                Guardar directorio
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {calendarSearchSelection ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-5"
          onPointerDown={(event) =>
            closeOnBackdropPointerDown(event, () => setCalendarSearchSelection(null))
          }
        >
          <div className="flex h-[88vh] max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {calendarSearchSelection.kind === "teacher"
                    ? calendarSearchSelection.value
                    : calendarSearchSelection.value}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {calendarSearchSelection.kind === "teacher"
                    ? "Materias relacionadas con este maestro"
                    : "Maestros relacionados con esta materia"}
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Cerrar resultados"
                onClick={() => setCalendarSearchSelection(null)}
              >
                <X />
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1 overflow-hidden">
              <div className="p-5">
                <div className="overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableHeader className="bg-muted">
                      <TableRow className="hover:bg-muted">
                        {renderCalendarSearchHead(
                          "name",
                          calendarSearchSelection.kind === "teacher" ? "Materia" : "Maestro",
                          "min-w-56 px-3 text-primary",
                        )}
                        {renderCalendarSearchHead(
                          "career",
                          "Carrera",
                          "w-28 px-3 text-primary",
                        )}
                        {renderCalendarSearchHead(
                          "group",
                          "Grupo",
                          "w-32 px-3 text-primary",
                        )}
                        {renderCalendarSearchHead(
                          "plan",
                          "Plan",
                          "w-24 px-3 text-primary",
                        )}
                        {renderCalendarSearchHead(
                          "date",
                          "Fecha",
                          "min-w-48 px-3 text-primary",
                        )}
                        {renderCalendarSearchHead(
                          "time",
                          "Hora",
                          "w-36 px-3 text-primary",
                        )}
                        {renderCalendarSearchHead(
                          "sheet",
                          "Hoja",
                          "min-w-44 px-3 text-primary",
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {calendarSearchResults.map((result, index) => (
                        <TableRow
                          key={`${result.sheetLabel}-${result.subject}-${result.teacher}-${index}`}
                          className="hover:bg-accent/15"
                        >
                          <TableCell className="px-3 py-2 font-medium text-foreground">
                            {calendarSearchSelection.kind === "teacher"
                              ? result.subject
                              : result.teacher}
                          </TableCell>
                          <TableCell className="px-3 py-2">{result.career}</TableCell>
                          <TableCell className="px-3 py-2">{result.group}</TableCell>
                          <TableCell className="px-3 py-2">{result.plan ?? ""}</TableCell>
                          <TableCell className="px-3 py-2">
                            <div className="font-medium text-foreground">{result.day}</div>
                            <div className="text-xs text-muted-foreground">{result.date}</div>
                          </TableCell>
                          <TableCell className="px-3 py-2">{result.time}</TableCell>
                          <TableCell className="px-3 py-2 text-sm text-muted-foreground">
                            {result.sheetLabel}
                          </TableCell>
                        </TableRow>
                      ))}
                      {calendarSearchResults.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="h-24 text-center text-sm text-muted-foreground"
                          >
                            No hay resultados relacionados.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-2 border-t border-border p-5">
              <Button variant="outline" onClick={() => setCalendarSearchSelection(null)}>
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isPeriodsOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-5"
          onPointerDown={(event) =>
            closeOnBackdropPointerDown(event, () => setIsPeriodsOpen(false))
          }
        >
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
                    className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted"
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
                                ? "border-primary/25 bg-primary/10 text-primary"
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-5"
          onPointerDown={(event) =>
            closeOnBackdropPointerDown(event, () => setPeriodToDelete(null))
          }
        >
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-5"
          onPointerDown={(event) =>
            closeOnBackdropPointerDown(event, () => {
              if (!isParsingPdf) {
                setIsStartDateOpen(false);
              }
            })
          }
        >
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
                    onChange={updatePeriodName}
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
                    onChange={(event) => updateSchoolYear(event.currentTarget.value)}
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

      {isWordModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-5"
          onPointerDown={(event) =>
            closeOnBackdropPointerDown(event, () => {
              if (!isExportingWord) {
                setIsWordModalOpen(false);
              }
            })
          }
        >
          <div className="flex h-[90vh] max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Generar Formato Word
                </h2>
                <p className="text-sm text-muted-foreground">
                  Completa los datos del oficio antes de crear un documento por maestro.
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Cerrar formato Word"
                disabled={isExportingWord}
                onClick={() => setIsWordModalOpen(false)}
              >
                <X />
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1 overflow-hidden">
              <div className="space-y-6 p-5">
                <section className="grid gap-4 md:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="word-office-year">Año de oficio</Label>
                    <Input
                      id="word-office-year"
                      value={wordOfficeYear}
                      onChange={(event) => setWordOfficeYear(event.currentTarget.value)}
                      placeholder="26"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="word-start-folio">Folio inicial</Label>
                    <Input
                      id="word-start-folio"
                      type="number"
                      min="1"
                      value={wordStartFolio}
                      onChange={(event) => setWordStartFolio(event.currentTarget.value)}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="word-office-date">Fecha del oficio</Label>
                    <DateSelector
                      id="word-office-date"
                      value={wordOfficeDate}
                      onChange={setWordOfficeDate}
                    />
                  </div>
                </section>

                <section className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="word-period">Periodo</Label>
                    <Input
                      id="word-period"
                      value={wordPeriod}
                      onChange={(event) => setWordPeriod(event.currentTarget.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="word-school-year">Ciclo escolar</Label>
                    <Input
                      id="word-school-year"
                      value={wordSchoolYear}
                      onChange={(event) => setWordSchoolYear(event.currentTarget.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="word-exam-start-date">Fecha inicial de exámenes</Label>
                    <DateSelector
                      id="word-exam-start-date"
                      value={wordExamStartDate}
                      onChange={setWordExamStartDate}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="word-hour-start">Hora inicio matutino</Label>
                      <TimeInput
                        id="word-hour-start"
                        value={wordHourStart}
                        onChange={setWordHourStart}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="word-hour-end">Hora inicio vespertino</Label>
                      <TimeInput
                        id="word-hour-end"
                        value={wordHourEnd}
                        onChange={setWordHourEnd}
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-lg border border-border bg-muted/45 p-4 text-sm text-muted-foreground">
                  Los nombres de maestros y materias se usarán como aparecen en el calendario cargado.
                </section>
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-2 border-t border-border p-5">
              <Button
                variant="outline"
                disabled={isExportingWord}
                onClick={() => setIsWordModalOpen(false)}
              >
                Cancelar
              </Button>
              <Button onClick={exportCurrentWord} disabled={isExportingWord}>
                {isExportingWord ? <LoaderCircle className="animate-spin" /> : <FileText />}
                {isExportingWord ? "Generando..." : "Generar documentos"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isParsingPdf ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-950/35 p-5">
          <div className="flex w-full max-w-sm items-center gap-4 rounded-lg border border-border bg-card p-5 shadow-2xl">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-accent/70 bg-accent/20 text-primary">
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

      {isImportingExcel ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-950/35 p-5">
          <div className="flex w-full max-w-sm items-center gap-4 rounded-lg border border-border bg-card p-5 shadow-2xl">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-accent/70 bg-accent/20 text-primary">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Leyendo Excel
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                La app está reconstruyendo las pestañas para generar el Word.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {isExporting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-5">
          <div className="flex w-full max-w-sm items-center gap-4 rounded-lg border border-border bg-card p-5 shadow-2xl">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-accent/70 bg-accent/20 text-primary">
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
          <div className="grid grid-cols-[210px_minmax(220px,1fr)_minmax(180px,0.8fr)_112px_80px] items-center gap-0 bg-accent/20 text-sm">
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

type TimeInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
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
    <div className="flex min-h-[480px] w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/45 p-8 text-center">
      <div className="flex max-w-md flex-col items-center">
        <div className="flex size-12 items-center justify-center rounded-lg border border-accent/70 bg-accent/20 text-primary">
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

function TimeInput({
  id,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: TimeInputProps) {
  return (
    <Input
      id={id}
      value={value}
      inputMode="numeric"
      maxLength={5}
      placeholder="HH:MM"
      className={className}
      aria-label={ariaLabel}
      onChange={(event) => onChange(normalizeTimeInput(event.currentTarget.value))}
      onBlur={(event) => onChange(formatTimeInput(event.currentTarget.value))}
    />
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
                    : "text-foreground hover:bg-muted hover:text-primary"
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
  const dateSelectorRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!dateSelectorRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <div ref={dateSelectorRef} className="relative">
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
