import React, { useEffect, useMemo, useRef, useState } from "react";

// =====================
// Gamified Kanban — v2
// =====================
// Новое:
// 1) Надёжное сохранение (localStorage + запрос Persistent Storage API).
// 2) Канбан вверху: 4 колонки в один ряд (горскролл на узких экранах).
// 3) Фоновое видео (по желанию) — через Настройки.
// 4) Магазин с улучшениями интерфейса (темы, скругления, стекло, конфетти и т.п.).
// 5) Трекер времени по задачам + суммарная статистика.
// 6) Категория «Проект» у задачи + фильтр по проектам.

// --- Types / Dictionaries ---
const DIFFICULTIES = [
  { key: "XS", label: "Очень легко", color: "bg-green-100 text-green-800", points: 10 },
  { key: "S", label: "Легко", color: "bg-emerald-100 text-emerald-800", points: 20 },
  { key: "M", label: "Средне", color: "bg-yellow-100 text-yellow-800", points: 40 },
  { key: "L", label: "Сложно", color: "bg-orange-100 text-orange-800", points: 80 },
  { key: "XL", label: "Очень сложно", color: "bg-red-100 text-red-800", points: 120 },
];

const COLUMNS = [
  { key: "backlog", label: "Бэклог" },
  { key: "todo", label: "To‑Do" },
  { key: "doing", label: "В процессе" },
  { key: "done", label: "Готово" },
];

