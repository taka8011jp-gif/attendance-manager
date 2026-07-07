"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type PayType = "hourly" | "monthly";
type StaffRole = "管理者" | "社員" | "業務委託社員" | "アルバイト";

type Employee = {
  id: string;
  name: string;
  role: StaffRole;
  staffCode: string;
  payType: PayType;
  payAmount: number;
  hourlyWage?: number;
};

type StoredEmployee = Partial<Employee> & {
  id: string;
  name?: string;
  role?: string;
};

type WorkStatus = "registered" | "working" | "missing" | "off";
type PunchType = "start" | "end";

type Punch = {
  id: string;
  type: PunchType;
  at: string;
};

type WorkDayRecord = {
  id: string;
  employeeId: string;
  workDate: string;
  totalMinutes: number;
  nightMinutes: number;
  breakMinutes: number;
  payTypeSnapshot?: PayType;
  payAmountSnapshot?: number;
  payRoleSnapshot?: StaffRole;
  activeStartedAt: string | null;
  status: WorkStatus;
  punches: Punch[];
};

type ManualPunchDraft = {
  id: string;
  type: PunchType;
  time: string;
};

type ManualDraft = {
  punches: ManualPunchDraft[];
};

type StoredWorkDayRecord = Partial<WorkDayRecord> & {
  id: string;
  employeeId: string;
  workDate?: string;
  date?: string;
  clockIn?: string;
  clockOut?: string;
  breakMinutes?: number;
  manualBreakMinutes?: number;
  breaks?: Array<{ start: string; end: string }>;
};

type AttendanceStore = {
  employees: Employee[];
  records: WorkDayRecord[];
};

type SharedStoreSnapshot = {
  employees: Employee[];
  records: WorkDayRecord[];
};

type AdminView = "menu" | "members" | "add-member" | "manual" | "records" | "summary";
type StaffPanel = "" | "today-edit" | "work-detail" | "pay-detail";

const DEFAULT_ADMIN_CODE = "0622";
const DEVELOPER_CODE = "19788011";
const SYNC_INTERVAL_MS = 5000;
const staffRoles: StaffRole[] = ["管理者", "社員", "業務委託社員", "アルバイト"];

const seedEmployees: Employee[] = [
  { id: "emp-manager", name: "店長", role: "管理者", staffCode: DEFAULT_ADMIN_CODE, payType: "monthly", payAmount: 0 },
  { id: "emp-staff-a", name: "佐藤", role: "アルバイト", staffCode: "1001", payType: "hourly", payAmount: 1200 },
  { id: "emp-staff-b", name: "鈴木", role: "アルバイト", staffCode: "1002", payType: "hourly", payAmount: 1200 }
];

const adminMenu: Array<{ id: AdminView; label: string }> = [
  { id: "members", label: "メンバー管理" },
  { id: "manual", label: "手入力・修正" },
  { id: "records", label: "勤怠記録・月次" }
];

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function dateKey(date: Date) {
  return date.toLocaleDateString("sv-SE");
}

function businessDate(date: Date) {
  const workDate = new Date(date);
  if (workDate.getHours() < 7) workDate.setDate(workDate.getDate() - 1);
  return dateKey(workDate);
}

function currentMonth() {
  return businessDate(new Date()).slice(0, 7);
}

