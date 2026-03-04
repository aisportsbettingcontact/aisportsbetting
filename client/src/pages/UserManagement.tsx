import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { useLocation } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Pencil, Trash2, Shield, User, Crown, RefreshCw,
  Eye, EyeOff, ChevronDown, ArrowUp, ArrowDown, ChevronsUpDown, X,
} from "lucide-react";

type AppUserRow = {
  id: number;
  email: string;
  username: string;
  role: "owner" | "admin" | "user";
  hasAccess: boolean;
  expiryDate: number | null;
  createdAt: Date;
  lastSignedIn: Date | null;
  termsAccepted: boolean;
  termsAcceptedAt: number | null;
};

const ROLE_ICONS = {
  owner: <Crown className="w-3 h-3" />,
  admin: <Shield className="w-3 h-3" />,
  user: <User className="w-3 h-3" />,
};

const ROLE_COLORS = {
  owner: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  admin: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  user: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const EST_OPTS: Intl.DateTimeFormatOptions = { timeZone: "America/New_York" };

function formatExpiry(expiryDate: number | null) {
  if (!expiryDate) return "Lifetime";
  const d = new Date(expiryDate);
  // Full precision: MM/DD/YYYY HH:MM:SS AM/PM EST
  const date = d.toLocaleDateString("en-US", { ...EST_OPTS, month: "2-digit", day: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { ...EST_OPTS, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  return `${date} ${time} EST`;
}

function formatDate(d: Date | null) {
  if (!d) return "Never";
  const dt = new Date(d);
  const time = dt.toLocaleTimeString("en-US", { ...EST_OPTS, hour: "2-digit", minute: "2-digit", hour12: true });
  return `${time} EST`;
}

type FormState = {
  email: string;
  username: string;
  password: string;
  role: "owner" | "admin" | "user";
  hasAccess: boolean;
  expiryType: "lifetime" | "custom";
  expiryDateStr: string;
};

const defaultForm: FormState = {
  email: "",
  username: "",
  password: "",
  role: "user",
  hasAccess: true,
  expiryType: "lifetime",
  expiryDateStr: "",
};

// ── Column filter/sort types ──────────────────────────────────────────────────
type SortDir = "asc" | "desc" | null;
type ColKey = "username" | "email" | "role" | "access" | "expiry" | "terms" | "lastSignIn";

interface ColState {
  sort: SortDir;
  selected: Set<string>; // empty = all selected
}

// Dropdown that shows sort + multi-select checkboxes for a column
function ColFilterDropdown({
  label,
  colKey,
  options,
  state,
  onChange,
}: {
  label: string;
  colKey: ColKey;
  options: string[];
  state: ColState;
  onChange: (next: ColState) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const isFiltered = state.selected.size > 0;
  const isSorted = state.sort !== null;
  const isActive = isFiltered || isSorted;

  function toggleSort(dir: SortDir) {
    onChange({ ...state, sort: state.sort === dir ? null : dir });
  }

  function toggleOption(opt: string) {
    const next = new Set(state.selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange({ ...state, selected: next });
  }

  function selectAll() {
    onChange({ ...state, selected: new Set() });
  }

  function clearAll() {
    onChange({ sort: null, selected: new Set() });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 group transition-colors ${
          isActive ? "text-white" : "text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <span className="text-xs font-semibold tracking-wider">{label}</span>
        <span className="flex flex-col gap-[1px]">
          {state.sort === "asc" ? (
            <ArrowUp className="w-3 h-3 text-blue-400" />
          ) : state.sort === "desc" ? (
            <ArrowDown className="w-3 h-3 text-blue-400" />
          ) : (
            <ChevronsUpDown className="w-3 h-3 opacity-40 group-hover:opacity-70" />
          )}
        </span>
        {isFiltered && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
        )}
        <ChevronDown className={`w-3 h-3 opacity-40 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl py-1">
          {/* Sort options */}
          <div className="px-2 py-1 border-b border-white/8">
            <p className="text-[10px] text-zinc-500 tracking-wider mb-1 px-1">SORT</p>
            <button
              onClick={() => toggleSort("asc")}
              className={`flex items-center gap-2 w-full px-2 py-1 rounded text-xs transition-colors ${
                state.sort === "asc" ? "bg-blue-500/20 text-blue-300" : "text-zinc-300 hover:bg-white/5"
              }`}
            >
              <ArrowUp className="w-3 h-3" /> Ascending
            </button>
            <button
              onClick={() => toggleSort("desc")}
              className={`flex items-center gap-2 w-full px-2 py-1 rounded text-xs transition-colors ${
                state.sort === "desc" ? "bg-blue-500/20 text-blue-300" : "text-zinc-300 hover:bg-white/5"
              }`}
            >
              <ArrowDown className="w-3 h-3" /> Descending
            </button>
          </div>

          {/* Filter options */}
          <div className="px-2 py-1">
            <div className="flex items-center justify-between mb-1 px-1">
              <p className="text-[10px] text-zinc-500 tracking-wider">FILTER</p>
              {isFiltered && (
                <button onClick={selectAll} className="text-[10px] text-blue-400 hover:text-blue-300">
                  All
                </button>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {options.map((opt) => {
                const checked = state.selected.size === 0 || state.selected.has(opt);
                return (
                  <label
                    key={opt}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOption(opt)}
                      className="w-3 h-3 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">{opt}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Clear all */}
          {isActive && (
            <div className="border-t border-white/8 px-2 py-1">
              <button
                onClick={() => { clearAll(); setOpen(false); }}
                className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <X className="w-3 h-3" /> Clear filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sort helpers ─────────────────────────────────────────────────────────────
const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, user: 2 };

function getSortValue(u: AppUserRow, key: ColKey): string | number {
  switch (key) {
    case "username": return `@${u.username}`.toLowerCase();
    case "email": return u.email.toLowerCase();
    case "role": return ROLE_ORDER[u.role] ?? 99;
    case "access": return u.hasAccess ? 0 : 1;
    case "expiry":
      // null = Lifetime → treated as Infinity so it sorts last on asc
      return u.expiryDate === null ? Infinity : u.expiryDate;
    case "terms": return u.termsAccepted ? 0 : 1;
    case "lastSignIn":
      return u.lastSignedIn ? new Date(u.lastSignedIn).getTime() : 0;
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function UserManagement() {
  const { appUser, loading } = useAppAuth();
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<AppUserRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AppUserRow | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [showPassword, setShowPassword] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Per-column filter/sort state
  const defaultColState = (): ColState => ({ sort: null, selected: new Set() });
  const [cols, setCols] = useState<Record<ColKey, ColState>>({
    username: defaultColState(),
    email: defaultColState(),
    role: defaultColState(),
    access: defaultColState(),
    expiry: defaultColState(),
    terms: defaultColState(),
    lastSignIn: defaultColState(),
  });

  function updateCol(key: ColKey, next: ColState) {
    setCols((prev) => ({ ...prev, [key]: next }));
  }

  const utils = trpc.useUtils();
  const { data: rawUsers = [], isLoading } = trpc.appUsers.listUsers.useQuery(undefined, {
    enabled: appUser?.role === "owner",
  });

  const createMutation = trpc.appUsers.createUser.useMutation({
    onSuccess: () => {
      utils.appUsers.listUsers.invalidate();
      setShowCreate(false);
      setForm(defaultForm);
      toast.success(`Account created — @${form.username} has been added.`);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.appUsers.updateUser.useMutation({
    onSuccess: () => {
      utils.appUsers.listUsers.invalidate();
      setEditUser(null);
      setForm(defaultForm);
      toast.success("Account updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.appUsers.deleteUser.useMutation({
    onSuccess: () => {
      utils.appUsers.listUsers.invalidate();
      setDeleteConfirm(null);
      toast.success("Account deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  // Redirect if not owner
  if (!loading && (!appUser || appUser.role !== "owner")) {
    navigate("/dashboard");
    return null;
  }

  function openCreate() {
    setForm(defaultForm);
    setShowCreate(true);
  }

  function openEdit(user: AppUserRow) {
    setForm({
      email: user.email,
      username: user.username,
      password: "",
      role: user.role,
      hasAccess: user.hasAccess,
      expiryType: user.expiryDate ? "custom" : "lifetime",
      expiryDateStr: user.expiryDate
        ? new Date(user.expiryDate).toISOString().slice(0, 16)
        : "",
    });
    setEditUser(user);
  }

  function buildExpiryDate(): number | null {
    if (form.expiryType === "lifetime") return null;
    if (!form.expiryDateStr) return null;
    return new Date(form.expiryDateStr).getTime();
  }

  function handleCreate() {
    createMutation.mutate({
      email: form.email,
      username: form.username.replace(/^@/, ""),
      password: form.password,
      role: form.role,
      hasAccess: form.hasAccess,
      expiryDate: buildExpiryDate(),
    });
  }

  function handleUpdate() {
    if (!editUser) return;
    const payload: Record<string, unknown> = { id: editUser.id };
    if (form.email !== editUser.email) payload.email = form.email;
    if (form.username.replace(/^@/, "") !== editUser.username) payload.username = form.username.replace(/^@/, "");
    if (form.password) payload.password = form.password;
    if (form.role !== editUser.role) payload.role = form.role;
    if (form.hasAccess !== editUser.hasAccess) payload.hasAccess = form.hasAccess;
    payload.expiryDate = buildExpiryDate();
    updateMutation.mutate(payload as Parameters<typeof updateMutation.mutate>[0]);
  }

  // ── Build unique option lists for each column ─────────────────────────────
  const opts: Record<ColKey, string[]> = {
    username: Array.from(new Set(rawUsers.map((u) => `@${u.username}`))).sort(),
    email: Array.from(new Set(rawUsers.map((u) => u.email))).sort(),
    role: ["owner", "admin", "user"],
    access: ["YES", "NO"],
    expiry: Array.from(new Set(rawUsers.map((u) => formatExpiry(u.expiryDate)))).sort(),
    terms: ["ACCEPTED", "PENDING"],
    lastSignIn: Array.from(new Set(rawUsers.map((u) => formatDate(u.lastSignedIn)))).sort(),
  };

  // ── Apply filters + sort ──────────────────────────────────────────────────
  function getDisplayVal(u: AppUserRow, key: ColKey): string {
    switch (key) {
      case "username": return `@${u.username}`;
      case "email": return u.email;
      case "role": return u.role;
      case "access": return u.hasAccess ? "YES" : "NO";
      case "expiry": return formatExpiry(u.expiryDate);
      case "terms": return u.termsAccepted ? "ACCEPTED" : "PENDING";
      case "lastSignIn": return formatDate(u.lastSignedIn);
    }
  }

  let users = [...rawUsers];

  // Apply search
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase().replace(/^@/, "");
    users = users.filter(
      (u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }

  // Apply column filters
  (Object.keys(cols) as ColKey[]).forEach((key) => {
    const { selected } = cols[key];
    if (selected.size > 0) {
      users = users.filter((u) => selected.has(getDisplayVal(u, key)));
    }
  });

  // Apply sorts — last active sort wins, using typed sort values
  const activeSorts = (Object.keys(cols) as ColKey[])
    .filter((k) => cols[k].sort !== null)
    .map((k) => ({ key: k, dir: cols[k].sort! }));

  if (activeSorts.length > 0) {
    const { key, dir } = activeSorts[activeSorts.length - 1];
    users.sort((a, b) => {
      const av = getSortValue(a, key);
      const bv = getSortValue(b, key);
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur border-b border-white/8">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-semibold tracking-wider text-white">USER MANAGEMENT</span>
          </div>
          <div className="flex-1" />
          <Button onClick={openCreate} size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" />
            New Account
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Accounts", value: rawUsers.length },
            { label: "Owners", value: rawUsers.filter((u) => u.role === "owner").length },
            { label: "Admins", value: rawUsers.filter((u) => u.role === "admin").length },
            { label: "Active Access", value: rawUsers.filter((u) => u.hasAccess).length },
          ].map((stat) => (
            <div key={stat.label} className="bg-white/4 border border-white/8 rounded-lg px-4 py-3">
              <div className="text-xl font-bold text-white">{stat.value}</div>
              <div className="text-xs text-zinc-500 tracking-wide">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Search bar */}
        <div className="mb-4 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by username or email…"
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-9 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/25 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filtered count indicator */}
        {users.length !== rawUsers.length && (
          <div className="mb-3 flex items-center gap-2 text-xs text-zinc-400">
            <span>Showing <span className="text-white font-semibold">{users.length}</span> of <span className="text-white font-semibold">{rawUsers.length}</span> accounts</span>
            <button
              onClick={() => {
                setSearchQuery("");
                setCols({
                  username: defaultColState(), email: defaultColState(), role: defaultColState(),
                  access: defaultColState(), expiry: defaultColState(), terms: defaultColState(),
                  lastSignIn: defaultColState(),
                });
              }}
              className="text-red-400 hover:text-red-300 flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear all filters
            </button>
          </div>
        )}

        {/* Table */}
        <div className="bg-white/3 border border-white/8 rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent">
                <TableHead>
                  <ColFilterDropdown label="USERNAME" colKey="username" options={opts.username} state={cols.username} onChange={(s) => updateCol("username", s)} />
                </TableHead>
                <TableHead>
                  <ColFilterDropdown label="EMAIL" colKey="email" options={opts.email} state={cols.email} onChange={(s) => updateCol("email", s)} />
                </TableHead>
                <TableHead>
                  <ColFilterDropdown label="ROLE" colKey="role" options={opts.role} state={cols.role} onChange={(s) => updateCol("role", s)} />
                </TableHead>
                <TableHead>
                  <ColFilterDropdown label="ACCESS" colKey="access" options={opts.access} state={cols.access} onChange={(s) => updateCol("access", s)} />
                </TableHead>
                <TableHead>
                  <ColFilterDropdown label="EXPIRY" colKey="expiry" options={opts.expiry} state={cols.expiry} onChange={(s) => updateCol("expiry", s)} />
                </TableHead>
                <TableHead>
                  <ColFilterDropdown label="TERMS" colKey="terms" options={opts.terms} state={cols.terms} onChange={(s) => updateCol("terms", s)} />
                </TableHead>
                <TableHead>
                  <ColFilterDropdown label="LAST SIGN IN" colKey="lastSignIn" options={opts.lastSignIn} state={cols.lastSignIn} onChange={(s) => updateCol("lastSignIn", s)} />
                </TableHead>
                <TableHead className="text-zinc-400 font-semibold tracking-wider text-xs text-right">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-zinc-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading accounts...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-zinc-500">
                    {rawUsers.length === 0 ? "No accounts yet. Create the first one." : "No accounts match the current filters."}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id} className="border-white/5 hover:bg-white/3">
                    <TableCell className="font-semibold text-white">@{user.username}</TableCell>
                    <TableCell className="text-zinc-400 text-sm">{user.email}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${ROLE_COLORS[user.role]}`}>
                        {ROLE_ICONS[user.role]}
                        {user.role.toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${
                        user.hasAccess
                          ? "bg-green-500/15 text-green-400 border-green-500/30"
                          : "bg-red-500/15 text-red-400 border-red-500/30"
                      }`}>
                        {user.hasAccess ? "YES" : "NO"}
                      </span>
                    </TableCell>
                    <TableCell className="text-zinc-400 text-sm">{formatExpiry(user.expiryDate)}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${
                          user.termsAccepted
                            ? "bg-green-500/15 text-green-400 border-green-500/30"
                            : "bg-zinc-500/15 text-zinc-500 border-zinc-500/20"
                        }`}
                        title={user.termsAccepted && user.termsAcceptedAt ? `Accepted: ${new Date(user.termsAcceptedAt).toLocaleString()}` : "Not yet accepted"}
                      >
                        {user.termsAccepted ? "ACCEPTED" : "PENDING"}
                      </span>
                    </TableCell>
                    <TableCell className="text-zinc-400 text-sm">{formatDate(user.lastSignedIn)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(user)}
                          className="p-1.5 rounded hover:bg-white/8 text-zinc-400 hover:text-white transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(user)}
                          className="p-1.5 rounded hover:bg-red-500/15 text-zinc-400 hover:text-red-400 transition-colors"
                          disabled={user.id === appUser?.id}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={showCreate || !!editUser} onOpenChange={(open) => {
        if (!open) { setShowCreate(false); setEditUser(null); }
      }}>
        <DialogContent className="bg-[#111] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="tracking-wider">
              {editUser ? "EDIT ACCOUNT" : "CREATE ACCOUNT"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs tracking-wider">EMAIL</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="user@example.com"
                className="bg-white/5 border-white/10 text-white placeholder:text-zinc-600"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs tracking-wider">USERNAME</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">@</span>
                <Input
                  value={form.username.replace(/^@/, "")}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder="username"
                  className="bg-white/5 border-white/10 text-white placeholder:text-zinc-600 pl-7"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs tracking-wider">
                {editUser ? "NEW PASSWORD (leave blank to keep current)" : "PASSWORD"}
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={editUser ? "••••••••" : "Min 8 characters"}
                  className="bg-white/5 border-white/10 text-white placeholder:text-zinc-600 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs tracking-wider">ROLE</Label>
                <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as FormState["role"] }))}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a1a] border-white/10">
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs tracking-wider">ACCESS</Label>
                <div className="flex items-center gap-2 h-10 px-3 bg-white/5 border border-white/10 rounded-md">
                  <Switch
                    checked={form.hasAccess}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, hasAccess: v }))}
                  />
                  <span className={`text-sm font-semibold ${form.hasAccess ? "text-green-400" : "text-red-400"}`}>
                    {form.hasAccess ? "Yes" : "No"}
                  </span>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs tracking-wider">EXPIRY DATE</Label>
              <Select value={form.expiryType} onValueChange={(v) => setForm((f) => ({ ...f, expiryType: v as "lifetime" | "custom" }))}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a1a] border-white/10">
                  <SelectItem value="lifetime">Lifetime Access</SelectItem>
                  <SelectItem value="custom">Custom Date</SelectItem>
                </SelectContent>
              </Select>
              {form.expiryType === "custom" && (
                <Input
                  type="datetime-local"
                  value={form.expiryDateStr}
                  onChange={(e) => setForm((f) => ({ ...f, expiryDateStr: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white mt-2"
                />
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => { setShowCreate(false); setEditUser(null); }}
              className="border-white/10 text-zinc-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={editUser ? handleUpdate : handleCreate}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : editUser ? "Save Changes" : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="bg-[#111] border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="tracking-wider text-red-400">DELETE ACCOUNT</DialogTitle>
          </DialogHeader>
          <p className="text-zinc-400 text-sm py-2">
            Are you sure you want to delete <span className="text-white font-semibold">@{deleteConfirm?.username}</span>? This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="border-white/10 text-zinc-400 hover:text-white">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate({ id: deleteConfirm.id })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
