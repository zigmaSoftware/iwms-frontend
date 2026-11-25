import { useEffect, useState } from "react";
import { Clock, Save, RefreshCw, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api } from "@/api";
import { adminEndpoints } from "@/helpers/admin/endpoints";
import Notify from "@/lib/notify";
import ComponentCard from "@/components/common/ComponentCard";
import { Label } from "@/components/ui/label";

type SchedulerStatus = {
  job_name: string;
  enabled: boolean;
  run_time: string;
  last_run_at: string | null;
  last_result: Record<string, unknown> | null;
  last_error: string | null;
  next_run_at: string | null;
  is_running: boolean;
};

type SchedulerConfig = {
  run_time: string;
  is_enabled: boolean;
};

function formatDatetime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  } catch {
    return iso;
  }
}

export default function SchedulerConfigPage() {
  const { t } = useTranslation();

  const [config, setConfig] = useState<SchedulerConfig>({ run_time: "04:00", is_enabled: true });
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const configUrl = adminEndpoints.schedulerConfig;
  const statusUrl = `schedule-operations/daily-trip-assignments/scheduler-status/`;

  async function fetchAll() {
    try {
      const [cfgRes, stRes] = await Promise.all([
        api.get(configUrl),
        api.get(statusUrl),
      ]);
      setConfig(cfgRes.data);
      setStatus(stRes.data);
    } catch {
      Notify.fire({ title: t("admin.scheduler_config.load_failed"), icon: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function handleRefreshStatus() {
    setRefreshing(true);
    try {
      const res = await api.get(statusUrl);
      setStatus(res.data);
    } catch {
      Notify.fire({ title: t("admin.scheduler_config.refresh_failed"), icon: "error" });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!config.run_time) {
      Notify.fire({ title: t("admin.scheduler_config.invalid_time"), icon: "warning" });
      return;
    }
    setSaving(true);
    try {
      const res = await api.patch(configUrl, {
        run_time: config.run_time,
        is_enabled: config.is_enabled,
      });
      setConfig(res.data);
      Notify.fire({ title: t("admin.scheduler_config.update_success"), icon: "success" });
      // refresh status to reflect updated next_run_at
      const stRes = await api.get(statusUrl);
      setStatus(stRes.data);
    } catch {
      Notify.fire({ title: t("admin.scheduler_config.update_failed"), icon: "error" });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>{t("admin.scheduler_config.loading")}</span>
      </div>
    );
  }

  const lastResult = status?.last_result as Record<string, number> | null;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
          <Clock className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-800">{t("admin.scheduler_config.title")}</h2>
          <p className="text-sm text-gray-500">
            {t("admin.scheduler_config.subtitle")}
          </p>
        </div>
      </div>

      {/* Config Form */}
      <ComponentCard title={t("admin.scheduler_config.schedule_settings")}>
        <form onSubmit={handleSave} className="space-y-5">
          {/* Time picker */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">
              {t("admin.scheduler_config.auto_generation_time_ist")} <span className="text-red-500">*</span>
            </Label>
            <input
              type="time"
              value={config.run_time}
              onChange={(e) => setConfig((prev) => ({ ...prev, run_time: e.target.value }))}
              required
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-gray-400">
              {t("admin.scheduler_config.time_hint")}
            </p>
          </div>

          {/* Enable toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={config.is_enabled}
              onClick={() => setConfig((prev) => ({ ...prev, is_enabled: !prev.is_enabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                config.is_enabled ? "bg-blue-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  config.is_enabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <Label className="text-sm font-medium text-gray-700 cursor-pointer select-none">
              {config.is_enabled ? t("admin.scheduler_config.enabled") : t("admin.scheduler_config.disabled")}
            </Label>
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saving ? t("common.saving") : t("admin.scheduler_config.save_changes")}
            </button>
          </div>
        </form>
      </ComponentCard>

      {/* Live Status */}
      <ComponentCard
        title={t("admin.scheduler_config.current_status")}
        desc={t("admin.scheduler_config.current_status_desc")}
      >
        <div className="flex justify-end -mt-2">
          <button
            type="button"
            onClick={handleRefreshStatus}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {t("admin.scheduler_config.refresh")}
          </button>
        </div>

        {status ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatusRow
              label={t("common.status")}
              value={
                status.is_running ? (
                  <span className="inline-flex items-center gap-1 text-blue-600 font-medium">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("admin.scheduler_config.running")}
                  </span>
                ) : status.enabled ? (
                  <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                    <CheckCircle className="w-3.5 h-3.5" /> {t("common.active")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-gray-500 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" /> {t("admin.scheduler_config.status_disabled")}
                  </span>
                )
              }
            />
            <StatusRow label={t("admin.scheduler_config.auto_generation_time")} value={status.run_time || "—"} />
            <StatusRow label={t("admin.scheduler_config.next_run_at")} value={formatDatetime(status.next_run_at)} />
            <StatusRow label={t("admin.scheduler_config.last_run_at")} value={formatDatetime(status.last_run_at)} />
            {lastResult && (
              <>
                <StatusRow label={t("admin.scheduler_config.trips_created")} value={String(lastResult.created ?? "—")} />
                <StatusRow label={t("admin.scheduler_config.trips_skipped")} value={String(lastResult.skipped ?? "—")} />
              </>
            )}
            {status.last_error && (
              <div className="col-span-2">
                <p className="text-xs font-medium text-gray-500 mb-1">{t("admin.scheduler_config.last_error")}</p>
                <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 break-words">
                  {status.last_error}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">{t("admin.scheduler_config.no_status")}</p>
        )}
      </ComponentCard>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-gray-800">{value}</p>
    </div>
  );
}