// Улучшения магазина — влияют на UI
const SHOP = [
  { id: "theme_dark", name: "Тёмная тема", cost: 180, emoji: "🌙", type: "toggle" },
  { id: "round_plus", name: "Скругления 2XL", cost: 120, emoji: "🫧", type: "toggle" },
  { id: "glass_plus", name: "Стеклянные карточки", cost: 140, emoji: "🪟", type: "toggle" },
  { id: "shadow_plus", name: "Мягкие тени", cost: 100, emoji: "☁️", type: "toggle" },
  { id: "confetti", name: "Конфетти при завершении", cost: 90, emoji: "🎉", type: "toggle" },
  { id: "video_unlock", name: "Фоновое видео (разблокировать)", cost: 60, emoji: "📽️", type: "unlock" },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function readLS(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export default function GamifiedKanban() {
  // --- Core State ---
  const [tasks, setTasks] = useState(() => readLS("uc_tasks", []));
  const [points, setPoints] = useState(() => readLS("uc_points", 0));
  const [inventory, setInventory] = useState(() => readLS("uc_inventory", []));
  const [upgrades, setUpgrades] = useState(() => readLS("uc_upgrades", {})); // {id: true}

  // UI
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Filters
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("priority");
  const [projectFilter, setProjectFilter] = useState("ALL");

  // Background video
  const [videoEnabled, setVideoEnabled] = useState(() => readLS("uc_videoEnabled", false));
  const [videoUrl, setVideoUrl] = useState(() => readLS("uc_videoUrl", ""));

  // Persistent Storage API — стараемся закрепить хранилище, чтобы данные не чистились системой
  const [persistGranted, setPersistGranted] = useState(() => readLS("uc_persistGranted", false));
  useEffect(() => {
    (async () => {
      try {
        if (navigator.storage && navigator.storage.persist) {
          const granted = await navigator.storage.persist();
          setPersistGranted(granted);
          writeLS("uc_persistGranted", granted);
        }
      } catch {}
    })();
  }, []);

  // Save to LS on changes
  useEffect(() => writeLS("uc_tasks", tasks), [tasks]);
  useEffect(() => writeLS("uc_points", points), [points]);
  useEffect(() => writeLS("uc_inventory", inventory), [inventory]);
  useEffect(() => writeLS("uc_upgrades", upgrades), [upgrades]);
  useEffect(() => writeLS("uc_videoEnabled", videoEnabled), [videoEnabled]);
  useEffect(() => writeLS("uc_videoUrl", videoUrl), [videoUrl]);

  // Extra safety: перед уходом со страницы — сохраняем
  useEffect(() => {
    const handle = () => {
      writeLS("uc_tasks", tasks);
      writeLS("uc_points", points);
      writeLS("uc_inventory", inventory);
      writeLS("uc_upgrades", upgrades);
    };
    window.addEventListener("beforeunload", handle);
    return () => window.removeEventListener("beforeunload", handle);
  }, [tasks, points, inventory, upgrades]);

  // --- Derived ---
  const projects = useMemo(() => {
    const set = new Set(tasks.map((t) => (t.project || "Без проекта")));
    return ["ALL", ...Array.from(set)];
  }, [tasks]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "done").length;
    const inProgress = tasks.filter((t) => t.status === "doing").length;
    const totalTimeMs = tasks.reduce((acc, t) => acc + (t.timeSpent || 0) + (t.timerRunning ? Date.now() - (t.timerStartedAt || 0) : 0), 0);
    return { total, done, inProgress, totalTimeMs };
  }, [tasks]);

  // --- Task CRUD ---
  function openNewTask() {
    setEditing({ id: null, title: "", description: "", project: "", difficulty: "M", status: "backlog", priority: 3 });
    setModalOpen(true);
  }
  function editTask(task) { setEditing({ ...task }); setModalOpen(true); }
  function saveTask(data) {
    if (!data.title.trim()) return;
    if (data.id) {
      setTasks((prev) => prev.map((t) => (t.id === data.id ? { ...t, ...data } : t)));
    } else {
      const t = {
        id: uid(),
        title: data.title,
        description: data.description,
        project: data.project || "Без проекта",
        difficulty: data.difficulty,
        status: data.status,
        priority: Number(data.priority) || 3,
        createdAt: Date.now(),
        completedAt: null,
        pointsAwarded: 0,
        timeSpent: 0,
        timerRunning: false,
        timerStartedAt: 0,
      };
      setTasks((prev) => [t, ...prev]);
    }
    setModalOpen(false); setEditing(null);
  }
  function removeTask(id) { setTasks((prev) => prev.filter((t) => t.id !== id)); }

  // --- Move / Points ---
  function moveTask(taskId, newStatus) {
    setTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t;
      const wasDone = t.status === "done";

      // если таймер шёл — стопаем при любом перемещении
      let timeSpent = t.timeSpent;
      let running = t.timerRunning;
      let startedAt = t.timerStartedAt;
      if (running) {
        timeSpent += Math.max(0, Date.now() - (startedAt || 0));
        running = false; startedAt = 0;
      }

      const next = { ...t, status: newStatus, timeSpent, timerRunning: running, timerStartedAt: startedAt };
      if (newStatus === "done" && !wasDone) {
        const diff = DIFFICULTIES.find((d) => d.key === t.difficulty) || DIFFICULTIES[2];
        const reward = diff.points;
        next.completedAt = Date.now();
        next.pointsAwarded = reward;
        setPoints((p) => p + reward);
        if (upgrades.confetti) fireConfetti();
      }
      if (wasDone && newStatus !== "done") {
        setPoints((p) => Math.max(0, p - (t.pointsAwarded || 0)));
        next.completedAt = null; next.pointsAwarded = 0;
      }
      return next;
    }));
  }

  // --- Timer ---
  const anyRunning = tasks.some((t) => t.timerRunning);
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => {
      // триггерим перерисовку через пустое обновление (меняем ссылку массива)
      setTasks((prev) => [...prev]);
    }, 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  function toggleTimer(taskId) {
    setTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t;
      if (t.timerRunning) {
        const delta = Math.max(0, Date.now() - (t.timerStartedAt || 0));
        return { ...t, timerRunning: false, timerStartedAt: 0, timeSpent: (t.timeSpent || 0) + delta };
      } else {
        return { ...t, timerRunning: true, timerStartedAt: Date.now() };
      }
    }));
  }

  // --- Filters / Sorting ---
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = tasks.filter((t) => (projectFilter === "ALL" ? true : (t.project || "Без проекта") === projectFilter));
    if (q) list = list.filter((t) => [t.title, t.description, t.project].some((x) => (x || "").toLowerCase().includes(q)));
    if (sort === "priority") list = [...list].sort((a, b) => a.priority - b.priority);
    if (sort === "created") list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    if (sort === "difficulty") list = [...list].sort((a, b) => idxDiff(b.difficulty) - idxDiff(a.difficulty));
    return list;
  }, [tasks, filter, sort, projectFilter]);

  function idxDiff(key) { return DIFFICULTIES.findIndex((d) => d.key === key); }

  // --- Shop ---
  function buy(item) {
    if (points < item.cost) return;
    setPoints((p) => p - item.cost);
    setInventory((inv) => [...inv, { id: uid(), itemId: item.id, name: item.name, emoji: item.emoji, time: Date.now() }]);
    setUpgrades((u) => ({ ...u, [item.id]: true }));
  }

  // --- Confetti (простая версия) ---
  function fireConfetti() {
    try {
      const el = document.createElement("div");
      el.className = "fixed inset-0 pointer-events-none z-[9999]";
      el.innerHTML = `<div class="absolute inset-0" id="confetti"></div>`;
      document.body.appendChild(el);
      const N = 120;
      for (let i = 0; i < N; i++) {
        const p = document.createElement("div");
        p.style.position = "absolute";
        p.style.left = Math.random() * 100 + "%";
        p.style.top = "-10px";
        p.style.width = "6px"; p.style.height = "10px";
        p.style.background = `hsl(${Math.random() * 360}, 90%, 60%)`;
        p.style.opacity = "0.9";
        p.style.transform = `rotate(${Math.random() * 360}deg)`;
        p.style.transition = "transform 1.2s linear, top 1.2s linear, opacity 1.2s";
        el.firstChild.appendChild(p);
        requestAnimationFrame(() => {
          p.style.top = "110%";
          p.style.transform += " translateY(100vh) rotate(360deg)";
          p.style.opacity = "0";
        });
      }
      setTimeout(() => el.remove(), 1400);
    } catch {}
  }

  // --- THEME / STYLE flags from upgrades ---
  const themeDark = !!upgrades.theme_dark;
  const roundMore = !!upgrades.round_plus;
  const glass = !!upgrades.glass_plus;
  const shadows = !!upgrades.shadow_plus;

  const shellClasses = [
    "min-h-screen relative",
    themeDark ? "bg-slate-900 text-slate-100" : "bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900",
  ].join(" ");

  const cardBase = [
    roundMore ? "rounded-3xl" : "rounded-2xl",
    "border",
    themeDark ? "border-slate-700" : "border-slate-200",
    glass ? (themeDark ? "bg-white/10 backdrop-blur" : "bg-white/60 backdrop-blur") : (themeDark ? "bg-slate-800" : "bg-white"),
    shadows ? "shadow-xl" : "shadow-sm",
  ].join(" ");

  return (
    <div className={shellClasses}>
      {/* Background video */}
      {videoEnabled && upgrades.video_unlock && videoUrl && (
        <video className="fixed inset-0 w-full h-full object-cover opacity-30" src={videoUrl} autoPlay muted loop playsInline />
      )}

      {/* Header */}
      <header className={(themeDark?"bg-slate-900/70":"bg-white/70") + " sticky top-0 z-20 backdrop-blur border-b " + (themeDark?"border-slate-800":"border-slate-200") }>
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={(themeDark?"bg-white text-slate-900":"bg-slate-900 text-white") + " h-8 w-8 rounded-2xl grid place-items-center font-bold"}>G</div>
            <h1 className="text-lg font-semibold">Gamified Kanban</h1>
            {persistGranted && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">хранилище закреплено</span>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className={(themeDark?"border-slate-700":"border-slate-200") + " hidden md:flex items-center gap-2 rounded-full border bg-transparent px-3 py-1.5"}>
              <span className="text-xs opacity-60">Фильтр</span>
              <input className="outline-none text-sm bg-transparent placeholder:opacity-50 w-48" placeholder="поиск…" value={filter} onChange={(e)=>setFilter(e.target.value)} />
            </div>
            <select className={(themeDark?"border-slate-700":"border-slate-200") + " rounded-full border bg-transparent px-3 py-1.5 text-sm"} value={projectFilter} onChange={(e)=>setProjectFilter(e.target.value)} title="Проект">
              {projects.map(p => <option key={p} value={p}>{p === "ALL" ? "Все проекты" : p}</option>)}
            </select>
            <select className={(themeDark?"border-slate-700":"border-slate-200") + " rounded-full border bg-transparent px-3 py-1.5 text-sm"} value={sort} onChange={(e)=>setSort(e.target.value)} title="Сортировка">
              <option value="priority">по приоритету</option>
              <option value="created">сначала новые</option>
              <option value="difficulty">по сложности</option>
            </select>
            <button onClick={openNewTask} className={(themeDark?"bg-white text-slate-900":"bg-slate-900 text-white") + " rounded-full px-4 py-1.5 text-sm shadow-sm hover:opacity-90"}>+ Новая</button>
            <button onClick={()=>setShopOpen(true)} className={(themeDark?"border-slate-700":"border-slate-200") + " rounded-full border px-3 py-1.5 text-sm hover:opacity-80"} title="Магазин">🛍️</button>
            <button onClick={()=>setSettingsOpen(true)} className={(themeDark?"border-slate-700":"border-slate-200") + " rounded-full border px-3 py-1.5 text-sm hover:opacity-80"} title="Настройки">⚙️</button>
          </div>
        </div>
      </header>

      {/* MAIN: сначала КАНБАН (4 в ряд) */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        <section className="overflow-auto">
          <div className="grid grid-flow-col auto-cols-[minmax(280px,1fr)] gap-4 min-w-[1120px]">
            {COLUMNS.map((col) => (
              <Column key={col.key} column={col} themeDark={themeDark} cardBase={cardBase}
                tasks={filtered.filter((t) => t.status === col.key)}
                onDrop={(e) => { e.preventDefault(); if (dragId.current) moveTask(dragId.current, col.key); dragId.current=null; }}>
                {filtered.filter((t) => t.status === col.key).map((t) => (
                  <TaskCard key={t.id} task={t} themeDark={themeDark} cardBase={cardBase}
                    onDragStart={(e)=>{dragId.current=t.id; e.dataTransfer.effectAllowed='move';}}
                    onEdit={()=>editTask(t)} onDelete={()=>removeTask(t.id)} onMove={(s)=>moveTask(t.id,s)} onToggleTimer={()=>toggleTimer(t.id)} />
                ))}
              </Column>
            ))}
          </div>
        </section>

        {/* Второстепенные блоки: статистика, инвентарь */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
          <div className={cardBase + " p-4"}>
            <div className="text-sm opacity-60 mb-2">Статистика</div>
            <StatRow label="Всего задач" value={stats.total} />
            <StatRow label="Сделано" value={stats.done} />
            <StatRow label="В процессе" value={stats.inProgress} />
            <StatRow label="Время всего" value={formatMs(stats.totalTimeMs)} />
          </div>
          <div className={cardBase + " p-4"}>
            <div className="text-sm opacity-60 mb-2">Инвентарь улучшений</div>
            <div className="flex flex-wrap gap-2">
              {inventory.length === 0 && <div className="text-sm opacity-60">Пусто. Откройте магазин.</div>}
              {inventory.map((it) => (
                <span key={it.id} className={(themeDark?"border-slate-700":"border-slate-200") + " inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm"}>
                  <span className="text-lg leading-none">{it.emoji}</span>{it.name}
                </span>
              ))}
            </div>
          </div>
          <div className={cardBase + " p-4"}>
            <div className="text-sm opacity-60">Очки</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{points}</div>
            <div className="mt-3 flex gap-2">
              <button onClick={()=>setShopOpen(true)} className={(themeDark?"bg-white text-slate-900":"bg-slate-900 text-white") + " rounded-xl px-3 py-1.5 text-sm"}>Открыть магазин</button>
              <button onClick={()=>{ if(!confirm("Сбросить всё?")) return; setPoints(0); setInventory([]); setTasks([]); setUpgrades({}); }} className={(themeDark?"border-slate-700":"border-slate-200") + " rounded-xl border px-3 py-1.5 text-sm"}>Сброс</button>
            </div>
          </div>
        </div>
      </main>

      {/* Modals */}
      {modalOpen && (
        <TaskModal initial={editing} onClose={()=>{setModalOpen(false); setEditing(null);}} onSave={saveTask} themeDark={themeDark} />
      )}
      {shopOpen && (
        <ShopDrawer onClose={()=>setShopOpen(false)} points={points} onBuy={buy} themeDark={themeDark} upgrades={upgrades} />
      )}
      {settingsOpen && (
        <SettingsModal onClose={()=>setSettingsOpen(false)} themeDark={themeDark}
          videoEnabled={videoEnabled} setVideoEnabled={setVideoEnabled}
          videoUrl={videoUrl} setVideoUrl={setVideoUrl} hasVideoUnlock={!!upgrades.video_unlock} />
      )}
    </div>
  );
}

function StatRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm opacity-70">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Column({ column, tasks, children, onDrop, themeDark, cardBase }) {
  return (
    <div onDragOver={(e)=>e.preventDefault()} onDrop={onDrop} className={cardBase + " p-3 flex flex-col min-h-[220px]"}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold opacity-80">{column.label}</h2>
        <span className="text-xs opacity-50">{tasks.length}</span>
      </div>
      <div className="flex-1 flex flex-col gap-3">{children}</div>
    </div>
  );
}

function difficultyDef(key) { return DIFFICULTIES.find((d) => d.key === key) || DIFFICULTIES[2]; }

function TaskCard({ task, onDragStart, onEdit, onDelete, onMove, onToggleTimer, themeDark, cardBase }) {
  const diff = difficultyDef(task.difficulty);
  const runMs = task.timerRunning ? Math.max(0, Date.now() - (task.timerStartedAt || 0)) : 0;
  const totalMs = (task.timeSpent || 0) + runMs;
  return (
    <div draggable onDragStart={onDragStart} className={cardBase + " p-3 cursor-grab active:cursor-grabbing group"}>
      <div className="flex items-center justify-between gap-2">
        <div className={`text-[11px] px-2 py-0.5 rounded-full ${diff.color}`}>{task.difficulty} · {diff.points} XP</div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <IconButton title="Редактировать" onClick={onEdit}>✏️</IconButton>
          <IconButton title="Удалить" onClick={onDelete}>🗑️</IconButton>
        </div>
      </div>
      <div className="mt-2 font-medium leading-tight">{task.title}</div>
      <div className="mt-1 text-xs opacity-60">Проект: {task.project || "Без проекта"}</div>
      {task.description && <div className="mt-1 text-sm opacity-80 line-clamp-3">{task.description}</div>}
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs opacity-60">Приоритет: {task.priority} · Время: {formatMs(totalMs)}</div>
        <div className="flex gap-1">
          <MiniBtn onClick={onToggleTimer} label={task.timerRunning ? "Пауза" : "Старт"} />
          {task.status !== "backlog" && <MiniBtn onClick={() => onMove("backlog")} label="Бэклог" />}
          {task.status !== "todo" && <MiniBtn onClick={() => onMove("todo")} label="To‑Do" />}
          {task.status !== "doing" && <MiniBtn onClick={() => onMove("doing")} label="В процессе" />}
          {task.status !== "done" && <MiniBtn onClick={() => onMove("done")} label="Готово" />}
        </div>
      </div>
      {task.status === "done" && (
        <div className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
          Получено {task.pointsAwarded || difficultyDef(task.difficulty).points} XP
        </div>
      )}
    </div>
  );
}

function IconButton({ children, ...props }) {
  return (
    <button className="rounded-lg border border-slate-200/60 px-2 py-1 text-xs hover:opacity-80" {...props}>{children}</button>
  );
}
function MiniBtn({ label, ...props }) {
  return (
    <button className="rounded-lg border border-slate-200/60 bg-transparent px-2 py-1 text-[11px] hover:opacity-80" {...props}>{label}</button>
  );
}

function TaskModal({ initial, onClose, onSave, themeDark }) {
  const [form, setForm] = useState(initial);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" role="dialog" aria-modal>
      <div className={(themeDark?"bg-slate-800 border-slate-700":"bg-white border-slate-200") + " w-full max-w-lg rounded-2xl shadow-xl border"}>
        <div className="p-4 border-b border-slate-200/40 flex items-center justify-between">
          <div className="font-semibold">{form.id ? "Редактировать задачу" : "Новая задача"}</div>
          <button className="opacity-70 hover:opacity-100" onClick={onClose}>✖️</button>
        </div>
        <div className="p-4 grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="opacity-80">Заголовок</span>
            <input className={(themeDark?"bg-slate-900 border-slate-700":"bg-white border-slate-200") + " rounded-lg border px-3 py-2"} value={form.title} onChange={(e)=>setForm({ ...form, title: e.target.value })} placeholder="Например: Запустить лендинг" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="opacity-80">Описание</span>
            <textarea className={(themeDark?"bg-slate-900 border-slate-700":"bg-white border-slate-200") + " rounded-lg border px-3 py-2 min-h-[96px]"} value={form.description} onChange={(e)=>setForm({ ...form, description: e.target.value })} placeholder="Кратко, по делу" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              <span className="opacity-80">Проект</span>
              <input className={(themeDark?"bg-slate-900 border-slate-700":"bg-white border-slate-200") + " rounded-lg border px-3 py-2"} value={form.project} onChange={(e)=>setForm({ ...form, project: e.target.value })} placeholder="Например: IMPULSE GLOBAL" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="opacity-80">Сложность</span>
              <select className={(themeDark?"bg-slate-900 border-slate-700":"bg-white border-slate-200") + " rounded-lg border px-3 py-2"} value={form.difficulty} onChange={(e)=>setForm({ ...form, difficulty: e.target.value })}>
                {DIFFICULTIES.map((d) => (<option key={d.key} value={d.key}>{d.key} — {d.label} ({d.points} XP)</option>))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              <span className="opacity-80">Приоритет (1–5)</span>
              <input type="number" min={1} max={5} className={(themeDark?"bg-slate-900 border-slate-700":"bg-white border-slate-200") + " rounded-lg border px-3 py-2"} value={form.priority} onChange={(e)=>setForm({ ...form, priority: Number(e.target.value || 3) })} />
            </label>
            <div className="grid gap-1 text-sm">
              <span className="opacity-80">Статус</span>
              <div className="flex flex-wrap gap-2">
                {COLUMNS.map((c) => (
                  <button key={c.key} onClick={()=>setForm({ ...form, status: c.key })} className={`px-3 py-1.5 rounded-lg border ${form.status === c.key ? ("bg-slate-900 text-white border-slate-900") : "border-slate-200"}`}>{c.label}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-slate-200/40 flex items-center justify-end gap-2">
          <button className={("rounded-lg border px-3 py-2 text-sm ") + (themeDark?"border-slate-700":"border-slate-200")} onClick={onClose}>Отмена</button>
          <button className={(themeDark?"bg-white text-slate-900":"bg-slate-900 text-white") + " rounded-lg px-4 py-2 text-sm"} onClick={()=>onSave(form)}>Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function ShopDrawer({ onClose, points, onBuy, themeDark, upgrades }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={(themeDark?"bg-slate-900 border-slate-800":"bg-white border-slate-200") + " absolute right-0 top-0 h-full w-full max-w-md shadow-2xl border-l flex flex-col"}>
        <div className="p-4 border-b border-slate-200/40 flex items-center justify-between">
          <div>
            <div className="font-semibold">Магазин улучшений</div>
            <div className="text-sm opacity-70">У вас {points} очков</div>
          </div>
          <button className="opacity-70 hover:opacity-100" onClick={onClose}>✖️</button>
        </div>
        <div className="p-4 grid gap-3">
          {SHOP.map((item) => (
            <div key={item.id} className={(themeDark?"border-slate-700":"border-slate-200") + " rounded-xl border p-3 flex items-center justify-between"}>
              <div className="flex items-center gap-3">
                <div className="text-2xl">{item.emoji}</div>
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs opacity-60">{item.cost} очков</div>
                </div>
              </div>
              {upgrades[item.id] ? (
                <span className="text-xs px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600">Активно</span>
              ) : (
                <button disabled={points < item.cost} onClick={()=>onBuy(item)} className={(points < item.cost? (themeDark?"border-slate-700 text-slate-500":"border-slate-200 text-slate-400 cursor-not-allowed") : (themeDark?"bg-white text-slate-900 border-slate-900":"bg-slate-900 text-white border-slate-900")) + " rounded-lg px-3 py-2 text-sm border"}>Купить</button>
              )}
            </div>
          ))}
          <p className="text-xs opacity-60">Совет: завершайте задачи L/XL, чтобы быстрее копить очки.</p>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ onClose, themeDark, videoEnabled, setVideoEnabled, videoUrl, setVideoUrl, hasVideoUnlock }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" role="dialog" aria-modal>
      <div className={(themeDark?"bg-slate-800 border-slate-700":"bg-white border-slate-200") + " w-full max-w-lg rounded-2xl shadow-xl border"}>
        <div className="p-4 border-b border-slate-200/40 flex items-center justify-between">
          <div className="font-semibold">Настройки</div>
          <button className="opacity-70 hover:opacity-100" onClick={onClose}>✖️</button>
        </div>
        <div className="p-4 grid gap-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Фоновое видео</div>
              <div className="text-sm opacity-70">Добавьте спокойное видео (URL). Требуется разблокировка в магазине.</div>
            </div>
            <label className={(hasVideoUnlock?"":"opacity-50") + " inline-flex items-center gap-2"}>
              <input type="checkbox" disabled={!hasVideoUnlock} checked={videoEnabled} onChange={(e)=>setVideoEnabled(e.target.checked)} />
              <span className="text-sm">Включить</span>
            </label>
          </div>
          <input className={(themeDark?"bg-slate-900 border-slate-700":"bg-white border-slate-200") + " rounded-lg border px-3 py-2"} value={videoUrl} onChange={(e)=>setVideoUrl(e.target.value)} placeholder="https://…/calm.mp4" />
          <p className="text-xs opacity-60">Подсказка: можно использовать короткий зацикленный клип без звука.</p>
        </div>
      </div>
    </div>
  );
}

// --- Helpers ---
function formatMs(ms) {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}ч ${m}м ${s}с`;
}
