"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, ChevronLeft, HeartPulse, Plus, Trash2, Wand2, X } from "lucide-react";
import { Avatar } from "./ui/primitives";
import { SessionCustomCSS } from "@/components/ui/session-custom-css";
import CSSSchemeBar from "@/components/ui/css-scheme-picker";
import { CALENDAR_CSS_EXAMPLE } from "@/lib/css-examples";
import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";
import { Input } from "./ui/form";
import type { CalendarOwnerType, CalendarScheduleItem, CalendarWeekPlan } from "@/lib/calendar-types";
import {
  CALENDAR_DAYS_PER_PAGE_OPTIONS,
  CALENDAR_THEME_IDS,
  deleteCalendarScheduleItem,
  deleteCalendarRecurrenceSeries,
  excludeCalendarRecurrenceDate,
  loadCalendarConfig,
  loadOwnerCalendarPlans,
  saveCalendarConfig,
  upsertCalendarScheduleItem,
  validateScheduleDraft,
} from "@/lib/calendar-storage";
import { createDefaultScheduleDraft, generateWeeklyCalendarSchedule } from "@/lib/calendar-engine";
import { loadInteractableCharacters as loadCharacters } from "@/lib/character-storage";
import { loadChatSessions } from "@/lib/chat-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { getChatCharacterAvatar } from "@/lib/chat-session-avatar";
import { useActivityAvatarUpdates } from "./use-activity-avatar-updates";
import {
  formatIsoDate,
  getWeekStartIso,
  parseIsoDate,
  pickScheduleColorKey,
  sanitizeScheduleEmoji,
} from "@/lib/calendar-utils";
import {
  buildMenstrualDayMap,
  cancelFinishCurrentPeriod,
  cancelCurrentPeriodStart,
  finishCurrentPeriod,
  deleteMenstrualRecord,
  getMenstrualSummary,
  loadMenstrualConfig,
  loadMenstrualRecords,
  saveMenstrualConfig,
  startCurrentPeriod,
  validateMenstrualSettings,
  type MenstrualRecord,
} from "@/lib/menstrual-storage";
import { CalendarMonthPage } from "./calendar/month-page";
import { CalendarDetailPage } from "./calendar/detail-page";
import { CalendarEventEditModal, type CalendarEventDraft } from "./calendar/event-edit-modal";

type OwnerOption = {
  key: string;
  ownerType: CalendarOwnerType;
  ownerId: string;
  name: string;
  avatar?: string | null;
};

const CALENDAR_THEMES: Array<{ id: (typeof CALENDAR_THEME_IDS)[number]; name: string }> = [
  { id: "light", name: "默认" },
  { id: "dark", name: "深色" },
  { id: "cream", name: "奶油" },
  { id: "mint", name: "薄荷" },
  { id: "mist", name: "雾紫" },
  { id: "sakura", name: "樱粉" },
];

function buildOwnerOptions(): OwnerOption[] {
  const options: OwnerOption[] = [];
  const identity = resolveUserIdentity(undefined, "calendar") ?? resolveUserIdentity() ?? null;
  options.push({
    key: "user:me",
    ownerType: "user",
    ownerId: "self",
    name: identity?.name?.trim() || "我",
    avatar: identity?.avatarUrl || null,
  });
  for (const char of loadCharacters()) {
    options.push({
      key: `character:${char.id}`,
      ownerType: "character",
      ownerId: char.id,
      name: char.name,
      avatar: getChatCharacterAvatar(null, char),
    });
  }
  return options;
}

type PeriodCareCharacterOption = {
  characterId: string;
  name: string;
  avatar?: string | null;
};