function localDateTime(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function businessStart(workDate: string) {
  return new Date(`${workDate}T07:00:00`);
}

function businessEnd(workDate: string) {
  const end = businessStart(workDate);
  end.setDate(end.getDate() + 1);
  return end;
}

function parseLocalDateTime(value: string) {
  return new Date(value);
}

function minutesFromTime(value: string) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function intervalMinutes(start: Date, end: Date) {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
}

function overlapMinutes(start: Date, end: Date, rangeStart: Date, rangeEnd: Date) {
  const actualStart = Math.max(start.getTime(), rangeStart.getTime());
  const actualEnd = Math.min(end.getTime(), rangeEnd.getTime());
  return Math.max(0, Math.floor((actualEnd - actualStart) / 60000));
}

function nightMinutesBetween(start: Date, end: Date) {
  if (end <= start) return 0;
  let total = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 1);

  while (cursor <= end) {
    const nightStart = new Date(cursor);
    nightStart.setHours(22, 0, 0, 0);
    const nightEnd = new Date(cursor);
    nightEnd.setDate(nightEnd.getDate() + 1);
    nightEnd.setHours(5, 0, 0, 0);
    total += overlapMinutes(start, end, nightStart, nightEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  return total;
}

function minutesFromHours(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 60) : 0;
}

function hoursFromMinutes(minutes: number) {
  return String(Math.round((minutes / 60) * 100) / 100);
}

function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}時間${String(minutes).padStart(2, "0")}分`;
}

function formatTimeOnly(value: string) {
  if (!value) return "-";
  return value.slice(11, 16);
}

function minutesToTimeInput(totalMinutes: number) {
  const hours = Math.floor(Math.max(0, totalMinutes) / 60);
  const minutes = Math.max(0, totalMinutes) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeInputToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return Math.max(0, hours * 60 + minutes);
}

function combineWorkDateAndTime(workDate: string, time: string, isEnd = false) {
  const [hours, minutes] = time.split(":").map(Number);
  const date = businessStart(workDate);
  date.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  if (Number.isFinite(hours) && hours < 7) {
    date.setDate(date.getDate() + 1);
  } else if (isEnd && date <= businessStart(workDate)) {
    date.setDate(date.getDate() + 1);
  }
  return localDateTime(date);
}

function sortedPunches(record?: WorkDayRecord) {
  return [...(record?.punches ?? [])].sort((a, b) => a.at.localeCompare(b.at));
}

function firstStartAt(record?: WorkDayRecord) {
  return sortedPunches(record).find((punch) => punch.type === "start")?.at ?? "";
}

function lastEndAt(record?: WorkDayRecord) {
  return [...sortedPunches(record)].reverse().find((punch) => punch.type === "end")?.at ?? "";
}

function isUnregisteredRecord(record?: WorkDayRecord | null) {
  if (!record || record.status === "off") return false;
  if (record.status === "missing") return true;
  if (record.status === "working") return false;
  const lastPunch = sortedPunches(record).at(-1);
  return lastPunch?.type === "start";
}

function hasOpenFinalPunch(record?: WorkDayRecord | null) {
  if (!record || record.status === "off") return false;
  return sortedPunches(record).at(-1)?.type === "start";
}

function startDisplay(record: WorkDayRecord) {
  if (record.status === "off") return "休み";
  return formatTimeOnly(firstStartAt(record));
}

function endDisplay(record: WorkDayRecord) {
  if (record.status === "off") return "休み";
  if (isUnregisteredRecord(record)) return "未登録";
  return formatTimeOnly(lastEndAt(record));
}

function breakMinutesFromPunches(punches: Punch[]) {
  const sorted = [...punches].sort((a, b) => a.at.localeCompare(b.at));
  let total = 0;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    if (current.type === "end" && next.type === "start") {
      total += intervalMinutes(parseLocalDateTime(current.at), parseLocalDateTime(next.at));
    }
  }
  return Math.max(0, total);
}

function workMinutesFromPunches(punches: Punch[]) {
  const sorted = [...punches].sort((a, b) => a.at.localeCompare(b.at));
  let total = 0;
  let activeStart = "";
  sorted.forEach((punch) => {
    if (punch.type === "start") {
      activeStart = punch.at;
      return;
    }
    if (activeStart) {
      total += intervalMinutes(parseLocalDateTime(activeStart), parseLocalDateTime(punch.at));
      activeStart = "";
    }
  });
  return Math.max(0, total);
}

function nightMinutesFromPunches(punches: Punch[]) {
  const sorted = [...punches].sort((a, b) => a.at.localeCompare(b.at));
  let total = 0;
  let activeStart = "";
  sorted.forEach((punch) => {
    if (punch.type === "start") {
      activeStart = punch.at;
      return;
    }
    if (activeStart) {
      total += nightMinutesBetween(parseLocalDateTime(activeStart), parseLocalDateTime(punch.at));
      activeStart = "";
    }
  });
  return Math.max(0, total);
}

function calculatedBreakMinutes(record?: WorkDayRecord) {
  if (!record) return 0;
  const fromPunches = breakMinutesFromPunches(record.punches);
  if (fromPunches > 0) return fromPunches;
  if (Number.isFinite(record.breakMinutes) && record.breakMinutes > 0) return Math.floor(record.breakMinutes);
  return 0;
}

function shiftMinutesFromEndpoints(startAt: string, endAt: string) {
  const start = parseLocalDateTime(startAt);
  const end = parseLocalDateTime(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
  return intervalMinutes(start, end);
}

function actualMinutesFromDraft(startAt: string, endAt: string, breakMinutes: number) {
  return Math.max(0, shiftMinutesFromEndpoints(startAt, endAt) - breakMinutes);
}

function formatYen(value: number) {
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function isCurrentWorkMonth(workDate: string, now: Date) {
  return workDate.slice(0, 7) === businessDate(now).slice(0, 7);
}

function isPastMonthLocked(month: string, now: Date) {
  return month < businessDate(now).slice(0, 7) && now.getDate() > 10;
}

function isWorkDateLocked(workDate: string, now: Date) {
  return isPastMonthLocked(workDate.slice(0, 7), now);
}

function employeePayAmount(employee: Employee) {
  const amount = Number(employee.payAmount ?? employee.hourlyWage ?? 0);
  return Number.isFinite(amount) && amount >= 0 ? Math.floor(amount) : 0;
}

function normalizeRole(role?: string | null, fallback?: StaffRole): StaffRole {
  if (role === "管理者" || role === "社員" || role === "業務委託社員" || role === "アルバイト") return role;
  if (role === "スタッフ") return "アルバイト";
  return fallback ?? "アルバイト";
}

function isHourlyRole(role: StaffRole) {
  return role === "業務委託社員" || role === "アルバイト";
}

function rolePayType(role: StaffRole): PayType {
  return isHourlyRole(role) ? "hourly" : "monthly";
}

function showsNightBreakdown(employee?: Employee | null) {
  return employee?.role === "アルバイト";
}

function showsStaffPayCard(employee?: Employee | null) {
  return employee?.role !== "社員";
}

function payLabel(employee: Employee) {
  if (!isHourlyRole(employee.role)) return employee.role;
  return `${employee.role} 時給 ${formatYen(employeePayAmount(employee))}`;
}

function applyEmployeePatch(employee: Employee, patch: Partial<Employee>) {
  const role = normalizeRole(patch.role ?? employee.role, employee.role);
  const payAmount = isHourlyRole(role) ? Math.max(0, Math.floor(Number(patch.payAmount ?? employee.payAmount ?? 0))) : 0;
  return {
    ...employee,
    ...patch,
    role,
    staffCode: patch.staffCode === undefined ? employee.staffCode : patch.staffCode.trim(),
    payType: rolePayType(role),
    payAmount,
    hourlyWage: payAmount
  };
}

function recordPay(record: WorkDayRecord, employee: Employee, now: Date) {
  if (isCurrentWorkMonth(record.workDate, now) || record.payRoleSnapshot === undefined) {
    const role = employee.role;
    return { role, type: rolePayType(role), amount: employeePayAmount(employee) };
  }
  const role = record.payRoleSnapshot;
  return {
    role,
    type: rolePayType(role),
    amount: isHourlyRole(role) ? Math.max(0, Math.floor(Number(record.payAmountSnapshot ?? 0))) : 0
  };
}

function laborCost(record: WorkDayRecord, employee: Employee | undefined, now: Date) {
  if (!employee) return null;
  const pay = recordPay(record, employee, now);
  if (pay.type === "monthly") return null;
  const hourly = pay.amount;
  if (pay.role === "業務委託社員") return (record.totalMinutes / 60) * hourly;
  const regularMinutes = Math.max(0, record.totalMinutes - record.nightMinutes);
  return (regularMinutes / 60) * hourly + (record.nightMinutes / 60) * hourly * 1.25;
}

function monthlyPay(totalRecords: WorkDayRecord[], employee: Employee, now: Date) {
  const firstRecord = totalRecords[0];
  const pay = firstRecord ? recordPay(firstRecord, employee, now) : { role: employee.role, type: rolePayType(employee.role), amount: employeePayAmount(employee) };
  if (pay.type === "monthly") return pay.amount;
  return totalRecords.reduce((sum, record) => sum + (laborCost(record, employee, now) ?? 0), 0);
}

function normalizeEmployee(employee: StoredEmployee, index: number): Employee {
  const seed = seedEmployees[index] ?? null;
  const role = normalizeRole(employee.role, seed?.role ?? (employee.payType === "monthly" ? "社員" : "アルバイト"));
  const oldHourly = Number(employee.hourlyWage ?? seed?.payAmount ?? 1200);
  const payType = rolePayType(role);
  const rawAmount = Number(employee.payAmount ?? employee.hourlyWage ?? seed?.payAmount ?? 1200);
  const staffCode = String(employee.staffCode || seed?.staffCode || 1000 + index);
  const payAmount = Number.isFinite(rawAmount) && rawAmount >= 0 ? Math.floor(rawAmount) : Math.floor(oldHourly);

  return {
    id: employee.id,
    name: employee.name?.trim() || seed?.name || `スタッフ${index + 1}`,
    role,
    staffCode,
    payType,
    payAmount: isHourlyRole(role) ? payAmount : 0,
    hourlyWage: isHourlyRole(role) ? payAmount : 0
  };
}

function fillMissingPaySnapshots(records: WorkDayRecord[], employees: Employee[]) {
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  return records.map((record) => {
    const employee = employeeMap.get(record.employeeId);
    if (record.payTypeSnapshot !== undefined && record.payRoleSnapshot !== undefined) return record;
    if (!employee) return record;
    return {
      ...record,
      payRoleSnapshot: employee.role,
      payTypeSnapshot: rolePayType(employee.role),
      payAmountSnapshot: employeePayAmount(employee)
    };
  });
}

function oldBreakMinutes(record: StoredWorkDayRecord) {
  const storedBreaks = Array.isArray(record.breaks) ? record.breaks : [];
  const fromBreaks = storedBreaks.reduce((sum, item) => {
    const start = minutesFromTime(item.start);
    const end = minutesFromTime(item.end);
    if (start === null || end === null) return sum;
    return sum + Math.max(0, end >= start ? end - start : end + 24 * 60 - start);
  }, 0);
  return fromBreaks + Number(record.manualBreakMinutes ?? record.breakMinutes ?? 0);
}

function buildPunches(workDate: string, startAt?: string | null, endAt?: string | null): Punch[] {
  const punches: Punch[] = [];
  if (startAt) punches.push({ id: createId("punch"), type: "start", at: startAt });
  if (endAt) punches.push({ id: createId("punch"), type: "end", at: endAt });
  return punches.length > 0 ? punches : [{ id: createId("punch"), type: "start", at: `${workDate}T07:00` }];
}

function migrateLegacyRecord(record: StoredWorkDayRecord): WorkDayRecord {
  const workDate = record.workDate ?? record.date ?? businessDate(new Date());
  const startMinutes = minutesFromTime(record.clockIn ?? "");
  const endMinutes = minutesFromTime(record.clockOut ?? "");
  let totalMinutes = Number(record.totalMinutes ?? 0);
  let nightMinutes = Number(record.nightMinutes ?? 0);
  let breakMinutes = Number(record.breakMinutes ?? record.manualBreakMinutes ?? 0);
  const payAmountSnapshot = Number(record.payAmountSnapshot ?? 0);
  let status: WorkStatus = record.status ?? "registered";
  let punches: Punch[] = Array.isArray(record.punches) ? record.punches : [];

  if (!record.workDate && record.date && startMinutes !== null && endMinutes !== null) {
    const start = new Date(`${record.date}T${record.clockIn}`);
    const end = new Date(`${record.date}T${record.clockOut}`);
    if (endMinutes < startMinutes) end.setDate(end.getDate() + 1);
    totalMinutes = Math.max(0, intervalMinutes(start, end) - oldBreakMinutes(record));
    breakMinutes = oldBreakMinutes(record);
    nightMinutes = nightMinutesBetween(start, end);
    status = totalMinutes > 0 ? "registered" : "missing";
    punches = buildPunches(workDate, localDateTime(start), localDateTime(end));
  }

  if (punches.length === 0 && record.activeStartedAt) {
    punches = [{ id: createId("punch"), type: "start", at: record.activeStartedAt }];
  }

  return {
    id: record.id,
    employeeId: record.employeeId,
    workDate,
    totalMinutes: Number.isFinite(totalMinutes) ? Math.max(0, Math.floor(totalMinutes)) : 0,
    nightMinutes: Number.isFinite(nightMinutes) ? Math.max(0, Math.floor(nightMinutes)) : 0,
    breakMinutes: Number.isFinite(breakMinutes) ? Math.max(0, Math.floor(breakMinutes)) : 0,
    payTypeSnapshot: record.payTypeSnapshot === "monthly" || record.payTypeSnapshot === "hourly" ? record.payTypeSnapshot : undefined,
    payAmountSnapshot: Number.isFinite(payAmountSnapshot) && payAmountSnapshot >= 0 ? Math.floor(payAmountSnapshot) : undefined,
    payRoleSnapshot: record.payRoleSnapshot ? normalizeRole(record.payRoleSnapshot) : undefined,
    activeStartedAt: record.activeStartedAt ?? null,
    status,
    punches
  };
}

function recordWithRealtime(record: WorkDayRecord, now: Date) {
  const activeStartedAt = activeStartAtForRecord(record, now);
  if (!activeStartedAt) return record;
  const startedAt = parseLocalDateTime(activeStartedAt);
  const cappedNow = new Date(Math.min(now.getTime(), businessEnd(record.workDate).getTime()));
  return {
    ...record,
    activeStartedAt,
    status: "working" as const,
    totalMinutes: record.totalMinutes + intervalMinutes(startedAt, cappedNow),
    nightMinutes: record.nightMinutes + nightMinutesBetween(startedAt, cappedNow)
  };
}

function activeStartAtForRecord(record: WorkDayRecord | null | undefined, now: Date) {
  if (!record) return "";
  if (record.status === "working" && record.activeStartedAt) return record.activeStartedAt;
  if (record.workDate !== businessDate(now)) return "";
  const lastPunch = sortedPunches(record).at(-1);
  return lastPunch?.type === "start" ? lastPunch.at : "";
}

function closeExpiredRecords(records: WorkDayRecord[], now: Date) {
  return records.map((record) => {
    if (record.status !== "working" || !record.activeStartedAt) return record;
    if (now < businessEnd(record.workDate)) return record;
    return {
      ...record,
      activeStartedAt: null,
      status: "missing" as const
    };
  });
}

function statusLabel(status: WorkStatus) {
  if (status === "working") return "勤務中";
  if (status === "missing") return "未登録";
  if (status === "off") return "休み";
  return "登録済み";
}

function toCsvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function exportCsvFile(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows.map((row) => row.map(toCsvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function monthDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return [];
  const days: string[] = [];
  const cursor = new Date(year, monthNumber - 1, 1);
  while (cursor.getMonth() === monthNumber - 1) {
    days.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function firstPunch(record: WorkDayRecord | undefined, type: PunchType) {
  return record?.punches.find((punch) => punch.type === type)?.at ?? "";
}

function lastPunch(record: WorkDayRecord | undefined, type: PunchType) {
  return [...(record?.punches ?? [])].reverse().find((punch) => punch.type === type)?.at ?? "";
}

function defaultStartAt(workDate: string) {
  return `${workDate}T09:00`;
}

function defaultEndAt(workDate: string) {
  return `${workDate}T18:00`;
}

export default function AttendancePage() {
  const [employees, setEmployees] = useState<Employee[]>(seedEmployees);
  const [records, setRecords] = useState<WorkDayRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dataError, setDataError] = useState("");
  const [currentStaffId, setCurrentStaffId] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [now, setNow] = useState(new Date());
  const [adminMode, setAdminMode] = useState(false);
  const [adminView, setAdminView] = useState<AdminView>("menu");
  const [message, setMessage] = useState("");
  const [editingEmployeeId, setEditingEmployeeId] = useState("");
  const [newEmployeeCode, setNewEmployeeCode] = useState("");
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newRole, setNewRole] = useState<StaffRole>("アルバイト");
  const [newPayAmount, setNewPayAmount] = useState("1200");
  const [manualEmployeeId, setManualEmployeeId] = useState(seedEmployees[0].id);
  const [manualMonth, setManualMonth] = useState(currentMonth());
  const [manualDate, setManualDate] = useState(businessDate(new Date()));
  const [manualDrafts, setManualDrafts] = useState<Record<string, ManualDraft>>({});
  const [recordEmployeeId, setRecordEmployeeId] = useState("all");
  const [recordMonth, setRecordMonth] = useState(currentMonth());
  const [summaryMonth, setSummaryMonth] = useState(currentMonth());
  const [saveNotice, setSaveNotice] = useState("");
  const [staffPanel, setStaffPanel] = useState<StaffPanel>("");
  const [staffSaveNotice, setStaffSaveNotice] = useState("");
  const [isPunchSaving, setIsPunchSaving] = useState(false);
  const punchSavingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSharedStore() {
      try {
        const response = await fetch("/api/attendance", { cache: "no-store" });
        if (!response.ok) throw new Error("共有データを読み込めませんでした。");
        const store = (await response.json()) as AttendanceStore;
        if (!isMounted) return;
        const normalizedEmployees = (store.employees.length > 0 ? store.employees : seedEmployees).map(normalizeEmployee);
        const normalizedRecords = fillMissingPaySnapshots(closeExpiredRecords(store.records.map(migrateLegacyRecord), new Date()), normalizedEmployees);
        setEmployees(normalizedEmployees);
        setRecords(normalizedRecords);
        setManualEmployeeId(normalizedEmployees[0]?.id ?? seedEmployees[0].id);
        setDataError("");
      } catch {
        if (isMounted) setDataError("共有データに接続できません。Vercelの環境変数とSupabaseを確認してください。");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSharedStore();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const updateClock = () => {
      const current = new Date();
      setNow(current);
      setRecords((existing) => closeExpiredRecords(existing, current));
    };

    const timer = window.setInterval(updateClock, SYNC_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const currentStaff = employeeById.get(currentStaffId) ?? null;
  const adminStaff = employeeById.get("emp-manager") ?? null;
  const punchStaff = currentStaff ?? (adminMode ? adminStaff : null);
  const currentWorkDate = businessDate(now);
  const currentRecord = punchStaff ? records.find((record) => record.employeeId === punchStaff.id && record.workDate === currentWorkDate) : null;
  const currentRealtimeRecord = currentRecord ? recordWithRealtime(currentRecord, now) : null;
  const currentIsWorking = Boolean(activeStartAtForRecord(currentRecord, now));

  const currentMonthSummary = useMemo(() => {
    if (!punchStaff) return null;
    const staffMonthRecords = records
      .filter((record) => record.employeeId === punchStaff.id && record.workDate.startsWith(currentWorkDate.slice(0, 7)))
      .map((record) => recordWithRealtime(record, now));
    return {
      totalMinutes: staffMonthRecords.reduce((sum, record) => sum + record.totalMinutes, 0),
      nightMinutes: staffMonthRecords.reduce((sum, record) => sum + record.nightMinutes, 0),
      pay: monthlyPay(staffMonthRecords, punchStaff, now)
    };
  }, [punchStaff, currentWorkDate, records, now]);

  const currentStaffMonthRows = useMemo(() => {
    if (!currentStaff) return [];
    const targetMonth = currentWorkDate.slice(0, 7);
    return monthDays(targetMonth).filter((workDate) => workDate <= currentWorkDate).reverse().map((workDate) => {
      const record = records.find((item) => item.employeeId === currentStaff.id && item.workDate === workDate);
      const realtimeRecord = record ? recordWithRealtime(record, now) : null;
      return {
        workDate,
        status: realtimeRecord?.status ?? ("off" as const),
        isUnregistered: isUnregisteredRecord(realtimeRecord) || hasOpenFinalPunch(realtimeRecord),
        totalMinutes: realtimeRecord?.totalMinutes ?? 0,
        pay: isHourlyRole(currentStaff.role) ? realtimeRecord ? laborCost(realtimeRecord, currentStaff, now) : 0 : null
      };
    });
  }, [currentStaff, currentWorkDate, records, now]);

  const manualRecordsByDate = useMemo(() => {
    const map = new Map<string, WorkDayRecord>();
    records
      .filter((record) => record.employeeId === manualEmployeeId && record.workDate.startsWith(manualMonth))
      .forEach((record) => map.set(record.workDate, record));
    return map;
  }, [manualEmployeeId, manualMonth, records]);

  const visibleRecords = useMemo(
    () =>
      records
        .filter((record) => record.workDate.startsWith(recordMonth))
        .filter((record) => recordEmployeeId === "all" || record.employeeId === recordEmployeeId)
        .map((record) => recordWithRealtime(record, now))
        .sort((a, b) => a.workDate.localeCompare(b.workDate) || (employeeById.get(a.employeeId)?.name ?? "").localeCompare(employeeById.get(b.employeeId)?.name ?? "")),
    [employeeById, now, recordEmployeeId, recordMonth, records]
  );

  const summaryRows = useMemo(
    () =>
      employees
        .map((employee) => {
          const employeeRecords = records
            .filter((record) => record.employeeId === employee.id && record.workDate.startsWith(summaryMonth))
            .map((record) => recordWithRealtime(record, now));
          const totalMinutes = employeeRecords.reduce((sum, record) => sum + record.totalMinutes, 0);
          const nightMinutes = employeeRecords.reduce((sum, record) => sum + record.nightMinutes, 0);
          const pay = monthlyPay(employeeRecords, employee, now);
          const payRole = employeeRecords[0] ? recordPay(employeeRecords[0], employee, now).role : employee.role;
          return { employee, totalMinutes, nightMinutes, pay, payRole };
        })
        .filter((row) => row.totalMinutes > 0),
    [employees, now, records, summaryMonth]
  );

  function paySnapshotForEmployee(employee?: Employee) {
    if (!employee) return {};
    return {
      payRoleSnapshot: employee.role,
      payTypeSnapshot: rolePayType(employee.role),
      payAmountSnapshot: employeePayAmount(employee)
    };
  }

  function recordForSave(nextRecord: WorkDayRecord, existing?: WorkDayRecord) {
    const employee = employeeById.get(nextRecord.employeeId);
    if (isCurrentWorkMonth(nextRecord.workDate, now) || existing?.payRoleSnapshot === undefined) {
      return { ...nextRecord, ...paySnapshotForEmployee(employee) };
    }
    return {
      ...nextRecord,
      payRoleSnapshot: existing.payRoleSnapshot,
      payTypeSnapshot: existing.payTypeSnapshot,
      payAmountSnapshot: existing.payAmountSnapshot
    };
  }

  function upsertRecordList(current: WorkDayRecord[], nextRecord: WorkDayRecord) {
    const existingIndex = current.findIndex((record) => record.employeeId === nextRecord.employeeId && record.workDate === nextRecord.workDate);
    if (existingIndex >= 0) {
      const existing = current[existingIndex];
      const savedRecord = recordForSave({ ...nextRecord, id: existing.id }, existing);
      return current.map((record, index) => (index === existingIndex ? savedRecord : record));
    }
    return [recordForSave(nextRecord), ...current];
  }

  function normalizeSharedStoreSnapshot(store: AttendanceStore): SharedStoreSnapshot {
    const normalizedEmployees = (store.employees.length > 0 ? store.employees : seedEmployees).map(normalizeEmployee);
    const normalizedRecords = fillMissingPaySnapshots(closeExpiredRecords(store.records.map(migrateLegacyRecord), new Date()), normalizedEmployees);
    return { employees: normalizedEmployees, records: normalizedRecords };
  }

  function wait(milliseconds: number) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function saveSharedStoreImmediately(nextEmployees: Employee[], nextRecords: WorkDayRecord[]) {
    setIsSaving(true);
    try {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch("/api/attendance", {
            body: JSON.stringify({ employees: nextEmployees, records: nextRecords }),
            headers: { "Content-Type": "application/json" },
            method: "POST"
          });
          if (!response.ok) throw new Error("保存できませんでした。");
          const savedStore = normalizeSharedStoreSnapshot((await response.json()) as AttendanceStore);
          setDataError("");
          return savedStore;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await wait(500 * (attempt + 1));
        }
      }
      throw lastError instanceof Error ? lastError : new Error("保存できませんでした。");
    } finally {
      setIsSaving(false);
    }
  }

  function applySavedStore(savedStore: SharedStoreSnapshot) {
    setEmployees(savedStore.employees);
    setRecords(savedStore.records);
  }

  function savePunchRecord(nextRecord: WorkDayRecord, successMessage: string) {
    const nextRecords = upsertRecordList(records, nextRecord);
    setMessage("保存中です...");

    return saveSharedStoreImmediately(employees, nextRecords)
      .then((savedStore) => {
        const savedRecord = savedStore.records.find((record) => record.employeeId === nextRecord.employeeId && record.workDate === nextRecord.workDate);
        const draftKey = manualDraftKeyFor(nextRecord.employeeId, nextRecord.workDate);
        applySavedStore(savedStore);
        setManualDrafts((current) => ({
          ...current,
          [draftKey]: draftFromRecord(savedRecord ?? nextRecord)
        }));
        setMessage(successMessage);
      })
      .catch(() => {
        setDataError("共有データを保存できません。通信状況を確認してもう一度押してください。");
        setMessage("保存できませんでした。もう一度押してください。");
        throw new Error("Punch save failed");
      });
  }

  async function withPunchSaveLock(action: () => Promise<void>) {
    if (punchSavingRef.current) return;
    punchSavingRef.current = true;
    setIsPunchSaving(true);
    try {
      await action();
    } finally {
      punchSavingRef.current = false;
      setIsPunchSaving(false);
    }
  }

  function handlePunchSaveError(error: unknown) {
    if (error instanceof Error && error.message === "Punch save failed") return;
    setDataError("共有データを保存できません。通信状況を確認してもう一度押してください。");
    setMessage("保存できませんでした。もう一度押してください。");
  }

  function buildStartRecord(existing: WorkDayRecord | undefined, punchStaffId: string, workDate: string, timestampText: string) {
    const nextPunches = [...(existing?.status === "missing" ? [] : existing?.punches ?? []), { id: createId("punch"), type: "start" as const, at: timestampText }];
    return {
      id: existing?.id ?? createId("work-day"),
      employeeId: punchStaffId,
      workDate,
      totalMinutes: existing?.status === "missing" ? 0 : existing?.totalMinutes ?? 0,
      nightMinutes: existing?.status === "missing" ? 0 : existing?.nightMinutes ?? 0,
      breakMinutes: existing?.status === "missing" ? 0 : breakMinutesFromPunches(nextPunches),
      activeStartedAt: timestampText,
      status: "working" as const,
      punches: nextPunches
    };
  }

  function buildEndRecord(existing: WorkDayRecord, existingActiveStartedAt: string, timestamp: Date) {
    const startedAt = parseLocalDateTime(existingActiveStartedAt);
    const endAt = new Date(Math.min(timestamp.getTime(), businessEnd(existing.workDate).getTime()));
    const endText = localDateTime(endAt);
    const nextPunches = [...existing.punches, { id: createId("punch"), type: "end" as const, at: endText }];
    const nextRecord = { ...existing, punches: nextPunches };
    return {
      ...existing,
      totalMinutes: existing.totalMinutes + intervalMinutes(startedAt, endAt),
      nightMinutes: existing.nightMinutes + nightMinutesBetween(startedAt, endAt),
      breakMinutes: calculatedBreakMinutes(nextRecord),
      activeStartedAt: null,
      status: "registered" as const,
      punches: nextPunches
    };
  }

  function findEmployeeByCode(code: string) {
    const normalizedCode = code.trim();
    return employees.find((employee) => employee.staffCode === normalizedCode) ?? null;
  }

  function codeExists(code: string, exceptEmployeeId?: string) {
    const normalizedCode = code.trim();
    if (!normalizedCode) return false;
    if (normalizedCode === DEVELOPER_CODE) return true;
    return employees.some((employee) => employee.id !== exceptEmployeeId && employee.staffCode === normalizedCode);
  }

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = codeInput.trim();
    if (code === DEVELOPER_CODE) {
      setAdminMode(true);
      setAdminView("menu");
      setCurrentStaffId("");
      setCodeInput("");
      setLoginError("");
      setMessage("管理者メニューを開きました。");
      return;
    }

    const employee = findEmployeeByCode(code);
    if (!employee) {
      setLoginError("スタッフコードが見つかりません。");
      return;
    }

    if (employee.id === "emp-manager") {
      setAdminMode(true);
      setAdminView("menu");
      setCurrentStaffId("");
      setCodeInput("");
      setLoginError("");
      setMessage("管理者メニューを開きました。");
      return;
    }

    setCurrentStaffId(employee.id);
    setAdminMode(false);
    setCodeInput("");
    setLoginError("");
    setMessage(`${employee.name}さんでログインしました。`);
  }

  function handleLogout() {
    setCurrentStaffId("");
    setAdminMode(false);
    setAdminView("menu");
    setMessage("");
  }

  function handleWorkToggle() {
    if (!punchStaff) return;
    void withPunchSaveLock(async () => {
      try {
        const timestamp = new Date();
        const timestampText = localDateTime(timestamp);
        const workDate = businessDate(timestamp);
        const existing = records.find((record) => record.employeeId === punchStaff.id && record.workDate === workDate);
        const existingActiveStartedAt = activeStartAtForRecord(existing, timestamp);

        if (!existing || !existingActiveStartedAt) {
          await savePunchRecord(buildStartRecord(existing, punchStaff.id, workDate, timestampText), "勤務開始を記録しました。");
          return;
        }

        await savePunchRecord(buildEndRecord(existing, existingActiveStartedAt, timestamp), "勤務終了を記録しました。");
      } catch (error) {
        handlePunchSaveError(error);
      }
    });
  }

  function updateEmployee(employeeId: string, patch: Partial<Employee>) {
    if (!adminMode) return;
    const nextStaffCode = patch.staffCode?.trim();
    if (nextStaffCode !== undefined && !nextStaffCode) {
      setMessage("スタッフコードは空にできません。");
      return;
    }
    if (nextStaffCode && codeExists(nextStaffCode, employeeId)) {
      setMessage("同じスタッフコードは使えません。");
      return;
    }

    const currentEmployee = employeeById.get(employeeId);
    const nextEmployee = currentEmployee ? applyEmployeePatch(currentEmployee, patch) : null;

    setEmployees((current) =>
      current.map((employee) => (employee.id === employeeId ? applyEmployeePatch(employee, patch) : employee))
    );

    if (nextEmployee && (patch.role !== undefined || patch.payAmount !== undefined)) {
      const targetMonth = businessDate(now).slice(0, 7);
      const snapshot = paySnapshotForEmployee(nextEmployee);
      setRecords((current) =>
        current.map((record) =>
          record.employeeId === employeeId && record.workDate.startsWith(targetMonth)
            ? {
                ...record,
                ...snapshot
              }
            : record
        )
      );
    }
  }

  function saveCurrentStore(successMessage: string) {
    setMessage("保存中です...");
    return saveSharedStoreImmediately(employees, records)
      .then((savedStore) => {
        applySavedStore(savedStore);
        setMessage(successMessage);
      })
      .catch(() => {
        setDataError("共有データを保存できません。通信状況を確認してもう一度押してください。");
        setMessage("保存できませんでした。もう一度押してください。");
        throw new Error("Store save failed");
      });
  }

  function handleEmployeeEditToggle(employeeId: string) {
    if (editingEmployeeId !== employeeId) {
      setEditingEmployeeId(employeeId);
      return;
    }

    void saveCurrentStore("メンバー情報を保存しました。")
      .then(() => setEditingEmployeeId(""))
      .catch(() => undefined);
  }

  function handleAddEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminMode) return;
    const name = newEmployeeName.trim();
    const staffCode = newEmployeeCode.trim();
    const payAmount = isHourlyRole(newRole) ? Math.max(0, Math.floor(Number(newPayAmount) || 0)) : 0;
    if (!name || !staffCode) {
      setMessage("スタッフコードと氏名を入力してください。");
      return;
    }
    if (codeExists(staffCode)) {
      setMessage("同じスタッフコードは使えません。");
      return;
    }

    const employee: Employee = { id: createId("emp"), name, role: newRole, staffCode, payType: rolePayType(newRole), payAmount, hourlyWage: payAmount };
    const nextEmployees = [...employees, employee];
    setMessage("保存中です...");
    void saveSharedStoreImmediately(nextEmployees, records)
      .then((savedStore) => {
        applySavedStore(savedStore);
        setManualEmployeeId(employee.id);
        setNewEmployeeCode("");
        setNewEmployeeName("");
        setNewRole("アルバイト");
        setNewPayAmount("1200");
        setMessage(`${name}さんを追加しました。`);
      })
      .catch(() => {
        setDataError("共有データを保存できません。通信状況を確認してもう一度押してください。");
        setMessage("保存できませんでした。もう一度押してください。");
      });
  }

  function handleDeleteEmployee(employeeId: string) {
    if (!adminMode) return;
    if (employees.length <= 1) {
      setMessage("メンバーは1人以上必要です。");
      return;
    }
    const employee = employeeById.get(employeeId);
    const nextEmployees = employees.filter((item) => item.id !== employeeId);
    const nextRecords = records.filter((record) => record.employeeId !== employeeId);
    setMessage("保存中です...");
    void saveSharedStoreImmediately(nextEmployees, nextRecords)
      .then((savedStore) => {
        applySavedStore(savedStore);
        setEditingEmployeeId("");
        setMessage(`${employee?.name ?? "メンバー"}さんを削除しました。`);
      })
      .catch(() => {
        setDataError("共有データを保存できません。通信状況を確認してもう一度押してください。");
        setMessage("保存できませんでした。もう一度押してください。");
      });
  }

  function manualDraftKeyFor(employeeId: string, workDate: string) {
    return `${employeeId}:${workDate}`;
  }

  function draftFromRecord(record?: WorkDayRecord): ManualDraft {
    if (!record || record.status === "off") return { punches: [] };
    const recordPunches = sortedPunches(record);
    if (record.activeStartedAt && !recordPunches.some((punch) => punch.type === "start" && punch.at === record.activeStartedAt)) {
      recordPunches.push({ id: `punch-active-${record.id}`, type: "start", at: record.activeStartedAt });
    }
    const punches = recordPunches.sort((a, b) => a.at.localeCompare(b.at)).map((punch) => ({
      id: punch.id,
      type: punch.type,
      time: formatTimeOnly(punch.at)
    }));
    return { punches };
  }

  function draftForEmployeeDay(employeeId: string, workDate: string, record?: WorkDayRecord) {
    const draftKey = manualDraftKeyFor(employeeId, workDate);
    if (manualDrafts[draftKey]) return manualDrafts[draftKey];
    return draftFromRecord(record);
  }

  function draftForDay(workDate: string, record?: WorkDayRecord) {
    return draftForEmployeeDay(manualEmployeeId, workDate, record);
  }

  function updatePunchDraft(employeeId: string, workDate: string, record: WorkDayRecord | undefined, punchId: string, patch: Partial<ManualPunchDraft>) {
    const draftKey = manualDraftKeyFor(employeeId, workDate);
    setManualDrafts((current) => ({
      ...current,
      [draftKey]: {
        ...draftForEmployeeDay(employeeId, workDate, record),
        punches: draftForEmployeeDay(employeeId, workDate, record).punches.map((punch) => (punch.id === punchId ? { ...punch, ...patch } : punch))
      }
    }));
  }

  function updateManualPunch(workDate: string, punchId: string, patch: Partial<ManualPunchDraft>) {
    updatePunchDraft(manualEmployeeId, workDate, manualRecordsByDate.get(workDate), punchId, patch);
  }

  function addPunchDraft(employeeId: string, workDate: string, record?: WorkDayRecord) {
    const draft = draftForEmployeeDay(employeeId, workDate, record);
    const draftKey = manualDraftKeyFor(employeeId, workDate);
    const lastPunch = draft.punches[draft.punches.length - 1];
    const nextType: PunchType = lastPunch?.type === "start" ? "end" : "start";
    const defaultTime = lastPunch?.time || (nextType === "start" ? "09:00" : "18:00");
    setManualDrafts((current) => ({
      ...current,
      [draftKey]: {
        punches: [...draft.punches, { id: createId("manual-punch"), type: nextType, time: defaultTime }]
      }
    }));
  }

  function addManualPunch(workDate: string) {
    addPunchDraft(manualEmployeeId, workDate, manualRecordsByDate.get(workDate));
  }

  function removePunchDraft(employeeId: string, workDate: string, record: WorkDayRecord | undefined, punchId: string) {
    const draft = draftForEmployeeDay(employeeId, workDate, record);
    const draftKey = manualDraftKeyFor(employeeId, workDate);
    setManualDrafts((current) => ({
      ...current,
      [draftKey]: {
        punches: draft.punches.filter((punch) => punch.id !== punchId)
      }
    }));
  }

  function removeManualPunch(workDate: string, punchId: string) {
    removePunchDraft(manualEmployeeId, workDate, manualRecordsByDate.get(workDate), punchId);
  }

  function punchesFromDraft(workDate: string, draft: ManualDraft) {
    const punches = draft.punches
      .filter((punch) => punch.time)
      .map((punch) => ({
        id: punch.id,
        type: punch.type,
        at: combineWorkDateAndTime(workDate, punch.time, punch.type === "end")
      }))
      .sort((a, b) => a.at.localeCompare(b.at));

    let openStart = "";
    for (const punch of punches) {
      if (punch.type === "start") {
        if (openStart) return null;
        openStart = punch.at;
      } else {
        if (!openStart || parseLocalDateTime(punch.at) <= parseLocalDateTime(openStart)) return null;
        openStart = "";
      }
    }

    return punches;
  }

  function draftSummary(workDate: string, draft: ManualDraft) {
    const punches = punchesFromDraft(workDate, draft);
    if (!punches) return null;
    return {
      punches,
      breakMinutes: breakMinutesFromPunches(punches),
      totalMinutes: workMinutesFromPunches(punches),
      nightMinutes: nightMinutesFromPunches(punches),
      status: punches.length === 0 ? ("off" as const) : punches[punches.length - 1].type === "start" ? ("missing" as const) : ("registered" as const)
    };
  }

  function recordFromEmployeeDraft(employeeId: string, workDate: string, existing?: WorkDayRecord) {
    const draft = draftForEmployeeDay(employeeId, workDate, existing);
    const summary = draftSummary(workDate, draft);
    if (!summary) return null;
    const isOpenCurrentWorkDate = summary.status === "missing" && workDate === businessDate(now);
    const activeStartedAt = isOpenCurrentWorkDate ? summary.punches[summary.punches.length - 1]?.at ?? null : null;
    const status = isOpenCurrentWorkDate ? ("working" as const) : summary.status;

    if (summary.status === "off") {
      return {
        id: existing?.id ?? createId("work-day"),
        employeeId,
        workDate,
        totalMinutes: 0,
        nightMinutes: 0,
        breakMinutes: 0,
        activeStartedAt: null,
        status: "off" as const,
        punches: []
      };
    }

    return {
      id: existing?.id ?? createId("work-day"),
      employeeId,
      workDate,
      totalMinutes: summary.totalMinutes,
      nightMinutes: summary.nightMinutes,
      breakMinutes: summary.breakMinutes,
      activeStartedAt,
      status,
      punches: summary.punches
    };
  }

  function manualRecordFromDraft(workDate: string) {
    return recordFromEmployeeDraft(manualEmployeeId, workDate, manualRecordsByDate.get(workDate));
  }

  function showSavedNotice(text: string) {
    setSaveNotice(text);
    window.setTimeout(() => setSaveNotice(""), 1800);
  }

  function showStaffSavedNotice(text: string) {
    setStaffSaveNotice(text);
    window.setTimeout(() => setStaffSaveNotice(""), 1800);
  }

  function saveStaffToday() {
    if (!currentStaff) return;
    const nextRecord = recordFromEmployeeDraft(currentStaff.id, currentWorkDate, currentRecord ?? undefined);
    if (!nextRecord) {
      setMessage("勤務開始と勤務終了の順番を確認してください。");
      return;
    }
    const nextRecords = upsertRecordList(records, nextRecord);
    setMessage("保存中です...");
    void saveSharedStoreImmediately(employees, nextRecords)
      .then((savedStore) => {
        applySavedStore(savedStore);
        setMessage("本日の勤務を修正しました。");
        showStaffSavedNotice("保存しました");
      })
      .catch(() => {
        setDataError("共有データを保存できません。通信状況を確認してもう一度押してください。");
        setMessage("保存できませんでした。もう一度押してください。");
      });
  }

  function saveManualSingleDay() {
    if (!adminMode || !manualEmployeeId) return;
    if (isWorkDateLocked(manualDate, now)) {
      setMessage("給料日を過ぎた過去月の勤怠は編集できません。");
      return;
    }
    const nextRecord = manualRecordFromDraft(manualDate);
    if (!nextRecord) {
      setMessage("勤務終了は勤務開始より後の時刻にしてください。");
      return;
    }
    const nextRecords = upsertRecordList(records, nextRecord);
    setMessage("保存中です...");
    void saveSharedStoreImmediately(employees, nextRecords)
      .then((savedStore) => {
        applySavedStore(savedStore);
        setMessage(`${manualDate} を保存しました。`);
        showSavedNotice("保存しました");
      })
      .catch(() => {
        setDataError("共有データを保存できません。通信状況を確認してもう一度押してください。");
        setMessage("保存できませんでした。もう一度押してください。");
      });
  }

  function saveManualMonth() {
    if (!adminMode || !manualEmployeeId) return;
    if (isPastMonthLocked(manualMonth, now)) {
      setMessage("給料日を過ぎた過去月の勤怠は編集できません。");
      return;
    }
    const nextRecords = monthDays(manualMonth).map((workDate) => manualRecordFromDraft(workDate));

    if (nextRecords.some((record) => record === null)) {
      setMessage("勤務終了は勤務開始より後の時刻にしてください。");
      return;
    }

    const targetDates = new Set(monthDays(manualMonth));
    const others = records.filter((record) => record.employeeId !== manualEmployeeId || !targetDates.has(record.workDate));
    const recordsForSave = (nextRecords.filter(Boolean) as WorkDayRecord[]).map((record) => {
      const existing = records.find((item) => item.employeeId === record.employeeId && item.workDate === record.workDate);
      return recordForSave(record, existing);
    });
    setMessage("保存中です...");
    void saveSharedStoreImmediately(employees, [...others, ...recordsForSave])
      .then((savedStore) => {
        applySavedStore(savedStore);
        setMessage(`${manualMonth} の勤怠を保存しました。`);
        showSavedNotice("保存しました");
      })
      .catch(() => {
        setDataError("共有データを保存できません。通信状況を確認してもう一度押してください。");
        setMessage("保存できませんでした。もう一度押してください。");
      });
  }

  function handleDeleteRecord(recordId: string) {
    if (!adminMode) return;
    const targetRecord = records.find((record) => record.id === recordId);
    if (targetRecord && isWorkDateLocked(targetRecord.workDate, now)) {
      setMessage("給料日を過ぎた過去月の勤怠は削除できません。");
      return;
    }
    if (!window.confirm("この勤怠記録を削除しますか？")) return;
    const nextRecords = records.filter((record) => record.id !== recordId);
    setMessage("保存中です...");
    void saveSharedStoreImmediately(employees, nextRecords)
      .then((savedStore) => {
        applySavedStore(savedStore);
        setMessage("勤怠記録を削除しました。");
      })
      .catch(() => {
        setDataError("共有データを保存できません。通信状況を確認してもう一度押してください。");
        setMessage("保存できませんでした。もう一度押してください。");
      });
  }

  function exportRecordsCsv() {
    const rows: Array<Array<string | number>> = [["日付", "氏名", "スタッフコード", "勤務開始", "勤務終了", "休憩時間", "実働時間", "深夜時間", "人件費"]];
    visibleRecords.forEach((record) => {
      const employee = employeeById.get(record.employeeId);
      const cost = laborCost(record, employee, now);
      rows.push([
        record.workDate,
        employee?.name ?? "不明",
        employee?.staffCode ?? "",
        startDisplay(record),
        endDisplay(record),
        formatDuration(calculatedBreakMinutes(record)),
        formatDuration(record.totalMinutes),
        formatDuration(record.nightMinutes),
        cost === null ? "-" : Math.round(cost)
      ]);
    });
    exportCsvFile(`attendance-records-${recordMonth}.csv`, rows);
  }

  function exportSummaryCsv() {
    const rows: Array<Array<string | number>> = [["氏名", "スタッフコード", "役職", "勤務時間", "深夜時間", "給与"]];
    summaryRows.forEach((row) => {
      rows.push([row.employee.name, row.employee.staffCode, row.payRole, formatDuration(row.totalMinutes), formatDuration(row.nightMinutes), Math.round(row.pay)]);
    });
    exportCsvFile(`attendance-summary-${summaryMonth}.csv`, rows);
  }

  const staffTodayDraft = currentStaff ? draftForEmployeeDay(currentStaff.id, currentWorkDate, currentRecord ?? undefined) : null;
  const staffTodaySummary = staffTodayDraft ? draftSummary(currentWorkDate, staffTodayDraft) : null;

  if (isLoading) {
    return (
      <main className="grid min-h-dvh place-items-center bg-stone-50 px-4 py-8 text-stone-950">
        <section className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-5 text-center shadow-sm">
          <p className="text-sm font-bold text-emerald-700">勤怠管理</p>
          <h1 className="mt-1 text-2xl font-black">共有データを読み込み中</h1>
          <p className="mt-2 text-sm font-bold text-stone-500">店舗の勤怠データに接続しています。</p>
        </section>
      </main>
    );
  }

  if (!currentStaff && !adminMode) {
    return (
      <main className="grid min-h-dvh place-items-center bg-stone-50 px-4 py-8 text-stone-950">
        <section className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-emerald-700">勤怠管理</p>
          <h1 className="mt-1 text-3xl font-black leading-tight">ログイン</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-stone-600">スタッフコードを入力してください</p>

          <form className="mt-5 grid gap-3" onSubmit={handleLogin}>
            <label className="grid gap-2 text-sm font-bold text-stone-600">
              スタッフコード
              <input
                autoComplete="one-time-code"
                className="h-14 rounded-md border border-stone-300 bg-white px-4 text-center text-2xl font-black tracking-[0.18em] outline-none"
                inputMode="numeric"
                onChange={(event) => setCodeInput(event.target.value)}
                placeholder="コード"
                type="password"
                value={codeInput}
              />
            </label>
            <button className="h-12 rounded-md bg-emerald-700 px-4 font-black text-white" type="submit">
              開く
            </button>
            {loginError ? <p className="text-sm font-bold text-rose-700">{loginError}</p> : null}
          </form>
          {dataError ? <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{dataError}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-stone-50 text-stone-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-3 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4 sm:py-5">
          <div>
            <p className="text-sm font-bold text-emerald-700">勤怠管理</p>
            <h1 className="text-2xl font-black leading-tight sm:text-3xl">{adminMode ? "管理者メニュー" : "スタッフ打刻"}</h1>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <div className="grid gap-1 rounded-md border border-stone-200 bg-stone-50 px-2 py-2 text-center sm:min-w-36 sm:px-4 sm:py-3 sm:text-right">
              <span className="text-xs font-bold text-stone-500">営業日</span>
              <span className="text-sm font-black sm:text-lg">{currentWorkDate}</span>
            </div>
            <div className={`grid gap-1 rounded-md border px-2 py-2 text-center sm:min-w-28 sm:px-4 sm:py-3 sm:text-right ${dataError ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
              <span className="text-xs font-bold">{dataError ? "共有エラー" : "共有保存"}</span>
              <span className="text-sm font-black">{dataError ? "要確認" : isSaving ? "保存中" : "同期中"}</span>
            </div>
            <button className="h-full min-h-11 rounded-md border border-stone-300 bg-white px-2 text-sm font-black text-stone-700 sm:px-4" onClick={handleLogout} type="button">
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 px-3 py-3 sm:px-4 sm:py-4">
        {dataError ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{dataError}</p> : null}

        {!adminMode && currentStaff ? (
          <section className="mx-auto w-full max-w-xl rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-stone-500">ログイン中</p>
                <h2 className="truncate text-2xl font-black">{currentStaff.name}</h2>
                <p className="mt-1 text-sm font-bold text-stone-500">{currentStaff.role}</p>
              </div>
              <span className={`shrink-0 rounded-md border px-3 py-2 text-sm font-black ${currentIsWorking ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-stone-100 text-stone-600"}`}>
                {currentIsWorking ? "勤務中" : "待機中"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 rounded-md bg-stone-50 p-4">
              <button className={`h-16 rounded-md px-4 text-xl font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 ${currentIsWorking ? "bg-stone-900" : "bg-emerald-600"}`} disabled={isPunchSaving} onClick={handleWorkToggle} type="button">
                {isPunchSaving ? "保存中..." : currentIsWorking ? "勤務終了" : "勤務開始"}
              </button>

              <div className={`grid grid-cols-1 gap-2 text-center text-sm ${showsStaffPayCard(currentStaff) ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                <div className="grid gap-2 rounded-md bg-white p-3">
                  <p className="font-bold text-stone-500">本日の勤務</p>
                  <p className="text-xl font-black">{currentRealtimeRecord ? formatDuration(currentRealtimeRecord.totalMinutes) : "0時間00分"}</p>
                  <button className="h-9 rounded-md bg-stone-100 px-3 text-sm font-black text-stone-800" onClick={() => setStaffPanel(staffPanel === "today-edit" ? "" : "today-edit")} type="button">
                    修正
                  </button>
                </div>
                <div className="grid gap-2 rounded-md bg-white p-3">
                  <p className="font-bold text-stone-500">当月の勤務時間</p>
                  <p className="text-xl font-black">{currentMonthSummary ? formatDuration(currentMonthSummary.totalMinutes) : "0時間00分"}</p>
                  {showsNightBreakdown(currentStaff) ? <p className="text-xs font-bold text-stone-500">うち深夜時間{currentMonthSummary ? formatDuration(currentMonthSummary.nightMinutes) : "0時間00分"}</p> : null}
                  <button className="h-9 rounded-md bg-stone-100 px-3 text-sm font-black text-stone-800" onClick={() => setStaffPanel(staffPanel === "work-detail" ? "" : "work-detail")} type="button">
                    詳細
                  </button>
                </div>
                {showsStaffPayCard(currentStaff) ? (
                  <div className="grid gap-2 rounded-md bg-white p-3">
                    <p className="font-bold text-stone-500">当月の給与</p>
                    <p className="text-xl font-black">{currentMonthSummary ? formatYen(currentMonthSummary.pay) : "¥0"}</p>
                    <button className="h-9 rounded-md bg-stone-100 px-3 text-sm font-black text-stone-800" onClick={() => setStaffPanel(staffPanel === "pay-detail" ? "" : "pay-detail")} type="button">
                      詳細
                    </button>
                  </div>
                ) : null}
              </div>

              {currentRealtimeRecord?.status === "missing" ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">前回の勤務終了が未登録です。管理者に修正を依頼してください。</p> : null}

              {staffPanel === "today-edit" && currentStaff && staffTodayDraft ? (
                <div className="rounded-md border border-stone-200 bg-white p-3 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-stone-500">本日の勤務を修正</p>
                      <p className="font-black">{currentWorkDate}</p>
                    </div>
                    <button className="h-9 rounded-md bg-stone-900 px-3 text-sm font-black text-white" onClick={() => addPunchDraft(currentStaff.id, currentWorkDate, currentRecord ?? undefined)} type="button">
                      打刻を追加
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {staffTodayDraft.punches.length === 0 ? (
                      <p className="rounded-md bg-stone-50 px-3 py-3 text-sm font-bold text-stone-500">打刻なし。このまま保存すると休みになります。</p>
                    ) : (
                      staffTodayDraft.punches.map((punch, index) => (
                        <div className="grid grid-cols-[1fr_1fr_auto] gap-2" key={punch.id}>
                          <select className="h-10 rounded-md border border-stone-300 bg-white px-2 text-sm font-bold outline-none" onChange={(event) => updatePunchDraft(currentStaff.id, currentWorkDate, currentRecord ?? undefined, punch.id, { type: event.target.value as PunchType })} value={punch.type}>
                            <option value="start">勤務開始</option>
                            <option value="end">勤務終了</option>
                          </select>
                          <input className="h-10 rounded-md border border-stone-300 bg-white px-3 text-base font-bold outline-none" onChange={(event) => updatePunchDraft(currentStaff.id, currentWorkDate, currentRecord ?? undefined, punch.id, { time: event.target.value })} type="time" value={punch.time} />
                          <button aria-label={`${index + 1}番目の打刻を削除`} className="h-10 rounded-md bg-rose-50 px-3 text-sm font-black text-rose-700" onClick={() => removePunchDraft(currentStaff.id, currentWorkDate, currentRecord ?? undefined, punch.id)} type="button">
                            削除
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  {staffTodaySummary ? (
                    <div className={`mt-3 grid gap-2 text-center text-sm ${showsNightBreakdown(currentStaff) ? "grid-cols-3" : "grid-cols-2"}`}>
                      <div className="rounded-md bg-stone-50 px-3 py-2">
                        <p className="text-xs font-bold text-stone-500">休憩</p>
                        <p className="font-black">{formatDuration(staffTodaySummary.breakMinutes)}</p>
                      </div>
                      <div className="rounded-md bg-stone-50 px-3 py-2">
                        <p className="text-xs font-bold text-stone-500">勤務</p>
                        <p className="font-black">{formatDuration(staffTodaySummary.totalMinutes)}</p>
                      </div>
                      {showsNightBreakdown(currentStaff) ? (
                        <div className="rounded-md bg-stone-50 px-3 py-2">
                          <p className="text-xs font-bold text-stone-500">深夜</p>
                          <p className="font-black">{formatDuration(staffTodaySummary.nightMinutes)}</p>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">勤務開始と勤務終了の順番を確認してください。</p>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button className="h-11 rounded-md bg-stone-100 px-3 font-black text-stone-800" onClick={() => setStaffPanel("")} type="button">
                      閉じる
                    </button>
                    <button className="h-11 rounded-md bg-emerald-700 px-3 font-black text-white disabled:bg-stone-300" disabled={!staffTodaySummary || isSaving} onClick={saveStaffToday} type="button">
                      {staffSaveNotice || "保存"}
                    </button>
                  </div>
                </div>
              ) : null}

              {staffPanel === "work-detail" ? (
                <div className="rounded-md border border-stone-200 bg-white p-3 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-black">当月の勤務時間</h3>
                    <button className="h-9 rounded-md bg-stone-100 px-3 text-sm font-black text-stone-800" onClick={() => setStaffPanel("")} type="button">
                      閉じる
                    </button>
                  </div>
                  <div className="mt-3">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-stone-100 text-xs font-black text-stone-600">
                        <tr>
                          <th className="px-3 py-2 text-left">日付</th>
                          <th className="px-3 py-2 text-right">勤務時間</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentStaffMonthRows.map((row) => (
                          <tr className="border-t border-stone-100" key={row.workDate}>
                            <td className="px-3 py-2 font-bold">{row.workDate}</td>
                            <td className="px-3 py-2 text-right font-black">{row.isUnregistered ? "未登録" : row.totalMinutes > 0 ? formatDuration(row.totalMinutes) : "休み"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {staffPanel === "pay-detail" && showsStaffPayCard(currentStaff) ? (
                <div className="rounded-md border border-stone-200 bg-white p-3 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-black">当月の給与</h3>
                    <button className="h-9 rounded-md bg-stone-100 px-3 text-sm font-black text-stone-800" onClick={() => setStaffPanel("")} type="button">
                      閉じる
                    </button>
                  </div>
                  <div className="mt-3">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-stone-100 text-xs font-black text-stone-600">
                        <tr>
                          <th className="px-3 py-2 text-left">日付</th>
                          <th className="px-3 py-2 text-right">給与</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentStaffMonthRows.map((row) => (
                          <tr className="border-t border-stone-100" key={row.workDate}>
                            <td className="px-3 py-2 font-bold">{row.workDate}</td>
                            <td className="px-3 py-2 text-right font-black">{row.isUnregistered ? "未登録" : row.totalMinutes > 0 ? row.pay === null ? "-" : formatYen(row.pay) : "休み"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
            {message ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{message}</p> : null}
          </section>
        ) : null}

        {adminMode ? (
          <section className="grid content-start gap-4">
            {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{message}</p> : null}

            {punchStaff ? (
              <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-stone-500">管理者打刻</p>
                    <h2 className="truncate text-xl font-black">{punchStaff.name}</h2>
                  </div>
                  <span className={`w-fit rounded-md border px-3 py-2 text-sm font-black ${currentIsWorking ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-stone-100 text-stone-600"}`}>
                    {currentIsWorking ? "勤務中" : "待機中"}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(180px,240px)_1fr] sm:items-stretch">
                  <button className={`h-14 rounded-md px-4 text-lg font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 ${currentIsWorking ? "bg-stone-900" : "bg-emerald-600"}`} disabled={isPunchSaving} onClick={handleWorkToggle} type="button">
                    {isPunchSaving ? "保存中..." : currentIsWorking ? "勤務終了" : "勤務開始"}
                  </button>
                  <div className={`grid grid-cols-2 gap-2 text-center text-sm ${showsNightBreakdown(punchStaff) ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                    <div className="rounded-md bg-stone-50 p-3">
                      <p className="font-bold text-stone-500">本日の勤務</p>
                      <p className="font-black">{currentRealtimeRecord ? formatDuration(currentRealtimeRecord.totalMinutes) : "0時間00分"}</p>
                    </div>
                    <div className="rounded-md bg-stone-50 p-3">
                      <p className="font-bold text-stone-500">当月の勤務</p>
                      <p className="font-black">{currentMonthSummary ? formatDuration(currentMonthSummary.totalMinutes) : "0時間00分"}</p>
                    </div>
                    {showsNightBreakdown(punchStaff) ? (
                      <div className="rounded-md bg-stone-50 p-3 max-sm:col-span-2">
                        <p className="font-bold text-stone-500">当月の深夜</p>
                        <p className="font-black">{currentMonthSummary ? formatDuration(currentMonthSummary.nightMinutes) : "0時間00分"}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
                {currentRealtimeRecord?.status === "missing" ? <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">前回の勤務終了が未登録です。手入力・修正で修正してください。</p> : null}
              </div>
            ) : null}

            <nav className="flex gap-2 overflow-x-auto rounded-lg border border-stone-200 bg-white p-2 shadow-sm sm:grid sm:grid-cols-3 sm:overflow-visible sm:p-3">
              {adminMenu.map((item) => (
                <button className={`h-11 min-w-28 rounded-md px-3 text-sm font-black sm:h-12 sm:min-w-0 ${adminView === item.id ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700"}`} key={item.id} onClick={() => setAdminView(item.id)} type="button">
                  {item.label}
                </button>
              ))}
            </nav>

            {adminView === "menu" ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {adminMenu.map((item) => (
                  <button className="h-24 rounded-lg border border-stone-200 bg-white p-4 text-left text-lg font-black shadow-sm" key={item.id} onClick={() => setAdminView(item.id)} type="button">
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}

            {adminView === "members" ? (
              <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
                <div className="border-b border-stone-200 px-4 py-3">
                  <h2 className="text-lg font-black">メンバー</h2>
                </div>
                <div className="grid gap-3 p-3 md:hidden">
                  {employees.map((employee) => (
                    <div className="rounded-md border border-stone-200 bg-stone-50 p-3" key={employee.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-stone-500">スタッフコード {employee.staffCode}</p>
                          {editingEmployeeId === employee.id ? (
                            <input className="mt-2 h-10 w-full rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => updateEmployee(employee.id, { name: event.target.value })} value={employee.name} />
                          ) : (
                            <p className="mt-1 truncate text-xl font-black">{employee.name}</p>
                          )}
                        </div>
                        <button className="h-9 shrink-0 rounded-md bg-stone-900 px-3 text-sm font-black text-white disabled:bg-stone-300" disabled={isSaving} onClick={() => handleEmployeeEditToggle(employee.id)} type="button">
                          {editingEmployeeId === employee.id ? "完了" : "編集"}
                        </button>
                      </div>
                      {editingEmployeeId === employee.id ? (
                        <div className="mt-3 grid gap-2">
                          <input className="h-10 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => updateEmployee(employee.id, { staffCode: event.target.value })} value={employee.staffCode} />
                          <div className={isHourlyRole(employee.role) ? "grid grid-cols-[1fr_1fr] gap-2" : "grid gap-2"}>
                            <select className="h-10 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => updateEmployee(employee.id, { role: event.target.value as StaffRole })} value={employee.role}>
                              {staffRoles.map((role) => (
                                <option key={role} value={role}>
                                  {role}
                                </option>
                              ))}
                            </select>
                            {isHourlyRole(employee.role) ? <input className="h-10 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" inputMode="numeric" onChange={(event) => updateEmployee(employee.id, { payAmount: Number(event.target.value) || 0 })} type="number" value={employeePayAmount(employee)} /> : null}
                          </div>
                          {employee.id !== "emp-manager" ? (
                            <button className="h-10 rounded-md bg-rose-50 px-3 text-sm font-black text-rose-700" onClick={() => handleDeleteEmployee(employee.id)} type="button">
                              削除
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm font-black">{payLabel(employee)}</p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[840px] border-collapse text-left text-sm">
                    <thead className="bg-stone-100 text-xs font-black text-stone-600">
                      <tr>
                        <th className="px-4 py-3">スタッフコード</th>
                        <th className="px-4 py-3">氏名</th>
                        <th className="px-4 py-3">役職・給与</th>
                        <th className="px-4 py-3">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((employee) => (
                        <tr className="border-t border-stone-100" key={employee.id}>
                          <td className="px-4 py-3">
                            {editingEmployeeId === employee.id ? <input className="h-10 rounded-md border border-stone-300 px-3 font-bold outline-none" onChange={(event) => updateEmployee(employee.id, { staffCode: event.target.value })} value={employee.staffCode} /> : <span className="font-black">{employee.staffCode}</span>}
                          </td>
                          <td className="px-4 py-3">
                            {editingEmployeeId === employee.id ? <input className="h-10 rounded-md border border-stone-300 px-3 font-bold outline-none" onChange={(event) => updateEmployee(employee.id, { name: event.target.value })} value={employee.name} /> : <span className="font-black">{employee.name}</span>}
                          </td>
                          <td className="px-4 py-3">
                            {editingEmployeeId === employee.id ? (
                              <div className="flex flex-wrap gap-2">
                                <select className="h-10 rounded-md border border-stone-300 px-3 font-bold outline-none" onChange={(event) => updateEmployee(employee.id, { role: event.target.value as StaffRole })} value={employee.role}>
                                  {staffRoles.map((role) => (
                                    <option key={role} value={role}>
                                      {role}
                                    </option>
                                  ))}
                                </select>
                                {isHourlyRole(employee.role) ? <input className="h-10 w-32 rounded-md border border-stone-300 px-3 font-bold outline-none" inputMode="numeric" onChange={(event) => updateEmployee(employee.id, { payAmount: Number(event.target.value) || 0 })} type="number" value={employeePayAmount(employee)} /> : null}
                              </div>
                            ) : (
                              <span>{payLabel(employee)}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button className="h-9 rounded-md bg-stone-900 px-3 text-sm font-black text-white disabled:bg-stone-300" disabled={isSaving} onClick={() => handleEmployeeEditToggle(employee.id)} type="button">
                                {editingEmployeeId === employee.id ? "完了" : "編集"}
                              </button>
                              {employee.id !== "emp-manager" ? (
                                <button className="h-9 rounded-md bg-rose-50 px-3 text-sm font-black text-rose-700" onClick={() => handleDeleteEmployee(employee.id)} type="button">
                                  削除
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {adminView === "members" ? (
              <form className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm" onSubmit={handleAddEmployee}>
                <h2 className="text-lg font-black">メンバー追加</h2>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="grid gap-2 text-sm font-bold text-stone-600">
                    スタッフコード:
                    <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" inputMode="numeric" onChange={(event) => setNewEmployeeCode(event.target.value)} value={newEmployeeCode} />
                  </label>
                  <label className="grid gap-2 text-sm font-bold text-stone-600">
                    氏名:
                    <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => setNewEmployeeName(event.target.value)} value={newEmployeeName} />
                  </label>
                  <label className="grid gap-2 text-sm font-bold text-stone-600">
                    役職:
                    <select className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => setNewRole(event.target.value as StaffRole)} value={newRole}>
                      {staffRoles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </label>
                  {isHourlyRole(newRole) ? (
                    <label className="grid gap-2 text-sm font-bold text-stone-600">
                      時給（円）:
                      <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" inputMode="numeric" onChange={(event) => setNewPayAmount(event.target.value)} type="number" value={newPayAmount} />
                    </label>
                  ) : null}
                </div>
                <button className="mt-3 h-11 rounded-md bg-emerald-700 px-4 font-black text-white" type="submit">
                  登録
                </button>
              </form>
            ) : null}

            {adminView === "manual" ? (
              <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-black">手入力・修正</h2>
                  <div className="flex flex-wrap gap-2">
                    <select className="h-10 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => setManualEmployeeId(event.target.value)} value={manualEmployeeId}>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                    <input className="h-10 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none lg:hidden" onChange={(event) => {
                      setManualDate(event.target.value);
                      setManualMonth(event.target.value.slice(0, 7));
                    }} type="date" value={manualDate} />
                    <input className="hidden h-10 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none lg:block" onChange={(event) => setManualMonth(event.target.value)} type="month" value={manualMonth} />
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:hidden">
                  {[manualDate].map((workDate) => {
                    const record = manualRecordsByDate.get(workDate);
                    const draft = draftForDay(workDate, record);
                    const summary = draftSummary(workDate, draft);
                    const locked = isWorkDateLocked(workDate, now);
                    return (
                      <div className="rounded-md border border-stone-200 bg-stone-50 p-3" key={workDate}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-black">{workDate}</p>
                          <button className={`h-9 rounded-md px-3 text-sm font-black text-white ${locked ? "bg-stone-300" : "bg-stone-900"}`} disabled={locked} onClick={() => addManualPunch(workDate)} type="button">
                            打刻を追加
                          </button>
                        </div>
                        {locked ? <p className="mt-2 rounded-md bg-white px-3 py-2 text-sm font-bold text-stone-500">給料日を過ぎた過去月のため編集できません。</p> : null}
                        <div className="mt-3 grid gap-2">
                          {draft.punches.length === 0 ? (
                            <p className="rounded-md bg-white px-3 py-3 text-sm font-bold text-stone-500">打刻なし。このまま保存すると休みになります。</p>
                          ) : (
                            draft.punches.map((punch, index) => (
                              <div className="grid grid-cols-[1fr_1fr_auto] gap-2" key={punch.id}>
                                <select className="h-10 rounded-md border border-stone-300 bg-white px-2 text-sm font-bold outline-none disabled:bg-stone-100 disabled:text-stone-500" disabled={locked} onChange={(event) => updateManualPunch(workDate, punch.id, { type: event.target.value as PunchType })} value={punch.type}>
                                  <option value="start">勤務開始</option>
                                  <option value="end">勤務終了</option>
                                </select>
                                <input className="h-10 rounded-md border border-stone-300 bg-white px-3 text-base font-bold outline-none disabled:bg-stone-100 disabled:text-stone-500" disabled={locked} onChange={(event) => updateManualPunch(workDate, punch.id, { time: event.target.value })} type="time" value={punch.time} />
                                <button aria-label={`${index + 1}番目の打刻を削除`} className="h-10 rounded-md bg-rose-50 px-3 text-sm font-black text-rose-700 disabled:bg-stone-100 disabled:text-stone-400" disabled={locked} onClick={() => removeManualPunch(workDate, punch.id)} type="button">
                                  削除
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                        {summary ? (
                          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                            <div className="rounded-md bg-white px-3 py-2">
                              <p className="text-xs font-bold text-stone-500">勤務時間</p>
                              <p className="font-black">{formatDuration(summary.totalMinutes + summary.breakMinutes)}</p>
                            </div>
                            <div className="rounded-md bg-white px-3 py-2">
                              <p className="text-xs font-bold text-stone-500">休憩時間</p>
                              <p className="font-black">{formatDuration(summary.breakMinutes)}</p>
                            </div>
                            <div className="rounded-md bg-white px-3 py-2">
                              <p className="text-xs font-bold text-stone-500">実働時間</p>
                              <p className="font-black">{formatDuration(summary.totalMinutes)}</p>
                            </div>
                            <div className="rounded-md bg-white px-3 py-2">
                              <p className="text-xs font-bold text-stone-500">深夜時間</p>
                              <p className="font-black">{formatDuration(summary.nightMinutes)}</p>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">勤務開始と勤務終了の順番を確認してください。</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
                    <thead className="bg-stone-100 text-xs font-black text-stone-600">
                      <tr>
                        <th className="px-4 py-3">日付</th>
                        <th className="px-4 py-3">打刻履歴</th>
                        <th className="px-4 py-3">勤務時間</th>
                        <th className="px-4 py-3">休憩時間</th>
                        <th className="px-4 py-3">実働時間</th>
                        <th className="px-4 py-3">深夜時間</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthDays(manualMonth).map((workDate) => {
                        const record = manualRecordsByDate.get(workDate);
                        const draft = draftForDay(workDate, record);
                        const summary = draftSummary(workDate, draft);
                        const locked = isWorkDateLocked(workDate, now);
                        return (
                          <tr className="border-t border-stone-100 align-top" key={workDate}>
                            <td className="px-4 py-3 font-black">{workDate}</td>
                            <td className="px-4 py-3">
                              <div className="grid gap-2">
                                {draft.punches.length === 0 ? (
                                  <p className="text-sm font-bold text-stone-500">休み</p>
                                ) : (
                                  draft.punches.map((punch, index) => (
                                    <div className="grid grid-cols-[8rem_7rem_auto] gap-2" key={punch.id}>
                                      <select className="h-10 rounded-md border border-stone-300 px-2 font-bold outline-none disabled:bg-stone-100 disabled:text-stone-500" disabled={locked} onChange={(event) => updateManualPunch(workDate, punch.id, { type: event.target.value as PunchType })} value={punch.type}>
                                        <option value="start">勤務開始</option>
                                        <option value="end">勤務終了</option>
                                      </select>
                                      <input className="h-10 rounded-md border border-stone-300 px-3 font-bold outline-none disabled:bg-stone-100 disabled:text-stone-500" disabled={locked} onChange={(event) => updateManualPunch(workDate, punch.id, { time: event.target.value })} type="time" value={punch.time} />
                                      <button aria-label={`${index + 1}番目の打刻を削除`} className="h-10 rounded-md bg-rose-50 px-3 text-sm font-black text-rose-700 disabled:bg-stone-100 disabled:text-stone-400" disabled={locked} onClick={() => removeManualPunch(workDate, punch.id)} type="button">
                                        削除
                                      </button>
                                    </div>
                                  ))
                                )}
                                <button className={`h-9 w-fit rounded-md px-3 text-sm font-black text-white ${locked ? "bg-stone-300" : "bg-stone-900"}`} disabled={locked} onClick={() => addManualPunch(workDate)} type="button">
                                  打刻を追加
                                </button>
                                {locked ? <p className="text-sm font-bold text-stone-500">給料日を過ぎた過去月のため編集できません。</p> : null}
                                {!summary ? <p className="text-sm font-bold text-rose-700">勤務開始と勤務終了の順番を確認してください。</p> : null}
                              </div>
                            </td>
                            <td className="px-4 py-3">{summary ? formatDuration(summary.totalMinutes + summary.breakMinutes) : "-"}</td>
                            <td className="px-4 py-3">{summary ? formatDuration(summary.breakMinutes) : "-"}</td>
                            <td className="px-4 py-3 font-black">{summary ? formatDuration(summary.totalMinutes) : "-"}</td>
                            <td className="px-4 py-3">{summary ? formatDuration(summary.nightMinutes) : "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button className={`mt-4 h-11 rounded-md px-4 font-black text-white lg:hidden ${isWorkDateLocked(manualDate, now) ? "bg-stone-300" : "bg-emerald-700"}`} disabled={isWorkDateLocked(manualDate, now)} onClick={saveManualSingleDay} type="button">
                  {saveNotice || "保存"}
                </button>
                <button className={`mt-4 hidden h-11 rounded-md px-4 font-black text-white lg:inline-flex lg:items-center lg:justify-center ${isPastMonthLocked(manualMonth, now) ? "bg-stone-300" : "bg-emerald-700"}`} disabled={isPastMonthLocked(manualMonth, now)} onClick={saveManualMonth} type="button">
                  {saveNotice || "保存"}
                </button>
              </div>
            ) : null}

            {adminView === "records" ? (
              <div className="order-2 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
                  <h2 className="text-lg font-black">勤怠記録</h2>
                  <div className="flex flex-wrap gap-2">
                    <select className="h-10 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => setRecordEmployeeId(event.target.value)} value={recordEmployeeId}>
                      <option value="all">全体</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                    <input className="h-10 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => setRecordMonth(event.target.value)} type="month" value={recordMonth} />
                    <button className="h-10 rounded-md bg-stone-900 px-4 text-sm font-black text-white" onClick={exportRecordsCsv} type="button">
                      CSV出力
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 p-3 lg:hidden">
                  {visibleRecords.length === 0 ? (
                    <p className="px-4 py-8 text-center font-bold text-stone-500">この月の勤怠記録はまだありません。</p>
                  ) : (
                    visibleRecords.map((record) => {
                      const employee = employeeById.get(record.employeeId);
                      const cost = laborCost(record, employee, now);
                      return (
                        <div className="rounded-md border border-stone-200 bg-stone-50 p-3" key={record.id}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-black">{record.workDate}</p>
                              <p className="text-sm font-bold text-stone-500">{employee?.name ?? "不明"}</p>
                            </div>
                            <button className="h-9 rounded-md bg-rose-50 px-3 text-sm font-black text-rose-700 disabled:bg-stone-100 disabled:text-stone-400" disabled={isWorkDateLocked(record.workDate, now)} onClick={() => handleDeleteRecord(record.id)} type="button">
                              削除
                            </button>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                            <div className="rounded-md bg-white px-3 py-2">
                              <p className="text-xs font-bold text-stone-500">勤務開始</p>
                              <p className="font-black">{startDisplay(record)}</p>
                            </div>
                            <div className="rounded-md bg-white px-3 py-2">
                              <p className="text-xs font-bold text-stone-500">勤務終了</p>
                              <p className="font-black">{endDisplay(record)}</p>
                            </div>
                            <div className="rounded-md bg-white px-3 py-2">
                              <p className="text-xs font-bold text-stone-500">休憩</p>
                              <p className="font-black">{formatDuration(calculatedBreakMinutes(record))}</p>
                            </div>
                            <div className="rounded-md bg-white px-3 py-2">
                              <p className="text-xs font-bold text-stone-500">勤務時間</p>
                              <p className="font-black">{formatDuration(record.totalMinutes)}</p>
                            </div>
                            <div className="rounded-md bg-white px-3 py-2">
                              <p className="text-xs font-bold text-stone-500">深夜</p>
                              <p className="font-black">{formatDuration(record.nightMinutes)}</p>
                            </div>
                            <div className="rounded-md bg-white px-3 py-2">
                              <p className="text-xs font-bold text-stone-500">人件費</p>
                              <p className="font-black">{cost === null ? "-" : formatYen(cost)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                    <thead className="bg-stone-100 text-xs font-black text-stone-600">
                      <tr>
                        <th className="px-4 py-3">日付</th>
                        <th className="px-4 py-3">氏名</th>
                        <th className="px-4 py-3">勤務開始</th>
                        <th className="px-4 py-3">勤務終了</th>
                        <th className="px-4 py-3">休憩時間</th>
                        <th className="px-4 py-3">勤務時間</th>
                        <th className="px-4 py-3">深夜時間</th>
                        <th className="px-4 py-3">人件費</th>
                        <th className="px-4 py-3">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRecords.length === 0 ? (
                        <tr>
                          <td className="px-4 py-8 text-center font-bold text-stone-500" colSpan={9}>
                            この月の勤怠記録はまだありません。
                          </td>
                        </tr>
                      ) : (
                        visibleRecords.map((record) => {
                          const employee = employeeById.get(record.employeeId);
                          const cost = laborCost(record, employee, now);
                          return (
                            <tr className="border-t border-stone-100" key={record.id}>
                              <td className="px-4 py-3 font-bold">{record.workDate}</td>
                              <td className="px-4 py-3 font-black">{employee?.name ?? "不明"}</td>
                              <td className="px-4 py-3">{startDisplay(record)}</td>
                              <td className="px-4 py-3">{endDisplay(record)}</td>
                              <td className="px-4 py-3">{formatDuration(calculatedBreakMinutes(record))}</td>
                              <td className="px-4 py-3 font-black">{formatDuration(record.totalMinutes)}</td>
                              <td className="px-4 py-3">{formatDuration(record.nightMinutes)}</td>
                              <td className="px-4 py-3 font-black">{cost === null ? "-" : formatYen(cost)}</td>
                              <td className="px-4 py-3">
                                <button className="h-9 rounded-md bg-rose-50 px-3 text-sm font-black text-rose-700 disabled:bg-stone-100 disabled:text-stone-400" disabled={isWorkDateLocked(record.workDate, now)} onClick={() => handleDeleteRecord(record.id)} type="button">
                                  削除
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {adminView === "records" ? (
              <div className="order-1 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-black">月次サマリー</h2>
                  <div className="flex flex-wrap gap-2">
                    <input className="h-10 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => setSummaryMonth(event.target.value)} type="month" value={summaryMonth} />
                    <button className="h-10 rounded-md bg-stone-900 px-4 text-sm font-black text-white" onClick={exportSummaryCsv} type="button">
                      CSV出力
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {summaryRows.map((summary) => (
                    <div className="rounded-md border border-stone-200 bg-stone-50 p-3" key={summary.employee.id}>
                      <p className="truncate font-black">{summary.employee.name}</p>
                      <p className="mt-2 text-2xl font-black">{formatDuration(summary.totalMinutes)}</p>
                      <p className="text-sm font-bold text-stone-500">深夜 {formatDuration(summary.nightMinutes)}</p>
                      <p className="mt-2 text-lg font-black">{formatYen(summary.pay)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
