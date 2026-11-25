import type {
  VehicleBreakdownRecord,
  BreakdownStatus,
  ApprovalStatus,
  VerifyPreview,
} from "./types";
import { breakdownReasonLabel, stopStatusLabel } from "./types";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Swal from "@/lib/notify";
import i18n from "i18next";
import { confirmDeleteWithReason, withDeleteReason } from "@/utils/deleteReason";
import { useTranslation } from "react-i18next";

import { DataTable } from "@/components/common/SafeDataTable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputTextarea } from "primereact/inputtextarea";
import { Dialog } from "primereact/dialog";
import type {
  DataTablePageEvent,
  DataTableSortEvent,
  SortOrder,
} from "primereact/datatable";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { useScreenAccess } from "@/contexts/screenPermission";
import { useCompanyProjectFilter } from "@/components/filters/useCompanyProjectFilter";
import { combineFilters } from "@/components/filters/useOptionFilter";
import { getEncryptedRoute } from "@/utils/routeCache";
import { createCrudRoutePaths } from "@/utils/routePaths";
import { api } from "@/api";
import { vehicleBreakdownApi } from "@/helpers/admin";
import { FilterBar } from "@/components/common/FilterBar";
import { locationColumn } from "@/components/common/LocationColumn";
import { StackCell } from "@/components/common/TableCells";
import {
  exportRecordsToExcel,
  getAdminScreenExcelFilename,
} from "@/utils/exportExcel";

const toRecordList = (value: unknown): VehicleBreakdownRecord[] => {
  if (Array.isArray(value)) return value as VehicleBreakdownRecord[];
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { results?: unknown }).results)
  ) {
    return (value as { results: VehicleBreakdownRecord[] }).results;
  }
  return [];
};

// Only fields the backend's `ordering_fields` (see vehicle_breakdown_viewset.py)
// actually accepts — sorting any other column would be silently ignored by DRF.
const SORTABLE_FIELDS = new Set(["status", "approval_status"]);

/* ── Badge helpers ─────────────────────────────────────────────── */

const STATUS_STYLES: Record<BreakdownStatus, string> = {
  REPORTED: "bg-amber-100 text-amber-800",
  REPLACEMENT_ARRANGED: "bg-blue-100 text-blue-800",
  REJECTED: "bg-red-100 text-red-800",
};
const APPROVAL_STYLES: Record<ApprovalStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
};

const statusLabel = (t: (k: string, o?: any) => string, value: string) =>
  t(`admin.vehicle_breakdown.status.${value}`, { defaultValue: value });
const approvalLabel = (t: (k: string, o?: any) => string, value: string) =>
  t(`admin.vehicle_breakdown.approval.${value}`, { defaultValue: value });

const StatusBadge = ({ value }: { value: BreakdownStatus }) => {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[value] ?? "bg-gray-100 text-gray-600"}`}
    >
      {statusLabel(t, value)}
    </span>
  );
};

const ApprovalBadge = ({ value }: { value: ApprovalStatus }) => {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${APPROVAL_STYLES[value] ?? "bg-gray-100 text-gray-600"}`}
    >
      {approvalLabel(t, value)}
    </span>
  );
};

const extractError = (error: any): string => {
  const data = error?.response?.data;
  if (!data) return i18n.t("common.unexpected_error");
  if (typeof data === "string") return data;
  if (typeof data?.detail === "string") return data.detail;
  if (typeof data === "object") {
    const first = Object.values(data)[0];
    if (Array.isArray(first)) return String(first[0]);
    if (typeof first === "string") return first;
  }
  return i18n.t("common.unexpected_error");
};

const displayValue = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
};

function DetailRow({
  label,
  before,
  after,
  highlight,
}: {
  label: string;
  before: string | null | undefined;
  after: string | null | undefined;
  highlight?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-gray-100 py-3 text-sm last:border-b-0 lg:grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)]">
      <span className="font-medium text-gray-500">{label}</span>
      <span className="min-w-0 break-words rounded-md bg-red-50 px-3 py-2 text-gray-800">
        {displayValue(before)}
      </span>
      <span
        className={`min-w-0 break-words rounded-md px-3 py-2 font-medium ${highlight ? "bg-green-50 text-green-800" : "bg-gray-50 text-gray-800"}`}
      >
        {displayValue(after)}
      </span>
    </div>
  );
}

function ReadOnlyRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-gray-100 py-2.5 text-sm last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)]">
      <span className="font-medium text-gray-500">{label}</span>
      <span className="min-w-0 break-words text-gray-800">
        {displayValue(value)}
      </span>
    </div>
  );
}

