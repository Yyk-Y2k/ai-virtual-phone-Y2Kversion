"use client";

import { Check, ChevronLeft, Trash2 } from "lucide-react";
import { Input } from "../ui/form";
import type { CalendarColorKey } from "@/lib/calendar-types";
import { CALENDAR_COLOR_KEYS } from "@/lib/calendar-utils";

export type CalendarEventDraft = {
  id?: string;
  date: string;
  /** 结束日期（含当天）；留空视为单天。跨多天时保存会按天生成日程 */
  endDate?: string;
  startTime: string;
  endTime: string;
  location: string;
  title: string;
  emoji: string;
  colorKey?: CalendarColorKey;
  repeatWeekly?: boolean;
  repeatWeekdays?: number[];
  repeatUntil?: string;
  seriesId?: string;
  recurrenceExcludedDates?: string[];
};

const EMOJI_PRESETS = [
  "📌", "💼", "📚", "💻", "🏃", "🏋️", "🍽️", "☕", "🎬",
  "🎮", "🎵", "🛒", "🛍️", "✈️", "🏥", "📞", "💤", "❤️",
  "🎂", "🎨", "🧹", "🐾",
];

const COLOR_LABELS: Record<CalendarColorKey, string> = {
  blue: "蓝",
  green: "绿",
  amber: "橙",
  rose: "粉",
  violet: "紫",
  teal: "青",
  slate: "灰",
  lilac: "丁香",
};