function buildPeriodCareCharacterOptions(): PeriodCareCharacterOption[] {
  const characters = loadCharacters();
  const characterById = new Map(characters.map(char => [char.id, char]));
  const latestSessionByCharacter = new Map<string, ReturnType<typeof loadChatSessions>[number]>();
  for (const session of loadChatSessions()) {
    if (session.isGroup) continue;
    const character = characterById.get(session.contactId);
    if (!character) continue;
    const existing = latestSessionByCharacter.get(session.contactId);
    if (!existing || session.updatedAt > existing.updatedAt) {
      latestSessionByCharacter.set(session.contactId, session);
    }
  }
  return Array.from(latestSessionByCharacter.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(session => {
      const character = characterById.get(session.contactId)!;
      return {
        characterId: character.id,
        name: session.alias || character.name,
        avatar: getChatCharacterAvatar(session, character),
      };
    });
}

function formatSimpleDate(dateText: string | null): string {
  if (!dateText) return "待记录";
  const date = parseIsoDate(dateText);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function PhoneCalendarApp({
  onClose,
  onNotice,
}: {
  onClose: () => void;
  onNotice?: (text: string) => void;
}) {
  const todayIso = formatIsoDate(new Date());
  const avatarRevision = useActivityAvatarUpdates();
  const [owners, setOwners] = useState<OwnerOption[]>(() => buildOwnerOptions());
  const [selectedKey, setSelectedKey] = useState<string>(() => owners[0]?.key ?? "user:me");
  const [view, setView] = useState<"month" | "detail">("month");
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [detailKey, setDetailKey] = useState(0);
  const [ownerPlans, setOwnerPlans] = useState<CalendarWeekPlan[]>([]);
  const [config, setConfig] = useState(() => loadCalendarConfig());
  const [menstrualConfig, setMenstrualConfig] = useState(() => loadMenstrualConfig());
  const [menstrualRecords, setMenstrualRecords] = useState<MenstrualRecord[]>(() => loadMenstrualRecords());
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [showDaysPanel, setShowDaysPanel] = useState(false);
  const [showMenstrualSettings, setShowMenstrualSettings] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [showAutoConfirm, setShowAutoConfirm] = useState(false);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const autoAttemptedRef = useRef<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<(CalendarEventDraft & { originalDate?: string }) | null>(null);
  const autoGenerateEnabled = config.autoGenerateEnabled;

  const [menstrualDraft, setMenstrualDraft] = useState<{
    cycleLength: string;
    periodLength: string;
    periodCareEnabled: boolean;
    periodCareCharacterIds: string[];
    periodCareLeadDays: "1" | "2" | "3";
  }>(() => {
    const initial = loadMenstrualConfig();
    return {
      cycleLength: String(initial.cycleLength),
      periodLength: String(initial.periodLength),
      periodCareEnabled: initial.periodCareEnabled,
      periodCareCharacterIds: initial.periodCareCharacterIds,
      periodCareLeadDays: String(initial.periodCareLeadDays) as "1" | "2" | "3",
    };
  });

  const [calendarCustomCss, setCalendarCustomCss] = useState(() =>
    typeof window !== "undefined" ? kvGet("calendar-custom-css") || "" : ""
  );
  const [appliedCalendarCss, setAppliedCalendarCss] = useState(() =>
    typeof window !== "undefined" ? kvGet("calendar-custom-css") || "" : ""
  );
  const handleApplyCalendarCss = () => {
    const trimmed = calendarCustomCss.trim();
    if (trimmed) kvSet("calendar-custom-css", trimmed);
    else kvRemove("calendar-custom-css");
    setAppliedCalendarCss(trimmed);
    window.dispatchEvent(new CustomEvent("calendar-css-updated", { detail: trimmed }));
  };
  // 小卷等外部来源实时更新日历自定义 CSS
  useEffect(() => {
    const onCSSUpdate = (e: Event) => {
      const css = (e as CustomEvent).detail || "";
      setAppliedCalendarCss(css);
      setCalendarCustomCss(css);
    };
    window.addEventListener("calendar-css-updated", onCSSUpdate);
    return () => window.removeEventListener("calendar-css-updated", onCSSUpdate);
  }, []);

  const selectedOwner = useMemo(
    () => owners.find(owner => owner.key === selectedKey) ?? owners[0] ?? null,
    [owners, selectedKey],
  );
  const weekStart = useMemo(() => getWeekStartIso(parseIsoDate(selectedDate)), [selectedDate]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarScheduleItem[]>();
    for (const plan of ownerPlans) {
      for (const item of plan.items) {
        const list = map.get(item.date) || [];
        list.push(item);
        map.set(item.date, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return map;
  }, [ownerPlans]);

  // 经期标注：覆盖月历页 ±1 年范围
  const cycleMap = useMemo(() => {
    if (selectedOwner?.ownerType !== "user") return null;
    const today = parseIsoDate(todayIso);
    const start = formatIsoDate(new Date(today.getFullYear() - 1, today.getMonth(), 1));
    const end = formatIsoDate(new Date(today.getFullYear() + 1, today.getMonth() + 1, 0));
    return buildMenstrualDayMap(start, end, menstrualRecords, menstrualConfig);
  }, [selectedOwner, todayIso, menstrualRecords, menstrualConfig]);

  const menstrualSummary = useMemo(
    () => getMenstrualSummary(menstrualRecords, menstrualConfig, selectedDate),
    [menstrualRecords, menstrualConfig, selectedDate],
  );
  const periodCareCharacterOptions = useMemo(
    () => (showMenstrualSettings ? buildPeriodCareCharacterOptions() : []),
    [showMenstrualSettings, avatarRevision],
  );

  useEffect(() => {
    setOwners(buildOwnerOptions());
  }, [avatarRevision]);

  const refreshPlans = () => {
    if (!selectedOwner) return;
    setOwnerPlans(loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId));
  };

  useEffect(() => {
    if (!selectedOwner) return;
    setOwnerPlans(loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId));
  }, [selectedOwner]);

  // 聊天/工具调用改动日程后刷新
  useEffect(() => {
    const handler = () => {
      if (!selectedOwner) return;
      setOwnerPlans(loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId));
    };
    window.addEventListener("calendar-updated", handler);
    return () => window.removeEventListener("calendar-updated", handler);
  }, [selectedOwner]);

  // 每周自动生成（仅角色）
  useEffect(() => {
    if (!selectedOwner || !autoGenerateEnabled || selectedOwner.ownerType !== "character" || isGenerating) return;
    const autoKey = `${selectedOwner.ownerType}:${selectedOwner.ownerId}:${weekStart}`;
    if (autoAttemptedRef.current.has(autoKey)) return;
    const existing = loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId)
      .find(plan => plan.weekStart === weekStart);
    if (existing && existing.items.length > 0) return;
    void (async () => {
      autoAttemptedRef.current.add(autoKey);
      setIsGenerating(true);
      const result = await generateWeeklyCalendarSchedule(selectedOwner.ownerType, selectedOwner.ownerId, weekStart);
      setIsGenerating(false);
      if (!result.success) {
        onNotice?.(result.error || "自动生成失败");
        return;
      }
      refreshPlans();
      onNotice?.("已自动生成本周角色日程");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerateEnabled, isGenerating, selectedOwner, weekStart]);

  // ── 事件编辑 ──
  const openNewDraft = (date: string) => {
    const base = createDefaultScheduleDraft(date);
    setEditingItem({
      date: base.date,
      startTime: base.startTime,
      endTime: base.endTime,
      location: base.location,
      title: base.title,
      emoji: base.emoji,
    });
  };

  const openEditItem = (item: CalendarScheduleItem) => {
    setEditingItem({
      id: item.id,
      date: item.date,
      endDate: item.date,
      originalDate: item.date,
      ...(item.recurrence ? {
        date: item.recurrence.startDate,
        endDate: item.recurrence.startDate,
        repeatWeekly: true,
        repeatWeekdays: [...item.recurrence.weekdays],
        repeatUntil: item.recurrence.until,
        recurrenceExcludedDates: item.recurrence.excludedDates || [],
        seriesId: item.recurrence.seriesId,
      } : {}),
      startTime: item.startTime,
      endTime: item.endTime,
      location: item.location,
      title: item.title,
      emoji: item.emoji || "",
      colorKey: item.colorKey,
    });
  };

  const handleSaveDraft = () => {
    if (!selectedOwner || !editingItem) return;
    const error = validateScheduleDraft(editingItem);
    if (error) {
      onNotice?.(error);
      return;
    }
    if (editingItem.repeatWeekly) {
      const start = parseIsoDate(editingItem.date);
      const until = editingItem.repeatUntil || editingItem.date;
      const end = parseIsoDate(until);
      const weekdays = [...new Set(editingItem.repeatWeekdays || [])].filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
      const days = Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000) + 1;
      if (!Number.isFinite(days) || days < 1 || days > 366) {
        onNotice?.("重复截止日期须在开始日期起一年内（最多 366 天）");
        return;
      }
      if (!weekdays.length) {
        onNotice?.("请至少选择一个重复星期");
        return;
      }
      const dates: string[] = [];
      for (let offset = 0; offset < days; offset++) {
        const day = parseIsoDate(editingItem.date);
        day.setDate(day.getDate() + offset);
        const date = formatIsoDate(day);
        if (weekdays.includes(day.getDay()) && !excludedDates.has(date)) dates.push(date);
      }
      if (!dates.length) {
        onNotice?.("这个日期范围内没有选中的星期，请延长截止日期或调整星期");
        return;
      }
      if (editingItem.seriesId && !window.confirm("将替换整组重复日程（包括过去日期），是否继续？")) return;
      if (editingItem.seriesId) {
        deleteCalendarRecurrenceSeries(selectedOwner.ownerType, selectedOwner.ownerId, editingItem.seriesId);
      } else if (editingItem.id) {
        deleteCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId,
          getWeekStartIso(parseIsoDate(editingItem.originalDate || editingItem.date)), editingItem.id);
      }
      const seriesId = editingItem.seriesId || `calendar_series_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const excludedDates = new Set(editingItem.recurrenceExcludedDates || []);
      for (const date of dates) {
        upsertCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId, getWeekStartIso(parseIsoDate(date)), {
          date, startTime: editingItem.startTime, endTime: editingItem.endTime,
          location: editingItem.location, title: editingItem.title,
          emoji: sanitizeScheduleEmoji(editingItem.emoji), source: "manual",
          colorKey: editingItem.colorKey ?? pickScheduleColorKey(editingItem.startTime),
          recurrence: { seriesId, startDate: editingItem.date, until, weekdays, excludedDates: [...excludedDates] },
        });
      }
      setEditingItem(null);
      refreshPlans();
      window.dispatchEvent(new CustomEvent("calendar-updated"));
      onNotice?.(`已保存 ${dates.length} 次重复日程`);
      return;
    }
    const startDate = editingItem.date;
    const endDate = editingItem.endDate || editingItem.date;
    if (endDate < startDate) {
      onNotice?.("结束日期不能早于开始日期");
      return;
    }
    const dayCount = Math.round((parseIsoDate(endDate).getTime() - parseIsoDate(startDate).getTime()) / 86400000) + 1;
    if (dayCount > 31) {
      onNotice?.("一次最多创建 31 天的日程");
      return;
    }
    if (editingItem.seriesId) {
      if (!window.confirm("取消重复并替换整组日程（包括过去日期），是否继续？")) return;
      deleteCalendarRecurrenceSeries(selectedOwner.ownerType, selectedOwner.ownerId, editingItem.seriesId);
    }
    const firstWeekStart = getWeekStartIso(parseIsoDate(startDate));
    // 跨周移动：先从原来的周删除
    if (editingItem.id && editingItem.originalDate) {
      const originalWeekStart = getWeekStartIso(parseIsoDate(editingItem.originalDate));
      if (originalWeekStart !== firstWeekStart) {
        deleteCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId, originalWeekStart, editingItem.id);
      }
    }
    // 多天：第一天沿用原 id（编辑场景），其余每天各生成一条独立日程
    for (let offset = 0; offset < dayCount; offset++) {
      const day = parseIsoDate(startDate);
      day.setDate(day.getDate() + offset);
      const dayIso = formatIsoDate(day);
      upsertCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId, getWeekStartIso(parseIsoDate(dayIso)), {
        id: offset === 0 ? editingItem.id : undefined,
        date: dayIso,
        startTime: editingItem.startTime,
        endTime: editingItem.endTime,
        location: editingItem.location,
        title: editingItem.title,
        emoji: sanitizeScheduleEmoji(editingItem.emoji),
        source: "manual",
        colorKey: editingItem.colorKey ?? pickScheduleColorKey(editingItem.startTime),
      });
    }
    setEditingItem(null);
    refreshPlans();
    onNotice?.(dayCount > 1 ? `已创建 ${dayCount} 天的日程` : "日程已保存");
  };

  const handleDeleteItem = () => {
    if (!selectedOwner || !editingItem?.id) return;
    if (editingItem.seriesId) {
      const choice = window.prompt("删除重复日程：输入 1 仅删除这一次，输入 2 删除整组。取消请输入其他内容。", "1");
      if (choice === "1") {
        excludeCalendarRecurrenceDate(selectedOwner.ownerType, selectedOwner.ownerId, editingItem.seriesId, editingItem.originalDate || editingItem.date);
        setEditingItem(null);
        refreshPlans();
        window.dispatchEvent(new CustomEvent("calendar-updated"));
        onNotice?.("本次日程已删除，之后编辑整组时也不会恢复");
        return;
      }
      if (choice !== "2" || !window.confirm("删除整组重复日程（包括过去日期）？此操作不可撤销。")) return;
      deleteCalendarRecurrenceSeries(selectedOwner.ownerType, selectedOwner.ownerId, editingItem.seriesId);
      setEditingItem(null);
      refreshPlans();
      window.dispatchEvent(new CustomEvent("calendar-updated"));
      onNotice?.("整组重复日程已删除");
      return;
    }
    const targetWeekStart = getWeekStartIso(parseIsoDate(editingItem.originalDate || editingItem.date));
    deleteCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId, targetWeekStart, editingItem.id);
    setEditingItem(null);
    refreshPlans();
    onNotice?.("日程已删除");
  };

  const handleGenerate = async () => {
    if (!selectedOwner || isGenerating || selectedOwner.ownerType !== "character") return;
    setShowGenerateConfirm(false);
    setIsGenerating(true);
    const result = await generateWeeklyCalendarSchedule(selectedOwner.ownerType, selectedOwner.ownerId, weekStart);
    setIsGenerating(false);
    if (!result.success) {
      onNotice?.(result.error || "生成失败");
      return;
    }
    refreshPlans();
    onNotice?.("本周日程已生成");
  };

  // ── 经期 ──
  const refreshMenstrual = () => {
    setMenstrualConfig(loadMenstrualConfig());
    setMenstrualRecords(loadMenstrualRecords());
  };

  const openMenstrualSettings = () => {
    setMenstrualDraft({
      cycleLength: String(menstrualConfig.cycleLength),
      periodLength: String(menstrualConfig.periodLength),
      periodCareEnabled: menstrualConfig.periodCareEnabled,
      periodCareCharacterIds: menstrualConfig.periodCareCharacterIds,
      periodCareLeadDays: String(menstrualConfig.periodCareLeadDays) as "1" | "2" | "3",
    });
    setShowMenstrualSettings(true);
  };

  const togglePeriodCareCharacter = (characterId: string) => {
    setMenstrualDraft(prev => {
      const selected = new Set(prev.periodCareCharacterIds);
      if (selected.has(characterId)) selected.delete(characterId);
      else selected.add(characterId);
      return { ...prev, periodCareCharacterIds: Array.from(selected) };
    });
  };

  const handleSaveMenstrualSettings = () => {
    const cycleLength = Number(menstrualDraft.cycleLength);
    const periodLength = Number(menstrualDraft.periodLength);
    const error = validateMenstrualSettings({ cycleLength, periodLength });
    if (error) {
      onNotice?.(error);
      return;
    }
    const availableCharacterIds = new Set(periodCareCharacterOptions.map(option => option.characterId));
    const periodCareCharacterIds = menstrualDraft.periodCareCharacterIds.filter(id => availableCharacterIds.has(id));
    if (menstrualDraft.periodCareEnabled && periodCareCharacterIds.length === 0) {
      onNotice?.("请选择至少一个已有聊天角色");
      return;
    }
    const savedConfig = saveMenstrualConfig({
      ...menstrualConfig,
      cycleLength,
      periodLength,
      periodCareEnabled: menstrualDraft.periodCareEnabled,
      periodCareCharacterIds,
      periodCareLeadDays: Number(menstrualDraft.periodCareLeadDays) as 1 | 2 | 3,
    });
    setMenstrualConfig(savedConfig);
    window.dispatchEvent(new CustomEvent("menstrual-period-care-updated"));
    setShowMenstrualSettings(false);
    onNotice?.("周期设置已保存");
  };

  const canCancelSelectedStart = menstrualSummary.currentPeriodStartDate === selectedDate && !menstrualSummary.todayFinished;
  const canStartSelected = !menstrualSummary.todayStarted && !menstrualSummary.isPeriodActive;
  const canCancelSelectedFinish = menstrualSummary.todayFinished;
  const canFinishSelected =
    menstrualSummary.isPeriodActive &&
    !!menstrualSummary.currentPeriodStartDate &&
    selectedDate >= menstrualSummary.currentPeriodStartDate &&
    !menstrualSummary.todayFinished;

  const cycleStateForSelected = cycleMap?.get(selectedDate) ?? null;
  const cycleSummaryLine = cycleStateForSelected
    ? `周期 · ${cycleStateForSelected.label || cycleStateForSelected.shortLabel}`
    : menstrualSummary.isPeriodActive && menstrualSummary.currentPeriodStartDate
      ? `本次经期从 ${formatSimpleDate(menstrualSummary.currentPeriodStartDate)} 开始`
      : menstrualSummary.latest
        ? null
        : "点「经期来了」开始记录与预测";

  // 详情页经期打卡行（仅用户视图）
  const cyclePanel = selectedOwner?.ownerType === "user" ? (
    <div className="calendar-cycle-line">
      <i className="calendar-cycle-dot" data-type={cycleStateForSelected?.type ?? "period"} aria-hidden="true" />
      <span className="calendar-cycle-line-text">{cycleSummaryLine ?? "周期记录"}</span>
      {canCancelSelectedStart ? (
        <button type="button" className="calendar-mini-btn" data-variant="primary" onClick={() => {
          setMenstrualConfig(cancelCurrentPeriodStart(selectedDate));
          setMenstrualRecords(loadMenstrualRecords());
          onNotice?.("已取消这一天的经期来了");
        }}>撤销来了</button>
      ) : (
        <button type="button" className="calendar-mini-btn" data-variant="primary" disabled={!canStartSelected} onClick={() => {
          setMenstrualConfig(startCurrentPeriod(selectedDate));
          setMenstrualRecords(loadMenstrualRecords());
          onNotice?.("已记录经期来了");
        }}>经期来了</button>
      )}
      {canCancelSelectedFinish ? (
        <button type="button" className="calendar-mini-btn" data-variant="primary" onClick={() => {
          const result = cancelFinishCurrentPeriod(selectedDate);
          if (!result.restored) {
            onNotice?.("这一天还没有记录经期走了");
            return;
          }
          setMenstrualConfig(result.config);
          setMenstrualRecords(result.records);
          onNotice?.("已取消这一天的经期走了");
        }}>撤销走了</button>
      ) : (
        <button type="button" className="calendar-mini-btn" data-variant="ghost" disabled={!canFinishSelected} onClick={() => {
          const result = finishCurrentPeriod(selectedDate);
          if (!result.saved) {
            onNotice?.("请先记录经期来了");
            return;
          }
          setMenstrualConfig(result.config);
          setMenstrualRecords(result.records);
          onNotice?.("已记录经期走了");
        }}>经期走了</button>
      )}
    </div>
  ) : null;

  const ownerStrip = (
    <section className="calendar-owner-strip hide-scrollbar">
      {owners.map(owner => (
        <button
          key={owner.key}
          type="button"
          className="calendar-owner-chip"
          data-active={owner.key === selectedKey ? "true" : undefined}
          onClick={() => {
            setFabMenuOpen(false);
            setSelectedKey(owner.key);
            setSelectedDate(todayIso);
          }}
        >
          <Avatar src={owner.avatar || undefined} name={owner.name} size="md" />
          <span>{owner.name}</span>
        </button>
      ))}
    </section>
  );

  const openDetail = (date: string) => {
    setSelectedDate(date);
    setDetailKey(k => k + 1);
    setView("detail");
  };

  return (
    <div className="calendar-app-shell" data-calendar-theme={config.theme}>
      {appliedCalendarCss && <SessionCustomCSS css={appliedCalendarCss} scope=".calendar-app-shell" />}
      <div className="calendar-app">
        {view === "month" ? (
          <CalendarMonthPage
            todayIso={todayIso}
            itemsByDate={itemsByDate}
            cycleMap={cycleMap}
            ownerStrip={ownerStrip}
            onPickDay={openDetail}
            onClose={onClose}
            onOpenTheme={() => setShowThemePanel(true)}
          />
        ) : (
          <CalendarDetailPage
            key={detailKey}
            initialDate={selectedDate}
            todayIso={todayIso}
            itemsByDate={itemsByDate}
            cycleMap={cycleMap}
            cyclePanel={cyclePanel}
            daysPerPage={config.daysPerPage}
            onOpenDaysPicker={() => setShowDaysPanel(true)}
            onOpenCycleSettings={selectedOwner?.ownerType === "user" ? openMenstrualSettings : null}
            onBack={() => setView("month")}
            onSelectedChange={setSelectedDate}
            onEditItem={openEditItem}
          />
        )}

        {fabMenuOpen ? <div className="calendar-fab-backdrop" onClick={() => setFabMenuOpen(false)} /> : null}
        <div className="calendar-fab-stack">
          {fabMenuOpen && selectedOwner?.ownerType === "character" ? (
            <div className="calendar-fab-menu" role="menu">
              <button
                type="button"
                className="calendar-fab-menu-item"
                onClick={() => {
                  setFabMenuOpen(false);
                  openNewDraft(view === "detail" ? selectedDate : todayIso);
                }}
              >
                <Plus size={15} />
                新增日程
              </button>
              <button
                type="button"
                className="calendar-fab-menu-item"
                disabled={isGenerating}
                onClick={() => {
                  setFabMenuOpen(false);
                  setShowGenerateConfirm(true);
                }}
              >
                <Wand2 size={15} />
                {isGenerating ? "生成中…" : "AI 生成本周"}
              </button>
              <button
                type="button"
                className="calendar-fab-menu-item"
                data-on={autoGenerateEnabled ? "true" : undefined}
                onClick={() => {
                  setFabMenuOpen(false);
                  setShowAutoConfirm(true);
                }}
              >
                <Bot size={15} />
                每周自动生成
                <i className="calendar-fab-menu-state">{autoGenerateEnabled ? "已开" : "已关"}</i>
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="calendar-fab calendar-fab-primary"
            data-loading={isGenerating ? "true" : undefined}
            onClick={() => {
              if (selectedOwner?.ownerType === "character") {
                setFabMenuOpen(prev => !prev);
              } else {
                openNewDraft(view === "detail" ? selectedDate : todayIso);
              }
            }}
            aria-label={selectedOwner?.ownerType === "character" ? "日程操作菜单" : "新增事项"}
            aria-expanded={selectedOwner?.ownerType === "character" ? fabMenuOpen : undefined}
          >
            <Plus size={20} style={{ transform: fabMenuOpen ? "rotate(45deg)" : undefined, transition: "transform 0.2s" }} />
          </button>
        </div>
      </div>

      {showThemePanel && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowThemePanel(false)}>
          <div className="calendar-edit-modal calendar-theme-modal" onClick={e => e.stopPropagation()}>
            <div className="calendar-theme-modal-head">
              <strong>主题</strong>
              <button type="button" onClick={() => setShowThemePanel(false)} className="calendar-icon-btn" aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="calendar-theme-grid">
              {CALENDAR_THEMES.map(theme => (
                <button
                  key={theme.id}
                  type="button"
                  className="calendar-theme-option"
                  data-active={config.theme === theme.id ? "true" : undefined}
                  onClick={() => {
                    const nextConfig = { ...config, theme: theme.id };
                    setConfig(nextConfig);
                    saveCalendarConfig(nextConfig);
                  }}
                >
                  <span className="calendar-theme-swatch" data-theme-id={theme.id} aria-hidden="true" />
                  <span>{theme.name}</span>
                </button>
              ))}
            </div>

            <div className="calendar-theme-css-label">自定义 CSS</div>
            <textarea
              className="calendar-css-textarea"
              value={calendarCustomCss}
              onChange={e => setCalendarCustomCss(e.target.value)}
              placeholder="/* 输入 CSS 覆盖日历样式... */"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <div className="calendar-theme-css-actions">
              <CSSSchemeBar
                target="calendar"
                currentCSS={calendarCustomCss}
                onLoad={setCalendarCustomCss}
                btnStyle={{
                  width: 30,
                  height: 30,
                  border: "none",
                  background: "var(--c-calendar-surface)",
                  color: "var(--c-calendar-ink)",
                }}
                modalVars={{
                  panel: "var(--c-calendar-bg)",
                  border: "var(--c-calendar-surface-2)",
                  text: "var(--c-calendar-ink)",
                  textDim: "var(--c-calendar-sub)",
                  input: "var(--c-calendar-surface)",
                  inputBorder: "var(--c-calendar-surface-2)",
                  accent: "var(--c-calendar-today)",
                }}
              />
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setCalendarCustomCss(CALENDAR_CSS_EXAMPLE)}>示例</button>
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setCalendarCustomCss("")}>清空</button>
              <button type="button" className="calendar-block-btn" data-variant="primary" onClick={handleApplyCalendarCss}>应用</button>
            </div>
          </div>
        </div>
      )}

      {showDaysPanel && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowDaysPanel(false)}>
          <div className="calendar-edit-modal calendar-days-modal" onClick={e => e.stopPropagation()}>
            <div className="calendar-theme-modal-head">
              <strong>每页天数</strong>
              <button type="button" onClick={() => setShowDaysPanel(false)} className="calendar-icon-btn" aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="calendar-days-options">
              {CALENDAR_DAYS_PER_PAGE_OPTIONS.map(n => (
                <button
                  key={n}
                  type="button"
                  className="calendar-days-option"
                  data-active={config.daysPerPage === n ? "true" : undefined}
                  onClick={() => {
                    const nextConfig = { ...config, daysPerPage: n };
                    setConfig(nextConfig);
                    saveCalendarConfig(nextConfig);
                    setShowDaysPanel(false);
                  }}
                >
                  <b>{n}</b>
                  <span>{n === 1 ? "单日" : `${n} 天`}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {editingItem && (
        <CalendarEventEditModal
          draft={editingItem}
          onChange={next => setEditingItem(prev => (prev ? { ...prev, ...next } : next))}
          onSave={handleSaveDraft}
          onDelete={handleDeleteItem}
          onClose={() => setEditingItem(null)}
        />
      )}

      {showMenstrualSettings && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowMenstrualSettings(false)}>
          <div className="calendar-edit-modal calendar-menstrual-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header" data-ui="modal-header">
              <button onClick={() => setShowMenstrualSettings(false)} className="modal-header-btn modal-header-btn-muted" aria-label="返回">
                <ChevronLeft size={18} />
              </button>
              <span className="modal-header-title">周期设置</span>
              <button onClick={handleSaveMenstrualSettings} className="modal-header-btn modal-header-btn-action" aria-label="保存">
                <Check size={18} />
              </button>
            </div>

            <div className="modal-body hide-scrollbar flex flex-col gap-3 pb-10" data-ui="modal-body">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="menu-desc ml-1">周期长度</label>
                  <Input
                    type="number"
                    min={21}
                    max={60}
                    value={menstrualDraft.cycleLength}
                    onChange={e => setMenstrualDraft(prev => ({ ...prev, cycleLength: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="menu-desc ml-1">经期天数</label>
                  <Input
                    type="number"
                    min={2}
                    max={10}
                    value={menstrualDraft.periodLength}
                    onChange={e => setMenstrualDraft(prev => ({ ...prev, periodLength: e.target.value }))}
                  />
                </div>
              </div>

              <div className="calendar-menstrual-care-panel">
                <button
                  type="button"
                  className="calendar-menstrual-care-toggle"
                  data-active={menstrualDraft.periodCareEnabled ? "true" : undefined}
                  onClick={() => setMenstrualDraft(prev => ({ ...prev, periodCareEnabled: !prev.periodCareEnabled }))}
                >
                  <span className="calendar-menstrual-care-toggle-icon">
                    <HeartPulse size={16} />
                  </span>
                  <span className="calendar-menstrual-care-toggle-copy">
                    <strong>让TA关心我的经期</strong>
                    <span>只显示已有聊天会话的角色</span>
                  </span>
                  <span className="calendar-menstrual-pill-switch" aria-hidden="true">
                    <span className="calendar-menstrual-pill-switch-thumb" />
                  </span>
                </button>

                {menstrualDraft.periodCareEnabled ? (
                  <div className="calendar-menstrual-care-body">
                    <div className="calendar-menstrual-care-section">
                      <label className="menu-desc ml-1">提前多久关心</label>
                      <div className="calendar-period-care-lead-row">
                        {(["1", "2", "3"] as const).map(value => (
                          <button
                            key={value}
                            type="button"
                            className="calendar-period-care-lead"
                            data-active={menstrualDraft.periodCareLeadDays === value ? "true" : undefined}
                            onClick={() => setMenstrualDraft(prev => ({ ...prev, periodCareLeadDays: value }))}
                          >
                            {value}天
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="calendar-menstrual-care-section">
                      <label className="menu-desc ml-1">选择角色</label>
                      {periodCareCharacterOptions.length > 0 ? (
                        <div className="calendar-period-care-avatars">
                          {periodCareCharacterOptions.map(option => {
                            const selected = menstrualDraft.periodCareCharacterIds.includes(option.characterId);
                            return (
                              <button
                                key={option.characterId}
                                type="button"
                                className="calendar-period-care-avatar"
                                data-active={selected ? "true" : undefined}
                                onClick={() => togglePeriodCareCharacter(option.characterId)}
                              >
                                <Avatar src={option.avatar || undefined} name={option.name} size="md" />
                                <span>{option.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="calendar-menstrual-empty">已有聊天会话的角色会显示在这里。</div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {menstrualRecords.length > 0 ? (
                <div className="calendar-menstrual-modal-history">
                  <label className="menu-desc ml-1">最近完成的经期</label>
                  <div className="calendar-menstrual-modal-list">
                    {menstrualRecords.slice(0, 4).map(record => (
                      <div key={record.id} className="calendar-menstrual-modal-item">
                        <div>
                          <strong>{formatSimpleDate(record.startDate)} - {formatSimpleDate(record.endDate)}</strong>
                          <span>{record.startDate} 至 {record.endDate}</span>
                        </div>
                        <button
                          type="button"
                          className="calendar-menstrual-modal-delete"
                          onClick={() => {
                            setMenstrualRecords(deleteMenstrualRecord(record.id));
                            refreshMenstrual();
                            onNotice?.("经期记录已删除");
                          }}
                          aria-label="删除记录"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="calendar-menstrual-empty">还没有完成的经期记录。先在日程页点“经期来了”，结束时再点“经期走了”。</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showGenerateConfirm && selectedOwner && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowGenerateConfirm(false)}>
          <div className="calendar-edit-modal calendar-confirm-dialog" onClick={e => e.stopPropagation()}>
            <Wand2 size={26} className="calendar-confirm-icon" />
            <div className="calendar-confirm-title">确认生成日程？</div>
            <div className="calendar-confirm-desc">
              将为 <strong>{selectedOwner.name}</strong> 生成一周日程并覆盖当前已有 AI 安排（手动添加的保留）
            </div>
            <div className="calendar-confirm-footer">
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setShowGenerateConfirm(false)}>取消</button>
              <button
                type="button"
                className="calendar-block-btn"
                data-variant="primary"
                data-loading={isGenerating ? "true" : undefined}
                onClick={handleGenerate}
                disabled={isGenerating}
                aria-busy={isGenerating}
              >
                {isGenerating ? "生成中…" : "确认"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAutoConfirm && selectedOwner && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowAutoConfirm(false)}>
          <div className="calendar-edit-modal calendar-confirm-dialog" onClick={e => e.stopPropagation()}>
            <Bot size={26} className="calendar-confirm-icon" />
            <div className="calendar-confirm-title">
              {autoGenerateEnabled ? "关闭自动生成？" : "开启自动生成？"}
            </div>
            <div className="calendar-confirm-desc">
              {autoGenerateEnabled
                ? "关闭后将不再自动为角色生成每周日程"
                : <>每周将自动为 <strong>{selectedOwner.name}</strong> 生成日程安排</>}
            </div>
            <div className="calendar-confirm-footer">
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setShowAutoConfirm(false)}>取消</button>
              <button
                type="button"
                className="calendar-block-btn"
                data-variant="primary"
                onClick={() => {
                  const next = !autoGenerateEnabled;
                  const nextConfig = { ...config, autoGenerateEnabled: next };
                  setConfig(nextConfig);
                  saveCalendarConfig(nextConfig);
                  setShowAutoConfirm(false);
                  onNotice?.(next ? "已开启每周自动生成" : "已关闭每周自动生成");
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
