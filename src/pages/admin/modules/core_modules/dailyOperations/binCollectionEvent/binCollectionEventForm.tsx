import type { BinCERecord } from "./types";
import type { FormState, SelectOption } from "./types";
import { createCrudRoutePaths } from "@/utils/routePaths";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Swal from "@/lib/notify";
import { useTranslation } from "react-i18next";
import ComponentCard from "@/components/common/ComponentCard";
import Label from "@/components/form/Label";
import Select from "@/components/form/Select";
import { Input } from "@/components/ui/input";
import {
  binCollectionEventApi,
  dailyTripAssignmentApi,
  dailyTripCollectionPointApi,
} from "@/helpers/admin";
import { useCompanyProjectSelection } from "@/hooks/useCompanyProjectSelection";
import { getEncryptedRoute } from "@/utils/routeCache";
import { normalizeList } from "@/utils/forms";
import { AutoDetectLocationButton } from "@/components/common/AutoDetectLocationButton";
import { binCollectionEventSchema } from "@/schemas/core_modules/dailyOperations/binCollectionEvent.schema";
import { parseWithSchema, type FieldErrors } from "@/schemas/shared/parseFormErrors";
import { FieldError } from "@/components/form/FieldError";
import { FormSelect } from "@/components/common/FormSelect";
import { PageLoader } from "@/components/ui/PageLoader";
import { EvidenceImagePreview } from "@/components/common/EvidenceImagePreview";


const extractError = (error: any): string | null => {
  const data = error?.response?.data;
  if (!data) return null;
  if (typeof data === "string") return data;
  if (typeof data?.detail === "string") return data.detail;
  if (typeof data === "object") {
    const first = Object.values(data)[0];
    if (Array.isArray(first)) return String(first[0]);
    if (typeof first === "string") return first;
  }
  return null;
};

const extractFieldErrors = (error: unknown): FieldErrors => {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};

  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => Array.isArray(value) || typeof value === "string")
      .map(([field, value]) => [
        field,
        Array.isArray(value) ? String(value[0] ?? "") : value,
      ])
      .filter(([, message]) => message),
  );
};

const stopIdOf = (stop: any): string =>
  String(stop?.unique_id ?? stop?.id ?? "");

const entityIdOf = (value: any): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    return String(value.unique_id ?? value.id ?? value.value ?? "");
  }
  return String(value);
};

const collectionPointIdOf = (source: any): string =>
  entityIdOf(
    source?.collection_point_id ??
    source?.collection_point?.unique_id ??
    source?.collection_point?.id ??
    source?.collection_point ??
    "",
  );

const binIdOf = (source: any): string =>
  entityIdOf(source?.bin_id ?? source?.bin?.unique_id ?? source?.bin?.id ?? source?.bin ?? "");

const collectionPointLabelOf = (source: any, fallback = ""): string =>
  String(
    source?.collection_point?.cp_name ??
    source?.collection_point?.collection_point_name ??
    source?.collection_point?.name ??
    source?.collection_point_name ??
    source?.collection_point_id ??
    fallback,
  );

const binLabelOf = (source: any, fallback = ""): string =>
  String(
    source?.bin?.bin_name ??
    source?.bin_name ??
    (typeof source?.bin_id === "object" ? source.bin_id?.bin_name : null) ??
    (typeof source?.bin_id === "object" ? source.bin_id?.name : null) ??
    entityIdOf(source?.bin_id) ??
    fallback,
  );

const binTypeLabelOf = (source: any, fallback = ""): string =>
  String(
    source?.bin?.wastetype_name ??
    source?.bin?.waste_type_name ??
    source?.bin?.waste_type?.waste_type_name ??
    source?.bin?.waste_type?.name ??
    source?.wastetype_name ??
    source?.waste_type_name ??
    source?.waste_type?.waste_type_name ??
    source?.waste_type?.name ??
    source?.bin?.bin_type ??
    source?.bin_type ??
    fallback,
  );

