import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type PayType = "hourly" | "monthly";

type Employee = {
  id: string;
  name: string;
  role: string;
  staffCode: string;
  payType: PayType;
  payAmount: number;
  hourlyWage: number;
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
  activeStartedAt: string | null;
  status: WorkStatus;
  punches: Punch[];
};

type AttendanceStore = {
  employees: Employee[];
  records: WorkDayRecord[];
};

const DEFAULT_ADMIN_CODE = "0622";

const seedEmployees: Employee[] = [
  { id: "emp-manager", name: "店長", role: "管理者", staffCode: DEFAULT_ADMIN_CODE, payType: "hourly", payAmount: 1500, hourlyWage: 1500 },
  { id: "emp-staff-a", name: "佐藤", role: "スタッフ", staffCode: "1001", payType: "hourly", payAmount: 1200, hourlyWage: 1200 },
  { id: "emp-staff-b", name: "鈴木", role: "スタッフ", staffCode: "1002", payType: "hourly", payAmount: 1200, hourlyWage: 1200 }
];

const dataDir = process.env.ATTENDANCE_DATA_DIR ?? path.join(process.cwd(), "data");
const storePath = path.join(dataDir, "attendance-store.json");
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(supabaseUrl && supabaseServiceRoleKey);

function businessStart(workDate: string) {
  return new Date(`${workDate}T07:00:00`);
}

function businessEnd(workDate: string) {
  const end = businessStart(workDate);
  end.setDate(end.getDate() + 1);
  return end;
}

function normalizeEmployee(employee: Partial<Employee> & { id?: string }, index: number): Employee {
  const seed = seedEmployees[index] ?? null;
  const hourlyWage = Number(employee.hourlyWage ?? seed?.hourlyWage ?? 1200);
  const payType: PayType = employee.payType === "monthly" ? "monthly" : "hourly";
  const payAmount = Number(employee.payAmount ?? employee.hourlyWage ?? seed?.payAmount ?? 1200);

  return {
    id: employee.id || `emp-${index + 1}`,
    name: employee.name?.trim() || seed?.name || `スタッフ${index + 1}`,
    role: employee.role?.trim() || seed?.role || "スタッフ",
    staffCode: String(employee.staffCode || seed?.staffCode || 1000 + index),
    payType,
    payAmount: Number.isFinite(payAmount) && payAmount >= 0 ? Math.floor(payAmount) : 1200,
    hourlyWage: Number.isFinite(hourlyWage) && hourlyWage >= 0 ? Math.floor(hourlyWage) : 1200
  };
}

function normalizeRecord(record: Partial<WorkDayRecord> & { id?: string; employeeId?: string }): WorkDayRecord | null {
  if (!record.id || !record.employeeId || !record.workDate) return null;
  const status: WorkStatus = record.status === "working" || record.status === "missing" || record.status === "off" ? record.status : "registered";
  const totalMinutes = Number(record.totalMinutes ?? 0);
  const nightMinutes = Number(record.nightMinutes ?? 0);
  const breakMinutes = Number(record.breakMinutes ?? 0);
  const punches = Array.isArray(record.punches)
    ? record.punches.filter((punch): punch is Punch => Boolean(punch?.id && (punch.type === "start" || punch.type === "end") && punch.at))
    : [];
  if (punches.length === 0 && record.activeStartedAt) {
    punches.push({ id: `punch-${record.id}`, type: "start", at: record.activeStartedAt });
  }

  return {
    id: record.id,
    employeeId: record.employeeId,
    workDate: record.workDate,
    totalMinutes: Number.isFinite(totalMinutes) ? Math.max(0, Math.floor(totalMinutes)) : 0,
    nightMinutes: Number.isFinite(nightMinutes) ? Math.max(0, Math.floor(nightMinutes)) : 0,
    breakMinutes: Number.isFinite(breakMinutes) ? Math.max(0, Math.floor(breakMinutes)) : 0,
    activeStartedAt: record.activeStartedAt ?? null,
    status,
    punches
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

function normalizeStore(store: Partial<AttendanceStore>): AttendanceStore {
  const employees = Array.isArray(store.employees) && store.employees.length > 0 ? store.employees.map(normalizeEmployee) : seedEmployees;
  const employeeIds = new Set(employees.map((employee) => employee.id));
  const records = (Array.isArray(store.records) ? store.records : [])
    .map(normalizeRecord)
    .filter((record): record is WorkDayRecord => Boolean(record))
    .filter((record) => employeeIds.has(record.employeeId));

  return {
    employees,
    records: closeExpiredRecords(records, new Date())
  };
}

async function readStore(): Promise<AttendanceStore> {
  if (useSupabase) return readSupabaseStore();

  try {
    const raw = await readFile(storePath, "utf8");
    return normalizeStore(JSON.parse(raw) as Partial<AttendanceStore>);
  } catch {
    return { employees: seedEmployees, records: [] };
  }
}

async function writeStore(store: AttendanceStore) {
  if (useSupabase) {
    await writeSupabaseStore(store);
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function supabaseRequest(pathname: string, init: RequestInit = {}) {
  if (!supabaseUrl || !supabaseServiceRoleKey) throw new Error("Supabase environment variables are missing.");
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/${pathname}`, {
    ...init,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      ...init.headers
    }
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${details}`);
  }

  return response;
}

async function readSupabaseStore(): Promise<AttendanceStore> {
  const response = await supabaseRequest("attendance_store?select=payload&id=eq.main&limit=1");
  const rows = (await response.json()) as Array<{ payload: Partial<AttendanceStore> }>;
  if (rows.length > 0) return normalizeStore(rows[0].payload);

  const initialStore = { employees: seedEmployees, records: [] };
  await writeSupabaseStore(initialStore);
  return initialStore;
}

async function writeSupabaseStore(store: AttendanceStore) {
  const normalizedStore = normalizeStore(store);
  await supabaseRequest("attendance_store?on_conflict=id", {
    body: JSON.stringify({
      id: "main",
      payload: normalizedStore,
      updated_at: new Date().toISOString()
    }),
    headers: {
      Prefer: "resolution=merge-duplicates"
    },
    method: "POST"
  });
}

export async function GET() {
  const store = await readStore();
  await writeStore(store);
  return NextResponse.json(store);
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Partial<AttendanceStore>;
  const store = normalizeStore(payload);
  await writeStore(store);
  return NextResponse.json(store);
}
