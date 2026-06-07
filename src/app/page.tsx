"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Employee = {
  id: string;
  name: string;
  role: string;
  staffCode: string;
  hourlyWage: number;
};

type StoredEmployee = Partial<Employee> & {
  id: string;
  name?: string;
  role?: string;
};

type WorkStatus = "registered" | "working" | "missing";

type WorkDayRecord = {
  id: string;
  employeeId: string;
  workDate: string;
  totalMinutes: number;
  nightMinutes: number;
  activeStartedAt: string | null;
  status: WorkStatus;
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

type DraftRecord = {
  employeeId: string;
  workDate: string;
  totalHours: string;
  nightHours: string;
  status: WorkStatus;
};

type AttendanceStore = {
  employees: Employee[];
  records: WorkDayRecord[];
};

const ADMIN_PIN = "19788011";

const seedEmployees: Employee[] = [
  { id: "emp-manager", name: "店長", role: "管理者", staffCode: "1000", hourlyWage: 1500 },
  { id: "emp-staff-a", name: "佐藤", role: "スタッフ", staffCode: "1001", hourlyWage: 1200 },
  { id: "emp-staff-b", name: "鈴木", role: "スタッフ", staffCode: "1002", hourlyWage: 1200 }
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

function parseLocalDateTime(value: string) {
  return new Date(value);
}

function businessDate(date: Date) {
  const workDate = new Date(date);
  if (workDate.getHours() < 7) workDate.setDate(workDate.getDate() - 1);
  return dateKey(workDate);
}

function businessStart(workDate: string) {
  return new Date(`${workDate}T07:00:00`);
}

function businessEnd(workDate: string) {
  const end = businessStart(workDate);
  end.setDate(end.getDate() + 1);
  return end;
}

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
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

function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}時間${String(minutes).padStart(2, "0")}分`;
}

function formatYen(value: number) {
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function laborCost(minutes: number, hourlyWage: number) {
  return (minutes / 60) * Math.max(0, hourlyWage);
}

function normalizeEmployee(employee: StoredEmployee, index: number): Employee {
  const seed = seedEmployees[index] ?? null;
  const hourlyWage = Number(employee.hourlyWage ?? seed?.hourlyWage ?? 1200);

  return {
    id: employee.id,
    name: employee.name?.trim() || seed?.name || `スタッフ${index + 1}`,
    role: employee.role?.trim() || seed?.role || "スタッフ",
    staffCode: String(employee.staffCode || seed?.staffCode || 1000 + index),
    hourlyWage: Number.isFinite(hourlyWage) && hourlyWage >= 0 ? Math.floor(hourlyWage) : 1200
  };
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

function migrateLegacyRecord(record: StoredWorkDayRecord): WorkDayRecord {
  const workDate = record.workDate ?? record.date ?? businessDate(new Date());
  const startMinutes = minutesFromTime(record.clockIn ?? "");
  const endMinutes = minutesFromTime(record.clockOut ?? "");
  let totalMinutes = Number(record.totalMinutes ?? 0);
  let nightMinutes = Number(record.nightMinutes ?? 0);
  let status: WorkStatus = record.status ?? "registered";

  if (!record.workDate && record.date && startMinutes !== null && endMinutes !== null) {
    const start = new Date(`${record.date}T${record.clockIn}`);
    const end = new Date(`${record.date}T${record.clockOut}`);
    if (endMinutes < startMinutes) end.setDate(end.getDate() + 1);
    totalMinutes = Math.max(0, intervalMinutes(start, end) - oldBreakMinutes(record));
    nightMinutes = nightMinutesBetween(start, end);
    status = totalMinutes > 0 ? "registered" : "missing";
  }

  return {
    id: record.id,
    employeeId: record.employeeId,
    workDate,
    totalMinutes: Number.isFinite(totalMinutes) ? Math.max(0, Math.floor(totalMinutes)) : 0,
    nightMinutes: Number.isFinite(nightMinutes) ? Math.max(0, Math.floor(nightMinutes)) : 0,
    activeStartedAt: record.activeStartedAt ?? null,
    status
  };
}

function recordWithRealtime(record: WorkDayRecord, now: Date) {
  if (!record.activeStartedAt || record.status !== "working") return record;
  const startedAt = parseLocalDateTime(record.activeStartedAt);
  const cappedNow = new Date(Math.min(now.getTime(), businessEnd(record.workDate).getTime()));
  return {
    ...record,
    totalMinutes: record.totalMinutes + intervalMinutes(startedAt, cappedNow),
    nightMinutes: record.nightMinutes + nightMinutesBetween(startedAt, cappedNow)
  };
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
  return "登録済み";
}

function toCsvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export default function AttendancePage() {
  const [employees, setEmployees] = useState<Employee[]>(seedEmployees);
  const [records, setRecords] = useState<WorkDayRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dataError, setDataError] = useState("");
  const [currentStaffId, setCurrentStaffId] = useState("");
  const [staffCodeInput, setStaffCodeInput] = useState("");
  const [staffCodeError, setStaffCodeError] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [now, setNow] = useState(new Date());
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newEmployeeRole, setNewEmployeeRole] = useState("スタッフ");
  const [newEmployeeCode, setNewEmployeeCode] = useState("");
  const [newHourlyWage, setNewHourlyWage] = useState("1200");
  const [draft, setDraft] = useState<DraftRecord>({
    employeeId: seedEmployees[0].id,
    workDate: businessDate(new Date()),
    totalHours: "8",
    nightHours: "0",
    status: "registered"
  });
  const [adminMode, setAdminMode] = useState(false);
  const [adminPin, setAdminPin] = useState("");
  const [adminError, setAdminError] = useState("");
  const [message, setMessage] = useState("");
  const hasLoadedStore = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSharedStore() {
      try {
        const response = await fetch("/api/attendance", { cache: "no-store" });
        if (!response.ok) throw new Error("共有データを読み込めませんでした。");
        const store = (await response.json()) as AttendanceStore;
        if (!isMounted) return;
        const normalizedEmployees = (store.employees.length > 0 ? store.employees : seedEmployees).map(normalizeEmployee);
        const normalizedRecords = closeExpiredRecords(store.records.map(migrateLegacyRecord), new Date());
        setEmployees(normalizedEmployees);
        setRecords(normalizedRecords);
        setDraft((current) => ({ ...current, employeeId: normalizedEmployees[0]?.id ?? seedEmployees[0].id }));
        setDataError("");
      } catch {
        if (isMounted) setDataError("共有データに接続できません。アプリを起動しているPCを確認してください。");
      } finally {
        if (isMounted) {
          hasLoadedStore.current = true;
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
    const timer = window.setInterval(() => {
      const current = new Date();
      setNow(current);
      setRecords((existing) => closeExpiredRecords(existing, current));

      void fetch("/api/attendance", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((store: AttendanceStore | null) => {
          if (!store) return;
          setEmployees((store.employees.length > 0 ? store.employees : seedEmployees).map(normalizeEmployee));
          setRecords(closeExpiredRecords(store.records.map(migrateLegacyRecord), new Date()));
          setDataError("");
        })
        .catch(() => setDataError("共有データとの同期が止まっています。"));
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!hasLoadedStore.current) return;
    const controller = new AbortController();
    const saveTimer = window.setTimeout(() => {
      setIsSaving(true);
      void fetch("/api/attendance", {
        body: JSON.stringify({ employees, records }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal
      })
        .then((response) => {
          if (!response.ok) throw new Error("保存できませんでした。");
          setDataError("");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setDataError("共有データを保存できません。アプリを起動しているPCを確認してください。");
        })
        .finally(() => setIsSaving(false));
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(saveTimer);
    };
  }, [employees, records]);

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const currentStaff = employeeById.get(currentStaffId) ?? null;
  const currentWorkDate = businessDate(now);
  const currentRecord = currentStaff
    ? records.find((record) => record.employeeId === currentStaff.id && record.workDate === currentWorkDate)
    : null;
  const currentRealtimeRecord = currentRecord ? recordWithRealtime(currentRecord, now) : null;
  const currentIsWorking = currentRecord?.status === "working" && Boolean(currentRecord.activeStartedAt);

  const monthRecords = useMemo(
    () =>
      records
        .filter((record) => record.workDate.startsWith(selectedMonth))
        .sort((a, b) => b.workDate.localeCompare(a.workDate)),
    [records, selectedMonth]
  );

  const summaries = useMemo(
    () =>
      employees.map((employee) => {
        const employeeRecords = monthRecords
          .filter((record) => record.employeeId === employee.id)
          .map((record) => recordWithRealtime(record, now));
        const totalMinutes = employeeRecords.reduce((sum, record) => sum + record.totalMinutes, 0);
        const nightMinutes = employeeRecords.reduce((sum, record) => sum + record.nightMinutes, 0);
        return {
          employee,
          days: employeeRecords.length,
          totalMinutes,
          nightMinutes,
          totalPay: laborCost(totalMinutes, employee.hourlyWage)
        };
      }),
    [employees, monthRecords, now]
  );

  const currentMonthSummary = useMemo(() => {
    if (!currentStaff) return null;
    const staffMonthRecords = records
      .filter((record) => record.employeeId === currentStaff.id && record.workDate.startsWith(currentWorkDate.slice(0, 7)))
      .map((record) => recordWithRealtime(record, now));
    return {
      totalMinutes: staffMonthRecords.reduce((sum, record) => sum + record.totalMinutes, 0),
      nightMinutes: staffMonthRecords.reduce((sum, record) => sum + record.nightMinutes, 0)
    };
  }, [currentStaff, currentWorkDate, records, now]);

  function upsertRecord(nextRecord: WorkDayRecord) {
    setRecords((current) => {
      const existingIndex = current.findIndex((record) => record.employeeId === nextRecord.employeeId && record.workDate === nextRecord.workDate);
      if (existingIndex >= 0) return current.map((record, index) => (index === existingIndex ? { ...nextRecord, id: record.id } : record));
      return [nextRecord, ...current];
    });
  }

  function findEmployeeByCode(code: string) {
    const normalizedCode = code.trim();
    return employees.find((employee) => employee.staffCode === normalizedCode) ?? null;
  }

  function codeExists(code: string, exceptEmployeeId?: string) {
    const normalizedCode = code.trim();
    if (!normalizedCode) return false;
    return employees.some((employee) => employee.id !== exceptEmployeeId && employee.staffCode === normalizedCode);
  }

  function handleStaffLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const employee = findEmployeeByCode(staffCodeInput);
    if (!employee) {
      setStaffCodeError("スタッフコードが見つかりません。");
      return;
    }

    setCurrentStaffId(employee.id);
    setStaffCodeInput("");
    setStaffCodeError("");
    setMessage(`${employee.name}さんでログインしました。`);
  }

  function handleStaffLogout() {
    setCurrentStaffId("");
    setMessage("");
  }

  function handleWorkToggle() {
    if (!currentStaff) return;
    const timestamp = new Date();
    const workDate = businessDate(timestamp);
    const existing = records.find((record) => record.employeeId === currentStaff.id && record.workDate === workDate);

    if (!existing || existing.status !== "working" || !existing.activeStartedAt) {
      upsertRecord({
        id: existing?.id ?? createId("work-day"),
        employeeId: currentStaff.id,
        workDate,
        totalMinutes: existing?.status === "missing" ? 0 : existing?.totalMinutes ?? 0,
        nightMinutes: existing?.status === "missing" ? 0 : existing?.nightMinutes ?? 0,
        activeStartedAt: localDateTime(timestamp),
        status: "working"
      });
      setMessage("勤務開始を記録しました。");
      return;
    }

    const startedAt = parseLocalDateTime(existing.activeStartedAt);
    const endAt = new Date(Math.min(timestamp.getTime(), businessEnd(existing.workDate).getTime()));
    upsertRecord({
      ...existing,
      totalMinutes: existing.totalMinutes + intervalMinutes(startedAt, endAt),
      nightMinutes: existing.nightMinutes + nightMinutesBetween(startedAt, endAt),
      activeStartedAt: null,
      status: "registered"
    });
    setMessage("勤務終了を記録しました。");
  }

  function handleAdminLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adminPin !== ADMIN_PIN) {
      setAdminError("管理者専用コードが違います。");
      return;
    }
    setAdminMode(true);
    setCurrentStaffId("");
    setAdminPin("");
    setAdminError("");
    setMessage("管理者メニューを開きました。");
  }

  function handleAdminLogout() {
    setAdminMode(false);
    setAdminPin("");
    setAdminError("");
    setMessage("");
  }

  function handleAddEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminMode) return;
    const name = newEmployeeName.trim();
    const role = newEmployeeRole.trim() || "スタッフ";
    const staffCode = newEmployeeCode.trim();
    const hourlyWage = Math.max(0, Math.floor(Number(newHourlyWage) || 0));
    if (!name || !staffCode) {
      setMessage("氏名とスタッフコードを入力してください。");
      return;
    }
    if (codeExists(staffCode)) {
      setMessage("同じスタッフコードは使えません。");
      return;
    }

    const employee = { id: createId("emp"), name, role, staffCode, hourlyWage };
    setEmployees((current) => [...current, employee]);
    setDraft((current) => ({ ...current, employeeId: employee.id }));
    setNewEmployeeName("");
    setNewEmployeeRole("スタッフ");
    setNewEmployeeCode("");
    setNewHourlyWage("1200");
    setMessage(`${name}さんを追加しました。`);
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

    setEmployees((current) =>
      current.map((employee) =>
        employee.id === employeeId
          ? {
              ...employee,
              ...patch,
              staffCode: patch.staffCode === undefined ? employee.staffCode : patch.staffCode.trim(),
              hourlyWage: patch.hourlyWage === undefined ? employee.hourlyWage : Math.max(0, Math.floor(patch.hourlyWage))
            }
          : employee
      )
    );
  }

  function handleDeleteEmployee(employeeId: string) {
    if (!adminMode) return;
    if (employees.length <= 1) {
      setMessage("メンバーは1人以上必要です。");
      return;
    }
    const employee = employeeById.get(employeeId);
    setEmployees((current) => current.filter((item) => item.id !== employeeId));
    setRecords((current) => current.filter((record) => record.employeeId !== employeeId));
    setMessage(`${employee?.name ?? "メンバー"}さんを削除しました。`);
  }

  function handleDraftSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminMode) return;
    const existing = records.find((record) => record.employeeId === draft.employeeId && record.workDate === draft.workDate);
    upsertRecord({
      id: existing?.id ?? createId("work-day"),
      employeeId: draft.employeeId,
      workDate: draft.workDate,
      totalMinutes: draft.status === "missing" ? 0 : minutesFromHours(draft.totalHours),
      nightMinutes: draft.status === "missing" ? 0 : minutesFromHours(draft.nightHours),
      activeStartedAt: null,
      status: draft.status
    });
    setMessage("勤怠記録を保存しました。");
  }

  function handleDeleteRecord(recordId: string) {
    if (!adminMode) return;
    setRecords((current) => current.filter((record) => record.id !== recordId));
    setMessage("勤怠記録を削除しました。");
  }

  function exportCsv() {
    if (!adminMode) return;
    const header = ["日付", "氏名", "役割", "スタッフコード", "時給", "状態", "勤務時間", "深夜時間", "概算人件費"];
    const body = monthRecords.map((record) => {
      const employee = employeeById.get(record.employeeId);
      const realtimeRecord = recordWithRealtime(record, now);
      return [
        realtimeRecord.workDate,
        employee?.name ?? "不明",
        employee?.role ?? "",
        employee?.staffCode ?? "",
        employee?.hourlyWage ?? 0,
        statusLabel(realtimeRecord.status),
        formatDuration(realtimeRecord.totalMinutes),
        formatDuration(realtimeRecord.nightMinutes),
        Math.round(laborCost(realtimeRecord.totalMinutes, employee?.hourlyWage ?? 0))
      ];
    });
    const csv = [header, ...body].map((row) => row.map(toCsvCell).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `attendance-${selectedMonth}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

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
          <p className="mt-2 text-sm font-bold leading-6 text-stone-600">スタッフは自分のスタッフコードで打刻画面を開きます。</p>

          <form className="mt-5 grid gap-3" onSubmit={handleStaffLogin}>
            <label className="grid gap-2 text-sm font-bold text-stone-600">
              スタッフコード
              <input
                autoComplete="one-time-code"
                className="h-14 rounded-md border border-stone-300 bg-white px-4 text-center text-2xl font-black tracking-[0.18em] outline-none"
                inputMode="numeric"
                onChange={(event) => setStaffCodeInput(event.target.value)}
                placeholder="コード"
                type="password"
                value={staffCodeInput}
              />
            </label>
            <button className="h-12 rounded-md bg-emerald-700 px-4 font-black text-white" type="submit">
              打刻画面を開く
            </button>
            {staffCodeError ? <p className="text-sm font-bold text-rose-700">{staffCodeError}</p> : null}
          </form>

          <form className="mt-5 border-t border-stone-200 pt-5" onSubmit={handleAdminLogin}>
            <label className="grid gap-2 text-sm font-bold text-stone-600">
              管理者専用コード
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none"
                  inputMode="numeric"
                  onChange={(event) => setAdminPin(event.target.value)}
                  placeholder="管理者コード"
                  type="password"
                  value={adminPin}
                />
                <button className="h-11 rounded-md bg-stone-900 px-4 text-sm font-black text-white" type="submit">
                  管理者メニューを開く
                </button>
              </div>
            </label>
            {adminError ? <p className="mt-2 text-sm font-bold text-rose-700">{adminError}</p> : null}
          </form>
          {dataError ? <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{dataError}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-stone-50 text-stone-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5">
          <div>
            <p className="text-sm font-bold text-emerald-700">勤怠管理</p>
            <h1 className="text-2xl font-black leading-tight sm:text-3xl">{adminMode ? "管理者メニュー" : "スタッフ打刻"}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="grid min-w-36 gap-1 rounded-md border border-stone-200 bg-stone-50 px-4 py-3 text-right">
              <span className="text-xs font-bold text-stone-500">営業日</span>
              <span className="text-lg font-black">{currentWorkDate}</span>
            </div>
            <div className={`grid min-w-28 gap-1 rounded-md border px-4 py-3 text-right ${dataError ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
              <span className="text-xs font-bold">{dataError ? "共有エラー" : "共有保存"}</span>
              <span className="text-sm font-black">{dataError ? "要確認" : isSaving ? "保存中" : "同期中"}</span>
            </div>
            <button className="h-11 rounded-md border border-stone-300 bg-white px-4 text-sm font-black text-stone-700" onClick={adminMode ? handleAdminLogout : handleStaffLogout} type="button">
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4">
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
              <button
                className={`h-16 rounded-md px-4 text-xl font-black text-white shadow-sm ${currentIsWorking ? "bg-stone-900" : "bg-emerald-600"}`}
                onClick={handleWorkToggle}
                type="button"
              >
                {currentIsWorking ? "勤務終了" : "勤務開始"}
              </button>

              <div className="grid grid-cols-1 gap-2 text-center text-sm sm:grid-cols-3">
                <div className="rounded-md bg-white p-3">
                  <p className="font-bold text-stone-500">本日の勤務</p>
                  <p className="text-xl font-black">{currentRealtimeRecord ? formatDuration(currentRealtimeRecord.totalMinutes) : "0時間00分"}</p>
                </div>
                <div className="rounded-md bg-white p-3">
                  <p className="font-bold text-stone-500">当月の勤務</p>
                  <p className="text-xl font-black">{currentMonthSummary ? formatDuration(currentMonthSummary.totalMinutes) : "0時間00分"}</p>
                </div>
                <div className="rounded-md bg-white p-3">
                  <p className="font-bold text-stone-500">当月の深夜</p>
                  <p className="text-xl font-black">{currentMonthSummary ? formatDuration(currentMonthSummary.nightMinutes) : "0時間00分"}</p>
                </div>
              </div>

              {currentRealtimeRecord?.status === "missing" ? (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
                  前回の勤務終了が未登録です。管理者に修正を依頼してください。
                </p>
              ) : null}
            </div>
            {message ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{message}</p> : null}
          </section>
        ) : null}

        {adminMode ? (
          <section className="grid content-start gap-4">
            {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{message}</p> : null}
            <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-black">月次サマリー</h2>
                <div className="flex flex-wrap gap-2">
                  <input className="h-10 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => setSelectedMonth(event.target.value)} type="month" value={selectedMonth} />
                  <button className="h-10 rounded-md bg-stone-900 px-4 text-sm font-black text-white" onClick={exportCsv} type="button">
                    CSV出力
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {summaries.map((summary) => (
                  <div className="rounded-md border border-stone-200 bg-stone-50 p-3" key={summary.employee.id}>
                    <p className="truncate font-black">{summary.employee.name}</p>
                    <p className="mt-2 text-2xl font-black">{formatDuration(summary.totalMinutes)}</p>
                    <p className="text-sm font-bold text-stone-500">深夜 {formatDuration(summary.nightMinutes)} / {formatYen(summary.totalPay)}</p>
                  </div>
                ))}
              </div>
            </div>

            <form className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm" onSubmit={handleAddEmployee}>
              <h2 className="text-lg font-black">メンバー追加</h2>
              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_140px_120px_auto]">
                <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => setNewEmployeeName(event.target.value)} placeholder="氏名" value={newEmployeeName} />
                <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => setNewEmployeeRole(event.target.value)} placeholder="役割" value={newEmployeeRole} />
                <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" inputMode="numeric" onChange={(event) => setNewEmployeeCode(event.target.value)} placeholder="スタッフコード" value={newEmployeeCode} />
                <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" inputMode="numeric" onChange={(event) => setNewHourlyWage(event.target.value)} placeholder="時給" type="number" value={newHourlyWage} />
                <button className="h-11 rounded-md bg-sky-700 px-4 font-black text-white" type="submit">
                  追加
                </button>
              </div>
            </form>

            <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-black">メンバー編集</h2>
              <div className="mt-4 grid gap-3">
                {employees.map((employee) => (
                  <div className="grid gap-2 rounded-md bg-stone-50 p-3 lg:grid-cols-[1fr_1fr_140px_130px_auto]" key={employee.id}>
                    <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => updateEmployee(employee.id, { name: event.target.value })} value={employee.name} />
                    <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => updateEmployee(employee.id, { role: event.target.value })} value={employee.role} />
                    <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" inputMode="numeric" onChange={(event) => updateEmployee(employee.id, { staffCode: event.target.value })} value={employee.staffCode} />
                    <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" inputMode="numeric" onChange={(event) => updateEmployee(employee.id, { hourlyWage: Number(event.target.value) || 0 })} type="number" value={employee.hourlyWage} />
                    <button className="h-11 rounded-md bg-rose-50 px-3 text-sm font-black text-rose-700" onClick={() => handleDeleteEmployee(employee.id)} type="button">
                      削除
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <form className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm" onSubmit={handleDraftSubmit}>
              <h2 className="text-lg font-black">手入力・修正</h2>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <select className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => setDraft((current) => ({ ...current, employeeId: event.target.value }))} value={draft.employeeId}>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
                <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => setDraft((current) => ({ ...current, workDate: event.target.value }))} type="date" value={draft.workDate} />
                <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" inputMode="decimal" onChange={(event) => setDraft((current) => ({ ...current, totalHours: event.target.value }))} placeholder="勤務時間" type="number" value={draft.totalHours} />
                <input className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" inputMode="decimal" onChange={(event) => setDraft((current) => ({ ...current, nightHours: event.target.value }))} placeholder="深夜時間" type="number" value={draft.nightHours} />
                <select className="h-11 rounded-md border border-stone-300 bg-white px-3 font-bold outline-none" onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as WorkStatus }))} value={draft.status}>
                  <option value="registered">登録済み</option>
                  <option value="missing">未登録</option>
                </select>
              </div>
              <button className="mt-3 h-11 rounded-md bg-emerald-700 px-4 font-black text-white" type="submit">
                保存
              </button>
            </form>

            <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
              <div className="border-b border-stone-200 px-4 py-3">
                <h2 className="text-lg font-black">勤怠記録</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                  <thead className="bg-stone-100 text-xs font-black text-stone-600">
                    <tr>
                      <th className="px-4 py-3">営業日</th>
                      <th className="px-4 py-3">氏名</th>
                      <th className="px-4 py-3">コード</th>
                      <th className="px-4 py-3">状態</th>
                      <th className="px-4 py-3">勤務時間</th>
                      <th className="px-4 py-3">深夜時間</th>
                      <th className="px-4 py-3">人件費</th>
                      <th className="px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthRecords.length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center font-bold text-stone-500" colSpan={8}>
                          この月の勤怠記録はまだありません。
                        </td>
                      </tr>
                    ) : (
                      monthRecords.map((record) => {
                        const employee = employeeById.get(record.employeeId);
                        const realtimeRecord = recordWithRealtime(record, now);
                        return (
                          <tr className="border-t border-stone-100" key={record.id}>
                            <td className="px-4 py-3 font-bold">{realtimeRecord.workDate}</td>
                            <td className="px-4 py-3 font-black">{employee?.name ?? "不明"}</td>
                            <td className="px-4 py-3">{employee?.staffCode ?? "-"}</td>
                            <td className="px-4 py-3 font-black">{statusLabel(realtimeRecord.status)}</td>
                            <td className="px-4 py-3 font-black">{formatDuration(realtimeRecord.totalMinutes)}</td>
                            <td className="px-4 py-3">{formatDuration(realtimeRecord.nightMinutes)}</td>
                            <td className="px-4 py-3 font-black">{formatYen(laborCost(realtimeRecord.totalMinutes, employee?.hourlyWage ?? 0))}</td>
                            <td className="px-4 py-3">
                              <button className="h-9 rounded-md bg-rose-50 px-3 text-sm font-black text-rose-700" onClick={() => handleDeleteRecord(record.id)} type="button">
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
          </section>
        ) : null}
      </div>
    </main>
  );
}
