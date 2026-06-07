create table if not exists public.attendance_store (
  id text primary key,
  payload jsonb not null default '{"employees":[],"records":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.attendance_store enable row level security;

revoke all on public.attendance_store from anon;
revoke all on public.attendance_store from authenticated;
grant select, insert, update, delete on public.attendance_store to service_role;

insert into public.attendance_store (id, payload)
values (
  'main',
  '{
    "employees": [
      { "id": "emp-manager", "name": "店長", "role": "管理者", "staffCode": "0622", "payType": "hourly", "payAmount": 1500, "hourlyWage": 1500 },
      { "id": "emp-staff-a", "name": "佐藤", "role": "スタッフ", "staffCode": "1001", "payType": "hourly", "payAmount": 1200, "hourlyWage": 1200 },
      { "id": "emp-staff-b", "name": "鈴木", "role": "スタッフ", "staffCode": "1002", "payType": "hourly", "payAmount": 1200, "hourlyWage": 1200 }
    ],
    "records": []
  }'::jsonb
)
on conflict (id) do nothing;