/* ── View Dialog ─────────────────────────────────────────────── */
function ViewDialog({
  row,
  onClose,
}: {
  row: VehicleBreakdownRecord;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const originalVehicle =
    row.breakdown_vehicle_detail?.vehicle_no ?? row.breakdown_vehicle_id;
  const replacementVehicle =
    row.replacement_vehicle_detail?.vehicle_no ?? row.replacement_vehicle_id;
  const originalDriver =
    row.original_driver_detail?.name ?? row.original_driver_detail?.unique_id;
  const replacementDriver =
    row.replacement_driver_detail?.name ?? row.replacement_driver_id;
  const originalOperator =
    row.original_operator_detail?.name ??
    row.original_operator_detail?.unique_id;
  const replacementOperator =
    row.replacement_operator_detail?.name ?? row.replacement_operator_id;
  const altTemplate = row.alt_staff_template_detail;
  const altTemplateLabel = altTemplate
    ? `${altTemplate.display_code ?? altTemplate.unique_id} (${altTemplate.unique_id})`
    : row.alt_staff_template_id;
  const altTemplateCrew = altTemplate
    ? `${altTemplate.driver?.name ?? altTemplate.driver?.unique_id ?? t("admin.vehicle_breakdown.driver")} / ${altTemplate.operator?.name ?? altTemplate.operator?.unique_id ?? t("admin.vehicle_breakdown.operator")}`
    : null;
  const hasPendingStops = !!row.pending_stops;

  return (
    <Dialog
      visible
      onHide={onClose}
      header={
        <div>
          <p className="text-lg font-bold text-gray-800">
            {t("admin.vehicle_breakdown.view.title")}
          </p>
          <p className="mt-0.5 text-xs font-normal text-gray-400">
            {row.unique_id}
          </p>
        </div>
      }
      style={{ width: "1120px", maxWidth: "96vw" }}
      contentStyle={{ maxHeight: "calc(100vh - 10rem)", overflowY: "auto" }}
      modal
      draggable={false}
      resizable={false}
      footer={
        <div className="flex justify-end">
          <Button
            label={t("admin.vehicle_breakdown.close")}
            className="p-button-text p-button-secondary"
            onClick={onClose}
          />
        </div>
      }
    >
      <div className="space-y-5 pt-2">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium text-gray-500">{t("common.status")}</p>
            <div className="mt-2">
              <StatusBadge value={row.status} />
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium text-gray-500">{t("admin.vehicle_breakdown.approval_label")}</p>
            <div className="mt-2">
              <ApprovalBadge value={row.approval_status} />
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium text-gray-500">{t("admin.vehicle_breakdown.new_trip")}</p>
            <p className="mt-2 break-words font-mono text-sm text-green-700">
              {displayValue(row.new_assignment_id)}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200">
          <div className="grid grid-cols-1 gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 lg:grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)]">
            <span>{t("admin.vehicle_breakdown.view.field")}</span>
            <span>{t("admin.vehicle_breakdown.view.original")}</span>
            <span>{t("admin.vehicle_breakdown.view.changed_to")}</span>
          </div>
          <div className="px-4">
            <DetailRow
              label={t("common.vehicle")}
              before={originalVehicle}
              after={replacementVehicle}
              highlight
            />
            <DetailRow
              label={t("admin.vehicle_breakdown.driver")}
              before={originalDriver}
              after={replacementDriver}
              highlight
            />
            <DetailRow
              label={t("admin.vehicle_breakdown.operator")}
              before={originalOperator}
              after={replacementOperator}
              highlight
            />
            <DetailRow
              label={t("admin.vehicle_breakdown.trip")}
              before={row.trip_assignment_id}
              after={row.new_assignment_id}
              highlight={!!row.new_assignment_id}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-gray-800">
              {t("admin.vehicle_breakdown.breakdown")}
            </p>
            <ReadOnlyRow
              label={t("admin.vehicle_breakdown.trip_date")}
              value={row.trip_assignment_detail?.trip_date}
            />
            <ReadOnlyRow
              label={t("common.panchayat")}
              value={row.trip_assignment_detail?.panchayat_name}
            />
            <ReadOnlyRow
              label={t("admin.vehicle_breakdown.reason")}
              value={breakdownReasonLabel(t, row.breakdown_reason)}
            />
            <ReadOnlyRow label={t("admin.vehicle_breakdown.view.time")} value={row.breakdown_time} />
            <ReadOnlyRow label={t("common.location")} value={row.breakdown_location} />
            <ReadOnlyRow
              label={t("admin.vehicle_breakdown.view.coordinates")}
              value={
                row.breakdown_lat && row.breakdown_lng
                  ? `${row.breakdown_lat}, ${row.breakdown_lng}`
                  : null
              }
            />
            <ReadOnlyRow
              label={t("admin.vehicle_breakdown.view.weight_before")}
              value={
                row.collected_weight_before_breakdown_kg
                  ? `${row.collected_weight_before_breakdown_kg} kg`
                  : null
              }
            />
          </div>

          <div className="rounded-lg border border-gray-200 px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-gray-800">{t("admin.vehicle_breakdown.approval_label")}</p>
            <ReadOnlyRow
              label={t("admin.vehicle_breakdown.view.approved_by")}
              value={row.approved_by_detail?.name ?? row.approved_by}
            />
            <ReadOnlyRow label={t("admin.vehicle_breakdown.view.approved_at")} value={row.approved_at} />
            <ReadOnlyRow
              label={t("admin.vehicle_breakdown.view.alt_template")}
              value={altTemplateLabel}
            />
            <ReadOnlyRow label={t("admin.vehicle_breakdown.view.alt_crew")} value={altTemplateCrew} />
            <ReadOnlyRow
              label={t("admin.vehicle_breakdown.view.change_reason")}
              value={altTemplate?.change_reason}
            />
            <ReadOnlyRow
              label={t("admin.vehicle_breakdown.view.change_remarks")}
              value={altTemplate?.change_remarks}
            />
            <ReadOnlyRow
              label={t("admin.vehicle_breakdown.view.rejected_reason")}
              value={row.rejection_remarks}
            />
            <ReadOnlyRow label={t("common.created_at")} value={row.created_at} />
            <ReadOnlyRow label={t("common.updated_at")} value={row.updated_at} />
          </div>
        </div>

        {hasPendingStops && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            {t("admin.vehicle_breakdown.view.pending_work")}{" "}
            {t("admin.vehicle_breakdown.pending_counts", {
              points: row.pending_stops!.collection_points.length,
              households: row.pending_stops!.households.length,
            })}
          </div>
        )}

        {row.breakdown_remarks && (
          <div className="rounded-lg border border-gray-200 px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-gray-800">{t("admin.vehicle_breakdown.remarks")}</p>
            <p className="whitespace-pre-wrap text-sm text-gray-700">
              {row.breakdown_remarks}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/* ── Verify Dialog ─────────────────────────────────────────────── */
function VerifyDialog({
  row,
  onClose,
  onConfirm,
  isLoading,
}: {
  row: VehicleBreakdownRecord;
  onClose: () => void;
  onConfirm: (
    remarks: string,
    collectionPointIds: string[] | undefined,
    moveAssignmentIds: string[],
    substitutePlanIds: string[],
    replacementVehicleId: string,
    replacementDriverId: string,
    replacementOperatorId: string,
  ) => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const [remarks, setRemarks] = useState("");
  // The supervisor picks the replacement vehicle and crew here (the driver
  // reports from the app without them). A choice made when reporting on the
  // web is pre-selected.
  const [replacementVehicleId, setReplacementVehicleId] = useState(
    row.replacement_vehicle_id ?? "",
  );
  const [vehicleOptions, setVehicleOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [crewOptions, setCrewOptions] = useState<
    { value: string; label: string; driverId: string; operatorId: string }[]
  >([]);
  const [crewValue, setCrewValue] = useState("");
  const [loadingCrews, setLoadingCrews] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const params: Record<string, string> = {
      date: row.trip_assignment_detail?.trip_date ?? "",
    };
    if (row.company_id) params.company_id = row.company_id;
    if (row.project_id) params.project_id = row.project_id;

    api
      .get("/schedule-operations/vehicle-breakdowns/available-vehicles/", {
        // exclude_id keeps this breakdown's own pre-picked vehicle listed.
        params: { ...params, exclude_id: row.unique_id },
      })
      .then(({ data }) => {
        if (cancelled) return;
        const list: { unique_id?: string; vehicle_no?: string }[] = Array.isArray(data)
          ? data
          : [];
        const opts = list
          .filter((v) => v.unique_id && v.unique_id !== row.breakdown_vehicle_id)
          .map((v) => ({ value: v.unique_id!, label: v.vehicle_no ?? v.unique_id! }));
        if (
          row.replacement_vehicle_id &&
          !opts.some((o) => o.value === row.replacement_vehicle_id)
        ) {
          opts.unshift({
            value: row.replacement_vehicle_id,
            label: row.replacement_vehicle_detail?.vehicle_no ?? row.replacement_vehicle_id,
          });
        }
        setVehicleOptions(opts);
      })
      .catch(() => !cancelled && setVehicleOptions([]))
      .finally(() => !cancelled && setLoadingVehicles(false));

    api
      .get("/schedule-operations/vehicle-breakdowns/available-staff-templates/", {
        // The broken trip's own crew is listed too: it can carry on.
        params: { ...params, trip_assignment_id: row.trip_assignment_id },
      })
      .then(({ data }) => {
        if (cancelled) return;
        const list: {
          unique_id?: string;
          display_code?: string;
          driver_id?: string;
          operator_id?: string;
          driver_name?: string;
          operator_name?: string;
        }[] = Array.isArray(data) ? data : [];
        const opts = list
          .filter((tpl) => tpl.unique_id && tpl.driver_id && tpl.operator_id)
          .map((tpl) => ({
            value: tpl.unique_id!,
            label: `${tpl.display_code ?? tpl.unique_id} — ${tpl.driver_name ?? t("admin.vehicle_breakdown.driver")} / ${tpl.operator_name ?? t("admin.vehicle_breakdown.operator")}`,
            driverId: tpl.driver_id!,
            operatorId: tpl.operator_id!,
          }));
        if (row.replacement_driver_id && row.replacement_operator_id) {
          const match = opts.find(
            (o) =>
              o.driverId === row.replacement_driver_id &&
              o.operatorId === row.replacement_operator_id,
          );
          if (match) {
            setCrewValue(match.value);
          } else {
            opts.unshift({
              value: "__current__",
              label: t("admin.vehicle_breakdown.verify.current_replacement", {
                driver: row.replacement_driver_detail?.name ?? t("admin.vehicle_breakdown.driver"),
                operator: row.replacement_operator_detail?.name ?? t("admin.vehicle_breakdown.operator"),
              }),
              driverId: row.replacement_driver_id,
              operatorId: row.replacement_operator_id,
            });
            setCrewValue("__current__");
          }
        }
        setCrewOptions(opts);
      })
      .catch(() => !cancelled && setCrewOptions([]))
      .finally(() => !cancelled && setLoadingCrews(false));

    return () => {
      cancelled = true;
    };
  }, [row]);
  // Keyed by the vehicle it was loaded for: a result for a previously
  // picked vehicle is treated as still loading.
  const [previewState, setPreviewState] = useState<{
    vehicleId: string;
    data: VerifyPreview | null;
    error: string | null;
  } | null>(null);
  const current = previewState?.vehicleId === replacementVehicleId ? previewState : null;
  const preview = current?.data ?? null;
  const previewError = current?.error ?? null;
  // Defaults come from the preview: a trip / plan is ticked only when the
  // replacement vehicle has no other work then.
  const [selectedTrips, setSelectedTrips] = useState<string[]>([]);
  const [selectedPlans, setSelectedPlans] = useState<string[]>([]);

  useEffect(() => {
    // Without a vehicle the preview still lists the trips/plans and the
    // original crew; it is re-run for each vehicle picked.
    let cancelled = false;
    api
      .get<VerifyPreview>(
        `/schedule-operations/vehicle-breakdowns/${row.unique_id}/verify-preview/`,
        { params: replacementVehicleId ? { replacement_vehicle_id: replacementVehicleId } : {} },
      )
      .then(({ data }) => {
        if (cancelled) return;
        setPreviewState({ vehicleId: replacementVehicleId, data, error: null });
        setSelectedTrips(
          data.upcoming_trips.filter((trip) => trip.default_move).map((trip) => trip.unique_id),
        );
        setSelectedPlans(
          data.plans
            .filter((p) => p.default_substitute)
            .map((p) => p.trip_plan_id),
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setPreviewState({
            vehicleId: replacementVehicleId,
            data: null,
            error: extractError(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [row.unique_id, replacementVehicleId]);

  const toggle =
    (setter: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
      setter((prev) =>
        prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
      );
  const toggleTrip = toggle(setSelectedTrips);
  const togglePlan = toggle(setSelectedPlans);

  const pending = row.pending_stops;
  const isBinTrip = !!pending && pending.collection_points.length > 0;
  const isHouseholdTrip = !!pending && pending.households.length > 0;
  const [selectedCps, setSelectedCps] = useState<string[]>(
    () => pending?.collection_points.map((cp) => cp.unique_id) ?? [],
  );
  const toggleCp = toggle(setSelectedCps);

  // Nothing picked yet: default to the same crew carrying on.
  const originalCrew = preview?.original_crew;
  const sameCrewOption = crewOptions.find(
    (o) =>
      !!originalCrew &&
      o.driverId === originalCrew.driver_id &&
      o.operatorId === originalCrew.operator_id,
  );
  // Nothing picked yet → the same crew.
  const effectiveCrewValue = crewValue || sameCrewOption?.value || "";
  const selectedCrew = crewOptions.find((o) => o.value === effectiveCrewValue);

  const canConfirm =
    !!replacementVehicleId &&
    !!selectedCrew &&
    !!preview &&
    (!isBinTrip || selectedCps.length > 0);
  const replacementNo =
    vehicleOptions.find((o) => o.value === replacementVehicleId)?.label ??
    t("admin.vehicle_breakdown.verify.the_replacement_vehicle");

  const footer = (
    <div className="flex justify-end gap-2 pt-2">
      <Button
        label={t("common.cancel")}
        className="p-button-text p-button-secondary"
        onClick={onClose}
        disabled={isLoading}
      />
      <Button
        label={t("admin.vehicle_breakdown.verify.confirm")}
        icon="pi pi-check"
        className="p-button-success"
        loading={isLoading}
        disabled={!canConfirm}
        onClick={() =>
          onConfirm(
            remarks,
            isBinTrip ? selectedCps : undefined,
            selectedTrips,
            selectedPlans,
            replacementVehicleId,
            selectedCrew?.driverId ?? "",
            selectedCrew?.operatorId ?? "",
          )
        }
      />
    </div>
  );
  return (
    <Dialog
      visible
      onHide={onClose}
      header={
        <div>
          <p className="text-lg font-bold text-gray-800">
            {t("admin.vehicle_breakdown.verify.title")}
          </p>
          <p className="text-xs text-gray-400 font-normal mt-0.5">
            {row.unique_id}
          </p>
        </div>
      }
      footer={footer}
      style={{ width: "620px" }}
      modal
      draggable={false}
      resizable={false}
    >
      <div className="flex flex-col gap-4 pt-2">
        <div className="rounded-lg bg-gray-50 border border-gray-100 p-4 text-sm space-y-2">
          {[
            [t("admin.vehicle_breakdown.trip_id"), row.trip_assignment_id],
            [t("admin.vehicle_breakdown.trip_date"), row.trip_assignment_detail?.trip_date ?? "-"],
            [
              t("admin.vehicle_breakdown.broken_vehicle"),
              row.breakdown_vehicle_detail?.vehicle_no ??
                row.breakdown_vehicle_id,
            ],
            [
              t("admin.vehicle_breakdown.verify.original_crew"),
              originalCrew
                ? `${originalCrew.driver ?? "-"} / ${originalCrew.operator ?? "-"}`
                : "-",
            ],
          ].map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <span className="text-gray-500 w-40 shrink-0">{label}</span>
              <span className="font-medium text-gray-800">{value}</span>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
          <p className="text-sm font-semibold text-gray-700">{t("admin.vehicle_breakdown.replacement")}</p>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1.5">
              {t("admin.vehicle_breakdown.replacement_vehicle")} <span className="text-red-500">*</span>
            </p>
            {/* Native select: a popover list would open behind this dialog. */}
            <select
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={replacementVehicleId}
              onChange={(e) => setReplacementVehicleId(e.target.value)}
              disabled={loadingVehicles || isLoading}
            >
              <option value="">
                {loadingVehicles
                  ? t("admin.vehicle_breakdown.verify.loading_vehicles")
                  : vehicleOptions.length === 0
                    ? t("admin.vehicle_breakdown.verify.no_vehicles")
                    : t("admin.vehicle_breakdown.verify.select_vehicle")}
              </option>
              {vehicleOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {t("admin.vehicle_breakdown.verify.vehicle_hint")}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1.5">
              {t("admin.vehicle_breakdown.verify.replacement_crew")} <span className="text-red-500">*</span>
            </p>
            <select
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={effectiveCrewValue}
              onChange={(e) => setCrewValue(e.target.value)}
              disabled={loadingCrews || isLoading}
            >
              <option value="">
                {loadingCrews
                  ? t("admin.vehicle_breakdown.verify.loading_staff")
                  : crewOptions.length === 0
                    ? t("admin.vehicle_breakdown.verify.no_staff")
                    : t("admin.vehicle_breakdown.verify.select_staff")}
              </option>
              {crewOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                  {o === sameCrewOption ? ` ${t("admin.vehicle_breakdown.verify.same_crew")}` : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {t("admin.vehicle_breakdown.verify.crew_hint")}
            </p>
          </div>
        </div>

        {isBinTrip && (
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-sm font-medium text-gray-700 mb-2">
              {t("admin.vehicle_breakdown.verify.remaining_points", { count: pending!.collection_points.length })}
            </p>
            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
              {pending!.collection_points.map((cp) => (
                <label
                  key={cp.unique_id}
                  className="flex items-center gap-2 text-sm text-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={selectedCps.includes(cp.unique_id)}
                    onChange={() => toggleCp(cp.unique_id)}
                  />
                  <span>
                    {cp.name ?? cp.collection_point_id ?? cp.unique_id}
                  </span>
                  <span className="text-xs text-gray-400">({stopStatusLabel(t, cp.status)})</span>
                </label>
              ))}
            </div>
            {isBinTrip && selectedCps.length === 0 && (
              <p className="text-xs text-red-500 mt-2">
                {t("admin.vehicle_breakdown.verify.select_one_point")}
              </p>
            )}
          </div>
        )}

        {isHouseholdTrip && (
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800">
            {t("admin.vehicle_breakdown.form.households_carry_over", { count: pending!.households.length })}
          </div>
        )}

        {previewError && (
          <p className="text-xs text-red-600">
            {t("admin.vehicle_breakdown.verify.preview_error", { error: previewError })}
          </p>
        )}
        {!preview && !previewError && (
          <p className="text-xs text-gray-400">{t("admin.vehicle_breakdown.verify.checking")}</p>
        )}

        {preview && preview.upcoming_trips.length > 0 && (
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-sm font-medium text-gray-700">
              {t("admin.vehicle_breakdown.verify.other_trips", {
                vehicle: row.breakdown_vehicle_detail?.vehicle_no ?? t("admin.vehicle_breakdown.verify.this_vehicle"),
                count: preview.upcoming_trips.length,
              })}
            </p>
            <p className="text-xs text-gray-500 mb-2">
              {t("admin.vehicle_breakdown.verify.other_trips_hint", { vehicle: replacementNo })}
            </p>
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
              {preview.upcoming_trips.map((trip) => (
                <div key={trip.unique_id}>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={selectedTrips.includes(trip.unique_id)}
                      onChange={() => toggleTrip(trip.unique_id)}
                    />
                    <span>{t("admin.vehicle_breakdown.verify.move_to", { vehicle: replacementNo })}</span>
                    <span className="font-mono text-xs text-blue-700">
                      {trip.unique_id}
                    </span>
                    <span className="text-xs text-gray-400">
                      {trip.trip_date}
                      {trip.scheduled_time
                        ? ` · ${trip.scheduled_time.slice(0, 5)}`
                        : ""}
                      {trip.trip_plan_display_code
                        ? ` · ${trip.trip_plan_display_code}`
                        : ""}
                    </span>
                  </label>
                  {trip.replacement_busy.length > 0 && (
                    <p className="ml-6 text-xs text-amber-700">
                      ⚠ {t("admin.vehicle_breakdown.verify.already_has", {
                        vehicle: replacementNo,
                        trips: trip.replacement_busy
                          .map((b) =>
                            b.scheduled_time
                              ? t("admin.vehicle_breakdown.verify.trip_at", { trip: b.unique_id, time: b.scheduled_time.slice(0, 5) })
                              : b.unique_id,
                          )
                          .join(", "),
                      })}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {preview && preview.plans.length > 0 && (
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-sm font-medium text-gray-700">
              {t("admin.vehicle_breakdown.verify.use_until_repaired", { vehicle: replacementNo })}
            </p>
            <p className="text-xs text-gray-500 mb-2">
              {t("admin.vehicle_breakdown.verify.plans_hint", {
                date: preview.substitute_from_date,
                vehicle: replacementNo,
                broken: row.breakdown_vehicle_detail?.vehicle_no ?? t("admin.vehicle_breakdown.verify.the_vehicle"),
              })}
            </p>
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
              {preview.plans.map((plan) => (
                <div key={plan.trip_plan_id}>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={selectedPlans.includes(plan.trip_plan_id)}
                      onChange={() => togglePlan(plan.trip_plan_id)}
                    />
                    <span className="font-medium">
                      {plan.display_code ?? plan.trip_plan_id}
                    </span>
                    <span className="text-xs text-gray-400">
                      {plan.scheduled_time ? plan.scheduled_time.slice(0, 5) : ""}
                      {plan.days.length ? ` · ${plan.days.join(", ")}` : ""}
                    </span>
                  </label>
                  {plan.clashes.map((clash) => (
                    <p
                      key={`${clash.kind}-${clash.trip_plan_id}`}
                      className="ml-6 text-xs text-amber-700"
                    >
                      ⚠ {t(
                        clash.kind === "own_plan"
                          ? clash.scheduled_time
                            ? "admin.vehicle_breakdown.verify.clash_own_plan_at"
                            : "admin.vehicle_breakdown.verify.clash_own_plan"
                          : clash.scheduled_time
                            ? "admin.vehicle_breakdown.verify.clash_substitution_at"
                            : "admin.vehicle_breakdown.verify.clash_substitution",
                        {
                          vehicle: replacementNo,
                          plan: clash.display_code ?? clash.trip_plan_id,
                          time: clash.scheduled_time?.slice(0, 5) ?? "",
                          days: clash.days.join(", "),
                        },
                      )}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg bg-green-50 border border-green-100 p-3 text-xs text-green-800">
          <strong>{t("admin.vehicle_breakdown.verify.on_approval")}</strong>{" "}
          {t("admin.vehicle_breakdown.verify.on_approval_text", { trip: row.trip_assignment_id })}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700 mb-1.5">
            {t("admin.vehicle_breakdown.remarks_optional")}
          </p>
          <InputTextarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            className="w-full text-sm"
            placeholder={t("admin.vehicle_breakdown.verify.remarks_placeholder")}
            autoResize
          />
        </div>
      </div>
    </Dialog>
  );
}

/* ── Reject Dialog ─────────────────────────────────────────────── */
function RejectDialog({
  row,
  onClose,
  onConfirm,
  isLoading,
}: {
  row: VehicleBreakdownRecord;
  onClose: () => void;
  onConfirm: (remarks: string) => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const [remarks, setRemarks] = useState("");
  const footer = (
    <div className="flex justify-end gap-2 pt-2">
      <Button
        label={t("common.cancel")}
        className="p-button-text p-button-secondary"
        onClick={onClose}
        disabled={isLoading}
      />
      <Button
        label={t("admin.vehicle_breakdown.reject")}
        icon="pi pi-times"
        className="p-button-danger"
        loading={isLoading}
        disabled={!remarks.trim()}
        onClick={() => onConfirm(remarks)}
      />
    </div>
  );
  return (
    <Dialog
      visible
      onHide={onClose}
      header={
        <div>
          <p className="text-lg font-bold text-gray-800">
            {t("admin.vehicle_breakdown.reject_dialog.title")}
          </p>
          <p className="text-xs text-gray-400 font-normal mt-0.5">
            {row.unique_id}
          </p>
        </div>
      }
      footer={footer}
      style={{ width: "460px" }}
      modal
      draggable={false}
      resizable={false}
    >
      <div className="flex flex-col gap-4 pt-2">
        <p className="text-sm text-gray-600">
          {t("admin.vehicle_breakdown.reject_dialog.text", {
            vehicle: row.breakdown_vehicle_detail?.vehicle_no ?? row.breakdown_vehicle_id,
            trip: row.trip_assignment_id,
          })}
        </p>
        <div>
          <p className="text-sm font-medium text-gray-700 mb-1.5">
            {t("admin.vehicle_breakdown.reject_dialog.reason")} <span className="text-red-500">*</span>
          </p>
          <InputTextarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            className="w-full text-sm"
            placeholder={t("admin.vehicle_breakdown.reject_dialog.placeholder")}
            autoResize
          />
        </div>
      </div>
    </Dialog>
  );
}

/* ── Mark Repaired Dialog ──────────────────────────────────────── */
function MarkRepairedDialog({
  row,
  onClose,
  onConfirm,
  isLoading,
}: {
  row: VehicleBreakdownRecord;
  onClose: () => void;
  onConfirm: (remarks: string) => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const [remarks, setRemarks] = useState("");
  const footer = (
    <div className="flex justify-end gap-2 pt-2">
      <Button
        label={t("common.cancel")}
        className="p-button-text p-button-secondary"
        onClick={onClose}
        disabled={isLoading}
      />
      <Button
        label={t("admin.vehicle_breakdown.repair.button")}
        icon="pi pi-wrench"
        className="p-button-success"
        loading={isLoading}
        onClick={() => onConfirm(remarks)}
      />
    </div>
  );
  return (
    <Dialog
      visible
      onHide={onClose}
      header={
        <div>
          <p className="text-lg font-bold text-gray-800">{t("admin.vehicle_breakdown.repair.title")}</p>
          <p className="text-xs text-gray-400 font-normal mt-0.5">
            {row.unique_id}
          </p>
        </div>
      }
      footer={footer}
      style={{ width: "460px" }}
      modal
      draggable={false}
      resizable={false}
    >
      <div className="flex flex-col gap-4 pt-2">
        <p className="text-sm text-gray-600">
          {t("admin.vehicle_breakdown.repair.text", {
            vehicle: row.breakdown_vehicle_detail?.vehicle_no ?? row.breakdown_vehicle_id,
          })}
        </p>
        <div>
          <p className="text-sm font-medium text-gray-700 mb-1.5">
            {t("admin.vehicle_breakdown.repair.remarks")}
          </p>
          <InputTextarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            className="w-full text-sm"
            placeholder={t("admin.vehicle_breakdown.repair.placeholder")}
            autoResize
          />
        </div>
      </div>
    </Dialog>
  );
}

/* ── Main Component ─────────────────────────────────────────────── */
export default function VehicleBreakdownList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canAdd, canEdit } = useScreenAccess();
  const location = useLocation();
  const restoredState = location.state as {
    companyUniqueId?: string;
    projectId?: string;
  } | null;

  // Company/Project live in the table's Filters panel as a draft; the list,
  // exports and "Report Breakdown" context use the APPLIED pair.
  const companyProject = useCompanyProjectFilter(() => setFirst(0), {
    // coming back from the form restores the company/project it was opened with
    initialCompanyId: restoredState?.companyUniqueId,
    initialProjectId: restoredState?.projectId,
  });
  const { companyId: companyUniqueId, projectId } = companyProject;
  const { companies, isSuperAdmin } = companyProject.selection;

  const { encScheduleOperations, encVehicleBreakdown } = getEncryptedRoute();
  const { newPath, editPath } = createCrudRoutePaths(
    encScheduleOperations,
    encVehicleBreakdown,
  );
  const selectedContext = { companyUniqueId, projectId };

  const [rawRows, setRawRows] = useState<VehicleBreakdownRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalFilterValue, setGlobalFilterValue] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<SortOrder>(undefined);
  const [totalRecords, setTotalRecords] = useState(0);
  const [first, setFirst] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const requestIdRef = useRef(0);

  const [verifyTarget, setVerifyTarget] =
    useState<VehicleBreakdownRecord | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [rejectTarget, setRejectTarget] =
    useState<VehicleBreakdownRecord | null>(null);
  const [isRejecting, setIsRejecting] = useState(false);
  const [repairTarget, setRepairTarget] =
    useState<VehicleBreakdownRecord | null>(null);
  const [isRepairing, setIsRepairing] = useState(false);
  const [viewTarget, setViewTarget] = useState<VehicleBreakdownRecord | null>(
    null,
  );

  /* ── Fetch ─────────────────────────────────────────────────────── */
  const ordering =
    sortField && SORTABLE_FIELDS.has(sortField)
      ? `${sortOrder === -1 ? "-" : ""}${sortField}`
      : undefined;

  const loadRows = async (page: number, limit: number) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setRawRows([]);
    try {
      const params: Record<string, string> = {};
      if (companyUniqueId) params.company_id = companyUniqueId;
      if (projectId) params.project_id = projectId;
      // Backend has NO DRF SearchFilter — it manually ORs across 6 fields
      // via `?search=` (see get_queryset() in vehicle_breakdown_viewset.py).
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (ordering) params.ordering = ordering;

      const response = await vehicleBreakdownApi.readAllwithPaginated(
        page,
        limit,
        { params },
      );
      if (requestId !== requestIdRef.current) return;
      const list = toRecordList(response);
      setRawRows(list);
      setTotalRecords(
        typeof (response as { count?: number })?.count === "number"
          ? ((response as { count?: number }).count as number)
          : list.length,
      );
    } catch {
      if (requestId !== requestIdRef.current) return;
      Swal.fire(t("common.error"), t("common.load_failed"), "error");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin && companies.length === 0) {
      requestIdRef.current += 1;
      setRawRows([]);
      setTotalRecords(0);
      return;
    }
    if (!companyUniqueId && !isSuperAdmin) {
      requestIdRef.current += 1;
      setRawRows([]);
      setTotalRecords(0);
      return;
    }

    void loadRows(first / rowsPerPage + 1, rowsPerPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    companyUniqueId,
    projectId,
    companies.length,
    isSuperAdmin,
    first,
    rowsPerPage,
    searchTerm,
    ordering,
    t,
  ]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setFirst(0);
      setSearchTerm(globalFilterValue);
    }, 400);
    return () => clearTimeout(timeout);
  }, [globalFilterValue]);

  const onPage = (event: DataTablePageEvent) => {
    setFirst(event.first);
    setRowsPerPage(event.rows);
  };

  const onSort = (event: DataTableSortEvent) => {
    setFirst(0);
    setSortField(event.sortField);
    setSortOrder(event.sortOrder);
  };

  /* ── Enrich rows for display ──────────────────────────────── */
  const rows = rawRows.map((r) => ({
    ...r,
    _trip_date: r.trip_assignment_detail?.trip_date ?? "",
    _panchayat: r.trip_assignment_detail?.panchayat_name ?? "",
    _breakdown_vehicle:
      r.breakdown_vehicle_detail?.vehicle_no ?? r.breakdown_vehicle_id,
    _replacement_vehicle:
      r.replacement_vehicle_detail?.vehicle_no ?? r.replacement_vehicle_id,
    _repl_driver: r.replacement_driver_detail?.name ?? "",
    _repl_operator: r.replacement_operator_detail?.name ?? "",
    _breakdown_reason: breakdownReasonLabel(t, r.breakdown_reason),
  }));

  /* ── Delete ─────────────────────────────────────────────────────── */
  const handleDelete = async (row: VehicleBreakdownRecord) => {
    const reason = await confirmDeleteWithReason({
      title: t("common.are_you_sure"),
      text: t("admin.vehicle_breakdown.delete_confirm", { id: row.unique_id }),
      confirmButtonText: t("common.delete"),
    });
    if (reason === null) return;
    try {
      await vehicleBreakdownApi.delete(row.unique_id, withDeleteReason(reason));
      setRawRows((prev) => prev.filter((r) => r.unique_id !== row.unique_id));
      Swal.fire(t("common.success"), t("common.deleted_success"), "success");
    } catch (err: any) {
      Swal.fire(t("common.error"), extractError(err), "error");
    }
  };

  /* ── Verify ─────────────────────────────────────────────────────── */
  const handleVerifyConfirm = async (
    remarks: string,
    collectionPointIds: string[] | undefined,
    moveAssignmentIds: string[],
    substitutePlanIds: string[],
    replacementVehicleId: string,
    replacementDriverId: string,
    replacementOperatorId: string,
  ) => {
    if (!verifyTarget) return;
    setIsVerifying(true);
    try {
      const { data } = await api.patch(
        `/schedule-operations/vehicle-breakdowns/${verifyTarget.unique_id}/verify/`,
        {
          remarks,
          ...(collectionPointIds
            ? { collection_point_ids: collectionPointIds }
            : {}),
          move_assignment_ids: moveAssignmentIds,
          substitute_plan_ids: substitutePlanIds,
          replacement_vehicle_id: replacementVehicleId,
          replacement_driver_id: replacementDriverId,
          replacement_operator_id: replacementOperatorId,
        },
      );
      setRawRows((prev) =>
        prev.map((r) =>
          r.unique_id === verifyTarget.unique_id
            ? {
                ...r,
                // The response carries the replacement vehicle/crew picked here.
                ...data,
                status: "REPLACEMENT_ARRANGED",
                approval_status: "APPROVED",
                new_assignment_id: data?.new_assignment_id ?? null,
                moved_assignment_ids: data?.moved_assignment_ids ?? [],
                upcoming_trips: [],
              }
            : r,
        ),
      );
      setVerifyTarget(null);
      const summary = data?.new_assignment_id
        ? t("admin.vehicle_breakdown.verify_result.trip_created", { id: data.new_assignment_id })
        : t("admin.vehicle_breakdown.verify_result.vehicle_assigned");
      const movedCount = data?.moved_assignment_ids?.length ?? 0;
      const substitutedCount = data?.substituted_plan_ids?.length ?? 0;
      const upcomingDays = substitutedCount
        ? ` ${t("admin.vehicle_breakdown.verify_result.plans_substituted", { count: substitutedCount })}`
        : "";
      const skipped: { trip_id: string; reason: string }[] =
        data?.skipped_moves ?? [];
      if (skipped.length) {
        // Needs reading — no auto-close.
        Swal.fire({
          icon: "warning",
          title: t("admin.vehicle_breakdown.verify_result.partial_title"),
          text: [
            summary,
            `${t("admin.vehicle_breakdown.verify_result.trips_moved", { count: movedCount })}${upcomingDays}`,
            "",
            ...skipped.map((s) => `${s.trip_id}: ${s.reason}`),
            "",
            t("admin.vehicle_breakdown.verify_result.move_manually"),
          ].join("\n"),
        });
      } else {
        Swal.fire({
          icon: "success",
          title: t("admin.vehicle_breakdown.approval.APPROVED"),
          text:
            (movedCount
              ? `${summary} ${t("admin.vehicle_breakdown.verify_result.trips_moved", { count: movedCount })}`
              : summary) + upcomingDays,
          timer: 2500,
          showConfirmButton: false,
        });
      }
    } catch (err: any) {
      Swal.fire(t("common.error"), extractError(err), "error");
    } finally {
      setIsVerifying(false);
    }
  };

  /* ── Reject ─────────────────────────────────────────────────────── */
  const handleRejectConfirm = async (remarks: string) => {
    if (!rejectTarget) return;
    setIsRejecting(true);
    try {
      await api.patch(
        `/schedule-operations/vehicle-breakdowns/${rejectTarget.unique_id}/reject/`,
        { rejection_remarks: remarks },
      );
      setRawRows((prev) =>
        prev.map((r) =>
          r.unique_id === rejectTarget.unique_id
            ? { ...r, status: "REJECTED", approval_status: "REJECTED" }
            : r,
        ),
      );
      setRejectTarget(null);
      Swal.fire({
        icon: "info",
        title: t("admin.vehicle_breakdown.approval.REJECTED"),
        text: t("admin.vehicle_breakdown.reject_dialog.success"),
        timer: 2000,
        showConfirmButton: false,
      });
    } catch (err: any) {
      Swal.fire(t("common.error"), extractError(err), "error");
    } finally {
      setIsRejecting(false);
    }
  };

  /* ── Mark Repaired ──────────────────────────────────────────────── */
  const handleRepairConfirm = async (remarks: string) => {
    if (!repairTarget) return;
    setIsRepairing(true);
    try {
      const { data } = await api.patch(
        `/schedule-operations/vehicle-breakdowns/${repairTarget.unique_id}/mark-repaired/`,
        { repair_remarks: remarks },
      );
      setRawRows((prev) =>
        prev.map((r) =>
          r.unique_id === repairTarget.unique_id ? { ...r, ...data } : r,
        ),
      );
      setRepairTarget(null);
      Swal.fire({
        icon: "success",
        title: t("admin.vehicle_breakdown.repaired"),
        text: t("admin.vehicle_breakdown.repair.success"),
        timer: 2000,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire(t("common.error"), extractError(err), "error");
    } finally {
      setIsRepairing(false);
    }
  };

  /* ── Search ─────────────────────────────────────────────────────── */
  const onGlobalFilterChange = (value: string) => {
    setGlobalFilterValue(value);
  };

  /* ── Export ─────────────────────────────────────────────────────── */
  // Exports the full matching dataset (respecting company/project scope and
  // the current search term) via the dedicated export endpoint, rather than
  // just the current page of `rows` — pagination should not shrink exports.

  // Feeds the table's single "Download Excel" button: "All data" re-fetches
  // every breakdown matching the current company/project/search filters.
  const loadAllExportRows = async () => {
    const params: Record<string, string> = {};
    if (companyUniqueId) params.company_id = companyUniqueId;
    if (projectId) params.project_id = projectId;
    if (searchTerm.trim()) params.search = searchTerm.trim();

    const response = await vehicleBreakdownApi.readAllForExport({ params });
    return toRecordList(response).map((r) => ({
      [t("admin.vehicle_breakdown.trip_date")]: r.trip_assignment_detail?.trip_date ?? "",
      [t("common.panchayat")]: r.trip_assignment_detail?.panchayat_name ?? "",
      [t("admin.vehicle_breakdown.broken_vehicle")]:
        r.breakdown_vehicle_detail?.vehicle_no ?? r.breakdown_vehicle_id,
      [t("admin.vehicle_breakdown.replacement_vehicle")]:
        r.replacement_vehicle_detail?.vehicle_no ?? r.replacement_vehicle_id,
      [t("admin.vehicle_breakdown.repl_driver")]: r.replacement_driver_detail?.name ?? "",
      [t("admin.vehicle_breakdown.repl_operator")]: r.replacement_operator_detail?.name ?? "",
      [t("admin.vehicle_breakdown.reason")]: breakdownReasonLabel(t, r.breakdown_reason),
      [t("common.status")]: statusLabel(t, r.status),
      [t("admin.vehicle_breakdown.approval_label")]: approvalLabel(t, r.approval_status),
    }));
  };

  /* ── Action column ──────────────────────────────────────────────── */
  const actionTemplate = (row: VehicleBreakdownRecord) => {
    const isPending = row.approval_status === "PENDING";
    const extraActions: ActionMenuItem[] = [
      {
        key: "view",
        label: t("admin.vehicle_breakdown.actions.view_changes"),
        icon: <i className="pi pi-eye" />,
        onClick: () => setViewTarget(row),
      },
    ];

    if (isPending && canEdit) {
      extraActions.push(
        {
          key: "verify",
          label: t("admin.vehicle_breakdown.actions.verify"),
          icon: <i className="pi pi-check-circle" />,
          onClick: () => setVerifyTarget(row),
        },
        {
          key: "reject",
          label: t("admin.vehicle_breakdown.reject"),
          icon: <i className="pi pi-times-circle" />,
          onClick: () => setRejectTarget(row),
        },
      );
    }

    if (row.approval_status === "APPROVED" && !row.repaired_at && canEdit) {
      extraActions.push({
        key: "mark-repaired",
        label: t("admin.vehicle_breakdown.repair.title"),
        icon: <i className="pi pi-wrench" />,
        onClick: () => setRepairTarget(row),
      });
    }

    return (
      <div className="flex justify-center">
        <ActionMenu
          onEdit={
            isPending
              ? () =>
                  navigate(editPath(row.unique_id), {
                    state: { record: row, ...selectedContext },
                  })
              : undefined
          }
          actions={extraActions}
          onDelete={
            row.approval_status !== "APPROVED"
              ? () => void handleDelete(row)
              : undefined
          }
          deleteDisabledReason={
            row.approval_status === "APPROVED"
              ? t("admin.vehicle_breakdown.cannot_delete_approved")
              : undefined
          }
        />
      </div>
    );
  };

  /* ── Header ─────────────────────────────────────────────────────── */
  const header = (
    <FilterBar
      searchValue={globalFilterValue}
      onSearchChange={onGlobalFilterChange}
      searchPlaceholder={t("admin.vehicle_breakdown.search_placeholder")}
    />
  );

  /* ════════════════════════════════════════════════════════════════
      RENDER
  ════════════════════════════════════════════════════════════════ */
  return (
    <div className="p-3">
      {/* Title row */}
      <div className="mb-6 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-gray-800">
            {t("admin.vehicle_breakdown.title")}
          </h1>
          <p className="text-sm text-gray-500">
            {t("admin.vehicle_breakdown.subtitle")}
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          {canAdd && (
            <Button
              label={t("admin.vehicle_breakdown.report_breakdown")}
              icon="pi pi-plus"
              className="p-button-success p-button-sm"
              onClick={() => navigate(newPath, { state: selectedContext })}
            />
          )}
        </div>
      </div>

      {/* DataTable */}
      <DataTable
        loadExportRows={loadAllExportRows}
        value={rows}
        dataKey="unique_id"
        lazy
        paginator
        first={first}
        rows={rowsPerPage}
        totalRecords={totalRecords}
        onPage={onPage}
        sortField={sortField}
        sortOrder={sortOrder}
        onSort={onSort}
        rowsPerPageOptions={[5, 10, 25, 50]}
        loading={loading}
        header={header}
        filterPanel={combineFilters(companyProject)}
        stripedRows
        showGridlines
        fitWidth
        className="p-datatable-sm"
        emptyMessage={t("admin.vehicle_breakdown.empty")}
      >
        <Column
          header={t("common.s_no")}
          body={(_: any, { rowIndex }: any) => rowIndex + 1}
          style={{ width: "4%" }}
        />
        <Column
          field="unique_id"
          header={t("admin.vehicle_breakdown.breakdown")}
          style={{ width: "19%" }}
          body={(r: any) => (
            <StackCell
              primary={r.unique_id}
              lines={[
                { label: t("admin.vehicle_breakdown.trip"), value: r.trip_assignment_id },
                { icon: "pi-calendar", value: r._trip_date },
                r.new_assignment_id
                  ? {
                      label: t("admin.vehicle_breakdown.new_trip"),
                      value: (
                        <span className="font-mono text-green-700">
                          {r.new_assignment_id}
                        </span>
                      ),
                    }
                  : null,
              ]}
            />
          )}
        />
        {locationColumn<(typeof rows)[number]>({
          header: t("common.location"),
          style: { width: "14%" },
          levels: [{ label: t("common.panchayat"), value: (r) => r._panchayat }],
        })}
        <Column
          field="_breakdown_vehicle"
          header={t("admin.vehicle_breakdown.vehicle_crew")}
          style={{ width: "21%" }}
          body={(r: any) => (
            <StackCell
              primary={
                <span className="text-red-700" title={t("admin.vehicle_breakdown.broken_vehicle")}>
                  {r._breakdown_vehicle}
                </span>
              }
              lines={[
                {
                  label: t("admin.vehicle_breakdown.replacement"),
                  value: r._replacement_vehicle && (
                    <span className="font-semibold text-green-700">
                      {r._replacement_vehicle}
                    </span>
                  ),
                },
                { label: t("admin.vehicle_breakdown.repl_driver"), value: r._repl_driver },
                { label: t("admin.vehicle_breakdown.repl_operator"), value: r._repl_operator },
              ]}
            />
          )}
        />
        <Column
          field="_breakdown_reason"
          header={t("admin.vehicle_breakdown.reason")}
          style={{ width: "18%" }}
          body={(r: any) => r._breakdown_reason}
        />
        <Column
          field="status"
          header={t("common.status")}
          sortable
          style={{ width: "17%" }}
          body={(r: VehicleBreakdownRecord) => (
            <div className="flex flex-col items-start gap-1">
              <StatusBadge value={r.status} />
              <ApprovalBadge value={r.approval_status} />
              {r.status === "REJECTED" ? null : r.repaired_at ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                  {t("admin.vehicle_breakdown.repaired")}
                </span>
              ) : (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                  {t("admin.vehicle_breakdown.under_breakdown")}
                </span>
              )}
            </div>
          )}
        />
        <Column
          header={t("common.actions")}
          body={actionTemplate}
          style={{ width: "7%" }}
        />
      </DataTable>

      {/* View Dialog */}
      {viewTarget && (
        <ViewDialog row={viewTarget} onClose={() => setViewTarget(null)} />
      )}

      {/* Verify Dialog */}
      {verifyTarget && (
        <VerifyDialog
          row={verifyTarget}
          onClose={() => setVerifyTarget(null)}
          onConfirm={handleVerifyConfirm}
          isLoading={isVerifying}
        />
      )}

      {/* Reject Dialog */}
      {rejectTarget && (
        <RejectDialog
          row={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={handleRejectConfirm}
          isLoading={isRejecting}
        />
      )}

      {/* Mark Repaired Dialog */}
      {repairTarget && (
        <MarkRepairedDialog
          row={repairTarget}
          onClose={() => setRepairTarget(null)}
          onConfirm={handleRepairConfirm}
          isLoading={isRepairing}
        />
      )}
    </div>
  );
}
