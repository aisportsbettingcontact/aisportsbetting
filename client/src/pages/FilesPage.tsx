// FilesPage — Upload and manage model CSV/XLSX files
// Protected: requires authentication

import { useState, useRef } from "react";
import { useLocation } from "wouter";
import {
  Upload,
  Trash2,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import type { AppRouter } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";

type RouterOutput = inferRouterOutputs<AppRouter>;
type FileRow = RouterOutput["files"]["list"][number];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const SPORT_OPTIONS = ["NCAAM", "NBA", "NFL", "NCAAF", "MLB", "NHL"];

export default function FilesPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedSport, setSelectedSport] = useState("NCAAM");
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data: files, isLoading: filesLoading } = trpc.files.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const uploadMutation = trpc.files.upload.useMutation({
    onSuccess: (result) => {
      toast.success(
        `"${result.filename}" uploaded — ${result.rowsImported} games imported`
      );
      setUploadProgress(null);
      utils.files.list.invalidate();
      utils.games.list.invalidate();
    },
    onError: (err) => {
      toast.error(`Upload failed: ${err.message}`);
      setUploadProgress(null);
    },
  });

  const deleteMutation = trpc.files.delete.useMutation({
    onSuccess: () => {
      toast.success("File and associated games deleted");
      utils.files.list.invalidate();
      utils.games.list.invalidate();
    },
    onError: (err) => {
      toast.error(`Delete failed: ${err.message}`);
    },
  });

  const handleFile = async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop();
    if (!["csv", "xlsx", "xls"].includes(ext ?? "")) {
      toast.error("Only CSV and XLSX files are supported");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10 MB");
      return;
    }

    setUploadProgress(`Reading "${file.name}"...`);

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(",")[1];
      if (!base64) {
        toast.error("Failed to read file");
        setUploadProgress(null);
        return;
      }
      setUploadProgress(`Uploading "${file.name}"...`);
      uploadMutation.mutate({
        filename: file.name,
        contentBase64: base64,
        sizeBytes: file.size,
        sport: selectedSport,
      });
    };
    reader.onerror = () => {
      toast.error("Failed to read file");
      setUploadProgress(null);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const handleDelete = (fileId: number, filename: string) => {
    if (!confirm(`Delete "${filename}" and all its game data?`)) return;
    deleteMutation.mutate({ fileId });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
        <FileSpreadsheet className="w-10 h-10 text-muted-foreground/40" />
        <p className="text-sm font-semibold text-foreground">Sign in to manage files</p>
        <button
          onClick={() => setLocation("/login")}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <button
            onClick={() => setLocation("/")}
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1
            className="text-sm font-bold tracking-[0.18em] uppercase text-foreground"
            style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
          >
            Model Files
          </h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Upload Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Upload New File
            </h2>
            {/* Sport selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Sport:</span>
              <select
                value={selectedSport}
                onChange={(e) => setSelectedSport(e.target.value)}
                className="text-xs bg-secondary text-foreground border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {SPORT_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              isDragging
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50 hover:bg-secondary/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={handleInputChange}
            />

            {uploadProgress ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">{uploadProgress}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Drop your model file here
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supports CSV and XLSX — 03-02-2026 format
                  </p>
                </div>
                <span className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
                  Browse Files
                </span>
              </div>
            )}
          </div>
        </div>

        {/* File List */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            Uploaded Files
          </h2>

          {filesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : !files || files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <FileSpreadsheet className="w-8 h-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No files uploaded yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {files.map((file: FileRow) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-border/80 transition-colors"
                >
                  {/* Status icon */}
                  <div className="flex-shrink-0">
                    {file.status === "done" ? (
                      <CheckCircle2 className="w-5 h-5 text-edge-green" />
                    ) : file.status === "error" ? (
                      <XCircle className="w-5 h-5 text-destructive" />
                    ) : (
                      <Clock className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {file.filename}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(file.sizeBytes)}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs font-semibold text-primary">
                        {file.sport}
                      </span>
                      {file.status === "done" && (
                        <>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">
                            {file.rowsImported} games
                          </span>
                        </>
                      )}
                      {file.status === "error" && (
                        <>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-destructive">Parse error</span>
                        </>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {formatDate(file.createdAt)}
                    </p>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDelete(file.id, file.filename)}
                    disabled={deleteMutation.isPending}
                    className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-secondary hover:bg-destructive/20 hover:text-destructive transition-colors"
                    title="Delete file"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Format guide */}
        <div className="rounded-xl bg-card border border-border p-4 space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            Expected Format
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Files must use the standard model format with these columns in order:
          </p>
          <div className="font-mono text-[10px] text-muted-foreground bg-secondary/50 rounded-lg p-3 overflow-x-auto whitespace-nowrap">
            date · start_time_est · away_team · away_book_spread · away_model_spread · home_team · home_book_spread · book_total · home_model_spread · model_total · spread_edge · spread_diff · total_edge · total_diff
          </div>
          <p className="text-[10px] text-muted-foreground">
            For XLSX files, each sheet named <span className="font-mono">MM-DD-YYYY</span> will be processed if it matches this format.
          </p>
        </div>
      </main>
    </div>
  );
}