const MAX_COLLECTION_DISTANCE_METERS = 10;

const distanceInMeters = (
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number => {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(fromLatitude)) *
      Math.cos(toRadians(toLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
};

const isStopCollected = (stop: any): boolean =>
  Boolean(stop?.is_collected) ||
  String(stop?.status ?? stop?.collection_status ?? "").toLowerCase() === "collected";

const isCollectedEvent = (event: any): boolean =>
  String(event?.status ?? "Collected").toLowerCase() === "collected";

const collectionPointStopLabel = (stop: any, fallback = "", collectedLabel = "Collected"): string => {
  const collectionPointLabel = collectionPointLabelOf(stop, fallback);
  const binTypeLabel = binTypeLabelOf(stop, binLabelOf(stop));
  const baseLabel = binTypeLabel
    ? `${collectionPointLabel} - ${binTypeLabel}`
    : collectionPointLabel;

  return isStopCollected(stop) ? `${baseLabel} (${collectedLabel})` : baseLabel;
};

export default function BinCollectionEventForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const location = useLocation();
  const routeState = location.state as { companyUniqueId?: string; projectId?: string } | null;
  const isEdit = Boolean(id);
  const statusOptions = useMemo<SelectOption[]>(
    () => [
      { value: "Collected", label: t("admin.bin_collection_event.status_values.collected") },
      { value: "Not Collected", label: t("admin.bin_collection_event.status_values.not_collected") },
      { value: "Collect Later", label: t("admin.bin_collection_event.status_values.collect_later") },
    ],
    [t],
  );

  const {
    companyUniqueId, projectId, projects, companies,
    isSuperAdmin, loggedInCompanyUniqueId,
    setProjectId, onCompanyChange, applyCompanyProjectFromRecord,
  } = useCompanyProjectSelection({
    isEdit,
    initialCompanyId: routeState?.companyUniqueId,
    initialProjectId: routeState?.projectId,
  });

  const { encScheduleOperations, encBinCollectionEvent } = getEncryptedRoute();
  const { listPath: LIST_PATH } = createCrudRoutePaths(encScheduleOperations, encBinCollectionEvent);

  /* ── record loading (edit mode) ── */
  const [record, setRecord] = useState<BinCERecord | null>(null);
  const [loadingRecord, setLoadingRecord] = useState(isEdit);

  /* ── form state ── */
  const [form, setForm] = useState<FormState>({
    trip_assignment_id: "",
    trip_collection_point_id: "",
    bin_id: "",
    collection_date: "",
    collected_weight_kg: "",
    status: "Collected",
    status_reason: "",
    driver_latitude: "",
    driver_longitude: "",
    notes: "",
    status_evidence_image: null,
  });
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(record?.status_evidence_image_url ?? null);
      return;
    }
    const objectUrl = URL.createObjectURL(imageFile);
    setImagePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile, record?.status_evidence_image_url]);

  /* ── raw lookup data ── */
  const [allAssignments, setAllAssignments] = useState<any[]>([]);
  // One row per DailyTripCollectionPoint stop. A collection point can appear
  // more than once when the trip contains multiple bins for the same point,
  // so the dropdown groups these rows by collection point.
  const [rawTripCPs, setRawTripCPs] = useState<any[]>([]);
  const [existingEvents, setExistingEvents] = useState<any[]>([]);
  const [fetchingDropdowns, setFetchingDropdowns] = useState(false);
  const [loadingCPs, setLoadingCPs] = useState(false);

  /* ── pending IDs for edit pre-fill ── */
  const [pendingAssignmentId, setPendingAssignmentId] = useState("");
  const [pendingCollectionPointId, setPendingCollectionPointId] = useState("");

  /* ── load record in edit mode ── */
  useEffect(() => {
    if (!isEdit || !id) return;
    setLoadingRecord(true);
    (binCollectionEventApi.read(id) as Promise<any>)
      .then((data: any) => {
        setRecord(data);
        applyCompanyProjectFromRecord(data);
      })
      .catch(() => Swal.fire(t("common.error"), t("common.fetch_failed"), "error"))
      .finally(() => setLoadingRecord(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── pre-fill form from record (edit mode) ── */
  useEffect(() => {
    if (!isEdit || !record) return;

    const assignmentId = String(record.trip_assignment_id ?? "");
    const cpId = String(
      record.trip_collection_point_id ??
      (record.trip_collection_point as any)?.unique_id ??
      (record.trip_collection_point as any)?.id ??
      "",
    );
    const binId = String(record.bin_id ?? record.bin?.unique_id ?? record.bin?.id ?? "");

    setForm((prev) => ({
      ...prev,
      trip_assignment_id: assignmentId,
      trip_collection_point_id: cpId,
      bin_id: binId,
      collection_date: String(record.collection_date ?? ""),
      collected_weight_kg: record.collected_weight_kg == null ? "" : String(record.collected_weight_kg),
      status: (record.status as FormState["status"]) ?? "Collected",
      status_reason: String(record.status_reason ?? ""),
      driver_latitude: String(record.driver_latitude ?? ""),
      driver_longitude: String(record.driver_longitude ?? ""),
      notes: String(record.notes ?? ""),
      status_evidence_image: null,
    }));

    if (assignmentId) setPendingAssignmentId(assignmentId);
    if (cpId) setPendingCollectionPointId(cpId);
  }, [isEdit, record]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── load Trip Assignments when company + project are ready — only
     bin-collection-type trip plans are in scope for this form (bins are
     never collected on a household round). ── */
  useEffect(() => {
    if (!companyUniqueId || !projectId) return;
    setFetchingDropdowns(true);
    const params = { company_id: companyUniqueId, project_id: projectId };
    (dailyTripAssignmentApi.readAll({ params }) as Promise<any[]>)
      .then((assignRes) => {
        setAllAssignments(normalizeList(assignRes).filter((a: any) => a?.collection_types?.has_bin));
      })
      .catch(() => setAllAssignments([]))
      .finally(() => setFetchingDropdowns(false));
  }, [companyUniqueId, projectId]);

  /* ── load collection-point/bin stops when the assignment changes ── */
  useEffect(() => {
    if (!form.trip_assignment_id) {
      setRawTripCPs([]);
      setExistingEvents([]);
      return;
    }
    setLoadingCPs(true);
    const params = { trip_assignment_id: form.trip_assignment_id };
    Promise.all([
      (dailyTripCollectionPointApi.readAll({ params }) as Promise<any[]>).catch(() => []),
      (binCollectionEventApi.readAll({ params }) as Promise<any[]>).catch(() => []),
    ])
      .then(([tripCPs, events]) => {
        setRawTripCPs(normalizeList(tripCPs));
        setExistingEvents(normalizeList(events));
      })
      .catch(() => {
        setRawTripCPs([]);
        setExistingEvents([]);
      })
      .finally(() => setLoadingCPs(false));
  }, [form.trip_assignment_id]);

  /* ── pending flush: assignment ── */
  useEffect(() => {
    if (!pendingAssignmentId || allAssignments.length === 0) return;
    if (allAssignments.some((a: any) => String(a?.unique_id ?? a?.id ?? "") === pendingAssignmentId)) {
      setForm((prev) => ({ ...prev, trip_assignment_id: pendingAssignmentId }));
      setPendingAssignmentId("");
    }
  }, [pendingAssignmentId, allAssignments]);

  /* ── pending flush: collection point (edit mode — stops load after
     assignment resolves). The stop's own bin_id is already correct in
     form.bin_id from the pre-fill effect's record data; here we just wait
     for rawTripCPs to confirm the stop actually exists before clearing the
     pending marker (so the Select shows it as selected rather than blank). ── */
  useEffect(() => {
    if (!pendingCollectionPointId || rawTripCPs.length === 0) return;
    if (rawTripCPs.some((cp: any) => stopIdOf(cp) === pendingCollectionPointId)) {
      setPendingCollectionPointId("");
    }
  }, [pendingCollectionPointId, rawTripCPs]);

  useEffect(() => {
    if (!isEdit || !record || rawTripCPs.length === 0) return;

    const currentMatches = rawTripCPs.some((cp: any) => stopIdOf(cp) === form.trip_collection_point_id);
    if (currentMatches) return;

    const recordCollectionPointId = collectionPointIdOf(record);
    const recordBinId = binIdOf(record);
    const matchingStop = rawTripCPs.find((stop: any) => {
      const sameCollectionPoint = recordCollectionPointId
        ? collectionPointIdOf(stop) === recordCollectionPointId
        : true;
      const sameBin = recordBinId ? binIdOf(stop) === recordBinId : true;
      return sameCollectionPoint && sameBin;
    });

    if (!matchingStop) return;

    setForm((prev) => ({
      ...prev,
      trip_collection_point_id: stopIdOf(matchingStop),
      bin_id: binIdOf(matchingStop) || prev.bin_id,
    }));
    setPendingCollectionPointId("");
  }, [form.trip_collection_point_id, isEdit, rawTripCPs, record]);

  /* ── assignments filtered by company + project (already applied via the
     fetch params above) + the selected Collection Date ── */
  const filteredAssignmentOptions = useMemo(() => {
    const dateFiltered = form.collection_date
      ? allAssignments.filter((a: any) => String(a?.trip_date ?? "") === form.collection_date)
      : allAssignments;
    return dateFiltered
      .map((a: any) => ({
        value: String(a.unique_id ?? ""),
        label: `${a.unique_id ?? ""}${a.trip_plan?.display_code ? " — " + a.trip_plan.display_code : ""}`,
      }))
      .filter((o: any) => o.value);
  }, [allAssignments, form.collection_date]);

  /* ── District / City auto-derived (read-only) from the selected Trip
     Assignment's location — never user-selected. ── */
  const selectedAssignment = useMemo(
    () => allAssignments.find((a: any) => String(a?.unique_id ?? a?.id ?? "") === form.trip_assignment_id),
    [allAssignments, form.trip_assignment_id]
  );
  const derivedDistrictName = selectedAssignment?.panchayat?.district_name ?? selectedAssignment?.zone?.district_name ?? "";
  const derivedCityName = selectedAssignment?.panchayat?.city_name ?? selectedAssignment?.zone?.city_name ?? "";

  const eventCollectedByStopId = useMemo(() => {
    const ids = new Set<string>();
    existingEvents.forEach((event: any) => {
      if (!isCollectedEvent(event)) return;
      if (isEdit && id && String(event?.unique_id ?? event?.id ?? "") === id) return;
      const stopId = String(
        event?.trip_collection_point_id ??
        event?.trip_collection_point?.unique_id ??
        event?.trip_collection_point?.id ??
        "",
      );
      if (stopId) ids.add(stopId);
    });
    return ids;
  }, [existingEvents, id, isEdit]);

  const eventCollectedByBinId = useMemo(() => {
    const ids = new Set<string>();
    existingEvents.forEach((event: any) => {
      if (!isCollectedEvent(event)) return;
      if (isEdit && id && String(event?.unique_id ?? event?.id ?? "") === id) return;
      const binId = binIdOf(event);
      if (binId) ids.add(binId);
    });
    return ids;
  }, [existingEvents, id, isEdit]);

  const isStopAlreadyCollected = (stop: any): boolean => {
    const stopId = stopIdOf(stop);
    const binId = binIdOf(stop);
    return (
      Boolean(stopId && eventCollectedByStopId.has(stopId)) ||
      Boolean(binId && eventCollectedByBinId.has(binId))
    );
  };

  /* ── Collection Point options: one option per collection-point/bin stop.
     The option text includes the collection point plus bin type/name, so the
     separate Bin dropdown reflects the same selected stop clearly. ── */
  const currentStopId = String(form.trip_collection_point_id ?? "");
  const collectionPointOptions = useMemo(() =>
    rawTripCPs
      .map((stop: any) => {
        const value = stopIdOf(stop);
        const isCurrent = value === currentStopId;
        const isCollected = isStopAlreadyCollected(stop);
        return {
          value,
          label: collectionPointStopLabel({
            ...stop,
            is_collected: isCollected,
            status: isCollected ? "Collected" : "Pending",
            collection_status: isCollected ? "Collected" : "Pending",
          }, value, t("admin.bin_collection_event.status_values.collected")),
          disabled: isCollected && !isCurrent,
        };
      })
      .filter((option) => option.value),
    [rawTripCPs, currentStopId, eventCollectedByStopId, eventCollectedByBinId, t]
  );

  const collectionPointOptionsWithCurrent = useMemo(() => {
    if (!isEdit || !record || !currentStopId) return collectionPointOptions;
    if (collectionPointOptions.some((option) => option.value === currentStopId)) {
      return collectionPointOptions;
    }

    return [
      {
        value: currentStopId,
        label: collectionPointStopLabel(record, currentStopId, t("admin.bin_collection_event.status_values.collected")),
      },
      ...collectionPointOptions,
    ];
  }, [collectionPointOptions, currentStopId, isEdit, record, t]);

  /* ── Selected stop → its bin, shown read-only. For grouped collection
     points, choosing the point selects the next uncollected bin stop. ── */
  const selectedStop = useMemo(
    () => rawTripCPs.find((cp: any) => stopIdOf(cp) === currentStopId),
    [rawTripCPs, currentStopId]
  );

  useEffect(() => {
    if (!selectedStop) return;
    const selectedBinId = binIdOf(selectedStop);
    if (!selectedBinId || form.bin_id === selectedBinId) return;
    setForm((prev) => ({ ...prev, bin_id: selectedBinId }));
  }, [form.bin_id, selectedStop]);

  const selectedBinLabel = selectedStop
    ? binLabelOf(selectedStop)
    : isEdit && record && currentStopId
      ? binLabelOf(record, form.bin_id)
      : "";
  const binOptions = useMemo(() => {
    if (!form.bin_id) return [];

    return [
      {
        value: form.bin_id,
        label: selectedBinLabel || form.bin_id,
      },
    ];
  }, [form.bin_id, selectedBinLabel]);

  const handleCollectionPointChange = (stopId: string) => {
    const stop = rawTripCPs.find((cp: any) => stopIdOf(cp) === stopId);
    setForm((prev) => ({
      ...prev,
      trip_collection_point_id: stopId,
      bin_id: binIdOf(stop),
    }));
    setFieldErrors((prev) => ({ ...prev, bin_id: "" }));
  };

  const set = (field: keyof FormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) =>
      prev[field] ? { ...prev, [field]: "" } : prev,
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const validation = parseWithSchema(binCollectionEventSchema, {
      trip_assignment_id: form.trip_assignment_id,
      bin_id: form.bin_id,
      status: form.status,
      collected_weight_kg: form.collected_weight_kg,
      driver_latitude: form.driver_latitude,
      driver_longitude: form.driver_longitude,
    });
    if (!validation.success) {
      setFieldErrors(validation.errors);
      Swal.fire(
        t("common.warning"),
          validation.errors.trip_assignment_id ??
          validation.errors.bin_id ??
          validation.errors.collected_weight_kg ??
          validation.errors.driver_latitude ??
          validation.errors.driver_longitude ??
          "Trip Assignment, Bin, and GPS coordinates are required.",
        "warning",
      );
      return;
    }

    const collectionPoint = selectedStop?.collection_point;
    const collectionPointLatitude = Number(collectionPoint?.latitude);
    const collectionPointLongitude = Number(collectionPoint?.longitude);
    const capturedLatitude = Number(form.driver_latitude);
    const capturedLongitude = Number(form.driver_longitude);
    if (
      Number.isFinite(collectionPointLatitude) &&
      Number.isFinite(collectionPointLongitude) &&
      distanceInMeters(
        collectionPointLatitude,
        collectionPointLongitude,
        capturedLatitude,
        capturedLongitude,
      ) > MAX_COLLECTION_DISTANCE_METERS
    ) {
      const message = `Captured location must be within ${MAX_COLLECTION_DISTANCE_METERS} m of the collection point.`;
      setFieldErrors({ driver_latitude: message });
      Swal.fire(t("common.warning"), message, "warning");
      return;
    }
    setFieldErrors({});

    if (form.status !== "Collected" && !imageFile && !record?.status_evidence_image_url) {
      Swal.fire(t("common.warning"), t("admin.bin_collection_event.image_hint"), "warning");
      return;
    }

    if (!companyUniqueId || !projectId) {
      Swal.fire(t("common.warning"), t("common.missing_fields"), "warning");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        company_id_input: companyUniqueId,
        project_id_input: projectId,
        trip_assignment_id: form.trip_assignment_id,
        bin_id: form.bin_id,
        status: form.status,
      };
      if (form.trip_collection_point_id) payload.trip_collection_point_id = form.trip_collection_point_id;
      if (form.collection_date) payload.collection_date = form.collection_date;
      payload.collected_weight_kg =
        form.status === "Collected" ? Number(form.collected_weight_kg) : null;
      if (form.status_reason) payload.status_reason = form.status_reason;
      if (form.driver_latitude) payload.driver_latitude = form.driver_latitude;
      if (form.driver_longitude) payload.driver_longitude = form.driver_longitude;
      if (form.notes) payload.notes = form.notes;

      if (imageFile) {
        const multipartPayload = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
          if (value !== null && value !== undefined) multipartPayload.append(key, String(value));
        });
        multipartPayload.append("status_evidence_image", imageFile);
        if (isEdit && id) {
          await binCollectionEventApi.uploadUpdate(id, multipartPayload);
        } else {
          await binCollectionEventApi.upload(multipartPayload);
        }
      } else if (isEdit && id) {
        await binCollectionEventApi.update(id, payload);
      } else {
        await binCollectionEventApi.create(payload);
      }

      if (isEdit && id) {
        Swal.fire({ icon: "success", title: t("common.success"), text: t("common.updated_success"), timer: 1500, showConfirmButton: false });
      } else {
        Swal.fire({ icon: "success", title: t("common.success"), text: t("common.added_success"), timer: 1500, showConfirmButton: false });
      }
      navigate(LIST_PATH, { state: { companyUniqueId, projectId } });
    } catch (err: any) {
      const apiFieldErrors = extractFieldErrors(err);
      if (Object.keys(apiFieldErrors).length) setFieldErrors(apiFieldErrors);
      Swal.fire(t("common.error"), extractError(err) ?? t("common.save_failed_desc"), "error");
    } finally {
      setSaving(false);
    }
  };

  if (loadingRecord) {
    return <PageLoader />;
  }

  const title = isEdit
    ? `${t("admin.bin_collection_event.title_edit")}${record?.unique_id ? ` — ${record.unique_id}` : ""}`
    : t("admin.bin_collection_event.title_add");

  return (
    <div className="p-4 space-y-4">
      <ComponentCard title={title} desc={isEdit ? t("admin.bin_collection_event.subtitle_edit") : t("admin.bin_collection_event.subtitle_add")}>
        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Company / Project */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("admin.nav.company")} *</Label>
              <FormSelect
                value={companyUniqueId || ""}
                onChange={(v) => onCompanyChange(v)}
                options={companies}
                disabled={Boolean(loggedInCompanyUniqueId) || (!isSuperAdmin && !loggedInCompanyUniqueId) || companies.length === 0}
                placeholder={t("common.select_item_placeholder", { item: t("admin.nav.company") })}
              />
            </div>
            <div>
              <Label>{t("admin.nav.project")} *</Label>
              <FormSelect
                value={projectId || ""}
                onChange={(v) => setProjectId(v)}
                options={projects}
                disabled={!companyUniqueId || projects.length === 0}
                placeholder={companyUniqueId ? t("common.select_item_placeholder", { item: t("admin.nav.project") }) : t("admin.bin_collection_event.select_company_first")}
              />
            </div>
          </div>

          {/* Row 1: Collection Date + Trip Assignment — the date narrows which
              (bin-collection-type) trip assignments are selectable. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("admin.bin_collection_event.collection_date")}</Label>
              <Input
                type="date"
                value={form.collection_date}
                onChange={(e) => {
                  set("collection_date")(e.target.value);
                  setForm((prev) => ({ ...prev, trip_assignment_id: "", trip_collection_point_id: "", bin_id: "" }));
                }}
              />
            </div>
            <div>
              <Label>{t("admin.bin_collection_event.trip_assignment")} <span className="text-red-500">*</span></Label>
              <Select
                options={filteredAssignmentOptions}
                value={form.trip_assignment_id}
                onChange={(v) => {
                  setForm((prev) => ({ ...prev, trip_assignment_id: v, trip_collection_point_id: "", bin_id: "" }));
                  setFieldErrors((prev) => ({ ...prev, trip_assignment_id: "" }));
                }}
                placeholder={fetchingDropdowns ? t("admin.bin_collection_event.loading_assignments") : t("admin.bin_collection_event.select_trip_assignment")}
                disabled={fetchingDropdowns || !projectId}
              />
              <FieldError message={fieldErrors.trip_assignment_id} />
            </div>
          </div>

          {/* Row 2: District + City — read-only, auto-filled from the
              selected Trip Assignment's location. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("common.district")}</Label>
              <Input disabled className="bg-gray-100" value={derivedDistrictName} placeholder={t("admin.bin_collection_event.select_trip_assignment")} />
            </div>
            <div>
              <Label>{t("common.city")}</Label>
              <Input disabled className="bg-gray-100" value={derivedCityName} placeholder={t("admin.bin_collection_event.select_trip_assignment")} />
            </div>
          </div>

          {/* Row 3: Collection Point grouped across its bin stops + selected
              Bin, shown read-only. A fully collected point is labeled
              "(Collected)" and locked from further entry (except the one
              currently saved on this record). */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("admin.bin_collection_event.collection_point")}</Label>
              <Select
                options={collectionPointOptionsWithCurrent}
                value={form.trip_collection_point_id}
                onChange={handleCollectionPointChange}
                placeholder={
                  loadingCPs ? t("admin.bin_collection_event.loading") :
                  form.trip_assignment_id ? t("admin.bin_collection_event.select_collection_point") : t("admin.bin_collection_event.select_assignment_first")
                }
                disabled={!form.trip_assignment_id || loadingCPs}
              />
            </div>
            <div>
              <Label>{t("admin.bin_collection_event.bin")} <span className="text-red-500">*</span></Label>
              <Select
                options={binOptions}
                value={form.bin_id}
                onChange={set("bin_id")}
                placeholder={t("admin.bin_collection_event.select_collection_point")}
                disabled
              />
              <FieldError message={fieldErrors.bin_id} />
            </div>
          </div>

          {/* Zone / Ward — auto-derived server-side from the trip assignment's
              wards M2M (single-ward case), read-only display only (A5). */}
          {isEdit && (record?.ward_name || record?.zone_name) && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("common.ward")}</Label>
                <Input disabled className="bg-gray-100" value={record?.ward_name ?? ""} />
              </div>
              <div>
                <Label>{t("common.zone")}</Label>
                <Input
                  disabled
                  className="bg-gray-100"
                  value={
                    typeof record?.zone_name === "object" && record?.zone_name !== null
                      ? String((record.zone_name as Record<string, unknown>).zone_name ?? "")
                      : String(record?.zone_name ?? "")
                  }
                />
              </div>
            </div>
          )}

          {/* Row: Status + Collected Weight */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("common.status")} <span className="text-red-500">*</span></Label>
              <Select
                options={statusOptions}
                value={form.status}
                onChange={(v) =>
                  setForm((prev) => ({
                    ...prev,
                    status: v as FormState["status"],
                    collected_weight_kg: v === "Collected" ? prev.collected_weight_kg : "",
                  }))
                }
                placeholder={t("common.select_status")}
              />
            </div>
            <div>
              <Label>
                {t("admin.bin_collection_event.weight_kg")}
                {form.status === "Collected" && <span className="text-red-500"> *</span>}
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.collected_weight_kg}
                onChange={(e) => {
                  set("collected_weight_kg")(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, collected_weight_kg: "" }));
                }}
                placeholder={t("admin.bin_collection_event.weight_example")}
                disabled={form.status !== "Collected"}
                required={form.status === "Collected"}
              />
              <FieldError message={fieldErrors.collected_weight_kg} />
            </div>
          </div>


          <div>
            <Label>
              {t("admin.bin_collection_event.image")}
              {form.status !== "Collected" && <span className="text-red-500"> *</span>}
            </Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
              required={form.status !== "Collected" && !record?.status_evidence_image_url}
            />
            <p className="mt-1 text-xs text-gray-500">{t("admin.bin_collection_event.image_hint")}</p>
            <div className="mt-2">
              <EvidenceImagePreview
                url={imagePreviewUrl}
                label={t("admin.bin_collection_event.image")}
              />
            </div>
          </div>

          {/* Status Reason — required context for Not Collected / Collect Later */}
          {form.status !== "Collected" && (
            <div>
              <Label>{t("admin.bin_collection_event.status_reason")}</Label>
              <Input
                value={form.status_reason}
                onChange={(e) => set("status_reason")(e.target.value)}
                placeholder={t("admin.bin_collection_event.status_reason_placeholder")}
              />
            </div>
          )}

          {/* GPS */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("admin.bin_collection_event.gps_latitude")} <span className="text-red-500">*</span></Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  value={form.driver_latitude}
                  onChange={(e) => set("driver_latitude")(e.target.value)}
                  placeholder="e.g. 11.1271"
                />
                <AutoDetectLocationButton
                  onDetected={({ latitude, longitude }) => {
                    set("driver_latitude")(String(latitude));
                    set("driver_longitude")(String(longitude));
                  }}
                  label={t("admin.bin_collection_event.detect")}
                  className="shrink-0 whitespace-nowrap"
                  title={t("admin.bin_collection_event.detect_title")}
                />
              </div>
              <FieldError message={fieldErrors.driver_latitude} />
            </div>
            <div>
              <Label>{t("admin.bin_collection_event.gps_longitude")} <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                step="any"
                min={-180}
                max={180}
                value={form.driver_longitude}
                onChange={(e) => set("driver_longitude")(e.target.value)}
                placeholder="e.g. 78.6569"
              />
              <FieldError message={fieldErrors.driver_longitude} />
            </div>
          </div>

          <div>
            <Label>{t("admin.bin_collection_event.notes")}</Label>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes")(e.target.value)}
              rows={3}
              placeholder={t("admin.bin_collection_event.notes_placeholder")}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate(LIST_PATH, { state: { companyUniqueId, projectId } })}
              className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-green-custom px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? t("common.saving") : isEdit ? t("common.update") : t("common.save")}
            </button>
          </div>
        </form>
      </ComponentCard>
    </div>
  );
}