export function CalendarEventEditModal({
  draft,
  onChange,
  onSave,
  onDelete,
  onClose,
}: {
  draft: CalendarEventDraft;
  onChange: (next: CalendarEventDraft) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay calendar-edit-modal-overlay" onClick={onClose}>
      <div className="calendar-edit-modal" data-ui="calendar-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header" data-ui="modal-header">
          <button onClick={onClose} className="modal-header-btn modal-header-btn-muted" aria-label="返回">
            <ChevronLeft size={18} />
          </button>
          <span className="modal-header-title">{draft.id ? "编辑日程" : "新增日程"}</span>
          <button onClick={onSave} className="modal-header-btn modal-header-btn-action" aria-label="保存">
            <Check size={18} />
          </button>
        </div>

        <div className="modal-body hide-scrollbar flex flex-col gap-3 pb-10" data-ui="modal-body">
          <div className="flex flex-col gap-2">
            <label className="menu-desc" htmlFor="calendar-repeat">重复</label>
            <select id="calendar-repeat" className="ui-input" value={draft.repeatWeekly ? "weekly" : "none"}
              onChange={e => onChange({ ...draft, repeatWeekly: e.target.value === "weekly",
                repeatWeekdays: draft.repeatWeekdays?.length ? draft.repeatWeekdays : [new Date(`${draft.date}T12:00:00`).getDay()],
                repeatUntil: draft.repeatUntil || draft.endDate || draft.date })}>
              <option value="none">不重复（按日期范围每天创建）</option>
              <option value="weekly">每周重复 · 自选星期</option>
            </select>
            {draft.repeatWeekly ? <>
              <div className="flex flex-wrap gap-2" role="group" aria-label="重复星期">
                {[1, 2, 3, 4, 5, 6, 0].map((day, index) => {
                  const selected = (draft.repeatWeekdays || []).includes(day);
                  return <button key={day} type="button" className="ui-btn ui-btn-outline" aria-pressed={selected}
                    style={selected ? { background: "var(--accent, #6366f1)", color: "#fff" } : undefined}
                    onClick={() => onChange({ ...draft, repeatWeekdays: selected
                      ? (draft.repeatWeekdays || []).filter(value => value !== day)
                      : [...(draft.repeatWeekdays || []), day] })}>
                    {["周一", "周二", "周三", "周四", "周五", "周六", "周日"][index]}
                  </button>;
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="ui-btn ui-btn-outline" onClick={() => onChange({ ...draft, repeatWeekdays: [1, 2, 3, 4, 5] })}>工作日</button>
                <button type="button" className="ui-btn ui-btn-outline" onClick={() => onChange({ ...draft, repeatWeekdays: [6, 0] })}>周末</button>
                <button type="button" className="ui-btn ui-btn-outline" onClick={() => onChange({ ...draft, repeatWeekdays: [1, 2, 3, 4, 5, 6, 0] })}>每天</button>
              </div>
              <label className="menu-desc">重复截止日期（含当天，最多一年）</label>
              <Input type="date" min={draft.date} value={draft.repeatUntil || draft.date}
                onChange={e => onChange({ ...draft, repeatUntil: e.target.value })} />
              <p className="menu-desc">从开始日期到截止日期，仅在选中的星期创建日程；结束日期仅用于不重复模式。</p>
            </> : null}
            {draft.seriesId ? <p className="menu-desc">保存或删除作用于整组重复日程，包括过去的日期。开始日期为整组起始日期。</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="menu-desc ml-1">开始日期</label>
              <Input
                type="date"
                value={draft.date}
                onChange={e => {
                  const nextDate = e.target.value;
                  const currentEnd = draft.endDate || draft.date;
                  // 结束日期跟随开始日期，除非用户已把结束日期改到更晚
                  onChange({ ...draft, date: nextDate, endDate: currentEnd > nextDate ? currentEnd : nextDate });
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="menu-desc ml-1">结束日期</label>
              <Input
                type="date"
                value={draft.endDate || draft.date}
                disabled={draft.repeatWeekly}
                min={draft.date}
                onChange={e => onChange({ ...draft, endDate: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="menu-desc ml-1">开始时间</label>
              <Input
                type="time"
                value={draft.startTime}
                onChange={e => onChange({ ...draft, startTime: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="menu-desc ml-1">结束时间</label>
              <Input
                type="time"
                value={draft.endTime}
                onChange={e => onChange({ ...draft, endTime: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="menu-desc ml-1">事项</label>
            <Input
              value={draft.title}
              onChange={e => onChange({ ...draft, title: e.target.value })}
              placeholder="例如：部门周会"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="menu-desc ml-1">地点</label>
            <Input
              value={draft.location}
              onChange={e => onChange({ ...draft, location: e.target.value })}
              placeholder="例如：公司会议室 / 家里 / 商场"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="menu-desc ml-1">图标（点选，再点一次取消）</label>
            <div className="calendar-emoji-row">
              {draft.emoji && !EMOJI_PRESETS.includes(draft.emoji) ? (
                <button
                  type="button"
                  className="calendar-emoji-preset"
                  data-active="true"
                  onClick={() => onChange({ ...draft, emoji: "" })}
                  aria-label={`取消 ${draft.emoji}`}
                >
                  {draft.emoji}
                </button>
              ) : null}
              {EMOJI_PRESETS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  className="calendar-emoji-preset"
                  data-active={draft.emoji === emoji ? "true" : undefined}
                  onClick={() => onChange({ ...draft, emoji: draft.emoji === emoji ? "" : emoji })}
                  aria-label={`使用 ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="menu-desc ml-1">颜色</label>
            <div className="calendar-color-picker">
              <button
                type="button"
                className="calendar-color-swatch calendar-color-swatch-auto"
                data-active={!draft.colorKey ? "true" : undefined}
                onClick={() => onChange({ ...draft, colorKey: undefined })}
              >
                自动
              </button>
              {CALENDAR_COLOR_KEYS.map(key => (
                <button
                  key={key}
                  type="button"
                  className="calendar-color-swatch"
                  data-color={key}
                  data-active={draft.colorKey === key ? "true" : undefined}
                  onClick={() => onChange({ ...draft, colorKey: key })}
                  aria-label={`颜色：${COLOR_LABELS[key]}`}
                  title={COLOR_LABELS[key]}
                />
              ))}
            </div>
          </div>

          {draft.id ? (
            <button type="button" className="ui-btn ui-btn-outline calendar-delete-btn" onClick={onDelete}>
              <Trash2 size={16} />
              删除该事项
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
